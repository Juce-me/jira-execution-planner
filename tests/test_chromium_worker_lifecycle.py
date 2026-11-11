"""Pure lifecycle checks for the embedded owned Chromium campaign fixture."""
import ast
from pathlib import Path
from types import SimpleNamespace
import threading
import time
import unittest
from unittest.mock import Mock


SOURCE = Path(__file__).parent / 'ui/eng_board_progressive_loading.spec.js'


def fixture_scope():
    program = SOURCE.read_text().split('const campaignServer = String.raw`', 1)[1].split('`;', 1)[0]
    parsed = ast.parse(program)
    names = {'State', 'quiesce_case', 'begin_case', 'end_case'}
    nodes = [node for node in parsed.body if isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name in names]
    scope = {'threading': threading, 'time': time, 're': __import__('re'),
             'case_lock': threading.Lock(), 'case_url': None,
             'db_engine': SimpleNamespace(dispose_engines=Mock()),
             'invalidate_auth_status_cache': Mock()}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), scope)
    scope['S'] = scope['State']()
    return scope


class ChromiumWorkerLifecycleTests(unittest.TestCase):
    def test_gate_created_during_cancellation_cannot_outlive_the_case(self):
        scope = fixture_scope()
        state = scope['S']
        original_release = state.release_all
        original_record = state.record
        entered = threading.Event()
        workers = []
        state.active = 1

        def record(event, **fields):
            original_record(event, **fields)
            if event == 'gate_wait':
                entered.set()

        def request():
            try:
                state.gate('created-after-release')
            finally:
                with state.requests:
                    state.active -= 1
                    state.requests.notify_all()

        def release_then_start_late_gate():
            original_release()
            worker = threading.Thread(target=request, daemon=True)
            workers.append(worker)
            worker.start()
            self.assertTrue(entered.wait(2), 'synthetic request never reached its gate')

        state.record = record
        state.release_all = release_then_start_late_gate
        try:
            scope['quiesce_case']()
            self.assertEqual(state.active, 0)
            self.assertTrue(state.changing)
        finally:
            original_release()
            for worker in workers:
                worker.join(2)
                self.assertFalse(worker.is_alive(), 'synthetic request leaked')

    def test_active_lease_cannot_be_replaced_by_a_second_case(self):
        scope = fixture_scope()
        scope['case_url'] = 'synthetic-active-case'
        scope['fresh_model_database_url'] = Mock(side_effect=AssertionError('must not allocate'))
        with self.assertRaisesRegex(RuntimeError, 'already has an active case'):
            scope['begin_case']()
        scope['fresh_model_database_url'].assert_not_called()

    def test_database_cleanup_failure_is_visible_and_never_force_drops(self):
        scope = fixture_scope()
        scope['case_url'] = 'synthetic-active-case'
        scope['make_url'] = Mock(return_value=SimpleNamespace(database='jep_t_' + 'a' * 32))
        scope['_admin_url'] = Mock()
        scope['_execute_admin'] = Mock(side_effect=RuntimeError('synthetic surviving connection'))
        scope['os'] = SimpleNamespace(environ={})
        scope['initial_database_url'] = 'synthetic-initial'
        with self.assertRaisesRegex(RuntimeError, 'surviving connection'):
            scope['end_case']()
        self.assertEqual(scope['case_url'], 'synthetic-active-case')
        self.assertNotIn('FORCE', scope['_execute_admin'].call_args.args[0])
