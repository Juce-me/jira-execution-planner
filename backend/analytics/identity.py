"""Pseudonymous GA4 user identity helpers."""

import base64
import hashlib
import hmac


PER_USER_AUTH_MODES = {"atlassian_oauth", "db_oauth"}


def pseudonymous_ga4_user_id(pepper, stable_subject):
    digest = hmac.new(
        str(pepper).encode("utf-8"),
        f"user:{stable_subject}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def ga4_user_id_for_context(config, auth_context):
    if not getattr(config, "enabled", False):
        return None
    stable_subject = str(getattr(auth_context, "stable_subject", "") or "").strip()
    if not stable_subject or stable_subject == "local-basic":
        return None
    auth_mode = str(getattr(auth_context, "auth_mode", "") or "").strip()
    if auth_mode not in PER_USER_AUTH_MODES:
        return None
    return pseudonymous_ga4_user_id(config.user_id_pepper, stable_subject)
