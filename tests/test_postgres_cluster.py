"""Owned-cluster lifecycle checks without starting PostgreSQL."""

from pathlib import Path
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
