import os
import tempfile
import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from backend.db import engine as db_engine
from backend.db import models
from backend.services.workspace_dashboard_config import (
    WorkspaceConfigConflict,
    load_workspace_config,
    load_workspace_team_catalog,
    save_workspace_team_catalog,
    update_workspace_config_section,
)


class WorkspaceDashboardConfigServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'service.db')}"
        engine = create_engine(self.database_url, future=True)
        models.Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)
        with factory() as session:
            users = [
                models.User(id=f'user-{i}', external_provider='atlassian', external_subject=f'subject-{i}', account_type='admin', status='active', created_by='test')
                for i in range(1, 4)
            ]
            workspaces = [
                models.Workspace(id=f'workspace-{i}', environment_key='test', name=f'Workspace {i}', jira_site_url=f'https://site-{i}.atlassian.net', created_by='test')
                for i in range(1, 3)
            ]
            session.add_all(users + workspaces)
            session.commit()
        engine.dispose()
        self.admin_a = self._context('workspace-1', 'user-1', 'https://site-1.atlassian.net')
        self.admin_b = self._context('workspace-1', 'user-2', 'https://site-1.atlassian.net')
        self.other = self._context('workspace-2', 'user-3', 'https://site-2.atlassian.net')

    def tearDown(self):
        self.tmpdir.cleanup()

    def _context(self, workspace_id, user_id, site_url):
        return SimpleNamespace(workspace_id=workspace_id, user_id=user_id, site_url=site_url)

    def test_cross_user_read_workspace_isolation_and_conflict(self):
        first = update_workspace_config_section(
            self.admin_a, 'board', {'boardId': '7'}, 0,
            database_url=self.database_url,
        )
        self.assertEqual(first.config_revision, 1)
        same = load_workspace_config(self.admin_b, database_url=self.database_url)
        self.assertEqual(same.payload['board']['boardId'], '7')
        self.assertEqual(load_workspace_config(self.other, database_url=self.database_url).config_revision, 0)
        second = update_workspace_config_section(
            self.admin_a, 'board', {'boardId': '8'}, 1,
            database_url=self.database_url,
        )
        with self.assertRaises(WorkspaceConfigConflict) as raised:
            update_workspace_config_section(
                self.admin_b, 'capacity', {'project': 'X'}, 1,
                database_url=self.database_url,
            )
        self.assertEqual(raised.exception.current.config_revision, 2)
        self.assertEqual(raised.exception.current.payload['board']['boardId'], '8')
        self.assertEqual(second.config_revision, 2)

    def test_conflict_after_overlapping_commit_returns_fresh_server_snapshot(self):
        update_workspace_config_section(
            self.admin_a, 'board', {'boardId': '7'}, 0,
            database_url=self.database_url,
        )
        engine = db_engine.get_engine(self.database_url)
        winner = db_engine.session_factory(self.database_url)()
        winner.begin()
        committed = False

        def commit_winner_before_losing_update(conn, cursor, statement, parameters, context, executemany):
            nonlocal committed
            if committed or not statement.startswith('UPDATE workspace_dashboard_configs'):
                return
            committed = True
            row = winner.execute(
                select(models.WorkspaceDashboardConfig).where(
                    models.WorkspaceDashboardConfig.workspace_id == self.admin_a.workspace_id,
                )
            ).scalars().one()
            row.payload = {'board': {'boardId': '8'}}
            row.config_revision = 2
            winner.commit()

        event.listen(engine, 'before_cursor_execute', commit_winner_before_losing_update)
        try:
            with self.assertRaises(WorkspaceConfigConflict) as raised:
                update_workspace_config_section(
                    self.admin_b, 'capacity', {'project': 'LOSING'}, 1,
                    database_url=self.database_url,
                )
        finally:
            event.remove(engine, 'before_cursor_execute', commit_winner_before_losing_update)
            winner.close()

        self.assertTrue(committed)
        self.assertEqual(raised.exception.current.config_revision, 2)
        self.assertEqual(raised.exception.current.payload, {'board': {'boardId': '8'}})

    def test_exact_site_fallback_is_copied_only_on_first_write(self):
        fallback = lambda: {'version': 1, 'board': {'boardId': '7'}, 'capacity': {'project': 'OLD'}}
        snapshot = load_workspace_config(
            self.admin_a, fallback_loader=fallback,
            legacy_site_url='https://site-1.atlassian.net/', database_url=self.database_url,
        )
        self.assertEqual(snapshot.source, 'legacy_json')
        saved = update_workspace_config_section(
            self.admin_a, 'board', {'boardId': '9'}, 0,
            fallback_loader=fallback, legacy_site_url='https://site-1.atlassian.net', database_url=self.database_url,
        )
        self.assertEqual(saved.payload['capacity']['project'], 'OLD')
        other = load_workspace_config(
            self.other, fallback_loader=fallback,
            legacy_site_url='https://site-1.atlassian.net', database_url=self.database_url,
        )
        self.assertEqual(other.source, 'empty')
        self.assertNotIn('board', other.payload)

    def test_audit_metadata_is_redacted_to_section_and_revision(self):
        update_workspace_config_section(self.admin_a, 'board', {'boardId': '7'}, 0, database_url=self.database_url)
        engine = create_engine(self.database_url, future=True)
        with engine.connect() as connection:
            event = connection.exec_driver_sql("SELECT event_type, metadata FROM audit_events").first()
        engine.dispose()
        self.assertEqual(event[0], 'workspace_dashboard_config_updated')
        self.assertIn('board', event[1])
        self.assertNotIn('7', event[1])

    def test_team_catalog_is_separate_from_admin_revision(self):
        update_workspace_config_section(self.admin_a, 'board', {'boardId': '7'}, 0, database_url=self.database_url)
        save_workspace_team_catalog(self.admin_a, {'catalog': {'a': {'id': 'a'}}, 'meta': {}}, database_url=self.database_url)
        save_workspace_team_catalog(self.admin_b, {'catalog': {'b': {'id': 'b'}}, 'meta': {}}, merge=True, database_url=self.database_url)
        catalog = load_workspace_team_catalog(self.admin_a, database_url=self.database_url)
        self.assertEqual(set(catalog['catalog']), {'a', 'b'})
        self.assertEqual(load_workspace_config(self.admin_a, database_url=self.database_url).config_revision, 1)


if __name__ == '__main__':
    unittest.main()
