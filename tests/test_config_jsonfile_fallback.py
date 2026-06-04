import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.config.import_config import export_view_config_json, import_dashboard_config
from backend.config.repository import db_repository
from backend.db import engine as db_engine
from backend.db import models
import jira_server


FULL_SCOPE = (
    'read:me read:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


class ConfigJsonfileFallbackTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.dashboard_path = os.path.join(self._tmpdir.name, 'dashboard-config.json')
        self.groups_path = os.path.join(self._tmpdir.name, 'team-groups.json')
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'views.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.connection_id = self._seed_user()
        self.context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id=self.user_id,
            stable_subject='account-1',
            atlassian_account_id='account-1',
            workspace_id=self.workspace_id,
            auth_connection_id=self.connection_id,
            cloud_id='cloud-1',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )
        with open(self.dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(self._dashboard_config(), handle)

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_user(self):
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject='account-1',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, user])
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
            session.add(connection)
            session.commit()
            return workspace.id, user.id, connection.id

    def _dashboard_config(self):
        return {
            'version': 1,
            'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
            'board': {'boardId': '7', 'boardName': 'Planning Board'},
            'capacity': {'project': 'CAP', 'fieldId': 'customfield_1', 'fieldName': 'Capacity'},
            'teamGroups': {
                'version': 1,
                'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
                'defaultGroupId': 'platform',
            },
            'epm': {
                'version': 2,
                'labelPrefix': 'rnd_project_*',
                'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['GOAL-2']},
                'issueTypes': {
                    'initiative': ['Initiative'],
                    'epic': ['Epic'],
                    'leaf': ['Story'],
                },
                'projects': {
                    'home-1': {
                        'id': 'home-1',
                        'homeProjectId': 'home-1',
                        'name': 'Synthetic Project',
                        'label': 'rnd_project_synthetic',
                    }
                },
            },
        }

    def _route_payloads(self, *, backend):
        if backend == 'db':
            session_id = 'config-fallback-session'
            with self.client.session_transaction() as flask_session:
                flask_session['atlassian_oauth_session_id'] = session_id
                flask_session['db_oauth_session'] = {'db_auth_connection_id': self.connection_id}
            jira_server.OAUTH_TOKEN_STORE[session_id] = {
                'access_token': 'access-123',
                'refresh_token': 'refresh-123',
                'expires_at': 9999999999,
                'scope': FULL_SCOPE,
                'cloudid': 'cloud-1',
                'site_url': 'https://example.atlassian.net',
                'account_id': 'account-1',
                'account_status': 'active',
                'db_auth_connection_id': self.connection_id,
                'db_token_version': '1',
            }
        patches = [
            patch.dict(os.environ, {
                'CONFIG_STORAGE_BACKEND': backend,
                'DATABASE_URL': self.database_url,
            }, clear=False),
            patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic' if backend == 'jsonfile' else 'atlassian_oauth'),
            patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'),
            patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True),
            patch.object(jira_server, 'resolve_dashboard_config_path', return_value=self.dashboard_path),
            patch.object(jira_server, 'resolve_groups_config_path', return_value=self.groups_path),
            patch.object(jira_server, 'current_request_auth_context', return_value=self.context),
        ]
        for active_patch in patches:
            active_patch.start()
        try:
            responses = {
                '/api/config': self.client.get('/api/config'),
                '/api/groups-config': self.client.get('/api/groups-config'),
                '/api/epm/config': self.client.get('/api/epm/config'),
            }
            for route, response in responses.items():
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            return {route: response.get_json() for route, response in responses.items()}
        finally:
            for active_patch in reversed(patches):
                active_patch.stop()

    def test_import_is_idempotent_by_user_workspace_source_path_and_hash(self):
        first = import_dashboard_config(
            database_url=self.database_url,
            context=self.context,
            source_path=self.dashboard_path,
            actor_user_id=self.user_id,
        )
        second = import_dashboard_config(
            database_url=self.database_url,
            context=self.context,
            source_path=self.dashboard_path,
            actor_user_id=self.user_id,
        )

        self.assertTrue(first.imported)
        self.assertFalse(second.imported)
        self.assertEqual(first.view_config_id, second.view_config_id)
        with self.factory() as session:
            versions = session.query(models.ViewConfigVersion).filter_by(
                view_config_id=first.view_config_id,
            ).all()
            self.assertEqual(len(versions), 1)

    def test_legacy_get_routes_match_before_import_after_import_and_json_rollback(self):
        before = self._route_payloads(backend='jsonfile')
        imported = import_dashboard_config(
            database_url=self.database_url,
            context=self.context,
            source_path=self.dashboard_path,
            actor_user_id=self.user_id,
        )
        after_import = self._route_payloads(backend='db')
        rollback = self._route_payloads(backend='jsonfile')

        self.assertEqual(after_import['/api/config'], before['/api/config'])
        self.assertEqual(after_import['/api/epm/config'], before['/api/epm/config'])
        self.assertEqual(rollback, before)
        self.assertEqual(after_import['/api/groups-config']['groups'], before['/api/groups-config']['groups'])
        self.assertEqual(after_import['/api/groups-config']['defaultGroupId'], before['/api/groups-config']['defaultGroupId'])
        self.assertEqual(after_import['/api/groups-config']['source'], 'workspace_db')
        self.assertEqual(after_import['/api/groups-config']['configRevision'], 1)
        self.assertTrue(after_import['/api/groups-config']['preferences']['onboardingRequired'])
        self.assertEqual(after_import['/api/groups-config']['preferences']['effectiveVisibleGroupIds'], [])

        export_path = os.path.join(self._tmpdir.name, 'rollback-export.json')
        export_view_config_json(
            database_url=self.database_url,
            context=self.context,
            view_config_id=imported.view_config_id,
            output_path=export_path,
        )
        with open(export_path, 'r', encoding='utf-8') as handle:
            exported = json.load(handle)
        expected = self._dashboard_config()
        self.assertEqual(exported['projects'], expected['projects'])
        self.assertEqual(exported['board'], expected['board'])
        self.assertEqual(exported['capacity'], expected['capacity'])
        self.assertEqual(exported['epm'], expected['epm'])
        self.assertEqual(exported['teamGroups']['groups'][0]['id'], 'platform')
        self.assertEqual(exported['teamGroups']['groups'][0]['teamIds'], ['team-a'])
        self.assertEqual(exported['teamGroups']['defaultGroupId'], 'platform')
        self.assertNotIn('api_token', json.dumps(exported).lower())

    def test_db_dashboard_save_strips_legacy_team_groups_from_private_view(self):
        repository = db_repository(database_url=self.database_url)
        view_id = repository.save_dashboard_config(
            self.context,
            self._dashboard_config(),
            actor_user_id=self.user_id,
        )
        resolved = repository.resolve_effective_view_config(self.context)

        self.assertEqual(resolved['viewConfigId'], view_id)
        self.assertNotIn('teamGroups', resolved['view'])
        self.assertEqual(resolved['view']['projects']['selected'][0]['key'], 'PROD')


if __name__ == '__main__':
    unittest.main()
