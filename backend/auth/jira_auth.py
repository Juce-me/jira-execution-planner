import base64
import hashlib
import secrets
import time
from contextlib import nullcontext
from dataclasses import dataclass
from urllib.parse import urlencode

import requests


AUTH_MODE_BASIC = "basic"
AUTH_MODE_ATLASSIAN_OAUTH = "atlassian_oauth"
ATLASSIAN_AUTHORIZE_URL = "https://auth.atlassian.com/authorize"
ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token"
ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"
ATLASSIAN_API_BASE = "https://api.atlassian.com"
TOKEN_EXPIRY_BUFFER_SECONDS = 60


class AuthError(Exception):
    def __init__(self, code, message=None):
        self.code = code
        self.message = message or code
        super().__init__(self.message)


@dataclass
class AuthConfig:
    auth_mode: str = AUTH_MODE_BASIC
    jira_url: str = ""
    jira_email: str = ""
    jira_token: str = ""
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = ""
    scopes: str = "read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access"
    flask_secret_key: str = ""


def normalize_site_url(value):
    return (value or "").strip().rstrip("/")


def validate_auth_config(config):
    if not normalize_site_url(config.jira_url):
        raise AuthError("missing_jira_url", "JIRA_URL is required.")
    if config.auth_mode == AUTH_MODE_BASIC:
        if not config.jira_email or not config.jira_token:
            raise AuthError("missing_basic_auth", "Jira email and API token are required for basic auth.")
        return
    if config.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
        if not config.client_id or not config.client_secret or not config.redirect_uri:
            raise AuthError("missing_oauth_config", "Atlassian OAuth client ID, client secret, and redirect URI are required.")
        if not config.flask_secret_key:
            raise AuthError("missing_flask_secret_key", "FLASK_SECRET_KEY is required for Atlassian OAuth.")
        return
    raise AuthError("invalid_auth_mode", "Unsupported auth mode.")


def oauth_scope_set(scopes):
    if isinstance(scopes, str):
        return {scope for scope in scopes.split() if scope}
    if isinstance(scopes, (list, tuple, set)):
        return {str(scope).strip() for scope in scopes if str(scope).strip()}
    return set()


def missing_oauth_scopes(session_data, required_scopes):
    granted = oauth_scope_set((session_data or {}).get("scope") or (session_data or {}).get("granted_scopes"))
    required = oauth_scope_set(required_scopes)
    if not granted:
        return required
    return required - granted


def new_oauth_state():
    return secrets.token_urlsafe(32)


def new_pkce_verifier():
    return secrets.token_urlsafe(64)


