import base64
import os
import tempfile
import unittest

from backend.auth.key_provider import key_provider_from_env
from backend.auth.service_integrations import seed_service_integration
from backend.db import engine as db_engine
from backend.db import models
import jira_server


class TestCachePartitioning(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'cache.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Example',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-123',
                created_by='test',
            )
            admin = models.User(
                external_provider='atlassian',
                external_subject='admin-account',
                email='admin@example.com',
                display_name='Admin',
                account_type='admin',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, admin])
            session.flush()
            self.workspace_id = workspace.id
            self.admin_id = admin.id
            session.commit()
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([16]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()
        jira_server.clear_auth_sensitive_caches('test-teardown')

    def _warm_caches(self):
        jira_server.TASKS_CACHE['tasks'] = {'data': {}}
        jira_server.EPIC_COHORT_CACHE['cohort'] = {'data': {}}
        jira_server.EPM_PROJECTS_CACHE['projects'] = {'data': {}}
        jira_server.EPM_ISSUES_CACHE['issues'] = {'data': {}}
        jira_server.EPM_ROLLUP_CACHE['rollup'] = {'data': {}}
        jira_server.SCENARIO_CACHE['data'] = {'ok': True}
        jira_server.PROJECTS_CACHE['data'] = [{'key': 'ABC'}]
        jira_server.PROJECTS_CACHE['timestamp'] = 123
        jira_server.COMPONENTS_CACHE['data'] = [{'name': 'Component'}]
        jira_server.COMPONENTS_CACHE['timestamp'] = 123
        jira_server.EPICS_SEARCH_CACHE['epics'] = {'data': []}
        jira_server.LABELS_CACHE['data'] = ['label']
        jira_server.LABELS_CACHE['timestamp'] = 123
        jira_server.ISSUE_TYPES_CACHE['data'] = ['Story']
        jira_server.ISSUE_TYPES_CACHE['timestamp'] = 123
        jira_server.TEAM_FIELD_CACHE = 'customfield_1'
        jira_server.PARENT_NAME_FIELD_CACHE = 'customfield_2'
        jira_server.EPIC_LINK_FIELD_CACHE = 'customfield_3'
        jira_server.CAPACITY_FIELD_CACHE = 'customfield_4'

    def _assert_caches_cleared(self):
        self.assertEqual(jira_server.TASKS_CACHE, {})
        self.assertEqual(jira_server.EPIC_COHORT_CACHE, {})
        self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {})
        self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
        self.assertEqual(jira_server.EPM_ROLLUP_CACHE, {})
        self.assertIsNone(jira_server.SCENARIO_CACHE['data'])
        self.assertIsNone(jira_server.PROJECTS_CACHE['data'])
        self.assertIsNone(jira_server.COMPONENTS_CACHE['data'])
        self.assertEqual(jira_server.EPICS_SEARCH_CACHE, {})
        self.assertIsNone(jira_server.LABELS_CACHE['data'])
        self.assertIsNone(jira_server.ISSUE_TYPES_CACHE['data'])
        self.assertIsNone(jira_server.TEAM_FIELD_CACHE)
        self.assertIsNone(jira_server.PARENT_NAME_FIELD_CACHE)
        self.assertIsNone(jira_server.EPIC_LINK_FIELD_CACHE)
        self.assertIsNone(jira_server.CAPACITY_FIELD_CACHE)

    def test_cache_invalidated_on_connection_revoke(self):
        self._warm_caches()
        jira_server.clear_auth_sensitive_caches('connection_revoke')
        self._assert_caches_cleared()

    def test_cache_invalidated_on_user_disable(self):
        self._warm_caches()
        jira_server.clear_auth_sensitive_caches('user_disable')
        self._assert_caches_cleared()

    def test_cache_invalidated_on_service_credential_rotation(self):
        self._warm_caches()
        with self.factory() as session:
            seed_service_integration(
                session,
                workspace_id=self.workspace_id,
                provider='home_townsquare_basic',
                credential_subject='svc-home@example.com',
                api_token='service-token-123',
                actor_user_id=self.admin_id,
                key_provider=self.key_provider,
            )
            session.commit()
        self._assert_caches_cleared()

    def test_cache_invalidated_on_admin_scope_project_change(self):
        self._warm_caches()
        jira_server.clear_auth_sensitive_caches('admin_scope_project_change')
        self._assert_caches_cleared()

    def test_cache_invalidated_on_token_version_bump(self):
        self._warm_caches()
        jira_server.clear_auth_sensitive_caches('token_version_bump')
        self._assert_caches_cleared()


if __name__ == '__main__':
    unittest.main()
