"""Pure checks for complete, sanitized test timing and fixture cleanup."""

import io
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tests import runtime_test_runner as runner

from tests.runtime_test_runner import run_suite


class RuntimeTestRunnerTests(unittest.TestCase):
    def test_case_timing_includes_setup_and_registered_cleanup(self):
        now = [0.0]

        class Sample(unittest.TestCase):
            def setUp(self):
                now[0] += 2
                self.addCleanup(lambda: now.__setitem__(0, now[0] + 3))

            def test_work(self):
                now[0] += 5

        stream = io.StringIO()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Sample)
        status = run_suite(suite, stream=stream, timings=True, clock=lambda: now[0], modules={})
        self.assertEqual(status, 0)
        self.assertIn('tests=1 seconds=10.000', stream.getvalue())

    def test_cleanup_failure_prevents_success_without_printing_exception_details(self):
        stream = io.StringIO()

        def fail_cleanup():
            raise RuntimeError('PRIVATE_DIAGNOSTIC_MUST_NOT_PRINT')

        modules = {'tests.postgres_test_db': SimpleNamespace(cleanup_model_templates=fail_cleanup)}
        status = run_suite(unittest.TestSuite(), stream=stream, modules=modules)
        self.assertEqual(status, 1)
        self.assertIn('Model database fixture cleanup failed.', stream.getvalue())
        self.assertNotIn('PRIVATE_DIAGNOSTIC', stream.getvalue())

    def test_failing_test_still_cleans_up_loaded_templates(self):
        cleaned = []

        class Sample(unittest.TestCase):
            def test_work(self):
                self.fail('synthetic assertion')

        modules = {'tests.postgres_test_db': SimpleNamespace(cleanup_model_templates=lambda: cleaned.append(True))}
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Sample)
        self.assertEqual(run_suite(suite, stream=io.StringIO(), modules=modules), 1)
        self.assertEqual(cleaned, [True])

    def test_unloaded_postgres_helper_is_not_imported_for_pure_suites(self):
        self.assertEqual(run_suite(unittest.TestSuite(), stream=io.StringIO(), modules={}), 0)

    def test_comprehensive_fixture_cleanup_takes_precedence_over_legacy_templates(self):
        cleaned = []

        def legacy_cleanup():
            self.fail('legacy-only cleanup must not hide worker schema resources')

        modules = {'tests.postgres_test_db': SimpleNamespace(
            cleanup_model_fixtures=lambda: cleaned.append('all fixtures'),
            cleanup_model_templates=legacy_cleanup)}
        self.assertEqual(run_suite(unittest.TestSuite(), stream=io.StringIO(), modules=modules), 0)
        self.assertEqual(cleaned, ['all fixtures'])

    def test_outer_inventory_is_repeated_after_nested_runner_output(self):
        suite = Mock()
        suite.countTestCases.return_value = 2
        output = io.StringIO()

        def nested_output(*args, **kwargs):
            print('JEP_TEST_INVENTORY tests=1')
            return 0

        with patch.dict(runner.sys.modules, {'sitecustomize': SimpleNamespace(snapshot=True)}), \
                patch.dict(runner.os.environ, {'JEP_ISOLATED_RUNTIME': '1'}), \
                patch.object(runner.signal, 'signal'), \
                patch.object(runner.unittest.defaultTestLoader, 'loadTestsFromNames', return_value=suite), \
                patch.object(runner, 'run_suite', side_effect=nested_output), \
                patch.object(runner.sys, 'stdout', output):
            self.assertEqual(runner.main(['--timings', 'tests.synthetic']), 0)
        inventories = [line for line in output.getvalue().splitlines() if line.startswith('JEP_TEST_INVENTORY')]
        self.assertEqual(inventories, ['JEP_TEST_INVENTORY tests=2', 'JEP_TEST_INVENTORY tests=1',
                                      'JEP_TEST_INVENTORY tests=2'])

    def test_interrupt_still_cleans_up_loaded_templates(self):
        cleaned = []

        class Sample(unittest.TestCase):
            def test_work(self):
                raise KeyboardInterrupt

        modules = {'tests.postgres_test_db': SimpleNamespace(cleanup_model_templates=lambda: cleaned.append(True))}
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Sample)
        with self.assertRaises(KeyboardInterrupt):
            run_suite(suite, stream=io.StringIO(), modules=modules)
        self.assertEqual(cleaned, [True])


if __name__ == '__main__':
    unittest.main()
