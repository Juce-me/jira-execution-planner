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
import threading
import textwrap
import time
import unittest

from flask import Flask, Response, request

from backend.services import eng_board
from backend.services.eng_board_stream import (
    ENG_BOARD_MAX_CHILD_SEARCHES,
    ENG_BOARD_MAX_FRAME_BYTES,
    ENG_BOARD_MAX_GENERATION_BYTES,
    EngBoardChildScheduler,
    EngBoardFrameError,
    EngBoardRequestBudget,
    EngBoardRequestDeadline,
    EngBoardRequestTransport,
    EngBoardStreamWriter,
)


ROOT = pathlib.Path(__file__).resolve().parents[1]


class PrototypeSearches:
    def __init__(self):
        self.condition = threading.Condition()
        self.started = []
        self.running = 0
        self.peak = 0
        self.released = set()
        self.timeouts = []

    def search(self, column_id):
        def run(timeout):
            with self.condition:
                self.started.append(column_id)
                self.timeouts.append(timeout)
                self.running += 1
                self.peak = max(self.peak, self.running)
                self.condition.notify_all()
                while column_id not in self.released:
                    self.condition.wait(timeout=0.1)
                self.running -= 1
                self.condition.notify_all()
            return column_id
        return run

    def wait_started(self, count, timeout=2):
        deadline = time.monotonic() + timeout
        with self.condition:
            while len(self.started) < count:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self.condition.wait(timeout=remaining)
            return True

    def release(self, *column_ids):
        with self.condition:
            self.released.update(column_ids)
            self.condition.notify_all()


def create_prototype_app(searches, *, now_fn=time.monotonic, budget_seconds=30):
    app = Flask(__name__)

    @app.get('/api/eng/board')
    def stream():
        focused = request.args.get('focusedColumnId') or 'todo'
        columns = [focused] + [value for value in ('todo', 'doing', 'done') if value != focused]

        def frames():
            writer = EngBoardStreamWriter()
            scheduler = EngBoardChildScheduler(
                [searches.search(column_id) for column_id in columns],
                budget=EngBoardRequestBudget.start(budget_seconds, now_fn=now_fn),
            )
            try:
                yield writer.write(start_frame(columns=[]))
                for sequence, column_id in enumerate(scheduler.results(), 1):
                    yield writer.write({
                        'protocolVersion': 1, 'generationId': 'generation-1',
                        'sequence': sequence, 'type': 'progress', 'columnId': column_id,
                        'loadedChildren': 1, 'byEpic': [],
                    })
            except EngBoardRequestDeadline:
                timeout_diagnostics = {
                    **diagnostics('partial'),
                    'jiraRequests': scheduler.scheduled_searches,
                    'jiraPages': scheduler.scheduled_searches,
                    'peakChildSearches': scheduler.peak_child_searches,
                }
                yield writer.write({
                    'protocolVersion': 1, 'generationId': 'generation-1',
                    'sequence': writer.sequence + 1, 'type': 'error',
                    'code': 'deadline_exceeded',
                    'diagnostics': timeout_diagnostics,
                })
            finally:
                scheduler.retire()

        return Response(frames(), content_type='application/x-ndjson')

    return app


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
    def test_start_frame_accepts_component_scope(self):
        encoded = EngBoardStreamWriter().write(start_frame(scope='component'))
        self.assertEqual('component', __import__('json').loads(encoded)['scope'])

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


