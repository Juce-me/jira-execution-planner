import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

from backend.auth.jira_auth import AuthError
from backend.auth.db_browser_sessions import create_browser_session
from backend.auth.db_context import (
    invalidate_auth_status_cache,
    resolve_db_request_auth_context,
)
from backend.db import engine as db_engine
from backend.db import models


FULL_SCOPE = (
    'read:me read:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


class DbAuthContextTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'auth-context.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        invalidate_auth_status_cache()

    def tearDown(self):
        invalidate_auth_status_cache()
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_connection(
        self,
        *,
        user_status='active',
        connection_status='active',
        token_version=3,
        scopes=None,
        provider='atlassian_oauth',
    ):
        with self.factory() as session:
            user = models.User(
                external_provider='atlassian',
                external_subject='account-123',
                email='user@example.com',
                display_name='User Example',
                account_type='admin',
                status=user_status,
                created_by='test',
            )
            workspace = models.Workspace(
                environment_key='local',
                name='Example',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-123',
                created_by='test',
            )
            session.add_all([user, workspace])
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider=provider,
                site_url='https://example.atlassian.net',
                cloud_id='cloud-123',
                scopes=(scopes or FULL_SCOPE).split(),
                status=connection_status,
                token_version=token_version,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.flush()
            session.add(models.JiraProjectAccess(
                connection_id=connection.id,
                workspace_id=workspace.id,
                project_key='ABC',
                project_type='product',
                status='accessible',
                checked_at=datetime.now(timezone.utc),
            ))
            session.commit()
            return user.id, workspace.id, connection.id

    def _seed_browser_sessions(self, *, token_version=3):
        user_id, workspace_id, connection_id = self._seed_connection(token_version=token_version)
        with self.factory() as session:
            first = create_browser_session(
                session,
                user_id=user_id,
                workspace_id=workspace_id,
                auth_connection_id=connection_id,
            )
            second = create_browser_session(
                session,
                user_id=user_id,
                workspace_id=workspace_id,
                auth_connection_id=connection_id,
            )
            session.commit()
        return first.id, second.id, connection_id

    def _set_connection_token_version(self, connection_id, token_version):
        with self.factory() as session:
            connection = session.get(models.AuthConnection, connection_id)
            connection.token_version = token_version
            session.commit()

    def _seed_browser_session_with_mismatched_user(self):
        first_id, _, connection_id = self._seed_browser_sessions()
        with self.factory() as session:
            other_user = models.User(
                external_provider='atlassian',
                external_subject='account-456',
                email='other@example.com',
                display_name='Other User',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add(other_user)
            session.flush()
            connection = session.get(models.AuthConnection, connection_id)
            connection.user_id = other_user.id
            session.commit()
        return first_id

    def _seed_browser_session_with_mismatched_workspace(self):
        first_id, _, connection_id = self._seed_browser_sessions()
        with self.factory() as session:
            other_workspace = models.Workspace(
                environment_key='other',
                name='Other Example',
                jira_site_url='https://other.atlassian.net',
                jira_cloud_id='cloud-456',
                created_by='test',
            )
            session.add(other_workspace)
            session.flush()
            connection = session.get(models.AuthConnection, connection_id)
            connection.workspace_id = other_workspace.id
            session.commit()
        return first_id

    def test_resolves_active_user_and_connection_from_database(self):
        user_id, workspace_id, connection_id = self._seed_connection()

        context = resolve_db_request_auth_context(
            {'db_auth_connection_id': connection_id, 'db_token_version': '3'},
            database_url=self.database_url,
            required_scopes=FULL_SCOPE,
        )

        self.assertEqual(context.user_id, user_id)
        self.assertEqual(context.workspace_id, workspace_id)
        self.assertEqual(context.auth_connection_id, connection_id)
        self.assertEqual(context.stable_subject, 'account-123')
        self.assertEqual(context.atlassian_account_id, 'account-123')
        self.assertEqual(context.cloud_id, 'cloud-123')
        self.assertEqual(context.token_version, '3')
        self.assertTrue(context.is_admin)
        self.assertEqual(context.project_access[0].project_key, 'ABC')

    def test_disabled_user_is_rejected_before_user_scoped_calls(self):
        _, _, connection_id = self._seed_connection(user_status='disabled')

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {'db_auth_connection_id': connection_id, 'db_token_version': '3'},
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'account_disabled')

    def test_revoked_connection_is_rejected_before_user_scoped_calls(self):
        _, _, connection_id = self._seed_connection(connection_status='revoked')

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {'db_auth_connection_id': connection_id, 'db_token_version': '3'},
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'auth_connection_revoked')

    def test_stale_token_version_is_rejected(self):
        _, _, connection_id = self._seed_connection(token_version=4)

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {'db_auth_connection_id': connection_id, 'db_token_version': '3'},
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'auth_connection_stale')

    def test_legacy_connection_requires_a_nonempty_exact_token_version(self):
        """Reject missing and empty legacy versions with the stale-connection contract."""
        _, _, connection_id = self._seed_connection(token_version=3)

        for name, session_data in (
            ('missing', {'db_auth_connection_id': connection_id}),
            ('empty', {'db_auth_connection_id': connection_id, 'db_token_version': ''}),
        ):
            with self.subTest(name=name):
                with self.assertRaises(AuthError) as raised:
                    resolve_db_request_auth_context(
                        session_data,
                        database_url=self.database_url,
                        required_scopes=FULL_SCOPE,
                    )

                self.assertEqual(raised.exception.code, 'auth_connection_stale')

    def test_browser_sessions_ignore_cookie_token_version_and_return_current_connection_version(self):
        """Opaque sessions ignore cookie versions and expose the current connection version."""
        first_id, second_id, connection_id = self._seed_browser_sessions(token_version=3)
        self._set_connection_token_version(connection_id, 4)

        first_context = resolve_db_request_auth_context(
            {'db_browser_session_id': first_id, 'db_token_version': '3'},
            database_url=self.database_url,
            required_scopes=FULL_SCOPE,
        )
        second_context = resolve_db_request_auth_context(
            {'db_browser_session_id': second_id, 'db_token_version': '3'},
            database_url=self.database_url,
            required_scopes=FULL_SCOPE,
        )

        self.assertEqual(first_context.browser_session_id, first_id)
        self.assertEqual(second_context.browser_session_id, second_id)
        self.assertEqual(first_context.token_version, '4')
        self.assertEqual(second_context.token_version, '4')

    def test_missing_browser_session_is_rejected_without_legacy_connection_fallback(self):
        """An unknown opaque session cannot fall back to legacy connection data."""
        _, _, connection_id = self._seed_connection()

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {
                    'db_browser_session_id': 'missing-browser-session',
                    'db_auth_connection_id': connection_id,
                    'db_token_version': '3',
                },
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'auth_required')

    def test_browser_session_rejects_user_owner_mismatch(self):
        """Context resolution rejects a browser session owned by another user."""
        browser_session_id = self._seed_browser_session_with_mismatched_user()

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {'db_browser_session_id': browser_session_id},
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'auth_required')

    def test_browser_session_rejects_workspace_owner_mismatch(self):
        """Context resolution rejects a browser session owned by another workspace."""
        browser_session_id = self._seed_browser_session_with_mismatched_workspace()

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {'db_browser_session_id': browser_session_id},
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'auth_required')

    def test_browser_session_rejects_non_oauth_connection_provider(self):
        """Reject a browser row whose referenced connection is not Atlassian OAuth."""
        user_id, workspace_id, connection_id = self._seed_connection(provider='jira_basic')
        with self.factory() as session:
            browser_session = models.BrowserSession(
                user_id=user_id,
                workspace_id=workspace_id,
                auth_connection_id=connection_id,
            )
            session.add(browser_session)
            session.commit()
            browser_session_id = browser_session.id

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {'db_browser_session_id': browser_session_id},
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'auth_required')

    def test_missing_required_scopes_are_rejected(self):
        _, _, connection_id = self._seed_connection(scopes='read:me offline_access')

        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                {'db_auth_connection_id': connection_id, 'db_token_version': '3'},
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
            )

        self.assertEqual(raised.exception.code, 'missing_oauth_scope')

    def test_status_cache_has_short_ttl_and_can_be_invalidated_immediately(self):
        user_id, _, connection_id = self._seed_connection()
        session_data = {'db_auth_connection_id': connection_id, 'db_token_version': '3'}

        context = resolve_db_request_auth_context(
            session_data,
            database_url=self.database_url,
            required_scopes=FULL_SCOPE,
            now=time.time(),
        )
        self.assertEqual(context.account_status, 'active')

        with self.factory() as session:
            user = session.get(models.User, user_id)
            user.status = 'disabled'
            session.commit()

        cached = resolve_db_request_auth_context(
            session_data,
            database_url=self.database_url,
            required_scopes=FULL_SCOPE,
            now=time.time() + 10,
        )
        self.assertEqual(cached.account_status, 'active')

        invalidate_auth_status_cache(user_id=user_id)
        with self.assertRaises(AuthError) as raised:
            resolve_db_request_auth_context(
                session_data,
                database_url=self.database_url,
                required_scopes=FULL_SCOPE,
                now=time.time() + 10,
            )

        self.assertEqual(raised.exception.code, 'account_disabled')


if __name__ == '__main__':
    unittest.main()
