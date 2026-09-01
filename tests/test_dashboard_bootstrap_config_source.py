import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.db import engine as db_engine
from backend.db import models
import jira_server


FULL_SCOPE = (
    'read:me read:jira-work write:jira-work read:jira-user '
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
                scope_provenance='provider',
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
            flask_session['db_oauth_session'] = {
                'db_auth_connection_id': connection_id,
                'db_token_version': '1',
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

    def test_bootstrap_reports_shared_capacity_config_state(self):
        jira_server.app.config['TESTING'] = True
        client = jira_server.app.test_client()
        common = {
            'get_board_config': {},
            'resolve_groups_config_path': 'team-groups.json',
            'get_selected_projects': [],
            'get_epm_config': {'version': 2},
        }
        cases = [
            ({'project': 'CAP', 'mutationEnabled': True, 'requiresResolution': False}, 'CAP', False, True),
            ({'project': '', 'mutationEnabled': False, 'requiresResolution': False}, '', False, False),
            ({'project': '', 'mutationEnabled': False, 'requiresResolution': True}, '', True, False),
        ]
        for capacity_config, project, requires_resolution, mutation_enabled in cases:
            with self.subTest(capacity_config=capacity_config), \
                 patch.object(jira_server, 'load_request_capacity_config', return_value=capacity_config), \
                 patch.object(jira_server, 'get_effective_capacity_project', side_effect=AssertionError('legacy capacity resolver must not be used')), \
                 patch.object(jira_server, 'get_board_config', return_value=common['get_board_config']), \
                 patch.object(jira_server, 'resolve_groups_config_path', return_value=common['resolve_groups_config_path']), \
                 patch.object(jira_server, 'get_selected_projects', return_value=common['get_selected_projects']), \
                 patch.object(jira_server, 'get_epm_config', return_value=common['get_epm_config']), \
                 patch.object(jira_server, 'load_dashboard_config', return_value={}):
                response = client.get('/api/config')
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            body = response.get_json()
            self.assertEqual(body['capacityProject'], project)
            self.assertEqual(body['capacityConfigRequiresResolution'], requires_resolution)
            self.assertEqual(body['capacityMutationEnabled'], mutation_enabled)

    def test_bootstrap_maps_capacity_config_storage_error_to_safe_response(self):
        jira_server.app.config['TESTING'] = True
        client = jira_server.app.test_client()
        with patch.object(jira_server, 'load_request_capacity_config', side_effect=jira_server.ConfigStorageError('synthetic-secret-like-value')):
            response = client.get('/api/config')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        })


def test_bootstrap_returns_resolved_view_with_source_metadata():
    return unittest.defaultTestLoader.loadTestsFromTestCase(DashboardBootstrapConfigSourceTests)
