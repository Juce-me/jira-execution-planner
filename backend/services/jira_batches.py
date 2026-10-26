"""Bounded concurrent execution of independent Jira batches.

A run executes its batches with at most ``max_concurrency`` in flight. With a cap of 1 it runs
inline on the caller's thread, exactly like a plain loop. Above 1 the caller only waits: one worker
always starts, and up to ``max_concurrency - 1`` helpers start only when a process-wide slot is
free without waiting and no rate-limit cooldown is active, so a busy process degrades to one call
at a time per run and never starves or deadlocks. No batch is admitted after the deadline, after a
failure, after ``cancel_check()`` raises, or after a rate-limited failure (which also starts the
process-wide cooldown). The caller returns at the deadline without waiting for a stuck worker; that
worker finishes its own call, admits nothing more and releases its slot.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import threading
import time


JIRA_BATCH_CONCURRENCY = 4
JIRA_BATCH_GLOBAL_SLOTS = 6
RATE_LIMIT_COOLDOWN_SECONDS = 10
INCOMPLETE_REASONS = ('http_status', 'continuation', 'deadline', 'rate_limited', 'cancelled')


class JiraBatchIncomplete(Exception):
    """A batch run that did not complete; ``partial`` carries what did."""

    def __init__(self, reason, rate_limited=False, partial=None):
        if reason not in INCOMPLETE_REASONS:
            raise ValueError(f'unknown incomplete reason: {reason}')
        super().__init__(reason)
        self.reason = reason
        self.rate_limited = bool(rate_limited)
        self.partial = partial


@dataclass
class BatchOutcome:
    results: list
    failure: BaseException | None = None
    deadline_exceeded: bool = False
    rate_limited: bool = False

    @property
    def complete(self):
        return self.failure is None and not self.deadline_exceeded

    def raise_if_failed(self):
        if self.failure is not None:
            raise self.failure
        if self.deadline_exceeded:
            raise JiraBatchIncomplete('deadline', self.rate_limited)


def _monotonic():
    return time.monotonic()


class _ProcessAdmission:
    """Process-wide helper slots and the rate-limit cooldown shared by every run."""

    def __init__(self, slots=JIRA_BATCH_GLOBAL_SLOTS):
        self.slots = threading.BoundedSemaphore(slots)
        self._lock = threading.Lock()
        self._cooldown_until = None

    def try_acquire_helper(self):
        with self._lock:
            if self._cooldown_until is not None and _monotonic() < self._cooldown_until:
                return False
        return self.slots.acquire(blocking=False)

    def release_helper(self):
        self.slots.release()

    def start_cooldown(self):
        with self._lock:
            self._cooldown_until = _monotonic() + RATE_LIMIT_COOLDOWN_SECONDS


_ADMISSION = _ProcessAdmission()


class _Run:
    def __init__(self, batches, fetch_batch, max_concurrency, deadline, cancel_check):
        self.batches = batches
        self.fetch_batch = fetch_batch
        self.max_concurrency = max_concurrency
        self.deadline = deadline
        self.cancel_check = cancel_check
        self.admission = _ADMISSION
        self.lock = threading.Lock()
        self.results = [None] * len(batches)
        self.failure = None
        self.failure_index = None
        self.deadline_exceeded = False
        self.rate_limited = False
        self.next_index = 0
        self.running = 0
        self.completed = 0
        self.workers = 0
        self.stopped = False
        self.finished = threading.Event()
        self.pool = None

    def _fail(self, index, error):
        """Record a failure (the lowest batch index wins) and stop admission; caller holds the lock."""
        if self.failure_index is None or index < self.failure_index:
            self.failure, self.failure_index = error, index
        self.stopped = True
        if getattr(error, 'rate_limited', False) is True and not self.rate_limited:
            self.rate_limited = True
            self.admission.start_cooldown()

    def _claim(self):
        with self.lock:
            if self.stopped or self.next_index >= len(self.batches):
                return None
        if self.cancel_check is not None:
            try:
                self.cancel_check()
            except Exception as error:
                with self.lock:
                    if self.next_index < len(self.batches):
                        self._fail(self.next_index, error)
                return None
        with self.lock:
            if self.stopped or self.next_index >= len(self.batches):
                return None
            if self.deadline is not None and _monotonic() >= self.deadline:
                self.deadline_exceeded = True
                self.stopped = True
                return None
            index = self.next_index
            self.next_index += 1
            self.running += 1
            return index

    def _execute(self, index):
        try:
            result = self.fetch_batch(self.batches[index])
        except Exception as error:
            with self.lock:
                self.running -= 1
                self._fail(index, error)
            return False
        with self.lock:
            self.running -= 1
            self.results[index] = result
            self.completed += 1
        return True

    def run_inline(self):
        while (index := self._claim()) is not None and self._execute(index):
            pass
        with self.lock:
            return self._snapshot()

    def run_concurrent(self):
        self.pool = ThreadPoolExecutor(max_workers=self.max_concurrency, thread_name_prefix='jira-batch')
        try:
            with self.lock:
                self.workers += 1
            self.pool.submit(self._work, False)
            self._request_helpers()
            timeout = None if self.deadline is None else max(0.0, self.deadline - _monotonic())
            finished = self.finished.wait(timeout)
            with self.lock:
                if not finished and self.failure is None and self.completed < len(self.batches):
                    self.deadline_exceeded = True
                # Late results of stuck workers never reach the returned outcome.
                self.stopped = True
                return self._snapshot()
        finally:
            with self.lock:
                self.stopped = True
            self.pool.shutdown(wait=False, cancel_futures=True)

    def _work(self, helper):
        try:
            while (index := self._claim()) is not None and self._execute(index):
                self._request_helpers()
        finally:
            if helper:
                self.admission.release_helper()
            self._worker_exited()

    def _worker_exited(self):
        with self.lock:
            self.workers -= 1
            if self.workers == 0:
                self.finished.set()

    def _request_helpers(self):
        """Start helpers while unstarted batches outnumber idle workers, the cap allows and a slot is free."""
        while True:
            with self.lock:
                idle = self.workers - self.running
                if (self.stopped or self.workers >= self.max_concurrency
                        or len(self.batches) - self.next_index <= idle
                        or not self.admission.try_acquire_helper()):
                    return
                self.workers += 1
            try:
                future = self.pool.submit(self._work, True)
            except RuntimeError:  # the caller returned and shut the pool down meanwhile
                self.admission.release_helper()
                self._worker_exited()
                return
            future.add_done_callback(self._release_cancelled_helper)

    def _release_cancelled_helper(self, future):
        if future.cancelled():
            self.admission.release_helper()
            self._worker_exited()

    def _snapshot(self):
        """The outcome as of now; the caller holds the lock."""
        return BatchOutcome(list(self.results), self.failure, self.deadline_exceeded, self.rate_limited)


def run_batches(batches, fetch_batch, *, max_concurrency=JIRA_BATCH_CONCURRENCY, deadline=None, cancel_check=None):
    """Run ``fetch_batch`` over ``batches``; results keep batch order (``None`` where a batch did not finish)."""
    run = _Run(list(batches), fetch_batch, max(1, int(max_concurrency)), deadline, cancel_check)
    if not run.batches:
        return BatchOutcome([])
    return run.run_inline() if run.max_concurrency <= 1 else run.run_concurrent()
