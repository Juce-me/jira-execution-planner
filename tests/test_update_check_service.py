import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.services import update_check


class TestUpdateCheckService(unittest.TestCase):
    def test_run_git_command_returns_stdout(self):
        completed = SimpleNamespace(returncode=0, stdout='abc123\n', stderr='')
        with patch.object(update_check.subprocess, 'run', return_value=completed) as mock_run:
            output, error = update_check.run_git_command(['rev-parse', 'HEAD'], repo_dir='/repo')

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
        with patch.object(update_check.subprocess, 'run', return_value=completed):
            output, error = update_check.run_git_command(['rev-parse', 'HEAD'], repo_dir='/repo')

        self.assertIsNone(output)
        self.assertEqual(error, 'fatal')

    def test_load_release_info_reads_dict_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            release_path = os.path.join(tmp, 'release-info.json')
            with open(release_path, 'w', encoding='utf-8') as handle:
                json.dump({'hash': 'releasehash', 'tag': 'v1'}, handle)

            self.assertEqual(
                update_check.load_release_info('release-info.json', base_dir=tmp),
                {'hash': 'releasehash', 'tag': 'v1'},
            )

    def test_load_release_info_rejects_invalid_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            release_path = os.path.join(tmp, 'release-info.json')
            with open(release_path, 'w', encoding='utf-8') as handle:
                handle.write('[]')

            self.assertIsNone(update_check.load_release_info('release-info.json', base_dir=tmp))

    def test_load_release_info_warns_on_read_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            release_path = os.path.join(tmp, 'release-info.json')
            with open(release_path, 'w', encoding='utf-8') as handle:
                handle.write('{not-json')
            warnings = []

            self.assertIsNone(
                update_check.load_release_info(
                    'release-info.json',
                    base_dir=tmp,
                    log_warning_fn=warnings.append,
                )
            )
            self.assertEqual(len(warnings), 1)

    def test_build_update_check_payload_reports_update_available(self):
        def run_git(args):
            if args == ['rev-parse', 'HEAD']:
                return 'localhash', None
            if args == ['rev-parse', '--abbrev-ref', 'HEAD']:
                return 'feature', None
            if args == ['ls-remote', 'origin', 'refs/heads/main']:
                return 'remotehash\trefs/heads/main', None
            raise AssertionError(args)

        payload = update_check.build_update_check_payload(
            remote='origin',
            branch='main',
            run_git_command_fn=run_git,
            load_release_info_fn=lambda: None,
            now_iso_fn=lambda: '2026-05-28T12:00:00+00:00',
        )

        self.assertTrue(payload['enabled'])
        self.assertTrue(payload['updateAvailable'])
        self.assertEqual(payload['local'], {
            'hash': 'localhash',
            'short': 'localha',
            'branch': 'feature',
            'source': 'git',
        })
        self.assertEqual(payload['remote']['hash'], 'remotehash')
        self.assertEqual(payload['checkedAt'], '2026-05-28T12:00:00+00:00')

    def test_build_update_check_payload_uses_release_info_when_git_state_fails(self):
        def run_git(args):
            if args == ['rev-parse', 'HEAD']:
                return None, 'not a git checkout'
            if args == ['rev-parse', '--abbrev-ref', 'HEAD']:
                return '', None
            if args == ['ls-remote', 'origin', 'refs/heads/main']:
                return 'releasehash\trefs/heads/main', None
            raise AssertionError(args)

        payload = update_check.build_update_check_payload(
            remote='origin',
            branch='main',
            run_git_command_fn=run_git,
            load_release_info_fn=lambda: {'hash': 'releasehash', 'tag': 'v1.2.3'},
            now_iso_fn=lambda: 'now',
        )

        self.assertFalse(payload['updateAvailable'])
        self.assertEqual(payload['local'], {
            'hash': 'releasehash',
            'short': 'release',
            'branch': 'v1.2.3',
            'source': 'release',
        })

    def test_build_update_check_payload_returns_local_error_without_release_hash(self):
        payload = update_check.build_update_check_payload(
            remote='origin',
            branch='main',
            run_git_command_fn=lambda _args: (None, 'not a git checkout'),
            load_release_info_fn=lambda: {},
            now_iso_fn=lambda: 'now',
        )

        self.assertEqual(payload, {
            'enabled': True,
            'error': 'Failed to read local git state: not a git checkout',
        })

    def test_build_update_check_payload_returns_remote_error_with_local_details(self):
        def run_git(args):
            if args == ['rev-parse', 'HEAD']:
                return 'localhash', None
            if args == ['rev-parse', '--abbrev-ref', 'HEAD']:
                return 'feature', None
            if args == ['ls-remote', 'origin', 'refs/heads/main']:
                return None, 'network unavailable'
            raise AssertionError(args)

        payload = update_check.build_update_check_payload(
            remote='origin',
            branch='main',
            run_git_command_fn=run_git,
            load_release_info_fn=lambda: None,
            now_iso_fn=lambda: 'now',
        )

        self.assertEqual(payload, {
            'enabled': True,
            'local': {
                'hash': 'localhash',
                'short': 'localha',
                'branch': 'feature',
            },
            'error': 'Failed to check remote: network unavailable',
        })


if __name__ == '__main__':
    unittest.main()