def build_pkce_challenge(verifier):
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def build_authorize_url(config, state, code_challenge=None, force_consent=False):
    if not code_challenge:
        raise AuthError("missing_pkce_challenge", "PKCE code challenge is required.")
    params = {
        "audience": "api.atlassian.com",
        "client_id": config.client_id,
        "scope": config.scopes,
        "redirect_uri": config.redirect_uri,
        "state": state,
        "response_type": "code",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if force_consent:
        params["prompt"] = "consent"
    return f"{ATLASSIAN_AUTHORIZE_URL}?{urlencode(params)}"


def _usable_expires_in(value):
    try:
        expires_in = int(value)
    except (TypeError, ValueError):
        return None
    if expires_in <= 0:
        return None
    return expires_in


def _response_json(response, expected_type, code, message):
    try:
        payload = response.json()
    except ValueError as exc:
        raise AuthError(code, message) from exc
    if not isinstance(payload, expected_type):
        raise AuthError(code, message)
    return payload


def exchange_authorization_code(config, code, code_verifier=None, http_post=requests.post):
    if not code_verifier:
        raise AuthError("missing_pkce_verifier", "PKCE code verifier is required.")
    payload = {
        "grant_type": "authorization_code",
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "code": code,
        "redirect_uri": config.redirect_uri,
        "code_verifier": code_verifier,
    }
    try:
        response = http_post(
            ATLASSIAN_TOKEN_URL,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise AuthError("oauth_exchange_failed", "Failed to exchange Atlassian authorization code.") from exc
    if response.status_code != 200:
        raise AuthError("oauth_exchange_failed", "Failed to exchange Atlassian authorization code.")
    token_data = _response_json(response, dict, "oauth_exchange_failed", "Failed to exchange Atlassian authorization code.")
    if not token_data.get("access_token") or not token_data.get("refresh_token") or _usable_expires_in(token_data.get("expires_in")) is None:
        raise AuthError("oauth_exchange_failed", "Failed to exchange Atlassian authorization code.")
    return token_data


def fetch_current_user(access_token, http_get=requests.get):
    try:
        response = http_get(
            f"{ATLASSIAN_API_BASE}/me",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise AuthError("user_identity_failed", "Failed to fetch Atlassian user identity.") from exc
    if response.status_code != 200:
        raise AuthError("user_identity_failed", "Failed to fetch Atlassian user identity.")
    return _response_json(response, dict, "user_identity_failed", "Failed to fetch Atlassian user identity.")


def fetch_accessible_resources(access_token, http_get=requests.get):
    try:
        response = http_get(
            ATLASSIAN_RESOURCES_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise AuthError("accessible_resources_failed", "Failed to fetch Atlassian accessible resources.") from exc
    if response.status_code != 200:
        raise AuthError("accessible_resources_failed", "Failed to fetch Atlassian accessible resources.")
    return _response_json(response, list, "accessible_resources_failed", "Failed to fetch Atlassian accessible resources.")


def choose_accessible_resource(resources, jira_url):
    normalized_jira_url = normalize_site_url(jira_url)
    for resource in resources or []:
        if not isinstance(resource, dict):
            raise AuthError("accessible_resources_failed", "Malformed Atlassian accessible resources response.")
        resource_url = resource.get("url")
        if resource_url and not isinstance(resource_url, str):
            raise AuthError("accessible_resources_failed", "Malformed Atlassian accessible resources response.")
        if normalize_site_url(resource_url) == normalized_jira_url:
            return resource
    raise AuthError("jira_site_not_accessible", "Configured Jira site is not accessible with this Atlassian account.")


def token_session_payload(token_data, resource, user_profile=None):
    user_profile = user_profile or {}
    now = int(time.time())
    expires_in = int(token_data.get("expires_in") or 0)
    return {
        "access_token": token_data.get("access_token"),
        "refresh_token": token_data.get("refresh_token"),
        "expires_at": now + expires_in,
        "scope": token_data.get("scope") or "",
        "cloudid": resource.get("id"),
        "site_url": normalize_site_url(resource.get("url")),
        "site_name": resource.get("name"),
        "account_id": user_profile.get("account_id"),
        "account_status": user_profile.get("account_status"),
        "email": user_profile.get("email"),
        "display_name": user_profile.get("display_name") or user_profile.get("name"),
    }


def is_oauth_token_expired(session_data):
    expires_at = int((session_data or {}).get("expires_at") or 0)
    return expires_at <= int(time.time()) + TOKEN_EXPIRY_BUFFER_SECONDS


def refresh_oauth_token(config, session_data, http_post=requests.post):
    refresh_token = (session_data or {}).get("refresh_token")
    if not refresh_token:
        raise AuthError("auth_required", "Atlassian authentication is required.")
    payload = {
        "grant_type": "refresh_token",
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "refresh_token": refresh_token,
    }
    try:
        response = http_post(
            ATLASSIAN_TOKEN_URL,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise AuthError("auth_required", "Atlassian authentication is required.") from exc
    if response.status_code != 200:
        raise AuthError("auth_required", "Atlassian authentication is required.")
    token_data = _response_json(response, dict, "auth_required", "Atlassian authentication is required.")
    expires_in = _usable_expires_in(token_data.get("expires_in"))
    if not token_data.get("access_token") or expires_in is None:
        raise AuthError("auth_required", "Atlassian authentication is required.")
    merged = dict(session_data or {})
    merged["access_token"] = token_data.get("access_token")
    merged["refresh_token"] = token_data.get("refresh_token") or refresh_token
    merged["expires_at"] = int(time.time()) + expires_in
    merged["scope"] = token_data.get("scope") or merged.get("scope")
    return merged


def ensure_oauth_token(
    config,
    session_data,
    save_session,
    http_post=requests.post,
    reload_session=None,
    refresh_lock=None,
):
    if config.auth_mode != AUTH_MODE_ATLASSIAN_OAUTH:
        return session_data
    if not session_data.get("access_token"):
        raise AuthError("auth_required", "Atlassian authentication is required.")
    if not is_oauth_token_expired(session_data):
        return session_data
    lock = refresh_lock or nullcontext()
    with lock:
        active_session = reload_session() if reload_session else session_data
        if not active_session.get("access_token"):
            raise AuthError("auth_required", "Atlassian authentication is required.")
        if not is_oauth_token_expired(active_session):
            return active_session
        refreshed = refresh_oauth_token(config, active_session, http_post=http_post)
        if reload_session and not (reload_session() or {}).get("access_token"):
            raise AuthError("auth_required", "Atlassian authentication is required.")
        save_session(refreshed)
        return refreshed


def build_jira_headers(config, session_data):
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if config.auth_mode == AUTH_MODE_BASIC:
        token = base64.b64encode(f"{config.jira_email}:{config.jira_token}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {token}"
        return headers
    if config.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
        access_token = (session_data or {}).get("access_token")
        if not access_token:
            raise AuthError("auth_required", "Atlassian authentication is required.")
        headers["Authorization"] = f"Bearer {access_token}"
        return headers
    raise AuthError("invalid_auth_mode", "Unsupported auth mode.")


def build_jira_api_url(config, context, path):
    normalized_path = path if path.startswith("/") else f"/{path}"
    if config.auth_mode == AUTH_MODE_BASIC:
        return f"{normalize_site_url(config.jira_url)}{normalized_path}"
    if config.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
        if not context.cloud_id:
            raise AuthError("auth_required", "Atlassian authentication is required.")
        return f"{ATLASSIAN_API_BASE}/ex/jira/{context.cloud_id}{normalized_path}"
    raise AuthError("invalid_auth_mode", "Unsupported auth mode.")


def jira_get(
    config,
    context,
    session_data,
    path,
    http_get=requests.get,
    save_session=None,
    reload_session=None,
    refresh_lock=None,
    refresh_http_post=requests.post,
    **kwargs,
):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(
        config,
        session_data,
        save_session,
        http_post=refresh_http_post,
        reload_session=reload_session,
        refresh_lock=refresh_lock,
    )
    return http_get(
        build_jira_api_url(config, context, path),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )


def jira_post(
    config,
    context,
    session_data,
    path,
    http_post=requests.post,
    save_session=None,
    reload_session=None,
    refresh_lock=None,
    refresh_http_post=requests.post,
    **kwargs,
):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(
        config,
        session_data,
        save_session,
        http_post=refresh_http_post,
        reload_session=reload_session,
        refresh_lock=refresh_lock,
    )
    return http_post(
        build_jira_api_url(config, context, path),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )


def jira_request(
    config,
    context,
    session_data,
    method,
    path,
    http_request,
    save_session=None,
    reload_session=None,
    refresh_lock=None,
    refresh_http_post=requests.post,
    **kwargs,
):
    save_session = save_session or (lambda data: None)
    active_session = ensure_oauth_token(
        config,
        session_data,
        save_session,
        http_post=refresh_http_post,
        reload_session=reload_session,
        refresh_lock=refresh_lock,
    )
    return http_request(
        method,
        build_jira_api_url(config, context, path),
        headers=build_jira_headers(config, active_session),
        **kwargs,
    )
