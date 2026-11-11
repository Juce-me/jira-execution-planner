"""Coordinate module-only unittest shards through independent isolated runners.

The caller supplies the reviewed tracked/include module inventory. Each worker
owns its existing runner's snapshot and PostgreSQL cluster; no application is
imported here. Source size is a scheduling estimate, not a runtime prediction.
"""

import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time


CLEANUP_GRACE_SECONDS = 75
MODULE_NAME = re.compile(r'tests(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.test_[A-Za-z0-9_]+')
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')


def partition_modules(root, modules, workers, weights=None):
    """Return deterministic, nonempty, disjoint and exhaustive LPT partitions."""
    root = Path(root)
    modules = list(modules)
    if isinstance(workers, bool) or not isinstance(workers, int) or not 1 <= workers <= 8:
        raise ValueError('Runtime shard workers must be between 1 and 8.')
    if not modules or len(set(modules)) != len(modules):
        raise ValueError('Runtime shards require a nonempty, unique module inventory.')
    sizes = {}
    for module in modules:
        if not isinstance(module, str) or not MODULE_NAME.fullmatch(module):
            raise ValueError('Parallel selectors must be complete test module names; use one worker for classes or cases.')
        source = root.joinpath(*module.split('.')).with_suffix('.py')
        if not source.is_file():
            raise ValueError('A runtime shard module source is absent.')
        size = (weights or {}).get(module, source.stat().st_size)
        if isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size) or size < 0:
            raise ValueError('Runtime shard weights must be finite nonnegative numbers.')
        sizes[module] = size
    partitions = [[] for _ in range(min(workers, len(modules)))]
    totals = [0 for _ in partitions]
    for module in sorted(modules, key=lambda name: (-sizes[name], name)):
        index = min(range(len(partitions)), key=lambda value: (totals[value], len(partitions[value]), value))
        partitions[index].append(module)
        totals[index] += sizes[module]
    flattened = [module for partition in partitions for module in partition]
    if any(not partition for partition in partitions) or sorted(flattened) != sorted(modules):
        raise ValueError('Runtime shard assignment is not exhaustive and disjoint.')
    return partitions


def _signal_group(child, value):
    try:
        os.killpg(child.pid, value)
    except ProcessLookupError:
        pass


def _group_exists(child):
    try:
        os.killpg(child.pid, 0)
        return True
    except ProcessLookupError:
        return False


def _stop_workers(workers, *, grace=CLEANUP_GRACE_SECONDS, clock=time.monotonic, sleep=time.sleep):
    # Signal all owners first; the grace is shared, never multiplied by N.
    for worker in workers:
        _signal_group(worker['process'], signal.SIGTERM)
    deadline = clock() + grace
    try:
        while any(worker['process'].poll() is None for worker in workers):
            remaining = deadline - clock()
            if remaining <= 0:
                break
            sleep(min(0.05, remaining))
    finally:
        for worker in workers:
            _signal_group(worker['process'], signal.SIGKILL)
        for worker in workers:
            worker['exit_code'] = worker['process'].wait()


def _read_summary(log):
    count = None
    verdict = None
    expected = None
    with Path(log).open(encoding='utf-8', errors='replace') as stream:
        for raw in stream:
            line = ANSI.sub('', raw).strip()
            inventory = re.fullmatch(r'JEP_TEST_INVENTORY tests=(\d+)', line)
            if inventory:
                expected = int(inventory.group(1))
            match = re.fullmatch(r'Ran (\d+) tests? in [\d.]+s', line)
            if match:
                count, verdict = int(match.group(1)), None
            elif count is not None and re.fullmatch(r'OK(?: \(skipped=\d+\))?', line):
                verdict = 'OK'
            elif count is not None and re.fullmatch(r'FAILED \([a-z=, 0-9]+\)', line):
                verdict = 'FAILED'
    return count, verdict, expected


