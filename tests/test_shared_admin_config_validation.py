import unittest
from types import SimpleNamespace

from backend.config.shared_config import (
    ADMIN_CONFIG_SECTIONS,
    PERSONAL_EPM_KEYS,
    PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS,
    USER_EPM_SETTINGS_KEYS,
    legacy_fallback_matches_workspace,
    normalize_workspace_admin_payload,
    strip_shared_sections_from_private_view,
    validate_private_view_ownership,
)
from backend.config.view_validation import ViewPayloadValidationError


class SharedAdminConfigValidationTests(unittest.TestCase):
    def test_constants_define_the_ownership_boundary(self):
        self.assertEqual(
            ADMIN_CONFIG_SECTIONS,
            frozenset({
                'version', 'projects', 'board', 'capacity', 'sprintField',
                'storyPointsField', 'parentNameField', 'teamField',
                'projectTrackField', 'deliveryOwnerField', 'statsPriorityWeights',
                'issueTypes',
            }),
        )
        self.assertEqual(PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS, ADMIN_CONFIG_SECTIONS - {'version'})
        self.assertEqual(USER_EPM_SETTINGS_KEYS, frozenset({'version', 'labelPrefix', 'scope', 'issueTypes', 'projects'}))
        self.assertEqual(PERSONAL_EPM_KEYS, frozenset({'tab', 'selectedSprint'}))

    def test_workspace_payload_keeps_only_known_legacy_exclusions(self):
        payload = {
            'version': 1,
            'board': {'boardId': '7'},
            'filters': {'projectKeys': ['PRIVATE']},
            'eng': {'mode': 'planning'},
            'teamGroups': {'groups': []},
            'teamCatalog': {'catalog': {}},
            'epm': {
                'scope': {'userId': 'legacy-user'},
                'projects': {'legacy': {'apiToken': 'legacy-token'}},
            },
        }
        normalized = normalize_workspace_admin_payload(payload, allow_legacy_excluded_fields=True)
        self.assertEqual(set(normalized), {'version', 'board'})
        self.assertEqual(normalized['board'], {'boardId': '7', 'boardName': ''})

    def test_workspace_payload_rejects_unknown_identity_and_malformed_fields(self):
        invalid = (
            {'unexpected': {}},
            {'board': {'boardId': 'not-numeric'}},
            {'board': {'boardId': '7', 'workspaceId': 'claimed'}},
        )
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                normalize_workspace_admin_payload(payload, allow_legacy_excluded_fields=True)

        with self.assertRaises(ValueError):
            normalize_workspace_admin_payload({'epm': {'version': 2}})

    def test_workspace_payload_rejects_unknown_priority_weight_fields(self):
        with self.assertRaisesRegex(ValueError, r'statsPriorityWeights\[0\]\.unexpected'):
            normalize_workspace_admin_payload({
                'statsPriorityWeights': [
                    {'priority': 'High', 'weight': 1, 'unexpected': 'value'},
                ],
            })

    def test_private_runtime_view_preserves_user_owned_epm(self):
        payload = {
            'version': 1,
            'filters': {'projectKeys': ['PRODUCT']},
            'epm': {
                'tab': 'active', 'selectedSprint': 'Active',
                'scope': {'rootGoalKey': 'PRIVATE'}, 'projects': {'private': {}},
            },
            'board': {'boardId': '7'},
        }
        self.assertEqual(strip_shared_sections_from_private_view(payload), {
            'version': 1,
            'filters': {'projectKeys': ['PRODUCT']},
            'epm': {
                'tab': 'active', 'selectedSprint': 'Active',
                'scope': {'rootGoalKey': 'PRIVATE'}, 'projects': {'private': {}},
            },
        })

    def test_private_persistence_accepts_strict_epm_and_rejects_shared_sections(self):
        for payload in ({'board': {}}, {'teamGroups': {}}, {'teamCatalog': {}}):
            with self.subTest(payload=payload), self.assertRaises(ViewPayloadValidationError):
                validate_private_view_ownership(payload)
        payload = {
            'version': 1,
            'epm': {
                'version': 2,
                'labelPrefix': 'portfolio_project_*',
                'scope': {'rootGoalKey': 'ROOT-A', 'subGoalKeys': ['GOAL-B']},
                'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
                'projects': {},
                'tab': 'active',
                'selectedSprint': 'Active',
            },
        }
        self.assertEqual(validate_private_view_ownership(payload), payload)

    def test_legacy_fallback_requires_exact_normalized_site(self):
        context = SimpleNamespace(site_url='https://example.atlassian.net/')
        self.assertTrue(legacy_fallback_matches_workspace(context, 'https://example.atlassian.net'))
        self.assertFalse(legacy_fallback_matches_workspace(context, ''))
        self.assertFalse(legacy_fallback_matches_workspace(context, 'https://other.example.atlassian.net'))
        self.assertFalse(legacy_fallback_matches_workspace(context, 'https://example.atlassian.net/path'))


if __name__ == '__main__':
    unittest.main()
