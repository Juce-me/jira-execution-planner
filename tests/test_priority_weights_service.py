import unittest

from backend.services import priority_weights


class TestPriorityWeightsService(unittest.TestCase):
    def test_normalize_priority_weight_rows_validates_and_aliases_duplicates(self):
        with self.assertRaisesRegex(ValueError, 'duplicate priority'):
            priority_weights.normalize_priority_weight_rows(
                [
                    {'priority': 'Blocker', 'weight': 0.4},
                    {'priority': 'Highest', 'weight': 0.5},
                ],
                name_aliases={'highest': 'blocker'},
            )

    def test_parse_stats_priority_weights_env_preserves_priority_names(self):
        rows = priority_weights.parse_stats_priority_weights_env(
            'Highest:0.4,Critical:0.3,Major:0.2',
            name_aliases={'highest': 'blocker'},
        )

        self.assertEqual(rows, [
            {'priority': 'Highest', 'weight': 0.4},
            {'priority': 'Critical', 'weight': 0.3},
            {'priority': 'Major', 'weight': 0.2},
        ])

    def test_parse_stats_priority_weights_env_rejects_invalid_tokens(self):
        with self.assertRaisesRegex(ValueError, 'invalid STATS_PRIORITY_WEIGHTS token'):
            priority_weights.parse_stats_priority_weights_env('Major=0.2')

    def test_build_priority_weight_defaults_clones_rows(self):
        defaults = [{'priority': 'Blocker', 'weight': 0.4}]
        cloned = priority_weights.build_priority_weight_defaults(defaults)
        cloned[0]['weight'] = 9

        self.assertEqual(defaults[0]['weight'], 0.4)

    def test_build_priority_weights_config_prefers_valid_config(self):
        payload = priority_weights.build_priority_weights_config(
            dashboard_config={'statsPriorityWeights': [{'priority': 'Major', 'weight': '0.25'}]},
            env_value='Major:0.99',
            defaults=[],
            name_aliases={},
        )

        self.assertEqual(payload, {
            'weights': [{'priority': 'Major', 'weight': 0.25}],
            'source': 'config',
        })

    def test_build_priority_weights_config_falls_back_to_env_then_defaults(self):
        payload = priority_weights.build_priority_weights_config(
            dashboard_config={},
            env_value='Major:0.99',
            defaults=[{'priority': 'Blocker', 'weight': 0.4}],
            name_aliases={},
        )

        self.assertEqual(payload, {
            'weights': [{'priority': 'Major', 'weight': 0.99}],
            'source': 'env',
        })

    def test_build_priority_weights_config_warns_and_uses_defaults(self):
        warnings = []
        payload = priority_weights.build_priority_weights_config(
            dashboard_config={'statsPriorityWeights': [{'priority': 'Major', 'weight': 'bad'}]},
            env_value='invalid',
            defaults=[{'priority': 'Blocker', 'weight': 0.4}],
            name_aliases={},
            log_warning_fn=warnings.append,
        )

        self.assertEqual(payload, {
            'weights': [{'priority': 'Blocker', 'weight': 0.4}],
            'source': 'default',
        })
        self.assertEqual(len(warnings), 2)


if __name__ == '__main__':
    unittest.main()
