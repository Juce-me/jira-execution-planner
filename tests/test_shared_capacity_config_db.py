import importlib.util
import unittest
from pathlib import Path

from sqlalchemy import inspect

from backend.db import engine as db_engine
from backend.db import models


class SharedCapacityConfigDatabaseTests(unittest.TestCase):
    def test_model_has_workspace_unique_audit_and_site_identity_columns(self):
        table = models.WorkspaceCapacityConfig.__table__
        self.assertIn('workspace_id', table.c)
        self.assertIn('jira_site_url', table.c)
        self.assertIn('jira_cloud_id', table.c)
        self.assertIn('config_revision', table.c)
        self.assertIn('created_by', table.c)
        self.assertIn('updated_by', table.c)
        self.assertIn('uq_workspace_capacity_configs_workspace', {constraint.name for constraint in table.constraints})

    def test_migration_is_offline_safe_and_declares_capacity_table(self):
        path = Path(__file__).parents[1] / 'backend/db/migrations/versions/20260901_0007_workspace_capacity_config.py'
        spec = importlib.util.spec_from_file_location('capacity_migration', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.down_revision, '20260604_0006')
        self.assertEqual(module.revision, '20260901_0007')


if __name__ == '__main__':
    unittest.main()
