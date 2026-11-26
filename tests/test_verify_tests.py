"""Pure orchestration checks for uncapped verification and owned cleanup."""

from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('verify_tests', ROOT / 'scripts/verify_tests.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class VerificationGateTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'tmp').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='verify-check-', dir=ROOT / 'tmp')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def run_gate(self, statuses, seconds):
        now = [0.0]
        self.timeouts = []

        def stage(*args, **kwargs):
            self.timeouts.append(kwargs.get('timeout'))
            duration = seconds.pop(0)
            now[0] += duration
            status = statuses.pop(0)
            return {'status': status, 'exitCode': 0 if status == 'passed' else 1, 'seconds': duration}

        stages = [(name, ['synthetic-command']) for name in ('build', 'backend', 'frontend-unit', 'chromium')]
        output = io.StringIO()
        with patch.object(verify, 'run_stage', side_effect=stage), redirect_stdout(output):
            report = verify.run_gate(stages, root=ROOT, environment={}, directory=self.directory, clock=lambda: now[0])
        self.output = output.getvalue()
        return report

    def test_long_verification_runs_all_stages_once_and_records_elapsed_time(self):
        report = self.run_gate(['passed'] * 4, [2, 1200, 20, 1200])
        self.assertEqual(self.timeouts, [None] * 4)
        self.assertTrue(report['complete'])
        self.assertTrue(report['passed'])
        self.assertFalse(report['deadlineEnforced'])
        self.assertEqual(report['seconds'], 2422)
        self.assertEqual([row['name'] for row in report['stages']], ['build', 'backend', 'frontend-unit', 'chromium'])
        self.assertEqual(report['notRun'], [])
        self.assertEqual(json.loads((self.directory / 'result.json').read_text()), report)
        self.assertIn('Complete verification: passed; 2422.000s', self.output)

    def test_verification_finishes_later_stages_after_a_failure(self):
        report = self.run_gate(['passed', 'failed', 'passed', 'failed'], [1, 900, 10, 900])
        self.assertEqual(self.timeouts, [None] * 4)
        self.assertEqual([row['name'] for row in report['stages']], ['build', 'backend', 'frontend-unit', 'chromium'])
        self.assertEqual(report['notRun'], [])
        self.assertFalse(report['deadlineEnforced'])
        self.assertFalse(report['complete'])
        self.assertFalse(report['passed'])
        self.assertIn('Failed stages: backend, chromium', self.output)

    def test_stage_waits_without_a_timeout_and_cleans_up_on_interrupt(self):
        with patch.object(verify.subprocess, 'Popen') as launch, patch.object(verify, 'stop_process_group') as stop:
            child = launch.return_value.__enter__.return_value
            child.wait.side_effect = KeyboardInterrupt
            with self.assertRaises(KeyboardInterrupt):
                verify.run_stage(['synthetic-command'], root=ROOT, environment={}, log=self.directory / 'stage.log')
        child.wait.assert_called_once_with()
        stop.assert_called_once_with(child)

    def test_interrupt_records_incomplete_result_after_stage_cleanup(self):
        with patch.object(verify, 'run_stage', side_effect=KeyboardInterrupt), redirect_stdout(io.StringIO()):
            report = verify.run_gate([('build', ['synthetic-command'])], root=ROOT, environment={}, directory=self.directory)
        self.assertTrue(report['interrupted'])
        self.assertFalse(report['complete'])
        self.assertFalse(report['passed'])
        self.assertEqual(report['notRun'], ['build'])

    def test_shared_worktree_slot_rejects_overlapping_gate_and_releases_after_failure(self):
        with self.assertRaisesRegex(RuntimeError, 'synthetic failure'):
            with verify.verification_slot(self.directory):
                with self.assertRaises(BlockingIOError):
                    with verify.verification_slot(self.directory):
                        self.fail('overlapping full gate acquired a slot')
                raise RuntimeError('synthetic failure')
        with verify.verification_slot(self.directory):
            pass


if __name__ == '__main__':
    unittest.main()
