import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.db import engine as db_engine
from backend.db import models
import jira_server


FULL_SCOPE = (
    'read:me read:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


def _assert_bootstrap_returns_resolved_view_with_source_metadata():
    jira_server.app.config['TESTING'] = True
    jira_server.app.secret_key = 'test-secret'
    jira_server.OAUTH_TOKEN_STORE.clear()
    jira_server.OAUTH_REFRESH_LOCKS.clear()
    client = jira_server.app.test_client()
    tmpdir = tempfile.TemporaryDirectory()
    try:
        database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir.name, 'bootstrap-config.db')}"
        db_engine.get_engine(database_url)
        models.Base.metadata.create_all(db_engine.get_engine(database_url))
        factory = db_engine.session_factory(database_url)
        with factory() as session:
            user = models.User(
                external_provider='atlassian',
                external_subject='normal-account',
                account_type='user',
                status='active',
                created_by='test',
            )
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            session.add_all([user, workspace])
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url=workspace.jira_site_url,
                cloud_id=workspace.jira_cloud_id,
                scopes=FULL_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            view = models.ViewConfig(
                workspace_id=workspace.id,
                owner_user_id=user.id,
                name='Default EPM',
                view_type='epm',
                payload={
                    'filters': {'projectKeys': ['PROD']},
                    'epm': {
                        'tab': 'active',
                        'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['GOAL-2']},
                        'labelPrefix': 'rnd_project_*',
                        'selectedSprint': 'Active',
                        'projects': {
                            'home-1': {
                                'homeProjectId': 'home-1',
                                'name': 'Synthetic Project',
                                'label': 'rnd_project_synthetic',
                            },
                        },
                    },
                },
                is_default=True,
            )
            session.add_all([connection, view])
            session.commit()
            workspace_id = workspace.id
            view_id = view.id
            connection_id = connection.id

        with client.session_transaction() as flask_session:
            flask_session['atlassian_oauth_session_id'] = 'session-normal'
        jira_server.OAUTH_TOKEN_STORE['session-normal'] = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 3600,
            'scope': FULL_SCOPE,
            'cloudid': 'cloud-1',
            'site_url': 'https://example.atlassian.net',
            'account_id': 'normal-account',
            'account_status': 'active',
            'db_auth_connection_id': connection_id,
            'db_token_version': '1',
            'stored_at': time.time(),
        }

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': database_url,
        }, clear=False), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'get_board_config', return_value={}), \
             patch.object(jira_server, 'get_effective_capacity_project', return_value=''), \
             patch.object(jira_server, 'resolve_groups_config_path', return_value='team-groups.json'), \
             patch.object(jira_server, 'get_selected_projects', return_value=['PROD']):
            response = client.get('/api/config?includeViewConfig=true')

        assert response.status_code == 200, response.get_data(as_text=True)
        body = response.get_json()
        assert body['epm']['projects']['home-1']['label'] == 'rnd_project_synthetic'
        assert body['viewConfig']['source'] == 'user_saved_view'
        assert body['viewConfig']['workspaceId'] == workspace_id
        assert body['viewConfig']['viewConfigId'] == view_id
        assert body['viewConfig']['viewType'] == 'epm'
        assert body['viewConfig']['view']['epm']['selectedSprint'] == 'Active'
    finally:
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        tmpdir.cleanup()


class DashboardBootstrapConfigSourceTests(unittest.TestCase):
    def test_bootstrap_returns_resolved_view_with_source_metadata(self):
        _assert_bootstrap_returns_resolved_view_with_source_metadata()


def test_bootstrap_returns_resolved_view_with_source_metadata():
    return unittest.defaultTestLoader.loadTestsFromTestCase(DashboardBootstrapConfigSourceTests)
