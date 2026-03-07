import json
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestTeamCatalogAPI(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        self._tmpdir = tempfile.mkdtemp()
        self._catalog_path = os.path.join(self._tmpdir, 'team-catalog.json')
        self._dashboard_path = os.path.join(self._tmpdir, 'dashboard-config.json')
        self._cat_patcher = patch.object(jira_server, 'resolve_team_catalog_path', return_value=self._catalog_path)
        self._dash_patcher = patch.object(jira_server, 'resolve_dashboard_config_path', return_value=self._dashboard_path)
        self._cat_patcher.start()
        self._dash_patcher.start()

    def tearDown(self):
        self._cat_patcher.stop()
        self._dash_patcher.stop()
        for f in [self._catalog_path, self._dashboard_path]:
            if os.path.exists(f):
                os.unlink(f)
        os.rmdir(self._tmpdir)

    def test_get_empty_catalog(self):
        resp = self.client.get('/api/team-catalog')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['catalog'], {})
        self.assertEqual(data['meta'], {})

    def test_post_and_get_catalog(self):
        payload = {
            'catalog': {'t1': {'id': 't1', 'name': 'Team One'}},
            'meta': {'updatedAt': '2026-03-06T00:00:00Z', 'source': 'sprint'}
        }
        resp = self.client.post('/api/team-catalog',
                                data=json.dumps(payload),
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['catalog']['t1']['name'], 'Team One')
        self.assertEqual(data['meta']['source'], 'sprint')

        # Verify persisted
        resp2 = self.client.get('/api/team-catalog')
        data2 = resp2.get_json()
        self.assertEqual(data2['catalog']['t1']['name'], 'Team One')

    def test_post_normalizes_catalog(self):
        payload = {
            'catalog': [{'id': ' T2 ', 'name': ' Alpha '}],
            'meta': {'updatedAt': '2026-03-06', 'bogusField': 'ignored'}
        }
        resp = self.client.post('/api/team-catalog',
                                data=json.dumps(payload),
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['catalog']['T2']['id'], 'T2')
        self.assertEqual(data['catalog']['T2']['name'], 'Alpha')
        self.assertNotIn('bogusField', data['meta'])

    def test_post_merges_with_existing(self):
        # Seed initial data
        initial = {'catalog': {'t1': {'id': 't1', 'name': 'Old'}}, 'meta': {}}
        with open(self._catalog_path, 'w') as f:
            json.dump(initial, f)

        payload = {
            'catalog': {'t2': {'id': 't2', 'name': 'New'}},
            'meta': {'updatedAt': '2026-03-06'},
            'merge': True
        }
        resp = self.client.post('/api/team-catalog',
                                data=json.dumps(payload),
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn('t1', data['catalog'])
        self.assertIn('t2', data['catalog'])


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestTeamCatalogMigration(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._catalog_path = os.path.join(self._tmpdir, 'team-catalog.json')
        self._dashboard_path = os.path.join(self._tmpdir, 'dashboard-config.json')
        self._cat_patcher = patch.object(jira_server, 'resolve_team_catalog_path', return_value=self._catalog_path)
        self._dash_patcher = patch.object(jira_server, 'resolve_dashboard_config_path', return_value=self._dashboard_path)
        self._cat_patcher.start()
        self._dash_patcher.start()

    def tearDown(self):
        self._cat_patcher.stop()
        self._dash_patcher.stop()
        for f in [self._catalog_path, self._dashboard_path]:
            if os.path.exists(f):
                os.unlink(f)
        os.rmdir(self._tmpdir)

    def test_migration_extracts_catalog(self):
        dashboard = {
            'version': 1,
            'projects': {'selected': []},
            'teamGroups': {
                'version': 1,
                'groups': [{'id': 'g1', 'name': 'G1', 'teamIds': ['t1']}],
                'defaultGroupId': 'g1',
                'teamCatalog': {'t1': {'id': 't1', 'name': 'Team One'}},
                'teamCatalogMeta': {'updatedAt': '2026-03-06'}
            }
        }
        with open(self._dashboard_path, 'w') as f:
            json.dump(dashboard, f)

        jira_server.migrate_team_catalog_from_config()

        # Catalog file created
        self.assertTrue(os.path.exists(self._catalog_path))
        with open(self._catalog_path) as f:
            catalog = json.load(f)
        self.assertEqual(catalog['catalog']['t1']['name'], 'Team One')

        # Dashboard config cleaned up
        with open(self._dashboard_path) as f:
            config = json.load(f)
        self.assertNotIn('teamCatalog', config['teamGroups'])
        self.assertNotIn('teamCatalogMeta', config['teamGroups'])

    def test_migration_skips_if_catalog_exists(self):
        with open(self._catalog_path, 'w') as f:
            json.dump({'catalog': {}, 'meta': {}}, f)
        dashboard = {
            'version': 1,
            'teamGroups': {
                'teamCatalog': {'t1': {'id': 't1', 'name': 'Should Not Overwrite'}}
            }
        }
        with open(self._dashboard_path, 'w') as f:
            json.dump(dashboard, f)

        jira_server.migrate_team_catalog_from_config()

        with open(self._catalog_path) as f:
            catalog = json.load(f)
        self.assertEqual(catalog['catalog'], {})

    def test_migration_skips_empty_catalog(self):
        dashboard = {
            'version': 1,
            'teamGroups': {
                'teamCatalog': {},
                'teamCatalogMeta': {}
            }
        }
        with open(self._dashboard_path, 'w') as f:
            json.dump(dashboard, f)

        jira_server.migrate_team_catalog_from_config()
        self.assertFalse(os.path.exists(self._catalog_path))


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestGroupsConfigNoCatalog(unittest.TestCase):
    def test_validate_groups_config_excludes_catalog(self):
        payload = {
            'version': 1,
            'groups': [{'id': 'g1', 'name': 'G1', 'teamIds': ['t1']}],
            'defaultGroupId': 'g1',
            'teamCatalog': {'t1': {'id': 't1', 'name': 'Team'}},
            'teamCatalogMeta': {'updatedAt': '2026-03-06'}
        }
        normalized, errors, _warnings = jira_server.validate_groups_config(payload, allow_empty=False)
        self.assertEqual(errors, [])
        self.assertNotIn('teamCatalog', normalized)
        self.assertNotIn('teamCatalogMeta', normalized)

    def test_build_default_groups_config_excludes_catalog(self):
        with patch.object(jira_server, 'build_base_jql', return_value=''):
            config, _warnings = jira_server.build_default_groups_config()
        self.assertNotIn('teamCatalog', config)
        self.assertNotIn('teamCatalogMeta', config)
