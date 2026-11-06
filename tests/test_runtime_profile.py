import itertools
import unittest
from unittest.mock import patch

from backend.auth.runtime_profile import (
    RuntimeProfileError,
    normalize_runtime_profile,
    validate_supported_runtime_profile,
)


class RuntimeProfileTests(unittest.TestCase):
    def test_missing_and_blank_selectors_share_the_oauth_db_default(self):
        for auth, storage in itertools.product((None, '', ' ', '\t\n'), repeat=2):
            with self.subTest(auth=auth, storage=storage):
                self.assertEqual(normalize_runtime_profile(auth, storage), ('atlassian_oauth', 'db'))
                self.assertIsNone(validate_supported_runtime_profile(auth, storage))

    def test_existing_explicit_db_aliases_remain_supported(self):
        # These aliases are accepted by both pre-cutover storage selectors.
        for storage in ('db', 'database', 'postgres', 'postgresql'):
            for spelling in (storage, storage.upper(), f'  {storage}\t'):
                with self.subTest(storage=spelling):
                    self.assertEqual(normalize_runtime_profile('atlassian_oauth', spelling), ('atlassian_oauth', 'db'))
                    self.assertIsNone(validate_supported_runtime_profile('atlassian_oauth', spelling))

    def test_auth_selector_case_and_whitespace_are_normalized(self):
        self.assertEqual(normalize_runtime_profile(' ATLASSIAN_OAUTH\t', 'DB'), ('atlassian_oauth', 'db'))
        self.assertIsNone(validate_supported_runtime_profile(' ATLASSIAN_OAUTH\t', 'DB'))

    def test_normalization_does_not_promote_a_selected_legacy_profile(self):
        self.assertEqual(normalize_runtime_profile(' BASIC ', ' JSONFILE '), ('basic', 'jsonfile'))

    def test_basic_auth_is_rejected_with_db_and_legacy_storage(self):
        for storage in ('db', 'jsonfile', None):
            with self.subTest(storage=storage), self.assertRaises(RuntimeProfileError) as raised:
                validate_supported_runtime_profile('basic', storage)
            self.assertEqual(raised.exception.code, 'runtime_auth_unsupported')

    def test_live_json_storage_is_rejected_even_with_oauth(self):
        with self.assertRaises(RuntimeProfileError) as raised:
            validate_supported_runtime_profile('atlassian_oauth', 'jsonfile')
        self.assertEqual(raised.exception.code, 'runtime_storage_unsupported')

    def test_unknown_modes_never_fall_back_or_echo_the_input(self):
        marker = 'synthetic-private-selector'
        for auth, storage, code in (
            (marker, 'db', 'runtime_auth_unsupported'),
            ('atlassian_oauth', marker, 'runtime_storage_unsupported'),
            ('local_oauth', 'db', 'runtime_auth_unsupported'),
            ('atlassian_oauth', 'auto', 'runtime_storage_unsupported'),
        ):
            with self.subTest(code=code), self.assertRaises(RuntimeProfileError) as raised:
                validate_supported_runtime_profile(auth, storage)
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn(marker, str(raised.exception))
            self.assertNotIn(marker, repr(raised.exception))
            self.assertEqual(str(raised.exception), raised.exception.message)

    def test_explicit_retired_cli_requests_are_rejected_without_echoing_values(self):
        for option in ('--jira_email', '--jira_token', '--jira_email=', '--jira_token=synthetic-private-value'):
            with self.subTest(option=option), self.assertRaises(RuntimeProfileError) as raised:
                validate_supported_runtime_profile('atlassian_oauth', 'db', explicit_legacy_cli_options=(option,))
            self.assertEqual(raised.exception.code, 'runtime_legacy_cli_unsupported')
            self.assertNotIn(option, raised.exception.message)
            self.assertNotIn('synthetic-private-value', repr(raised.exception))

    def test_empty_cli_sequence_does_not_change_a_supported_profile(self):
        for options in ((), [], iter(())):
            self.assertIsNone(validate_supported_runtime_profile('atlassian_oauth', 'db', explicit_legacy_cli_options=options))

    def test_non_string_selectors_fail_with_static_errors(self):
        for value in (True, False, 1, [], {}):
            for auth, storage in ((value, 'db'), ('atlassian_oauth', value)):
                with self.subTest(value=value, auth=auth), self.assertRaises(RuntimeProfileError) as raised:
                    normalize_runtime_profile(auth, storage)
                self.assertEqual(raised.exception.code, 'runtime_profile_invalid')

    def test_profile_checks_never_consult_environment_files_or_network(self):
        class ForbiddenEnvironment:
            def __getitem__(self, key):
                raise AssertionError('profile normalization read environment')

            def get(self, *args):
                raise AssertionError('profile normalization read environment')

        with patch('os.environ', ForbiddenEnvironment()), \
             patch('os.getenv', side_effect=AssertionError('environment read')), \
             patch('builtins.open', side_effect=AssertionError('file read')), \
             patch('socket.create_connection', side_effect=AssertionError('network call')):
            self.assertEqual(normalize_runtime_profile(None, None), ('atlassian_oauth', 'db'))
            self.assertIsNone(validate_supported_runtime_profile('atlassian_oauth', 'postgresql'))
            with self.assertRaises(RuntimeProfileError):
                validate_supported_runtime_profile('basic', 'jsonfile')


if __name__ == '__main__':
    unittest.main()
