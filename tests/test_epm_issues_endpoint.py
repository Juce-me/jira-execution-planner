import unittest
from unittest.mock import patch

import jira_server


class TestEpmIssuesEndpoint(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        jira_server.EPM_ISSUES_CACHE.clear()

    def test_active_missing_sprint_returns_400_without_project_lookup(self):
        with patch.object(jira_server, 'find_epm_project_or_404') as mock_find:
            response = self.client.get('/api/epm/projects/hp-1/issues?tab=active')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'error': 'sprint_required'})
        mock_find.assert_not_called()


if __name__ == '__main__':
    unittest.main()
