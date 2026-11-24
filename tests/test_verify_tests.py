"""Pure orchestration checks: complete coverage and deadline failure semantics."""

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

    def run_gate(self, statuses, seconds, **options):
        now = [0.0]
        self.timeouts = []

        def stage(*args, **kwargs):
            self.timeouts.append(kwargs['timeout'])
            now[0] += seconds.pop(0)
            status = statuses.pop(0)
            return {'status': status, 'exitCode': 0 if status == 'passed' else 124, 'seconds': now[0]}

        stages = [(name, ['synthetic-command']) for name in ('build', 'backend', 'frontend-unit', 'chromium')]
        output = io.StringIO()
        with patch.object(verify, 'run_stage', side_effect=stage), redirect_stdout(output):
            report = verify.run_gate(stages, root=ROOT, environment={}, directory=self.directory, clock=lambda: now[0], **options)
        self.output = output.getvalue()
        return report

    def test_each_required_stage_runs_once_and_total_includes_all_stages(self):
        report = self.run_gate(['passed'] * 4, [1, 2, 3, 4])
        self.assertTrue(report['passed'])
        self.assertTrue(report['deadlineEnforced'])
        self.assertEqual(report['seconds'], 10)
        self.assertEqual([row['name'] for row in report['stages']], ['build', 'backend', 'frontend-unit', 'chromium'])

    def test_without_deadline_every_stage_runs_to_completion_after_a_failure(self):
        report = self.run_gate(['passed', 'failed', 'passed', 'failed'], [1, 900, 10, 900], enforce_deadline=False)
        self.assertEqual(self.timeouts, [None] * 4)
        self.assertEqual([row['name'] for row in report['stages']], ['build', 'backend', 'frontend-unit', 'chromium'])
        self.assertEqual(report['notRun'], [])
        self.assertFalse(report['deadlineEnforced'])
        self.assertFalse(report['complete'])
        self.assertFalse(report['passed'])
        self.assertIn('failed stages: backend, chromium', self.output)

    def test_without_deadline_a_complete_slow_run_passes_and_reports_the_overrun(self):
        report = self.run_gate(['passed'] * 4, [100, 1500, 20, 180], enforce_deadline=False)
        self.assertTrue(report['complete'])
        self.assertTrue(report['passed'])
        self.assertFalse(report['withinBudget'])
        self.assertIn('600s target exceeded by 1200.000s', self.output)

    def test_timed_out_backend_cannot_pass_or_claim_unrun_browser_coverage(self):
        report = self.run_gate(['passed', 'deadline-exceeded'], [1, 600])
        self.assertFalse(report['passed'])
        self.assertFalse(report['complete'])
        self.assertEqual(report['notRun'], ['frontend-unit', 'chromium'])
        self.assertEqual(json.loads((self.directory / 'result.json').read_text()), report)

    def test_complete_functional_success_above_budget_still_fails_performance(self):
        report = self.run_gate(['passed'] * 4, [100, 100, 100, 301])
        self.assertTrue(report['complete'])
        self.assertFalse(report['withinBudget'])
        self.assertFalse(report['passed'])

    def test_stage_not_started_at_deadline_remains_in_not_run_inventory(self):
        report = self.run_gate(['passed'] * 3, [200, 200, 200])
        self.assertFalse(report['complete'])
        self.assertEqual(report['stages'][-1]['status'], 'not-run-deadline-exceeded')
        self.assertEqual(report['notRun'], ['chromium'])

    def test_interrupt_records_incomplete_result_after_stage_cleanup(self):
        with patch.object(verify, 'run_stage', side_effect=KeyboardInterrupt), redirect_stdout(io.StringIO()):
            report = verify.run_gate([('build', ['synthetic-command'])], root=ROOT, environment={}, directory=self.directory)
        self.assertTrue(report['interrupted'])
        self.assertFalse(report['complete'])
        self.assertFalse(report['passed'])

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
