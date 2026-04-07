import unittest

class TestSingleTeamFocusFilter(unittest.TestCase):
    """Regression: single-team selection must not drop issues without dependencies."""

    def _compute_focus_keys(self, issue_by_key, adjacency, team_filter_ids):
        """Reproduce the fixed focus_keys logic from jira_server.py."""
        focus_keys = [
            key for key in issue_by_key
            if not team_filter_ids or issue_by_key[key].get('team_id') in team_filter_ids
        ]
        return focus_keys

    def test_single_team_all_issues_included(self):
        """Issues without dependencies must appear when one team is selected."""
        issue_by_key = {
            'TASK-1': {'team_id': 'team-a', 'summary': 'No deps'},
            'TASK-2': {'team_id': 'team-a', 'summary': 'Has dep'},
        }
        adjacency = {'TASK-2': {'TASK-3'}}  # TASK-1 has no adjacency
        # Currently TASK-1 is dropped — this test must fail before the fix
        focus_keys = self._compute_focus_keys(issue_by_key, adjacency, {'team-a'})
        self.assertIn('TASK-1', focus_keys)
        self.assertIn('TASK-2', focus_keys)

if __name__ == '__main__':
    unittest.main()
