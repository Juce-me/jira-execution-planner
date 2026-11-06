"""Real DB OAuth setup for ordinary API/service tests; no legacy principal."""

import os
from unittest.mock import patch

from flask import session

from backend.auth.db_context import invalidate_auth_status_cache
from backend.db import engine as db_engine, models
from backend.epm.home import EPM_HOME_READ_SCOPES
from tests.db_oauth_test_helpers import seed_db_actor, FULL_OAUTH_SCOPE
from tests.postgres_test_db import fresh_database_url


def force_db_oauth_mode(test_case, jira_server):
    url = fresh_database_url(test_case.addCleanup)
    for patcher in (
        patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'),
        patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'),
        patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': url, 'TEST_DATABASE_URL': url}),
    ):
        patcher.start()
        test_case.addCleanup(patcher.stop)
    engine = db_engine.get_engine(url)
    models.Base.metadata.create_all(engine)
    with db_engine.session_scope(url) as db:
        actor = seed_db_actor(db, workspace={'cloud_id': 'synthetic-cloud', 'site_url': jira_server.JIRA_URL},
                              account_identity='synthetic-ordinary-user', roles=('admin',))
        connection = db.get(models.AuthConnection, actor.connection_id)
        connection.scopes = list(dict.fromkeys(FULL_OAUTH_SCOPE.split() + list(EPM_HOME_READ_SCOPES)))
        db.add(models.ViewConfig(workspace_id=actor.workspace_id, owner_user_id=actor.user_id,
                                 name='Synthetic default', view_type='mixed', is_default=True,
                                 payload={'epm': {'viewEnabled': True}}))
        db.add(models.WorkspaceDashboardConfig(workspace_id=actor.workspace_id,
                                               payload={'projects': {'selected': ['SYN']}, 'board': {'boardId': '42'}},
                                               created_by=actor.user_id, updated_by=actor.user_id))
    test_case.db_actor = actor
    request_context = jira_server.app.test_request_context('/')
    request_context.push()
    session['db_oauth_session'] = actor.session_payload
    test_case.addCleanup(request_context.pop)
    original_context = jira_server.app.test_request_context

    def authenticated_context(*args, **kwargs):
        context = original_context(*args, **kwargs)
        original_push = context.push

        def push():
            original_push()
            session['db_oauth_session'] = actor.session_payload
        context.push = push
        return context

    patcher = patch.object(jira_server.app, 'test_request_context', side_effect=authenticated_context)
    patcher.start()
    test_case.addCleanup(patcher.stop)
    original_client = jira_server.app.test_client

    def authenticated_client(*args, **kwargs):
        client = original_client(*args, **kwargs)
        with client.session_transaction() as cookie:
            cookie['db_oauth_session'] = actor.session_payload
        original_open = client.open

        def open_with_csrf(*open_args, **open_kwargs):
            method = open_kwargs.get('method', 'GET').upper()
            if method not in {'GET', 'HEAD', 'OPTIONS'}:
                headers = dict(open_kwargs.get('headers') or {})
                token = original_open('/api/auth/csrf', method='GET', headers={'X-Requested-With': 'jira-execution-planner'}).get_json().get('csrfToken')
                headers.setdefault('X-Requested-With', 'jira-execution-planner')
                headers.setdefault('X-CSRF-Token', token)
                open_kwargs['headers'] = headers
            return original_open(*open_args, **open_kwargs)
        client.open = open_with_csrf
        return client

    patcher = patch.object(jira_server.app, 'test_client', side_effect=authenticated_client)
    patcher.start()
    test_case.addCleanup(patcher.stop)
    test_case.addCleanup(invalidate_auth_status_cache)
    test_case.addCleanup(db_engine.dispose_engines)
