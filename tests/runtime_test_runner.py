"""Unittest child entry point, loaded only after isolated startup guards.

Module case totals include each test's setup/body/teardown/registered cleanups.
Discovery/imports and module/class fixtures remain in the enclosing child time;
case totals must not be described as complete module wall times.
"""

import argparse
from collections import defaultdict
import os
import re
import signal
import sys
import time
import unittest


TIMING_PREFIX = 'JEP_TEST_TIMING '


class TimingResult(unittest.TextTestResult):
    def __init__(self, *args, clock=time.perf_counter, progress=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.clock = clock
        self.progress = progress
        self.current_module = None
        self.module_cases = defaultdict(lambda: [0, 0.0])
        self.slow_cases = []

    def startTest(self, test):
        module = test.__class__.__module__
        if self.progress and self.current_module is not None and module != self.current_module:
            count, seconds = self.module_cases[self.current_module]
            self.stream.writeln(f'\nJEP_TEST_PROGRESS module={self.current_module} tests={count} seconds={seconds:.3f}')
        self.current_module = module if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]*', module) else None
        self.case_started = self.clock()
        super().startTest(test)

    def stopTest(self, test):
        seconds = self.clock() - self.case_started
        module = test.__class__.__module__
        if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]*', module):
            self.module_cases[module][0] += 1
            self.module_cases[module][1] += seconds
        identifier = test.id()
        if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]*', identifier):
            self.slow_cases.append((seconds, identifier))
        super().stopTest(test)

    def report_timings(self):
        for module, (count, seconds) in sorted(self.module_cases.items(), key=lambda item: -item[1][1]):
            self.stream.writeln(f'{TIMING_PREFIX}module={module} tests={count} seconds={seconds:.3f}')
        for seconds, identifier in sorted(self.slow_cases, reverse=True)[:20]:
            self.stream.writeln(f'{TIMING_PREFIX}test={identifier} seconds={seconds:.3f}')


def run_suite(suite, *, stream=None, timings=False, clock=time.perf_counter, modules=None):
    stream = sys.stderr if stream is None else stream
    modules = sys.modules if modules is None else modules
    runner = unittest.TextTestRunner(
        stream=stream, resultclass=lambda *args, **kwargs: TimingResult(*args, clock=clock, progress=timings, **kwargs))
    cleanup_failed = False
    try:
        result = runner.run(suite)
    finally:
        helper = modules.get('tests.postgres_test_db')
        cleanup = getattr(helper, 'cleanup_model_fixtures', None)
        if cleanup is None:
            cleanup = getattr(helper, 'cleanup_model_templates', None)
        if cleanup is not None:
            try:
                cleanup()
            except Exception:
                # Do not leak driver connection diagnostics into the timing channel.
                stream.write('Model database fixture cleanup failed.\n')
                cleanup_failed = True
    if timings:
        result.report_timings()
    return 0 if result.wasSuccessful() and not cleanup_failed else 1


def main(argv=None):
    guards = sys.modules.get('sitecustomize')
    if os.environ.get('JEP_ISOLATED_RUNTIME') != '1' or not hasattr(guards, 'snapshot'):
        raise SystemExit('Runtime test child requires the isolated runner startup guards.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timings', action='store_true')
    parser.add_argument('modules', nargs='*')
    args = parser.parse_args(argv)
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    started = time.perf_counter()
    loader = unittest.defaultTestLoader
    suite = loader.loadTestsFromNames(args.modules) if args.modules else loader.discover('tests')
    inventory = suite.countTestCases()
    if args.timings:
        print(f'JEP_TEST_INVENTORY tests={inventory}', flush=True)
        print(f'{TIMING_PREFIX}phase=discovery seconds={time.perf_counter() - started:.3f}', flush=True)
    status = run_suite(suite, timings=args.timings)
    if args.timings:
        # Repeat the outer inventory after any nested captured test runners.
        print(f'JEP_TEST_INVENTORY tests={inventory}', flush=True)
    return status


if __name__ == '__main__':
    raise SystemExit(main())
