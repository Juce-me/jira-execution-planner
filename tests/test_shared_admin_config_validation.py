import unittest
from types import SimpleNamespace

from backend.config.shared_config import (
    ADMIN_CONFIG_SECTIONS,
    PERSONAL_EPM_KEYS,
    PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS,
    SHARED_EPM_KEYS,
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
                'issueTypes', 'epm',
            }),
        )
        self.assertEqual(PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS, ADMIN_CONFIG_SECTIONS - {'version', 'epm'})
        self.assertEqual(SHARED_EPM_KEYS, frozenset({'version', 'labelPrefix', 'scope', 'issueTypes', 'projects'}))
        self.assertEqual(PERSONAL_EPM_KEYS, frozenset({'tab', 'selectedSprint'}))

    def test_workspace_payload_keeps_only_known_legacy_exclusions(self):
        payload = {
            'version': 1,
            'board': {'boardId': '7'},
            'epm': {'version': 2, 'scope': {'rootGoalKey': 'GOAL-1'}},
            'filters': {'projectKeys': ['PRIVATE']},
            'eng': {'mode': 'planning'},
            'teamGroups': {'groups': []},
            'teamCatalog': {'catalog': {}},
        }
        normalized = normalize_workspace_admin_payload(payload, allow_legacy_excluded_fields=True)
        self.assertEqual(set(normalized), {'version', 'board', 'epm'})
        self.assertEqual(normalized['board'], {'boardId': '7', 'boardName': ''})
        self.assertEqual(normalized['epm']['scope']['rootGoalKey'], 'GOAL-1')

    def test_workspace_payload_rejects_unknown_identity_and_malformed_fields(self):
        invalid = (
            {'unexpected': {}},
            {'board': {'boardId': 'not-numeric'}},
            {'board': {'boardId': '7', 'workspaceId': 'claimed'}},
            {'epm': {'scope': {'user_id': 'claimed'}}},
            {'epm': {'query': 'query X', 'variables': {}}},
        )
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                normalize_workspace_admin_payload(payload, allow_legacy_excluded_fields=True)

    def test_private_runtime_view_cannot_override_shared_epm(self):
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
            'epm': {'tab': 'active', 'selectedSprint': 'Active'},
        })

    def test_private_persistence_rejects_shared_sections(self):
        for payload in ({'board': {}}, {'epm': {'scope': {}}}, {'epm': {'projects': {}}}):
            with self.subTest(payload=payload), self.assertRaises(ViewPayloadValidationError):
                validate_private_view_ownership(payload)
        validate_private_view_ownership({'version': 1, 'epm': {'tab': 'active', 'selectedSprint': 'Active'}})

    def test_legacy_fallback_requires_exact_normalized_site(self):
        context = SimpleNamespace(site_url='https://example.atlassian.net/')
        self.assertTrue(legacy_fallback_matches_workspace(context, 'https://example.atlassian.net'))
        self.assertFalse(legacy_fallback_matches_workspace(context, ''))
        self.assertFalse(legacy_fallback_matches_workspace(context, 'https://other.example.atlassian.net'))
        self.assertFalse(legacy_fallback_matches_workspace(context, 'https://example.atlassian.net/path'))


if __name__ == '__main__':
    unittest.main()
