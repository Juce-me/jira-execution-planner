"""Task 3D: configuration identity in the backend caches and retirement after a committed save."""

import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

import jira_server
from backend.auth.cache_policy import cache_key_in_jira_home_partition
from backend.services import work_structure as ws
from backend.services.workspace_catalog_cache import SCOPED_SPRINT_CATALOGS
from tests.test_work_structure_routes import WorkStructureRouteBase


def configuration(config_id='delivery', revision=1, digest='d1'):
    return {'configurationId': config_id, 'revision': revision, 'digest': digest}


def tasks_key(cfg=None):
    return jira_server.build_tasks_cache_key(
        '101', 'g1', 'all', ['t1'], [], False, False, 'dashboard', None, '2027Q1', configuration=cfg)


class KeyIdentityTests(unittest.TestCase):
    def test_flat_keys_are_unchanged_without_a_configuration(self):
        self.assertEqual(tasks_key(), tasks_key(None))
        self.assertEqual(
            jira_server.build_stats_cache_key('2027Q1', 'project = A', ['t'], group_id='g'),
            jira_server.build_stats_cache_key('2027Q1', 'project = A', ['t'], group_id='g', configuration=None))
        self.assertEqual(jira_server.work_configuration_cache_segment(None), '')
        flat = jira_server._build_epic_cohort_cache_key('2027Q1', '2027Q1', ['t'], ['P'])
        self.assertNotIn('cfg:', flat)

    def test_id_revision_and_digest_each_change_every_work_key(self):
        variants = [configuration(), configuration(config_id='legacy'),
                    configuration(revision=2), configuration(digest='d2')]
        builders = {
            'tasks': tasks_key,
            'stats': lambda cfg: jira_server.build_stats_cache_key(
                '2027Q1', 'project = A', ['t'], group_id='g', configuration=cfg),
            'cohort': lambda cfg: jira_server._build_epic_cohort_cache_key(
                '2027Q1', '2027Q1', ['t'], ['P'], configuration=cfg),
            'excluded source': lambda cfg: jira_server._excluded_capacity_stats_source_cache_key(
                None, [1], ['t'], 'project = A', ['f'], configuration=cfg),
            'excluded epic': lambda cfg: jira_server.excluded_capacity_epic_summary_cache_key(
                'A-1', configuration=cfg),
        }
        for name, build in builders.items():
            keys = [build(cfg) for cfg in variants] + [build(None)]
            self.assertEqual(len(set(keys)), len(keys), name)

    def test_context_object_and_dict_shapes_produce_one_segment(self):
        snapshot = ws.capture_virtual_bundle({})
        snapshot['promotionRevision'] = 1
        context = ws.resolve_work_configuration(
            SimpleNamespace(payload={'workConfigurations': snapshot}), quarter='2027Q1', flag_enabled=True)
        self.assertEqual(
            jira_server.work_configuration_cache_segment(context),
            jira_server.work_configuration_cache_segment(context.to_dict()))

    def test_work_key_keeps_the_auth_partition_prefix(self):
        context = SimpleNamespace(
            auth_mode='atlassian_oauth', workspace_id='w', auth_connection_id='c', user_id='u',
            cloud_id='cloud', token_version='1', project_access=())
        key = jira_server.build_work_cache_key(context, configuration(), 'missing-info', '101')
        self.assertTrue(cache_key_in_jira_home_partition(key, context))
        self.assertEqual(key[-1], 'cfg:delivery:1:d1')
        other = jira_server.build_work_cache_key(context, configuration(revision=2), 'missing-info', '101')
        self.assertNotEqual(key, other)

    def test_team_scope_digest_carries_the_configuration_digest(self):
        from backend.services.workspace_catalog_config import build_team_scope_digest
        base = dict(board_id='', projects=('PLAN',), team_field_id='customfield_24', base_jql='(x)')
        flat = build_team_scope_digest(**base)
        self.assertEqual(flat, build_team_scope_digest(**base, configuration_digest=None))
        self.assertNotEqual(flat, build_team_scope_digest(**base, configuration_digest='a'))
        self.assertNotEqual(build_team_scope_digest(**base, configuration_digest='a'),
                            build_team_scope_digest(**base, configuration_digest='b'))
        self.assertNotEqual(build_team_scope_digest(**base, configuration_digest='a', sprint_field_id='x'),
                            build_team_scope_digest(**base, configuration_digest='a', sprint_field_id='y'))


class RetirementTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(SCOPED_SPRINT_CATALOGS.clear)
        self.saved = {
            'projects': dict(jira_server.PROJECTS_CACHE), 'labels': dict(jira_server.LABELS_CACHE),
            'types': dict(jira_server.ISSUE_TYPES_CACHE), 'capacity': jira_server.CAPACITY_FIELD_CACHE,
        }
        self.addCleanup(self.restore)

    def restore(self):
        jira_server.PROJECTS_CACHE.update(self.saved['projects'])
        jira_server.LABELS_CACHE.update(self.saved['labels'])
        jira_server.ISSUE_TYPES_CACHE.update(self.saved['types'])
        jira_server.CAPACITY_FIELD_CACHE = self.saved['capacity']
        for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.TASKS_CACHE):
            cache.clear()

    def test_retires_only_work_caches_and_bumps_the_generation(self):
        work_caches = (
            jira_server.TASKS_CACHE, jira_server.SPRINTS_PROCESS_CACHE, jira_server.MISSING_INFO_CACHE,
            jira_server.DEPENDENCIES_CACHE, jira_server.EPIC_COHORT_CACHE,
            jira_server.EXCLUDED_CAPACITY_STATS_SOURCE_CACHE,
            jira_server.EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE, jira_server.EPM_ISSUES_CACHE,
            jira_server.EPM_ROLLUP_CACHE, jira_server.EPICS_SEARCH_CACHE,
        )
        for cache in work_caches:
            cache['k'] = {'timestamp': 1, 'data': 'x'}
        jira_server.COMPONENTS_CACHE.update(data=['c'], timestamp=5)
        jira_server.PROJECTS_CACHE.update(data=['p'], timestamp=5)
        jira_server.LABELS_CACHE.update(data=['l'], timestamp=5)
        jira_server.ISSUE_TYPES_CACHE.update(data=['t'], timestamp=5)
        jira_server.EPM_PROJECTS_CACHE['home'] = {'data': 'raw home metadata'}
        jira_server.CAPACITY_FIELD_CACHE = 'customfield_capacity'
        generation = jira_server.get_jira_issue_cache_generation()
        SCOPED_SPRINT_CATALOGS.begin('si1:mine', 'a', workspace_id='w1', config_digest='d')
        SCOPED_SPRINT_CATALOGS.publish('si1:mine', 'a', [{'id': 1}], workspace_id='w1', source_digest='s')
        SCOPED_SPRINT_CATALOGS.begin('si1:other', 'b', workspace_id='w2', config_digest='d')
        SCOPED_SPRINT_CATALOGS.publish('si1:other', 'b', [{'id': 2}], workspace_id='w2', source_digest='s')

        jira_server.retire_work_configuration_caches('test', workspace_id='w1')

        self.assertEqual(jira_server.get_jira_issue_cache_generation(), generation + 1)
        for cache in work_caches:
            self.assertEqual(cache, {}, cache)
        self.assertIsNone(jira_server.COMPONENTS_CACHE['data'])
        self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {'home': {'data': 'raw home metadata'}})
        self.assertEqual(jira_server.CAPACITY_FIELD_CACHE, 'customfield_capacity')
        for cache in (jira_server.PROJECTS_CACHE, jira_server.LABELS_CACHE, jira_server.ISSUE_TYPES_CACHE):
            self.assertIsNotNone(cache['data'])
        self.assertIsNone(SCOPED_SPRINT_CATALOGS.snapshot('si1:mine').payload)
        self.assertEqual(SCOPED_SPRINT_CATALOGS.snapshot('si1:other').payload, [{'id': 2}])

    def test_publication_started_before_the_retirement_is_dropped(self):
        generation = jira_server.get_jira_issue_cache_generation()
        jira_server.retire_work_configuration_caches('test')
        self.assertNotEqual(jira_server.get_jira_issue_cache_generation(), generation,
                            'readers compare this snapshot before storing a late result')


class CommittedSaveRetirementTests(WorkStructureRouteBase):
    def test_committed_save_retires_work_caches_not_raw_metadata(self):
        self.promoted_seed(revision=3)
        jira_server.TASKS_CACHE['k'] = {'timestamp': 1, 'data': 'x'}
        jira_server.EPM_PROJECTS_CACHE['home'] = {'data': 'raw'}
        self.addCleanup(jira_server.TASKS_CACHE.clear)
        self.addCleanup(jira_server.EPM_PROJECTS_CACHE.clear)
        SCOPED_SPRINT_CATALOGS.begin('si1:x', 'a', workspace_id=self.workspace_id, config_digest='d')
        SCOPED_SPRINT_CATALOGS.publish('si1:x', 'a', [{'id': 1}], workspace_id=self.workspace_id,
                                       source_digest='s')
        self.addCleanup(SCOPED_SPRINT_CATALOGS.clear)
        current = self.client.get('/api/work-structure/config').get_json()
        bundle = deepcopy(current['workConfigurations'])
        bundle['configurations'][1]['name'] = 'DELIVERY 2'
        with patch.object(jira_server, 'clear_auth_sensitive_caches') as clear_all:
            saved = self.client.post('/api/work-structure/config', headers=self.headers(), json={
                'baseRevision': current['configRevision'], 'workConfigurations': bundle})
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        clear_all.assert_not_called()
        self.assertEqual(jira_server.TASKS_CACHE, {})
        self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {'home': {'data': 'raw'}})
        self.assertIsNone(SCOPED_SPRINT_CATALOGS.snapshot('si1:x').payload)

    def test_rejected_save_retires_nothing(self):
        self.promoted_seed(revision=3)
        jira_server.TASKS_CACHE['k'] = {'timestamp': 1, 'data': 'x'}
        self.addCleanup(jira_server.TASKS_CACHE.clear)
        current = self.client.get('/api/work-structure/config').get_json()
        response = self.client.post('/api/work-structure/config', headers=self.headers(), json={
            'baseRevision': current['configRevision'] - 1,
            'workConfigurations': current['workConfigurations']})
        self.assertEqual(response.status_code, 409)
        self.assertIn('k', jira_server.TASKS_CACHE)


if __name__ == '__main__':
    unittest.main()
