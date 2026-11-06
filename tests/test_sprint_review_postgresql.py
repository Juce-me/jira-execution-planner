"""Opt-in PostgreSQL race and migration evidence for Department-group reviews (#267).

Requires an explicitly approved disposable TEST_DATABASE_URL. Every test owns an
isolated schema; no configured application schema or production migration is used.

Races are deterministic: the first writer pauses inside its transaction while it
holds the group schema row lock, the test proves the second writer is waiting on a
PostgreSQL lock, and only then releases the first writer.
"""
import contextlib
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import os
import re
from pathlib import Path
from threading import Event, Thread, current_thread
from types import SimpleNamespace
import time
import unittest
import uuid
from unittest.mock import Mock, patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import make_url

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine, models
from backend.services import sprint_review as review
from scripts import adopt_legacy_sprint_reviews as adopt

GROUP_TABLES = ('workspace_group_review_schemas', 'group_review_cells', 'group_sprint_review_views')
LEGACY_TABLES = ('workspace_sprint_reviews', 'sprint_review_cells')
SHARED_PLAN_TABLES = ('group_sprint_plans', 'group_sprint_plan_entries', 'planning_save_operations')
HEAD_REVISION = '20261106_0024'
REVISION_FILE = Path('backend/db/migrations/versions/20261023_0020_adopt_legacy_sprint_reviews.py')
PARENT_REVISION = '20261020_0019'


@unittest.skipUnless(os.environ.get('REQUIRE_POSTGRES_REVIEW_CONCURRENCY') == '1',
                     'Explicit approved PostgreSQL review test target is required')
