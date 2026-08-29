import contextlib
import io
import os
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.db import models


class SharedAdminConfigRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'recovery.db')}"
        engine = create_engine(self.database_url, future=True)
        models.Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)
        with factory() as session:
            user = models.User(
                id='admin-1', external_provider='atlassian', external_subject='subject-1',
                account_type='admin', status='active', created_by='test',
            )
            workspace = models.Workspace(id='workspace-1', environment_key='test', name='Workspace', created_by='test')
            view = models.ViewConfig(
                id='view-1', workspace_id=workspace.id, owner_user_id=user.id,
                name='Default', view_type='mixed', payload={}, is_default=True,
            )
            session.add_all([user, workspace, view])
            session.flush()
            session.add(models.ViewConfigVersion(
                id='version-1', view_config_id=view.id, version_number=3,
                payload={'version': 1, 'board': {'boardId': '7'}, 'filters': {'private': True}},
                created_by=user.id, change_note='compatibility save',
            ))
            session.commit()
        engine.dispose()

    def tearDown(self):
        self.tmpdir.cleanup()

    def _run(self, *extra):
        from scripts.promote_legacy_shared_admin_config import main
        output = io.StringIO()
        args = ['--workspace-id', 'workspace-1', '--view-config-id', 'view-1', '--version-number', '3', *extra]
        with patch.dict(os.environ, {'DATABASE_URL': self.database_url, 'DATABASE_CONNECTION_MODE': 'url'}, clear=False), contextlib.redirect_stdout(output):
            result = main(args)
        return result, output.getvalue()

    def test_dry_run_prints_only_section_names_and_fingerprint(self):
        result, output = self._run()
        self.assertEqual(result, 0)
        self.assertIn('sections: board, version', output)
        self.assertIn('sha256:', output)
        self.assertNotIn('boardId', output)
        self.assertNotIn('"7"', output)

    def test_apply_requires_matching_fingerprint_and_refuses_overwrite(self):
        _, output = self._run()
        fingerprint = next(token for token in output.split() if token.startswith('sha256:'))
        with self.assertRaisesRegex(ValueError, 'fingerprint mismatch'):
            self._run('--apply', '--expected-sha256', 'sha256:wrong')
        result, applied = self._run('--apply', '--expected-sha256', fingerprint)
        self.assertEqual(result, 0)
        self.assertIn('applied revision 1', applied)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self._run('--apply', '--expected-sha256', fingerprint)

    def test_rejects_non_admin_and_wrong_workspace_without_payload_output(self):
        engine = create_engine(self.database_url, future=True)
        with engine.begin() as connection:
            connection.exec_driver_sql("UPDATE users SET account_type='user' WHERE id='admin-1'")
        engine.dispose()
        with self.assertRaisesRegex(ValueError, 'active administrator'):
            self._run()


if __name__ == '__main__':
    unittest.main()
