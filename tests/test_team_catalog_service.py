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
            {'team-a': 'team_alpha_label'},
        )

    def test_normalize_group_team_labels_can_use_project_normalizer(self):
        self.assertEqual(
            team_catalog.normalize_group_team_labels(
                {'team-a': 'label'},
                [' team-a '],
                normalize_team_ids_fn=lambda ids: [str(item).strip() for item in ids],
            ),
            {'team-a': 'label'},
        )


if __name__ == '__main__':
    unittest.main()
