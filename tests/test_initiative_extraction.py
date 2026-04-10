import unittest
from unittest.mock import patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    jira_server = None
    _IMPORT_ERROR = exc


class DummyResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestInitiativeExtraction(unittest.TestCase):

    @patch('jira_server.jira_search_request')
    def test_epic_with_initiative_parent(self, mock_search):
        """Epic whose parent is an Initiative should include initiative in details."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-100',
                'fields': {
                    'summary': 'Payment Gateway v2',
                    'reporter': {'displayName': 'Alice'},
                    'assignee': {'displayName': 'Bob'},
                    'customfield_10011': None,
                    'parent': {
                        'key': 'INIT-42',
                        'fields': {
                            'summary': 'Payments Initiative',
                            'issuetype': {
                                'name': 'Initiative',
                                'hierarchyLevel': 0
                            }
                        }
                    }
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-100'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('PROD-100', result)
        epic = result['PROD-100']
        self.assertIn('initiative', epic)
        self.assertEqual(epic['initiative']['key'], 'INIT-42')
        self.assertEqual(epic['initiative']['summary'], 'Payments Initiative')

    @patch('jira_server.jira_search_request')
    def test_epic_without_initiative_parent(self, mock_search):
        """Epic with no parent should not have initiative field."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-200',
                'fields': {
                    'summary': 'Standalone Epic',
                    'reporter': {'displayName': 'Carol'},
                    'assignee': None,
                    'customfield_10011': None
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-200'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('PROD-200', result)
        self.assertNotIn('initiative', result['PROD-200'])

    @patch('jira_server.jira_search_request')
    def test_epic_with_non_initiative_parent(self, mock_search):
        """Epic whose parent is NOT an Initiative (e.g. another Epic) should not include initiative."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-300',
                'fields': {
                    'summary': 'Sub-epic',
                    'reporter': {'displayName': 'Dave'},
                    'assignee': None,
                    'customfield_10011': None,
                    'parent': {
                        'key': 'PROD-50',
                        'fields': {
                            'summary': 'Parent Epic',
                            'issuetype': {
                                'name': 'Epic',
                                'hierarchyLevel': 1
                            }
                        }
                    }
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-300'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('PROD-300', result)
        self.assertNotIn('initiative', result['PROD-300'])

    @patch('jira_server.jira_search_request')
    def test_initiative_detected_by_hierarchy_level_zero(self, mock_search):
        """Parent with hierarchyLevel 0 but non-'Initiative' name should still be detected."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-400',
                'fields': {
                    'summary': 'Some Epic',
                    'reporter': None,
                    'assignee': None,
                    'customfield_10011': None,
                    'parent': {
                        'key': 'BIZ-10',
                        'fields': {
                            'summary': 'Business Goal',
                            'issuetype': {
                                'name': 'Feature',
                                'hierarchyLevel': 0
                            }
                        }
                    }
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-400'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('initiative', result['PROD-400'])
        self.assertEqual(result['PROD-400']['initiative']['key'], 'BIZ-10')


if __name__ == '__main__':
    unittest.main()
