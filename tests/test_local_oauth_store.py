import os
import stat
import tempfile
import threading
import unittest

from backend.auth.local_oauth_store import LocalOAuthStoreConfig, LocalOAuthTokenStore


class LocalOAuthTokenStoreTests(unittest.TestCase):
    def make_store(self, *, path='', auth_mode='atlassian_oauth', environment='local', allowed=True, now=None):
        token_store = {}
        refresh_locks = {}
        store_lock = threading.RLock()
        now_values = list(now or [1000, 1001, 1002])
        config = LocalOAuthStoreConfig(
            auth_mode=auth_mode,
            oauth_mode='atlassian_oauth',
            environment_key=environment,
            persistence_allowed=allowed,
            token_store_path=path,
            ttl_seconds=300,
        )
        store = LocalOAuthTokenStore(
            token_store=token_store,
            refresh_locks=refresh_locks,
            store_lock=store_lock,
            config=lambda: config,
            new_session_id=lambda: 'generated-session',
            now=lambda: now_values.pop(0) if now_values else 1002,
        )
        return store, token_store, refresh_locks

    def test_persistence_requires_oauth_local_or_dev_allow_flag_and_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, 'oauth-store.json')

            self.assertTrue(self.make_store(path=path)[0].persistence_enabled())
            self.assertTrue(self.make_store(path=path, environment='dev')[0].persistence_enabled())
            self.assertFalse(self.make_store(path=path, auth_mode='basic')[0].persistence_enabled())
            self.assertFalse(self.make_store(path=path, environment='production')[0].persistence_enabled())
            self.assertFalse(self.make_store(path=path, allowed=False)[0].persistence_enabled())
            self.assertFalse(self.make_store(path='')[0].persistence_enabled())

    def test_persistent_store_writes_private_file_and_round_trips(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, 'oauth-store.json')
            store, _, _ = self.make_store(path=path)

            store.save_session_for_id('session-1', {'access_token': 'access-1'})
            mode = stat.S_IMODE(os.stat(path).st_mode)

            self.assertEqual(mode, 0o600)
            self.assertEqual(
                store.read_persistent_token_store()['session-1']['access_token'],
                'access-1',
            )

    def test_drop_session_removes_memory_lock_and_persistent_entry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, 'oauth-store.json')
            store, token_store, refresh_locks = self.make_store(path=path)

            store.save_session_for_id('session-1', {'access_token': 'access-1'})
            store.drop_session('session-1')

            self.assertNotIn('session-1', token_store)
            self.assertNotIn('session-1', refresh_locks)
            self.assertEqual(store.read_persistent_token_store(), {})

    def test_session_data_sweeps_expired_store_entries(self):
        store, token_store, refresh_locks = self.make_store(now=[1000, 1000])
        session = {'atlassian_oauth_session_id': 'current-session'}
        token_store['expired-session'] = {'access_token': 'expired', 'stored_at': 600}
        refresh_locks['expired-session'] = object()
        token_store['current-session'] = {'access_token': 'current', 'stored_at': 1000}

        data = store.session_data(session)

        self.assertEqual(data['access_token'], 'current')
        self.assertNotIn('expired-session', token_store)
        self.assertNotIn('expired-session', refresh_locks)

    def test_refresh_lock_reuses_session_lock(self):
        store, _, _ = self.make_store()
        session = {'atlassian_oauth_session_id': 'session-1'}

        first = store.refresh_lock(session)
        second = store.refresh_lock(session)

        self.assertIs(first, second)


if __name__ == '__main__':
    unittest.main()
