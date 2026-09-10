"""Regression checks for bounded sprint bootstrap discovery."""
import unittest
from backend.services import sprints


class AuthError(Exception):
    pass


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class SprintLoadingTests(unittest.TestCase):
    def test_repeated_search_token_fails_before_requesting_same_page_again(self):
        payloads = []
        def search(payload):
            payloads.append(payload)
            # The third response is a safety valve for the unfixed unbounded
            # loop; it must never be requested after the token repeats.
            return FakeResponse(200, {'issues': [], 'isLast': len(payloads) > 2,
                                      **({'nextPageToken': 'same'} if len(payloads) <= 2 else {})})
        with self.assertRaises(ValueError):
            sprints._collect_sprints_by_jql(
                'project = TEST', {}, jira_search_request=search,
                get_sprint_field_id=lambda: 'customfield_10020',
            )
        self.assertEqual(2, len(payloads))

    def test_complete_fallback_scan_does_not_rescan_closed_future_and_active_subsets(self):
        payloads = []
        def search(payload):
            payloads.append(payload)
            return FakeResponse(200, {'issues': [{'fields': {'customfield_10020': [
                {'id': 101, 'name': '2026Q1', 'state': 'closed'},
                {'id': 102, 'name': '2026Q2', 'state': 'active'},
                {'id': 103, 'name': '2026Q3', 'state': 'future'},
            ]}}], 'isLast': True})
        result = sprints.fetch_sprints_from_jira(
            board_id='', stats_jql_base='project = TEST', product_project='TEST', tech_project='TECH',
            jira_get=lambda *_args, **_kwargs: self.fail('No board configured'),
            jira_search_request=search, get_sprint_field_id=lambda: 'customfield_10020',
            strip_sprint_clause=lambda jql: jql,
            add_clause_to_jql=lambda jql, clause: f'{jql} AND {clause}', auth_error_class=AuthError,
        )
        self.assertEqual([103, 102, 101], [sprint['id'] for sprint in result])
        self.assertEqual(1, len(payloads), 'Complete base scan already includes every sprint state')
        self.assertEqual('project = TEST AND Sprint is not EMPTY', payloads[0]['jql'])

    def test_failed_later_page_does_not_return_a_partial_catalog(self):
        responses = iter([
            FakeResponse(200, {
                'issues': [{'fields': {'customfield_10020': [
                    {'id': 101, 'name': '2026Q1', 'state': 'closed'},
                ]}}],
                'isLast': False,
                'nextPageToken': 'page-2',
            }),
            FakeResponse(503, {}),
        ])

        with self.assertRaisesRegex(ValueError, 'search failed'):
            sprints._collect_sprints_by_jql(
                'project = TEST AND Sprint is not EMPTY', {},
                jira_search_request=lambda _payload: next(responses),
                get_sprint_field_id=lambda: 'customfield_10020',
            )

    def test_nonterminal_page_without_a_token_does_not_return_a_partial_catalog(self):
        response = FakeResponse(200, {
            'issues': [{'fields': {'customfield_10020': [
                {'id': 101, 'name': '2026Q1', 'state': 'closed'},
            ]}}],
            'isLast': False,
        })

        with self.assertRaisesRegex(ValueError, 'page token'):
            sprints._collect_sprints_by_jql(
                'project = TEST AND Sprint is not EMPTY', {},
                jira_search_request=lambda _payload: response,
                get_sprint_field_id=lambda: 'customfield_10020',
            )
