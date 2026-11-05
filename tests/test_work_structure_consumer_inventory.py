"""Guard for the work-structure coupling inventory (plan Task 0).

Regenerates the inventory in-process with scripts/generate_work_configuration_sites.py
and checks seed resolution, classification and schema. It does not claim the
inventory is exhaustive (see the header coverage notes in the generated JSON).
"""
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / 'docs' / 'plans' / 'DONE-quarterly-work-structure-migration.md'


def _load_generator():
    spec = importlib.util.spec_from_file_location(
        'generate_work_configuration_sites', ROOT / 'scripts' / 'generate_work_configuration_sites.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _plan_table_refs():
    """(path-token, first-line) refs in the first column of the coupling table."""
    text = PLAN.read_text(encoding='utf-8')
    start = text.index('## Query coupling, calculations, alerts and caches')
    section = text[start:]
    end = section.index('Create `planning_work.py')
    refs = []
    for line in section[:end].splitlines():
        if not line.startswith('| `'):
            continue
        first_cell = line.split('|')[1]
        for m in re.finditer(r'`([\w/.\-]+\.(?:py|js|jsx|mjs)):([0-9,–\-]+)`', first_cell):
            for seg in m.group(2).replace('–', '-').split(','):
                refs.append((m.group(1), int(seg.split('-')[0])))
    return refs


class WorkStructureConsumerInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = _load_generator()
        cls.data = cls.gen.generate()
        cls.rows = cls.data['rows']
        cls.header = cls.data['header']

    def test_every_seed_site_resolves_to_a_row(self):
        row_ids = {row['id'] for row in self.rows}
        seeds = self.gen.seed_ids()
        self.assertGreater(len(seeds), 50)
        missing = [sid for sid in seeds if f'seed:{sid}' not in row_ids]
        self.assertEqual(missing, [])

    def test_plan_coupling_table_refs_are_all_seeds(self):
        refs = _plan_table_refs()
        self.assertGreater(len(refs), 20)
        all_paths = {self.gen.rel(p) for p in self.gen.iter_source_files()}
        seed_keys = {(row['path'], row['line']) for row in self.rows if row['origin'] == 'seed'}
        missing = []
        for token, line in refs:
            path = self.gen.resolve_seed_path(token, all_paths)
            if (path, line) not in seed_keys:
                missing.append(f'{token}:{line}')
        self.assertEqual(missing, [])

    def test_every_row_has_a_known_disposition(self):
        for row in self.rows:
            self.assertTrue(row['disposition'], row['id'])
            self.assertIn(row['disposition'], self.gen.DISPOSITIONS, row['id'])

    def test_promoted_path_bypass_allowlist_exists_and_is_empty(self):
        self.assertEqual(self.gen.PROMOTED_PATH_BYPASS_ALLOWLIST, ())
        self.assertEqual(self.header['promoted_path_bypass_allowlist'], [])
        self.assertNotIn('promoted_path_bypass', self.gen.DISPOSITIONS)
        bypass = [row['id'] for row in self.rows if 'bypass' in row['disposition'] or 'bypass' in row['note'].lower()]
        self.assertEqual(bypass, [])

    def test_row_and_header_schema(self):
        self.assertEqual(
            sorted(self.header),
            sorted(['generator', 'generator_version', 'plan', 'scanned_roots', 'scanned_file_count',
                    'row_count', 'rows_by_disposition', 'rows_by_origin', 'promoted_path_bypass_allowlist',
                    'python_files_unparsed', 'coverage_notes', 'unknowns']))
        self.assertTrue(self.header['coverage_notes'])
        self.assertTrue(self.header['unknowns'])
        self.assertEqual(self.header['row_count'], len(self.rows))
        ids = set()
        for row in self.rows:
            self.assertEqual(tuple(sorted(row)), tuple(sorted(self.gen.ROW_FIELDS)), row['id'])
            self.assertNotIn(row['id'], ids)
            ids.add(row['id'])
            self.assertIn(row['origin'], ('seed', 'scan'))
            self.assertIsInstance(row['line'], int)
            self.assertGreaterEqual(row['line'], 1)
            self.assertGreaterEqual(row['line_end'], row['line'])
            self.assertTrue((ROOT / row['path']).is_file(), row['path'])
            for key in ('symbol', 'assumption', 'legacy_role', 'new_role', 'confidence'):
                self.assertTrue(isinstance(row[key], str) and row[key], f"{row['id']} {key}")
            self.assertIsInstance(row['callers'], list)
            self.assertTrue(isinstance(row['owning_test'], list) and row['owning_test'], row['id'])

    def test_migrated_query_sites_resolve_their_role_inside_the_function(self):
        import ast
        self.assertTrue(self.gen.MIGRATED_QUERY_SITES)
        by_path = {}
        for (path, symbol), token in self.gen.MIGRATED_QUERY_SITES.items():
            text = (ROOT / path).read_text(encoding='utf-8')
            if path not in by_path:
                by_path[path] = (text, {node.name: node for node in ast.parse(text).body
                                        if isinstance(node, (ast.FunctionDef, ast.ClassDef))})
            text, nodes = by_path[path]
            self.assertIn(symbol, nodes, f'{path}:{symbol} is not a top-level definition')
            self.assertIn(token, ast.get_source_segment(text, nodes[symbol]), f'{path}:{symbol} lost {token!r}')

    def test_legacy_adapter_rows_exist_only_for_registered_migrated_sites(self):
        adapter = [row for row in self.rows if row['disposition'] == self.gen.LEGACY_ADAPTER]
        self.assertTrue(adapter)
        for row in adapter:
            self.assertIn((row['path'], row['symbol'].split('.')[0]), self.gen.MIGRATED_QUERY_SITES, row['id'])
            self.assertEqual(row['origin'], 'scan')

    def test_inventory_is_deterministic(self):
        again = self.gen.generate()
        self.assertEqual(again, self.data)


if __name__ == '__main__':
    unittest.main()
