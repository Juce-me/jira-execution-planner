import json
import os
import tempfile
import unittest

from backend.services import stats_cache


class TestStatsCacheService(unittest.TestCase):
    def test_load_save_and_invalidate_stats_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_file = os.path.join(tmp, 'stats_cache.json')
            payload = {'sprint:2026Q2:abc': {'data': {'teams': []}}}

            self.assertEqual(stats_cache.load_stats_cache(cache_file), {})
            self.assertTrue(stats_cache.save_stats_cache(payload, cache_file=cache_file))
            self.assertEqual(stats_cache.load_stats_cache(cache_file), payload)
            self.assertTrue(stats_cache.invalidate_stats_cache(cache_file))
            self.assertFalse(os.path.exists(cache_file))

    def test_load_stats_cache_handles_invalid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_file = os.path.join(tmp, 'stats_cache.json')
            with open(cache_file, 'w', encoding='utf-8') as handle:
                handle.write('{not-json')
            warnings = []

            self.assertEqual(stats_cache.load_stats_cache(cache_file, log_warning_fn=warnings.append), {})
            self.assertEqual(len(warnings), 1)

    def test_save_stats_cache_returns_false_on_write_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            warnings = []

            self.assertFalse(stats_cache.save_stats_cache({}, cache_file=tmp, log_warning_fn=warnings.append))
            self.assertEqual(len(warnings), 1)

    def test_build_stats_cache_key_uses_order_group_and_team_sequence(self):
        key = stats_cache.build_stats_cache_key(
            '2026Q2',
            'project = TEST',
            ['team-a', 'team-b'],
            order_by='ORDER BY status ASC',
            group_id='group-1',
        )

        self.assertRegex(key, r'^sprint:2026Q2:[0-9a-f]{12}$')
        self.assertNotEqual(
            key,
            stats_cache.build_stats_cache_key(
                '2026Q2',
                'project = TEST',
                ['team-b', 'team-a'],
                order_by='ORDER BY status ASC',
                group_id='group-1',
            )
        )

    def test_invalidate_stats_cache_handles_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertTrue(stats_cache.invalidate_stats_cache(os.path.join(tmp, 'missing.json')))


if __name__ == '__main__':
    unittest.main()
