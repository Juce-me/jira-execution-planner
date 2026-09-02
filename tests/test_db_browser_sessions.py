import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from backend.db import engine as db_engine
from backend.db import models

from backend.auth.db_browser_sessions import (
    BrowserSessionHandle,
    create_browser_session,
    delete_browser_session,
    delete_browser_sessions_for_connection,
    resolve_browser_session,
)
from backend.auth.jira_auth import AuthError


class DbBrowserSessionTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'browser-sessions.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='test',
                name='Test workspace',
                jira_site_url='https://test.atlassian.net',
                jira_cloud_id='test-cloud',
                created_by='test',
            )
            other_workspace = models.Workspace(
                environment_key='test',
                name='Other workspace',
                jira_site_url='https://other.atlassian.net',
                jira_cloud_id='other-cloud',
                created_by='test',
            )
            user = models.User(
                external_provider='test',
                external_subject='user-1',
                email='user-1@example.invalid',
                display_name='Test User',
                account_type='user',
                status='active',
                created_by='test',
            )
            other_user = models.User(
                external_provider='test',
                external_subject='user-2',
                email='user-2@example.invalid',
                display_name='Other User',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, other_workspace, user, other_user])
            session.flush()
            connection = self._connection(user.id, workspace.id, 'cloud-1')
            other_connection = self._connection(other_user.id, workspace.id, 'cloud-2')
            other_workspace_connection = self._connection(user.id, other_workspace.id, 'cloud-3')
            non_oauth_connection = self._connection(user.id, workspace.id, 'cloud-4')
            non_oauth_connection.provider = 'jira_basic'
            session.add_all([
                connection,
                other_connection,
                other_workspace_connection,
                non_oauth_connection,
            ])
            session.commit()
            self.workspace_id = workspace.id
            self.user_id = user.id
            self.other_user_id = other_user.id
            self.connection_id = connection.id
            self.other_connection_id = other_connection.id
            self.other_workspace_connection_id = other_workspace_connection.id
            self.non_oauth_connection_id = non_oauth_connection.id

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    @staticmethod
    def _connection(user_id, workspace_id, cloud_id):
        return models.AuthConnection(
            user_id=user_id,
            workspace_id=workspace_id,
            provider='atlassian_oauth',
            site_url='https://test.atlassian.net',
            cloud_id=cloud_id,
            status='active',
            token_version=1,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )

    def test_create_and_resolve_browser_session(self):
        """A created browser session resolves to its expected ownership metadata."""
        with self.factory() as session:
            handle = create_browser_session(
                session,
                user_id=self.user_id,
                workspace_id=self.workspace_id,
                auth_connection_id=self.connection_id,
            )
            session.commit()
        with self.factory() as session:
            resolved = resolve_browser_session(session, handle.id)
        self.assertEqual(resolved, handle)
        self.assertEqual(set(handle.__dataclass_fields__), {
            'id', 'user_id', 'workspace_id', 'auth_connection_id',
        })

    def test_create_rejects_connection_from_different_user(self):
        """Creation rejects a connection owned by a different user."""
        with self.factory() as session:
            with self.assertRaises(AuthError) as error:
                create_browser_session(
                    session,
                    user_id=self.user_id,
                    workspace_id=self.workspace_id,
                    auth_connection_id=self.other_connection_id,
                )
        self.assertEqual(error.exception.code, 'auth_required')

    def test_create_rejects_connection_from_different_workspace_for_same_user(self):
        """Creation rejects a same-user connection from a different workspace."""
        with self.factory() as session:
            with self.assertRaises(AuthError) as error:
                create_browser_session(
                    session,
                    user_id=self.user_id,
                    workspace_id=self.workspace_id,
                    auth_connection_id=self.other_workspace_connection_id,
                )
        self.assertEqual(error.exception.code, 'auth_required')

    def test_create_rejects_non_oauth_connection_provider(self):
        """Refuse to create a browser session for a non-OAuth connection."""
        with self.factory() as session:
            with self.assertRaises(AuthError) as error:
                create_browser_session(
                    session,
                    user_id=self.user_id,
                    workspace_id=self.workspace_id,
                    auth_connection_id=self.non_oauth_connection_id,
                )

        self.assertEqual(error.exception.code, 'auth_required')

    def test_resolve_rejects_non_oauth_connection_provider(self):
        """Treat a persisted browser row for a non-OAuth connection as unresolved."""
        with self.factory() as session:
            row = models.BrowserSession(
                user_id=self.user_id,
                workspace_id=self.workspace_id,
                auth_connection_id=self.non_oauth_connection_id,
            )
            session.add(row)
            session.commit()
            browser_session_id = row.id

        with self.factory() as session:
            self.assertIsNone(resolve_browser_session(session, browser_session_id))

    def test_delete_browser_session_is_scoped_to_one_id(self):
        """Deleting one browser-session identifier preserves sibling sessions."""
        with self.factory() as session:
            first = create_browser_session(session, user_id=self.user_id, workspace_id=self.workspace_id, auth_connection_id=self.connection_id)
            second = create_browser_session(session, user_id=self.user_id, workspace_id=self.workspace_id, auth_connection_id=self.connection_id)
            self.assertEqual(delete_browser_session(session, f' {first.id} '), 1)
            session.commit()
        with self.factory() as session:
            self.assertIsNone(resolve_browser_session(session, first.id))
            self.assertEqual(resolve_browser_session(session, second.id).id, second.id)
            self.assertEqual(delete_browser_session(session, '  '), 0)

    def test_delete_all_for_connection_does_not_cross_connection(self):
        """Connection-wide deletion preserves sessions owned by other connections."""
        with self.factory() as session:
            first = create_browser_session(session, user_id=self.user_id, workspace_id=self.workspace_id, auth_connection_id=self.connection_id)
            second = create_browser_session(session, user_id=self.user_id, workspace_id=self.workspace_id, auth_connection_id=self.connection_id)
            other = create_browser_session(session, user_id=self.other_user_id, workspace_id=self.workspace_id, auth_connection_id=self.other_connection_id)
            self.assertEqual(delete_browser_sessions_for_connection(session, f' {self.connection_id} '), 2)
            session.commit()
        with self.factory() as session:
            self.assertIsNone(resolve_browser_session(session, first.id))
            self.assertIsNone(resolve_browser_session(session, second.id))
            self.assertEqual(resolve_browser_session(session, other.id).id, other.id)
            self.assertEqual(delete_browser_sessions_for_connection(session, ''), 0)

    def test_resolve_empty_or_unknown_id_returns_none(self):
        """Resolution returns no session for empty or unknown identifiers."""
        with self.factory() as session:
            self.assertIsNone(resolve_browser_session(session, '  '))
            self.assertIsNone(resolve_browser_session(session, 'missing-session'))

    def test_browser_session_boundary_exposes_no_sensitive_fields(self):
        """The lifecycle result exposes no token or other sensitive fields."""
        self.assertEqual(set(models.BrowserSession.__table__.columns.keys()), {
            'id', 'user_id', 'workspace_id', 'auth_connection_id', 'created_at',
        })
        forbidden = {'token', 'email', 'user_agent', 'ip', 'callback', 'credential', 'version'}
        self.assertFalse(forbidden & set(models.BrowserSession.__table__.columns.keys()))
        self.assertFalse(forbidden & set(BrowserSessionHandle.__dataclass_fields__))


if __name__ == '__main__':
    unittest.main()
