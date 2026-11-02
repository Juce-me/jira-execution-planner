"""Range-agnostic Sprint values for the Scope boundary pickers (GET /api/work-structure/sprint-values)."""

import os
from copy import deepcopy
from unittest.mock import patch

import jira_server
from backend.config.repository import ConfigStorageError
from tests.test_work_structure_catalogs import (
    DELIVERY_BOARD_PATH, DELIVERY_SPRINT_FIELD, CatalogBase, FakeJira, board_page, issue, sprint_value,
)
from tests.test_work_structure_routes import jira_response

PATH = '/api/work-structure/sprint-values'
ROW_KEYS = {'value', 'canonical', 'state', 'sprintIds', 'configurationIds'}


class SprintValueReadTests(CatalogBase):
    def warm(self, *, delivery_board=True, board_values=None, delivery_board_values=None, scan=None):
        self.seed_sources()
        if delivery_board:
            from backend.db import models
            with self.factory() as session:
                row = session.query(models.WorkspaceDashboardConfig).one()
                payload = deepcopy(row.payload)
                legacy, delivery = payload['workConfigurations']['configurations']
                legacy['throughQuarter'], delivery['fromQuarter'] = '2026Q3', '2026Q4'
                delivery['scope']['boardId'] = '19095'
                row.payload = payload
                session.commit()
        fake = FakeJira(
            board_values=board_values if board_values is not None else [
                {**sprint_value(101, '2026Q3', 'closed'), 'originBoardId': 7001},
                {**sprint_value(90, '2019Q1', 'closed'), 'originBoardId': 7001},
                {**sprint_value(91, '0000Q1', 'closed'), 'originBoardId': 7001}],
            scan_pages=scan if scan is not None else [{'issues': [
                issue(**{DELIVERY_SPRINT_FIELD: [sprint_value(45459, '2027Q1', 'future'),
                                                 sprint_value(777, '2030Q4', 'future')]})], 'isLast': True}])
        plain = fake.get
        values = delivery_board_values if delivery_board_values is not None else [
            {**sprint_value(99, '2026Q4', 'closed'), 'originBoardId': 19095}]

        def get(path, **options):
            if path == DELIVERY_BOARD_PATH:
                return jira_response(200, board_page(values))
            return plain(path, **options)
        fake.get = get
        self.jira(fake)
        self.assertEqual(self.sprints().status_code, 200)
        return fake

    def read(self, client=None, query=''):
        return (client or self.client).get(PATH + query)

    def test_union_is_range_agnostic_sanitized_and_never_reads_jira(self):
        self.warm()
        with patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('Jira I/O')), \
             patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('Jira I/O')):
            response = self.read()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        body = response.get_json()
        self.assertEqual(set(body), {'sprintValues', 'sources', 'promoted'})
        self.assertTrue(body['promoted'])
        by_value = {row['value']: row for row in body['sprintValues']}
        # Values outside either saved range are listed, so a boundary can move past the current range.
        self.assertEqual(sorted(by_value), ['0000Q1', '2019Q1', '2026Q3', '2026Q4', '2027Q1', '2030Q4'])
        self.assertEqual([row['value'] for row in body['sprintValues']], sorted(by_value, reverse=True))
        self.assertTrue(all(set(row) == ROW_KEYS for row in body['sprintValues']))
        self.assertEqual(by_value['2027Q1']['sprintIds'], [45459])
        self.assertEqual(by_value['2027Q1']['configurationIds'], ['delivery'])
        self.assertEqual(by_value['2027Q1']['state'], 'future')
        self.assertTrue(by_value['2026Q4']['canonical'])
        self.assertFalse(by_value['0000Q1']['canonical'])
        self.assertEqual([(item['configurationId'], item['state']) for item in body['sources']],
                         [('legacy', 'ready'), ('delivery', 'ready')])
        text = response.get_data(as_text=True)
        for forbidden in ('19095', '7001', 'PLAN', 'OLD', 'one.example.test', 'customfield', 'cloud-one'):
            self.assertNotIn(forbidden, text)

    def test_setup_required_and_pending_sources_are_reported_not_errors(self):
        self.seed_sources(delivery_ready=False, legacy_ready=True)
        response = self.read()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['sprintValues'], [])
        self.assertEqual([(item['configurationId'], item['state']) for item in body['sources']],
                         [('legacy', 'pending'), ('delivery', 'setup_required')])

    def test_policy_errors_and_flag_states(self):
        self.warm()
        for query in ('?quarter=2027Q1', '?refresh=true', '?configurationId=delivery'):
            with self.subTest(query):
                response = self.read(query=query)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()['error'], 'unsupported_catalog_parameter')
        self.assertEqual(self.read(self.member).status_code, 200, 'authenticated read, not admin only')
        self.assertIn(self.client.post(PATH, headers=self.headers()).status_code, (405, 501), 'read-only route')
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            promoted_off = self.read()
        self.assertEqual((promoted_off.status_code, promoted_off.get_json()['error']),
                         (409, 'configuration_feature_disabled'))
        anonymous = jira_server.app.test_client().get(PATH)
        self.assertEqual((anonymous.status_code, anonymous.get_json()['error']), (401, 'auth_required'))
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            basic = jira_server.app.test_client().get(PATH)
        self.assertEqual((basic.status_code, basic.get_json()['error']), (409, 'work_configuration_setup_required'))

    def test_unpromoted_states_never_reach_a_json_loader(self):
        self.seed(promoted=False)
        enabled = self.read()
        self.assertEqual(enabled.status_code, 200, enabled.get_data(as_text=True))
        self.assertFalse(enabled.get_json()['promoted'])
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            disabled = self.read()
        self.assertEqual((disabled.status_code, disabled.get_json()['error']),
                         (409, 'configuration_feature_disabled'))
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()

    def test_storage_failure_is_a_fixed_503(self):
        self.warm()
        with patch.object(jira_server, 'resolve_request_catalog_sources', side_effect=ConfigStorageError('db')):
            response = self.read()
        self.assertEqual((response.status_code, response.get_json()['error']), (503, 'config_storage_unavailable'))
        self.assertNotIn('db', response.get_json().get('message', '').split())
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()
