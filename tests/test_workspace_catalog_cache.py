import os
import tempfile
import unittest
import uuid
from dataclasses import replace
from datetime import timedelta, timezone
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine
from backend.db import models
from backend.services.workspace_catalog_cache import (
    claim_catalog_refresh,
    load_sprint_catalog,
    load_sprint_team_catalog,
    publish_catalog,
    release_catalog_refresh,
)
from backend.services.workspace_catalog_config import resolve_effective_catalog_config
from backend.services.sprint_teams import SprintTeamPayload
from backend.services.workspace_dashboard_config import save_workspace_team_catalog


class _Budget:
    def __init__(self):
        self.phases = []

    def remaining(self, phase):
        self.phases.append(phase)
        return 30


def _context(workspace_id, user_id, site='https://one.example.test'):
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id=user_id, stable_subject=user_id,
        atlassian_account_id=user_id, workspace_id=workspace_id,
        auth_connection_id=f'connection-{user_id}', cloud_id=f'cloud-{user_id[-1]}',
        site_url=site, token_version='1', account_status='active', is_admin=True,
        granted_scopes=('read:jira-work',), granted_scopes_verified=True,
    )


class WorkspaceCatalogCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'catalog.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            one = models.Workspace(environment_key='one', name='One')
            two = models.Workspace(environment_key='two', name='Two')
            session.add_all([one, two])
            session.flush()
            self.one_id, self.two_id = one.id, two.id
            for user in ('user-a', 'user-b', 'user-c'):
                session.add(models.User(id=user, external_provider='test', external_subject=user))
            session.flush()
            session.add_all([
                models.AuthConnection(id='connection-user-a', user_id='user-a', workspace_id=one.id, provider='atlassian_oauth', cloud_id='cloud-a', site_url='https://one.example.test', scopes=['read:jira-work'], scope_provenance='provider'),
                models.AuthConnection(id='connection-user-b', user_id='user-b', workspace_id=one.id, provider='atlassian_oauth', cloud_id='cloud-b', site_url='https://one.example.test', scopes=['read:jira-work'], scope_provenance='provider'),
                models.AuthConnection(id='connection-user-c', user_id='user-c', workspace_id=two.id, provider='atlassian_oauth', cloud_id='cloud-c', site_url='https://two.example.test', scopes=['read:jira-work'], scope_provenance='provider'),
            ])
            session.add_all([
                models.WorkspaceDashboardConfig(
                    workspace_id=one.id,
                    payload={'board': {'boardId': '17'}, 'projects': [{'key': 'DEMO'}]},
                    config_revision=1,
                ),
                models.WorkspaceDashboardConfig(
                    workspace_id=two.id,
                    payload={'board': {'boardId': '17'}, 'projects': [{'key': 'DEMO'}]},
                    config_revision=1,
                ),
            ])
            session.commit()
        self.a = _context(self.one_id, 'user-a')
        self.b = _context(self.one_id, 'user-b')
        self.c = _context(self.two_id, 'user-c', 'https://two.example.test')
        self.runtime = {
            'jql_query': '', 'jira_board_id': '',
            'team_field_default': 'customfield_10001', 'sprint_field_default': 'customfield_10002',
        }
        self.budget = _Budget()

    def owner(self, label):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, label))

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def resolve(self, session, context):
        return resolve_effective_catalog_config(
            session, context, runtime_inputs=self.runtime,
            fallback_loader=None, legacy_site_url='',
        )

    def config(self, context):
        with self.factory() as session:
            return self.resolve(session, context)

    def _publish_sprints(self, context, payload, owner=None):
        owner = owner or self.owner('owner-1')
        config = self.config(context)
        claim = claim_catalog_refresh(
            context, kind='sprints', expected_config=config, owner=owner,
            budget=self.budget, resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertIsNotNone(claim)
        self.assertTrue(publish_catalog(
            context, claim=claim, payload=payload, budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        return config

    def test_same_workspace_users_share_catalog_and_lease(self):
        config = self._publish_sprints(self.a, [{'id': '5', 'name': 'S'}])
        loaded = load_sprint_catalog(self.b, config=config, database_url=self.database_url)
        self.assertEqual(loaded.payload, [{'id': '5', 'name': 'S'}])
        first = claim_catalog_refresh(
            self.a, kind='sprints', expected_config=config, owner=self.owner('owner-a'), budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        second = claim_catalog_refresh(
            self.b, kind='sprints', expected_config=config, owner=self.owner('owner-b'), budget=self.budget,
            resolve_config=self.resolve, nonblocking=True, database_url=self.database_url,
        )
        self.assertIsNotNone(first)
        self.assertTrue(first.identity.startswith('sc1:'))
        self.assertEqual(first.owner, first.attempt_id)
        self.assertAlmostEqual(
            (first.lease_until - first.attempt_deadline_at).total_seconds(), 90, delta=1,
        )
        self.assertIsNone(second)
        self.assertIn('claim_deadline', self.budget.phases)

    def test_catalogs_isolate_site_and_environment(self):
        one = self._publish_sprints(self.a, [{'id': '5'}])
        two = self.config(self.c)
        self.assertIsNone(load_sprint_catalog(self.c, config=two, database_url=self.database_url).payload)
        self.assertEqual(load_sprint_catalog(self.a, config=one, database_url=self.database_url).payload, [{'id': '5'}])

    def test_validated_empty_is_not_a_miss(self):
        config = self._publish_sprints(self.a, [])
        snapshot = load_sprint_catalog(self.a, config=config, database_url=self.database_url)
        self.assertEqual(snapshot.payload, [])
        self.assertIsNotNone(snapshot.validated_at)
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).filter_by(
                workspace_id=self.one_id, board_id=config.board_id,
            ).one()
            validated = row.validated_at.replace(tzinfo=timezone.utc) if row.validated_at.tzinfo is None else row.validated_at
            refresh = row.next_refresh_at.replace(tzinfo=timezone.utc) if row.next_refresh_at.tzinfo is None else row.next_refresh_at
            self.assertEqual(refresh - validated, timedelta(hours=24))

    def test_failed_other_identity_never_serves_old_membership(self):
        old = self._publish_sprints(self.a, [{'id': '5'}])
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).filter_by(workspace_id=self.one_id).one()
            row.payload = {'board': {'boardId': '18'}, 'projects': [{'key': 'DEMO'}]}
            row.config_revision += 1
            session.commit()
        new = self.config(self.a)
        self.assertNotEqual(old.sprint_identity, new.sprint_identity)
        self.assertIsNone(load_sprint_catalog(self.a, config=new, database_url=self.database_url).payload)

    def test_directory_and_membership_rollback_together(self):
        config = self._publish_sprints(self.a, [{'id': '5', 'name': 'S'}])
        claim = claim_catalog_refresh(
            self.a, kind='teams', sprint_id='5', expected_config=config, owner=self.owner('owner-t'),
            budget=self.budget, resolve_config=self.resolve, database_url=self.database_url,
        )
        with patch(
            'backend.services.workspace_catalog_cache.merge_workspace_team_catalog_in_session',
            side_effect=RuntimeError('forced merge failure'),
        ):
            with self.assertRaisesRegex(RuntimeError, 'forced merge failure'):
                publish_catalog(
                    self.a, claim=claim, payload=[{'id': 't1', 'name': 'Team One'}],
                    budget=self.budget, resolve_config=self.resolve, database_url=self.database_url,
                )
        snapshot = load_sprint_team_catalog(
            self.a, sprint_id='5', config=config, database_url=self.database_url,
        )
        self.assertIsNone(snapshot.payload)

    def test_wrong_owner_cannot_release(self):
        config = self.config(self.a)
        claim = claim_catalog_refresh(
            self.a, kind='sprints', expected_config=config, owner=self.owner('owner-a'),
            budget=self.budget, resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertFalse(release_catalog_refresh(
            self.a, claim=replace(claim, owner=self.owner('wrong')), budget=self.budget,
            database_url=self.database_url,
        ))
        self.assertTrue(release_catalog_refresh(
            self.a, claim=claim, budget=self.budget, database_url=self.database_url,
        ))
        snapshot = load_sprint_catalog(self.a, config=config, database_url=self.database_url)
        self.assertEqual(snapshot.refresh_status, 'failed')
        self.assertEqual(snapshot.failure_code, 'catalog_runtime_unavailable')
        self.assertEqual(snapshot.refresh_attempt_id, claim.attempt_id)

    def test_reads_require_fresh_active_actor(self):
        config = self.config(self.a)
        with self.factory() as session:
            session.query(models.AuthConnection).filter_by(id=self.a.auth_connection_id).delete()
            session.commit()
        from backend.auth.jira_auth import AuthError
        with self.assertRaises(AuthError):
            load_sprint_catalog(self.a, config=config, database_url=self.database_url)

    def test_directory_merge_preserves_unrelated_names(self):
        config = self._publish_sprints(self.a, [
            {'id': '5', 'name': 'Sprint Five'},
            {'id': '6', 'name': 'Sprint Six'},
        ])
        for sprint, team in (('5', {'id': 'a', 'name': 'Alpha'}), ('6', {'id': 'b', 'name': 'Beta'})):
            claim = claim_catalog_refresh(
                self.a, kind='teams', sprint_id=sprint, expected_config=config,
                owner=self.owner(f'owner-{sprint}'), budget=self.budget, resolve_config=self.resolve,
                database_url=self.database_url,
            )
            self.assertTrue(claim.identity.startswith('tc1:'))
            self.assertTrue(publish_catalog(
                self.a, claim=claim, payload=[team], budget=self.budget,
                resolve_config=self.resolve, database_url=self.database_url,
            ))
        with self.factory() as session:
            directory = session.query(models.WorkspaceTeamCatalog).one().payload
        self.assertEqual(set(directory['catalog']), {'a', 'b'})

    def test_published_team_snapshot_loads_by_normalized_sprint_id(self):
        config = self._publish_sprints(self.a, [{'id': '5', 'name': 'Sprint Five'}])
        claim = claim_catalog_refresh(
            self.a,
            kind='teams',
            sprint_id='5',
            expected_config=config,
            owner=self.owner('load-team-snapshot'),
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.a,
            claim=claim,
            payload=[{'id': 'a', 'name': 'Alpha'}],
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        snapshot = load_sprint_team_catalog(
            self.a,
            sprint_id='5',
            config=config,
            database_url=self.database_url,
        )
        self.assertEqual(snapshot.identity, claim.identity)
        self.assertEqual(snapshot.payload, [{'id': 'a', 'name': 'Alpha'}])
        self.assertIsNotNone(snapshot.catalog_version)
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.one_id,
                sprint_id='5',
            ).one()
            self.assertEqual(row.sprint_name, 'Sprint Five')

        sprint_claim = claim_catalog_refresh(
            self.a,
            kind='sprints',
            expected_config=config,
            owner=self.owner('rename-sprint'),
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.a,
            claim=sprint_claim,
            payload=[{'id': '5', 'name': 'Renamed Sprint'}],
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        renamed_claim = claim_catalog_refresh(
            self.a,
            kind='teams',
            sprint_id='5',
            expected_config=config,
            owner=self.owner('repair-sprint-name'),
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.a,
            claim=renamed_claim,
            payload=[{'id': 'a', 'name': 'Alpha'}],
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.one_id,
                sprint_id='5',
            ).one()
            self.assertEqual(row.sprint_name, 'Renamed Sprint')

    def test_team_sprint_id_rejects_noncanonical_values_before_storage(self):
        config = self._publish_sprints(self.a, [{'id': '5', 'name': 'Sprint Five'}])
        for sprint_id in ('0', '-1', '05', '٥', '５'):
            with self.subTest(sprint_id=sprint_id), self.assertRaisesRegex(
                ValueError, 'positive decimal sprint_id',
            ):
                claim_catalog_refresh(
                    self.a,
                    kind='teams',
                    sprint_id=sprint_id,
                    expected_config=config,
                    owner=str(uuid.uuid4()),
                    budget=self.budget,
                    resolve_config=self.resolve,
                    database_url=self.database_url,
                )
        with self.factory() as session:
            self.assertEqual(session.query(models.WorkspaceSprintTeamCatalog).count(), 0)

    def test_actor_validation_uses_workspace_site_when_connection_site_is_null(self):
        with self.factory() as session:
            workspace = session.get(models.Workspace, self.one_id)
            workspace.jira_site_url = self.a.site_url
            connection = session.get(models.AuthConnection, self.a.auth_connection_id)
            connection.site_url = None
            session.commit()
        config = self.config(self.a)
        self.assertIsNotNone(claim_catalog_refresh(
            self.a,
            kind='sprints',
            expected_config=config,
            owner=self.owner('workspace-site-fallback'),
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        ))


    def test_team_scope_change_hides_old_snapshot(self):
        config = self._publish_sprints(self.a, [{'id': '5', 'name': 'Sprint Five'}])
        claim = claim_catalog_refresh(
            self.a, kind='teams', sprint_id='5', expected_config=config,
            owner=self.owner('old-team-scope'), budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.a, claim=claim, payload=[{'id': 'a', 'name': 'Alpha'}],
            budget=self.budget, resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).filter_by(
                workspace_id=self.one_id,
            ).one()
            row.payload = {'board': {'boardId': '17'}, 'projects': [{'key': 'OTHER'}]}
            row.config_revision += 1
            session.commit()
        changed = self.config(self.a)
        snapshot = load_sprint_team_catalog(
            self.a, sprint_id='5', config=changed, database_url=self.database_url,
        )
        self.assertIsNone(snapshot.payload)
        self.assertIsNone(snapshot.catalog_version)
        self.assertNotEqual(snapshot.identity, claim.identity)

    def test_team_refresh_is_visible_to_other_workspace_users(self):
        config = self._publish_sprints(self.a, [{'id': '5', 'name': 'Sprint Five'}])
        claim = claim_catalog_refresh(
            self.a, kind='teams', sprint_id='5', expected_config=config,
            owner=self.owner('shared-team-snapshot'), budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.a, claim=claim, payload=[{'id': 'a', 'name': 'Alpha'}],
            budget=self.budget, resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        shared = load_sprint_team_catalog(
            self.b, sprint_id='5', config=self.config(self.b),
            database_url=self.database_url,
        )
        isolated = load_sprint_team_catalog(
            self.c, sprint_id='5', config=self.config(self.c),
            database_url=self.database_url,
        )
        self.assertEqual(shared.payload, [{'id': 'a', 'name': 'Alpha'}])
        self.assertIsNone(isolated.payload)

    def test_team_publication_reloads_latest_directory_and_merges_only_issue_names(self):
        config = self._publish_sprints(self.a, [{'id': '5', 'name': 'Sprint Five'}])
        save_workspace_team_catalog(
            self.a,
            {'catalog': {
                'directory': {'id': 'directory', 'name': 'Old directory'},
                'bare': {'id': 'bare', 'name': 'Old bare'},
            }, 'meta': {}},
            database_url=self.database_url,
        )
        fetched = SprintTeamPayload([
            {'id': 'directory', 'name': 'Old directory'},
            {'id': 'bare', 'name': 'bare'},
            {'id': 'issue', 'name': 'Issue name'},
        ], issue_names={'issue': 'Issue name'})
        save_workspace_team_catalog(
            self.a,
            {'catalog': {
                'directory': {'id': 'directory', 'name': 'Newest directory'},
                'bare': {'id': 'bare', 'name': 'Newest bare'},
            }, 'meta': {}},
            merge=True,
            database_url=self.database_url,
        )
        claim = claim_catalog_refresh(
            self.a, kind='teams', sprint_id='5', expected_config=config,
            owner=self.owner('latest-directory-publication'), budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.a, claim=claim, payload=fetched, budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        snapshot = load_sprint_team_catalog(
            self.a, sprint_id='5', config=config, database_url=self.database_url,
        )
        self.assertEqual(snapshot.payload, [
            {'id': 'issue', 'name': 'Issue name'},
            {'id': 'bare', 'name': 'Newest bare'},
            {'id': 'directory', 'name': 'Newest directory'},
        ])
        with self.factory() as session:
            directory = session.query(models.WorkspaceTeamCatalog).one().payload['catalog']
        self.assertEqual(directory['directory']['name'], 'Newest directory')
        self.assertEqual(directory['bare']['name'], 'Newest bare')
        self.assertEqual(directory['issue']['name'], 'Issue name')


if __name__ == '__main__':
    unittest.main()
