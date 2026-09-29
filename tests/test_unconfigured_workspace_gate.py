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


class UnconfiguredWorkspaceGateTests(unittest.TestCase):
    """`/api/config` reports missing administrator settings for DB/OAuth sessions only."""

    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.addCleanup(db_engine.dispose_engines)
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'gate.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local', name='Synthetic', jira_site_url='https://synthetic.example.test',
                jira_cloud_id='synthetic-cloud', created_by='test',
            )
            other_workspace = models.Workspace(
                environment_key='local', name='Other', jira_site_url='https://other.example.test',
                jira_cloud_id='other-cloud', created_by='test',
            )
            session.add_all([workspace, other_workspace])
            session.flush()
            self.workspace_id = workspace.id
            self.connection_ids = {}
            people = [
                ('caller-user', 'user', 'active', 'Caller User', workspace),
                ('caller-admin', 'admin', 'active', 'Zed Admin', workspace),
                ('second-admin', 'admin', 'active', 'Alice Admin', workspace),
                ('deleted-admin', 'admin', 'deleted', 'Deleted Admin', workspace),
                ('nameless-admin', 'admin', 'active', None, workspace),
                ('foreign-admin', 'admin', 'active', 'Foreign Admin', other_workspace),
            ]
            for subject, account_type, status, display_name, owner in people:
                user = models.User(
                    external_provider='atlassian', external_subject=subject,
                    account_type=account_type, status=status, display_name=display_name,
                    email=f'{subject}@example.test', created_by='test',
                )
                session.add(user)
                session.flush()
                connection = models.AuthConnection(
                    user_id=user.id, workspace_id=owner.id, provider='atlassian_oauth',
                    site_url=owner.jira_site_url, cloud_id=owner.jira_cloud_id,
                    scopes=FULL_SCOPE.split(), scope_provenance='provider', status='active',
                    token_version=1, expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                )
                session.add(connection)
                session.flush()
                self.connection_ids[subject] = connection.id
            session.commit()

    def _set_workspace_payload(self, payload):
        with self.factory() as session:
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=self.workspace_id, payload_version=1, config_revision=1, payload=payload,
            ))
            session.commit()

    def _get_config(self, subject, *, jql_query='', board_id_env=''):
        client = jira_server.app.test_client()
        with client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {
                'db_auth_connection_id': self.connection_ids[subject],
                'db_token_version': '1',
            }
        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
        }, clear=False), \
                patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                patch.object(jira_server, 'JQL_QUERY', jql_query), \
                patch.object(jira_server, 'JIRA_BOARD_ID', board_id_env), \
                patch.object(jira_server, 'JIRA_URL', ''), \
                patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True), \
                patch.object(jira_server, 'get_effective_capacity_project', return_value=''), \
                patch.object(jira_server, 'resolve_groups_config_path', return_value='team-groups.json'):
            response = client.get('/api/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()

    def test_configured_workspace_reports_nothing_missing_and_no_admin_contacts(self):
        self._set_workspace_payload({
            'board': {'boardId': '17', 'boardName': 'Synthetic Board'},
            'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
        })

        body = self._get_config('caller-user')

        self.assertEqual(body['adminSettingsMissing'], [])
        self.assertNotIn('adminContacts', body)

    def test_dropped_settings_list_admin_display_names_for_non_admin(self):
        self._set_workspace_payload({})

        body = self._get_config('caller-user')

        self.assertEqual(body['adminSettingsMissing'], ['scope', 'source'])
        self.assertEqual(body['adminContacts'], ['Alice Admin', 'Zed Admin'])
        self.assertNotIn('example.test', repr(body['adminContacts']))
        self.assertFalse(body['userIsToolAdmin'])

    def test_workspace_without_saved_row_is_unconfigured(self):
        body = self._get_config('caller-user')

        self.assertEqual(body['adminSettingsMissing'], ['scope', 'source'])
        self.assertEqual(body['adminContacts'], ['Alice Admin', 'Zed Admin'])

    def test_admin_caller_gets_missing_sections_without_admin_contacts(self):
        self._set_workspace_payload({'board': {'boardId': ''}})

        body = self._get_config('caller-admin')

        self.assertEqual(body['adminSettingsMissing'], ['scope', 'source'])
        self.assertNotIn('adminContacts', body)
        self.assertTrue(body['userIsToolAdmin'])

    def test_only_missing_board_is_reported_when_projects_exist(self):
        self._set_workspace_payload({'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]}})

        body = self._get_config('caller-user')

        self.assertEqual(body['adminSettingsMissing'], ['source'])

    def test_environment_jql_and_board_satisfy_scope_and_source(self):
        self._set_workspace_payload({})

        body = self._get_config('caller-user', jql_query='project = PROD', board_id_env='17')

        self.assertEqual(body['adminSettingsMissing'], [])
        self.assertNotIn('adminContacts', body)

    def test_empty_board_section_does_not_count_as_configured(self):
        self._set_workspace_payload({
            'board': {},
            'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
        })

        body = self._get_config('caller-user', board_id_env='17')

        self.assertEqual(body['adminSettingsMissing'], ['source'])

    def test_basic_mode_config_has_no_gate_fields(self):
        client = jira_server.app.test_client()
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}, clear=False), \
                patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
                patch.object(jira_server, 'load_dashboard_config', return_value={}), \
                patch.object(jira_server, 'get_effective_capacity_project', return_value=''), \
                patch.object(jira_server, 'resolve_groups_config_path', return_value='team-groups.json'):
            response = client.get('/api/config')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertNotIn('adminSettingsMissing', body)
        self.assertNotIn('adminContacts', body)


if __name__ == '__main__':
    unittest.main()
