"""Task 1 limitation probes; passing tests do not pass the transport gate.

The existing cooperative budget cannot stop a running blocking call. Keep each
probe in a disposable subprocess so executor shutdown cannot hang the suite.
No application routes, database tables or production workers are created here.
"""

import os
import pathlib
import selectors
import subprocess
import sys
import textwrap
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class EngBoardHardTerminationFeasibilityTests(unittest.TestCase):
    def test_cooperative_cancel_cannot_terminate_blocked_executor_work(self):
        for wait_for_workers in (True, False):
            with self.subTest(wait_for_workers=wait_for_workers):
                script = textwrap.dedent('''
                    from concurrent.futures import ThreadPoolExecutor
                    import sys
                    import threading
                    from backend.services.eng_board_measurement_runtime import (
                        CooperativeBudget, MeasurementDeadlineExceeded,
                    )

                    entered = threading.Event()
                    blocked = threading.Event()
                    budget = CooperativeBudget.start(30)

                    def blocking_io():
                        budget.check()
                        entered.set()
                        blocked.wait()
                        budget.check()

                    pool = ThreadPoolExecutor(max_workers=2)
                    future = pool.submit(blocking_io)
                    assert entered.wait(2), 'worker did not start'
                    print('BLOCKED', flush=True)
                    assert sys.stdin.readline() == 'cancel\\n'
                    budget.cancel()
                    try:
                        budget.check()
                    except MeasurementDeadlineExceeded:
                        print('BUDGET_CANCELLED', flush=True)
                    else:
                        raise AssertionError('budget cancellation did not register')
                    assert future.cancel() is False, 'running future was cancelled'
                    print('WORKER_STILL_RUNNING', flush=True)
                    pool.shutdown(wait=WAIT_FOR_WORKERS, cancel_futures=True)
                    print('SHUTDOWN_RETURNED', flush=True)
                ''').replace('WAIT_FOR_WORKERS', repr(wait_for_workers))
                process = subprocess.Popen(
                    [sys.executable, '-u', '-c', script], cwd=ROOT,
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, bufsize=0,
                )
                received = bytearray()
                try:
                    with selectors.DefaultSelector() as selector:
                        selector.register(process.stdout, selectors.EVENT_READ)

                        def await_marker(marker):
                            deadline = time.monotonic() + 5
                            while marker not in received:
                                remaining = deadline - time.monotonic()
                                self.assertGreater(remaining, 0, 'probe handshake timed out')
                                self.assertTrue(selector.select(timeout=remaining),
                                                'probe handshake timed out')
                                chunk = os.read(process.stdout.fileno(), 4096)
                                self.assertTrue(chunk, 'probe exited during handshake')
                                received.extend(chunk)

                        await_marker(b'BLOCKED\n')
                        process.stdin.write(b'cancel\n')
                        process.stdin.flush()
                        await_marker(b'BUDGET_CANCELLED\n')
                        await_marker(b'WORKER_STILL_RUNNING\n')
                        if not wait_for_workers:
                            await_marker(b'SHUTDOWN_RETURNED\n')
                    with self.assertRaises(subprocess.TimeoutExpired):
                        process.wait(timeout=0.3)
                    # External harness termination is cleanup, not a capability
                    # of CooperativeBudget or the application's executor.
                    process.kill()
                    output, errors = process.communicate(timeout=2)
                    output = bytes(received) + output
                    self.assertEqual(b'', errors)
                    self.assertIn(b'BUDGET_CANCELLED\n', output)
                    self.assertIn(b'WORKER_STILL_RUNNING\n', output)
                    self.assertEqual(not wait_for_workers, b'SHUTDOWN_RETURNED\n' in output)
                    self.assertIsNotNone(process.returncode)
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.communicate(timeout=2)


if __name__ == '__main__':
    unittest.main()
