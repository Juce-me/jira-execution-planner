import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.services import git_revision


class TestGitRevisionService(unittest.TestCase):
    def test_run_git_command_returns_stdout(self):
        completed = SimpleNamespace(returncode=0, stdout='abc123\n', stderr='')
        with patch.object(git_revision.subprocess, 'run', return_value=completed) as mock_run:
            output, error = git_revision.run_git_command(['rev-parse', 'HEAD'], repo_dir='/repo')

        self.assertEqual(output, 'abc123')
        self.assertIsNone(error)
        mock_run.assert_called_once_with(
            ['git', 'rev-parse', 'HEAD'],
            cwd='/repo',
            capture_output=True,
            text=True,
            timeout=5,
        )

    def test_run_git_command_returns_error_text(self):
        completed = SimpleNamespace(returncode=1, stdout='fallback', stderr='fatal')
        with patch.object(git_revision.subprocess, 'run', return_value=completed):
            output, error = git_revision.run_git_command(['rev-parse', 'HEAD'], repo_dir='/repo')

        self.assertIsNone(output)
        self.assertEqual(error, 'fatal')
