import contextlib
import io
import json
import os
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.auth.context import RequestAuthContext
from backend.db import models
from backend.services.workspace_dashboard_config import (
    WorkspaceConfigConflict,
    load_workspace_config,
    update_workspace_config_section,
)


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

    def test_workspace_runtime_filters_dormant_epm_from_database_and_fallback(self):
        context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='admin-1', stable_subject='subject-1',
            atlassian_account_id='subject-1', workspace_id='workspace-1',
            auth_connection_id='connection-1', cloud_id='cloud-1',
            site_url='https://example.atlassian.net', token_version='1',
            account_status='active', is_admin=True,
        )
        engine = create_engine(self.database_url, future=True)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO workspace_dashboard_configs "
                "(id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                "VALUES ('dashboard-1', 'workspace-1', 1, '{\"board\":{\"boardId\":\"7\"},\"epm\":{\"version\":2}}', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        engine.dispose()

        loaded = load_workspace_config(context, database_url=self.database_url)
        self.assertEqual(loaded.payload, {'board': {'boardId': '7'}})
        self.assertEqual(loaded.config_revision, 4)

        for raw in ('"scalar"', '{broken'):
            engine = create_engine(self.database_url, future=True)
            with engine.begin() as connection:
                connection.exec_driver_sql(
                    "UPDATE workspace_dashboard_configs SET payload=? WHERE workspace_id='workspace-1'",
                    (raw,),
                )
            engine.dispose()
            recovered = load_workspace_config(context, database_url=self.database_url)
            self.assertEqual(recovered.payload, {})
            self.assertEqual(recovered.config_revision, 4)

        other_context = replace(context, workspace_id='missing-workspace')
        fallback = load_workspace_config(
            other_context,
            database_url=self.database_url,
            legacy_site_url='https://example.atlassian.net',
            fallback_loader=lambda: {'board': {'boardId': '8'}, 'epm': {'version': 2}},
        )
        self.assertEqual(fallback.payload, {'board': {'boardId': '8', 'boardName': ''}})

    def test_admin_section_save_removes_dormant_epm_and_preserves_other_admin_fields(self):
        context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='admin-1', stable_subject='subject-1',
            atlassian_account_id='subject-1', workspace_id='workspace-1',
            auth_connection_id='connection-1', cloud_id='cloud-1',
            site_url='https://example.atlassian.net', token_version='1',
            account_status='active', is_admin=True,
        )
        engine = create_engine(self.database_url, future=True)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO workspace_dashboard_configs "
                "(id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                "VALUES ('dashboard-save', 'workspace-1', 1, "
                "'{\"board\":{\"boardId\":\"7\"},\"capacity\":{\"project\":\"CAP\"},\"epm\":{\"version\":2}}', "
                "4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        engine.dispose()

        result = update_workspace_config_section(
            context, 'board', {'boardId': '8', 'boardName': 'Updated'}, 4,
            database_url=self.database_url,
        )

        self.assertEqual(result.config_revision, 5)
        self.assertNotIn('epm', result.payload)
        self.assertEqual(result.payload['capacity'], {'project': 'CAP'})
        engine = create_engine(self.database_url, future=True)
        with engine.connect() as connection:
            stored = json.loads(connection.exec_driver_sql(
                "SELECT payload FROM workspace_dashboard_configs WHERE workspace_id='workspace-1'"
            ).scalar_one())
        engine.dispose()
        self.assertNotIn('epm', stored)
        self.assertEqual(stored['capacity'], {'project': 'CAP'})
        self.assertEqual(stored['board'], {'boardId': '8', 'boardName': 'Updated'})

        engine = create_engine(self.database_url, future=True)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO workspaces (id, environment_key, name, created_by, created_at, updated_at) "
                "VALUES ('workspace-2', 'test-2', 'Workspace 2', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        engine.dispose()
        created = update_workspace_config_section(
            replace(context, workspace_id='workspace-2'),
            'capacity',
            {'project': 'NEW', 'fieldId': '', 'fieldName': ''},
            0,
            fallback_loader=lambda: {
                'board': {'boardId': '9'},
                'epm': {'version': 2},
            },
            legacy_site_url='https://example.atlassian.net',
            database_url=self.database_url,
        )
        self.assertNotIn('epm', created.payload)
        self.assertEqual(created.payload['board'], {'boardId': '9', 'boardName': ''})
        self.assertEqual(created.payload['capacity']['project'], 'NEW')

    def test_admin_save_repairs_malformed_and_scalar_workspace_payloads_at_current_revision(self):
        context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='admin-1', stable_subject='subject-1',
            atlassian_account_id='subject-1', workspace_id='workspace-1',
            auth_connection_id='connection-1', cloud_id='cloud-1',
            site_url='https://example.atlassian.net', token_version='1',
            account_status='active', is_admin=True,
        )
        engine = create_engine(self.database_url, future=True)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO workspace_dashboard_configs "
                "(id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                "VALUES ('dashboard-repair', 'workspace-1', 1, '{broken', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        engine.dispose()

        repaired = update_workspace_config_section(
            context, 'board', {'boardId': '8', 'boardName': 'Repaired'}, 4,
            database_url=self.database_url,
        )
        self.assertEqual(repaired.config_revision, 5)
        self.assertEqual(repaired.payload, {'board': {'boardId': '8', 'boardName': 'Repaired'}})

        engine = create_engine(self.database_url, future=True)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "UPDATE workspace_dashboard_configs SET payload='\"scalar\"' "
                "WHERE workspace_id='workspace-1'"
            )
        engine.dispose()
        repaired_again = update_workspace_config_section(
            context, 'capacity', {'project': 'CAP', 'fieldId': '', 'fieldName': ''}, 5,
            database_url=self.database_url,
        )
        self.assertEqual(repaired_again.config_revision, 6)
        self.assertNotIn('epm', repaired_again.payload)
        self.assertEqual(repaired_again.payload, {
            'capacity': {'project': 'CAP', 'fieldId': '', 'fieldName': ''},
        })

        with self.assertRaises(WorkspaceConfigConflict) as raised:
            update_workspace_config_section(
                context, 'board', {'boardId': '9', 'boardName': 'Stale'}, 5,
                database_url=self.database_url,
            )
        self.assertEqual(raised.exception.current.config_revision, 6)
        self.assertEqual(raised.exception.current.payload, repaired_again.payload)


if __name__ == '__main__':
    unittest.main()
