import unittest

from backend.services import group_config


def _normalize_team_ids(values):
    return [str(value or '').strip() for value in values if str(value or '').strip()]


def _normalize_epic_keys(values):
    seen = set()
    normalized = []
    for value in values:
        epic_key = str(value or '').strip().upper()
        if not epic_key or epic_key in seen:
            continue
        seen.add(epic_key)
        normalized.append(epic_key)
    return normalized


class TestGroupConfigService(unittest.TestCase):
    def test_parse_groups_config_env_returns_json_or_none(self):
        self.assertEqual(group_config.parse_groups_config_env('{"groups": []}'), {'groups': []})
        self.assertIsNone(group_config.parse_groups_config_env(''))

        warnings = []
        self.assertIsNone(group_config.parse_groups_config_env('{bad', log_warning_fn=warnings.append))
        self.assertEqual(len(warnings), 1)

    def test_validate_groups_config_normalizes_group_fields(self):
        normalized, errors, warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': ' group-1 ',
                    'name': ' Group 1 ',
                    'teamIds': [' team-a ', 'team-b'],
                    'missingInfoComponent': 'Needs Product',
                    'excludedCapacityEpics': 'EPIC-1',
                    'adHocCapacityEpics': [' ad-1 ', 'AD-1', '', None, 'ad-2'],
                    'teamLabels': {'team-a': 'team_alpha_label', 'team-c': 'ignored'},
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda raw, ids: {
                key: value for key, value in raw.items() if key in ids
            },
        )

        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertEqual(normalized, {
            'version': 1,
            'groups': [{
                'id': 'group-1',
                'name': 'Group 1',
                'teamIds': ['team-a', 'team-b'],
                'missingInfoComponents': ['Needs Product'],
                'excludedCapacityEpics': ['EPIC-1'],
                'adHocCapacityEpics': ['AD-1', 'AD-2'],
                'teamLabels': {'team-a': 'team_alpha_label'},
            }],
            'defaultGroupId': 'group-1',
        })

    def test_validate_groups_config_defaults_missing_ad_hoc_capacity_epics(self):
        normalized, errors, _warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': 'group-1',
                    'name': 'Group 1',
                    'teamIds': ['team-a'],
                    'excludedCapacityEpics': ['EX-1'],
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: {},
        )

        self.assertEqual(errors, [])
        self.assertEqual(normalized['groups'][0]['excludedCapacityEpics'], ['EX-1'])
        self.assertEqual(normalized['groups'][0]['adHocCapacityEpics'], [])

    def test_validate_groups_config_rejects_excluded_ad_hoc_overlap(self):
        normalized, errors, _warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': 'group-1',
                    'name': 'Group 1',
                    'teamIds': ['team-a'],
                    'excludedCapacityEpics': [' ex-1 ', 'EX-1'],
                    'adHocCapacityEpics': ['EX-1', 'AD-1'],
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: {},
        )

        self.assertEqual(normalized['groups'][0]['excludedCapacityEpics'], ['EX-1'])
        self.assertEqual(normalized['groups'][0]['adHocCapacityEpics'], ['EX-1', 'AD-1'])
        self.assertTrue(any('both excludedCapacityEpics and adHocCapacityEpics' in error for error in errors))

    def test_validate_groups_config_rejects_duplicates_and_unknown_default(self):
        normalized, errors, _warnings = group_config.validate_groups_config(
            {
                'groups': [
                    {'id': 'group-1', 'name': 'Group', 'teamIds': ['team-a']},
                    {'id': 'GROUP-1', 'name': 'Other', 'teamIds': ['team-b']},
                    {'id': 'group-2', 'name': 'Group', 'teamIds': ['team-c']},
                ],
                'defaultGroupId': 'missing',
            },
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: {},
        )

        self.assertEqual(normalized['groups'][0]['id'], 'group-1')
        self.assertIn('Duplicate group id "GROUP-1".', errors)
        self.assertIn('Duplicate group name "Group".', errors)
        self.assertIn('defaultGroupId must reference an existing group.', errors)

    def test_build_default_groups_config_uses_jql_team_ids_and_warnings(self):
        config, warnings = group_config.build_default_groups_config(
            base_jql='Team in ("team-a", "team-b", "team-c")',
            missing_info_component='Needs Product',
            groups_config_version=1,
            groups_max_teams=2,
            normalize_team_ids_fn=_normalize_team_ids,
            extract_team_ids_from_jql_fn=lambda _jql: ['team-a', 'team-b', 'team-c'],
        )

        self.assertEqual(config['groups'][0]['teamIds'], ['team-a', 'team-b'])
        self.assertEqual(config['groups'][0]['missingInfoComponents'], ['Needs Product'])
        self.assertEqual(config['groups'][0]['adHocCapacityEpics'], [])
        self.assertEqual(len(warnings), 1)


if __name__ == '__main__':
    unittest.main()
