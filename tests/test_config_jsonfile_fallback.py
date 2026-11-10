import json
import hashlib
import io
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.auth.db_context import resolve_db_request_auth_context
from tests.db_oauth_test_helpers import seed_db_actor
from backend.config.import_config import export_view_config_json, import_dashboard_config
from backend.config.repository import db_repository
from backend.db import engine as db_engine
from backend.db import models
import jira_server
from tests.postgres_test_db import fresh_database_url


FULL_SCOPE = (
    'read:me read:jira-work write:jira-work read:jira-user '
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
        self.database_url = fresh_database_url(self.addCleanup)
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.connection_id = self._seed_user()
        self.context = resolve_db_request_auth_context(self.session_payload, database_url=self.database_url)
        with open(self.dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(self._dashboard_config(), handle)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_user(self):
        with self.factory() as session:
            actor = seed_db_actor(session, workspace={'cloud_id': 'cloud-1', 'site_url': 'https://example.atlassian.net'},
                                  account_identity='account-1')
            session.commit()
            self.session_payload = actor.session_payload
            return actor.workspace_id, actor.user_id, actor.connection_id

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
            'teamCatalog': {'catalog': {'legacy-team': {'name': 'Discard me'}}},
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
        with self.client.session_transaction() as cookie:
            cookie['db_oauth_session'] = self.session_payload
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
            patch.object(jira_server, '_load_dashboard_config_json', side_effect=AssertionError('No runtime JSON fallback')),
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
            self.assertEqual(versions[0].created_by, self.user_id)

    def test_concurrent_duplicate_import_serializes_to_one_version_and_one_callback(self):
        barrier = threading.Barrier(2)
        results = []
        callbacks = []
        failures = []

        def run_import():
            try:
                barrier.wait(timeout=5)
                results.append(import_dashboard_config(
                    database_url=self.database_url,
                    context=self.context,
                    source_path=self.dashboard_path,
                    actor_user_id='malicious-other-user',
                    post_commit=lambda result: callbacks.append(result.view_config_id),
                ))
            except Exception as error:
                failures.append(error)

        threads = [threading.Thread(target=run_import) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertEqual(failures, [])
        self.assertEqual(sorted(result.imported for result in results), [False, True])
        self.assertEqual(len(callbacks), 1)
        with self.factory() as session:
            views = session.query(models.ViewConfig).filter_by(
                workspace_id=self.workspace_id, owner_user_id=self.user_id,
            ).all()
            self.assertEqual(len(views), 1)
            versions = session.query(models.ViewConfigVersion).filter_by(view_config_id=views[0].id).all()
            self.assertEqual(len(versions), 1)
            self.assertEqual(versions[0].created_by, self.user_id)

    def test_duplicate_import_repairs_missing_shared_groups_without_new_view_version(self):
        first = import_dashboard_config(
            database_url=self.database_url, context=self.context, source_path=self.dashboard_path,
        )
        with self.factory() as session:
            session.query(models.WorkspaceGroupConfig).delete()
            session.commit()

        duplicate = import_dashboard_config(
            database_url=self.database_url, context=self.context, source_path=self.dashboard_path,
        )

        self.assertFalse(duplicate.imported)
        self.assertEqual(duplicate.view_config_id, first.view_config_id)
        with self.factory() as session:
            self.assertEqual(session.query(models.WorkspaceGroupConfig).count(), 1)
            self.assertEqual(
                session.query(models.ViewConfigVersion).filter_by(view_config_id=first.view_config_id).count(),
                1,
            )

    def test_import_hash_and_payload_come_from_one_source_read(self):
        first_payload = self._dashboard_config()
        first_payload['epm']['scope']['rootGoalKey'] = 'FIRST'
        second_payload = self._dashboard_config()
        second_payload['epm']['scope']['rootGoalKey'] = 'SECOND'
        source_bytes = json.dumps(first_payload).encode('utf-8')

        with patch(
            'backend.config.import_config.open',
            side_effect=[io.BytesIO(source_bytes), io.StringIO(json.dumps(second_payload))],
        ) as source_open:
            result = import_dashboard_config(
                database_url=self.database_url, context=self.context,
                source_path='/virtual/dashboard-config.json',
            )

        self.assertEqual(source_open.call_count, 1)
        self.assertEqual(result.source_hash, hashlib.sha256(source_bytes).hexdigest())
        with self.factory() as session:
            view = session.query(models.ViewConfig).filter_by(id=result.view_config_id).one()
            self.assertEqual(view.payload['epm']['scope']['rootGoalKey'], 'FIRST')

    def test_explicit_json_import_exports_artifacts_without_restoring_a_serving_profile(self):
        source_bytes = Path(self.dashboard_path).read_bytes()
        imported = import_dashboard_config(database_url=self.database_url, context=self.context,
            source_path=self.dashboard_path, actor_user_id=self.user_id)
        after_import = self._route_payloads(backend='db')
        db_config = after_import['/api/config']
        self.assertNotIn('epm', db_config['sharedConfig'])
        self.assertEqual(set(db_config['adminSettingsMissing']), {'scope', 'source'})
        # Adapter capability is profile-level; missing administrator scope still blocks loading.
        self.assertTrue(db_config['boardAllWorkAvailable'])
        self.assertEqual(after_import['/api/epm/config']['scope'], self._dashboard_config()['epm']['scope'])
        groups = after_import['/api/groups-config']
        self.assertEqual(groups['groups'][0]['id'], 'platform')
        self.assertEqual(groups['groups'][0]['adHocCapacityEpics'], [])
        self.assertEqual(groups['source'], 'workspace_db')
        self.assertEqual(groups['configRevision'], 1)
        self.assertTrue(groups['preferences']['onboardingRequired'])
        self.assertEqual(groups['preferences']['effectiveVisibleGroupIds'], [])
        with patch.dict(os.environ, {'JIRA_AUTH_MODE': 'basic', 'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, '_load_dashboard_config_json', side_effect=AssertionError('No retired profile file read')):
            for path in ('/api/config', '/api/groups-config', '/api/epm/config'):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json()['error'], 'runtime_auth_unsupported')
        self.assertEqual(Path(self.dashboard_path).read_bytes(), source_bytes)

        # Export tooling requires a destination outside the synthetic checkout.
        with tempfile.TemporaryDirectory(dir=Path(jira_server.__file__).resolve().parent.parent) as export_directory:
            export_path = os.path.join(export_directory, 'rollback-export.json')
            export_view_config_json(
                database_url=self.database_url,
                context=self.context,
                view_config_id=imported.view_config_id,
                output_path=export_path,
            )
            with open(export_path, 'r', encoding='utf-8') as handle:
                exported = json.load(handle)
        self.assertNotIn('projects', exported)
        self.assertNotIn('board', exported)
        self.assertNotIn('capacity', exported)
        self.assertEqual(exported['epm'], self._dashboard_config()['epm'])
        self.assertNotIn('teamCatalog', exported)
        self.assertEqual(exported['teamGroups']['groups'][0]['id'], 'platform')
        self.assertEqual(exported['teamGroups']['groups'][0]['teamIds'], ['team-a'])
        self.assertEqual(exported['teamGroups']['groups'][0]['adHocCapacityEpics'], [])
        self.assertEqual(exported['teamGroups']['defaultGroupId'], 'platform')
        self.assertNotIn('api_token', json.dumps(exported).lower())

    def test_db_dashboard_full_save_fails_closed(self):
        repository = db_repository(database_url=self.database_url)
        with self.assertRaisesRegex(RuntimeError, 'full workspace dashboard replacement'):
            repository.save_dashboard_config(self.context, self._dashboard_config())


if __name__ == '__main__':
    unittest.main()
