"""Strict, dependency-injected Jira issue field editing.

The route layer owns authentication, OAuth grant checks, and configured field
resolution. This module accepts only an OAuth-bound Jira request callable, the
captured request context, and a server-created logical-field map.
"""

from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
import re

from backend.auth.jira_auth import AuthError


LOGICAL_FIELDS = frozenset({"assignee", "deliveryOwner", "storyPoints"})
PEOPLE_FIELDS = frozenset({"assignee", "deliveryOwner"})
_ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]+-\d+$")
_CONTROL_CHARACTER_RE = re.compile(r"[\x00-\x1f\x7f]")
_MUTATION_KEYS = frozenset({
    "field", "value", "baseValue", "baseUpdated", "mappingRevision",
})


class FieldEditInputError(ValueError):
    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


class FieldEditServiceError(Exception):
    def __init__(self, code, status=None, message=None, *, details=None):
        self.code = code
        self.status = status
        self.status_code = status
        self.details = dict(details or {})
        super().__init__(message or code)


def _normalize_issue_key(value):
    if not isinstance(value, str):
        raise FieldEditInputError("invalid_issue_key")
    key = value.strip().upper()
    if not _ISSUE_KEY_RE.fullmatch(key):
        raise FieldEditInputError("invalid_issue_key")
    return key


def _normalize_field(value):
    if not isinstance(value, str) or value not in LOGICAL_FIELDS:
        raise FieldEditInputError("invalid_field")
    return value


def _field_id(field, field_ids):
    if not isinstance(field_ids, dict):
        return ""
    value = field_ids.get(field)
    return value.strip() if isinstance(value, str) else ""


