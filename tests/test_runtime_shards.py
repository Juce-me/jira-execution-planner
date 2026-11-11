"""Pure module-assignment, completion and worker-ownership checks; no app or DB."""

from contextlib import redirect_stdout
import io
import json
import re
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch

from tests import runtime_shards as shards


ROOT = Path(__file__).resolve().parents[1]


class FakeProcess:
    def __init__(self, pid, status=0):
        self.pid = pid
        self.returncode = status
        self.waited = False

    def poll(self):
        return self.returncode

    def wait(self):
        self.waited = True
        return self.returncode


class RuntimeShardTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'tmp').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='shard-check-', dir=ROOT / 'tmp')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'tests').mkdir()
        self.modules = ['tests.test_alpha', 'tests.test_beta', 'tests.test_gamma', 'tests.test_delta']
        for index, module in enumerate(self.modules):
            self.source(module, '# synthetic source\n' * (index + 1))

    def source(self, module, contents=''):
        source = self.root.joinpath(*module.split('.')).with_suffix('.py')
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text(contents)

    def execute(self, outputs, statuses=None, orphan_pid=None, emit_inventory=True):
        statuses = [0] * len(outputs) if statuses is None else statuses
        commands, children, signals = [], [], []

        def launch(command, **kwargs):
            commands.append((command, kwargs))
            index = len(children)
            output = outputs[index]
            if emit_inventory and 'JEP_TEST_INVENTORY ' not in output:
                counts = re.findall(r'Ran (\d+) tests? in', output)
                if counts:
                    output = f'JEP_TEST_INVENTORY tests={counts[-1]}\n' + output
            kwargs['stdout'].write(output)
            child = FakeProcess(41000 + index, statuses[index])
            children.append(child)
            return child

        def kill(pid, number):
            signals.append((pid, number))
            if number == 0 and pid != orphan_pid:
                raise ProcessLookupError

        with patch.object(shards.subprocess, 'Popen', side_effect=launch), \
                patch.object(shards.os, 'killpg', side_effect=kill), redirect_stdout(io.StringIO()) as stream:
            report = shards.run_shards(self.root, self.modules, workers=len(outputs),
                                       include_new=['tests/runtime_shards.py'], node='/synthetic/node', timings=True)
        return report, commands, children, signals, stream.getvalue()

    def test_assignments_are_deterministic_disjoint_exhaustive_and_balanced_by_weight(self):
        weights = dict(zip(self.modules, [8, 7, 3, 2]))
        expected = shards.partition_modules(self.root, self.modules, 2, weights)
        self.assertEqual(expected, shards.partition_modules(self.root, reversed(self.modules), 2, weights))
        self.assertEqual(sorted(module for part in expected for module in part), sorted(self.modules))
        self.assertEqual([sum(weights[module] for module in part) for part in expected], [10, 10])

    def test_zero_weights_and_excess_workers_never_create_discovery_workers(self):
        for workers in (2, 8):
            parts = shards.partition_modules(self.root, self.modules, workers, {name: 0 for name in self.modules})
            self.assertTrue(all(parts))
            self.assertEqual(sum(map(len, parts)), len(self.modules))

    def test_nested_module_paths_are_supported_without_importing_them(self):
        module = 'tests.synthetic_package.test_nested'
        self.source(module, "raise AssertionError('must not import during assignment')\n")
        self.assertEqual(shards.partition_modules(self.root, [module], 4), [[module]])

    def test_duplicate_empty_missing_or_case_selectors_are_refused(self):
        for modules in ([], [self.modules[0]] * 2, ['tests.test_missing'],
                        ['tests.test_alpha.Example.test_work'], ['../test_bad']):
            with self.subTest(modules=modules), self.assertRaises(ValueError):
                shards.partition_modules(self.root, modules, 2)
        for workers in (0, 9, True):
            with self.subTest(workers=workers), self.assertRaises(ValueError):
                shards.partition_modules(self.root, self.modules, workers)
        with self.assertRaises(ValueError):
            shards.partition_modules(self.root, self.modules, 2, {self.modules[0]: float('nan')})

    def test_workers_forward_reviewed_sources_and_cannot_recursively_shard(self):
        report, calls, _, _, _ = self.execute(['Ran 2 tests in 0.100s\nOK\n'] * 2)
        self.assertEqual(report['status'], 0)
        self.assertTrue(report['complete'])
        self.assertEqual(report['module_count'], 4)
        self.assertEqual(report['test_count'], 4)
        for (command, kwargs), partition in zip(calls, report['assignments']):
            self.assertTrue(kwargs['start_new_session'])
            self.assertEqual(kwargs['cwd'], self.root)
            self.assertEqual(command[command.index('--workers') + 1], '1')
            self.assertEqual(command[command.index('--node') + 1], '/synthetic/node')
            self.assertEqual(command[command.index('--include') + 1], 'tests/runtime_shards.py')
            self.assertIn('--timings', command)
            self.assertEqual(command[-len(partition):], partition)
        stored = json.loads((self.root / report['directory'] / 'result.json').read_text())
        self.assertEqual(stored, report)

    def test_zero_exit_without_terminal_summary_is_incomplete_and_fails(self):
        report, _, _, _, output = self.execute(['untrusted diagnostic\n'])
        self.assertEqual(report['status'], 1)
        self.assertFalse(report['complete'])
        self.assertIsNone(report['workers'][0]['test_count'])
        self.assertNotIn('untrusted diagnostic', output)
        self.assertIn('Runtime shards:', output)

    def test_discovered_and_executed_counts_must_match(self):
        for output in ('JEP_TEST_INVENTORY tests=10\nRan 0 tests in 0.1s\nOK\n',
                       'JEP_TEST_INVENTORY tests=2\nRan 3 tests in 0.1s\nOK\n'):
            report, _, _, _, _ = self.execute([output])
            self.assertFalse(report['complete'])
            self.assertFalse(report['passed'])
            self.assertFalse(report['workers'][0]['inventory_matched'])

    def test_empty_worker_cannot_claim_complete_even_with_matching_inventory(self):
        report, _, _, _, _ = self.execute(['JEP_TEST_INVENTORY tests=0\nRan 0 tests in 0.1s\nOK\n'])
        self.assertFalse(report['complete'])
        self.assertFalse(report['passed'])

    def test_timing_worker_without_inventory_cannot_claim_complete(self):
        report, _, _, _, _ = self.execute(['Ran 2 tests in 0.1s\nOK\n'], emit_inventory=False)
        self.assertFalse(report['complete'])
        self.assertFalse(report['passed'])

    def test_final_outer_inventory_overrides_nested_inventory(self):
        report, _, _, _, _ = self.execute(['JEP_TEST_INVENTORY tests=4\n'
            'JEP_TEST_INVENTORY tests=1\nRan 1 test in 0.1s\nOK\n'
            'Ran 4 tests in 0.2s\nOK\nJEP_TEST_INVENTORY tests=4\n'])
        self.assertTrue(report['passed'])
        self.assertEqual(report['workers'][0]['expected_test_count'], 4)

    def test_any_failed_worker_prevents_success(self):
        report, _, _, _, _ = self.execute(['Ran 2 tests in 0.100s\nOK\n',
                                          'Ran 3 tests in 0.200s\nFAILED (failures=1)\n'], [0, 1])
        self.assertEqual(report['status'], 1)
        self.assertTrue(report['complete'])
        self.assertFalse(report['passed'])
        self.assertEqual(report['test_count'], 5)

    def test_inner_success_cannot_complete_a_later_unfinished_outer_summary(self):
        report, _, _, _, _ = self.execute(['Ran 1 test in 0.100s\nOK\nRan 5 tests in 0.200s\n'])
        self.assertEqual(report['status'], 1)
        self.assertFalse(report['complete'])
        self.assertEqual(report['workers'][0]['test_count'], 5)

    def test_terminal_summary_colors_are_tolerated_and_signal_handlers_are_restored(self):
        previous = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
        report, _, _, _, _ = self.execute(['Ran 1 test in 0.100s\n\x1b[32mOK\x1b[0m\n'])
        self.assertEqual(report['status'], 0)
        self.assertEqual({number: signal.getsignal(number) for number in previous}, previous)

    def test_normal_exit_with_background_processes_fails_and_removes_group(self):
        report, _, children, signals, _ = self.execute(['Ran 1 test in 0.100s\nOK\n'], orphan_pid=41000)
        self.assertEqual(report['status'], 1)
        self.assertTrue(report['workers'][0]['orphaned'])
        self.assertTrue(children[0].waited)
        self.assertIn((41000, signal.SIGTERM), signals)
        self.assertIn((41000, signal.SIGKILL), signals)

    def test_interrupt_signals_every_owner_and_joins_before_returning(self):
        children, signals = [], []

        def launch(*args, **kwargs):
            child = FakeProcess(42000 + len(children), None)
            children.append(child)
            return child

        def kill(pid, number):
            signals.append((pid, number))
            if number == signal.SIGTERM:
                children[pid - 42000].returncode = -signal.SIGTERM

        with patch.object(shards.subprocess, 'Popen', side_effect=launch), \
                patch.object(shards.os, 'killpg', side_effect=kill), \
                patch.object(shards.time, 'sleep', side_effect=KeyboardInterrupt), redirect_stdout(io.StringIO()):
            report = shards.run_shards(self.root, self.modules, workers=2)
        self.assertEqual(report['status'], 130)
        self.assertFalse(report['complete'])
        self.assertEqual(signals[:2], [(42000, signal.SIGTERM), (42001, signal.SIGTERM)])
        self.assertTrue(all(child.waited for child in children))

    def test_worker_launch_failure_cleans_up_already_started_owner(self):
        child = FakeProcess(43000, None)

        def kill(_pid, number):
            if number == signal.SIGTERM:
                child.returncode = -signal.SIGTERM

        with patch.object(shards.subprocess, 'Popen', side_effect=[child, OSError('private error')]), \
                patch.object(shards.os, 'killpg', side_effect=kill), redirect_stdout(io.StringIO()) as output:
            report = shards.run_shards(self.root, self.modules, workers=2)
        self.assertEqual(report['status'], 1)
        self.assertTrue(report['launch_failed'])
        self.assertFalse(report['complete'])
        self.assertTrue(child.waited)
        self.assertNotIn('private error', output.getvalue())

    def test_cleanup_grace_is_shared_and_all_groups_are_killed_and_joined(self):
        now = [0.0]
        children = [FakeProcess(44000, None), FakeProcess(44001, None)]
        workers = [{'process': child} for child in children]
        signals = []

        def kill(pid, number):
            signals.append((pid, number))
            if number == signal.SIGKILL:
                children[pid - 44000].returncode = -signal.SIGKILL

        with patch.object(shards.os, 'killpg', side_effect=kill):
            shards._stop_workers(workers, grace=75, clock=lambda: now[0],
                                 sleep=lambda seconds: now.__setitem__(0, now[0] + seconds))
        self.assertAlmostEqual(now[0], 75)
        self.assertEqual(signals[:2], [(44000, signal.SIGTERM), (44001, signal.SIGTERM)])
        self.assertTrue(all(child.waited for child in children))


if __name__ == '__main__':
    unittest.main()
