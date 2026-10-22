"""Opt-in PostgreSQL race and migration evidence for Department-group reviews (#267).

Requires an explicitly approved disposable TEST_DATABASE_URL. Every test owns an
isolated schema; no configured application schema or production migration is used.

Races are deterministic: the first writer pauses inside its transaction while it
holds the group schema row lock, the test proves the second writer is waiting on a
PostgreSQL lock, and only then releases the first writer.
"""
import contextlib
import io
import os
from threading import Event, Thread, current_thread
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
            schemas = session.query(models.WorkspaceGroupReviewSchema).all()
            return ([(s.group_id, s.schema_revision, [c['id'] for c in s.columns]) for s in schemas],
                    sorted((v.sprint_id, v.view_revision, v.layouts) for v in session.query(models.GroupSprintReviewView).all()))

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

        def paused(columns, changes):
            if current_thread() is holder:
                entered.set()
                if not release.wait(8):
                    raise AssertionError('holder never released')
            return original(columns, changes)

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
        # The capture does see the lock PostgreSQL keeps (SQLite drops the clause).
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

        def paused(columns, changes):
            if current_thread() is holder:
                entered.set()
                if not release.wait(hold):
                    raise AssertionError('holder never released')
            return original(columns, changes)

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

    # Migration
    def test_model_database_parity(self):
        insp = inspect(db_engine.get_engine(self.url))
        for name in GROUP_TABLES + LEGACY_TABLES:
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
                         {'ix_group_sprint_review_views_order': ('workspace_id', 'group_id', 'sprint_order')})

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
        self.assertEqual(before - after, set(GROUP_TABLES))
        self.assertEqual(after, before - set(GROUP_TABLES))
        self.assertEqual(legacy_rows(), expected)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text('SELECT version_num FROM alembic_version')).scalar(), '20261001_0018')
        command.upgrade(self.config, 'head')
        self.assertEqual(set(inspect(engine).get_table_names()), before)
        self.assertEqual(legacy_rows(), expected)
        self.assertEqual(self.rows(), ([], []))
