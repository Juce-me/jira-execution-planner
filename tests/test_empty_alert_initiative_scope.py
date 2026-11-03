"""Empty-Initiative discovery must be scoped to the Department's Team aliases (no project-wide fallback)."""
import unittest
from unittest.mock import Mock, patch

import jira_server
from tests.test_planning_work_profiles import roles


class EmptyAlertInitiativeScopeTests(unittest.TestCase):
    def fetch(self, labels):
        scan = Mock(return_value=[{'key': 'PLAN-1'}])
        with patch.object(jira_server, 'fetch_epics_for_alert_scope_service', scan):
            result = jira_server.fetch_epics_for_empty_alert(
                'project = PLAN', {}, 'customfield_30101', 'name', 'customfield_10101',
                ['team-1'], labels, '2027Q1', roles=roles())
        return result, scan

    def test_no_team_aliases_discovers_no_initiatives(self):
        result, scan = self.fetch([])
        self.assertEqual(result, [])
        scan.assert_not_called()

    def test_team_aliases_scope_the_initiative_query(self):
        result, scan = self.fetch(['dept_label'])
        self.assertEqual(result, [{'key': 'PLAN-1'}])
        self.assertIn('labels = "dept_label"', scan.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
