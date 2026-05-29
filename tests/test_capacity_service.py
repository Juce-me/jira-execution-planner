import unittest

from backend.services import capacity


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or str(self._payload)

    def json(self):
        return self._payload


class TestCapacityService(unittest.TestCase):
    def test_build_capacity_jql_escapes_sprint_and_team_names(self):
        self.assertEqual(
            capacity.build_capacity_jql('Sprint "42"', ['Alpha "A"', ' ', 'Beta'], capacity_project='CAP'),
            'project = "CAP" AND (summary ~ "\\"Team info Sprint \\"42\\" - Alpha \\"A\\"\\"" OR summary ~ "\\"Team info Sprint \\"42\\" - Beta\\"")',
        )

    def test_fetch_capacity_disabled_when_project_or_field_missing(self):
        self.assertEqual(
            capacity.fetch_capacity_for_sprint(
                '2026Q2',
                None,
                capacity_project='',
                resolve_capacity_field_id=lambda _headers: 'customfield_capacity',
                search_request=lambda _payload: self.fail('should not search'),
            ),
            ({'enabled': False, 'capacities': {}}, None),
        )
        self.assertEqual(
            capacity.fetch_capacity_for_sprint(
                '2026Q2',
                None,
                capacity_project='CAP',
                resolve_capacity_field_id=lambda _headers: '',
                search_request=lambda _payload: self.fail('should not search'),
            ),
            ({'enabled': False, 'capacities': {}, 'message': 'Missing Team capacity field ID'}, None),
        )

    def test_fetch_capacity_chunks_teams_and_returns_debug_payload(self):
        calls = []

        def search_request(payload):
            calls.append(payload)
            return FakeResponse(200, {
                'issues': [{
                    'key': 'CAP-1',
                    'fields': {
                        'summary': 'Team info 2026Q2 - R&D Product - Alpha',
                        'customfield_capacity': '5.5',
                    },
                }]
            })

        payload, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            debug=True,
            team_names=[f'Team {idx}' for idx in range(21)],
            capacity_project='CAP',
            resolve_capacity_field_id=lambda _headers: 'customfield_capacity',
            search_request=search_request,
        )

        self.assertIsNone(error)
        self.assertEqual(len(calls), 2)
        self.assertEqual(payload['capacities'], {'Alpha': 5.5})
        self.assertEqual(payload['debug']['issueCount'], 2)
        self.assertEqual(payload['debug']['fieldId'], 'customfield_capacity')
        self.assertIsInstance(payload['debug']['jql'], list)

    def test_fetch_capacity_returns_upstream_error_text(self):
        payload, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            capacity_project='CAP',
            resolve_capacity_field_id=lambda _headers: 'customfield_capacity',
            search_request=lambda _payload: FakeResponse(500, text='jira down'),
        )

        self.assertIsNone(payload)
        self.assertEqual(error, 'jira down')

    def test_fetch_capacity_team_sizes_uses_watches_and_watcher_fallback(self):
        watcher_calls = []

        def watcher_count(issue_key):
            watcher_calls.append(issue_key)
            return 4

        payload = {
            'issues': [
                {
                    'key': 'CAP-1',
                    'fields': {
                        'summary': 'Team info 2026Q2 - Alpha',
                        'watches': {'watchCount': 3},
                        'reporter': {'displayName': 'Owner A'},
                    },
                },
                {
                    'key': 'CAP-2',
                    'fields': {
                        'summary': 'Team info 2026Q2 - Tech - Beta',
                        'watches': {},
                        'reporter': {'displayName': 'Owner B'},
                    },
                },
            ],
        }

        sizes, details = capacity.fetch_capacity_team_sizes(
            '2026Q2',
            None,
            capacity_project='CAP',
            search_request=lambda _payload: FakeResponse(200, payload),
            fetch_watchers_count=watcher_count,
        )

        self.assertEqual(sizes, {'Alpha': 3, 'Beta': 4})
        self.assertEqual(details['Alpha']['reporter'], 'Owner A')
        self.assertEqual(details['Beta']['issue_key'], 'CAP-2')
        self.assertEqual(watcher_calls, ['CAP-2'])

    def test_fetch_watchers_count_handles_counts_lists_and_errors(self):
        self.assertEqual(
            capacity.fetch_watchers_count(
                'CAP-1',
                current_jira_get=lambda _path, timeout=20: FakeResponse(200, {'watchCount': 7}),
            ),
            7,
        )
        self.assertEqual(
            capacity.fetch_watchers_count(
                'CAP-1',
                current_jira_get=lambda _path, timeout=20: FakeResponse(200, {'watchers': [{}, {}]}),
            ),
            2,
        )
        warnings = []
        self.assertIsNone(
            capacity.fetch_watchers_count(
                'CAP-1',
                current_jira_get=lambda _path, timeout=20: FakeResponse(404, {}),
                log_warning_fn=warnings.append,
            )
        )
        self.assertEqual(warnings, ['Watchers fetch failed: status=404'])


if __name__ == '__main__':
    unittest.main()
