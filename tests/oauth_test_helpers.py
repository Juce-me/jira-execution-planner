import time
import os
from datetime import datetime, timezone
from unittest.mock import patch

from flask import session

from backend.auth.db_browser_sessions import create_browser_session
from backend.auth.db_context import invalidate_auth_status_cache
from backend.db import engine as db_engine, models
from tests.db_oauth_test_helpers import seed_db_actor
from tests.postgres_test_db import fresh_database_url

import jira_server


FULL_OAUTH_SCOPE = (
    "read:me read:jira-work write:jira-work read:jira-user "
    "read:board-scope:jira-software read:sprint:jira-software read:project:jira "
    "offline_access"
)


def set_up_db_oauth(testcase):
    """Own a disposable database without signing in or bypassing request guards."""
    url = fresh_database_url(testcase.addCleanup)
    for patcher in (
        patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': url,
                                'TEST_DATABASE_URL': url}),
        patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'),
    ):
        patcher.start()
        testcase.addCleanup(patcher.stop)
    models.Base.metadata.create_all(db_engine.get_engine(url))
    testcase.addCleanup(db_engine.dispose_engines)
    testcase.addCleanup(invalidate_auth_status_cache)
    return url


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
        "scope_provenance": "provider",
        "stored_at": time.time(),
    }
    payload.update(overrides)
    return payload


def _db_session_payload(**overrides):
    """Persist actual identity; never interpret a legacy session label as authority."""
    payload = oauth_session_payload(**overrides)
    engine = db_engine.get_engine()
    models.Base.metadata.create_all(engine)
    with db_engine.session_scope() as db:
        connection_id = str(overrides.get('db_auth_connection_id') or '').strip()
        if connection_id:
            connection = db.get(models.AuthConnection, connection_id)
            if connection is None:
                raise ValueError('Fixture DB auth connection does not exist.')
            browser = create_browser_session(db, user_id=connection.user_id,
                                             workspace_id=connection.workspace_id,
                                             auth_connection_id=connection.id)
            result = {'db_browser_session_id': browser.id}
        else:
            actor = seed_db_actor(
                db, workspace={'cloud_id': payload['cloudid'], 'site_url': payload['site_url']},
                account_identity={'account_id': payload['account_id'],
                                  'account_status': payload['account_status']},
                roles=overrides.get('roles', ()),
                token_data={'access_token': payload['access_token'],
                            'refresh_token': payload['refresh_token'],
                            'expires_in': max(1, int(payload['expires_at'] - time.time())),
                            'scope': payload['scope']},
            )
            connection = db.get(models.AuthConnection, actor.connection_id)
            connection.scope_provenance = payload['scope_provenance']
            connection.expires_at = datetime.fromtimestamp(payload['expires_at'], timezone.utc)
            result = actor.session_payload
    invalidate_auth_status_cache()
    return result


def install_oauth_session(client, session_id="session-1", **overrides):
    # session_id remains an ignored label for old call sites, never an identity key.
    payload = _db_session_payload(**overrides)
    with client.session_transaction() as flask_session:
        flask_session.pop('atlassian_oauth_session_id', None)
        flask_session['db_oauth_session'] = payload
    return payload


def forbid_jira_http(testcase):
    """Fail the test if the flow under test reaches Jira: no current_jira_request and no HTTP verb."""
    for target, name in (
        (jira_server, "current_jira_request"),
        (jira_server.HTTP_SESSION, "post"),
        (jira_server.HTTP_SESSION, "put"),
        (jira_server.HTTP_SESSION, "delete"),
        (jira_server.HTTP_SESSION, "request"),
    ):
        patcher = patch.object(target, name, side_effect=AssertionError(f"{name} must not be called"))
        patcher.start()
        testcase.addCleanup(patcher.stop)


def push_oauth_request(app, path="/", session_id="session-1", **overrides):
    payload = _db_session_payload(**overrides)
    request_context = app.test_request_context(path)
    request_context.push()
    session['db_oauth_session'] = payload
    return request_context
