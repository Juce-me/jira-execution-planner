import importlib.util
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'gather_eng_board_endpoint_data.py'


def load_collector():
    spec = importlib.util.spec_from_file_location('eng_board_endpoint_collector', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class EngBoardEndpointCollectorTests(unittest.TestCase):
    def test_collects_sanitized_counts_from_existing_get_endpoints(self):
        collector = load_collector()
        calls = []

        def get_json(path, params=None):
            calls.append((path, dict(params or {})))
            if path == '/api/groups-config':
                return ({'groups': [
                    {'id': 'private-a', 'label': 'Private A', 'teamIds': ['t-1'],
                     'teamLabels': {'t-1': 'secret-label'},
                     'missingInfoComponents': ['secret-component']},
                    {'id': 'private-b', 'label': 'Private B', 'teamIds': []},
                ]}, {}, 4.0)
            project = params['project']
            scope = 'selected' if params.get('sprint') else 'all'
            issues = [{'key': f'{project}-{scope}-1'}, {'key': f'{project}-{scope}-2'}]
            return ({'issues': issues, 'epics': {'SECRET-1': {}},
                     'epicsInScope': [{'key': 'SECRET-1'}], 'total': 3},
                    {'Server-Timing': 'total;dur=7'}, 8.5)

        result = collector.collect_endpoint_metrics(get_json, sprint_id=42, include_all_work=True)

        self.assertEqual('complete', result['result'])
        self.assertEqual(2, result['groupCount'])
        self.assertEqual(1, result['eligibleGroupCount'])
        self.assertEqual(1, result['skippedGroupCount'])
        self.assertEqual(4, len(result['samples']))
        self.assertEqual(
            ['/api/groups-config'] + ['/api/tasks-with-team-name'] * 4,
            [path for path, _params in calls],
        )
        self.assertEqual({'product', 'tech'}, {sample['project'] for sample in result['samples']})
        self.assertEqual({'selected_sprint', 'all_work'}, {sample['scope'] for sample in result['samples']})
        self.assertTrue(all(sample['issueCount'] == 2 for sample in result['samples']))
        self.assertTrue(all(sample['reportedTotal'] == 3 for sample in result['samples']))
        self.assertTrue(all(sample['capped'] for sample in result['samples']))
        serialized = collector.json.dumps(result, sort_keys=True)
        for secret in ('private-a', 'private-b', 'Private A', 'secret-label',
                       'secret-component', 'SECRET-1', 'product-selected-1'):
            self.assertNotIn(secret, serialized)

    def test_rejects_non_loopback_urls_and_repository_paths(self):
        collector = load_collector()
        for value in ('https://localhost:5050', 'http://example.com:5050',
                      'http://user@127.0.0.1:5050', 'http://127.0.0.1:5050/path'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                collector.validate_base_url(value)
        self.assertEqual('http://127.0.0.1:5050', collector.validate_base_url('http://127.0.0.1:5050'))
        with self.assertRaises(ValueError):
            collector.validate_external_path(ROOT / 'result.json', repo_root=ROOT)
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / 'result.json'
            self.assertEqual(target.resolve(), collector.validate_external_path(target, repo_root=ROOT))

    def test_zero_team_groups_stop_without_task_requests(self):
        collector = load_collector()
        calls = []

        def get_json(path, params=None):
            calls.append(path)
            return ({'groups': [{'id': 'a', 'teamIds': []}]}, {}, 1.0)

        result = collector.collect_endpoint_metrics(get_json, sprint_id=7, include_all_work=True)
        self.assertEqual('stopped', result['result'])
        self.assertEqual('no_saved_team_scope', result['stopCode'])
        self.assertEqual(['/api/groups-config'], calls)

    def test_output_is_private_and_atomic(self):
        collector = load_collector()
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'summary.json'
            collector.write_summary(path, {'schemaVersion': 1, 'result': 'complete'})
            self.assertEqual(0, path.stat().st_mode & 0o077)
            self.assertEqual({'schemaVersion': 1, 'result': 'complete'}, collector.json.loads(path.read_text()))


if __name__ == '__main__':
    unittest.main()
