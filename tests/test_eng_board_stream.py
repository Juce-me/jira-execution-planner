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

from backend.services.eng_board_stream import (
    ENG_BOARD_MAX_FRAME_BYTES,
    ENG_BOARD_MAX_GENERATION_BYTES,
    EngBoardFrameError,
    EngBoardStreamWriter,
)


ROOT = pathlib.Path(__file__).resolve().parents[1]


def start_frame(**overrides):
    value = {
        'protocolVersion': 1,
        'generationId': 'generation-1',
        'sequence': 0,
        'type': 'start',
        'scope': 'all_work',
        'scopeVersion': 'scope-v1',
        'scopeCohortDigest': 'a' * 64,
        'columns': [],
    }
    value.update(overrides)
    return value


def diagnostics(completeness='complete'):
    return {
        'indexMs': 1,
        'focusedCompleteMs': None,
        'durationMs': 2,
        'jiraRequests': 1,
        'jiraPages': 1,
        'jiraRetries': 0,
        'peakChildSearches': 0,
        'cacheState': 'miss',
        'completeness': completeness,
    }


def complete_frame(**overrides):
    value = {
        'protocolVersion': 1,
        'generationId': 'generation-1',
        'sequence': 1,
        'type': 'complete',
        'outcome': 'success',
        'authoritative': True,
        'epicCount': 0,
        'childCount': 0,
        'diagnostics': diagnostics(),
    }
    value.update(overrides)
    return value


class EngBoardStreamWriterTests(unittest.TestCase):
    def test_candidate_ceiling_fixture_fits_selected_limits_with_measured_headroom(self):
        def epic(index):
            return {
                'key': f'EPIC-{index}', 'summary': f'Synthetic representative epic {index}',
                'status': {'id': '3', 'name': 'In Progress'},
                'priority': {'id': '2', 'name': 'High'},
                'assignee': {'accountId': 'account-1', 'displayName': 'Example User', 'avatarUrl': None},
                'deliveryOwner': None, 'projectTrack': 'Product',
                'updated': '2026-09-08T10:00:00.000+0000', 'parent': None,
                'columnId': 'in-progress',
            }

        def child(index):
            return {
                'key': f'STORY-{index}', 'epicKey': f'EPIC-{index % 1000}',
                'summary': f'Synthetic representative child work item {index}',
                'status': {'id': '3', 'name': 'In Progress'},
                'priority': {'id': '2', 'name': 'High'},
                'issueType': {'id': '10001', 'name': 'Story'},
                'assignee': {'accountId': 'account-1', 'displayName': 'Example User', 'avatarUrl': None},
                'updated': '2026-09-08T10:00:00.000+0000', 'storyPoints': 5,
                'team': {'id': 'team-1', 'name': 'Example Team'},
                'project': {'id': 'project-1', 'name': 'Example Project'},
                'projectClassification': 'product', 'sprintIds': [123],
            }

        frame = {
            'protocolVersion': 1, 'generationId': 'generation-1', 'sequence': 1,
            'type': 'column', 'columnId': 'in-progress',
            'epics': [epic(index) for index in range(1000)],
            'children': [child(index) for index in range(10000)],
            'authoritative': True,
        }
        writer = EngBoardStreamWriter()
        writer.write(start_frame())
        encoded = writer.write(frame)

        # Exact serialized evidence for the protocol's 1,000-Epic/10,000-child
        # synthetic ceiling fixture. The 8 MiB frame cap leaves ~2.8 MiB for
        # realistic value variance; the 32 MiB generation cap permits bounded
        # progress/index overhead without weakening the independent frame cap.
        self.assertEqual(5_447_610, len(encoded))
        self.assertLess(len(encoded), ENG_BOARD_MAX_FRAME_BYTES)
        self.assertLess(writer.total_bytes, ENG_BOARD_MAX_GENERATION_BYTES)

    def test_writer_emits_compact_utf8_ndjson_and_tracks_exact_limits(self):
        first = EngBoardStreamWriter().write(start_frame(columns=[{
            'id': 'todo', 'name': 'Plan 🚀', 'color': '#123456',
            'statusNames': ['To Do'], 'terminal': False,
        }]))
        terminal = EngBoardStreamWriter().write(start_frame())
        self.assertTrue(first.endswith(b'\n'))
        self.assertIn('Plan 🚀'.encode('utf-8'), first)
        self.assertNotIn(b'\\ud83d', first)
        self.assertLess(len(first), ENG_BOARD_MAX_FRAME_BYTES)
        self.assertLess(len(first) + len(terminal), ENG_BOARD_MAX_GENERATION_BYTES)

        exact = EngBoardStreamWriter(max_frame_bytes=len(first) - 1,
                                     max_generation_bytes=len(first))
        self.assertEqual(first, exact.write(start_frame(columns=[{
            'id': 'todo', 'name': 'Plan 🚀', 'color': '#123456',
            'statusNames': ['To Do'], 'terminal': False,
        }])))
        with self.assertRaisesRegex(EngBoardFrameError, 'frame_too_large'):
            EngBoardStreamWriter(max_frame_bytes=len(first) - 2).write(start_frame(columns=[{
                'id': 'todo', 'name': 'Plan 🚀', 'color': '#123456',
                'statusNames': ['To Do'], 'terminal': False,
            }]))

        measurement_writer = EngBoardStreamWriter()
        measured_first = measurement_writer.write(start_frame(columns=[{
            'id': 'todo', 'name': 'Plan 🚀', 'color': '#123456',
            'statusNames': ['To Do'], 'terminal': False,
        }]))
        measured_complete = measurement_writer.write(complete_frame())
        writer = EngBoardStreamWriter(
            max_generation_bytes=len(measured_first) + len(measured_complete) - 1,
        )
        writer.write(start_frame(columns=[{
            'id': 'todo', 'name': 'Plan 🚀', 'color': '#123456',
            'statusNames': ['To Do'], 'terminal': False,
        }]))
        with self.assertRaisesRegex(EngBoardFrameError, 'generation_too_large'):
            writer.write(complete_frame())

    def test_writer_rejects_unknown_fields_nonfinite_numbers_and_nonmonotonic_sequence(self):
        invalid_frames = [
            start_frame(unexpected=True),
            start_frame(sequence=1),
            start_frame(scopeVersion='invalid\ud800'),
            complete_frame(diagnostics={**diagnostics(), 'durationMs': float('nan')}),
        ]
        for frame in invalid_frames:
            with self.subTest(frame=frame):
                with self.assertRaises(EngBoardFrameError):
                    EngBoardStreamWriter().write(frame)

        writer = EngBoardStreamWriter()
        writer.write(start_frame())
        with self.assertRaisesRegex(EngBoardFrameError, 'invalid_sequence'):
            writer.write({
                'protocolVersion': 1, 'generationId': 'generation-1', 'sequence': 0,
                'type': 'progress', 'columnId': 'todo', 'loadedChildren': 0, 'byEpic': [],
            })

    def test_writer_closes_after_terminal_frame(self):
        writer = EngBoardStreamWriter()
        writer.write(start_frame())
        writer.write(complete_frame())
        with self.assertRaisesRegex(EngBoardFrameError, 'stream_complete'):
            writer.write(complete_frame(sequence=2))


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
