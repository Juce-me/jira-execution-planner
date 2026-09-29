import importlib.util
import pathlib
import re
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.routes import dev_routes
from backend.services import eng_board
from backend.services import eng_board_measurement as core
from backend.services import eng_board_measurement_runtime as runtime


ROOT = pathlib.Path(__file__).resolve().parents[1]


class EngBoardMeasurementCoreTests(unittest.TestCase):
    def test_fixed_campaign_sequence_has_40_ordered_steps(self):
        self.assertEqual(40, len(runtime.STEP_TABLE))
        self.assertEqual(list(range(40)), [row['step'] for row in runtime.STEP_TABLE])
        self.assertEqual(
            ['legacy_selected_sprint', 'legacy_selected_sprint',
             'candidate_selected_sprint', 'candidate_selected_sprint'],
            [row['profile'] for row in runtime.STEP_TABLE[:4]],
        )
        for offset in range(0, 40, 2):
            self.assertEqual('refresh', runtime.STEP_TABLE[offset]['cacheIntent'])
            self.assertEqual('reuse', runtime.STEP_TABLE[offset + 1]['cacheIntent'])

    def test_query_projection_contract(self):
        projects = (('PROD', 'product'), ('TECH', 'tech'))
        jql = core.build_epic_index_jql(projects, ('A "quoted" component',), ('Done',), 28)
        self.assertIn('component in ("A \\"quoted\\" component")', jql)
        self.assertIn('status CHANGED TO "Done" AFTER -28d', jql)
        self.assertIn('created >= -28d', jql)
        self.assertNotIn('updated', jql)
        child_jql = core.build_child_jql(
            projects, ('10001',), ('PROD-1',), epic_link_field_id='customfield_10014',
            sprint_field_id='customfield_10101', sprint_id=42,
        )
        self.assertIn('cf[10014] in ("PROD-1")', child_jql)
        self.assertIn('cf[10014] IS EMPTY AND parent in ("PROD-1")', child_jql)
        self.assertIn('cf[10101] = 42', child_jql)

    def test_diagnostic_query_and_pager_are_adapters_to_production_core(self):
        with patch.object(eng_board, 'build_epic_index_jql', return_value='shared-jql') as build:
            self.assertEqual('shared-jql', core.build_epic_index_jql((('P', 'product'),), (), (), 28))
        build.assert_called_once_with((('P', 'product'),), (), (), 28)

        with patch.object(eng_board, 'strict_search', return_value=[{'key': 'P-1'}]) as search:
            result = core.strict_search(lambda _payload: None, 'shared-jql', ('summary',))
        self.assertEqual([{'key': 'P-1'}], result)
        search.assert_called_once()

    def test_schema_v2_checker_and_external_runner_exist(self):
        checker_path = ROOT / 'scripts' / 'check_eng_board_measurement.py'
        html_path = ROOT / 'runners' / 'local' / 'eng_board_measurement_runner.html'
        js_path = ROOT / 'runners' / 'local' / 'eng_board_measurement_runner.js'
        self.assertTrue(checker_path.is_file())
        self.assertTrue(html_path.is_file())
        self.assertTrue(js_path.is_file())
        html = html_path.read_text(encoding='utf-8')
        self.assertIn('src="/api/dev/eng-board-measurement/runner.js"', html)
        self.assertNotIn('<script>', html)
        self.assertIsNone(re.search(r'\son\w+=', html, re.IGNORECASE))
        spec = importlib.util.spec_from_file_location('measurement_checker', checker_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        stopped = module.check_document({
            'schemaVersion': 2, 'result': 'stopped', 'stopCode': 'deadline_bound_unproven',
            'context': module.empty_stop_context(), 'rounds': [],
        })
        self.assertEqual('STOP deadline_bound_unproven', stopped)
        self.assertNotIn('PASS ', checker_path.read_text(encoding='utf-8'))

    def test_checker_refuses_output_inside_repository(self):
        checker_path = ROOT / 'scripts' / 'check_eng_board_measurement.py'
        if not checker_path.exists():
            self.fail('checker missing')
        spec = importlib.util.spec_from_file_location('measurement_checker_output', checker_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(ValueError):
            module.validate_output_path(ROOT / 'diagnostic.json', repo_root=ROOT)
        with tempfile.TemporaryDirectory() as directory:
            module.validate_output_path(pathlib.Path(directory) / 'diagnostic.json', repo_root=ROOT)


    def _legacy_query(self, group, lane='product'):
        registry = runtime.CampaignRegistry()
        context = SimpleNamespace(workspace_id='workspace', user_id='user', auth_connection_id='connection',
                                  browser_session_id='browser', token_version='1')
        campaign = registry.begin(context, SimpleNamespace(), group, group, 42)
        self.addCleanup(registry.fail_begin, campaign)
        registry.publish_begin(campaign)
        registry.reserve(context, campaign.campaign_id, 0)
        descriptor = dev_routes._legacy_descriptor(campaign, runtime.STEP_TABLE[0])
        query = {'sprint': '42', 'team': 'all', 'groupId': descriptor['groupId'],
                 'teamIds': ','.join(descriptor['teamIds']), 'teamLabels': ','.join(descriptor['teamLabels']),
                 'project': lane, 'purpose': 'dashboard', 'refresh': 'true'}
        registry.validate_legacy_request(context, campaign.campaign_id, 0, query)
        return descriptor, query

    def test_legacy_descriptor_and_request_flatten_scalar_and_array_aliases_identically(self):
        scalar = {'id': 'department-a', 'teamIds': ['team-a', 'team-b'],
                  'teamLabels': {'team-a': 'label_team_a', 'team-b': 'label_team_b'}}
        array = {'id': 'department-a', 'teamIds': ['team-a', 'team-b'],
                 'teamLabels': {'team-a': ['label_team_a'], 'team-b': ['label_team_b']}}
        self.assertEqual(self._legacy_query(scalar), self._legacy_query(array))
        descriptor, query = self._legacy_query({
            'id': 'department-a', 'teamIds': ['team-a'],
            'teamLabels': {'team-a': ['label_team_a', 'label_team_a_old']},
        })
        self.assertEqual(descriptor['teamLabels'], ['label_team_a', 'label_team_a_old'])
        self.assertEqual(query['teamLabels'], 'label_team_a,label_team_a_old')

    def test_legacy_request_rejects_a_query_missing_an_alias(self):
        group = {'id': 'department-a', 'teamIds': ['team-a'],
                 'teamLabels': {'team-a': ['label_team_a', 'label_team_a_old']}}
        registry = runtime.CampaignRegistry()
        context = SimpleNamespace(workspace_id='workspace', user_id='user', auth_connection_id='connection',
                                  browser_session_id='browser', token_version='1')
        campaign = registry.begin(context, SimpleNamespace(), group, group, 42)
        self.addCleanup(registry.fail_begin, campaign)
        registry.publish_begin(campaign)
        registry.reserve(context, campaign.campaign_id, 0)
        query = {'sprint': '42', 'team': 'all', 'groupId': 'department-a', 'teamIds': 'team-a',
                 'teamLabels': 'label_team_a', 'project': 'product', 'purpose': 'dashboard', 'refresh': 'true'}
        with self.assertRaises(runtime.MeasurementRuntimeError):
            registry.validate_legacy_request(context, campaign.campaign_id, 0, query)

if __name__ == '__main__':
    unittest.main()
