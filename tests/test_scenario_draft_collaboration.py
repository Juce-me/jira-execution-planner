import os
import tempfile
import unittest
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError

from backend import scenario_drafts
from backend.db import engine as db_engine
from backend.db import models
from backend.scenario_drafts import (
    ScenarioDraftLockConflict,
    acquire_lock,
    append_event,
    block_writeback,
    get_active_presence,
    get_events_after,
    preview_writeback,
    reload_from_jira,
    rollback_to_version,
    save_draft,
    upsert_presence,
)
import jira_server


REPO_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = REPO_ROOT / 'backend' / 'db' / 'alembic.ini'


def migration_config(database_url):
    config = Config(str(ALEMBIC_INI))
    config.set_main_option('sqlalchemy.url', database_url)
    config.set_main_option('script_location', str(REPO_ROOT / 'backend' / 'db' / 'migrations'))
    return config


class ScenarioDraftCollaborationMigrationTests(unittest.TestCase):
    def test_migration_adds_collaboration_tables_and_downgrades(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'scenario-draft-collab.db')}"
            config = migration_config(database_url)

            command.upgrade(config, '20260514_0004')
            engine = create_engine(database_url, future=True)
            try:
                tables = set(inspect(engine).get_table_names())
                self.assertNotIn('scenario_draft_events', tables)
                self.assertNotIn('scenario_draft_presence', tables)
                self.assertNotIn('scenario_draft_locks', tables)
            finally:
                engine.dispose()

            command.upgrade(config, '20260514_0005')
            engine = create_engine(database_url, future=True)
            try:
                inspector = inspect(engine)
                tables = set(inspector.get_table_names())
                self.assertIn('scenario_draft_events', tables)
                self.assertIn('scenario_draft_presence', tables)
                self.assertIn('scenario_draft_locks', tables)

                event_columns = {column['name'] for column in inspector.get_columns('scenario_draft_events')}
                presence_columns = {column['name'] for column in inspector.get_columns('scenario_draft_presence')}
                lock_columns = {column['name'] for column in inspector.get_columns('scenario_draft_locks')}
                event_uniques = {
                    constraint['name']
                    for constraint in inspector.get_unique_constraints('scenario_draft_events')
                }
                presence_uniques = {
                    constraint['name']
                    for constraint in inspector.get_unique_constraints('scenario_draft_presence')
                }
                lock_uniques = {
                    constraint['name']
                    for constraint in inspector.get_unique_constraints('scenario_draft_locks')
                }

                self.assertTrue({
                    'scenario_draft_id',
                    'event_number',
                    'event_type',
                    'draft_revision',
                    'payload',
                    'created_by',
                    'created_at',
                }.issubset(event_columns))
                self.assertTrue({
                    'scenario_draft_id',
                    'user_id',
                    'display_name',
                    'cursor_payload',
                    'mode',
                    'last_seen_at',
                }.issubset(presence_columns))
                self.assertTrue({
                    'scenario_draft_id',
                    'resource_type',
                    'resource_id',
                    'holder_user_id',
                    'holder_display_name',
                    'expires_at',
                    'updated_at',
                }.issubset(lock_columns))
                self.assertIn('uq_scenario_draft_events_number', event_uniques)
                self.assertIn('uq_scenario_draft_presence_user', presence_uniques)
                self.assertIn('uq_scenario_draft_locks_resource', lock_uniques)
            finally:
                engine.dispose()

            command.downgrade(config, '20260514_0004')
            engine = create_engine(database_url, future=True)
            try:
                tables = set(inspect(engine).get_table_names())
                self.assertNotIn('scenario_draft_events', tables)
                self.assertNotIn('scenario_draft_presence', tables)
                self.assertNotIn('scenario_draft_locks', tables)
                self.assertIn('scenario_drafts', tables)
            finally:
                engine.dispose()


class ScenarioDraftCollaborationServiceTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'scenario-draft-collab-service.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.user_id, self.other_user_id, self.workspace_id = self._seed_users_workspaces()
        self.context = SimpleNamespace(workspace_id=self.workspace_id, user_id=self.user_id, database_url=self.database_url)
        self.other_context = SimpleNamespace(
            workspace_id=self.workspace_id,
            user_id=self.other_user_id,
            database_url=self.database_url,
        )
        self.draft_id = self._seed_draft()

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_users_workspaces(self):
        with self.factory() as session:
            user = models.User(
                external_provider='atlassian',
                external_subject='account-1',
                display_name='First User',
                account_type='user',
                status='active',
                created_by='test',
            )
            other_user = models.User(
                external_provider='atlassian',
                external_subject='account-2',
                display_name='Second User',
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
            session.add_all([user, other_user, workspace])
            session.commit()
            return user.id, other_user.id, workspace.id

    def _seed_draft(self):
        with self.factory() as session:
            draft = models.ScenarioDraft(
                workspace_id=self.workspace_id,
                scope_key='sprint:2026-q2|group:platform',
                name='Platform Q2',
                scope_payload={'groupId': 'platform'},
                overrides={},
                draft_revision=3,
                created_by=self.user_id,
                updated_by=self.user_id,
            )
            session.add(draft)
            session.commit()
            return draft.id

    def test_event_numbers_increment_per_draft_and_uniqueness_is_enforced(self):
        first = append_event(
            self.context,
            self.draft_id,
            event_type='issue_move',
            draft_revision=3,
            payload={'issueKey': 'ENG-1'},
        )
        second = append_event(
            self.context,
            self.draft_id,
            event_type='issue_resize',
            draft_revision=3,
            payload={'issueKey': 'ENG-1'},
        )

        self.assertEqual(first['eventNumber'], 1)
        self.assertEqual(second['eventNumber'], 2)
        self.assertNotIn('revision', first)
        self.assertEqual(
            [event['eventNumber'] for event in get_events_after(self.context, self.draft_id, after_event_number=0)],
            [1, 2],
        )
        self.assertEqual(
            [event['eventNumber'] for event in get_events_after(self.context, self.draft_id, after_event_number=1)],
            [2],
        )

        with self.factory() as session:
            session.add(models.ScenarioDraftEvent(
                scenario_draft_id=self.draft_id,
                event_number=2,
                event_type='duplicate',
                draft_revision=3,
                payload={},
                created_by=self.user_id,
            ))
            with self.assertRaises(IntegrityError):
                session.commit()

    def test_append_event_ignores_spoofed_draft_revision(self):
        saved = save_draft(self.context, 'scope-event-spoof', 'Event spoof', {})
        draft_id = saved['activeDraft']['draftId']
        save_draft(self.context, 'scope-event-spoof', 'Event spoof updated', {}, base_draft_revision=1)

        event = append_event(
            self.context,
            draft_id,
            event_type='test.event',
            draft_revision=999,
            payload={},
        )

        self.assertEqual(event['draftRevision'], 2)

    def test_save_and_rollback_append_collaboration_events(self):
        saved = save_draft(
            self.context,
            'scope-save-events',
            'Save events',
            {'ENG-1': {'start': '2026-05-18'}},
        )
        draft_id = saved['activeDraft']['draftId']
        rolled_back = rollback_to_version(
            self.context,
            draft_id,
            target_version_number=1,
            base_draft_revision=1,
        )

        events = get_events_after(self.context, draft_id, after_event_number=0)

        self.assertEqual(rolled_back['activeDraft']['draftRevision'], 2)
        self.assertEqual([event['eventType'] for event in events], ['draft.saved', 'draft.rolled_back'])
        self.assertEqual([event['eventNumber'] for event in events], [1, 2])
        self.assertNotIn('revision', events[0])

    def test_reload_and_writeback_services_do_not_use_local_token_store_helpers(self):
        saved = save_draft(self.context, 'scope-service-guards', 'Service guards', {})
        draft_id = saved['activeDraft']['draftId']

        forbidden_jira_clients = (
            'jira_get',
            'jira_post',
            'jira_request',
            'current_jira_request',
            'current_jira_get',
            'current_jira_search',
            'jira_search_request',
            'oauth_session_data',
            'save_oauth_session',
        )
        with ExitStack() as stack:
            for name in forbidden_jira_clients:
                stack.enter_context(patch.object(
                    jira_server,
                    name,
                    side_effect=AssertionError(f'{name} forbidden'),
                ))
            stack.enter_context(patch(
                'backend.auth.home_credentials.resolve_home_credential',
                side_effect=AssertionError('home credential forbidden'),
            ))
            stack.enter_context(patch(
                'backend.auth.service_integrations.get_service_integration_summary',
                side_effect=AssertionError('service integration forbidden'),
            ))
            stack.enter_context(patch(
                'backend.auth.service_integrations.list_service_integration_summaries',
                side_effect=AssertionError('service integration list forbidden'),
            ))
            reloaded = reload_from_jira(
                self.context,
                draft_id,
                base_draft_revision=1,
                source_loader=lambda context, draft, timeout_seconds: {
                    'config': {'sprint': '2026Q2'},
                    'filters': {'scopeKey': draft['scopeKey']},
                    'issues': [{'key': 'ENG-1'}],
                    'dependencies': [],
                },
            )
            preview = preview_writeback(self.context, draft_id)
            with self.assertRaises(scenario_drafts.ScenarioDraftValidationError) as raised:
                block_writeback(self.context, draft_id)

        self.assertEqual(reloaded['activeDraft']['draftRevision'], 2)
        self.assertEqual(reloaded['versions'][-1]['source'], 'reload_from_jira')
        self.assertTrue(preview['dryRun'])
        self.assertEqual(raised.exception.code, 'jira_writeback_gate_blocked')

    def test_append_event_retries_duplicate_event_number_without_leaking_integrity_error(self):
        append_event(
            self.context,
            self.draft_id,
            event_type='issue_move',
            draft_revision=3,
            payload={'issueKey': 'ENG-1'},
        )

        with patch('backend.scenario_drafts._next_event_number', side_effect=[1, 2]):
            retried = append_event(
                self.context,
                self.draft_id,
                event_type='issue_resize',
                draft_revision=3,
                payload={'issueKey': 'ENG-1'},
            )

        self.assertEqual(retried['eventNumber'], 2)
        self.assertEqual(
            [event['eventNumber'] for event in get_events_after(self.context, self.draft_id, after_event_number=0)],
            [1, 2],
        )

    def test_presence_upsert_replaces_same_user_and_filters_expired_rows(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)

        first = upsert_presence(
            self.context,
            self.draft_id,
            display_name='First User',
            cursor_payload={'issueKey': 'ENG-1'},
            mode='dragging',
            now=now,
        )
        updated = upsert_presence(
            self.context,
            self.draft_id,
            display_name='First User',
            cursor_payload={'issueKey': 'ENG-2'},
            mode='editing',
            now=now + timedelta(seconds=5),
        )
        upsert_presence(
            self.other_context,
            self.draft_id,
            display_name='Second User',
            cursor_payload={'issueKey': 'ENG-3'},
            mode='viewing',
            now=now - timedelta(seconds=31),
        )

        active = get_active_presence(self.context, self.draft_id, now=now + timedelta(seconds=5))

        self.assertEqual(first['userId'], self.user_id)
        self.assertEqual(updated['cursorPayload'], {'issueKey': 'ENG-2'})
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]['userId'], self.user_id)
        self.assertEqual(active[0]['mode'], 'editing')

        with self.factory() as session:
            self.assertEqual(
                session.query(models.ScenarioDraftPresence).filter_by(
                    scenario_draft_id=self.draft_id,
                    user_id=self.user_id,
                ).count(),
                1,
            )

    def test_presence_rows_at_exact_ttl_boundary_are_expired(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        upsert_presence(
            self.context,
            self.draft_id,
            display_name='First User',
            cursor_payload={'issueKey': 'ENG-1'},
            mode='viewing',
            now=now - timedelta(seconds=30),
        )

        active = get_active_presence(self.context, self.draft_id, now=now)

        self.assertEqual(active, [])

    def test_presence_upsert_handles_duplicate_insert_race_by_updating_existing_row(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        upsert_presence(
            self.context,
            self.draft_id,
            display_name='First User',
            cursor_payload={'issueKey': 'ENG-1'},
            mode='viewing',
            now=now,
        )

        original_presence_for_user = scenario_drafts._presence_for_user
        calls = []

        def miss_once(session, draft_id, user_id):
            calls.append(True)
            if len(calls) == 1:
                return None
            return original_presence_for_user(session, draft_id, user_id)

        with patch('backend.scenario_drafts._presence_for_user', side_effect=miss_once):
            updated = upsert_presence(
                self.context,
                self.draft_id,
                display_name='First User',
                cursor_payload={'issueKey': 'ENG-2'},
                mode='editing',
                now=now + timedelta(seconds=1),
            )

        self.assertEqual(updated['cursorPayload'], {'issueKey': 'ENG-2'})
        self.assertEqual(updated['mode'], 'editing')

    def test_lock_conflict_refresh_and_expired_replacement(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        acquired = acquire_lock(
            self.context,
            self.draft_id,
            resource_type='issue',
            resource_id='ENG-1',
            holder_display_name='First User',
            now=now,
        )

        self.assertEqual(acquired['holderUserId'], self.user_id)
        self.assertEqual(acquired['expiresAt'], '2026-05-19T12:00:30+00:00')

        with self.assertRaises(ScenarioDraftLockConflict) as raised:
            acquire_lock(
                self.other_context,
                self.draft_id,
                resource_type='issue',
                resource_id='ENG-1',
                holder_display_name='Second User',
                now=now + timedelta(seconds=10),
            )

        self.assertEqual(raised.exception.active_lock['holderUserId'], self.user_id)

        refreshed = acquire_lock(
            self.context,
            self.draft_id,
            resource_type='issue',
            resource_id='ENG-1',
            holder_display_name='First User',
            now=now + timedelta(seconds=20),
        )

        self.assertEqual(refreshed['expiresAt'], '2026-05-19T12:00:50+00:00')

        replaced = acquire_lock(
            self.other_context,
            self.draft_id,
            resource_type='issue',
            resource_id='ENG-1',
            holder_display_name='Second User',
            now=now + timedelta(seconds=51),
        )

        self.assertEqual(replaced['holderUserId'], self.other_user_id)
        self.assertEqual(replaced['expiresAt'], '2026-05-19T12:01:21+00:00')

    def test_lock_duplicate_insert_race_returns_clean_active_conflict(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        acquire_lock(
            self.context,
            self.draft_id,
            resource_type='issue',
            resource_id='ENG-1',
            holder_display_name='First User',
            now=now,
        )

        original_lock_for_resource = scenario_drafts._lock_for_resource
        calls = []

        def miss_once(session, draft_id, *, resource_type, resource_id):
            calls.append(True)
            if len(calls) == 1:
                return None
            return original_lock_for_resource(
                session,
                draft_id,
                resource_type=resource_type,
                resource_id=resource_id,
            )

        with patch('backend.scenario_drafts._lock_for_resource', side_effect=miss_once):
            with self.assertRaises(ScenarioDraftLockConflict) as raised:
                acquire_lock(
                    self.other_context,
                    self.draft_id,
                    resource_type='issue',
                    resource_id='ENG-1',
                    holder_display_name='Second User',
                    now=now + timedelta(seconds=1),
                )

        self.assertEqual(raised.exception.active_lock['holderUserId'], self.user_id)

    def test_lock_duplicate_insert_race_refreshes_same_holder(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        acquire_lock(
            self.context,
            self.draft_id,
            resource_type='issue',
            resource_id='ENG-1',
            holder_display_name='First User',
            now=now,
        )

        original_lock_for_resource = scenario_drafts._lock_for_resource
        calls = []

        def miss_once(session, draft_id, *, resource_type, resource_id):
            calls.append(True)
            if len(calls) == 1:
                return None
            return original_lock_for_resource(
                session,
                draft_id,
                resource_type=resource_type,
                resource_id=resource_id,
            )

        with patch('backend.scenario_drafts._lock_for_resource', side_effect=miss_once):
            refreshed = acquire_lock(
                self.context,
                self.draft_id,
                resource_type='issue',
                resource_id='ENG-1',
                holder_display_name='First User',
                now=now + timedelta(seconds=1),
            )

        self.assertEqual(refreshed['holderUserId'], self.user_id)
        self.assertEqual(refreshed['expiresAt'], '2026-05-19T12:00:31+00:00')


if __name__ == '__main__':
    unittest.main()
