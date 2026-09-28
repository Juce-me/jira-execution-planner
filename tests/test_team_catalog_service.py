import unittest

from backend.services import team_catalog


class TestTeamCatalogService(unittest.TestCase):
    def test_normalize_team_catalog_accepts_list_rows(self):
        self.assertEqual(
            team_catalog.normalize_team_catalog([
                {'id': ' T2 ', 'name': ' Alpha '},
                {'id': '', 'name': 'ignored'},
                'not-row',
            ]),
            {'T2': {'id': 'T2', 'name': 'Alpha'}},
        )

    def test_normalize_team_catalog_accepts_dict_rows_and_string_values(self):
        self.assertEqual(
            team_catalog.normalize_team_catalog({
                't1': {'name': 'Team One'},
                't2': 'Team Two',
            }),
            {
                't1': {'id': 't1', 'name': 'Team One'},
                't2': {'id': 't2', 'name': 'Team Two'},
            },
        )

    def test_normalize_team_catalog_meta_keeps_allowed_string_values(self):
        self.assertEqual(
            team_catalog.normalize_team_catalog_meta({
                'updatedAt': '2026-03-06',
                'source': 'sprint',
                'bogusField': 'ignored',
                'resolvedAt': 123,
            }),
            {
                'updatedAt': '2026-03-06',
                'source': 'sprint',
                'resolvedAt': '123',
            },
        )

    def test_normalize_group_team_labels_filters_unknown_teams(self):
        self.assertEqual(
            team_catalog.normalize_group_team_labels(
                {'team-a': 'team_alpha_label', 'team-c': 'ignored', '': 'blank'},
                ['team-a', 'team-b'],
            ),
            ({'team-a': ['team_alpha_label']}, []),
        )

    def test_normalize_group_team_labels_can_use_project_normalizer(self):
        self.assertEqual(
            team_catalog.normalize_group_team_labels(
                {'team-a': 'label'},
                [' team-a '],
                normalize_team_ids_fn=lambda ids: [str(item).strip() for item in ids],
            ),
            ({'team-a': ['label']}, []),
        )

    def test_normalize_group_team_labels_accepts_legacy_scalar_as_single_alias(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': 'label_team_a'},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['label_team_a']})
        self.assertEqual(errors, [])

    def test_normalize_group_team_labels_accepts_legacy_numeric_scalar_as_single_alias(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': 2026},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['2026']})
        self.assertEqual(errors, [])

    def test_normalize_group_team_labels_rejects_numeric_entry_inside_array(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': ['label_team_a', 2026]},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['label_team_a']})
        self.assertEqual(errors, ['Team "team-a" has an invalid Jira label.'])

    def test_normalize_group_team_labels_rejects_bool_scalar(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': True},
            ['team-a'],
        )
        self.assertEqual(mapping, {})
        self.assertEqual(errors, ['Team "team-a" has an invalid Jira label.'])

    def test_normalize_group_team_labels_accepts_one_to_three_aliases(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': ['label_team_a', 'label_team_a_old', 'label_team_a_older']},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['label_team_a', 'label_team_a_old', 'label_team_a_older']})
        self.assertEqual(errors, [])

    def test_normalize_group_team_labels_trims_whitespace_and_preserves_order(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': [' label_team_a ', 'label_team_a_old', '   ', '']},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['label_team_a', 'label_team_a_old']})
        self.assertEqual(errors, [])

    def test_normalize_group_team_labels_rejects_case_insensitive_duplicates(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': ['label_team_a', ' LABEL_TEAM_A ', 'label_team_a']},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['label_team_a']})
        self.assertEqual(errors, ['Team "team-a" has duplicate Jira labels.'])

    def test_normalize_group_team_labels_rejects_non_string_entries(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': ['label_team_a', 123, None]},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['label_team_a']})
        self.assertEqual(errors, ['Team "team-a" has an invalid Jira label.'])

    def test_normalize_group_team_labels_rejects_a_fourth_alias(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': ['label_a', 'label_b', 'label_c', 'label_d']},
            ['team-a'],
        )
        self.assertEqual(mapping, {'team-a': ['label_a', 'label_b', 'label_c', 'label_d']})
        self.assertEqual(errors, ['Team "team-a" has more than 3 Jira labels.'])

    def test_normalize_group_team_labels_errors_are_label_free(self):
        _mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': ['label_a', 'label_b', 'label_c', 'label_d', 'label_a', 42]},
            ['team-a'],
        )
        self.assertTrue(errors)
        for error in errors:
            self.assertNotIn('label_a', error)
            self.assertNotIn('label_b', error)
            self.assertIn('team-a', error)

    def test_normalize_group_team_labels_drops_team_with_all_blank_aliases(self):
        mapping, errors = team_catalog.normalize_group_team_labels(
            {'team-a': ['', '   ']},
            ['team-a'],
        )
        self.assertEqual(mapping, {})
        self.assertEqual(errors, [])

    def test_flatten_group_team_labels_unions_aliases_across_requested_teams_case_insensitively(self):
        self.assertEqual(
            team_catalog.flatten_group_team_labels(
                {
                    'team-a': ['label_team_a', 'LABEL_TEAM_A_OLD'],
                    'team-b': ['label_team_a_old', 'label_team_b'],
                },
                ['team-a', 'team-b'],
            ),
            ['label_team_a', 'LABEL_TEAM_A_OLD', 'label_team_b'],
        )

    def test_flatten_group_team_labels_only_includes_requested_teams(self):
        self.assertEqual(
            team_catalog.flatten_group_team_labels(
                {'team-a': ['label_team_a'], 'team-b': ['label_team_b']},
                ['team-a'],
            ),
            ['label_team_a'],
        )


if __name__ == '__main__':
    unittest.main()
