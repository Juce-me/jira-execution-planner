"""Allocation option values for the DELIVERY Product/Tech mapping (GET /api/work-structure/allocation-options)."""

from contextlib import ExitStack
from unittest.mock import patch

import jira_server
from tests.test_work_structure_routes import WorkStructureRouteBase, jira_response

PATH = '/api/work-structure/allocation-options'
VALID = '?fieldId=customfield_12345&projectKey=PLAN&issueTypeId=10001'
CREATEMETA = '/rest/api/3/issue/createmeta/PLAN/issuetypes/10001'
AUTOCOMPLETE = '/rest/api/3/jql/autocompletedata/suggestions'


class AllocationOptionsTests(WorkStructureRouteBase):
    def jira(self, routes, stack=None):
        calls = []

        def get(path, **options):
            calls.append((path, options.get('params')))
            return routes[path]
        (stack or self.stack).enter_context(patch.object(jira_server, 'current_jira_get', side_effect=get))
        return calls

    def test_createmeta_lists_the_complete_option_set(self):
        calls = self.jira({CREATEMETA: jira_response(200, {'fields': [
            {'fieldId': 'customfield_99', 'allowedValues': [{'value': 'Other'}]},
            {'fieldId': 'customfield_12345', 'allowedValues': [{'value': 'Growth'}, {'value': 'Platform'}, {'id': '7'}]},
        ]})})
        response = self.client.get(PATH + VALID)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'options': [{'value': 'Growth'}, {'value': 'Platform'}], 'source': 'createmeta', 'complete': True,
        })
        self.assertEqual([path for path, _ in calls], [CREATEMETA])

    def test_query_filters_createmeta_values(self):
        self.jira({CREATEMETA: jira_response(200, {'fields': [
            {'fieldId': 'customfield_12345', 'allowedValues': [{'value': 'Growth'}, {'value': 'Platform'}]},
        ]})})
        body = self.client.get(PATH + VALID + '&query=plat').get_json()
        self.assertEqual(body['options'], [{'value': 'Platform'}])

    def test_createmeta_denied_falls_back_to_autocomplete(self):
        calls = self.jira({
            CREATEMETA: jira_response(403, {'errorMessages': ['secret detail']}),
            AUTOCOMPLETE: jira_response(200, {'results': [{'value': '"Growth"'}, {'value': 'Platform'}, {'value': ''}]}),
        })
        response = self.client.get(PATH + VALID + '&query=G')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'options': [{'value': 'Growth'}, {'value': 'Platform'}], 'source': 'autocomplete', 'complete': False,
        })
        self.assertEqual(calls[1], (AUTOCOMPLETE, {'fieldName': 'cf[12345]', 'fieldValue': 'G'}))

    def test_field_missing_from_createmeta_falls_back_to_autocomplete(self):
        self.jira({
            CREATEMETA: jira_response(200, {'fields': [{'fieldId': 'customfield_99', 'allowedValues': []}]}),
            AUTOCOMPLETE: jira_response(200, {'results': [{'value': 'Growth'}]}),
        })
        body = self.client.get(PATH + VALID).get_json()
        self.assertEqual(body['source'], 'autocomplete')

    def test_without_project_and_type_only_autocomplete_runs(self):
        calls = self.jira({AUTOCOMPLETE: jira_response(200, {'results': [{'value': 'Growth'}]})})
        body = self.client.get(PATH + '?fieldId=customfield_12345').get_json()
        self.assertEqual(body['source'], 'autocomplete')
        self.assertEqual([path for path, _ in calls], [AUTOCOMPLETE])

    def test_both_sources_failing_is_an_empty_typed_value_answer(self):
        self.jira({
            CREATEMETA: jira_response(500, text='upstream boom'),
            AUTOCOMPLETE: jira_response(400, {'errorMessages': ['upstream detail']}),
        })
        response = self.client.get(PATH + VALID)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'options': [], 'source': None, 'complete': False})
        self.assertNotIn('upstream', response.get_data(as_text=True))

    def test_createmeta_field_without_listed_values_falls_back_to_autocomplete(self):
        for field in ({'fieldId': 'customfield_12345'}, {'fieldId': 'customfield_12345', 'allowedValues': []}):
            with self.subTest(field=field), ExitStack() as stack:
                calls = self.jira({
                    CREATEMETA: jira_response(200, {'fields': [field]}),
                    AUTOCOMPLETE: jira_response(200, {'results': [{'value': 'Growth'}]}),
                }, stack)
                body = self.client.get(PATH + VALID).get_json()
                self.assertEqual(body, {'options': [{'value': 'Growth'}], 'source': 'autocomplete', 'complete': False})
                self.assertEqual([path for path, _ in calls], [CREATEMETA, AUTOCOMPLETE])

    def test_createmeta_transport_failure_falls_back_to_autocomplete(self):
        def get(path, **options):
            if path == CREATEMETA:
                raise TimeoutError('createmeta timed out')
            return jira_response(200, {'results': [{'value': 'Growth'}]})
        self.stack.enter_context(patch.object(jira_server, 'current_jira_get', side_effect=get))
        body = self.client.get(PATH + VALID).get_json()
        self.assertEqual(body['source'], 'autocomplete')

    def test_expired_jira_sign_in_is_terminal_401_from_either_source(self):
        for routes, query in (({CREATEMETA: jira_response(401, {})}, VALID),
                              ({AUTOCOMPLETE: jira_response(401, {})}, '?fieldId=customfield_12345')):
            with self.subTest(query=query), ExitStack() as stack:
                self.jira(routes, stack)
                response = self.client.get(PATH + query)
                self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'auth_required')

    def test_bad_parameters_are_rejected_without_jira_io(self):
        self.stack.enter_context(patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('Jira I/O')))
        for query in ('', '?fieldId=summary', '?fieldId=customfield_1x',
                      '?fieldId=customfield_1&projectKey=PL AN&issueTypeId=1',
                      '?fieldId=customfield_1&projectKey=PLAN&issueTypeId=abc',
                      '?fieldId=customfield_1&query=' + 'x' * 256):
            response = self.client.get(PATH + query)
            self.assertEqual(response.status_code, 400, query)
            self.assertEqual(response.get_json()['error'], 'invalid_allocation_options_request')

    def test_unauthenticated_is_terminal_401(self):
        response = jira_server.app.test_client().get(PATH + VALID)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')


class AllocationOptionsFlagTests(WorkStructureRouteBase):
    flag = 'false'

    def test_flag_off_unpromoted_workspace_reads_nothing(self):
        with patch.object(jira_server, 'current_jira_get') as jira_get:
            response = self.client.get(PATH + VALID)
        self.assertEqual((response.status_code, response.get_json()['error']),
                         (409, 'configuration_feature_disabled'))
        jira_get.assert_not_called()

    def test_flag_off_promoted_workspace_reads_nothing(self):
        self.promoted_seed()
        with patch.object(jira_server, 'current_jira_get') as jira_get:
            response = self.client.get(PATH + VALID)
        self.assertEqual((response.status_code, response.get_json()['error']),
                         (409, 'configuration_feature_disabled'))
        jira_get.assert_not_called()
