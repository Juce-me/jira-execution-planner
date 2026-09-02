import importlib.util
import unittest
from pathlib import Path

from sqlalchemy import inspect

from backend.db import engine as db_engine
from backend.db import models


class SharedCapacityConfigDatabaseTests(unittest.TestCase):
    def test_workspace_dashboard_model_holds_capacity_verification_metadata(self):
        table = models.WorkspaceDashboardConfig.__table__
        self.assertIn('workspace_id', table.c)
        self.assertIn('capacity_jira_site_url', table.c)
        self.assertIn('capacity_jira_cloud_id', table.c)
        self.assertIn('capacity_field_schema_type', table.c)
        self.assertIn('capacity_field_verified_at', table.c)
        self.assertIn('config_revision', table.c)
        self.assertIn('created_by', table.c)
        self.assertIn('updated_by', table.c)
        self.assertIn('uq_workspace_dashboard_configs_workspace', {constraint.name for constraint in table.constraints})

    def test_migration_extends_canonical_workspace_dashboard_config(self):
        path = Path(__file__).parents[1] / 'backend/db/migrations/versions/20260901_0010_capacity_verification.py'
        spec = importlib.util.spec_from_file_location('capacity_migration', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.down_revision, '20260830_0009')
        self.assertEqual(module.revision, '20260901_0010')


if __name__ == '__main__':
    unittest.main()
