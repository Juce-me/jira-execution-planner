import json
import os
import tempfile
import unittest

from backend.auth.context import RequestAuthContext
from backend.config.db_repository import strip_shared_capacity_config
from backend.config.import_config import export_view_config_json, import_dashboard_config
from backend.db import engine as db_engine
from backend.db import models
from backend.config.view_validation import ViewPayloadValidationError, validate_user_view_payload


class SharedCapacityConfigImportTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'import.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(environment_key='test', name='Test', jira_site_url='https://one.example.test', jira_cloud_id='cloud-one')
            user = models.User(id='user-one', external_provider='test', external_subject='one', account_type='admin')
            session.add_all([workspace, user])
            session.flush()
            self.workspace_id = workspace.id
            session.commit()
        self.context = RequestAuthContext(auth_mode='atlassian_oauth', user_id='user-one', stable_subject='one', atlassian_account_id='one', workspace_id=self.workspace_id, auth_connection_id='connection', cloud_id='cloud-one', site_url='https://one.example.test', token_version='1', account_status='active', is_admin=True)
        with self.factory() as session:
            second_workspace = models.Workspace(environment_key='test', name='Second', jira_site_url='https://two.example.test', jira_cloud_id='cloud-two')
            second_user = models.User(id='user-two', external_provider='test', external_subject='two', account_type='admin')
            session.add_all([second_workspace, second_user])
            session.flush()
            self.second_workspace_id = second_workspace.id
            session.commit()
        self.second_context = RequestAuthContext(auth_mode='atlassian_oauth', user_id='user-two', stable_subject='two', atlassian_account_id='two', workspace_id=self.second_workspace_id, auth_connection_id='connection-two', cloud_id='cloud-two', site_url='https://two.example.test', token_version='1', account_status='active', is_admin=True)
        self.source_path = os.path.join(self.tmpdir.name, 'dashboard.json')

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def _write_source(self, capacity):
        with open(self.source_path, 'w', encoding='utf-8') as handle:
            json.dump({'version': 1, 'capacity': capacity, 'eng': {'mode': 'planning'}}, handle)
    def test_root_capacity_is_stripped_but_nested_domain_capacity_is_preserved(self):
        payload = {'capacity': {'project': 'CAP'}, 'scenario': {'config': {'capacity': {'hours': 3}}}}
        self.assertEqual(strip_shared_capacity_config(payload), {'scenario': {'config': {'capacity': {'hours': 3}}}})

    def test_new_root_capacity_variants_are_forbidden(self):
        for key in ('capacity', 'Capacity', 'capacity_config'):
            with self.subTest(key=key):
                with self.assertRaises(ViewPayloadValidationError):
                    validate_user_view_payload({key: {}})

    def test_import_promotes_private_remnant_without_reporting_a_new_seed_and_export_round_trips_shared_value(self):
        self._write_source({'project': 'SOURCE', 'fieldId': 'customfield_10001', 'fieldName': 'Source'})
        with self.factory() as session:
            session.add(models.ViewConfig(workspace_id=self.workspace_id, owner_user_id='user-one', name='Legacy', view_type='eng', is_default=True, payload={'capacity': {'project': 'PRIVATE', 'fieldId': 'customfield_10001', 'fieldName': 'Private'}}))
            session.commit()
        imported = import_dashboard_config(database_url=self.database_url, context=self.context, source_path=self.source_path)
        self.assertEqual(imported.capacity_result, 'unchanged_existing')
        output_path = os.path.join(self.tmpdir.name, 'export.json')
        export_view_config_json(database_url=self.database_url, context=self.context, view_config_id=imported.view_config_id, output_path=output_path)
        with open(output_path, encoding='utf-8') as handle:
            exported = json.load(handle)
        self.assertEqual(exported['capacity']['project'], 'PRIVATE')

    def test_import_reports_seeded_absent_non_admin_and_same_hash_existing_outcomes(self):
        self._write_source({'project': 'SOURCE', 'fieldId': 'customfield_10001', 'fieldName': 'Source'})
        seeded = import_dashboard_config(database_url=self.database_url, context=self.context, source_path=self.source_path)
        self.assertEqual(seeded.capacity_result, 'seeded')
        repeated = import_dashboard_config(database_url=self.database_url, context=self.context, source_path=self.source_path)
        self.assertFalse(repeated.imported)
        self.assertEqual(repeated.capacity_result, 'unchanged_existing')

        non_admin_path = os.path.join(self.tmpdir.name, 'non-admin.json')
        with open(non_admin_path, 'w', encoding='utf-8') as handle:
            json.dump({'capacity': {'project': 'IGNORED', 'fieldId': 'customfield_10002'}}, handle)
        non_admin = RequestAuthContext(**{**self.second_context.__dict__, 'is_admin': False})
        ignored = import_dashboard_config(database_url=self.database_url, context=non_admin, source_path=non_admin_path)
        self.assertEqual(ignored.capacity_result, 'ignored_non_admin')

        absent_path = os.path.join(self.tmpdir.name, 'absent.json')
        with open(absent_path, 'w', encoding='utf-8') as handle:
            json.dump({'eng': {}}, handle)
        absent = import_dashboard_config(database_url=self.database_url, context=self.second_context, source_path=absent_path)
        self.assertEqual(absent.capacity_result, 'absent')

    def test_import_capacity_isolated_by_workspace_and_site(self):
        self._write_source({'project': 'ONE', 'fieldId': 'customfield_10001', 'fieldName': 'One'})
        first = import_dashboard_config(database_url=self.database_url, context=self.context, source_path=self.source_path)
        second_path = os.path.join(self.tmpdir.name, 'second.json')
        with open(second_path, 'w', encoding='utf-8') as handle:
            json.dump({'capacity': {'project': 'TWO', 'fieldId': 'customfield_10002', 'fieldName': 'Two'}}, handle)
        second = import_dashboard_config(database_url=self.database_url, context=self.second_context, source_path=second_path)
        self.assertEqual((first.capacity_result, second.capacity_result), ('seeded', 'seeded'))
        with self.factory() as session:
            rows = {row.workspace_id: row for row in session.query(models.WorkspaceCapacityConfig).all()}
            self.assertEqual(rows[self.workspace_id].project_key, 'ONE')
            self.assertEqual(rows[self.second_workspace_id].project_key, 'TWO')


if __name__ == '__main__':
    unittest.main()
