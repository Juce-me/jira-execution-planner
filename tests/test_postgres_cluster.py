"""Owned-cluster lifecycle checks without starting PostgreSQL."""

from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tests import postgres_cluster as cluster
from tests.run_isolated_runtime_tests import runtime_directory


class PostgresClusterLifecycleTests(unittest.TestCase):
    def test_interrupted_start_stops_a_postmaster_that_created_its_pid_file(self):
        root = Path(__file__).resolve().parents[1]
        (root / 'tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='cluster-check-', dir=root / 'tmp') as directory:
            base = Path(directory) / 'owned'
            calls = []

            def execute(_bin, args, **kwargs):
                calls.append(args)
                if args[0] == 'initdb':
                    (base / 'data').mkdir()
                elif args[-1] == 'start':
                    (base / 'data/postmaster.pid').write_text('synthetic pid')
                    raise KeyboardInterrupt
                return subprocess.CompletedProcess(args, 0)

            with patch.object(cluster, 'postgres_bin_dir', return_value=Path('/synthetic/bin')), \
                    patch.object(cluster, '_free_port', return_value=55499), \
                    patch.object(cluster, '_run', side_effect=execute):
                with self.assertRaises(KeyboardInterrupt):
                    with cluster.owned_cluster(base):
                        self.fail('interrupted cluster must not yield')
            self.assertTrue(any(args[-1] == 'stop' for args in calls))
            self.assertFalse(base.exists())

    def test_opt_in_reports_owned_pid_on_interrupted_start_before_cleanup(self):
        root = Path(__file__).resolve().parents[1]
        (root / 'tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='cluster-check-', dir=root / 'tmp') as directory:
            base = Path(directory) / 'owned'
            data = (base / 'data').resolve()
            ledger = Path(directory) / 'ownership.jsonl'
            ledger.touch()

            def execute(_bin, args, **kwargs):
                if args[0] == 'initdb':
                    data.mkdir()
                elif args[-1] == 'start':
                    (data / 'postmaster.pid').write_text(f'12345\n{data}\n0\n55499\n')
                    raise KeyboardInterrupt
                return subprocess.CompletedProcess(args, 0)

            environment = {'JEP_RUNTIME_OWNERSHIP_LOG': str(ledger.resolve()), 'JEP_RUNTIME_OWNERSHIP_STAGE': 'backend'}
            identity = cluster.RuntimeProcessIdentity(12345, 1, 12345, (887, 22), os.geteuid(), 'postgres')
            with patch.dict(os.environ, environment), \
                    patch.object(cluster, 'postgres_bin_dir', return_value=Path('/synthetic/bin')), \
                    patch.object(cluster, '_free_port', return_value=55499), \
                    patch.object(cluster, 'runtime_process_identity', return_value=identity), \
                    patch.object(cluster, '_run', side_effect=execute):
                with self.assertRaises(KeyboardInterrupt):
                    with cluster.owned_cluster(base):
                        self.fail('interrupted cluster must not yield')

            events = [json.loads(line) for line in ledger.read_text().splitlines()]
            self.assertEqual([event['state'] for event in events], ['allocated', 'started', 'stopped'])
            self.assertEqual([(event['pid'], event['port']) for event in events],
                             [(None, None), (12345, 55499), (12345, 55499)])
            self.assertEqual(events[1]['birth'], [887, 22])
            self.assertEqual(events[1]['parent'], 1)
            for event in events:
                self.assertEqual(event['reporter'], os.getpid())
                self.assertEqual(event['directory'], str(base.resolve()))
                self.assertEqual(event['stage'], 'backend')
                self.assertEqual(event['kind'], 'postgres')
                self.assertIsNone(event['group'])
            self.assertFalse(base.exists())

    def test_start_receipt_requires_a_live_owned_process(self):
        root = Path(__file__).resolve().parents[1]
        (root / 'tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='cluster-check-', dir=root / 'tmp') as directory:
            ledger = Path(directory) / 'ownership.jsonl'
            ledger.touch()
            environment = {'JEP_RUNTIME_OWNERSHIP_LOG': str(ledger.resolve()), 'JEP_RUNTIME_OWNERSHIP_STAGE': 'backend'}
            with patch.dict(os.environ, environment), \
                    patch.object(cluster, 'runtime_process_identity', return_value=None):
                with self.assertRaises(OSError):
                    cluster.report_runtime_ownership('backend-worker', 'started', pid=12345, group=12345)
            self.assertEqual(ledger.read_text(), '')

    def test_shutdown_failure_preserves_cluster_inside_the_enclosing_snapshot(self):
        self.assert_shutdown_preserves_snapshot(None)

    def test_exception_during_shutdown_preserves_the_enclosing_snapshot(self):
        for error in (KeyboardInterrupt(), OSError('synthetic shutdown exception')):
            with self.subTest(error=type(error).__name__):
                self.assert_shutdown_preserves_snapshot(error)

    def assert_shutdown_preserves_snapshot(self, shutdown_error):
        root = Path(__file__).resolve().parents[1]
        (root / 'tmp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='cluster-check-', dir=root / 'tmp') as directory:
            def execute(_bin, args, **kwargs):
                if args[0] == 'initdb':
                    (base / 'data').mkdir()
                elif args[-1] == 'start':
                    (base / 'data/postmaster.pid').write_text('synthetic pid')
                elif args[-1] == 'stop' and shutdown_error is not None:
                    raise shutdown_error
                return subprocess.CompletedProcess(args, 1 if args[-1] == 'stop' else 0)

            with patch.object(cluster, 'postgres_bin_dir', return_value=Path('/synthetic/bin')), \
                    patch.object(cluster, '_free_port', return_value=55499), \
                    patch.object(cluster, '_run', side_effect=execute):
                with self.assertRaises(cluster.ClusterError):
                    with runtime_directory(directory, prefix='snapshot-') as snapshot:
                        base = snapshot / 'postgres'
                        with cluster.owned_cluster(base):
                            pass
            self.assertTrue((base / 'data/postmaster.pid').exists())
            self.assertTrue(snapshot.exists())


if __name__ == '__main__':
    unittest.main()
