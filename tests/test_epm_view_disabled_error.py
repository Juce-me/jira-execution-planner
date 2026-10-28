"""A DB OAuth actor without the private Enable EPM view preference never reaches a Home credential path.

Home is read only through the user's OAuth grant; the legacy (disabled) profile fails closed with a typed,
token-free `epm_view_disabled` 409. Real DB OAuth browser session on SQLite, synthetic data, no network.
"""
import unittest
from unittest.mock import patch

import jira_server
from backend.auth.jira_auth import AuthError
from backend.epm import access as epm_access
from backend.epm import home as epm_home
from tests.test_epm_home_access_and_errors import AccessCase


class ViewDisabledTests(AccessCase):
    def forbid_home(self):
        def forbidden(request, timeout=None):
            raise AssertionError('a disabled actor must not trigger Home I/O')
        patcher = patch.object(epm_home, 'urlopen', forbidden)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_read_metadata_credential_fails_closed_in_db_mode(self):
        with patch.object(epm_home, 'database_storage_enabled', return_value=True):
            with self.assertRaises(AuthError) as raised:
                epm_home._read_metadata_credential(self.context)
        self.assertEqual(raised.exception.code, 'epm_view_disabled')

    def test_read_metadata_credential_is_unchanged_without_db_storage_or_context(self):
        with patch.object(epm_home, 'database_storage_enabled', return_value=False):
            self.assertIsNone(epm_home._read_metadata_credential(self.context))
        with patch.object(epm_home, 'database_storage_enabled', return_value=True):
            self.assertIsNone(epm_home._read_metadata_credential(None))

    def test_disabled_actor_gets_a_typed_409_without_a_connect_url(self):
        self.forbid_home()
        self.grant_all()
        self.enable(False)
        epm_access.clear_access_cache()
        response = self.get('/api/epm/goals')
        self.assertEqual(response.status_code, 409)
        payload = response.get_json()
        self.assertEqual(payload['error'], 'epm_view_disabled')
        self.assertTrue(payload['message'])
        self.assertNotIn('connectUrl', payload)
        self.assertNotIn('token', payload['message'].lower())
        self.assertEqual(self.home.calls, [])


if __name__ == '__main__':
    unittest.main()