def _mapping_revision(context, field, field_id):
    canonical = json.dumps(
        [
            str(getattr(context, "workspace_id", "") or ""),
            str(getattr(context, "cloud_id", "") or ""),
            field,
            field_id,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _response_json(response, expected_type):
    try:
        payload = response.json()
    except (TypeError, ValueError) as error:
        raise FieldEditServiceError("jira_read_failed", 502) from error
    if not isinstance(payload, expected_type):
        raise FieldEditServiceError("jira_read_failed", 502)
    return payload


def _raise_read_status(response):
    if response.status_code == 401:
        raise AuthError("auth_required", "Jira authentication is required.")
    if response.status_code in (403, 404):
        raise FieldEditServiceError("issue_not_found", 404)
    if response.status_code != 200:
        raise FieldEditServiceError("jira_read_failed", 502)


def _jira_read(jira_request, method, path, *, context, params=None):
    try:
        response = jira_request(
            method, path, params=params, timeout=10, context=context,
        )
    except AuthError:
        raise
    except Exception as error:
        raise FieldEditServiceError("jira_read_failed", 502) from error
    _raise_read_status(response)
    return response


def _normalize_person(raw, *, include_email=False):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise FieldEditServiceError("jira_read_failed", 502)
    account_id = raw.get("accountId")
    display_name = raw.get("displayName")
    if not isinstance(account_id, str) or not account_id.strip():
        raise FieldEditServiceError("jira_read_failed", 502)
    if not isinstance(display_name, str) or not display_name.strip():
        raise FieldEditServiceError("jira_read_failed", 502)
    normalized = {
        "accountId": account_id.strip(),
        "displayName": display_name.strip(),
    }
    email = raw.get("emailAddress")
    if include_email and isinstance(email, str) and email.strip():
        normalized["emailAddress"] = email.strip()
    return normalized


def _normalize_existing_number(raw):
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise FieldEditServiceError("jira_read_failed", 502)
    try:
        finite = math.isfinite(raw)
    except OverflowError as error:
        raise FieldEditServiceError("jira_read_failed", 502) from error
    if not finite:
        raise FieldEditServiceError("jira_read_failed", 502)
    return raw


def _normalize_current_value(field, raw):
    if field in PEOPLE_FIELDS:
        return _normalize_person(raw)
    return _normalize_existing_number(raw)


def _snapshot_fields(field_id):
    return f"issuetype,updated,{field_id}"


def _load_snapshot(key, field, field_id, *, jira_request, context):
    response = _jira_read(
        jira_request,
        "GET",
        f"/rest/api/3/issue/{key}",
        params={"fields": _snapshot_fields(field_id)},
        context=context,
    )
    payload = _response_json(response, dict)
    fields = payload.get("fields")
    if not isinstance(fields, dict) or field_id not in fields:
        raise FieldEditServiceError("jira_read_failed", 502)
    issue_type = fields.get("issuetype")
    if not isinstance(issue_type, dict):
        raise FieldEditServiceError("jira_read_failed", 502)
    type_name = issue_type.get("name")
    if not isinstance(type_name, str) or not type_name.strip():
        raise FieldEditServiceError("jira_read_failed", 502)
    if not isinstance(issue_type.get("subtask"), bool):
        raise FieldEditServiceError("jira_read_failed", 502)
    updated = fields.get("updated")
    if not isinstance(updated, str) or not updated.strip():
        raise FieldEditServiceError("jira_read_failed", 502)
    return {
        "issueType": type_name.strip(),
        "subtask": issue_type.get("subtask") is True,
        "updated": updated.strip(),
        "value": _normalize_current_value(field, fields[field_id]),
    }


def _issue_supports_field(snapshot, field):
    if snapshot["subtask"]:
        return False
    issue_type = snapshot["issueType"].lower()
    if field == "deliveryOwner":
        return issue_type == "epic"
    if field == "storyPoints":
        return issue_type == "story"
    return issue_type in {"epic", "story"}


def _expected_schema(field):
    if field == "assignee":
        return {"type": "user", "system": "assignee"}
    if field == "deliveryOwner":
        return {
            "type": "user",
            "custom": "com.atlassian.jira.plugin.system.customfieldtypes:userpicker",
        }
    return {"type": "number"}


def _load_editmeta(key, field, field_id, *, jira_request, context):
    response = _jira_read(
        jira_request,
        "GET",
        f"/rest/api/3/issue/{key}/editmeta",
        context=context,
    )
    payload = _response_json(response, dict)
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        raise FieldEditServiceError("jira_read_failed", 502)
    metadata = fields.get(field_id)
    if not isinstance(metadata, dict):
        return None
    operations = metadata.get("operations")
    schema = metadata.get("schema")
    if not isinstance(operations, list) or "set" not in operations:
        return None
    expected = _expected_schema(field)
    if not isinstance(schema, dict) or any(schema.get(key) != value for key, value in expected.items()):
        return None
    if "allowedValues" in metadata and not isinstance(metadata.get("allowedValues"), list):
        raise FieldEditServiceError("jira_read_failed", 502)
    return metadata


def _metadata_payload(key, field, *, current_value, updated, revision,
                      editable, reason, me=None):
    return {
        "issueKey": key,
        "field": field,
        "editable": editable,
        "reason": reason,
        "currentValue": current_value,
        "baseUpdated": updated,
        "mappingRevision": revision,
        "me": me,
    }


def _load_context_person(context, *, jira_request):
    account_id = str(getattr(context, "atlassian_account_id", "") or "").strip()
    if not account_id:
        raise AuthError("auth_required", "Jira authentication is required.")
    display_name = str(
        getattr(context, "atlassian_display_name", "")
        or getattr(context, "display_name", "")
        or ""
    ).strip()
    if display_name:
        return {"accountId": account_id, "displayName": display_name}
    response = _jira_read(
        jira_request, "GET", "/rest/api/3/myself", context=context,
    )
    value = _normalize_person(_response_json(response, dict), include_email=True)
    if value["accountId"] != account_id:
        raise AuthError("auth_required", "Jira authentication is required.")
    return value


def _person_records(response):
    records = _response_json(response, list)
    return records


def _active_person(raw, *, include_email=False):
    if not isinstance(raw, dict) or raw.get("active") is not True:
        return None
    try:
        return _normalize_person(raw, include_email=include_email)
    except FieldEditServiceError:
        return None


def _exact_person(key, field, account_id, *, jira_request, context):
    if field == "assignee":
        path = "/rest/api/3/user/assignable/search"
        params = {"issueKey": key, "accountId": account_id, "maxResults": 1}
    else:
        path = "/rest/api/3/user/search"
        params = {"accountId": account_id, "maxResults": 1}
    try:
        response = jira_request(
            "GET", path, params=params, timeout=10, context=context,
        )
    except AuthError:
        raise
    except Exception as error:
        raise FieldEditServiceError("jira_read_failed", 502) from error
    if response.status_code == 401:
        raise AuthError("auth_required", "Jira authentication is required.")
    if response.status_code in (403, 404):
        return None
    if response.status_code != 200:
        raise FieldEditServiceError("jira_read_failed", 502)
    for raw in _person_records(response):
        candidate = _active_person(raw, include_email=True)
        if candidate and candidate["accountId"] == account_id:
            return candidate
    return None


def _allowed_account_ids(metadata):
    if "allowedValues" not in metadata:
        return None
    allowed = set()
    for raw in metadata.get("allowedValues") or []:
        candidate = _active_person(raw)
        if candidate:
            allowed.add(candidate["accountId"])
    return allowed


def load_editable_field(issue_key, field, *, jira_request, context, field_ids):
    key = _normalize_issue_key(issue_key)
    logical_field = _normalize_field(field)
    resolved_field_id = _field_id(logical_field, field_ids)
    if not resolved_field_id:
        return _metadata_payload(
            key, logical_field, current_value=None, updated=None, revision=None,
            editable=False, reason="field_mapping_missing",
        )
    revision = _mapping_revision(context, logical_field, resolved_field_id)
    snapshot = _load_snapshot(
        key, logical_field, resolved_field_id,
        jira_request=jira_request, context=context,
    )
    if not _issue_supports_field(snapshot, logical_field):
        return _metadata_payload(
            key, logical_field, current_value=snapshot["value"],
            updated=snapshot["updated"], revision=revision,
            editable=False, reason="issue_type_not_supported",
        )
    metadata = _load_editmeta(
        key, logical_field, resolved_field_id,
        jira_request=jira_request, context=context,
    )
    if metadata is None:
        return _metadata_payload(
            key, logical_field, current_value=snapshot["value"],
            updated=snapshot["updated"], revision=revision,
            editable=False, reason="field_not_editable",
        )
    me = None
    if logical_field in PEOPLE_FIELDS:
        me = _load_context_person(context, jira_request=jira_request)
        exact = _exact_person(
            key, logical_field, me["accountId"],
            jira_request=jira_request, context=context,
        )
        allowed_ids = _allowed_account_ids(metadata)
        if exact is None or (allowed_ids is not None and me["accountId"] not in allowed_ids):
            eligibility = "ineligible"
        elif logical_field == "deliveryOwner" and allowed_ids is None:
            eligibility = "unverified"
        else:
            eligibility = "eligible"
        me = {
            "accountId": me["accountId"],
            "displayName": me["displayName"],
            "eligibility": eligibility,
        }
    return _metadata_payload(
        key, logical_field, current_value=snapshot["value"],
        updated=snapshot["updated"], revision=revision,
        editable=True, reason=None, me=me,
    )


def _validate_search_payload(payload):
    if not isinstance(payload, dict):
        raise FieldEditInputError("invalid_json")
    if set(payload) != {"field", "query"}:
        raise FieldEditInputError("invalid_query")
    field = _normalize_field(payload.get("field"))
    if field not in PEOPLE_FIELDS:
        raise FieldEditInputError("unsupported_field")
    query = payload.get("query")
    if not isinstance(query, str):
        raise FieldEditInputError("invalid_query")
    query = query.strip()
    if len(query) < 3 or len(query) > 200:
        raise FieldEditInputError("invalid_query")
    return field, query


def search_field_users(issue_key, payload, *, jira_request, context, field_ids):
    key = _normalize_issue_key(issue_key)
    field, query = _validate_search_payload(payload)
    resolved_field_id = _field_id(field, field_ids)
    if not resolved_field_id:
        raise FieldEditServiceError("field_not_editable", 409)
    snapshot = _load_snapshot(
        key, field, resolved_field_id, jira_request=jira_request, context=context,
    )
    if not _issue_supports_field(snapshot, field):
        raise FieldEditServiceError("issue_type_not_supported", 409)
    metadata = _load_editmeta(
        key, field, resolved_field_id, jira_request=jira_request, context=context,
    )
    if metadata is None:
        raise FieldEditServiceError("field_not_editable", 409)
    if field == "assignee":
        path = "/rest/api/3/user/assignable/search"
        params = {"issueKey": key, "query": query, "maxResults": 5}
    else:
        path = "/rest/api/3/user/search"
        params = {"query": query, "maxResults": 5}
    response = _jira_read(
        jira_request, "GET", path, params=params, context=context,
    )
    records = _person_records(response)
    me_id = str(getattr(context, "atlassian_account_id", "") or "").strip()
    allowed_ids = _allowed_account_ids(metadata)
    options = []
    seen = set()
    for raw in records:
        candidate = _active_person(raw, include_email=True)
        if candidate is None:
            continue
        account_id = candidate["accountId"]
        if account_id == me_id or account_id in seen:
            continue
        if allowed_ids is not None and account_id not in allowed_ids:
            continue
        seen.add(account_id)
        options.append(candidate)
        if len(options) == 4:
            break
    return {
        "issueKey": key,
        "field": field,
        "options": options,
        "limited": True,
    }


def validate_story_points(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FieldEditInputError("invalid_value")
    try:
        decimal_value = Decimal(str(value))
        if (not decimal_value.is_finite() or decimal_value < 0
                or decimal_value != decimal_value.quantize(Decimal("0.1"))):
            raise FieldEditInputError("invalid_value")
    except (InvalidOperation, ValueError, OverflowError):
        raise FieldEditInputError("invalid_value")
    return value


def _validate_account_id(value):
    if not isinstance(value, str):
        raise FieldEditInputError("invalid_value")
    account_id = value.strip()
    if not account_id or len(account_id) > 256 or _CONTROL_CHARACTER_RE.search(account_id):
        raise FieldEditInputError("invalid_value")
    return account_id


def _validate_person_value(value, *, allow_null):
    if value is None and allow_null:
        return None
    if not isinstance(value, dict) or set(value) != {"accountId"}:
        raise FieldEditInputError("invalid_value")
    return {"accountId": _validate_account_id(value.get("accountId"))}


def _validate_number_baseline(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FieldEditInputError("invalid_value")
    try:
        finite = math.isfinite(value)
    except OverflowError as error:
        raise FieldEditInputError("invalid_value") from error
    if not finite:
        raise FieldEditInputError("invalid_value")
    return value


def _validate_mutation_payload(payload):
    if not isinstance(payload, dict):
        raise FieldEditInputError("invalid_json")
    if set(payload) != _MUTATION_KEYS:
        raise FieldEditInputError("invalid_json")
    field = _normalize_field(payload.get("field"))
    mapping_revision = payload.get("mappingRevision")
    if not isinstance(mapping_revision, str) or not mapping_revision.strip():
        raise FieldEditInputError("invalid_value")
    base_updated = payload.get("baseUpdated")
    if not isinstance(base_updated, str) or not base_updated.strip():
        raise FieldEditInputError("invalid_value")
    if field in PEOPLE_FIELDS:
        target = _validate_person_value(payload.get("value"), allow_null=False)
        baseline = _validate_person_value(payload.get("baseValue"), allow_null=True)
    else:
        target = validate_story_points(payload.get("value"))
        baseline = _validate_number_baseline(payload.get("baseValue"))
    return field, target, baseline, base_updated.strip(), mapping_revision.strip()


def _comparable_value(field, value):
    if field in PEOPLE_FIELDS:
        return None if value is None else value.get("accountId")
    if value is None:
        return None
    return Decimal(str(value))


def _conflict_details(key, field, snapshot, revision):
    return {
        "issueKey": key,
        "field": field,
        "currentValue": snapshot["value"],
        "baseUpdated": snapshot["updated"],
        "mappingRevision": revision,
    }


def _unknown_error(key, field):
    return FieldEditServiceError(
        "write_outcome_unknown",
        503,
        details={"issueKey": key, "field": field},
    )


def _retry_after_seconds(response):
    headers = getattr(response, "headers", {}) or {}
    try:
        seconds = int(headers.get("Retry-After") or 1)
    except (TypeError, ValueError):
        seconds = 1
    return max(1, min(seconds, 60))


def _raise_put_failure(response, key, field, snapshot, revision):
    status = response.status_code
    if status == 401:
        raise AuthError("auth_required", "Jira authentication is required.")
    if status == 403:
        raise FieldEditServiceError("jira_edit_forbidden", 403)
    if status == 404:
        raise FieldEditServiceError("issue_not_found", 404)
    if status == 400:
        raise FieldEditServiceError("jira_field_rejected", 409)
    if status == 422:
        raise FieldEditServiceError("jira_configuration_invalid", 409)
    if status == 429:
        raise FieldEditServiceError(
            "jira_rate_limited", 429,
            details={"retryAfterSeconds": _retry_after_seconds(response)},
        )


def update_issue_field(issue_key, payload, *, jira_request, context, field_ids, invalidate):
    key = _normalize_issue_key(issue_key)
    field, target, baseline, _base_updated, submitted_revision = _validate_mutation_payload(payload)
    resolved_field_id = _field_id(field, field_ids)
    current_revision = _mapping_revision(context, field, resolved_field_id) if resolved_field_id else None
    if not current_revision or submitted_revision != current_revision:
        raise FieldEditServiceError("field_mapping_changed", 409)
    snapshot = _load_snapshot(
        key, field, resolved_field_id, jira_request=jira_request, context=context,
    )
    if not _issue_supports_field(snapshot, field):
        raise FieldEditServiceError("issue_type_not_supported", 409)
    metadata = _load_editmeta(
        key, field, resolved_field_id, jira_request=jira_request, context=context,
    )
    if metadata is None:
        raise FieldEditServiceError("field_not_editable", 409)
    if _comparable_value(field, snapshot["value"]) != _comparable_value(field, baseline):
        raise FieldEditServiceError(
            "stale_issue", 409,
            details=_conflict_details(key, field, snapshot, current_revision),
        )
    if field in PEOPLE_FIELDS:
        account_id = target["accountId"]
        exact = _exact_person(
            key, field, account_id, jira_request=jira_request, context=context,
        )
        allowed_ids = _allowed_account_ids(metadata)
        if exact is None or (allowed_ids is not None and account_id not in allowed_ids):
            raise FieldEditServiceError("target_unavailable", 409)
    if _comparable_value(field, snapshot["value"]) == _comparable_value(field, target):
        return {
            "issueKey": key,
            "field": field,
            "result": "unchanged",
            "value": snapshot["value"],
            "updated": snapshot["updated"],
        }
    write_value = (
        {"accountId": target["accountId"]}
        if field in PEOPLE_FIELDS else target
    )
    try:
        response = jira_request(
            "PUT",
            f"/rest/api/3/issue/{key}",
            json_body={"fields": {resolved_field_id: write_value}},
            timeout=10,
            context=context,
        )
    except AuthError:
        raise
    except Exception as error:
        invalidate("issue_field_edit")
        raise _unknown_error(key, field) from error
    if response.status_code not in (200, 204):
        if response.status_code == 409:
            try:
                fresh_snapshot = _load_snapshot(
                    key, field, resolved_field_id,
                    jira_request=jira_request, context=context,
                )
            except AuthError:
                raise
            except FieldEditServiceError:
                raise FieldEditServiceError("stale_issue", 409)
            raise FieldEditServiceError(
                "stale_issue", 409,
                details=_conflict_details(
                    key, field, fresh_snapshot, current_revision,
                ),
            )
        if response.status_code >= 500:
            invalidate("issue_field_edit")
            raise _unknown_error(key, field)
        _raise_put_failure(response, key, field, snapshot, current_revision)
        invalidate("issue_field_edit")
        raise _unknown_error(key, field)
    invalidate("issue_field_edit")
    try:
        confirmed = _load_snapshot(
            key, field, resolved_field_id, jira_request=jira_request, context=context,
        )
    except AuthError:
        raise
    except FieldEditServiceError as error:
        raise _unknown_error(key, field) from error
    return {
        "issueKey": key,
        "field": field,
        "result": "success",
        "value": confirmed["value"],
        "updated": confirmed["updated"],
    }
