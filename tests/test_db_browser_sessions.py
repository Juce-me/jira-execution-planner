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
            session.add_all([workspace, user, other_user])
            session.flush()
            connection = self._connection(user.id, workspace.id, 'cloud-1')
            other_connection = self._connection(other_user.id, workspace.id, 'cloud-2')
            session.add_all([connection, other_connection])
            session.commit()
            self.workspace_id = workspace.id
            self.user_id = user.id
            self.other_user_id = other_user.id
            self.connection_id = connection.id
            self.other_connection_id = other_connection.id

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

    def test_create_rejects_connection_from_different_user_or_workspace(self):
        with self.factory() as session:
            with self.assertRaises(AuthError) as error:
                create_browser_session(
                    session,
                    user_id=self.user_id,
                    workspace_id=self.workspace_id,
                    auth_connection_id=self.other_connection_id,
                )
        self.assertEqual(error.exception.code, 'auth_required')

    def test_delete_browser_session_is_scoped_to_one_id(self):
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
        with self.factory() as session:
            self.assertIsNone(resolve_browser_session(session, '  '))
            self.assertIsNone(resolve_browser_session(session, 'missing-session'))

    def test_browser_session_boundary_exposes_no_sensitive_fields(self):
        self.assertEqual(set(models.BrowserSession.__table__.columns.keys()), {
            'id', 'user_id', 'workspace_id', 'auth_connection_id', 'created_at',
        })
        forbidden = {'token', 'email', 'user_agent', 'ip', 'callback', 'credential', 'version'}
        self.assertFalse(forbidden & set(models.BrowserSession.__table__.columns.keys()))
        self.assertFalse(forbidden & set(BrowserSessionHandle.__dataclass_fields__))


if __name__ == '__main__':
    unittest.main()