class SprintReviewPostgresqlTests(unittest.TestCase):
    def setUp(self):
        parsed = make_url(os.environ.get('TEST_DATABASE_URL', ''))
        if parsed.get_backend_name() != 'postgresql':
            raise AssertionError('An explicit PostgreSQL TEST_DATABASE_URL is required')
        self.env = patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_CONNECTION_MODE': 'url'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.schema = 'review_race_' + uuid.uuid4().hex
        self.admin = create_engine(parsed, future=True)
        with self.admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        bounded = parsed.update_query_dict({'options': f'-csearch_path={self.schema} -cstatement_timeout=10000 -clock_timeout=5000'})
        self.url = bounded.render_as_string(hide_password=False)
        self.addCleanup(self.cleanup_schema)
        config = Config('backend/db/alembic.ini')
        config.set_main_option('sqlalchemy.url', self.url.replace('%', '%%'))
        command.upgrade(config, 'head')
        self.config = config
        with db_engine.session_scope(self.url) as session:
            workspace = models.Workspace(environment_key='review-' + uuid.uuid4().hex, name='Synthetic')
            session.add(workspace)
            session.flush()
            session.add(models.WorkspaceGroupConfig(workspace_id=workspace.id, payload={
                'version': 1, 'groups': [{'id': 'group-x', 'name': 'Platform'}], 'defaultGroupId': 'group-x'}))
            workspace_id = workspace.id
        self.workspace_id = workspace_id
        self.context = RequestAuthContext(auth_mode='atlassian_oauth', user_id='synthetic-user',
            stable_subject='synthetic-user', atlassian_account_id='synthetic-account', workspace_id=workspace_id,
            auth_connection_id='synthetic-connection', cloud_id='synthetic-cloud',
            site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)
        self.column = self.new_column()

    def cleanup_schema(self):
        db_engine.dispose_engines()
        with self.admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        self.admin.dispose()

    # Helpers
    def search(self, payload, **kwargs):
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')
        return Mock(status_code=200, json=lambda: {'issues': [{'id': i, 'fields': {'issuetype': {'name': 'Story'}}} for i in ids], 'isLast': True})

    def new_column(self, label='Estimate'):
        return {'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': label, 'type': 'number', 'aggregation': 'sum'}

    def save(self, cells=None, schemas=None, base=1, sprint='17', view=None):
        payload = {'groupId': 'group-x', 'baseSchemaRevision': base, 'schemaChanges': schemas or [], 'cellChanges': cells or []}
        if view is not None:
            payload['baseViewRevision'] = view
        return review.save_review(self.context, sprint, payload, self.url, self.search)

    def add(self, column=None, base=0):
        return self.save(schemas=[{'action': 'add', 'column': column or self.column}], base=base)

    def layout(self, order=('status',)):
        return {'action': 'layout', 'rowKind': 'story', 'order': list(order), 'hidden': []}

    def cell(self, issue, value='1', base=0):
        return {'issueId': issue, 'rowKind': 'story', 'columnId': self.column['id'], 'value': value, 'baseRevision': base}

    def rows(self):
        with db_engine.session_scope(self.url) as session:
            # Migration rollback assertions also run before namespace columns exist.
            schemas = session.query(models.WorkspaceGroupReviewSchema.group_id,
                models.WorkspaceGroupReviewSchema.schema_revision, models.WorkspaceGroupReviewSchema.columns).all()
            views = session.query(models.GroupSprintReviewView.sprint_id,
                models.GroupSprintReviewView.view_revision, models.GroupSprintReviewView.layouts).all()
            return ([(s.group_id, s.schema_revision, [c['id'] for c in s.columns]) for s in schemas],
                    sorted((v.sprint_id, v.view_revision, v.layouts) for v in views))

    def wait_until_blocked(self, count=1):
        """Wait until `count` other backends wait on a lock while touching the group schema table."""
        deadline = time.monotonic() + 4
        query = text("""
            SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0
              AND query ILIKE '%workspace_group_review_schemas%'
        """)
        while time.monotonic() < deadline:
            with self.admin.connect() as conn:
                if conn.execute(query).scalar() >= count:
                    return
            time.sleep(0.02)
        raise AssertionError('second writer never waited on the group schema row lock')

    def overlap(self, first, second, while_held=None):
        """Run first until it holds the schema row lock, prove second blocks on it, then release."""
        entered, release, results = Event(), Event(), {}

        def run(name, action):
            try:
                results[name] = action()
            except Exception as error:  # noqa: BLE001 - returned to the test for assertion
                results[name] = error

        holder = Thread(target=run, args=('first', first))
        waiter = Thread(target=run, args=('second', second))
        original = review.apply_schema

        def paused(columns, changes, *args):
            if current_thread() is holder:
                entered.set()
                if not release.wait(8):
                    raise AssertionError('holder never released')
            return original(columns, changes, *args)

        with patch.object(review, 'apply_schema', paused):
            holder.start()
            try:
                self.assertTrue(entered.wait(8), 'first writer never reached its locked transaction')
                if while_held is not None:
                    while_held()
                waiter.start()
                self.wait_until_blocked()
            finally:
                release.set()
                holder.join(10)
                if waiter.ident is not None:
                    waiter.join(10)
        self.assertFalse(holder.is_alive() or waiter.is_alive())
        return results['first'], results['second']

    def assert_conflict(self, result, **flags):
        self.assertIsInstance(result, review.ReviewError)
        self.assertEqual((result.code, result.status), ('review_conflict', 409))
        for name, value in flags.items():
            self.assertEqual(result.details[name], value, name)

    # Races
    def planning_actor(self):
        """Receipts reference a real synthetic user, unlike the historical cell fixtures."""
        with db_engine.session_scope(self.url) as session:
            actor = models.User(external_provider='atlassian', external_subject='planning-race-user')
            session.add(actor)
            session.flush()
            actor_id = actor.id
        self.context = replace(self.context, user_id=actor_id)

    def planning_payload(self, **updates):
        milliseconds = int(datetime.now(timezone.utc).timestamp() * 1000)
        operation = str(uuid.UUID(int=(milliseconds << 80) | (7 << 76) | (2 << 62)
                                  | (uuid.uuid4().int & ((1 << 62) - 1))))
        return dict(version=2, groupId='group-x', operationId=operation, initializePlan=True,
                    basePlanRevision=0, baseSchemaRevision=0, baseScopeProof='pg-synthetic-proof',
                    inclusionChanges=[{'issueId': '101', 'included': True, 'baseRevision': 0}], **updates)

    def planning_admission(self, configuration_id=None, revalidate=None):
        return review.PlanningAdmission('pg-synthetic-proof', 'Sprint = 17', 'story',
            configuration_id, None, None, 1,
            {'version': 1, 'groups': [{'id': 'group-x', 'name': 'Platform'}], 'defaultGroupId': 'group-x'},
            revalidate or (lambda session: None))

    def planning_search(self, payload, **kwargs):
        ids = re.search(r'id in \(([0-9,]+)\)', payload['jql']).group(1).split(',')
        return Mock(status_code=200, json=lambda: {'issues': [
            {'id': identity, 'fields': {'issuetype': {'name': 'Story', 'subtask': False}}}
            for identity in ids], 'isLast': True})

    def planning_save(self, payload, *, admission=None, **kwargs):
        return review.save_review(self.context, '17', payload, self.url, self.planning_search,
            planning_admission=admission or self.planning_admission, **kwargs)

    def planning_rows(self):
        with db_engine.session_scope(self.url) as session:
            return (sorted((plan.sprint_id, plan.revision) for plan in session.query(models.GroupSprintPlan)),
                    sorted((entry.issue_id, entry.included, entry.revision)
                           for entry in session.query(models.GroupSprintPlanEntry)),
                    session.query(models.PlanningSaveOperation).count())

    def planning_overlap(self, first, second, while_held=None):
        """Prove v2's waiter blocks on its real workspace advisory fence, before schema locks."""
        entered, release, results = Event(), Event(), {}
        def run(name, action):
            try:
                results[name] = action()
            except Exception as error:  # Returned to the owning test; never printed with connection data.
                results[name] = error
        holder = Thread(target=run, args=('first', first), daemon=True)
        waiter = Thread(target=run, args=('second', second), daemon=True)
        original_locked = review._locked_schema
        def paused(*args, **kwargs):
            row = original_locked(*args, **kwargs)
            if current_thread() is holder:
                entered.set()
                if not release.wait(8):
                    raise AssertionError('planning holder never released')
            return row
        def blocked():
            deadline = time.monotonic() + 4
            query = text("""SELECT count(*) FROM pg_stat_activity
                WHERE datname = current_database() AND pid <> pg_backend_pid()
                  AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0
                  AND query ILIKE '%pg_advisory_xact_lock%'""")
            while time.monotonic() < deadline:
                with self.admin.connect() as conn:
                    if conn.execute(query).scalar() >= 1:
                        return
                time.sleep(0.02)
            raise AssertionError('v2 writer never waited on the PostgreSQL workspace fence')
        with patch.object(review, '_locked_schema', side_effect=paused):
            holder.start()
            try:
                self.assertTrue(entered.wait(8), 'planning writer never acquired its transaction fences')
                if while_held is not None:
                    while_held()
                waiter.start()
                blocked()
            finally:
                release.set()
                holder.join(10)
                if waiter.ident is not None:
                    waiter.join(10)
        self.assertFalse(holder.is_alive() or waiter.is_alive())
        return results['first'], results['second']

    def test_planning_first_initializations_and_disjoint_stale_writers(self):
        self.planning_actor()
        left, right = self.planning_payload(), self.planning_payload()
        right['inclusionChanges'][0]['issueId'] = '102'
        first, second = self.planning_overlap(lambda: self.planning_save(left), lambda: self.planning_save(right))
        self.assertEqual((first['plan']['revision'], second['plan']['revision']), (1, 2))
        self.assertEqual(self.planning_rows(), ([('17', 2)], [('101', True, 1), ('102', True, 1)], 2))

    def test_planning_same_value_writers_converge_without_revision_bump(self):
        self.planning_actor()
        left, right = self.planning_payload(), self.planning_payload()
        first, second = self.planning_overlap(lambda: self.planning_save(left), lambda: self.planning_save(right))
        self.assertEqual((first['plan']['revision'], second['plan']['revision']), (1, 1))
        self.assertEqual(self.planning_rows(), ([('17', 1)], [('101', True, 1)], 2))

    def test_planning_aba_waiter_conflicts_and_rolls_back_disjoint_entry(self):
        self.planning_actor()
        self.planning_save(self.planning_payload())
        remove = self.planning_payload()
        remove['inclusionChanges'][0].update(included=False, baseRevision=1)
        self.planning_save(remove)
        include = self.planning_payload()
        include['inclusionChanges'][0]['baseRevision'] = 2
        stale = self.planning_payload()
        stale['inclusionChanges'] = [{'issueId': '101', 'included': False, 'baseRevision': 0},
                                     {'issueId': '102', 'included': True, 'baseRevision': 0}]
        first, second = self.planning_overlap(lambda: self.planning_save(include), lambda: self.planning_save(stale))
        self.assertEqual(first['plan']['revision'], 3)
        self.assertIsInstance(second, review.ReviewError)
        self.assertEqual((second.code, second.status), ('review_conflict', 409))
        self.assertEqual(second.details['inclusionConflicts'], [{'issueId': '101', 'included': True, 'revision': 3}])
        self.assertEqual(self.planning_rows(), ([('17', 3)], [('101', True, 3)], 3))

    def test_planning_duplicate_operation_waiter_commits_once(self):
        self.planning_actor()
        payload = self.planning_payload()
        first, second = self.planning_overlap(lambda: self.planning_save(payload), lambda: self.planning_save(payload))
        self.assertEqual(second, {**first, 'status': 'committed'})
        self.assertEqual(self.planning_rows(), ([('17', 1)], [('101', True, 1)], 1))

    def test_planning_duplicate_operation_different_hash_waiter_conflicts(self):
        self.planning_actor()
        left = self.planning_payload()
        right = {**left, 'inclusionChanges': [{'issueId': '102', 'included': True, 'baseRevision': 0}]}
        first, second = self.planning_overlap(lambda: self.planning_save(left), lambda: self.planning_save(right))
        self.assertEqual(first['plan']['revision'], 1)
        self.assertIsInstance(second, review.ReviewError)
        self.assertEqual((second.code, second.status), ('operation_id_reused', 409))
        self.assertEqual(self.planning_rows(), ([('17', 1)], [('101', True, 1)], 1))

    def test_planning_ack_failure_rolls_back_all_stores_before_waiter(self):
        self.planning_actor()
        left, right = self.planning_payload(), self.planning_payload()
        left.update(schemaChanges=[{'action': 'add', 'column': self.column}, self.layout()],
                    baseViewRevision=0, cellChanges=[self.cell('101')])
        right['inclusionChanges'][0]['issueId'] = '102'
        def fail(_value):
            raise review.ReviewError('review_response_unavailable', 503, noCommit=True)
        first, second = self.planning_overlap(lambda: self.planning_save(left, prepare_response=fail),
                                              lambda: self.planning_save(right))
        self.assertIsInstance(first, review.ReviewError)
        self.assertEqual(first.code, 'review_response_unavailable')
        self.assertEqual(second['plan']['revision'], 1)
        self.assertEqual(self.planning_rows(), ([('17', 1)], [('102', True, 1)], 1))
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupReviewCell).count(), 0)
            self.assertEqual(session.query(models.GroupSprintReviewView).count(), 0)
        self.assertEqual(self.rows(), ([('group-x', 0, [])], []))

    def test_planning_group_changed_after_authorization_rejects_without_writes(self):
        self.planning_actor()
        search = self.planning_search
        changed = False
        def drift(payload, **kwargs):
            nonlocal changed
            result = search(payload, **kwargs)
            if not changed:
                changed = True
                with db_engine.session_scope(self.url) as session:
                    session.query(models.WorkspaceGroupConfig).filter_by(workspace_id=self.workspace_id).update(
                        {'config_revision': models.WorkspaceGroupConfig.config_revision + 1})
            return result
        with patch.object(self, 'planning_search', side_effect=drift), self.assertRaises(review.ReviewError) as raised:
            self.planning_save(self.planning_payload())
        self.assertEqual(raised.exception.code, 'configuration_scope_changed')
        self.assertEqual(self.planning_rows(), ([], [], 0))
        self.assertEqual(self.rows(), ([], []))

    def test_planning_namespace_writers_share_fence_but_not_plan_entries(self):
        self.planning_actor()
        left, right = self.planning_payload(), self.planning_payload()
        right['configuration'] = {'id': 'delivery-synthetic', 'revision': 1,
                                  'quarter': '2027Q1', 'digest': 'a' * 32}
        first, second = self.planning_overlap(lambda: self.planning_save(left),
            lambda: self.planning_save(right, admission=lambda: self.planning_admission('delivery-synthetic')))
        self.assertEqual((first['plan']['revision'], second['plan']['revision']), (1, 1))
        self.assertEqual(self.planning_rows(), ([('17', 1), ('17', 1)], [('101', True, 1), ('101', True, 1)], 2))
        with db_engine.session_scope(self.url) as session:
            namespaces = session.query(models.WorkspaceGroupReviewSchema.configuration_id).all()
            self.assertCountEqual(namespaces, [(None,), ('delivery-synthetic',)])

    def planning_authority_drift(self, model, row, field, replacement):
        """An independent committed authority change occurs between Jira and write locks."""
        self.planning_actor()
        with db_engine.session_scope(self.url) as session:
            session.add(row)
            session.flush()
            row_id, captured = row.id, getattr(row, field)
        def revalidate(session):
            current = session.get(model, row_id, populate_existing=True)
            if getattr(current, field) != captured:
                raise review.ReviewError('configuration_scope_changed', 409, noCommit=True)
        admission = self.planning_admission(revalidate=revalidate)
        search = self.planning_search
        changed = False
        def drift(payload, **kwargs):
            nonlocal changed
            result = search(payload, **kwargs)
            if not changed:
                changed = True
                with db_engine.session_scope(self.url) as session:
                    setattr(session.get(model, row_id), field, replacement)
            return result
        with patch.object(self, 'planning_search', side_effect=drift), self.assertRaises(review.ReviewError) as raised:
            self.planning_save(self.planning_payload(), admission=lambda: admission)
        self.assertEqual(raised.exception.code, 'configuration_scope_changed')
        self.assertEqual(self.planning_rows(), ([], [], 0))
        self.assertEqual(self.rows(), ([], []))

    def test_planning_configuration_changed_after_authorization_rejects(self):
        self.planning_authority_drift(models.WorkspaceDashboardConfig,
            models.WorkspaceDashboardConfig(workspace_id=self.workspace_id, payload={'board': {'boardId': '17'}},
                                            config_revision=1), 'config_revision', 2)

    def test_planning_board_publication_changed_after_authorization_rejects(self):
        self.planning_authority_drift(models.WorkspaceSprintCatalog,
            models.WorkspaceSprintCatalog(workspace_id=self.workspace_id, board_id='17',
                sprints=[{'id': '17', 'name': 'Synthetic Sprint'}], validated_at=datetime.now(timezone.utc),
                catalog_version=str(uuid.uuid4())), 'catalog_version', str(uuid.uuid4()))

    def test_planning_unchanged_catalog_republication_after_authorization_rejects(self):
        from backend.services.workspace_catalog_cache import ScopedSprintCatalogStore
        from backend.services import workspace_catalog_cache
        self.planning_actor()
        store = ScopedSprintCatalogStore()
        config = SimpleNamespace(sprint_identity='synthetic-source', source_digest='synthetic-digest', configuration_id=None)
        sprints = [{'id': '17', 'name': 'Synthetic Sprint'}]
        def publish(attempt):
            self.assertTrue(store.begin(config.sprint_identity, attempt, workspace_id=self.workspace_id,
                                        config_digest=config.source_digest, force=True))
            self.assertTrue(store.publish(config.sprint_identity, attempt, sprints,
                                         workspace_id=self.workspace_id, source_digest=config.source_digest))
        publish('first')
        proof = store.proof(config, '17')
        admission = replace(self.planning_admission(), source_proof=proof)
        search = self.planning_search
        changed = False
        def republish(payload, **kwargs):
            nonlocal changed
            result = search(payload, **kwargs)
            if not changed:
                changed = True
                publish('second')
            return result
        with patch.object(workspace_catalog_cache, 'SCOPED_SPRINT_CATALOGS', store), \
                patch.object(self, 'planning_search', side_effect=republish), self.assertRaises(review.ReviewError) as raised:
            self.planning_save(self.planning_payload(), admission=lambda: admission)
        self.assertEqual(raised.exception.code, 'configuration_scope_changed')
        self.assertEqual(self.planning_rows(), ([], [], 0))
        self.assertEqual(self.rows(), ([], []))

    def test_planning_deadline_crossing_real_fence_wait_rolls_back_waiter(self):
        self.planning_actor()
        left, right = self.planning_payload(), self.planning_payload()
        right['inclusionChanges'][0]['issueId'] = '102'
        ticks = [0]
        deadline = review.PlanningDeadline(clock=lambda: ticks[0])
        original_locked = review._locked_schema
        calls = []
        def expire_waiter(*args, **kwargs):
            row = original_locked(*args, **kwargs)
            calls.append(current_thread())
            if len(calls) == 2:
                ticks[0] = 31
            return row
        with patch.object(review, '_locked_schema', side_effect=expire_waiter):
            first, second = self.planning_overlap(lambda: self.planning_save(left),
                lambda: self.planning_save(right, deadline=deadline))
        self.assertEqual(first['plan']['revision'], 1)
        self.assertIsInstance(second, review.ReviewError)
        self.assertEqual(second.code, 'planning_deadline_exceeded')
        self.assertEqual(self.planning_rows(), ([('17', 1)], [('101', True, 1)], 1))

    def test_planning_store_guard_outlives_postgresql_commit_and_rollback(self):
        from backend.services.workspace_catalog_cache import ScopedSprintCatalogStore
        from backend.services import workspace_catalog_cache
        self.planning_actor()
        store = ScopedSprintCatalogStore()
        config = SimpleNamespace(sprint_identity='synthetic-source', source_digest='synthetic-digest', configuration_id=None)
        self.assertTrue(store.begin(config.sprint_identity, 'initial', workspace_id=self.workspace_id,
                                    config_digest=config.source_digest))
        self.assertTrue(store.publish(config.sprint_identity, 'initial', [{'id': '17', 'name': 'Synthetic Sprint'}],
                                      workspace_id=self.workspace_id, source_digest=config.source_digest))
        proof = store.proof(config, '17')
        admission = replace(self.planning_admission(), source_proof=proof)
        real_guard, observed = store.proof_guard, []
        @contextlib.contextmanager
        def observing_guard(current_proof, **kwargs):
            with real_guard(current_proof, **kwargs) as matches:
                try:
                    yield matches
                finally:
                    # A separate PG transaction cannot see staged-but-uncommitted rows.
                    self.assertTrue(store._lock.locked())
                    with db_engine.session_scope(self.url) as session:
                        observed.append((session.query(models.PlanningSaveOperation).count(),
                                         session.query(models.GroupSprintPlanEntry).count()))
        def fail(_value):
            raise review.ReviewError('review_response_unavailable', 503, noCommit=True)
        with patch.object(workspace_catalog_cache, 'SCOPED_SPRINT_CATALOGS', store), \
                patch.object(store, 'proof_guard', side_effect=observing_guard):
            self.planning_save(self.planning_payload(), admission=lambda: admission)
            failed = self.planning_payload()
            failed['inclusionChanges'][0]['issueId'] = '102'
            with self.assertRaises(review.ReviewError) as raised:
                self.planning_save(failed, admission=lambda: admission, prepare_response=fail)
            self.assertEqual(raised.exception.code, 'review_response_unavailable')
        self.assertEqual(observed, [(1, 1), (1, 1)])
        self.assertFalse(store._lock.locked())
        self.assertEqual(self.planning_rows(), ([('17', 1)], [('101', True, 1)], 1))

    def test_planning_expiry_crossing_real_lock_wait_cannot_initialize(self):
        self.planning_actor()
        actual = datetime.now(timezone.utc)
        left, right = self.planning_payload(), self.planning_payload()
        left['inclusionChanges'][0]['issueId'] = '102'
        right['inclusionChanges'][0]['issueId'] = '103'
        with patch.object(review, 'datetime') as controlled:
            ticks = [actual]
            controlled.now.side_effect = lambda *_args: ticks[0]
            # The holder commits before the test advances wall time; expiry happens at the waiter's locked-schema boundary.
            original_locked = review._locked_schema
            calls = []
            def expire_waiter(*args, **kwargs):
                row = original_locked(*args, **kwargs)
                calls.append(current_thread())
                if len(calls) == 2:
                    ticks[0] = actual + timedelta(hours=25)
                return row
            with patch.object(review, '_locked_schema', side_effect=expire_waiter):
                first, second = self.planning_overlap(lambda: self.planning_save(left), lambda: self.planning_save(right))
        self.assertEqual(first['plan']['revision'], 1)
        self.assertIsInstance(second, review.ReviewError)
        self.assertEqual(second.code, 'operation_expired')
        self.assertEqual(self.planning_rows(), ([('17', 1)], [('102', True, 1)], 1))

    def test_two_first_creations_of_the_group_schema_row(self):
        other = self.new_column('Other')
        first, second = self.overlap(lambda: self.add(), lambda: self.add(other))
        self.assertEqual(first['schemaRevision'], 1)
        self.assert_conflict(second, schemaConflict=True, viewConflict=False, cellConflicts=[])
        self.assertEqual(second.details['schemaRevision'], 1)
        self.assertEqual(self.rows(), ([('group-x', 1, [self.column['id']])], []))

    def test_two_first_layout_saves_both_create_one_schema_row(self):
        # Layout-only saves are not schema-checked, so both first writers succeed on one row.
        first, second = self.overlap(lambda: self.save(schemas=[self.layout()], base=0, view=0, sprint='17'),
                                     lambda: self.save(schemas=[self.layout(['priority'])], base=0, view=0, sprint='18'))
        self.assertEqual((first['viewRevision'], second['viewRevision']), (1, 1))
        schemas, views = self.rows()
        self.assertEqual(schemas, [('group-x', 0, [])])
        self.assertEqual([(v[0], v[1]) for v in views], [('17', 1), ('18', 1)])

    def test_two_first_view_saves_for_one_sprint(self):
        self.add()
        first, second = self.overlap(lambda: self.save(schemas=[self.layout()], view=0),
                                     lambda: self.save(schemas=[self.layout(['priority'])], view=0))
        self.assertEqual((first['viewRevision'], first['layouts']['story']['order']), (1, ['status']))
        self.assert_conflict(second, schemaConflict=False, viewConflict=True, cellConflicts=[])
        self.assertEqual(self.rows()[1], [('17', 1, {'story': {'order': ['status'], 'hidden': []}})])

    def test_column_add_and_layout_save_both_succeed_in_both_orders(self):
        self.add()
        added = self.new_column('Added')
        first, second = self.overlap(lambda: self.add(added, base=1),
                                     lambda: self.save(schemas=[self.layout()], base=1, view=0, sprint='17'))
        self.assertEqual((first['schemaRevision'], second['viewRevision'], second['schemaRevision']), (2, 1, 2))
        later = self.new_column('Later')
        first, second = self.overlap(lambda: self.save(schemas=[self.layout(['priority'])], base=1, view=0, sprint='18'),
                                     lambda: self.add(later, base=2))
        self.assertEqual((first['viewRevision'], first['schemaRevision'], second['schemaRevision']), (1, 2, 3))
        schemas, views = self.rows()
        self.assertEqual(schemas, [('group-x', 3, [self.column['id'], added['id'], later['id']])])
        self.assertEqual([(v[0], v[1]) for v in views], [('17', 1), ('18', 1)])

    def test_empty_patch_takes_no_for_update_lock(self):
        self.add()
        captured = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, *rest: captured.append(statement)
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            empty = self.save()
            cell = self.save([self.cell('101')])
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        self.assertEqual((empty['schemaRevision'], empty['cells']), (1, []))
        empty_statements, cell_statements = captured[:2], captured[2:]
        self.assertEqual(len(empty_statements), 2, captured)
        self.assertFalse([s for s in empty_statements if 'FOR UPDATE' in s.upper() or s.lstrip().upper().startswith(('INSERT', 'UPDATE'))])
        # The capture does see the row lock the cell save takes.
        self.assertTrue([s for s in cell_statements if 'FOR UPDATE' in s.upper()])
        self.assertEqual(cell['cells'][0]['revision'], 1)
        # While another writer holds the schema row lock, an empty PATCH still completes.
        empties = []
        self.overlap(lambda: self.save([self.cell('102')]), lambda: self.save([self.cell('103')]),
                     while_held=lambda: empties.append(self.save()))
        self.assertEqual(empties[0]['cells'], [])

    def test_disjoint_and_same_cell_races(self):
        self.add()
        first, second = self.overlap(lambda: self.save([self.cell('101')]), lambda: self.save([self.cell('102')]))
        self.assertEqual((first['cells'][0]['revision'], second['cells'][0]['revision']), (1, 1))
        first, second = self.overlap(lambda: self.save([self.cell('101', '2', 1), self.cell('103')]),
                                     lambda: self.save([self.cell('101', '3', 1), self.cell('104')]))
        self.assertEqual(first['cells'][0]['revision'], 2)
        self.assert_conflict(second, schemaConflict=False, viewConflict=False)
        self.assertEqual([(c['issueId'], c['value'], c['revision']) for c in second.details['cellConflicts']], [('101', '2.000', 2)])
        data = review.read_values(self.context, '17', {'groupId': 'group-x', 'issueIds': ['101', '102', '103', '104'], 'rowKind': 'story'},
                                  self.url, self.search)
        self.assertEqual(sorted((c['issueId'], c['value'], c['revision']) for c in data['cells']),
                         [('101', '2.000', 2), ('102', '1.000', 1), ('103', '1.000', 1)])

    # Adoption races (B1, AC 20): the script's table locks against an application writer
    def seed_legacy(self):
        column = {'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': 'Legacy', 'type': 'number',
                  'aggregation': 'sum', 'archived': False, 'order': 0}
        with db_engine.session_scope(self.url) as session:
            legacy = models.WorkspaceSprintReview(workspace_id=self.workspace_id, sprint_id='16', schema_revision=1,
                                                  columns=[column], layouts={'story': {'order': ['status', column['id']], 'hidden': []}})
            session.add(legacy)
            session.flush()
            session.add(models.SprintReviewCell(review_id=legacy.id, issue_id='201', row_kind='story',
                                                column_id=column['id'], value='1.000', revision=1))
        env = patch.dict(os.environ, {'DATABASE_URL': self.url})
        env.start()
        self.addCleanup(env.stop)
        return column['id']

    def legacy_rows(self):
        with db_engine.session_scope(self.url) as session:
            return (sorted((r.id, r.sprint_id, r.schema_revision, repr(r.columns), repr(r.layouts))
                           for r in session.query(models.WorkspaceSprintReview).all()),
                    sorted((c.id, c.issue_id, c.column_id, c.value, c.revision) for c in session.query(models.SprintReviewCell).all()))

    def adopt(self, *args):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            code = adopt.main(['--workspace-id', self.workspace_id, *args])
        return code, output.getvalue()

    def adoption_digest(self):
        code, output = self.adopt()
        self.assertEqual(code, 0)
        return next(token for token in output.split() if token.startswith('sha256:'))

    @contextlib.contextmanager
    def held_writer(self, action, hold=15):
        """Run an application writer until it holds the schema row lock inside its transaction."""
        entered, release, results = Event(), Event(), {}

        def run():
            try:
                results['value'] = action()
            except Exception as error:  # noqa: BLE001 - returned to the test for assertion
                results['value'] = error

        holder = Thread(target=run)
        original = review.apply_schema

        def paused(columns, changes, *args):
            if current_thread() is holder:
                entered.set()
                if not release.wait(hold):
                    raise AssertionError('holder never released')
            return original(columns, changes, *args)

        with patch.object(review, 'apply_schema', paused):
            holder.start()
            try:
                self.assertTrue(entered.wait(8), 'writer never reached its locked transaction')
                yield results
            finally:
                release.set()
                holder.join(10)
        self.assertFalse(holder.is_alive())

    def test_adoption_refuses_with_zero_writes_after_an_open_writer_commits(self):
        self.seed_legacy()
        digest, legacy = self.adoption_digest(), self.legacy_rows()
        first, second = self.overlap(lambda: self.add(), lambda: self.adopt('--apply', '--expected-sha256', digest))
        self.assertEqual(first['schemaRevision'], 1)
        self.assertIsInstance(second, ValueError)
        self.assertIn('already exist', str(second))
        self.assertEqual(self.rows(), ([('group-x', 1, [self.column['id']])], []))
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_review_cells')).scalar(), 0)
        self.assertEqual(self.legacy_rows(), legacy)

    def test_writer_blocks_on_adoption_locks_then_sees_the_adopted_rows(self):
        legacy_column = self.seed_legacy()
        digest = self.adoption_digest()
        entered, release, results = Event(), Event(), {}

        def paused(_session):
            entered.set()
            if not release.wait(8):
                raise AssertionError('script never released')

        def run(name, action):
            try:
                results[name] = action()
            except Exception as error:  # noqa: BLE001 - returned to the test for assertion
                results[name] = error

        script = Thread(target=run, args=('script', lambda: self.adopt('--apply', '--expected-sha256', digest)))
        writer = Thread(target=run, args=('writer', lambda: self.save(schemas=[self.layout()], base=0, view=0, sprint='40')))
        with patch.object(adopt, '_before_write', paused):
            script.start()
            try:
                self.assertTrue(entered.wait(8), 'script never reached its locked transaction')
                writer.start()
                self.wait_until_blocked()
                self.assertNotIn('writer', results)
            finally:
                release.set()
                script.join(10)
                if writer.ident is not None:
                    writer.join(10)
        self.assertFalse(script.is_alive() or writer.is_alive())
        self.assertEqual(results['script'][0], 0)
        saved = results['writer']
        self.assertNotIsInstance(saved, Exception)
        self.assertEqual(([c['id'] for c in saved['columns']], saved['schemaRevision'], saved['viewRevision']),
                         ([legacy_column], 1, 1))
        schemas, views = self.rows()
        self.assertEqual(schemas, [('group-x', 1, [legacy_column])])
        self.assertEqual([(v[0], v[1]) for v in views], [('16', 1), ('40', 1)])

    def test_writer_holding_past_lock_timeout_makes_adoption_exit_2(self):
        self.seed_legacy()
        digest = self.adoption_digest()
        with self.held_writer(self.add) as held:
            started = time.monotonic()
            code, _ = self.adopt('--apply', '--expected-sha256', digest)
            elapsed = time.monotonic() - started
        self.assertEqual(code, 2)
        self.assertGreaterEqual(elapsed, 4.5)
        self.assertLess(elapsed, 12)
        self.assertEqual(held['value']['schemaRevision'], 1)
        self.assertEqual(self.rows(), ([('group-x', 1, [self.column['id']])], []))

    # Merge-mode races (#299): per-group schema row locks against application writers
    def merge_digest(self):
        code, output = self.adopt('--merge')
        self.assertEqual(code, 0)
        return next(token for token in output.split() if token.startswith('sha256:'))

    def test_merge_holds_the_group_schema_lock_and_a_writer_then_sees_the_merged_rows(self):
        legacy_column = self.seed_legacy()
        digest = self.merge_digest()
        entered, release, results = Event(), Event(), {}

        def paused(_session):
            entered.set()
            if not release.wait(8):
                raise AssertionError('script never released')

        def run(name, action):
            try:
                results[name] = action()
            except Exception as error:  # noqa: BLE001 - returned to the test for assertion
                results[name] = error

        script = Thread(target=run, args=('script', lambda: self.adopt('--merge', '--apply', '--expected-sha256', digest)))
        writer = Thread(target=run, args=('writer', lambda: self.save(schemas=[self.layout()], base=0, view=0, sprint='40')))
        with patch.object(adopt, '_before_write', paused):
            script.start()
            try:
                self.assertTrue(entered.wait(8), 'merge never reached its locked transaction')
                writer.start()
                self.wait_until_blocked()
                self.assertNotIn('writer', results)
            finally:
                release.set()
                script.join(10)
                if writer.ident is not None:
                    writer.join(10)
        self.assertFalse(script.is_alive() or writer.is_alive())
        self.assertEqual(results['script'][0], 0)
        saved = results['writer']
        self.assertNotIsInstance(saved, Exception)
        self.assertEqual(([c['id'] for c in saved['columns']], saved['schemaRevision'], saved['viewRevision']),
                         ([legacy_column], 1, 1))
        schemas, views = self.rows()
        self.assertEqual(schemas, [('group-x', 1, [legacy_column])])
        self.assertEqual([(v[0], v[1]) for v in views], [('16', 1), ('40', 1)])

    def test_writer_holding_the_schema_lock_past_lock_timeout_makes_merge_exit_2_with_zero_writes(self):
        self.seed_legacy()
        self.add()
        digest = self.merge_digest()
        other = self.new_column('Other')
        with self.held_writer(lambda: self.save(schemas=[{'action': 'add', 'column': other}], base=1)) as held:
            started = time.monotonic()
            code, _ = self.adopt('--merge', '--apply', '--expected-sha256', digest)
            elapsed = time.monotonic() - started
        self.assertEqual(code, 2)
        self.assertGreaterEqual(elapsed, 4.5)
        self.assertLess(elapsed, 12)
        self.assertEqual(held['value']['schemaRevision'], 2)
        self.assertEqual(self.rows(), ([('group-x', 2, [self.column['id'], other['id']])], []))
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_review_cells')).scalar(), 0)

    def test_merge_takes_no_exclusive_lock_on_the_group_tables(self):
        self.seed_legacy()
        digest = self.merge_digest()
        modes = {}

        def inspect_locks(session):
            rows = session.execute(text("""
                SELECT c.relname, l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                WHERE l.pid = pg_backend_pid() AND c.relname = ANY(:tables)
            """), {'tables': list(GROUP_TABLES + LEGACY_TABLES)}).all()
            for name, mode in rows:
                modes.setdefault(name, set()).add(mode)
        with patch.object(adopt, '_before_write', inspect_locks):
            self.assertEqual(self.adopt('--merge', '--apply', '--expected-sha256', digest)[0], 0)
        strong = {'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock', 'ShareUpdateExclusiveLock'}
        for table in GROUP_TABLES:
            self.assertFalse(modes.get(table, set()) & strong, table)
        for table in LEGACY_TABLES:
            self.assertIn('ShareLock', modes[table])
        self.assertIn('RowShareLock', modes['workspace_group_review_schemas'])  # SELECT ... FOR UPDATE on the schema row

    def test_merge_holds_the_first_group_lock_while_waiting_on_a_second_held_by_a_writer(self):
        with db_engine.session_scope(self.url) as session:
            config = session.query(models.WorkspaceGroupConfig).filter_by(workspace_id=self.workspace_id).one()
            config.payload = {'version': 1, 'defaultGroupId': 'group-x',
                              'groups': [{'id': 'group-x', 'name': 'Platform'}, {'id': 'group-y', 'name': 'Payments'}]}
        self.seed_legacy()
        digest = self.merge_digest()
        other = self.new_column('Other')
        hold_group_y = lambda: review.save_review(self.context, '17', {  # noqa: E731
            'groupId': 'group-y', 'baseSchemaRevision': 0, 'schemaChanges': [{'action': 'add', 'column': other}], 'cellChanges': []},
            self.url, self.search)
        results = {}

        def run(name, action):
            try:
                results[name] = action()
            except Exception as error:  # noqa: BLE001 - returned to the test for assertion
                results[name] = error

        merge = Thread(target=run, args=('merge', lambda: self.adopt('--merge', '--apply', '--expected-sha256', digest)))
        writer = Thread(target=run, args=('writer', lambda: self.save(schemas=[self.layout()], base=0, view=0, sprint='40')))
        # Both waits must be seen inside the merge's 5 s lock timeout; the writer starts waiting after the merge, so its own 5 s
        # timeout (set in the test URL) outlasts it and it proceeds once the merge rolls back.
        with self.held_writer(hold_group_y) as held:
            merge.start()
            try:
                self.wait_until_blocked(1)  # the merge holds group-x and waits for group-y's row
                writer.start()
                self.wait_until_blocked(2)  # a group-x writer now waits for the merge
                self.assertNotIn('writer', results)
            finally:
                merge.join(15)
                if writer.ident is not None:
                    writer.join(15)
        self.assertFalse(merge.is_alive() or writer.is_alive())
        self.assertEqual(results['merge'][0], 2)  # timed out waiting for group-y; nothing written, nothing deadlocked
        self.assertNotIsInstance(results['writer'], Exception)
        self.assertEqual(held['value']['schemaRevision'], 1)
        schemas, views = self.rows()
        self.assertEqual(sorted(schemas), [('group-x', 0, []), ('group-y', 1, [other['id']])])
        self.assertEqual([(v[0], v[1]) for v in views], [('40', 1)])  # the writer's own view; no merged Sprint 16 view
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_review_cells')).scalar(), 0)

    def test_a_writer_committing_between_the_phases_aborts_the_merge_with_zero_writes(self):
        self.seed_legacy()
        digest = self.merge_digest()
        legacy = self.legacy_rows()
        with patch.object(adopt, '_before_lock', lambda: self.add()):  # an application save commits after the plan
            with self.assertRaisesRegex(ValueError, 'data changed since the dry run'):
                self.adopt('--merge', '--apply', '--expected-sha256', digest)
        self.assertEqual(self.rows(), ([('group-x', 1, [self.column['id']])], []))  # only the writer's column, nothing merged
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_review_cells')).scalar(), 0)
        self.assertEqual(self.legacy_rows(), legacy)

    # Migration
    def test_model_database_parity(self):
        insp = inspect(db_engine.get_engine(self.url))
        for name in GROUP_TABLES + LEGACY_TABLES + SHARED_PLAN_TABLES:
            with self.subTest(table=name):
                table = models.Base.metadata.tables[name]
                columns = {c['name']: c for c in insp.get_columns(name)}
                self.assertEqual(set(columns), set(table.columns.keys()))
                for column in table.columns:
                    self.assertEqual(columns[column.name]['nullable'], column.nullable, column.name)
                self.assertEqual({u['name']: tuple(u['column_names']) for u in insp.get_unique_constraints(name)},
                                 {c.name: tuple(col.name for col in c.columns) for c in table.constraints
                                  if c.__class__.__name__ == 'UniqueConstraint'})
                self.assertEqual({c['name'] for c in insp.get_check_constraints(name)},
                                 {c.name for c in table.constraints if c.__class__.__name__ == 'CheckConstraint'})
                self.assertEqual({(tuple(f['constrained_columns']), f['referred_table'], f['options'].get('ondelete'))
                                  for f in insp.get_foreign_keys(name)},
                                 {(tuple(c.parent.name for c in f.elements), f.elements[0].column.table.name, f.ondelete)
                                  for f in table.foreign_key_constraints})
                self.assertEqual({i['name']: tuple(i['column_names']) for i in insp.get_indexes(name) if not i.get('duplicates_constraint')},
                                 {i.name: tuple(c.name for c in i.columns) for i in table.indexes})
        self.assertEqual({f['options'].get('ondelete') for t in GROUP_TABLES for f in insp.get_foreign_keys(t)}, {'CASCADE'})
        self.assertEqual({i['name']: tuple(i['column_names']) for i in insp.get_indexes('group_sprint_review_views')
                          if not i.get('duplicates_constraint')},
                         {'ix_group_sprint_review_views_order': ('workspace_id', 'group_id', 'sprint_order'),
                          'uq_group_sprint_review_view_legacy': ('workspace_id', 'group_id', 'sprint_id'),
                          'uq_group_sprint_review_view_configuration': ('workspace_id', 'group_id', 'sprint_id', 'configuration_id'),
                          'ix_group_sprint_review_views_quarter': ('workspace_id', 'group_id', 'configuration_id', 'quarter_ordinal')})

    def test_check_constraints_and_cascade_are_enforced(self):
        from sqlalchemy.exc import IntegrityError
        self.add()
        self.save([self.cell('101')])
        self.save(schemas=[self.layout()], view=0)
        for statement in ("UPDATE workspace_group_review_schemas SET schema_revision = -1",
                          "UPDATE group_review_cells SET row_kind = 'task'",
                          "UPDATE group_review_cells SET revision = 0",
                          "UPDATE group_sprint_review_views SET sprint_order = '17'",
                          "UPDATE group_sprint_review_views SET view_revision = 0"):
            with self.subTest(statement=statement), self.assertRaises(IntegrityError):
                with db_engine.session_scope(self.url) as session:
                    session.execute(text(statement))
        with db_engine.session_scope(self.url) as session:
            session.execute(text('DELETE FROM workspace_group_review_schemas'))
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_review_cells')).scalar(), 0)
        with db_engine.session_scope(self.url) as session:
            session.execute(text('DELETE FROM workspaces WHERE id = :w'), {'w': self.workspace_id})
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_sprint_review_views')).scalar(), 0)

    def test_downgrade_drops_only_the_group_tables_and_legacy_rows_survive(self):
        with db_engine.session_scope(self.url) as session:
            legacy = models.WorkspaceSprintReview(workspace_id=self.workspace_id, sprint_id='17', schema_revision=3,
                                                  columns=[{'id': 'synthetic'}], layouts={'story': {'order': [], 'hidden': []}})
            session.add(legacy)
            session.flush()
            session.add(models.SprintReviewCell(review_id=legacy.id, issue_id='101', row_kind='story', column_id='synthetic', value='v', revision=2))
            legacy_id = legacy.id
        self.add()
        self.save([self.cell('101')])
        self.save(schemas=[self.layout()], view=0)

        def legacy_rows():
            with db_engine.session_scope(self.url) as session:
                row = session.get(models.WorkspaceSprintReview, legacy_id)
                cell = session.query(models.SprintReviewCell).filter_by(review_id=legacy_id).one()
                return (row.sprint_id, row.schema_revision, row.columns, row.layouts, cell.issue_id, cell.value, cell.revision)

        expected = legacy_rows()
        engine = db_engine.get_engine(self.url)
        before = set(inspect(engine).get_table_names())
        self.assertTrue(set(GROUP_TABLES) <= before)
        command.downgrade(self.config, '20261001_0018')
        after = set(inspect(engine).get_table_names())
        # Downgrading below 0019 also removes the later capacity, shared-plan and CSRF token tables.
        dropped = set(GROUP_TABLES + SHARED_PLAN_TABLES) | {'planning_team_sprint_capacity', 'browser_csrf_tokens'}
        self.assertEqual(before - after, dropped)
        self.assertEqual(after, before - dropped)
        self.assertEqual(legacy_rows(), expected)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text('SELECT version_num FROM alembic_version')).scalar(), '20261001_0018')
        command.upgrade(self.config, 'head')
        self.assertEqual(set(inspect(engine).get_table_names()), before)
        self.assertEqual(legacy_rows(), expected)
        self.assertEqual(self.rows(), ([], []))

    # Isolated review namespaces (revision 20261030_0022). Opt-in: needs the approved disposable PostgreSQL target.
    CFG = 'cfg-2027q1'
    TYPE_MAP = {'epic': ('10001', 1), 'initiative': ('10002', 2)}

    def search_typed(self, payload, **kwargs):
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')
        level = lambda i: ('10002', 2) if i.startswith('9') else ('10001', 1)
        return Mock(status_code=200, json=lambda: {'issues': [
            {'id': i, 'fields': {'issuetype': {'id': level(i)[0], 'name': 'X', 'hierarchyLevel': level(i)[1], 'subtask': False}}}
            for i in ids], 'isLast': True})

    def nsave(self, schemas=None, cells=None, base=0, sprint='17', view=None, cfg=None, ordinal=8104):
        payload = {'groupId': 'group-x', 'baseSchemaRevision': base, 'schemaChanges': schemas or [], 'cellChanges': cells or []}
        if view is not None:
            payload['baseViewRevision'] = view
        return review.save_review(self.context, sprint, payload, self.url, self.search_typed, configuration_id=cfg or self.CFG,
                                  quarter_ordinal=ordinal, type_map=self.TYPE_MAP)

    def epic_column(self, label='Child'):
        return {'id': str(uuid.uuid4()), 'rowKind': 'epic', 'label': label, 'type': 'number', 'aggregation': 'sum'}

    def namespace_rows(self):
        with db_engine.session_scope(self.url) as session:
            return sorted((s.configuration_id or '', s.schema_revision, len(s.columns))
                          for s in session.query(models.WorkspaceGroupReviewSchema).all())

    def seed_definitions(self, count):
        """A committed Legacy schema row holding `count` archived definitions (the fence row)."""
        archived = [{'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': f'Old{n}', 'type': 'number', 'aggregation': 'sum',
                     'archived': True, 'order': n, 'after': None} for n in range(count)]
        with db_engine.session_scope(self.url) as session:
            session.add(models.WorkspaceGroupReviewSchema(workspace_id=self.workspace_id, group_id='group-x', schema_revision=1, columns=archived))

    def test_two_first_creates_in_different_namespaces_serialize_on_the_fence_without_deadlock(self):
        legacy, quarterly = self.new_column('Legacy'), self.epic_column()
        first, second = self.overlap(lambda: self.add(legacy),
                                     lambda: self.nsave([{'action': 'add', 'column': quarterly}]))
        self.assertNotIsInstance(first, Exception)
        self.assertNotIsInstance(second, Exception, second)
        self.assertEqual(self.namespace_rows(), [('', 1, 1), (self.CFG, 1, 1)])

    def test_a_namespace_writer_blocks_a_legacy_writer_in_the_same_order_and_both_commit(self):
        legacy, quarterly = self.new_column('Legacy'), self.epic_column()
        first, second = self.overlap(lambda: self.nsave([{'action': 'add', 'column': quarterly}]), lambda: self.add(legacy))
        self.assertNotIsInstance(first, Exception, first)
        self.assertNotIsInstance(second, Exception, second)
        self.assertEqual(self.namespace_rows(), [('', 1, 1), (self.CFG, 1, 1)])

    def test_the_group_definition_cap_holds_across_namespaces_under_a_race(self):
        self.seed_definitions(239)
        first, second = self.overlap(lambda: self.nsave([{'action': 'add', 'column': self.epic_column('A')}]),
                                     lambda: self.save(schemas=[{'action': 'add', 'column': self.new_column('B')}], base=1))
        outcomes = [first, second]
        self.assertEqual(sum(isinstance(o, review.ReviewError) and o.code == 'review_schema_limit' for o in outcomes), 1, outcomes)
        self.assertEqual(sum(not isinstance(o, Exception) for o in outcomes), 1, outcomes)
        self.assertEqual(sum(count for _, _, count in self.namespace_rows()), 240)

    def test_the_view_cap_holds_across_namespaces_under_a_race(self):
        with db_engine.session_scope(self.url) as session:
            for n in range(499):
                cfg = None if n % 2 else self.CFG
                session.add(models.GroupSprintReviewView(workspace_id=self.workspace_id, group_id='group-x', sprint_id=str(1000 + n),
                                                         configuration_id=cfg, quarter_ordinal=None if cfg is None else 8104,
                                                         sprint_order=review.sprint_order(str(1000 + n)), layouts={}, view_revision=1))
        layout = {'action': 'layout', 'rowKind': 'epic', 'order': ['status'], 'hidden': []}
        first, second = self.overlap(lambda: self.nsave([layout], view=0, sprint='5000'),
                                     lambda: self.save(schemas=[self.layout()], base=0, view=0, sprint='5001'))
        outcomes = [first, second]
        self.assertEqual(sum(isinstance(o, review.ReviewError) and o.code == 'review_view_limit' for o in outcomes), 1, outcomes)
        self.assertEqual(sum(not isinstance(o, Exception) for o in outcomes), 1, outcomes)
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintReviewView).count(), 500)

    def test_a_changed_remote_revision_conflicts_within_the_namespace_only(self):
        column = self.epic_column()
        self.nsave([{'action': 'add', 'column': column}])
        first, second = self.overlap(lambda: self.nsave([{'action': 'rename', 'columnId': column['id'], 'label': 'One'}], base=1),
                                     lambda: self.nsave([{'action': 'rename', 'columnId': column['id'], 'label': 'Two'}], base=1))
        self.assertEqual(first['schemaRevision'], 2)
        self.assert_conflict(second, schemaConflict=True, viewConflict=False, cellConflicts=[])
        self.assertEqual(self.add()['schemaRevision'], 1)

    def test_the_partial_unique_indexes_hold_on_postgresql(self):
        from sqlalchemy.exc import IntegrityError
        self.add()
        self.nsave([{'action': 'add', 'column': self.epic_column()}])
        for cfg in (None, self.CFG):
            with self.subTest(cfg=cfg), self.assertRaises(IntegrityError), db_engine.session_scope(self.url) as session:
                session.add(models.WorkspaceGroupReviewSchema(workspace_id=self.workspace_id, group_id='group-x',
                                                              configuration_id=cfg, schema_revision=0, columns=[]))
                session.flush()

    def test_the_namespace_migration_retains_legacy_rows_and_downgrade_refuses_new_data(self):
        self.add()
        self.save([self.cell('101')])
        self.save(schemas=[self.layout()], view=0)
        legacy_before = self.rows()
        engine = db_engine.get_engine(self.url)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text('SELECT count(*) FROM workspace_group_review_schemas WHERE configuration_id IS NOT NULL')).scalar(), 0)
        self.nsave([{'action': 'add', 'column': self.epic_column()}])
        def shape():
            with db_engine.get_engine(self.url).connect() as conn:
                return sorted(r[0] for r in conn.execute(text(
                    "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename LIKE '%review%'")).all())
        indexes = shape()
        with self.assertRaisesRegex(RuntimeError, 'Refusing to downgrade'):
            command.downgrade(self.config, '20261028_0021')
        self.assertEqual(self.stamped(), HEAD_REVISION)
        self.assertEqual(shape(), indexes)
        with db_engine.session_scope(self.url) as session:
            session.execute(text('DELETE FROM workspace_group_review_schemas WHERE configuration_id IS NOT NULL'))
        command.downgrade(self.config, '20261028_0021')
        self.assertEqual(self.rows(), legacy_before)
        command.upgrade(self.config, 'head')
        self.assertEqual(self.rows(), legacy_before)

    # Automatic adoption on upgrade (revision 20261023_0020)
    def revision_module(self):
        spec = importlib.util.spec_from_file_location('adopt_revision_0020_pg', REVISION_FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def rewind(self):
        """Un-stamp the adoption revision (its downgrade is a no-op) so the next upgrade runs it."""
        command.downgrade(self.config, PARENT_REVISION)

    def stamped(self):
        with db_engine.get_engine(self.url).connect() as conn:
            return conn.execute(text('SELECT version_num FROM alembic_version')).scalar()

    def legacy_column(self, label='Estimate', archived=False):
        return {'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': label, 'type': 'number', 'aggregation': 'sum',
                'archived': archived, 'order': 0}

    def seed_review_legacy(self, workspace_id=None, column=None, sprint='17', plain=False):
        column = column or self.legacy_column()
        with db_engine.session_scope(self.url) as session:
            row = models.WorkspaceSprintReview(
                workspace_id=workspace_id or self.workspace_id, sprint_id=sprint, schema_revision=1, columns=[column],
                layouts={} if plain else {'story': {'order': ['status', column['id']], 'hidden': []}})
            session.add(row)
            session.flush()
            if not plain:
                session.add(models.SprintReviewCell(review_id=row.id, issue_id='101', row_kind='story', column_id=column['id'],
                                                    value='1.000', revision=1))
        return column

    def hold_group_row(self, workspace_id=None, group='group-x'):
        """An open transaction that inserted the group's schema row and has not committed: a writer holding its lock."""
        conn = db_engine.get_engine(self.url).connect()
        transaction = conn.begin()
        conn.execute(text("INSERT INTO workspace_group_review_schemas (id, workspace_id, group_id, schema_revision, columns) "
                          "VALUES (:id, :w, :g, 0, '[]')"), {'id': str(uuid.uuid4()), 'w': workspace_id or self.workspace_id, 'g': group})
        return conn, transaction

    def test_upgrade_adopts_on_postgresql_and_the_app_reads_it_back(self):
        self.rewind()
        column = self.seed_review_legacy()
        command.upgrade(self.config, 'head')
        self.assertEqual(self.stamped(), HEAD_REVISION)
        self.assertEqual(self.rows(), ([('group-x', 1, [column['id']])],
                                       [('17', 1, {'story': {'order': ['status', column['id']], 'hidden': []}})]))
        loaded = review.load_review(self.context, '17', 'group-x', self.url)
        self.assertEqual([c['id'] for c in loaded['columns']], [column['id']])
        values = review.read_values(self.context, '17', {'groupId': 'group-x', 'issueIds': ['101'], 'rowKind': 'story'},
                                    self.url, self.search)
        self.assertEqual([(c['issueId'], c['value'], c['revision']) for c in values['cells']], [('101', '1.000', 1)])

    def test_a_lock_timeout_fails_the_upgrade_unstamped_and_a_rerun_succeeds(self):
        self.rewind()
        self.seed_review_legacy()
        conn, transaction = self.hold_group_row()
        try:
            with self.assertRaisesRegex(Exception, 'database error 55P03') as caught:
                command.upgrade(self.config, 'head')
            self.assertIsNone(caught.exception.__cause__)
            self.assertIsNone(caught.exception.__context__)
        finally:
            transaction.rollback()
            conn.close()
        self.assertEqual(self.stamped(), PARENT_REVISION)
        self.assertEqual(self.rows(), ([], []))
        command.upgrade(self.config, 'head')
        self.assertEqual(self.stamped(), HEAD_REVISION)
        self.assertEqual(len(self.rows()[0]), 1)

    def test_a_later_workspace_failure_rolls_back_the_earlier_workspace(self):
        first, second = 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'
        with db_engine.session_scope(self.url) as session:
            for identity in (first, second):
                session.add(models.Workspace(id=identity, environment_key='order-' + identity, name='Synthetic'))
                session.flush()
                session.add(models.WorkspaceGroupConfig(workspace_id=identity, payload={
                    'version': 1, 'groups': [{'id': 'group-x', 'name': 'Platform'}], 'defaultGroupId': 'group-x'}))
        self.rewind()
        self.seed_review_legacy(workspace_id=first)
        self.seed_review_legacy(workspace_id=second)
        conn, transaction = self.hold_group_row(second)
        try:
            with self.assertRaisesRegex(Exception, 'database error 55P03'):
                command.upgrade(self.config, 'head')
        finally:
            transaction.rollback()
            conn.close()
        self.assertEqual(self.stamped(), PARENT_REVISION)
        with db_engine.session_scope(self.url) as session:  # the first workspace's adoption was rolled back with the failure
            self.assertEqual(session.execute(text('SELECT count(*) FROM workspace_group_review_schemas')).scalar(), 0)
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_sprint_review_views')).scalar(), 0)
        command.upgrade(self.config, 'head')
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(sorted(row.workspace_id for row in session.query(models.WorkspaceGroupReviewSchema).all()),
                             [first, second])

    def test_a_group_that_gains_rows_while_the_step_waits_is_left_untouched(self):
        self.rewind()
        self.seed_review_legacy()
        conn, transaction = self.hold_group_row()
        outcome = {}

        def upgrade():
            try:
                command.upgrade(self.config, 'head')
                outcome['result'] = 'ok'
            except Exception as error:  # noqa: BLE001 - returned to the test for assertion
                outcome['result'] = error

        thread = Thread(target=upgrade)
        thread.start()
        try:
            self.wait_until_blocked()
            live = self.new_column('Live')
            live.update(archived=False, order=0, after=None)
            conn.execute(text('UPDATE workspace_group_review_schemas SET schema_revision = 3, columns = CAST(:c AS json) '
                              'WHERE group_id = :g'), {'c': __import__('json').dumps([live]), 'g': 'group-x'})
            transaction.commit()
        finally:
            conn.close()
            thread.join(30)
        self.assertFalse(thread.is_alive())
        self.assertEqual(outcome['result'], 'ok')
        self.assertEqual(self.rows(), ([('group-x', 3, [live['id']])], []))
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_review_cells')).scalar(), 0)

    def test_session_timeouts_are_restored_inside_the_transaction_and_set_for_the_step(self):
        self.rewind()  # Exercise the adoption revision against its historical input schema.
        revision = self.revision_module()
        self.seed_review_legacy()
        seen = {}
        original = revision._lock_legacy

        def watching(connection):
            seen['lock_timeout'] = connection.execute(text('SHOW lock_timeout')).scalar()
            seen['statement_timeout'] = connection.execute(text('SHOW statement_timeout')).scalar()
            original(connection)

        with db_engine.get_engine(self.url).begin() as conn:
            conn.execute(text("SET LOCAL lock_timeout = '7s'"))
            conn.execute(text("SET LOCAL statement_timeout = '33s'"))
            with patch.object(revision, '_lock_legacy', watching):
                summary = revision.adopt_all(conn)
            self.assertEqual(conn.execute(text('SHOW lock_timeout')).scalar(), '7s')
            self.assertEqual(conn.execute(text('SHOW statement_timeout')).scalar(), '33s')
        self.assertEqual(seen, {'lock_timeout': '5s', 'statement_timeout': '1min'})
        self.assertEqual(summary['adopted'], {self.workspace_id: ['group-x']})

    def test_a_group_with_an_empty_plan_is_never_locked_and_leaves_no_row(self):
        self.rewind()
        self.seed_review_legacy(column=self.legacy_column(archived=True), plain=True)  # an archive intent plans nothing
        command.upgrade(self.config, 'head')
        self.assertEqual(self.stamped(), HEAD_REVISION)
        self.assertEqual(self.rows(), ([], []))

    def test_the_revision_takes_the_same_schema_row_lock_as_the_app(self):
        self.rewind()
        revision = self.revision_module()
        engine = db_engine.get_engine(self.url)
        statements = []

        def capture(connection, cursor, statement, parameters, context, executemany):
            statements.append(' '.join(statement.lower().split()))

        event.listen(engine, 'before_cursor_execute', capture)
        try:
            with engine.begin() as conn:
                historical_row = revision._locked_schema(conn, self.workspace_id, 'lock-proof-group')
            ours = list(statements)
            command.upgrade(self.config, 'head')
            del statements[:]
            with db_engine.session_scope(self.url) as session:
                current_row = review._locked_schema(session, self.context, 'lock-proof-group')
                current_id = current_row.id
            app = list(statements)
        finally:
            event.remove(engine, 'before_cursor_execute', capture)

        def shape(items):
            insert = next(s for s in items if s.startswith('insert into workspace_group_review_schemas'))
            select = next(s for s in items if s.startswith('select') and 'for update' in s)
            return (insert.split(' on conflict ', 1)[1].split(' returning')[0], 'from workspace_group_review_schemas' in select,
                    'workspace_group_review_schemas.workspace_id = %(' in select.replace('$1', '%(')
                    or 'workspace_id = ' in select, select.endswith('for update'))

        # Namespace migration changes the unique arbiter, while retaining the
        # same physical NULL-Legacy group row as the current app's common fence.
        self.assertEqual(str(historical_row.id), str(current_id))
        self.assertEqual(shape(ours)[1:], shape(app)[1:])
        self.assertEqual(shape(ours), ('(workspace_id, group_id) do nothing', True, True, True))
        self.assertEqual(shape(app), ('do nothing', True, True, True))
        self.assertTrue(any('configuration_id is null' in statement for statement in app))

    def test_a_well_formed_downgrade_below_the_group_tables_adopts_again(self):
        column = self.seed_review_legacy()
        command.downgrade(self.config, '20261001_0018')
        command.upgrade(self.config, 'head')
        self.assertEqual(self.rows()[0], [('group-x', 1, [column['id']])])
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.WorkspaceSprintReview).count(), 1)
            self.assertEqual(session.query(models.SprintReviewCell).count(), 1)

