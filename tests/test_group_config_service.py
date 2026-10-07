import unittest

from backend.services import group_board, group_config, team_catalog


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
            normalize_group_team_labels_fn=lambda raw, ids: (
                {key: value for key, value in raw.items() if key in ids}, [],
            ),
            normalize_group_board_fn=group_board.normalize_group_board,
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

    def test_validate_groups_config_is_idempotent_for_a_group_without_board(self):
        # Regression: validate_groups_config runs on every read (D44), not
        # only on save. A group with no `board` must stay valid when its own
        # normalized output (whatever gets persisted) is fed back through
        # validate_groups_config again, exactly as a second config load does.
        payload = {
            'groups': [{'id': 'group-1', 'name': 'Group 1', 'teamIds': ['team-a']}],
            'defaultGroupId': 'group-1',
        }
        kwargs = dict(
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
        )

        first, first_errors, _warnings = group_config.validate_groups_config(payload, **kwargs)
        self.assertEqual(first_errors, [])
        self.assertNotIn('board', first['groups'][0])

        second, second_errors, _warnings = group_config.validate_groups_config(first, **kwargs)
        self.assertEqual(second_errors, [])
        self.assertNotIn('board', second['groups'][0])

    def test_validate_groups_config_prefixes_board_error_with_group_name(self):
        # The propagation loop at group_config.py that turns group_board's
        # bare error strings into `Group "{name}" ...`-prefixed entries in
        # `errors` is the wiring that makes the whole board grammar
        # enforceable through validate_groups_config (and therefore through
        # POST /api/groups-config). Assert the exact, fully-prefixed
        # message so removing or mis-prefixing that loop fails this test.
        _normalized, errors, warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': 'group-1',
                    'name': 'Group 1',
                    'teamIds': ['team-a'],
                    'board': {'columns': []},
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
        )

        self.assertEqual(errors, ['Group "Group 1" board must have at least 1 column.'])
        self.assertEqual(warnings, [])

    def test_validate_groups_config_prefixes_inherit_flag_warning_and_omits_the_key(self):
        normalized, errors, warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': 'group-1',
                    'name': 'Group 1',
                    'teamIds': ['team-a'],
                    'board': {
                        'columns': [{
                            'id': 'col-00000001',
                            'name': 'To do',
                            'statuses': ['To Do'],
                            'colour': '#8c8c8c',
                            'star': False,
                            'min': None,
                            'max': None,
                        }],
                        'inheritColumnColours': 'yes',
                    },
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
        )

        self.assertEqual(errors, [])
        self.assertEqual(
            warnings,
            ['Group "Group 1" board.inheritColumnColours must be true or false; treating it as off.'],
        )
        self.assertNotIn('inheritColumnColours', normalized['groups'][0]['board'])

    def test_validate_groups_config_prefixes_board_warning_and_keeps_it_out_of_errors(self):
        # Same propagation loop, warning side: a colour coercion must land
        # in `warnings`, prefixed the same way as errors, and must not also
        # appear in (or block via) `errors`.
        normalized, errors, warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': 'group-1',
                    'name': 'Group 1',
                    'teamIds': ['team-a'],
                    'board': {
                        'columns': [{
                            'id': 'col-00000001',
                            'name': 'To do',
                            'statuses': ['To Do'],
                            'colour': '#not-a-real-colour',
                            'star': False,
                            'min': None,
                            'max': None,
                        }],
                    },
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=1,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
        )

        self.assertEqual(errors, [])
        self.assertEqual(
            warnings,
            ['Group "Group 1" board column "To do" has an unknown colour; using the default colour instead.'],
        )
        self.assertEqual(
            normalized['groups'][0]['board']['columns'][0]['colour'],
            group_board.DEFAULT_COLUMN_COLOUR,
        )

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
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
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
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
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
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
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
        self.assertNotIn('board', config['groups'][0])
        self.assertEqual(len(warnings), 1)

    def test_validate_groups_config_forces_current_version_regardless_of_client_value(self):
        kwargs = dict(
            groups_config_version=2,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=lambda _raw, _ids: ({}, []),
            normalize_group_board_fn=group_board.normalize_group_board,
        )
        payload = {
            'groups': [{'id': 'group-1', 'name': 'Group 1', 'teamIds': ['team-a']}],
            'defaultGroupId': 'group-1',
        }

        for client_version in (1, 2, 99, None):
            normalized, errors, _warnings = group_config.validate_groups_config(
                {**payload, 'version': client_version},
                **kwargs,
            )
            self.assertEqual(errors, [])
            self.assertEqual(normalized['version'], 2)

    def test_validate_groups_config_normalizes_team_labels_into_arrays(self):
        normalized, errors, _warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': 'group-1',
                    'name': 'Group 1',
                    'teamIds': ['team-a'],
                    'teamLabels': {'team-a': 'label_team_a'},
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=2,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=team_catalog.normalize_group_team_labels,
            normalize_group_board_fn=group_board.normalize_group_board,
        )

        self.assertEqual(errors, [])
        self.assertEqual(normalized['groups'][0]['teamLabels'], {'team-a': ['label_team_a']})

    def test_validate_groups_config_prefixes_team_label_errors_with_group_name_and_omits_label_values(self):
        normalized, errors, _warnings = group_config.validate_groups_config(
            {
                'groups': [{
                    'id': 'group-1',
                    'name': 'Group 1',
                    'teamIds': ['team-a'],
                    'teamLabels': {'team-a': ['label_a', 'label_b', 'label_c', 'label_a']},
                }],
                'defaultGroupId': 'group-1',
            },
            groups_config_version=2,
            groups_max_teams=12,
            normalize_team_ids_fn=_normalize_team_ids,
            normalize_epic_keys_fn=_normalize_epic_keys,
            normalize_group_team_labels_fn=team_catalog.normalize_group_team_labels,
            normalize_group_board_fn=group_board.normalize_group_board,
        )

        self.assertEqual(errors, ['Group "Group 1" Team "team-a" has duplicate Jira labels.'])
        for error in errors:
            self.assertNotIn('label_a', error)
            self.assertNotIn('label_b', error)
        self.assertEqual(normalized['groups'][0]['teamLabels'], {'team-a': ['label_a', 'label_b', 'label_c']})

    def test_build_epic_alert_scope_clause_escapes_label_values(self):
        clause = group_config.build_epic_alert_scope_clause(
            ['team-a'], ['label_team_a', 'label "quoted" \\ team', 'LABEL_TEAM_A'], _normalize_team_ids,
        )

        self.assertEqual(
            clause,
            '("Team[Team]" = "team-a" OR labels in ("label_team_a", "label \\"quoted\\" \\\\ team"))',
        )
        self.assertEqual(
            group_config.build_epic_alert_scope_clause([], ['label "a"'], _normalize_team_ids),
            'labels = "label \\"a\\""',
        )

    def test_resolve_group_team_label_values_reads_effective_groups_config(self):
        groups_config = {
            'version': 2,
            'groups': [{
                'id': 'department-a',
                'teamIds': ['team-a', 'team-b', 'team-c'],
                'teamLabels': {
                    'team-a': ['label_team_a', 'label_team_a_old'],
                    'team-b': 'label_team_b',
                    'team-c': ['LABEL_TEAM_A'],
                },
            }],
        }

        self.assertEqual(
            group_config.resolve_group_team_label_values(
                groups_config, 'department-a', ['team-a', 'team-b', 'team-c'], _normalize_team_ids),
            ['label_team_a', 'label_team_a_old', 'label_team_b'],
        )
        self.assertEqual(
            group_config.resolve_group_team_label_values(groups_config, 'department-a', ['team-b']),
            ['label_team_b'],
        )
        # Dashboard-config shape (teamGroups wrapper) is not the effective groups config.
        self.assertEqual(
            group_config.resolve_group_team_label_values(
                {'teamGroups': groups_config}, 'department-a', ['team-a'], _normalize_team_ids),
            [],
        )
        self.assertEqual(group_config.resolve_group_team_label_values(groups_config, 'missing', ['team-a']), [])
        self.assertEqual(group_config.resolve_group_team_label_values(groups_config, 'department-a', []), [])

    def test_merge_team_label_values_is_sorted_and_case_insensitively_distinct(self):
        self.assertEqual(
            group_config.merge_team_label_values(
                ['label_team_b', 'label_team_a'], ['LABEL_TEAM_A', ' label_team_c ', '']),
            ['label_team_a', 'label_team_b', 'label_team_c'],
        )


if __name__ == '__main__':
    unittest.main()
