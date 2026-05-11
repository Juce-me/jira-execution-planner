import os
import tempfile
import unittest
from unittest.mock import patch

from backend.auth.admin_bootstrap import bootstrap_first_tool_admin
from backend.db import engine as db_engine
from backend.db import models


class DbAdminBootstrapTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'admin-bootstrap.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_user_connection(self, *, account_id, email='user@example.com', account_type='user'):
        with self.factory() as session:
            workspace = session.query(models.Workspace).first()
            if workspace is None:
                workspace = models.Workspace(
                    environment_key='local',
                    name='Example',
                    jira_site_url='https://example.atlassian.net',
                    jira_cloud_id='cloud-123',
                    created_by='test',
                )
                session.add(workspace)
                session.flush()
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                email=email,
                display_name='User Example',
                account_type=account_type,
                status='active',
                created_by='test',
            )
            session.add(user)
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url='https://example.atlassian.net',
                cloud_id='cloud-123',
                scopes=['read:me'],
                status='active',
                token_version=1,
            )
            session.add(connection)
            session.commit()
            return workspace.id, user.id

    def test_configured_account_bootstraps_first_workspace_admin(self):
        workspace_id, user_id = self._seed_user_connection(account_id='account-123')

        with self.factory() as session, patch.dict(os.environ, {
            'TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS': 'account-123',
        }, clear=False):
            bootstrapped = bootstrap_first_tool_admin(
                session,
                workspace_id=workspace_id,
                user_id=user_id,
                atlassian_account_id='account-123',
            )
            session.commit()

        self.assertTrue(bootstrapped)
        with self.factory() as session:
            user = session.get(models.User, user_id)
            audit = session.query(models.AuditEvent).filter_by(event_type='admin_bootstrap').one()

        self.assertEqual(user.account_type, 'admin')
        self.assertEqual(audit.actor_user_id, user_id)
        self.assertEqual(audit.event_metadata['source'], 'TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS')

    def test_same_email_different_account_id_cannot_bootstrap_admin(self):
        workspace_id, user_id = self._seed_user_connection(
            account_id='different-account',
            email='admin@example.com',
        )

        with self.factory() as session, patch.dict(os.environ, {
            'TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS': 'configured-account',
        }, clear=False):
            bootstrapped = bootstrap_first_tool_admin(
                session,
                workspace_id=workspace_id,
                user_id=user_id,
                atlassian_account_id='different-account',
            )
            session.commit()

        self.assertFalse(bootstrapped)
        with self.factory() as session:
            user = session.get(models.User, user_id)
            audit_count = session.query(models.AuditEvent).count()

        self.assertEqual(user.account_type, 'user')
        self.assertEqual(audit_count, 0)

    def test_configured_account_cannot_bootstrap_when_workspace_already_has_admin(self):
        workspace_id, _ = self._seed_user_connection(
            account_id='existing-admin',
            email='admin@example.com',
            account_type='admin',
        )
        _, user_id = self._seed_user_connection(account_id='account-456')

        with self.factory() as session, patch.dict(os.environ, {
            'TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS': 'account-456',
        }, clear=False):
            bootstrapped = bootstrap_first_tool_admin(
                session,
                workspace_id=workspace_id,
                user_id=user_id,
                atlassian_account_id='account-456',
            )
            session.commit()

        self.assertFalse(bootstrapped)
        with self.factory() as session:
            user = session.get(models.User, user_id)

        self.assertEqual(user.account_type, 'user')


if __name__ == '__main__':
    unittest.main()
