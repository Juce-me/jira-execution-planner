import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import jira_server


def _response(status, payload=None):
    response = Mock()
    response.status_code = status
    response.json.return_value = payload or {}
    return response


COMBINED = SimpleNamespace(is_legacy=False, uses_epic_link=False, sprint_field_id='customfield_10020',
                           non_parent_clause=lambda: 'issuetype != Initiative',
                           sprint_clause=lambda sprint: f'Sprint = {sprint}')
LEGACY = SimpleNamespace(is_legacy=True)


class ChildDataCompletenessTests(unittest.TestCase):
    def test_failed_child_page_is_recorded_not_raised(self):
        with patch.object(jira_server, 'jira_search_request', return_value=_response(503)):
            failures = []
            counts = jira_server.fetch_story_counts_for_epics(['P-1'], {}, None, failures=failures, roles=COMBINED)
            self.assertEqual(counts, {'P-1': 0})
            self.assertEqual(failures, [503])
            failures = []
            jira_server.fetch_story_distribution_for_epics(['P-1'], {}, None, '', failures=failures, roles=COMBINED)
            self.assertTrue(failures)
            self.assertEqual(set(failures), {503})

    def test_partial_read_marks_combined_parent_incomplete(self):
        epic = {'key': 'P-1', 'openChildCount': 0}
        jira_server.mark_child_data_completeness(epic, COMBINED, [503])
        self.assertIs(epic['childDataComplete'], False)

    def test_complete_read_marks_combined_parent_complete(self):
        epic = {'key': 'P-1'}
        jira_server.mark_child_data_completeness(epic, COMBINED, [])
        self.assertIs(epic['childDataComplete'], True)

    def test_legacy_and_unscoped_payloads_are_unchanged(self):
        for roles in (LEGACY, None):
            epic = {'key': 'E-1'}
            jira_server.mark_child_data_completeness(epic, roles, [503])
            self.assertNotIn('childDataComplete', epic)


if __name__ == '__main__':
    unittest.main()
