"""Strict Jira discovery for complete per-Sprint Team membership."""

from __future__ import annotations

import math
import re

from backend.auth.jira_auth import AuthError


TEAM_MAX_PAGES = 100
TEAM_MAX_ROWS = 10000


class TeamCatalogFetchError(RuntimeError):
    """Fixed failure boundary for strict Sprint Team discovery."""

    ALLOWED_CODES = frozenset({'jira_unavailable', 'catalog_incomplete'})

    def __init__(self, code):
        if code not in self.ALLOWED_CODES:
            raise ValueError('invalid Team catalog failure code')
        self.code = code
        super().__init__(code)


class SprintTeamPayload(list):
    """Membership rows plus Jira issue-name provenance for atomic publication."""

    def __init__(self, values=(), *, issue_names=None):
        super().__init__(values)
        self.issue_names = dict(issue_names or {})


def _id(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        result = value.strip()
        return result or None
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or value <= 0:
            return None
        return str(int(value)) if int(value) == value else str(value)
    return None


def _members(value):
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    result = []
    for item in values:
        if item is None:
            continue
        if isinstance(item, list):
            raise TeamCatalogFetchError('catalog_incomplete')
        name = None
        if isinstance(item, dict):
            team_id = _id(item.get('id'))
            raw_name = item.get('name')
            if raw_name is not None and not isinstance(raw_name, str):
                raise TeamCatalogFetchError('catalog_incomplete')
            name = raw_name.strip() if isinstance(raw_name, str) else None
        else:
            team_id = _id(item)
        if team_id is None:
            raise TeamCatalogFetchError('catalog_incomplete')
        result.append((team_id, name or None))
    return result


def _directory_names(directory):
    source = directory.get('catalog') if isinstance(directory, dict) and isinstance(directory.get('catalog'), dict) else directory
    if not isinstance(source, dict):
        return {}
    result = {}
    for key, value in source.items():
        if not isinstance(value, dict):
            continue
        team_id = _id(value.get('id')) or _id(key)
        name = value.get('name')
        if team_id and isinstance(name, str) and name.strip():
            result[team_id] = name.strip()
    return result


def fetch_sprint_teams(*, sprint_id, base_jql, team_field_id, jira_search,
                       directory, budget):
    """Return one fully validated Team membership snapshot for a Sprint."""
    sprint_key = str(sprint_id or '').strip()
    if re.fullmatch(r'[1-9][0-9]*', sprint_key) is None:
        raise TeamCatalogFetchError('catalog_incomplete')
    base = str(base_jql or '').strip()
    field_id = str(team_field_id or '').strip()
    if not base or not field_id:
        raise TeamCatalogFetchError('catalog_incomplete')

    issue_names = {}
    seen_tokens = set()
    next_token = None
    page_count = 0
    row_count = 0
    while True:
        budget.check('team_page')
        payload = {
            'jql': f'({base}) AND Sprint = {sprint_key}',
            'fields': [field_id],
            'maxResults': 100,
        }
        if next_token is not None:
            payload['nextPageToken'] = next_token
        try:
            response = jira_search(payload)
        except AuthError:
            raise
        except Exception as exc:
            if getattr(exc, 'code', None) == 'refresh_budget_exhausted':
                raise
            raise TeamCatalogFetchError('jira_unavailable') from exc
        status = getattr(response, 'status_code', None)
        if status == 401:
            raise AuthError('auth_required', 'Atlassian authentication is required.')
        if isinstance(status, bool) or not isinstance(status, int):
            raise TeamCatalogFetchError('catalog_incomplete')
        if status != 200:
            raise TeamCatalogFetchError('jira_unavailable')
        try:
            data = response.json()
        except Exception as exc:
            raise TeamCatalogFetchError('catalog_incomplete') from exc
        if not isinstance(data, dict):
            raise TeamCatalogFetchError('catalog_incomplete')
        issues = data.get('issues')
        is_last = data.get('isLast')
        if (
            not isinstance(issues, list) or not isinstance(is_last, bool)
            or len(issues) > 100 or any(not isinstance(issue, dict) for issue in issues)
        ):
            raise TeamCatalogFetchError('catalog_incomplete')
        page_count += 1
        row_count += len(issues)
        if page_count > TEAM_MAX_PAGES or row_count > TEAM_MAX_ROWS:
            raise TeamCatalogFetchError('catalog_incomplete')
        for issue in issues:
            fields = issue.get('fields')
            if not isinstance(fields, dict):
                raise TeamCatalogFetchError('catalog_incomplete')
            for team_id, name in _members(fields.get(field_id)):
                if name:
                    issue_names.setdefault(team_id, set()).add(name)
                else:
                    issue_names.setdefault(team_id, set())
        budget.check('team_page')
        if is_last:
            if data.get('nextPageToken'):
                raise TeamCatalogFetchError('catalog_incomplete')
            break
        token = data.get('nextPageToken')
        if not isinstance(token, str) or not token or token in seen_tokens or page_count >= TEAM_MAX_PAGES:
            raise TeamCatalogFetchError('catalog_incomplete')
        seen_tokens.add(token)
        next_token = token

    directory_names = _directory_names(directory)
    result = []
    for team_id, names in issue_names.items():
        name = min(names) if names else directory_names.get(team_id, team_id)
        result.append({'id': team_id, 'name': name})
    budget.check('team_publish')
    return SprintTeamPayload(
        sorted(result, key=lambda item: (item['name'].casefold(), item['id'])),
        issue_names={team_id: min(names) for team_id, names in issue_names.items() if names},
    )
