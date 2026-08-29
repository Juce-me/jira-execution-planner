import unittest

from backend.auth.token_crypto import SENSITIVE_TOKEN_KEYS
from backend.config.view_validation import (
    FORBIDDEN_VIEW_PAYLOAD_KEYS,
    ViewPayloadValidationError,
    normalize_epm_settings_payload,
    normalize_user_view_payload,
    validate_user_view_payload,
)
from backend.epm.home import HOME_GRAPHQL_PROBE_SENSITIVE_KEYS, HOME_WRITE_PROBE_SENSITIVE_KEYS


class UserViewPayloadValidatorTests(unittest.TestCase):
    def test_forbidden_keys_reuse_existing_sensitive_key_sets(self):
        self.assertTrue(SENSITIVE_TOKEN_KEYS.issubset(FORBIDDEN_VIEW_PAYLOAD_KEYS))
        self.assertTrue(HOME_WRITE_PROBE_SENSITIVE_KEYS.issubset(FORBIDDEN_VIEW_PAYLOAD_KEYS))
        self.assertTrue(HOME_GRAPHQL_PROBE_SENSITIVE_KEYS.issubset(FORBIDDEN_VIEW_PAYLOAD_KEYS))

    def test_allows_user_owned_epm_view_mappings(self):
        payload = {
            'epm': {
                'version': 2,
                'tab': 'active',
                'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['GOAL-2']},
                'labelPrefix': 'rnd_project_*',
                'selectedSprint': 'Active',
                'projects': {
                    'home-1': {
                        'id': 'home-1',
                        'homeProjectId': 'home-1',
                        'name': 'Synthetic Project',
                        'label': 'rnd_project_synthetic',
                    },
                },
                'issueTypes': {
                    'initiative': ['Initiative'],
                    'epic': ['Epic'],
                    'leaf': ['Story'],
                },
            },
        }

        self.assertEqual(validate_user_view_payload(payload), payload)

    def test_strict_epm_normalization_preserves_home_id_and_omits_null(self):
        payload = {
            'version': 2,
            'labelPrefix': ' portfolio_project_* ',
            'scope': {'rootGoalKey': 'root-a', 'subGoalKeys': ['goal-b']},
            'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
            'projects': {
                'home-a': {
                    'id': 'home-a', 'name': 'Home A', 'label': 'portfolio_project_a',
                    'homeProjectId': ' home-a ',
                },
                'custom-a': {
                    'id': 'custom-a', 'name': 'Custom A', 'label': 'portfolio_project_custom',
                    'homeProjectId': None,
                },
            },
        }

        normalized = normalize_epm_settings_payload(payload)

        self.assertEqual(normalized['projects']['home-a']['homeProjectId'], 'home-a')
        self.assertNotIn('homeProjectId', normalized['projects']['custom-a'])

    def test_strict_epm_normalization_rejects_invalid_home_ids_and_legacy_rows(self):
        base = {
            'version': 2,
            'labelPrefix': 'portfolio_project_*',
            'scope': {'rootGoalKey': 'ROOT-A', 'subGoalKeys': ['GOAL-B']},
            'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
            'projects': {},
        }
        invalid_rows = (
            {'id': 'p', 'name': 'P', 'label': 'portfolio_project_p', 'homeProjectId': ''},
            {'id': 'p', 'name': 'P', 'label': 'portfolio_project_p', 'homeProjectId': 7},
            {'id': 'p', 'name': 'P', 'jiraLabel': 'portfolio_project_p'},
        )
        for row in invalid_rows:
            with self.subTest(row=row), self.assertRaises(ViewPayloadValidationError):
                normalize_epm_settings_payload({**base, 'projects': {'p': row}})

    def test_private_view_normalization_preserves_personal_epm_state(self):
        payload = {
            'filters': {'projectKeys': ['PROD']},
            'epm': {
                'version': 2,
                'labelPrefix': 'portfolio_project_*',
                'scope': {'rootGoalKey': 'ROOT-A', 'subGoalKeys': []},
                'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
                'projects': {},
                'tab': 'active',
                'selectedSprint': 'Sprint 1',
            },
        }
        self.assertEqual(normalize_user_view_payload(payload), payload)

    def test_private_view_rejects_shared_identity_and_credentials(self):
        invalid = (
            {'teamGroups': {}},
            {'teamCatalog': {}},
            {'workspaceId': 'workspace-a'},
            {'user_id': 'user-a'},
            {'credentials': {'token': 'redacted'}},
            {'password': 'not-allowed'},
            {'secret': 'not-allowed'},
            {'private_key': 'not-allowed'},
            {'privateKey': 'not-allowed'},
            {'Private-Key': 'not-allowed'},
        )
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ViewPayloadValidationError):
                normalize_user_view_payload(payload)

    def test_rejects_token_material_and_credential_fields(self):
        payload = {
            'filters': {},
            'oauth': {
                'access_token': 'access-123',
                'apiToken': 'api-token-123',
            },
        }

        with self.assertRaises(ViewPayloadValidationError) as raised:
            validate_user_view_payload(payload)

        self.assertIn('oauth.access_token', raised.exception.forbidden_paths)
        self.assertIn('oauth.apiToken', raised.exception.forbidden_paths)

    def test_rejects_service_integration_definitions(self):
        payload = {
            'epm': {
                'serviceIntegrations': {
                    'home_townsquare_basic': {'credentialSubject': 'svc@example.com'},
                },
            },
        }

        with self.assertRaises(ViewPayloadValidationError) as raised:
            validate_user_view_payload(payload)

        self.assertIn('epm.serviceIntegrations', raised.exception.forbidden_paths)

    def test_rejects_raw_home_graphql_operations(self):
        payload = {
            'epm': {
                'homeGraphql': {
                    'operationName': 'goals_search',
                    'query': 'query goals_search { goals_search { id } }',
                    'variables': {'first': 10},
                },
            },
        }

        with self.assertRaises(ViewPayloadValidationError) as raised:
            validate_user_view_payload(payload)

        self.assertIn('epm.homeGraphql', raised.exception.forbidden_paths)


if __name__ == '__main__':
    unittest.main()
