import os
import tempfile
import unittest

from backend.auth.context import RequestAuthContext
from backend.config.db_repository import DbConfigRepository, ViewConfigNotFound
from backend.db import engine as db_engine
from backend.db import models


class ViewConfigResolutionTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'view-resolution.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.repo = DbConfigRepository(database_url=self.database_url)
        self.workspace_id, self.other_workspace_id, self.user_id, self.other_user_id = self._seed_subjects()
        self.context = self._context(self.workspace_id, self.user_id)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_subjects(self):
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            other_workspace = models.Workspace(
                environment_key='local',
                name='Other',
                jira_site_url='https://other.atlassian.net',
                jira_cloud_id='cloud-2',
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject='account-1',
                account_type='user',
                status='active',
                created_by='test',
            )
            other_user = models.User(
                external_provider='atlassian',
                external_subject='account-2',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, other_workspace, user, other_user])
            session.commit()
            return workspace.id, other_workspace.id, user.id, other_user.id

    def _context(self, workspace_id, user_id):
        return RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id=user_id,
            stable_subject=user_id,
            atlassian_account_id='account-1',
            workspace_id=workspace_id,
            auth_connection_id='connection-1',
            cloud_id='cloud-1',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )

    def _add_view(self, *, workspace_id=None, owner_user_id=None, name='View', view_type='eng',
                  payload=None, is_default=False, archived=False):
        with self.factory() as session:
            view = models.ViewConfig(
                workspace_id=workspace_id or self.workspace_id,
                owner_user_id=owner_user_id or self.user_id,
                name=name,
                view_type=view_type,
                payload=payload or {view_type: {'mode': view_type}},
                is_default=is_default,
            )
            if archived:
                from datetime import datetime, timezone
                view.archived_at = datetime.now(timezone.utc)
            session.add(view)
            session.commit()
            return view.id

    def test_resolves_default_private_view_for_current_user_workspace(self):
        view_id = self._add_view(view_type='epm', payload={'epm': {'tab': 'active'}}, is_default=True)

        resolved = self.repo.resolve_effective_view_config(self.context)

        self.assertEqual(resolved['source'], 'user_saved_view')
        self.assertEqual(resolved['workspaceId'], self.workspace_id)
        self.assertEqual(resolved['viewConfigId'], view_id)
        self.assertEqual(resolved['viewType'], 'epm')
        self.assertEqual(resolved['view'], {'epm': {'tab': 'active'}})

    def test_selected_view_takes_precedence_over_default(self):
        default_id = self._add_view(name='Default', view_type='eng', payload={'eng': {}}, is_default=True)
        selected_id = self._add_view(name='Selected', view_type='mixed', payload={'filters': {}, 'epm': {}}, is_default=False)

        resolved = self.repo.resolve_effective_view_config(self.context, view_config_id=selected_id)

        self.assertEqual(default_id != selected_id, True)
        self.assertEqual(resolved['viewConfigId'], selected_id)
        self.assertEqual(resolved['viewType'], 'mixed')

    def test_rejects_views_owned_by_another_user_or_workspace(self):
        other_user_view = self._add_view(owner_user_id=self.other_user_id, is_default=True)
        other_workspace_view = self._add_view(workspace_id=self.other_workspace_id, is_default=True)

        with self.assertRaises(ViewConfigNotFound):
            self.repo.resolve_effective_view_config(self.context, view_config_id=other_user_view)
        with self.assertRaises(ViewConfigNotFound):
            self.repo.resolve_effective_view_config(self.context, view_config_id=other_workspace_view)

    def test_excludes_archived_views(self):
        archived_id = self._add_view(is_default=True, archived=True)

        with self.assertRaises(ViewConfigNotFound):
            self.repo.resolve_effective_view_config(self.context)
        with self.assertRaises(ViewConfigNotFound):
            self.repo.resolve_effective_view_config(self.context, view_config_id=archived_id)

    def test_returns_view_type_for_eng_epm_and_mixed_views(self):
        for view_type in ('eng', 'epm', 'mixed'):
            with self.subTest(view_type=view_type):
                with self.factory() as session:
                    session.query(models.ViewConfig).delete()
                    session.commit()
                self._add_view(view_type=view_type, payload={view_type: {}}, is_default=True)
                self.assertEqual(self.repo.resolve_effective_view_config(self.context)['viewType'], view_type)


if __name__ == '__main__':
    unittest.main()
