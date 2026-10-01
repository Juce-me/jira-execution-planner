import threading
import unittest

from backend.services import epic_refresh


class EpicKeysErrorTests(unittest.TestCase):
    def test_accepts_one_valid_key_for_both_scoped_purposes(self):
        for purpose in ('epic-refresh', 'epic-alerts'):
            args = {'purpose': purpose, 'sprint': '123', 'project': 'product', 'epicKeys': 'EPIC-1'}
            self.assertIsNone(epic_refresh.epic_keys_error(args), purpose)

    def test_scoped_purposes_require_one_key_digit_sprint_and_lane(self):
        base = {'sprint': '123', 'project': 'tech', 'epicKeys': 'EPIC-1'}
        for purpose in ('epic-refresh', 'epic-alerts'):
            for patch in (
                {'epicKeys': ''}, {'epicKeys': 'EPIC-1,EPIC-2'}, {'sprint': ''}, {'sprint': '12a'},
                {'project': 'all'}, {'project': ''},
            ):
                args = {**base, 'purpose': purpose, **patch}
                self.assertEqual(epic_refresh.epic_keys_error(args)['error'], 'invalid_epic_refresh', (purpose, patch))

    def test_rejects_injection_shaped_keys_for_any_purpose(self):
        hostile = [
            'X) OR project is not EMPTY OR issueKey in (Y',
            'EPIC-1"', "EPIC-1'", 'EPIC-1\nORDER BY created', 'epic-1', 'EPIC-', 'EPIC-1 ORDER BY key',
        ]
        for purpose in ('', 'dashboard', 'ready-to-close', 'epic-refresh', 'epic-alerts'):
            for key in hostile:
                args = {'purpose': purpose, 'sprint': '1', 'project': 'product', 'epicKeys': key}
                self.assertEqual(epic_refresh.epic_keys_error(args)['error'], 'invalid_epic_keys', (purpose, key))

    def test_rejects_non_ascii_digits_in_key_and_sprint(self):
        base = {'purpose': 'epic-refresh', 'sprint': '123', 'project': 'product', 'epicKeys': 'EPIC-1'}
        self.assertEqual(epic_refresh.epic_keys_error({**base, 'epicKeys': 'EPIC-١'})['error'], 'invalid_epic_keys')
        for sprint in ('١٢', '²'):
            self.assertEqual(epic_refresh.epic_keys_error({**base, 'sprint': sprint})['error'], 'invalid_epic_refresh', sprint)

    def test_legacy_purposes_keep_multi_key_lists(self):
        keys = ','.join(f'EPIC-{i}' for i in range(1, 60))
        self.assertIsNone(epic_refresh.epic_keys_error({'purpose': 'ready-to-close', 'epicKeys': keys}))

    def test_single_flag_rejects_more_than_one_key_for_other_routes(self):
        self.assertIsNone(epic_refresh.epic_keys_error({'epicKeys': 'EPIC-1'}, single=True))
        self.assertIsNone(epic_refresh.epic_keys_error({}, single=True))
        self.assertEqual(epic_refresh.epic_keys_error({'epicKeys': 'EPIC-1,EPIC-2'}, single=True)['error'], 'invalid_epic_keys')

    def test_single_epic_key(self):
        self.assertEqual(epic_refresh.single_epic_key({'epicKeys': ' EPIC-7 ,EPIC-8'}), 'EPIC-7')
        self.assertIsNone(epic_refresh.single_epic_key({}))


class LimiterTests(unittest.TestCase):
    def test_first_call_allowed_then_blocked_until_interval(self):
        clock = [100.0]
        limiter = epic_refresh.EpicRefreshLimiter(min_interval_seconds=8, clock=lambda: clock[0])
        self.assertEqual(limiter.retry_after('u1', 'b1'), 0)
        clock[0] = 103.0
        self.assertEqual(limiter.retry_after('u1', 'b1'), 5)
        self.assertEqual(limiter.retry_after('u2', 'b1'), 0)
        self.assertEqual(limiter.retry_after('u1', 'b2'), 0)
        clock[0] = 108.5
        self.assertEqual(limiter.retry_after('u1', 'b1'), 0)

    def test_buckets_separate_lane_and_purpose(self):
        a = epic_refresh.limiter_bucket('epic-refresh', 'product', 'EPIC-1')
        self.assertNotEqual(a, epic_refresh.limiter_bucket('epic-refresh', 'tech', 'EPIC-1'))
        self.assertNotEqual(a, epic_refresh.limiter_bucket('epic-alerts', 'product', 'EPIC-1'))
        self.assertNotEqual(a, epic_refresh.limiter_bucket('epic-refresh', 'product', 'EPIC-2'))

    def test_table_is_bounded(self):
        limiter = epic_refresh.EpicRefreshLimiter(max_entries=3, clock=lambda: 1.0)
        for index in range(10):
            limiter.retry_after('u', f'b{index}')
        self.assertLessEqual(len(limiter._seen), 3)

    def test_concurrent_callers_get_exactly_one_pass(self):
        limiter = epic_refresh.EpicRefreshLimiter(min_interval_seconds=60, clock=lambda: 5.0)
        results = []
        def call():
            results.append(limiter.retry_after('u', 'b'))
        threads = [threading.Thread(target=call) for _ in range(16)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count(0), 1)
        self.assertEqual(len(results), 16)


class ResponseMetaTests(unittest.TestCase):
    def test_capped_and_missing_details(self):
        meta = epic_refresh.response_meta(250, 250, ['EPIC-1', 'EPIC-2'], {'EPIC-1': {}})
        self.assertEqual(meta, {'capped': True, 'epicKeysMissing': ['EPIC-2']})
        meta = epic_refresh.response_meta(3, 250, ['EPIC-1'], {'EPIC-1': {}})
        self.assertEqual(meta, {'capped': False, 'epicKeysMissing': []})


class EvictTests(unittest.TestCase):
    def test_evicts_only_named_purposes(self):
        cache = {'dashboard-key': 1, 'alerts-key': 2, 'epic-refresh-key': 3, 'other': 4}
        keys = {'dashboard': 'dashboard-key', 'alerts': 'alerts-key'}
        epic_refresh.evict_scope_entries(cache, threading.Lock(), lambda purpose: keys[purpose])
        self.assertEqual(cache, {'epic-refresh-key': 3, 'other': 4})


if __name__ == '__main__':
    unittest.main()
