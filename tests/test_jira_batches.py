import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from backend.services import jira_batches
from backend.services.jira_batches import (
    JIRA_BATCH_CONCURRENCY,
    JIRA_BATCH_GLOBAL_SLOTS,
    RATE_LIMIT_COOLDOWN_SECONDS,
    BatchOutcome,
    JiraBatchIncomplete,
    run_batches,
)


class InFlight:
    """Peak and current in-flight batch counts, with start times per batch."""

    def __init__(self):
        self.lock = threading.Lock()
        self.current = 0
        self.peak = 0
        self.started = {}
        self.threads = {}

    def enter(self, batch):
        with self.lock:
            self.current += 1
            self.peak = max(self.peak, self.current)
            self.started[batch] = time.monotonic()
            self.threads[batch] = threading.current_thread()

    def leave(self):
        with self.lock:
            self.current -= 1


class CountingAdmission(jira_batches._ProcessAdmission):
    """The real admission with a count of helper slots held at any instant."""

    def __init__(self, slots=JIRA_BATCH_GLOBAL_SLOTS):
        super().__init__(slots)
        self.count_lock = threading.Lock()
        self.held = 0
        self.peak_held = 0
        self.acquired = 0

    def try_acquire_helper(self):
        acquired = super().try_acquire_helper()
        if acquired:
            with self.count_lock:
                self.held += 1
                self.acquired += 1
                self.peak_held = max(self.peak_held, self.held)
        return acquired

    def release_helper(self):
        with self.count_lock:
            self.held -= 1
        super().release_helper()


def all_slots_free(admission, slots=JIRA_BATCH_GLOBAL_SLOTS):
    """True when every process-wide slot can be taken again (then gives them back)."""
    taken = 0
    try:
        while taken < slots and admission.slots.acquire(blocking=False):
            taken += 1
        return taken == slots and not admission.slots.acquire(blocking=False)
    finally:
        for _ in range(taken):
            admission.slots.release()


def join_batch_threads(threads, timeout=2.0):
    for thread in threads:
        if thread is not threading.current_thread():
            thread.join(timeout)
    return [thread for thread in threads if thread.is_alive() and thread is not threading.current_thread()]