def run_shards(root, modules, workers=1, include_new=(), node=None, timings=False, weights=None):
    """Run isolated workers and return source-safe inventory/timing/result data.

    ``complete`` means every assigned command ended with a unittest summary;
    ``passed`` additionally requires zero exits and no abandoned process groups.
    The parent must allow more than 75 seconds for coordinator interruption.
    """
    started = time.monotonic()
    root = Path(root).resolve()
    assignments = partition_modules(root, modules, workers, weights)
    includes = tuple(include_new)
    scratch = root / 'tmp'
    scratch.mkdir(exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='runtime-shards-', dir=scratch))
    running = []
    interrupted, launch_failed, cleanup_failed, stopping = False, False, False, False
    previous = {}

    def interrupt(_number, _frame):
        if not stopping:
            raise KeyboardInterrupt

    for number in (signal.SIGTERM, signal.SIGINT):
        previous[number] = signal.signal(number, interrupt)
    try:
        for index, partition in enumerate(assignments):
            log = directory / f'worker-{index + 1}.log'
            stream = log.open('w', encoding='utf-8')
            command = [sys.executable, str(root / 'tests/run_isolated_runtime_tests.py'), '--workers', '1']
            if node is not None:
                command.extend(['--node', str(node)])
            if timings:
                command.append('--timings')
            for name in includes:
                command.extend(['--include', str(name)])
            command.extend(partition)
            try:
                child = subprocess.Popen(command, cwd=root, stdout=stream, stderr=subprocess.STDOUT,
                                         text=True, start_new_session=True)
            except BaseException:
                stream.close()
                raise
            running.append({'process': child, 'stream': stream, 'log': log, 'started': time.monotonic(),
                            'index': index + 1, 'modules': partition, 'exit_code': None,
                            'orphaned': False, 'seconds': None})
        while any(worker['seconds'] is None for worker in running):
            for worker in running:
                if worker['seconds'] is not None:
                    continue
                status = worker['process'].poll()
                if status is None:
                    continue
                worker['exit_code'] = status
                if _group_exists(worker['process']):
                    worker['orphaned'] = True
                    _signal_group(worker['process'], signal.SIGTERM)
                    _signal_group(worker['process'], signal.SIGKILL)
                    worker['process'].wait()
                worker['seconds'] = time.monotonic() - worker['started']
                print(f"Runtime shard {worker['index']}/{len(assignments)} finished; modules={len(worker['modules'])}", flush=True)
            if any(worker['seconds'] is None for worker in running):
                time.sleep(0.05)
    except KeyboardInterrupt:
        interrupted = True
    except OSError:
        launch_failed = True
    finally:
        stopping = True
        try:
            if interrupted or launch_failed:
                _stop_workers(running)
        except OSError:
            cleanup_failed = True
        finally:
            for worker in running:
                worker['stream'].close()
                if worker['seconds'] is None:
                    worker['seconds'] = time.monotonic() - worker['started']
            for number, handler in previous.items():
                signal.signal(number, handler)
    records = []
    for worker in running:
        count, verdict, expected = _read_summary(worker['log'])
        inventory_matched = (count is not None and count > 0
                             and (count == expected if expected is not None else not timings))
        passed = worker['exit_code'] == 0 and verdict == 'OK' and not worker['orphaned'] and inventory_matched
        records.append({'index': worker['index'], 'modules': worker['modules'],
                        'module_count': len(worker['modules']), 'test_count': count,
                        'exit_code': worker['exit_code'], 'summary': verdict,
                        'summary_complete': verdict is not None and inventory_matched, 'passed': passed,
                        'expected_test_count': expected, 'inventory_matched': inventory_matched,
                        'orphaned': worker['orphaned'], 'seconds': round(worker['seconds'], 3),
                        'log': str(worker['log'].relative_to(root))})
    complete = len(records) == len(assignments) and all(row['summary_complete'] for row in records) and not interrupted and not launch_failed
    passed = complete and not cleanup_failed and all(row['passed'] for row in records)
    report = {'status': 130 if interrupted else 0 if passed else 1, 'passed': passed,
              'complete': complete, 'interrupted': interrupted, 'launch_failed': launch_failed,
              'cleanup_failed': cleanup_failed, 'seconds': round(time.monotonic() - started, 3),
              'module_count': sum(map(len, assignments)), 'test_count': sum(row['test_count'] or 0 for row in records),
              'assignments': assignments, 'workers': records, 'directory': str(directory.relative_to(root)),
              'weight_basis': 'source-bytes' if weights is None else 'explicit-or-source-bytes'}
    (directory / 'result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f"Runtime shards: complete={str(complete).lower()} passed={str(passed).lower()} modules={report['module_count']} tests={report['test_count']} workers={len(assignments)} seconds={report['seconds']:.3f}", flush=True)
    return report
