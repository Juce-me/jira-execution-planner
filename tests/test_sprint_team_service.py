import json
import unittest
from unittest.mock import patch

import requests

from backend.services import sprint_teams


class _Budget:
    def __init__(self):
        self.phases = []

    def check(self, phase):
        self.phases.append(phase)

    def remaining(self, phase):
        self.phases.append(phase)
        return 30


def _response(payload, status=200):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps(payload).encode()
    return response


class SprintTeamServiceTests(unittest.TestCase):
    def fetch(self, pages, **kwargs):
        calls = []

        def search(payload):
            calls.append(payload)
            return _response(pages[len(calls) - 1])

        result = sprint_teams.fetch_sprint_teams(
            sprint_id='101', base_jql='project = DEMO',
            team_field_id='customfield_10001', jira_search=search,
            directory=kwargs.get('directory', {}), budget=_Budget(),
        )
        return result, calls

    def test_complete_empty_membership(self):
        teams, calls = self.fetch([{'issues': [], 'isLast': True}])
        self.assertEqual(teams, [])
        self.assertEqual(calls, [{
            'jql': '(project = DEMO) AND Sprint = 101',
            'fields': ['customfield_10001'], 'maxResults': 100,
        }])

    def test_next_page_token_required_and_unique(self):
        pages = [
            {'issues': [], 'isLast': False, 'nextPageToken': 'next'},
            {'issues': [], 'isLast': True},
        ]
        teams, calls = self.fetch(pages)
        self.assertEqual(teams, [])
        self.assertEqual(calls[1], {**calls[0], 'nextPageToken': 'next'})
        self.assertNotIn('startAt', calls[1])
        for invalid in (
            {'issues': [], 'isLast': False},
            {'issues': [], 'isLast': False, 'nextPageToken': ''},
            {'issues': [], 'isLast': True, 'nextPageToken': 'unexpected'},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(sprint_teams.TeamCatalogFetchError):
                self.fetch([invalid])
        repeated = [
            {'issues': [], 'isLast': False, 'nextPageToken': 'same'},
            {'issues': [], 'isLast': False, 'nextPageToken': 'same'},
        ]
        with self.assertRaises(sprint_teams.TeamCatalogFetchError):
            self.fetch(repeated)

    def test_nonfinal_page_and_row_caps_fail(self):
        with patch.object(sprint_teams, 'TEAM_MAX_PAGES', 1):
            with self.assertRaises(sprint_teams.TeamCatalogFetchError):
                self.fetch([{'issues': [], 'isLast': False, 'nextPageToken': 'next'}])
        issues = [{'fields': {'customfield_10001': None}}] * 101
        with self.assertRaises(sprint_teams.TeamCatalogFetchError):
            self.fetch([{'issues': issues, 'isLast': True}])
        with patch.object(sprint_teams, 'TEAM_MAX_ROWS', 1):
            with self.assertRaises(sprint_teams.TeamCatalogFetchError):
                self.fetch([{'issues': issues[:2], 'isLast': True}])

    def test_scalar_dict_list_team_values(self):
        issues = [
            {'fields': {'customfield_10001': ' team-a '}},
            {'fields': {'customfield_10001': 42}},
            {'fields': {'customfield_10001': {'id': 'team-b', 'name': ' Beta '}}},
            {'fields': {'customfield_10001': [
                {'id': 'team-c', 'name': 'Charlie'}, 'team-d', 43,
            ]}},
            {'fields': {'customfield_10001': None}},
        ]
        teams, _ = self.fetch([{'issues': issues, 'isLast': True}])
        self.assertEqual({item['id'] for item in teams}, {'team-a', '42', 'team-b', 'team-c', 'team-d', '43'})

    def test_invalid_nonnull_team_shape_fails(self):
        invalid_values = ['', 0, -1, True, {}, {'id': ''}, {'name': 'No id'}, [[]]]
        for value in invalid_values:
            with self.subTest(value=repr(value)):
                payload = {'issues': [{'fields': {'customfield_10001': value}}], 'isLast': True}
                with self.assertRaises(sprint_teams.TeamCatalogFetchError):
                    self.fetch([payload])

    def test_issue_then_directory_then_id_names_trim_only(self):
        directory = {
            'a': {'id': 'a', 'name': ' Directory A '},
            'b': {'id': 'b', 'name': ' Directory B '},
        }
        issues = [
            {'fields': {'customfield_10001': {'id': 'a', 'name': ' Issue A '}}},
            {'fields': {'customfield_10001': 'b'}},
            {'fields': {'customfield_10001': 'c'}},
        ]
        teams, _ = self.fetch([{'issues': issues, 'isLast': True}], directory=directory)
        self.assertEqual(teams, [
            {'id': 'c', 'name': 'c'},
            {'id': 'b', 'name': 'Directory B'},
            {'id': 'a', 'name': 'Issue A'},
        ])
        self.assertEqual(teams.issue_names, {'a': 'Issue A'})

    def test_duplicate_names_have_deterministic_winner(self):
        issues = [
            {'fields': {'customfield_10001': {'id': 'a', 'name': 'Zulu'}}},
            {'fields': {'customfield_10001': {'id': 'a', 'name': ' alpha '}}},
            {'fields': {'customfield_10001': {'id': 'a', 'name': 'Beta'}}},
        ]
        teams, _ = self.fetch([{'issues': issues, 'isLast': True}])
        self.assertEqual(teams, [{'id': 'a', 'name': 'Beta'}])


if __name__ == '__main__':
    unittest.main()
