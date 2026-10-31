"""Pins the synthetic Legacy oracles in tests/fixtures/work_structure_reference.py
against the real current functions (Python in-process, JS through node).
Nothing here re-implements a calculation; the JS helper only calls the shipped modules.
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.fixtures import work_structure_reference as ref

ROOT = Path(__file__).resolve().parent.parent

JS_DRIVER = r"""
import { pathToFileURL } from 'node:url';
const root = process.argv[1];
const load = (p) => import(pathToFileURL(root + '/' + p).href);
const utils = await load('frontend/src/eng/engTaskUtils.js');
const stats = await load('frontend/src/eng/planningSelectionStats.js');
const cap = await load('frontend/src/capacityClassification.mjs');
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const normalizeEpicKey = (v) => String(v || '').trim().toUpperCase();
const getTeamInfo = (t) => ({ id: t.fields.teamId, name: t.fields.teamName });
const out = {
  sp_total: utils.sumEpicStoryPoints(input.sp_tasks),
  sp_display: input.sp_tasks.map(utils.formatStoryPointsFixed),
  killed_total: utils.sumEpicStoryPoints(input.killed_tasks),
  pairs: {},
  classification: {},
};
for (const [name, pair] of Object.entries(input.pairs)) {
  const tech = new Set(input.tech_keys);
  const excluded = new Set(pair.excluded_epics.map(normalizeEpicKey));
  const adHoc = new Set(pair.ad_hoc_epics.map(normalizeEpicKey));
  const selected = pair.tasks;
  const planning = stats.buildSelectedPlanningTasksList(selected, excluded, normalizeEpicKey);
  const team = stats.buildSelectedTeamStats(selected, getTeamInfo);
  const adHocTasks = planning.filter(t => cap.classifyCapacityIssue(t, { techProjectKeys: tech, adHocEpicSet: adHoc }).capacityType === 'ad_hoc');
  out.pairs[name] = {
    selected_team_total: Object.values(team).reduce((s, v) => s + v.storyPoints, 0),
    included_project_stats: stats.buildSelectedProjectStats(planning, tech, adHoc),
    ad_hoc_product_sp: stats.sumPlanningStoryPoints(adHocTasks),
    excluded_project_stats: stats.buildExcludedProjectStats(selected, excluded, tech, normalizeEpicKey),
  };
}
const t = (key, project) => ({ key, fields: { projectKey: project } });
out.classification.ordinary = cap.classifyCapacityIssue(t('OLD-21', 'OLD'), { techProjectKeys: new Set(), adHocEpicSet: new Set() });
out.classification.ad_hoc = cap.classifyCapacityIssue({ key: 'OLD-22', fields: { epicKey: 'OLD-E1', projectKey: 'OLD' } }, { techProjectKeys: new Set(), adHocEpicSet: new Set(['OLD-E1']) });
out.classification.tech = cap.classifyCapacityIssue(t('TECHX-1', 'TECHX'), { techProjectKeys: new Set(['TECHX']), adHocEpicSet: new Set() });
process.stdout.write(JSON.stringify(out));
"""


class PythonLegacyOracleTests(unittest.TestCase):
    def test_task_and_stats_issue_type_interpretation(self):
        import jira_server
        for case_id, config, expected in ref.TASK_STATS_ISSUE_TYPE_CASES:
            with self.subTest(case_id), patch.object(jira_server, 'load_dashboard_config', return_value=config):
                self.assertEqual(jira_server.get_configured_issue_types(), expected)

    def test_board_issue_type_interpretation(self):
        from backend.services import eng_board
        for case_id, key_present, names, expected in ref.BOARD_ISSUE_TYPE_CASES:
            with self.subTest(case_id):
                ids = eng_board.resolve_issue_type_ids(
                    ref.BOARD_ISSUE_TYPE_CATALOG, names, key_present=key_present)
                self.assertEqual(ids, expected)

    def test_component_board_legacy_epic_index_clauses(self):
        from backend.services import eng_board
        board = ref.LEGACY_COMPONENT_BOARD
        jql = eng_board.build_epic_index_jql(
            ref.COMPONENT_BOARD_PROJECTS, board['selected_components'], ())
        for clause in board['expected_epic_index_clauses']:
            self.assertIn(clause, jql)
        self.assertEqual(
            sum(float(t['fields']['customfield_10004']) for t in board['stories']),
            board['expected_story_points'])

    def test_fixture_is_synthetic(self):
        text = (ROOT / 'tests' / 'fixtures' / 'work_structure_reference.py').read_text(encoding='utf-8')
        self.assertNotIn('http', text.lower())
        self.assertNotIn('@', text)
        import re
        keys = set(re.findall(r"\b([A-Z][A-Z0-9]+)-\d+\b", text))
        self.assertLessEqual(keys, {'OLD', 'PLAN'})


@unittest.skipUnless(shutil.which('node'), 'node is required to call the shipped JS modules')
class JavaScriptLegacyOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        payload = {
            'sp_tasks': ref.sp_tasks(),
            'killed_tasks': ref.KILLED_INCOMPLETE_TASKS,
            'tech_keys': ref.PAIR_TECH_PROJECT_KEYS,
            'pairs': {name: {k: v for k, v in pair.items() if k != 'expected'}
                      for name, pair in ref.LEGACY_PAIRS.items()},
        }
        proc = subprocess.run(
            ['node', '--input-type=module', '-e', JS_DRIVER, str(ROOT)],
            input=json.dumps(payload), capture_output=True, text=True, timeout=60, check=False)
        if proc.returncode != 0:
            raise AssertionError(f'node driver failed: {proc.stderr[-2000:]}')
        cls.out = json.loads(proc.stdout)

    def test_sp_normalization_oracle(self):
        self.assertEqual(self.out['sp_total'], ref.SP_EXPECTED_TOTAL)
        self.assertEqual(self.out['sp_display'], ref.SP_EXPECTED_FIXED_DISPLAY)
        # Source values are untouched by the fixture itself.
        self.assertEqual([t['fields']['customfield_10004'] for t in ref.sp_tasks()], ref.SP_SOURCE_VALUES)

    def test_killed_is_excluded_incomplete_counts(self):
        self.assertEqual(self.out['killed_total'], ref.KILLED_INCOMPLETE_EXPECTED_EPIC_TOTAL)

    def test_paired_legacy_pairs(self):
        for name, pair in ref.LEGACY_PAIRS.items():
            with self.subTest(name):
                self.assertEqual(self.out['pairs'][name], pair['expected'])

    def test_legacy_classification(self):
        self.assertEqual(self.out['classification'], ref.LEGACY_CLASSIFICATION_EXPECTED)


class NewModelExpectationsAreDataOnlyTests(unittest.TestCase):
    def test_component_board_expectations_are_consistent(self):
        board = ref.NEW_MODEL_COMPONENT_BOARD
        sp = {e['key']: e['story_points'] for e in board['epics']}
        for components, expected in board['expected'].items():
            matching = [e['key'] for e in board['epics'] if set(e['components']) & set(components)]
            self.assertEqual(matching, expected['epics'])
            self.assertEqual(sum(sp[k] for k in matching), expected['story_points'])

    def test_new_pairs_keep_one_request_and_distinct_denominators(self):
        for name, expected in ref.NEW_MODEL_EXPECTED_PAIRS.items():
            self.assertEqual(expected['requests'], 1, name)
            self.assertEqual(expected['selected_team_total'], 8, name)
        self.assertEqual(ref.NEW_MODEL_EXPECTED_PAIRS['excluded']['included_allocation'], 0)
        self.assertEqual(ref.NEW_MODEL_EXPECTED_PAIRS['excluded']['excluded_report'], 8)


if __name__ == '__main__':
    unittest.main()
