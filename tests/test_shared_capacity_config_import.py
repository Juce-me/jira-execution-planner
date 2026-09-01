import json
import os
import tempfile
import unittest

from backend.auth.context import RequestAuthContext
from backend.config.import_config import import_dashboard_config
from backend.db import engine as db_engine
from backend.db import models


class SharedCapacityConfigImportTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'import.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='test', name='Test',
                jira_site_url='https://one.example.test', jira_cloud_id='cloud-one',
            )
            user = models.User(
                id='user-one', external_provider='test', external_subject='one', account_type='admin',
            )
            session.add_all([workspace, user])
            session.flush()
            self.workspace_id = workspace.id
            session.commit()
        self.context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='user-one', stable_subject='one',
            atlassian_account_id='one', workspace_id=self.workspace_id,
            auth_connection_id='connection', cloud_id='cloud-one',
            site_url='https://one.example.test', token_version='1',
            account_status='active', is_admin=True,
        )

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def test_private_view_import_does_not_publish_capacity_as_workspace_configuration(self):
        source_path = os.path.join(self.tmpdir.name, 'dashboard.json')
        with open(source_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'capacity': {
                    'project': 'CAP',
                    'fieldId': 'customfield_10001',
                    'fieldName': 'Capacity',
                },
                'eng': {'mode': 'planning'},
            }, handle)

        imported = import_dashboard_config(
            database_url=self.database_url,
            context=self.context,
            source_path=source_path,
        )

        with self.factory() as session:
            view = session.get(models.ViewConfig, imported.view_config_id)
            workspace_config_count = session.query(models.WorkspaceDashboardConfig).count()
        self.assertNotIn('capacity', view.payload)
        self.assertEqual(workspace_config_count, 0)


if __name__ == '__main__':
    unittest.main()
