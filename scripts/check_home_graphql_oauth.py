#!/usr/bin/env python3
"""Validate a saved Home GraphQL OAuth feasibility probe response."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.epm import home as epm_home  # noqa: E402


SENSITIVE_KEYS = {
    "access_token",
    "refresh_token",
    "authorization",
    "client_secret",
    "code",
    "oauth_code",
    "oauth_pkce_verifier",
    "pkce_verifier",
}


def contains_token_material(value) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).strip().lower() in SENSITIVE_KEYS:
                return True
            if contains_token_material(item):
                return True
        return False
    if isinstance(value, list):
        return any(contains_token_material(item) for item in value)
    if isinstance(value, str):
        return "bearer " in value.lower()
    return False


def classify_probe_payload(payload: dict) -> dict:
    if payload.get("decision") and payload.get("reason"):
        return {"decision": payload["decision"], "reason": payload["reason"]}
    return epm_home.classify_home_graphql_probe_results(payload.get("results") or [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default="http://localhost:5050",
        help="Local Flask server URL to print when --input is omitted.",
    )
    parser.add_argument(
        "--input",
        help="Path to JSON saved from /api/auth/dev/home-graphql-oauth-probe.",
    )
    args = parser.parse_args()

    probe_url = f"{args.base_url.rstrip('/')}/api/auth/dev/home-graphql-oauth-probe"
    if not args.input:
        print(f"Open after OAuth login: {probe_url}")
        print("Then save the JSON response and rerun with --input /tmp/home-graphql-oauth-probe.json")
        return 0

    with open(args.input, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if contains_token_material(payload):
        print("FAIL token_material_exposed")
        return 1
    decision = classify_probe_payload(payload if isinstance(payload, dict) else {})
    prefix = "PASS" if decision.get("decision") == "pass" else "FAIL"
    print(f"{prefix} {decision.get('reason', 'home_graphql_probe_failed')}")
    return 0 if prefix == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
