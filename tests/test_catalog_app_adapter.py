import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from backend.services.catalog_app_adapter import CatalogAppAdapter


class CatalogAppAdapterTests(unittest.TestCase):
    def test_resolver_uses_public_runtime_inputs_provider_at_call_time(self):
        captured = []

        def resolve(_session, _context, **kwargs):
            captured.append(kwargs)
            return kwargs['runtime_inputs']

        namespace = {
            'resolve_effective_catalog_config': resolve,
            'catalog_runtime_inputs': Mock(return_value={
                'jql_query': 'project = NEW',
                'jira_board_id': '42',
                'team_field_default': 'customfield_10001',
                'sprint_field_default': 'customfield_10020',
            }),
            '_load_dashboard_config_json': Mock(),
            'JIRA_URL': 'https://jira.example.test',
        }
        adapter = CatalogAppAdapter(namespace)

        result = adapter.resolve_request_config(object(), object())

        self.assertEqual(result['jql_query'], 'project = NEW')
        namespace['catalog_runtime_inputs'].assert_called_once_with()
        self.assertIs(captured[0]['fallback_loader'], namespace['_load_dashboard_config_json'])
        self.assertEqual(captured[0]['legacy_site_url'], 'https://jira.example.test')

    def test_team_search_timeout_is_capped_by_same_remaining_budget(self):
        for remaining, expected_timeout in ((30, 15), (7.5, 7.5)):
            with self.subTest(remaining=remaining):
                budget = Mock()
                budget.remaining.return_value = remaining
                transport = SimpleNamespace(budget=budget)
                response = object()
                current_jira_search = Mock(return_value=response)

                def fetch_sprint_teams(**kwargs):
                    self.assertIs(kwargs['budget'], budget)
                    return kwargs['jira_search']({'jql': 'project = DEMO'})

                namespace = {
                    '_team_catalog_service': SimpleNamespace(
                        normalize_team_catalog=lambda value: value,
                    ),
                    '_load_workspace_team_catalog_db': lambda _context: {'catalog': {}},
                    'fetch_sprint_teams': fetch_sprint_teams,
                    'current_jira_search': current_jira_search,
                }
                adapter = CatalogAppAdapter(namespace)
                context = object()

                result = adapter.fetch_catalog_sprint_teams(
                    sprint_id='101',
                    config=SimpleNamespace(
                        base_jql='project = DEMO',
                        team_field_id='customfield_10001',
                    ),
                    context=context,
                    diagnostic_transport=transport,
                    budget=budget,
                )

                self.assertIs(result, response)
                budget.remaining.assert_called_once_with('team_page')
                current_jira_search.assert_called_once_with(
                    {'jql': 'project = DEMO'},
                    context=context,
                    diagnostic_transport=transport,
                    timeout=expected_timeout,
                )


if __name__ == '__main__':
    unittest.main()