class EngBoardPrototypeTests(unittest.TestCase):
    def test_core_workload_ceilings_accept_exact_bound_and_reject_or_split_next(self):
        for limit in (eng_board.MAX_EPICS, eng_board.MAX_CHILDREN):
            with self.subTest(limit=limit):
                exact = eng_board.UniqueKeyBudget(limit)
                exact.accept([f'KEY-{index}' for index in range(limit)], complete=True)
                self.assertEqual(limit, len(exact.keys))
                over = eng_board.UniqueKeyBudget(limit)
                with self.assertRaisesRegex(eng_board.EngBoardError, 'board_scope_too_large'):
                    over.accept([f'KEY-{index}' for index in range(limit + 1)], complete=True)

        counters = eng_board.PagerCounters(pages=eng_board.MAX_PAGES_PER_GENERATION - 1)
        counters.claim_request(eng_board.MAX_ENCODED_REQUEST_BYTES, eng_board.MAX_PAGES_PER_SEARCH)
        self.assertEqual(eng_board.MAX_PAGES_PER_GENERATION, counters.pages)
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_scope_too_large'):
            counters.claim_request(1, 1)

        batches = eng_board.split_epic_batches(
            [f'EPIC-{index}' for index in range(eng_board.MAX_BATCH_SIZE + 1)],
            lambda keys: f'key in ({",".join(keys)})',
            ('summary',),
        )
        self.assertEqual([eng_board.MAX_BATCH_SIZE, 1], [len(batch) for batch in batches])

        base_bytes = eng_board.encoded_search_bytes('', ('summary',))
        exact_jql = 'x' * (eng_board.MAX_ENCODED_REQUEST_BYTES - base_bytes)
        self.assertEqual(
            eng_board.MAX_ENCODED_REQUEST_BYTES,
            eng_board.encoded_search_bytes(exact_jql, ('summary',)),
        )
        calls = []
        eng_board.strict_search(
            lambda payload: calls.append(payload) or {'issues': [], 'isLast': True},
            exact_jql, ('summary',),
        )
        self.assertEqual(1, len(calls))
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_scope_too_large'):
            eng_board.strict_search(
                lambda _payload: self.fail('over-limit query reached transport'),
                exact_jql + 'x', ('summary',),
            )

        page = 0
        def search(_payload):
            nonlocal page
            page += 1
            return {
                'issues': [], 'isLast': page == eng_board.MAX_PAGES_PER_SEARCH,
                **({} if page == eng_board.MAX_PAGES_PER_SEARCH else {'nextPageToken': f'p-{page}'}),
            }
        self.assertEqual([], eng_board.strict_search(search, 'project = "P"', ('summary',)))
        self.assertEqual(eng_board.MAX_PAGES_PER_SEARCH, page)

    def test_request_transport_is_compatible_with_existing_jira_and_oauth_budgets(self):
        from types import SimpleNamespace
        from backend.auth.jira_auth import request_oauth_refresh_token
        from backend.db.cloud_sql import CloudSqlIamConfig
        from backend.jira_client import resilient_jira_get

        class BoundaryResponse:
            status_code = 200
            headers = {}

            def __init__(self, payload=None):
                self.payload = payload or {}
                self.closed = False

            def iter_content(self, chunk_size):
                self.chunk_size = chunk_size
                return iter((b'{}',))

            def json(self):
                return self.payload

            def close(self):
                self.closed = True

        class JiraSession:
            def get(self, _url, **kwargs):
                self.kwargs = kwargs
                self.response = BoundaryResponse()
                return self.response

        transport = EngBoardRequestTransport(
            budget=EngBoardRequestBudget.start(30),
        )
        kwargs = transport.resilient_kwargs()
        self.assertIs(kwargs['diagnostic_budget'], transport.budget)
        self.assertIs(kwargs['diagnostic_observer'], transport.observer)
        self.assertIs(kwargs['breaker'], transport.breaker)
        transport.observer.add('jiraLogicalRequestCount')
        transport.observer.add('jiraPageCount', 2)
        transport.observer.add('jiraRetryCount')
        transport.observer.add('oauthRefreshCount')
        self.assertEqual({
            'jiraRequests': 1,
            'jiraPages': 2,
            'jiraRetries': 1,
            'oauthRefreshes': 1,
        }, transport.diagnostics())

        jira_transport = EngBoardRequestTransport(
            budget=EngBoardRequestBudget.start(30),
        )
        jira_session = JiraSession()
        resilient_jira_get(
            'https://jira.example.test/rest/api/3/search/jql', session=jira_session,
            timeout=30, **jira_transport.resilient_kwargs(),
        )
        jira_connect, jira_read = jira_session.kwargs['timeout']
        self.assertEqual(5.0, jira_connect)
        self.assertGreater(jira_read, 29.0)
        self.assertLessEqual(jira_read, 30.0)
        self.assertTrue(jira_session.response.closed)

        oauth_calls = []
        oauth_transport = EngBoardRequestTransport(
            budget=EngBoardRequestBudget.start(30),
        )
        def oauth_post(_url, **kwargs):
            oauth_calls.append(kwargs)
            return BoundaryResponse({
                'access_token': 'synthetic-access', 'refresh_token': 'synthetic-refresh',
                'expires_in': 3600,
            })
        request_oauth_refresh_token(
            SimpleNamespace(client_id='client', client_secret='secret'),
            'refresh', http_post=oauth_post,
            cooperative_budget=oauth_transport.budget,
            diagnostic_observer=oauth_transport.observer,
        )
        oauth_connect, oauth_read = oauth_calls[0]['timeout']
        self.assertEqual(5.0, oauth_connect)
        self.assertGreater(oauth_read, 19.0)
        self.assertLessEqual(oauth_read, 20.0)

        cloud_sql = CloudSqlIamConfig.from_database_url(
            'postgresql+psycopg://synthetic@db.example.test:5432/app?sslmode=require',
        )
        self.assertEqual(10, cloud_sql.connect_kwargs()['connect_timeout'])

    def test_normal_scheduler_completion_keeps_final_checkpoint_available(self):
        budget = EngBoardRequestBudget.start(30)
        scheduler = EngBoardChildScheduler([
            lambda _timeout: 'focused',
            lambda _timeout: 'next',
        ], budget=budget)
        self.assertEqual(['focused', 'next'], list(scheduler.results()))
        budget.check()

    def test_one_get_runs_two_searches_and_retirement_admits_no_third(self):
        searches = PrototypeSearches()
        app = create_prototype_app(searches)

        response = app.test_client().get(
            '/api/eng/board?focusedColumnId=doing', buffered=False,
        )
        iterator = iter(response.response)
        self.assertEqual('start', __import__('json').loads(next(iterator))['type'])
        self.assertTrue(searches.wait_started(2))
        self.assertCountEqual(['doing', 'todo'], searches.started)
        self.assertEqual(ENG_BOARD_MAX_CHILD_SEARCHES, searches.peak)

        searches.release('doing')
        self.assertEqual('doing', __import__('json').loads(next(iterator))['columnId'])
        response.close()
        searches.release('todo', 'done')

        deadline = time.monotonic() + 1
        while searches.running and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertCountEqual(['doing', 'todo'], searches.started)
        self.assertEqual(0, searches.running)

    def test_budget_uses_bounded_jira_timeout_and_deadline_is_sanitized(self):
        now = [0.0]
        searches = PrototypeSearches()
        app = create_prototype_app(searches, now_fn=lambda: now[0])
        response = app.test_client().get('/api/eng/board', buffered=False)
        try:
            iterator = iter(response.response)
            next(iterator)
            self.assertTrue(searches.wait_started(2))
            self.assertEqual([(5.0, 30.0), (5.0, 30.0)], searches.timeouts)

            now[0] = 30.0
            error = __import__('json').loads(next(iterator))
            self.assertEqual('error', error['type'])
            self.assertEqual('deadline_exceeded', error['code'])
            self.assertEqual('partial', error['diagnostics']['completeness'])
            self.assertEqual(2, error['diagnostics']['peakChildSearches'])
            self.assertEqual(2, error['diagnostics']['jiraRequests'])
            self.assertEqual(2, error['diagnostics']['jiraPages'])
        finally:
            response.close()
            searches.release('todo', 'doing', 'done')

        budget = EngBoardRequestBudget.start(30, now_fn=lambda: now[0])
        now[0] = 59.999
        connect_timeout, read_timeout = budget.jira_timeout()
        self.assertAlmostEqual(0.001, connect_timeout)
        self.assertAlmostEqual(0.001, read_timeout)
        self.assertAlmostEqual(0.001, budget.jira_retry_timeout())
        now[0] = 60.0
        with self.assertRaisesRegex(EngBoardRequestDeadline, 'deadline_exceeded'):
            budget.check()


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
