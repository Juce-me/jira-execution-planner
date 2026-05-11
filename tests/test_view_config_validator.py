import unittest

from backend.auth.token_crypto import SENSITIVE_TOKEN_KEYS
from backend.config.view_validation import (
    FORBIDDEN_VIEW_PAYLOAD_KEYS,
    ViewPayloadValidationError,
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
                'tab': 'active',
                'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['GOAL-2']},
                'labelPrefix': 'rnd_project_*',
                'selectedSprint': 'Active',
                'projects': {
                    'home-1': {
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
