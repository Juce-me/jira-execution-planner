#!/usr/bin/env python3
"""Probe whether a user API token can create a text update on a Home project."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.epm import home as epm_home  # noqa: E402


RESULT_PASS = "PASS home_project_update_supported"
RESULT_UNSUPPORTED = "FAIL home_project_update_unsupported"
RESULT_INSUFFICIENT_INPUT = "FAIL insufficient_home_write_probe_input"


def _first_value(*values: str | None) -> str:
    for value in values:
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    return ""


def _default_endpoint() -> str:
    endpoint = _first_value(os.environ.get("HOME_WRITE_PROBE_ENDPOINT"))
    if endpoint:
        return endpoint
    jira_url = _first_value(os.environ.get("JIRA_URL"))
    if jira_url:
        return f"{jira_url.rstrip('/')}/gateway/api/graphql"
    return epm_home.HOME_GRAPHQL_ENDPOINT


def _load_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default=os.environ.get("HOME_WRITE_PROBE_EMAIL"))
    parser.add_argument("--api-token", default=os.environ.get("HOME_WRITE_PROBE_API_TOKEN"))
    parser.add_argument("--project-id", default=os.environ.get("HOME_WRITE_PROBE_PROJECT_ID"))
    parser.add_argument("--text", default=os.environ.get("HOME_WRITE_PROBE_TEXT"))
    parser.add_argument("--endpoint", default=_default_endpoint())
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-project-id", default="")
    parser.add_argument("--output", default="")
    return parser.parse_args()


def _has_required_input(args: argparse.Namespace) -> bool:
    if not args.execute:
        return False
    if _first_value(args.confirm_project_id) != _first_value(args.project_id):
        return False
    return all(
        _first_value(value)
        for value in (args.email, args.api_token, args.project_id, args.text, args.endpoint)
    )


def _basic_authorization(email: str, api_token: str) -> str:
    encoded = base64.b64encode(f"{email}:{api_token}".encode("utf-8")).decode("ascii")
    return f"Basic {encoded}"


def _decode_response(raw: bytes) -> dict:
    if not raw:
        return {}
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {"errors": [{"message": "Home write probe returned invalid JSON."}]}
    return payload if isinstance(payload, dict) else {"errors": [{"message": "Home write probe returned non-object JSON."}]}


def _execute_probe(args: argparse.Namespace) -> dict:
    variables = epm_home.build_home_project_update_variables(args.project_id, args.text)
    payload = {
        "query": epm_home.HOME_PROJECT_UPDATE_MUTATION,
        "variables": variables,
    }
    request = Request(
        args.endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": _basic_authorization(args.email, args.api_token),
            "X-ExperimentalApi": "Townsquare",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=epm_home.HOME_TIMEOUT_SECONDS) as response:
            status = int(getattr(response, "status", response.getcode()))
            response_payload = _decode_response(response.read())
    except HTTPError as exc:
        status = int(exc.code)
        response_payload = _decode_response(exc.read())
    except (OSError, ValueError) as exc:
        return {
            "decision": "fail",
            "reason": "home_project_update_unsupported",
            "status": 0,
            "error": str(exc),
        }

    result = ((response_payload.get("data") or {}).get("projects_createUpdate") or {})
    update = result.get("update") if isinstance(result, dict) else None
    if 200 <= status < 300 and isinstance(result, dict) and result.get("success") is True and isinstance(update, dict):
        return {
            "decision": "pass",
            "reason": "home_project_update_supported",
            "status": status,
            "update": {
                "id": update.get("id"),
                "creationDate": update.get("creationDate"),
                "updateType": update.get("updateType"),
            },
        }

    return {
        "decision": "fail",
        "reason": "home_project_update_unsupported",
        "status": status,
        "errors": response_payload.get("errors") or result.get("errors") or [],
    }


def _write_output(path_value: str, payload: dict) -> None:
    output_path = Path(path_value).expanduser()
    if not output_path.is_absolute():
        output_path = Path.cwd() / output_path
    resolved = output_path.resolve()
    try:
        resolved.relative_to(REPO_ROOT)
    except ValueError:
        pass
    else:
        raise RuntimeError("write_probe_output_must_be_outside_repo")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    redacted = epm_home.redact_home_write_probe_payload(payload)
    with open(resolved, "w", encoding="utf-8") as handle:
        json.dump(redacted, handle, indent=2, sort_keys=True)
        handle.write("\n")


def main() -> int:
    args = _load_args()
    if not _has_required_input(args):
        print(RESULT_INSUFFICIENT_INPUT)
        return 1

    result = _execute_probe(args)
    if args.output:
        try:
            _write_output(args.output, result)
        except RuntimeError:
            print(RESULT_INSUFFICIENT_INPUT)
            return 1

    if result.get("decision") == "pass":
        print(RESULT_PASS)
        return 0
    print(RESULT_UNSUPPORTED)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