class JiraBatchesTests(unittest.TestCase):
    def setUp(self):
        self.admission = CountingAdmission()
        patcher = patch.object(jira_batches, '_ADMISSION', self.admission)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_limits_match_the_plan(self):
        self.assertEqual(JIRA_BATCH_CONCURRENCY, 4)
        self.assertEqual(JIRA_BATCH_GLOBAL_SLOTS, 6)
        self.assertEqual(RATE_LIMIT_COOLDOWN_SECONDS, 10)
        error = JiraBatchIncomplete('rate_limited', True, partial={'A-1': []})
        self.assertEqual((error.reason, error.rate_limited, error.partial), ('rate_limited', True, {'A-1': []}))
        with self.assertRaises(ValueError):
            JiraBatchIncomplete('unknown')

    def test_results_keep_input_order_with_out_of_order_completion(self):
        def fetch(batch):
            time.sleep((8 - batch) * 0.01)
            return batch * 10

        outcome = run_batches(list(range(8)), fetch, max_concurrency=4)

        self.assertIsInstance(outcome, BatchOutcome)
        self.assertTrue(outcome.complete)
        self.assertEqual(outcome.results, [batch * 10 for batch in range(8)])
        self.assertIsNone(outcome.failure)
        outcome.raise_if_failed()

    def test_never_exceeds_max_concurrency(self):
        flight = InFlight()

        def fetch(batch):
            flight.enter(batch)
            try:
                time.sleep(0.03)
                return batch
            finally:
                flight.leave()

        outcome = run_batches(list(range(12)), fetch, max_concurrency=4)

        self.assertTrue(outcome.complete)
        self.assertEqual(outcome.results, list(range(12)))
        self.assertLessEqual(flight.peak, 4)
        self.assertEqual(flight.peak, 4)
        self.assertEqual(self.admission.held, 0)
        self.assertLessEqual(self.admission.peak_held, 3)

    def test_max_concurrency_one_runs_inline_on_the_caller_thread(self):
        order = []
        caller = threading.get_ident()

        def fetch(batch):
            order.append((batch, threading.get_ident()))
            return batch

        with patch.object(jira_batches, 'ThreadPoolExecutor', side_effect=AssertionError('no pool at cap 1')):
            outcome = run_batches([0, 1, 2], fetch, max_concurrency=1)
            failing = run_batches([0, 1, 2], lambda batch: 1 / (batch - 1), max_concurrency=1)

        self.assertEqual(order, [(0, caller), (1, caller), (2, caller)])
        self.assertEqual(outcome.results, [0, 1, 2])
        self.assertEqual(failing.results, [-1.0, None, None])
        self.assertIsInstance(failing.failure, ZeroDivisionError)
        self.assertFalse(failing.complete)
        with self.assertRaises(ZeroDivisionError):
            failing.raise_if_failed()
        self.assertEqual(self.admission.acquired, 0)

    def test_lowest_index_failure_is_reported_and_no_batch_starts_after_it(self):
        flight = InFlight()
        first_failure_at = []
        errors = {1: RuntimeError('batch 1'), 3: RuntimeError('batch 3')}
        all_started = threading.Barrier(4, timeout=2)

        def fetch(batch):
            flight.enter(batch)
            try:
                if batch < 4:
                    all_started.wait()
                if batch == 3:
                    first_failure_at.append(time.monotonic())
                    raise errors[3]
                time.sleep(0.05)
                if batch == 1:
                    raise errors[1]
                return batch
            finally:
                flight.leave()

        outcome = run_batches(list(range(12)), fetch, max_concurrency=4)

        self.assertIs(outcome.failure, errors[1])
        self.assertFalse(outcome.complete)
        self.assertEqual(sorted(flight.started), [0, 1, 2, 3])
        self.assertTrue(all(started <= first_failure_at[0] for started in flight.started.values()))
        self.assertEqual(outcome.results[:4], [0, None, 2, None])
        self.assertEqual(outcome.results[4:], [None] * 8)
        with self.assertRaises(RuntimeError) as raised:
            outcome.raise_if_failed()
        self.assertIs(raised.exception, errors[1])

    def test_any_other_error_outranks_an_incomplete_batch_whatever_its_index(self):
        incomplete = JiraBatchIncomplete('http_status')
        auth = RuntimeError('auth_required')
        all_started = threading.Barrier(3, timeout=2)
        failed_first = threading.Event()

        def fetch(batch):
            all_started.wait()
            if batch == 0:
                failed_first.set()
                raise incomplete
            if batch == 2:
                self.assertTrue(failed_first.wait(2))
                time.sleep(0.02)
                raise auth
            return batch

        outcome = run_batches([0, 1, 2], fetch, max_concurrency=4)

        self.assertIs(outcome.failure, auth)
        self.assertFalse(outcome.complete)
        self.assertEqual(outcome.results, [None, 1, None])
        with self.assertRaises(RuntimeError):
            outcome.raise_if_failed()

        first, second = JiraBatchIncomplete('http_status'), JiraBatchIncomplete('continuation')
        both = run_batches([0, 1], lambda batch: (_ for _ in ()).throw(first if batch == 0 else second),
                           max_concurrency=1)
        self.assertIs(both.failure, first)

    def test_a_base_exception_in_a_batch_is_a_failure_and_releases_the_slot(self):
        class Abort(BaseException):
            pass

        threads = []

        def fetch(batch):
            threads.append(threading.current_thread())
            if batch == 1:
                raise Abort()
            time.sleep(0.01)
            return batch

        outcome = run_batches(list(range(6)), fetch, max_concurrency=4)

        self.assertFalse(outcome.complete)
        self.assertIsInstance(outcome.failure, Abort)
        self.assertIsNone(outcome.results[1])
        self.assertEqual(join_batch_threads(threads), [])
        self.assertEqual(self.admission.held, 0)
        self.assertTrue(all_slots_free(self.admission))
        with self.assertRaises(Abort):
            run_batches([0, 1, 2], fetch, max_concurrency=1)

    def test_cancel_check_and_deadline_stop_admission(self):
        for cap in (1, 4):
            with self.subTest(stop='cancel', cap=cap):
                flight = InFlight()
                cancel = threading.Event()
                cancelled = RuntimeError('cancelled')
                first_wave = threading.Barrier(cap, timeout=2)

                def cancel_check():
                    if cancel.is_set():
                        raise cancelled

                def fetch(batch):
                    flight.enter(batch)
                    try:
                        if batch < cap:
                            first_wave.wait()
                        if batch == 0:
                            cancel.set()
                        time.sleep(0.02)
                        return batch
                    finally:
                        flight.leave()

                outcome = run_batches(list(range(10)), fetch, max_concurrency=cap, cancel_check=cancel_check)
                self.assertIs(outcome.failure, cancelled)
                self.assertFalse(outcome.complete)
                self.assertEqual(sorted(flight.started), list(range(cap)))
                self.assertEqual(outcome.results, list(range(cap)) + [None] * (10 - cap))
                with self.assertRaises(RuntimeError):
                    outcome.raise_if_failed()

        for cap in (1, 2):
            with self.subTest(stop='deadline', cap=cap):
                flight = InFlight()
                reading = threading.local()
                admitted_at = {}

                def clock():
                    # The runner reads the clock at admission; keep each thread's last reading.
                    reading.value = time.monotonic()
                    return reading.value

                def fetch(batch):
                    admitted_at[batch] = reading.value
                    flight.enter(batch)
                    try:
                        time.sleep(0.05)
                        return batch
                    finally:
                        flight.leave()

                deadline = time.monotonic() + 0.12
                with patch.object(jira_batches, '_monotonic', clock):
                    outcome = run_batches(list(range(10)), fetch, max_concurrency=cap, deadline=deadline)
                    time.sleep(0.1)
                self.assertTrue(outcome.deadline_exceeded)
                self.assertFalse(outcome.complete)
                self.assertIsNone(outcome.failure)
                self.assertLess(len(flight.started), 10)
                self.assertEqual(sorted(admitted_at), sorted(flight.started))
                self.assertTrue(all(at < deadline for at in admitted_at.values()))
                with self.assertRaises(JiraBatchIncomplete) as raised:
                    outcome.raise_if_failed()
                self.assertEqual(raised.exception.reason, 'deadline')

    def test_stalled_batch_returns_at_the_deadline_with_completed_results_and_the_worker_exits_when_released(self):
        release = threading.Event()
        flight = InFlight()

        def fetch(batch):
            flight.enter(batch)
            try:
                if batch == 1:
                    self.assertTrue(release.wait(5))
                return batch
            finally:
                flight.leave()

        started = time.monotonic()
        outcome = run_batches([0, 1, 2], fetch, max_concurrency=4, deadline=started + 0.2)
        elapsed = time.monotonic() - started

        self.assertLess(elapsed, 0.7)
        self.assertTrue(outcome.deadline_exceeded)
        self.assertEqual(outcome.results, [0, None, 2])
        stalled_thread = flight.threads[1]
        self.assertTrue(stalled_thread.is_alive())
        release.set()
        self.assertEqual(join_batch_threads(list(flight.threads.values())), [])
        self.assertEqual(outcome.results, [0, None, 2])
        self.assertEqual(self.admission.held, 0)
        self.assertTrue(all_slots_free(self.admission))

    def test_pool_is_shut_down_and_slots_are_released_after_success_failure_and_deadline(self):
        pools = []

        class RecordingPool(ThreadPoolExecutor):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.shutdown_calls = []
                pools.append(self)

            def shutdown(self, wait=True, *, cancel_futures=False):
                self.shutdown_calls.append({'wait': wait, 'cancel_futures': cancel_futures})
                return super().shutdown(wait=wait, cancel_futures=cancel_futures)

        release = threading.Event()
        threads = []

        def fetch(batch):
            threads.append(threading.current_thread())
            if batch == 'fail':
                raise RuntimeError('failed batch')
            if batch == 'stall':
                release.wait(5)
            time.sleep(0.01)
            return batch

        with patch.object(jira_batches, 'ThreadPoolExecutor', RecordingPool):
            success = run_batches(['a', 'b', 'c', 'd', 'e'], fetch, max_concurrency=4)
            failure = run_batches(['a', 'fail', 'c', 'd', 'e'], fetch, max_concurrency=4)
            late = run_batches(['a', 'stall', 'c'], fetch, max_concurrency=4, deadline=time.monotonic() + 0.1)
        release.set()

        self.assertTrue(success.complete)
        self.assertIsInstance(failure.failure, RuntimeError)
        self.assertTrue(late.deadline_exceeded)
        self.assertEqual(len(pools), 3)
        for pool in pools:
            self.assertEqual(pool.shutdown_calls[0], {'wait': False, 'cancel_futures': True})
        self.assertEqual(join_batch_threads(threads), [])
        self.assertEqual(self.admission.held, 0)
        self.assertTrue(all_slots_free(self.admission))

    def test_process_wide_slots_bound_helpers_across_eight_concurrent_runs(self):
        lock = threading.Lock()
        state = {'in_flight': 0, 'peak': 0, 'held_peak_seen': 0}
        start = threading.Barrier(8, timeout=5)
        outcomes = [None] * 8

        def fetch(batch):
            with lock:
                state['in_flight'] += 1
                state['peak'] = max(state['peak'], state['in_flight'])
                state['held_peak_seen'] = max(state['held_peak_seen'], self.admission.held)
            try:
                time.sleep(0.02)
                return batch
            finally:
                with lock:
                    state['in_flight'] -= 1

        def run(user):
            start.wait()
            outcomes[user] = run_batches([(user, index) for index in range(12)], fetch, max_concurrency=4)

        users = [threading.Thread(target=run, args=(user,)) for user in range(8)]
        for user in users:
            user.start()
        for user in users:
            user.join(10)

        self.assertTrue(all(not user.is_alive() for user in users))
        for user, outcome in enumerate(outcomes):
            self.assertTrue(outcome.complete)
            self.assertEqual(outcome.results, [(user, index) for index in range(12)])
        self.assertLessEqual(self.admission.peak_held, JIRA_BATCH_GLOBAL_SLOTS)
        self.assertLessEqual(state['held_peak_seen'], JIRA_BATCH_GLOBAL_SLOTS)
        self.assertGreater(self.admission.peak_held, 0)
        self.assertLessEqual(state['peak'], 8 + JIRA_BATCH_GLOBAL_SLOTS)
        self.assertEqual(self.admission.held, 0)
        self.assertTrue(all_slots_free(self.admission))

    def test_a_run_with_no_free_slot_still_completes_with_its_own_first_worker(self):
        for _ in range(JIRA_BATCH_GLOBAL_SLOTS):
            self.assertTrue(self.admission.slots.acquire(blocking=False))
        flight = InFlight()
        caller = threading.current_thread()

        def fetch(batch):
            flight.enter(batch)
            try:
                time.sleep(0.01)
                return batch
            finally:
                flight.leave()

        try:
            outcome = run_batches(list(range(5)), fetch, max_concurrency=4)
        finally:
            for _ in range(JIRA_BATCH_GLOBAL_SLOTS):
                self.admission.slots.release()

        self.assertTrue(outcome.complete)
        self.assertEqual(outcome.results, list(range(5)))
        self.assertEqual(flight.peak, 1)
        self.assertEqual(self.admission.acquired, 0)
        self.assertTrue(all(thread is not caller for thread in flight.threads.values()))

    def test_rate_limited_failure_starts_a_cooldown_that_expires(self):
        clock = {'now': 1000.0}

        def peak_for_run():
            flight = InFlight()

            def fetch(batch):
                flight.enter(batch)
                try:
                    time.sleep(0.02)
                    return batch
                finally:
                    flight.leave()

            outcome = run_batches(list(range(8)), fetch, max_concurrency=4)
            self.assertTrue(outcome.complete)
            return flight.peak

        def limited(batch):
            if batch == 0:
                raise JiraBatchIncomplete('rate_limited', rate_limited=True)
            time.sleep(0.02)
            return batch

        with patch.object(jira_batches, '_monotonic', lambda: clock['now']):
            outcome = run_batches(list(range(8)), limited, max_concurrency=4)
            self.assertTrue(outcome.rate_limited)
            self.assertEqual(outcome.failure.reason, 'rate_limited')
            acquired_before = self.admission.acquired

            clock['now'] += 5
            self.assertEqual(peak_for_run(), 1)
            clock['now'] += RATE_LIMIT_COOLDOWN_SECONDS - 5 - 0.01
            self.assertEqual(peak_for_run(), 1)
            self.assertEqual(self.admission.acquired, acquired_before)

            clock['now'] += 0.02
            self.assertEqual(peak_for_run(), 4)
            self.assertGreater(self.admission.acquired, acquired_before)


if __name__ == '__main__':
    unittest.main()
