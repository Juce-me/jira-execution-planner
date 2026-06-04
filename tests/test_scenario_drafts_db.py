import os
from types import SimpleNamespace
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.exc import IntegrityError

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine
from backend.db import models
from backend.scenario_drafts import (
    ScenarioDraftConflict,
    ScenarioDraftNotFound,
    ScenarioDraftValidationError,
    get_active_draft,
    get_version,
    rollback_to_version,
    save_draft,
    scenario_source_hash,
)
import jira_server


REPO_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = REPO_ROOT / 'backend' / 'db' / 'alembic.ini'


def migration_config(database_url):
    config = Config(str(ALEMBIC_INI))
    config.set_main_option('sqlalchemy.url', database_url)
    config.set_main_option('script_location', str(REPO_ROOT / 'backend' / 'db' / 'migrations'))
    return config


class ScenarioDraftMigrationTests(unittest.TestCase):
    def test_scenario_draft_migration_adds_tables_indexes_and_downgrades(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'scenario-drafts-migration.db')}"
            config = migration_config(database_url)

            command.upgrade(config, '20260511_0003')
            engine = create_engine(database_url, future=True)
            try:
                self.assertNotIn('scenario_drafts', inspect(engine).get_table_names())
            finally:
                engine.dispose()

            command.upgrade(config, '20260514_0004')
            engine = create_engine(database_url, future=True)
            try:
                inspector = inspect(engine)
                tables = set(inspector.get_table_names())
                self.assertIn('scenario_drafts', tables)
                self.assertIn('scenario_draft_versions', tables)

                draft_columns = {column['name'] for column in inspector.get_columns('scenario_drafts')}
                version_columns = {column['name'] for column in inspector.get_columns('scenario_draft_versions')}
                draft_indexes = {index['name']: index for index in inspector.get_indexes('scenario_drafts')}
                version_uniques = {
                    constraint['name']
                    for constraint in inspector.get_unique_constraints('scenario_draft_versions')
                }

                self.assertTrue({
                    'workspace_id',
                    'scope_key',
                    'scope_payload',
                    'scenario_source_hash',
                    'overrides',
                    'draft_revision',
                    'archived_at',
                }.issubset(draft_columns))
                self.assertTrue({
                    'scenario_draft_id',
                    'version_number',
                    'draft_revision',
                    'scenario_source_hash',
                    'overrides',
                    'source',
                }.issubset(version_columns))
                self.assertIn('uq_scenario_drafts_active_scope', draft_indexes)
                self.assertTrue(draft_indexes['uq_scenario_drafts_active_scope']['unique'])
                self.assertIn('ix_scenario_drafts_workspace_updated', draft_indexes)
                self.assertIn('uq_scenario_draft_versions_number', version_uniques)
            finally:
                engine.dispose()

            command.downgrade(config, '20260511_0003')
            engine = create_engine(database_url, future=True)
            try:
                tables = set(inspect(engine).get_table_names())
                self.assertNotIn('scenario_drafts', tables)
                self.assertNotIn('scenario_draft_versions', tables)
                self.assertIn('view_configs', tables)
            finally:
                engine.dispose()


class ScenarioDraftModelTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'scenario-drafts.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_users_workspaces(self):
        with self.factory() as session:
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
            session.add_all([user, other_user, workspace, other_workspace])
            session.commit()
            return user.id, other_user.id, workspace.id, other_workspace.id

    def test_unique_active_scope_is_workspace_scoped_and_archived_rows_can_be_replaced(self):
        user_id, _, workspace_id, other_workspace_id = self._seed_users_workspaces()
        scope_key = 'sprint:2026-q2|group:platform'

        with self.factory() as session:
            session.add_all([
                models.ScenarioDraft(
                    workspace_id=workspace_id,
                    scope_key=scope_key,
                    name='Platform Q2',
                    scope_payload={'groupId': 'platform', 'groupName': 'Platform'},
                    overrides={'ISSUE-1': {'startDate': '2026-05-18'}},
                    created_by=user_id,
                    updated_by=user_id,
                ),
                models.ScenarioDraft(
                    workspace_id=other_workspace_id,
                    scope_key=scope_key,
                    name='Other workspace Q2',
                    scope_payload={'groupId': 'platform'},
                    overrides={},
                    created_by=user_id,
                    updated_by=user_id,
                ),
            ])
            session.commit()

        with self.factory() as session:
            session.add(models.ScenarioDraft(
                workspace_id=workspace_id,
                scope_key=scope_key,
                name='Duplicate active',
                scope_payload={'groupId': 'platform'},
                overrides={},
                created_by=user_id,
                updated_by=user_id,
            ))
            with self.assertRaises(IntegrityError):
                session.commit()

        with self.factory() as session:
            draft = session.query(models.ScenarioDraft).filter_by(
                workspace_id=workspace_id,
                scope_key=scope_key,
            ).one()
            draft.archived_at = datetime.now(timezone.utc)
            session.add(models.ScenarioDraft(
                workspace_id=workspace_id,
                scope_key=scope_key,
                name='Replacement active',
                scope_payload={'groupId': 'platform'},
                overrides={},
                created_by=user_id,
                updated_by=user_id,
            ))
            session.commit()

    def test_duplicate_version_number_is_rejected_and_reload_from_jira_source_is_supported(self):
        user_id, _, workspace_id, _ = self._seed_users_workspaces()

        with self.factory() as session:
            draft = models.ScenarioDraft(
                workspace_id=workspace_id,
                scope_key='sprint:2026-q2|team:alpha',
                name='Alpha Q2',
                scope_payload={'teamId': 'alpha'},
                scenario_source_hash='sha256:abc',
                overrides={},
                created_by=user_id,
                updated_by=user_id,
            )
            session.add(draft)
            session.flush()
            session.add(models.ScenarioDraftVersion(
                scenario_draft_id=draft.id,
                version_number=1,
                draft_revision=1,
                name=draft.name,
                scope_payload=dict(draft.scope_payload),
                scenario_source_hash=draft.scenario_source_hash,
                overrides=dict(draft.overrides),
                created_by=user_id,
                change_note='reload from Jira',
                source='reload_from_jira',
            ))
            session.commit()
            draft_id = draft.id

        with self.factory() as session:
            version = session.query(models.ScenarioDraftVersion).filter_by(
                scenario_draft_id=draft_id,
                version_number=1,
            ).one()
            self.assertEqual(version.source, 'reload_from_jira')

            session.add(models.ScenarioDraftVersion(
                scenario_draft_id=draft_id,
                version_number=1,
                draft_revision=2,
                name='Duplicate version',
                scope_payload={'teamId': 'alpha'},
                overrides={},
                created_by=user_id,
                change_note='duplicate',
                source='user',
            ))
            with self.assertRaises(IntegrityError):
                session.commit()

    def test_same_workspace_oauth_users_resolve_same_active_draft_for_scope(self):
        user_id, other_user_id, workspace_id, _ = self._seed_users_workspaces()
        scope_key = 'sprint:2026-q2|group:shared'

        with self.factory() as session:
            draft = models.ScenarioDraft(
                workspace_id=workspace_id,
                scope_key=scope_key,
                name='Shared Q2',
                scope_payload={'groupId': 'shared', 'groupName': 'Shared'},
                overrides={},
                created_by=user_id,
                updated_by=user_id,
            )
            session.add(draft)
            session.commit()
            draft_id = draft.id

        resolved_ids = []
        for current_user_id in [user_id, other_user_id]:
            with self.factory() as session:
                resolved = session.query(models.ScenarioDraft).filter_by(
                    workspace_id=workspace_id,
                    scope_key=scope_key,
                    archived_at=None,
                ).one()
                self.assertIn(current_user_id, [user_id, other_user_id])
                resolved_ids.append(resolved.id)

        self.assertEqual(resolved_ids, [draft_id, draft_id])

    def test_multiple_workspaces_can_have_active_drafts_for_same_scope(self):
        user_id, _, workspace_id, other_workspace_id = self._seed_users_workspaces()
        scope_key = 'sprint:2026-q2|team:alpha'

        with self.factory() as session:
            session.add_all([
                models.ScenarioDraft(
                    workspace_id=workspace_id,
                    scope_key=scope_key,
                    name='Workspace 1',
                    scope_payload={'teamId': 'alpha'},
                    overrides={},
                    created_by=user_id,
                    updated_by=user_id,
                ),
                models.ScenarioDraft(
                    workspace_id=other_workspace_id,
                    scope_key=scope_key,
                    name='Workspace 2',
                    scope_payload={'teamId': 'alpha'},
                    overrides={},
                    created_by=user_id,
                    updated_by=user_id,
                ),
            ])
            session.commit()

        with self.factory() as session:
            drafts = session.query(models.ScenarioDraft).filter_by(
                scope_key=scope_key,
                archived_at=None,
            ).all()
            self.assertEqual({draft.workspace_id for draft in drafts}, {workspace_id, other_workspace_id})

    def test_scenario_source_hash_is_deterministic_for_ordering_and_omits_session_fields(self):
        first = {
            'session': {'user': 'account-1'},
            'filters': {'team': 'Alpha', 'statuses': ['Todo', 'In Progress']},
            'issues': [
                {'key': 'ENG-2', 'summary': 'Second', 'fields': {'points': 3}},
                {'key': 'ENG-1', 'summary': 'First', 'fields': {'points': 5}},
            ],
            'dependencies': [
                {'from': 'ENG-2', 'to': 'ENG-1', 'type': 'blocks'},
                {'from': 'ENG-1', 'to': 'ENG-2', 'type': 'relates'},
            ],
            'config': {'timezone': 'UTC', 'capacity': {'alpha': 12}},
            'sprintBoundaries': {'start': '2026-05-01', 'end': '2026-06-30'},
        }
        second = {
            'auth': {'token': 'secret'},
            'sprintBoundaries': {'end': '2026-06-30', 'start': '2026-05-01'},
            'dependencies': [
                {'type': 'relates', 'to': 'ENG-2', 'from': 'ENG-1'},
                {'type': 'blocks', 'to': 'ENG-1', 'from': 'ENG-2'},
            ],
            'issues': [
                {'fields': {'points': 5}, 'summary': 'First', 'key': 'ENG-1'},
                {'fields': {'points': 3}, 'summary': 'Second', 'key': 'ENG-2'},
            ],
            'filters': {'statuses': ['Todo', 'In Progress'], 'team': 'Alpha'},
            'config': {'capacity': {'alpha': 12}, 'timezone': 'UTC'},
        }
        changed_visible_state = {
            **second,
            'issues': [
                {'fields': {'points': 8}, 'summary': 'First', 'key': 'ENG-1'},
                {'fields': {'points': 3}, 'summary': 'Second', 'key': 'ENG-2'},
            ],
        }

        self.assertEqual(
            models.scenario_source_hash(first),
            models.scenario_source_hash(second),
        )
        self.assertNotEqual(
            models.scenario_source_hash(second),
            models.scenario_source_hash(changed_visible_state),
        )
        self.assertRegex(models.scenario_source_hash(first), r'^sha256:[0-9a-f]{64}$')


class ScenarioDraftServiceTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'scenario-drafts-service.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.user_id, self.other_user_id, self.workspace_id, self.other_workspace_id = self._seed_users_workspaces()
        self.context = self._context(self.workspace_id, self.user_id)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_users_workspaces(self):
        with self.factory() as session:
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
            session.add_all([user, other_user, workspace, other_workspace])
            session.commit()
            return user.id, other_user.id, workspace.id, other_workspace.id

    def _context(self, workspace_id, user_id):
        return SimpleNamespace(
            workspace_id=workspace_id,
            user_id=user_id,
            database_url=self.database_url,
        )

    def test_save_creates_and_updates_active_draft_with_version_history(self):
        scope_key = 'sprint:2026-q2|group:platform'

        created = save_draft(
            self.context,
            scope_key,
            'Platform Q2',
            {'ENG-1': {'start': '2026-05-18', 'end': '2026-05-21'}},
            scope_payload={'groupId': 'platform', 'groupName': 'Platform'},
        )

        self.assertEqual(created['storage'], 'db')
        self.assertEqual(created['activeDraft']['draftRevision'], 1)
        self.assertEqual(created['activeDraft']['versionNumber'], 1)
        self.assertEqual(created['activeDraft']['updatedBy'], self.user_id)
        self.assertIsInstance(created['activeDraft']['updatedAt'], str)
        self.assertEqual(created['versions'][0]['versionNumber'], 1)
        self.assertEqual(created['versions'][0]['overrideCount'], 1)
        self.assertEqual(created['versions'][0]['createdBy'], self.user_id)
        self.assertIsInstance(created['versions'][0]['createdAt'], str)
        self.assertEqual(created['versions'][0]['changeNote'], 'user save')
        self.assertNotIn('revision', created['activeDraft'])
        self.assertNotIn('currentVersionNumber', created['activeDraft'])

        updated = save_draft(
            self.context,
            scope_key,
            'Platform Q2 updated',
            {'ENG-1': {'start': '2026-05-19'}},
            base_draft_revision=1,
            scope_payload={'groupId': 'platform', 'groupName': 'Platform'},
        )

        self.assertEqual(updated['activeDraft']['draftRevision'], 2)
        self.assertEqual(updated['activeDraft']['versionNumber'], 2)
        self.assertEqual(updated['activeDraft']['updatedBy'], self.user_id)
        self.assertIsInstance(updated['activeDraft']['updatedAt'], str)
        self.assertEqual(updated['activeDraft']['name'], 'Platform Q2 updated')
        self.assertEqual([version['versionNumber'] for version in updated['versions']], [1, 2])
        self.assertEqual(updated['versions'][1]['draftRevision'], 2)
        self.assertEqual(updated['versions'][1]['overrideCount'], 1)
        self.assertEqual(updated['versions'][1]['createdBy'], self.user_id)
        self.assertIsInstance(updated['versions'][1]['createdAt'], str)
        self.assertEqual(updated['versions'][1]['changeNote'], 'user save')

        loaded = get_active_draft(self.context, scope_key)
        self.assertEqual(loaded['storage'], 'db')
        self.assertEqual(loaded['activeDraft']['draftRevision'], 2)
        self.assertEqual(loaded['activeDraft']['versionNumber'], 2)
        self.assertEqual(loaded['activeDraft']['updatedBy'], self.user_id)
        self.assertIsInstance(loaded['activeDraft']['updatedAt'], str)
        self.assertNotIn('currentVersionNumber', loaded['activeDraft'])
        self.assertEqual(len(loaded['versions']), 2)

    def test_update_requires_current_base_draft_revision_and_conflict_includes_snapshot(self):
        scope_key = 'sprint:2026-q2|team:alpha'
        save_draft(self.context, scope_key, 'Alpha', {'ENG-1': {'start': '2026-05-18'}})

        with self.assertRaises(ScenarioDraftConflict) as missing_base:
            save_draft(
                self.context,
                scope_key,
                'Alpha missing base',
                {'ENG-1': {'start': '2026-05-19'}},
            )

        self.assertEqual(missing_base.exception.reason, 'stale_base_draft_revision')
        self.assertIsNone(missing_base.exception.received_base_draft_revision)

        save_draft(
            self.context,
            scope_key,
            'Alpha updated',
            {'ENG-1': {'start': '2026-05-19'}},
            base_draft_revision=1,
        )

        with self.assertRaises(ScenarioDraftConflict) as raised:
            save_draft(
                self.context,
                scope_key,
                'Stale update',
                {'ENG-1': {'start': '2026-05-20'}},
                base_draft_revision=1,
            )

        conflict = raised.exception
        self.assertEqual(conflict.reason, 'stale_base_draft_revision')
        self.assertEqual(conflict.received_base_draft_revision, 1)
        self.assertEqual(conflict.current_draft_revision, 2)
        self.assertEqual(conflict.current_version_number, 2)
        self.assertEqual(conflict.active_draft['draftRevision'], 2)
        self.assertEqual(conflict.active_draft['updatedBy'], self.user_id)
        self.assertIsInstance(conflict.active_draft['updatedAt'], str)
        self.assertEqual([version['versionNumber'] for version in conflict.versions], [1, 2])
        self.assertEqual(conflict.versions[1]['overrideCount'], 1)
        self.assertEqual(conflict.versions[1]['createdBy'], self.user_id)
        self.assertIsInstance(conflict.versions[1]['createdAt'], str)
        self.assertEqual(conflict.versions[1]['changeNote'], 'user save')

    def test_get_version_is_workspace_scoped_and_returns_snapshot(self):
        saved = save_draft(self.context, 'scope-1', 'Scoped', {'ENG-1': {'end': '2026-05-22'}})
        draft_id = saved['activeDraft']['draftId']

        version = get_version(self.context, draft_id, 1)

        self.assertEqual(version['storage'], 'db')
        self.assertEqual(version['versionNumber'], 1)
        self.assertEqual(version['draftRevision'], 1)
        self.assertEqual(version['source'], 'user')
        self.assertEqual(version['overrideCount'], 1)
        self.assertEqual(version['createdBy'], self.user_id)
        self.assertIsInstance(version['createdAt'], str)
        self.assertEqual(version['changeNote'], 'user save')
        self.assertEqual(version['overrides'], {'ENG-1': {'end': '2026-05-22'}})

        with self.assertRaises(ScenarioDraftNotFound):
            get_version(self._context(self.other_workspace_id, self.other_user_id), draft_id, 1)
        with self.assertRaises(ScenarioDraftNotFound):
            get_version(self.context, draft_id, 99)

    def test_rollback_copies_target_snapshot_and_appends_rollback_version(self):
        first = save_draft(self.context, 'scope-rollback', 'Rollback', {'ENG-1': {'start': '2026-05-18'}})
        save_draft(
            self.context,
            'scope-rollback',
            'Rollback updated',
            {'ENG-1': {'start': '2026-05-19'}, 'ENG-2': {'end': '2026-05-24'}},
            base_draft_revision=1,
        )

        rolled_back = rollback_to_version(
            self.context,
            first['activeDraft']['draftId'],
            target_version_number=1,
            base_draft_revision=2,
        )

        self.assertEqual(rolled_back['activeDraft']['draftRevision'], 3)
        self.assertEqual(rolled_back['activeDraft']['overrides'], {'ENG-1': {'start': '2026-05-18'}})
        self.assertEqual([version['versionNumber'] for version in rolled_back['versions']], [1, 2, 3])
        self.assertEqual(rolled_back['versions'][2]['source'], 'rollback')
        self.assertEqual(rolled_back['versions'][2]['changeNote'], 'rollback to version 1')

    def test_scope_payload_rejects_membership_shaped_fields_recursively(self):
        invalid_payloads = [
            {'members': ['account-1']},
            {'teamIds': ['team-1']},
            {'memberUserIds': ['account-1']},
            {'groupId': 'platform', 'metadata': [{'groupDefinitions': [{'id': 'nested'}]}]},
        ]

        for scope_payload in invalid_payloads:
            with self.subTest(scope_payload=scope_payload):
                with self.assertRaises(ScenarioDraftValidationError) as raised:
                    save_draft(
                        self.context,
                        'scope-invalid-members',
                        'Invalid',
                        {},
                        scope_payload=scope_payload,
                    )

                self.assertEqual(raised.exception.code, 'scenario_scope_membership_not_allowed')

    def test_scope_payload_must_reject_falsy_non_object_values(self):
        for scope_payload in ([], '', 0, False):
            with self.subTest(scope_payload=scope_payload):
                with self.assertRaises(ScenarioDraftValidationError) as raised:
                    save_draft(
                        self.context,
                        'scope-invalid-payload',
                        'Invalid',
                        {},
                        scope_payload=scope_payload,
                    )

                self.assertEqual(raised.exception.code, 'scenario_scope_payload_invalid')

    def test_overrides_must_be_objects_with_only_start_and_end_fields(self):
        invalid_payloads = [
            [],
            {'ENG-1': {'start': '2026-05-18', 'assignee': 'account-1'}},
            {'ENG-1': ['2026-05-18']},
        ]

        for overrides in invalid_payloads:
            with self.subTest(overrides=overrides):
                with self.assertRaises(ScenarioDraftValidationError):
                    save_draft(self.context, 'scope-invalid-overrides', 'Invalid', overrides)

    def test_duplicate_version_insert_is_translated_to_conflict(self):
        save_draft(self.context, 'scope-version-race', 'Race', {'ENG-1': {'start': '2026-05-18'}})

        with patch('backend.scenario_drafts._next_version_number', return_value=1):
            with self.assertRaises(ScenarioDraftConflict) as raised:
                save_draft(
                    self.context,
                    'scope-version-race',
                    'Race update',
                    {'ENG-1': {'start': '2026-05-19'}},
                    base_draft_revision=1,
                )

        self.assertEqual(raised.exception.reason, 'stale_base_draft_revision')

    def test_save_conflicts_when_revision_changes_after_initial_read(self):
        scope_key = 'scope-interleaved-write'
        save_draft(self.context, scope_key, 'Interleaved', {'ENG-1': {'start': '2026-05-18'}})
        bumped = []

        def bump_revision_before_update(conn, cursor, statement, parameters, context, executemany):
            if bumped or not statement.lstrip().upper().startswith('UPDATE scenario_drafts'.upper()):
                return
            bumped.append(True)
            cursor.execute(
                'UPDATE scenario_drafts SET draft_revision = ? WHERE scope_key = ?',
                (2, scope_key),
            )

        event.listen(self.engine, 'before_cursor_execute', bump_revision_before_update)
        try:
            with self.assertRaises(ScenarioDraftConflict) as raised:
                save_draft(
                    self.context,
                    scope_key,
                    'Interleaved stale',
                    {'ENG-1': {'start': '2026-05-19'}},
                    base_draft_revision=1,
                )
        finally:
            event.remove(self.engine, 'before_cursor_execute', bump_revision_before_update)

        self.assertEqual(raised.exception.reason, 'stale_base_draft_revision')
        self.assertEqual(raised.exception.current_draft_revision, 2)

    def test_legacy_import_is_gated_to_single_or_explicit_workspace_and_does_not_rewrite_loader(self):
        calls = []

        def legacy_loader():
            calls.append('load')
            return {
                'version': 1,
                'scenarios': {
                    'legacy-scope': {
                        'name': 'Legacy draft',
                        'overrides': {'ENG-1': {'start': '2026-05-18'}},
                    },
                    'other-scope': {
                        'name': 'Other draft',
                        'overrides': {'ENG-2': {'end': '2026-05-22'}},
                    },
                },
            }

        blocked = get_active_draft(self.context, 'legacy-scope', legacy_loader=legacy_loader)
        self.assertIsNone(blocked['activeDraft'])
        self.assertEqual(calls, [])

        explicit_context = SimpleNamespace(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            database_url=self.database_url,
            environ={
                'LOCAL_FILE_STATE_ENABLED': 'true',
                'SCENARIO_DRAFT_LEGACY_IMPORT_WORKSPACE_ID': self.workspace_id,
            },
        )
        imported = get_active_draft(explicit_context, 'legacy-scope', legacy_loader=legacy_loader)

        self.assertEqual(calls, ['load'])
        self.assertEqual(imported['activeDraft']['name'], 'Legacy draft')
        self.assertEqual(imported['activeDraft']['draftRevision'], 1)
        self.assertEqual(imported['versions'][0]['source'], 'legacy_json')
        self.assertEqual(imported['versions'][0]['versionNumber'], 1)
        self.assertEqual(imported['versions'][0]['overrides'], {'ENG-1': {'start': '2026-05-18'}})

    def test_legacy_import_partial_env_inherits_process_environment_policy(self):
        calls = []

        def legacy_loader():
            calls.append('load')
            return {
                'version': 1,
                'scenarios': {
                    'legacy-scope': {
                        'name': 'Legacy draft',
                        'overrides': {'ENG-1': {'start': '2026-05-18'}},
                    },
                },
            }

        context = SimpleNamespace(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            database_url=self.database_url,
            environ={'SCENARIO_DRAFT_LEGACY_IMPORT_WORKSPACE_ID': self.workspace_id},
        )

        with patch.dict(os.environ, {'APP_ENVIRONMENT_KEY': 'production'}, clear=False):
            blocked = get_active_draft(context, 'legacy-scope', legacy_loader=legacy_loader)

        self.assertIsNone(blocked['activeDraft'])
        self.assertEqual(calls, [])

    def test_legacy_import_rejects_explicit_falsy_non_object_scope_payload(self):
        explicit_context = SimpleNamespace(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            database_url=self.database_url,
            environ={
                'LOCAL_FILE_STATE_ENABLED': 'true',
                'SCENARIO_DRAFT_LEGACY_IMPORT_WORKSPACE_ID': self.workspace_id,
            },
        )

        for scope_payload in (False, 0, '', []):
            with self.subTest(scope_payload=scope_payload):
                def legacy_loader():
                    return {
                        'version': 1,
                        'scenarios': {
                            f'legacy-invalid-{repr(scope_payload)}': {
                                'name': 'Invalid legacy draft',
                                'scope_payload': scope_payload,
                                'overrides': {'ENG-1': {'start': '2026-05-18'}},
                            },
                        },
                    }

                with self.assertRaises(ScenarioDraftValidationError) as raised:
                    get_active_draft(
                        explicit_context,
                        f'legacy-invalid-{repr(scope_payload)}',
                        legacy_loader=legacy_loader,
                    )

                self.assertEqual(raised.exception.code, 'scenario_scope_payload_invalid')

    def test_scenario_source_hash_helper_matches_model_contract(self):
        source = {
            'user': {'accountId': 'account-1'},
            'issues': [{'key': 'ENG-2'}, {'key': 'ENG-1'}],
            'dependencies': [{'to': 'ENG-1', 'from': 'ENG-2', 'type': 'blocks'}],
            'filters': {'sprint': 'Q2'},
            'config': {'lane_mode': 'team'},
            'sprintBoundaries': {'start': '2026-05-01', 'end': '2026-06-30'},
        }

        self.assertEqual(scenario_source_hash(source), models.scenario_source_hash(source))

    def test_explicit_request_auth_context_does_not_use_local_oauth_token_store_helpers(self):
        context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id=self.user_id,
            stable_subject='account-1',
            atlassian_account_id='account-1',
            workspace_id=self.workspace_id,
            auth_connection_id='connection-1',
            cloud_id='cloud-1',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=True,
        )

        with patch.dict(os.environ, {'DATABASE_URL': self.database_url}, clear=False), \
             patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('local token store read forbidden')), \
             patch.object(jira_server, 'save_oauth_session', side_effect=AssertionError('local token store write forbidden')):
            saved = save_draft(context, 'scope-explicit-context', 'Explicit', {'ENG-1': {'start': '2026-05-18'}})
            loaded = get_active_draft(context, 'scope-explicit-context')

        self.assertEqual(saved['activeDraft']['draftRevision'], 1)
        self.assertEqual(loaded['activeDraft']['draftRevision'], 1)


if __name__ == '__main__':
    unittest.main()
