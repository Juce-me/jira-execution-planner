"""Retirement boundary for the former pre-DB shared-settings runtime.

Supported DB settings journeys are covered by test_oauth_settings_routes,
test_shared_group_config_routes, test_board_config_api and test_epm_config_api.
This file retains the old route inventory as fail-closed admission coverage.
"""
import unittest
from unittest.mock import patch

import jira_server
from backend.db import engine as db_engine, models
from tests.oauth_test_helpers import install_oauth_session, set_up_db_oauth


class RetiredPreDbSettingsTests(unittest.TestCase):
    ROUTES = (
        '/api/projects/selected', '/api/board-config', '/api/capacity/config',
        '/api/sprint-field/config', '/api/story-points-field/config',
        '/api/parent-name-field/config', '/api/team-field/config',
        '/api/stats/priority-weights-config', '/api/issue-types/config',
        '/api/epm/config', '/api/groups-config', '/api/team-catalog',
    )

    def setUp(self):
        set_up_db_oauth(self)
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'synthetic-retirement-session'
        self.client = jira_server.app.test_client()

    def headers(self):
        response = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 200)
        return {'X-Requested-With': 'jira-execution-planner',
                'X-CSRF-Token': response.get_json()['csrfToken']}

    def test_retired_runtime_cannot_admit_any_former_settings_write(self):
        install_oauth_session(self.client, roles=('admin',))
        headers = self.headers()
        with patch.object(jira_server, 'save_dashboard_config') as save, \
             patch.object(jira_server, 'save_team_catalog_file') as catalog, \
             patch.object(jira_server, 'current_jira_request') as jira:
            for auth, storage, expected in (
                ('atlassian_oauth', 'jsonfile', 'runtime_storage_unsupported'),
                ('basic', 'db', 'runtime_auth_unsupported'),
            ):
                with patch.object(jira_server, 'JIRA_AUTH_MODE', auth), \
                     patch.dict('os.environ', {'CONFIG_STORAGE_BACKEND': storage}):
                    for route in self.ROUTES:
                        with self.subTest(auth=auth, storage=storage, route=route):
                            # Rejection precedes body parsing, CSRF or storage.
                            response = self.client.post(route, data='not json',
                                content_type='application/json', headers=headers)
                            self.assertEqual(response.status_code, 503)
                            self.assertEqual(response.get_json()['error'], expected)
            save.assert_not_called()
            catalog.assert_not_called()
            jira.assert_not_called()
        with db_engine.session_scope() as db:
            self.assertEqual(db.query(models.WorkspaceDashboardConfig).count(), 0)
            self.assertEqual(db.query(models.WorkspaceGroupConfig).count(), 0)
            self.assertEqual(db.query(models.ViewConfig).count(), 0)

    def test_legacy_bootstrap_admin_environment_cannot_elevate_a_db_user(self):
        install_oauth_session(self.client, account_id='synthetic-regular-user')
        with patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True), \
             patch.dict('os.environ', {'TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS': 'synthetic-regular-user'}):
            response = self.client.post('/api/board-config',
                json={'boardId': '7', 'boardName': 'Synthetic', 'baseRevision': 0},
                headers=self.headers())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'admin_required')
        with db_engine.session_scope() as db:
            self.assertEqual(db.query(models.WorkspaceDashboardConfig).count(), 0)

    def test_anonymous_shared_write_keeps_same_tab_recovery(self):
        response = self.client.post('/api/board-config', json={'boardId': '7'},
            headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertEqual(response.get_json()['loginUrl'], '/login?reason=session_expired')
