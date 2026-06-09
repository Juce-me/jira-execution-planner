import threading
import time

from flask import session

import jira_server


FULL_OAUTH_SCOPE = (
    "read:me read:jira-work read:jira-user "
    "read:board-scope:jira-software read:sprint:jira-software read:project:jira "
    "offline_access"
)


def oauth_session_payload(**overrides):
    payload = {
        "access_token": "access-123",
        "refresh_token": "refresh-123",
        "expires_at": 9999999999,
        "cloudid": "cloud-123",
        "site_url": "https://example.atlassian.net",
        "site_name": "Example",
        "account_id": "account-123",
        "account_status": "active",
        "scope": FULL_OAUTH_SCOPE,
        "stored_at": time.time(),
    }
    payload.update(overrides)
    return payload


def install_oauth_session(client, session_id="session-1", **overrides):
    with client.session_transaction() as flask_session:
        flask_session["atlassian_oauth_session_id"] = session_id
        connection_id = str(overrides.get("db_auth_connection_id") or "").strip()
        if connection_id:
            flask_session["db_oauth_session"] = {"db_auth_connection_id": connection_id}
            token_version = str(overrides.get("db_token_version") or "").strip()
            if token_version:
                flask_session["db_oauth_session"]["db_token_version"] = token_version
    jira_server.OAUTH_TOKEN_STORE[session_id] = oauth_session_payload(**overrides)
    jira_server.OAUTH_REFRESH_LOCKS.setdefault(session_id, threading.Lock())


def push_oauth_request(app, path="/", session_id="session-1", **overrides):
    request_context = app.test_request_context(path)
    request_context.push()
    session["atlassian_oauth_session_id"] = session_id
    jira_server.OAUTH_TOKEN_STORE[session_id] = oauth_session_payload(**overrides)
    jira_server.OAUTH_REFRESH_LOCKS.setdefault(session_id, threading.Lock())
    return request_context
