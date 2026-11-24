#!/usr/bin/env python3
"""Run the complete local gate once, with a shared 600-second wall-time limit.

Dependencies must already be installed and Node 20 must be on PATH. Logs and
machine-readable results stay in gitignored tmp/verification/. A deadline is a
failed, incomplete gate, never evidence of meeting the performance target.
--no-deadline is the operator's full diagnostic: every stage runs to completion,
even after a failure, and the 600-second target is reported but not enforced.
"""

import argparse
from contextlib import contextmanager
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
CLEANUP_GRACE_SECONDS = 90


@contextmanager
def verification_slot(common_repository):
    """Serialize cooperating full gates across this repository's worktrees."""
    directory = common_repository / 'tmp/verification'
    directory.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(directory / 'gate.lock', os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def stop_process_group(child):
    """Allow fixture finally blocks to run, then remove any surviving children."""
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        # Nested shard owners share 75s to join children and stop clusters.
        # Leave the coordinator an additional margin to finish its report.
        child.wait(timeout=CLEANUP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()


def run_stage(command, *, root, environment, log, timeout):
    started = time.monotonic()
    with log.open('w', encoding='utf-8') as output:
        with subprocess.Popen(command, cwd=root, env=environment, stdout=output,
                              stderr=subprocess.STDOUT, start_new_session=True) as child:
            try:
                status = child.wait(timeout=None if timeout is None else max(0.001, timeout))
                verdict = 'passed' if status == 0 else 'failed'
                try:
                    os.killpg(child.pid, 0)
                except ProcessLookupError:
                    pass
                else:
                    stop_process_group(child)
                    status, verdict = 1, 'failed-background-processes'
            except subprocess.TimeoutExpired:
                stop_process_group(child)
                status, verdict = 124, 'deadline-exceeded'
            except BaseException:
                stop_process_group(child)
                raise
    return {'status': verdict, 'exitCode': status, 'seconds': round(time.monotonic() - started, 3)}


def run_gate(stages, *, root, environment, directory, budget=600, clock=time.monotonic, started=None, metadata=None,
             enforce_deadline=True):
    started = clock() if started is None else started
    records = []
    complete = False
    interrupted = False
    report = {}
    try:
        for name, command in stages:
            remaining = budget - (clock() - started)
            if enforce_deadline and remaining <= CLEANUP_GRACE_SECONDS:
                records.append({'name': name, 'status': 'not-run-deadline-exceeded'})
                break
            print(f'Verifying {name}; ' + (f'remaining budget {remaining:.1f}s' if enforce_deadline else 'deadline not enforced'), flush=True)
            record = run_stage(command, root=root, environment=environment, log=directory / (name + '.log'),
                               timeout=remaining - CLEANUP_GRACE_SECONDS if enforce_deadline else None)
            record['name'] = name
            records.append(record)
            print(f"{name}: {record['status']} ({record['seconds']:.3f}s)", flush=True)
            if record['exitCode'] and enforce_deadline:
                break
        complete = len(records) == len(stages) and all(row['status'] == 'passed' for row in records)
    except KeyboardInterrupt:
        interrupted = True
    finally:
        seconds = clock() - started
        report = {'complete': complete, 'withinBudget': seconds <= budget,
                  'passed': complete and (seconds <= budget or not enforce_deadline), 'interrupted': interrupted,
                  'deadlineEnforced': enforce_deadline,
                  'budgetSeconds': budget, 'seconds': round(seconds, 3), 'stages': records,
                  'environment': metadata or {},
                  'notRun': [name for name, _ in stages if name not in {
                      row['name'] for row in records if row['status'] != 'not-run-deadline-exceeded'}]}
        (directory / 'result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f"Complete verification: {'passed' if report['passed'] else 'failed'}; {report['seconds']:.3f}s/{budget}s", flush=True)
    if not enforce_deadline:
        failed = [row['name'] for row in records if row.get('status') != 'passed']
        overrun = report['seconds'] - budget
        print('Deadline not enforced; ' + (f'{budget}s target exceeded by {overrun:.3f}s' if overrun > 0 else f'{budget}s target met')
              + (f"; failed stages: {', '.join(failed)}" if failed else ''), flush=True)
    return report


def main(argv=None):
    started = time.monotonic()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include', action='append', default=[], help='Reviewed new source for the isolated backend snapshot')
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 9), metavar='1..8')
    parser.add_argument('--backend-workers', type=int, default=4, choices=range(1, 9), metavar='1..8')
    parser.add_argument('--headed', action='store_true', help='Use headed Chromium for glyph/geometry acceptance')
    parser.add_argument('--no-deadline', action='store_true',
                        help='Full diagnostic: run every stage to completion and report the 600-second overrun')
    args = parser.parse_args(argv)
    node = shutil.which('node')
    node_version = subprocess.check_output([node, '--version'], text=True).strip() if node else ''
    if not node_version.startswith('v20.'):
        parser.error('Put the pinned Node 20 toolchain on PATH before verification.')
    scratch = ROOT / 'tmp/verification'
    scratch.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='run-', dir=scratch))
    environment = dict(os.environ)
    # Mocked app journeys must not accidentally target the operator's app port.
    environment['JEP_TEST_BASE_URL'] = 'http://localhost:5088'
    cluster_spec = importlib.util.spec_from_file_location('verification_postgres_cluster', ROOT / 'tests/postgres_cluster.py')
    cluster_module = importlib.util.module_from_spec(cluster_spec)
    cluster_spec.loader.exec_module(cluster_module)
    pg_bin = cluster_module.postgres_bin_dir(environment)
    pg_version = subprocess.check_output([str(pg_bin / 'postgres'), '--version'], text=True).strip()
    metadata = {'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
                'python': sys.version.split()[0], 'node': node_version, 'postgres': pg_version,
                'browser': 'chromium', 'workers': args.workers, 'backendWorkers': args.backend_workers, 'headed': args.headed,
                'deadlineEnforced': not args.no_deadline, 'logicalCpus': os.cpu_count(),
                'databaseCache': 'fresh owned cluster; worker-local ordinary schemas; explicit model templates',
                'buildCache': 'build rerun; installed dependencies retained'}
    backend = [sys.executable, 'tests/run_isolated_runtime_tests.py', '--node', node, '--timings', '--workers', str(args.backend_workers)]
    for name in args.include:
        backend.extend(['--include', name])
    browser = ['npm', 'run', 'test:frontend:ui', '--', '--workers=' + str(args.workers)]
    if args.headed:
        browser.append('--headed')
    stages = [('build', ['npm', 'run', 'build']), ('backend', backend),
              ('frontend-unit', ['npm', 'run', 'test:frontend:unit']),
              ('chromium', browser)]
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    print('Verification logs: ' + str(directory.relative_to(ROOT)), flush=True)
    common = Path(subprocess.check_output(['git', 'rev-parse', '--git-common-dir'], cwd=ROOT, text=True).strip())
    common_repository = (common if common.is_absolute() else ROOT / common).resolve().parent
    try:
        with verification_slot(common_repository):
            report = run_gate(stages, root=ROOT, environment=environment, directory=directory, started=started,
                              metadata=metadata, enforce_deadline=not args.no_deadline)
    except BlockingIOError:
        print('Another full verification owns the shared repository slot; no tests launched.', file=sys.stderr)
        return 2
    return 0 if report['passed'] else (130 if report['interrupted'] else 1)


if __name__ == '__main__':
    raise SystemExit(main())
