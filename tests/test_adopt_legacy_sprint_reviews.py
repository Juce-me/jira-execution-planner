"""Legacy per-Sprint review adoption into Department-group tables (#267, AC 22).

Legacy fixtures are built through the retained legacy models because save_review
writes only the new group tables. All data is synthetic.
"""
import contextlib
import hashlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import uuid

from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine, models
from backend.services import sprint_review as review
from scripts import adopt_legacy_sprint_reviews as adopt

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'adopt_legacy_sprint_reviews.py'
GROUPS = [{'id': 'group-x', 'name': 'Platform'}, {'id': 'group-y', 'name': 'Payments'}]


def col(label='Estimate', kind='story', type_='number', aggregation=None, archived=False, identity=None):
    aggregation = aggregation or ('sum' if type_ == 'number' else 'none')
    return {'id': identity or str(uuid.uuid4()), 'rowKind': kind, 'label': label, 'type': type_,
            'aggregation': aggregation, 'archived': archived, 'order': 0}


def uid(number):
    """A fixed, canonical UUID so golden output (ids and digest) is reproducible."""
    return f'00000000-0000-4000-8000-{number:012d}'


class AdoptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='tests')
        self.url = 'sqlite+pysqlite:///' + str(Path(self.temp.name).resolve() / 'adopt.db')
        models.Base.metadata.create_all(db_engine.get_engine(self.url))
        self.env = patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.url,
                                           'DATABASE_CONNECTION_MODE': 'url'})
        self.env.start()
        with db_engine.session_scope(self.url) as session:
            workspace = models.Workspace(environment_key='synthetic-adopt', name='Synthetic')
            other = models.Workspace(environment_key='synthetic-adopt-other', name='Other')
            session.add_all([workspace, other])
            session.flush()
            self.workspace, self.other = workspace.id, other.id
            session.add(models.WorkspaceGroupConfig(workspace_id=workspace.id, payload={
                'version': 1, 'groups': [dict(g) for g in GROUPS], 'defaultGroupId': 'group-x'}))

    def tearDown(self):
        self.env.stop()
        db_engine.dispose_engines()
        self.temp.cleanup()

    # Helpers
    def legacy(self, sprint, columns=(), layouts=None, cells=(), workspace=None, identity=None, revision=1):
        with db_engine.session_scope(self.url) as session:
            row = models.WorkspaceSprintReview(id=identity or str(uuid.uuid4()), workspace_id=workspace or self.workspace,
                                               sprint_id=sprint, schema_revision=revision, columns=list(columns),
                                               layouts=layouts or {})
            session.add(row)
            session.flush()
            for issue, kind, column_id, value, *rest in cells:
                session.add(models.SprintReviewCell(review_id=row.id, issue_id=issue, row_kind=kind, column_id=column_id,
                                                    value=value, revision=rest[0] if rest else 1))
            return row.id

    def adopt(self, *args, workspace=None):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = adopt.main(['--workspace-id', workspace or self.workspace, *args])
        return code, output.getvalue()

    def digest(self, workspace=None):
        code, output = self.adopt(workspace=workspace)
        self.assertEqual(code, 0)
        self.assertIn('dry-run only; no database changes applied', output)
        return next(token for token in output.split() if token.startswith('sha256:'))

    def apply(self, workspace=None):
        return self.adopt('--apply', '--expected-sha256', self.digest(workspace), workspace=workspace)

    def set_groups(self, groups, workspace=None):
        with db_engine.session_scope(self.url) as session:
            session.query(models.WorkspaceGroupConfig).filter_by(workspace_id=workspace or self.workspace).update(
                {'payload': {'version': 1, 'groups': groups, 'defaultGroupId': ''}})

    def group_state(self):
        with db_engine.session_scope(self.url) as session:
            schemas = {s.id: s for s in session.query(models.WorkspaceGroupReviewSchema).all()}
            return (sorted((s.workspace_id, s.group_id, s.schema_revision, repr(s.columns)) for s in schemas.values()),
                    sorted((schemas[c.schema_id].group_id, c.issue_id, c.row_kind, c.column_id, repr(c.value), c.revision)
                           for c in session.query(models.GroupReviewCell).all()),
                    sorted((v.workspace_id, v.group_id, v.sprint_id, v.sprint_order, v.view_revision, repr(v.layouts))
                           for v in session.query(models.GroupSprintReviewView).all()))

    def schema(self, group='group-x'):
        with db_engine.session_scope(self.url) as session:
            row = session.query(models.WorkspaceGroupReviewSchema).filter_by(workspace_id=self.workspace, group_id=group).one()
            return row.schema_revision, row.columns

    def cells(self, group='group-x'):
        with db_engine.session_scope(self.url) as session:
            row = session.query(models.WorkspaceGroupReviewSchema).filter_by(workspace_id=self.workspace, group_id=group).one()
            return sorted((c.issue_id, c.row_kind, c.column_id, c.value, c.revision)
                          for c in session.query(models.GroupReviewCell).filter_by(schema_id=row.id).all())

    def views(self, group='group-x'):
        with db_engine.session_scope(self.url) as session:
            return {v.sprint_id: (v.sprint_order, v.view_revision, v.layouts)
                    for v in session.query(models.GroupSprintReviewView).filter_by(workspace_id=self.workspace, group_id=group).all()}

    def legacy_state(self):
        with db_engine.session_scope(self.url) as session:
            return (sorted((r.id, r.workspace_id, r.sprint_id, r.schema_revision, repr(r.columns), repr(r.layouts))
                           for r in session.query(models.WorkspaceSprintReview).all()),
                    sorted((c.id, c.review_id, c.issue_id, c.row_kind, c.column_id, repr(c.value), c.revision)
                           for c in session.query(models.SprintReviewCell).all()))

    def empty(self):
        return self.group_state() == ([], [], [])

    def simple(self):
        column = col()
        self.legacy('17', [column], {'story': {'order': ['status', column['id']], 'hidden': []}},
                    [('101', 'story', column['id'], '1.000')])
        return column

    # Dry run, digest and refusals
    def test_dry_run_writes_nothing_and_prints_counts_per_table_and_group(self):
        self.simple()
        before = self.legacy_state()
        code, output = self.adopt()
        self.assertEqual(code, 0)
        self.assertTrue(self.empty())
        self.assertEqual(self.legacy_state(), before)
        for group in ('group-x', 'group-y'):
            self.assertIn(f'group {group}: workspace_group_review_schemas=1 group_review_cells=1 group_sprint_review_views=1', output)
        self.assertIn('legacy reviews 1 (skipped empty 0), legacy cells 1', output)

    def test_apply_refuses_without_a_matching_digest(self):
        self.simple()
        with self.assertRaisesRegex(ValueError, 'expected-sha256 is required'):
            self.adopt('--apply')
        with self.assertRaisesRegex(ValueError, 'sha256: prefix'):
            self.adopt('--apply', '--expected-sha256', 'abc')
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            self.adopt('--apply', '--expected-sha256', 'sha256:' + '0' * 64)
        self.assertTrue(self.empty())
        code, output = self.apply()
        self.assertEqual(code, 0)
        self.assertIn('applied', output)
        self.assertEqual(len(self.group_state()[0]), 2)

    def test_lock_timeout_exits_2_with_zero_writes(self):
        self.simple()
        digest = self.digest()
        with patch.object(adopt, '_lock_tables', side_effect=adopt.AdoptionLockTimeout()):
            code, _ = self.adopt('--apply', '--expected-sha256', digest)
        self.assertEqual(code, 2)
        self.assertTrue(self.empty())

    def test_postgresql_lock_order_timeouts_and_lock_timeout_mapping(self):
        class LockNotAvailable(Exception):
            sqlstate = '55P03'

        class FakeSession:
            def __init__(self, dialect, fail=False):
                self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
                self.statements, self.fail = [], fail

            def execute(self, statement, params=None):
                self.statements.append((str(statement), params))
                if self.fail and 'LOCK TABLE' in str(statement):
                    raise DBAPIError(str(statement), params, LockNotAvailable())

        session = FakeSession('postgresql')
        adopt._set_timeouts(session)
        adopt._lock_tables(session)
        self.assertEqual([p['value'] for _, p in session.statements[:2]], ['5s', '60s'])
        self.assertIn('lock_timeout', session.statements[0][0])
        self.assertIn('statement_timeout', session.statements[1][0])
        self.assertEqual([s for s, _ in session.statements[2:]], [
            'LOCK TABLE workspace_group_review_schemas IN EXCLUSIVE MODE',
            'LOCK TABLE group_review_cells IN EXCLUSIVE MODE',
            'LOCK TABLE group_sprint_review_views IN EXCLUSIVE MODE',
            'LOCK TABLE workspace_sprint_reviews IN SHARE MODE',
            'LOCK TABLE sprint_review_cells IN SHARE MODE'])
        with self.assertRaises(adopt.AdoptionLockTimeout):
            adopt._lock_tables(FakeSession('postgresql', fail=True))
        sqlite = FakeSession('sqlite')
        adopt._set_timeouts(sqlite)
        adopt._lock_tables(sqlite)
        self.assertEqual(sqlite.statements, [])

    def test_sqlite_racing_check_then_insert_aborts_on_unique_key_sanitized(self):
        self.simple()
        digest = self.digest()

        def racer(_session):
            with db_engine.session_scope(self.url) as other:
                other.add(models.WorkspaceGroupReviewSchema(workspace_id=self.workspace, group_id='group-x',
                                                            schema_revision=0, columns=[]))

        with patch.object(adopt, '_before_write', racer):
            with self.assertRaises(ValueError) as caught:
                self.adopt('--apply', '--expected-sha256', digest)
        message = str(caught.exception)
        self.assertIn('IntegrityError', message)
        self.assertIn('no database changes applied', message)
        for leaked in ('INSERT', self.workspace, 'group-x', 'Estimate', '101'):
            self.assertNotIn(leaked, message)
        self.assertIsNone(caught.exception.__cause__)
        schemas, cells, views = self.group_state()
        self.assertEqual([(s[1], s[2]) for s in schemas], [('group-x', 0)])
        self.assertEqual((cells, views), ([], []))

    def test_duplicate_legacy_column_id_across_sprints_aborts_with_count(self):
        shared = str(uuid.uuid4())
        self.legacy('17', [col('Estimate', identity=shared)])
        self.legacy('18', [col('Other', identity=shared)])
        with self.assertRaisesRegex(ValueError, r'1 legacy column ids repeat .*Sprints 17, 18'):
            self.adopt()
        self.assertTrue(self.empty())

    def test_second_apply_after_use_refuses_with_zero_writes(self):
        a, b, c = col('A'), col('B'), col('C', kind='epic')
        self.legacy('17', [a, b, c])
        digest = self.digest()
        self.assertEqual(self.adopt('--apply', '--expected-sha256', digest)[0], 0)
        with self.assertRaisesRegex(ValueError, 'already exist'):
            self.adopt('--apply', '--expected-sha256', digest)
        context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
            atlassian_account_id='synthetic-account', workspace_id=self.workspace,
            auth_connection_id='synthetic-db-connection', cloud_id='synthetic-cloud',
            site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)
        steps = [{'action': 'rename', 'columnId': a['id'], 'label': 'Renamed'},
                 {'action': 'archive', 'columnId': b['id'], 'archived': True},
                 {'action': 'aggregation', 'columnId': c['id'], 'aggregation': 'none'}]
        for base, step in enumerate(steps, start=1):
            review.save_review(context, '17', {'groupId': 'group-x', 'baseSchemaRevision': base,
                                               'schemaChanges': [step], 'cellChanges': []}, self.url)
        review.save_review(context, '30', {'groupId': 'group-x', 'baseSchemaRevision': 4, 'baseViewRevision': 0,
                                           'schemaChanges': [{'action': 'layout', 'rowKind': 'story', 'order': ['status'], 'hidden': []}],
                                           'cellChanges': []}, self.url)
        before, legacy = self.group_state(), self.legacy_state()
        self.assertEqual(self.digest(), digest)
        with self.assertRaisesRegex(ValueError, 'already exist'):
            self.adopt('--apply', '--expected-sha256', digest)
        self.assertEqual(self.group_state(), before)
        self.assertEqual(self.legacy_state(), legacy)

    def test_digest_changes_with_group_set_and_is_stable_under_row_reordering(self):
        a, b = col('A'), col('B')
        first = self.legacy('17', [a], {}, [('101', 'story', a['id'], '1.000'), ('102', 'story', a['id'], '2.000')])
        second = self.legacy('18', [b], {}, [('103', 'story', b['id'], None)])
        digest = self.digest()
        self.set_groups(list(reversed([dict(g) for g in GROUPS])))
        self.assertEqual(self.digest(), digest)
        with db_engine.session_scope(self.url) as session:
            rows = [(r.id, r.sprint_id, r.columns, [(c.issue_id, c.row_kind, c.column_id, c.value, c.revision)
                                                    for c in session.query(models.SprintReviewCell).filter_by(review_id=r.id)])
                    for r in session.query(models.WorkspaceSprintReview).all()]
            session.query(models.SprintReviewCell).delete()
            session.query(models.WorkspaceSprintReview).delete()
        for identity, sprint, columns, cells in reversed(rows):
            self.legacy(sprint, columns, {}, list(reversed(cells)), identity=identity)
        self.assertEqual({first, second}, {r[0] for r in rows})
        self.assertEqual(self.digest(), digest)
        self.set_groups([dict(GROUPS[0])])
        self.assertNotEqual(self.digest(), digest)
        self.set_groups([dict(g) for g in GROUPS] + [{'id': 'group-z', 'name': 'Z'}])
        self.assertNotEqual(self.digest(), digest)

    def test_zero_groups_refuses_and_no_legacy_rows_exits_zero(self):
        code, output = self.adopt()
        self.assertEqual(code, 0)
        self.assertIn('no legacy review data; nothing to adopt', output)
        self.legacy('16')  # an empty PATCH leaves an empty row; it is not legacy data
        self.assertEqual(self.adopt('--apply', '--expected-sha256', 'sha256:any')[0], 0)
        self.assertTrue(self.empty())
        self.simple()
        self.set_groups([])
        with self.assertRaisesRegex(ValueError, 'no Department group is configured'):
            self.adopt()
        with db_engine.session_scope(self.url) as session:
            session.query(models.WorkspaceGroupConfig).delete()
        with self.assertRaisesRegex(ValueError, 'no Department group is configured'):
            self.adopt()
        self.assertTrue(self.empty())

    def test_malformed_catalog_group_id_or_sprint_id_aborts(self):
        self.simple()
        for groups, pattern in (('scalar', 'malformed'), ([1], 'malformed'), ([{'id': ' padded'}], '1 configured group ids'),
                                ([{'id': 'g' * 129}, {'id': 'ok'}], '1 configured group ids'),
                                ([{'id': 'bad\x07'}, {'id': None}], '2 configured group ids')):
            with self.subTest(groups=groups):
                self.set_groups(groups)
                with self.assertRaisesRegex(ValueError, pattern):
                    self.adopt()
        with db_engine.session_scope(self.url) as session:
            session.execute(text("UPDATE workspace_group_configs SET payload = '\"scalar\"'"))
        with self.assertRaisesRegex(ValueError, 'group catalog is malformed'):
            self.adopt()
        self.set_groups([dict(g) for g in GROUPS])
        self.legacy('017', [col()])
        with self.assertRaisesRegex(ValueError, '1 legacy Sprint ids are not numeric'):
            self.adopt()
        self.assertTrue(self.empty())

    def test_missing_table_preflight_refuses(self):
        self.simple()
        with db_engine.session_scope(self.url) as session:
            session.execute(text('DROP TABLE group_sprint_review_views'))
        with self.assertRaisesRegex(ValueError, 'required tables missing: group_sprint_review_views'):
            self.adopt()

    # Column, cell and view rules
    def test_merge_rules_kind_purity_archive_intent_and_cell_precedence(self):
        a, e, n1 = col('Estimate'), col('Estimate', kind='epic'), col('Notes', type_='text')
        x, t = col('estimate', archived=True), col('Estimate', type_='text')
        d1, d2 = col('Size'), col('size')
        b, n2 = col(' ESTIMATE ', aggregation='none'), col('notes', type_='text', archived=True)
        self.legacy('17', [a, e, n1], {}, [('101', 'story', a['id'], '1.000'), ('102', 'story', a['id'], '3.000'),
                                          ('103', 'story', a['id'], '4.000'), ('501', 'epic', e['id'], '9.000'),
                                          ('101', 'story', n1['id'], 'note')])
        self.legacy('18', [x, t, d1, d2], {}, [('104', 'story', x['id'], '7.000'), ('101', 'story', t['id'], 'text'),
                                              ('101', 'story', d1['id'], '5.000'), ('101', 'story', d2['id'], '6.000')])
        self.legacy('19', [b, n2], {}, [('101', 'story', b['id'], '2.000'), ('102', 'story', b['id'], None),
                                       ('102', 'story', n2['id'], 'gone')])
        legacy = self.legacy_state()
        code, output = self.apply()
        self.assertEqual(code, 0)
        revision, columns = self.schema()
        self.assertEqual(revision, 1)
        self.assertEqual([(c['id'], c['rowKind'], c['label'], c['type'], c['aggregation'], c['archived'], c['order'], c['after'])
                          for c in columns], [
            (a['id'], 'story', 'Estimate', 'number', 'none', False, 0, None),
            (e['id'], 'epic', 'Estimate', 'number', 'sum', False, 0, None),
            (t['id'], 'story', 'Estimate', 'text', 'none', False, 1, None),
            (d1['id'], 'story', 'Size', 'number', 'sum', False, 2, None)])
        self.assertEqual(self.cells(), sorted([
            ('101', 'story', a['id'], '2.000', 1), ('102', 'story', a['id'], None, 1), ('103', 'story', a['id'], '4.000', 1),
            ('501', 'epic', e['id'], '9.000', 1), ('101', 'story', t['id'], 'text', 1), ('101', 'story', d1['id'], '6.000', 1)]))
        self.assertEqual(self.cells('group-y'), self.cells())
        self.assertEqual(self.schema('group-y'), (revision, columns))
        self.assertIn('archive intent: keys 1, cells dropped 2', output)
        self.assertIn('archived members discarded: 1, cells dropped 1', output)
        self.assertIn('conflicting cell values dropped: 3', output)
        self.assertIn(f'merged {a["id"]}: {a["id"]}@17 {b["id"]}@19; archived {x["id"]}@18\n', output)
        self.assertIn(f'merged {d1["id"]}: {d1["id"]}@18 {d2["id"]}@18', output)
        self.assertIn('columns adopted: epic 1, story 3', output)
        self.assertIn('derived: story sum rollups 1, epic inherited 1', output)
        self.assertEqual(self.legacy_state(), legacy)

    def test_cap_ranks_keys_by_their_latest_member(self):
        early = [col(f'L{i}') for i in range(16)]
        late = [col(f'L{i}') for i in range(16, 31)]
        again = col('L0')
        self.legacy('17', early, {}, [('101', 'story', early[1]['id'], '1.000'), ('101', 'story', early[0]['id'], '2.000')])
        self.legacy('18', late)
        self.legacy('20', [again])
        code, output = self.apply()
        self.assertEqual(code, 0)
        ids = [c['id'] for c in self.schema()[1]]
        self.assertEqual(len(ids), 30)
        self.assertNotIn(early[1]['id'], ids)
        self.assertEqual(ids[0], early[0]['id'])
        self.assertNotIn(again['id'], ids)
        self.assertIn(f'cap excluded: keys 1, cells dropped 1; members {early[1]["id"]}@17', output)
        self.assertEqual(self.cells(), [('101', 'story', early[0]['id'], '2.000', 1)])

    def test_sixty_add_bound_validates_before_apply(self):
        self.legacy('17', [col(f'E{i}', kind='epic') for i in range(18)] + [col(f'S{i}') for i in range(18)])
        self.legacy('18', [col(f'E{i}', kind='epic') for i in range(18, 35)] + [col(f'S{i}') for i in range(18, 35)])
        calls = []
        validate, apply_schema, apply_layouts = review.validate_schema_changes, review.apply_schema, review.apply_layouts
        with patch.object(review, 'validate_schema_changes', side_effect=lambda ch: (calls.append(('validate', len(ch))), validate(ch))[1]), \
                patch.object(review, 'apply_schema', side_effect=lambda co, ch: (calls.append(('schema', len(ch))), apply_schema(co, ch))[1]), \
                patch.object(review, 'apply_layouts', side_effect=lambda la, co, ch: (calls.append(('layouts', len(ch))), apply_layouts(la, co, ch))[1]):
            self.assertEqual(self.apply()[0], 0)
        self.assertEqual(calls[:2], [('validate', 60), ('schema', 60)])
        columns = self.schema()[1]
        self.assertEqual((sum(c['rowKind'] == 'epic' for c in columns), sum(c['rowKind'] == 'story' for c in columns)), (30, 30))

    def test_views_only_for_layouts_with_content_single_kind_and_first_occurrence(self):
        a, e, n = col('Estimate'), col('Estimate', kind='epic'), col('Notes', type_='text')
        a2, a3, n2 = col('Estimate'), col('estimate'), col('Notes', type_='text', archived=True)
        e2 = col('Estimate', kind='epic')
        self.legacy('17', [a, e, n], {})
        self.legacy('18', [a2, a3, n2], {'story': {'order': ['status', a3['id'], 'priority', a2['id'], 'gone'],
                                                  'hidden': ['key', 'project', n2['id']]}})
        self.legacy('19', [e2], {'epic': {'order': [e2['id'], 'status'], 'hidden': []}})
        calls = []
        validate = review.validate_schema_changes
        with patch.object(review, 'validate_schema_changes', side_effect=lambda ch: (calls.append([c['action'] for c in ch]), validate(ch))[1]):
            code, output = self.apply()
        self.assertEqual(code, 0)
        self.assertIn(['layout'], calls)
        for group in ('group-x', 'group-y'):
            self.assertEqual(self.views(group), {
                '18': ('18'.rjust(128, '0'), 1, {'story': {'order': ['status', a['id'], 'priority'], 'hidden': ['key', 'project']}}),
                '19': ('19'.rjust(128, '0'), 1, {'epic': {'order': [e['id'], 'status'], 'hidden': []}})})
        self.assertIn('views: 2 written per group, skipped by cap 0', output)

    def test_view_cap_keeps_the_highest_sprint_order(self):
        for sprint in ('9', '100', '10'):
            column = col()
            self.legacy(sprint, [column], {'story': {'order': [column['id']], 'hidden': []}})
        with patch.object(review, 'MAX_GROUP_VIEWS', 2):
            code, output = self.apply()
        self.assertEqual(code, 0)
        self.assertEqual(sorted(self.views()), ['10', '100'])
        self.assertIn('views: 2 written per group, skipped by cap 1 (Sprints 9)', output)

    def test_cross_kind_legacy_layout_id_aborts(self):
        a, e = col(), col(kind='epic')
        self.legacy('17', [a, e], {'story': {'order': [e['id']], 'hidden': []}})
        with self.assertRaisesRegex(ValueError, '1 legacy layout ids are not of their layout row kind'):
            self.adopt()

    def test_inserts_are_chunked(self):
        column = col()
        self.legacy('17', [column], {}, [(str(100 + i), 'story', column['id'], '1.000') for i in range(5)])
        statements = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, params, *rest: statements.append((statement, params))
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            with patch.object(adopt, 'INSERT_CHUNK_ROWS', 2):
                self.assertEqual(self.apply()[0], 0)
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        cell_inserts = [p for s, p in statements if s.lstrip().upper().startswith('INSERT INTO GROUP_REVIEW_CELLS')]
        self.assertEqual(len(cell_inserts), 6)
        self.assertTrue(all(len(p) <= 2 * 7 for p in cell_inserts))
        self.assertEqual(len(self.cells()), 5)

    def test_output_has_counts_and_ids_only(self):
        secret = col('ConfidentialLabel', type_='text')
        merged = col('confidentiallabel', type_='text')
        archived = col('CONFIDENTIALLABEL', type_='text', archived=True)
        self.legacy('16', [archived], {}, [('424242424241', 'story', archived['id'], 'ArchivedValue')])
        self.legacy('17', [secret], {'story': {'order': [secret['id']], 'hidden': []}},
                    [('424242424242', 'story', secret['id'], 'ConfidentialValue')])
        self.legacy('18', [merged], {}, [('424242424243', 'story', merged['id'], 'OtherValue')])
        _, dry = self.adopt()
        _, applied = self.apply()
        for output in (dry, applied):
            for leaked in ('ConfidentialLabel', 'confidentiallabel', 'CONFIDENTIALLABEL', 'ConfidentialValue', 'OtherValue',
                           'ArchivedValue', '424242424241', '424242424242', '424242424243', 'Platform', 'Payments'):
                self.assertNotIn(leaked, output)
            self.assertIn(f'merged {secret["id"]}: {secret["id"]}@17 {merged["id"]}@18; archived {archived["id"]}@16', output)

    def test_workspace_isolation_and_list(self):
        self.simple()
        other_column = col()
        self.legacy('17', [other_column], {}, [('101', 'story', other_column['id'], '1.000')], workspace=self.other)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(adopt.main(['--list']), 0)
        self.assertIn(f'workspace {self.workspace} legacy_reviews=1 group_schemas=0 group_views=0 status=pending', output.getvalue())
        self.assertIn(f'workspace {self.other} legacy_reviews=1 group_schemas=0 group_views=0 status=pending', output.getvalue())
        self.assertEqual(self.apply()[0], 0)
        self.assertEqual({s[0] for s in self.group_state()[0]}, {self.workspace})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(adopt.main(['--list', '--workspace-id', self.workspace]), 0)
        self.assertEqual(output.getvalue().strip(),
                         f'workspace {self.workspace} legacy_reviews=1 group_schemas=2 group_views=2 status=adopted')
        with self.assertRaisesRegex(ValueError, '--workspace-id is required'):
            adopt.main([])

    def test_legacy_rows_never_modified(self):
        column = self.simple()
        self.legacy('18', [col('Gone', archived=True)], {'epic': {'order': [], 'hidden': []}},
                    [('102', 'story', column['id'], None)])
        before = self.legacy_state()
        self.adopt()
        self.apply()
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.legacy_state(), before)

    # Golden state of the fresh path: pins stdout, digest and written rows before the planner is split
    # (docs/plans/EXEC-planning-review-adoption-merge-mode.md, Task 2a). Workspace, row and column ids are fixed.
    def golden_workspace(self, identity):
        with db_engine.session_scope(self.url) as session:
            session.add(models.Workspace(id=identity, environment_key='synthetic-golden-' + identity[-4:], name='Synthetic'))
            session.flush()
            session.add(models.WorkspaceGroupConfig(workspace_id=identity, payload={
                'version': 1, 'groups': [dict(g) for g in GROUPS], 'defaultGroupId': 'group-x'}))
        return identity

    golden_row_base = 9000

    def golden_put(self, workspace, sprint, columns=(), layouts=None, cells=()):
        self.legacy(sprint, list(columns), layouts, list(cells), workspace=workspace, identity=uid(self.golden_row_base + int(sprint)))

    def golden_rich_fixture(self, workspace):
        c = lambda number, label, kind='story', type_='number', archived=False: col(  # noqa: E731
            label, kind=kind, type_=type_, archived=archived, identity=uid(number))
        epic_cap, cap0, cap0_again, cap1 = c(1000, 'EpicCap0', 'epic'), c(2000, 'StoryCap0'), c(2100, 'storycap0'), c(2001, 'StoryCap1')
        intent_live, intent_archived = c(3000, 'IntentKey', type_='text'), c(3001, 'intentkey', type_='text', archived=True)
        discard_archived, discard_live = c(3100, 'DiscardKey', archived=True), c(3101, 'discardkey')
        shared_a, shared_b = c(3200, 'Shared'), c(3201, 'shared')
        put = lambda *args, **kwargs: self.golden_put(workspace, *args, **kwargs)  # noqa: E731
        # Cap-excluded keys (one Epic, two Story), including two members of one key with cells on the same issue;
        # an archive-intent key (latest member archived) with a kind-mismatched cell; layouts naming excluded,
        # intent, unknown and duplicate ids and `key` in both lists.
        put('10', [epic_cap, cap0, cap1, intent_live],
            {'story': {'order': ['status', cap0['id'], cap1['id'], 'key', 'status', intent_live['id']],
                       'hidden': ['key', 'project', cap0['id']]},
             'epic': {'order': [epic_cap['id'], 'status'], 'hidden': []}},
            [('701', 'story', cap0['id'], '1.000'), ('711', 'epic', epic_cap['id'], '8.000'), ('712', 'story', cap1['id'], '7.000'),
             ('702', 'story', intent_live['id'], 'a'), ('703', 'epic', intent_live['id'], 'x')])
        put('11', [cap0_again], {}, [('701', 'story', cap0_again['id'], '2.000')])
        # An archived member before a live one for the same issue (the live value is kept, the archived one counted).
        put('12', [discard_archived], {}, [('704', 'story', discard_archived['id'], '1.000')])
        put('13', [discard_live], {}, [('704', 'story', discard_live['id'], '9.000')])
        # Same-issue conflicts in an adopted key (a later clear wins), a kind-mismatched cell, an orphan cell for an
        # undefined column and one for a column that belongs to another legacy row.
        put('14', [shared_a], {}, [('705', 'story', shared_a['id'], '1.000'), ('706', 'story', shared_a['id'], '5.000'),
                                  ('708', 'epic', shared_a['id'], '1.000')])
        put('15', [shared_b], {}, [('705', 'story', shared_b['id'], '2.000'), ('706', 'story', shared_b['id'], None),
                                  ('709', 'story', cap0['id'], 'foreign'), ('707', 'story', uid(9999), 'undefined')])
        epics = [c(1000 + i, f'Epic{i:02d}', 'epic') for i in range(1, 31)]
        stories = [c(2000 + i, f'Story{i:02d}') for i in range(2, 30)]
        put('20', epics + stories, {'story': {'order': ['status', stories[0]['id'], 'priority'], 'hidden': ['key']}},
            [('710', 'epic', epics[0]['id'], '3.000'), ('710', 'story', stories[0]['id'], '4.500')])
        put('21', [], {'epic': {'order': ['status', 'assignee'], 'hidden': ['key']}})
        put('22')  # empty: skipped
        put('23', [], {'story': {'order': ['gone', 'status'], 'hidden': []}})
        put('30', [intent_archived], {}, [('702', 'story', intent_archived['id'], 'b')])

    def golden_run(self, workspace, view_limit=None):
        limit = patch.object(review, 'MAX_GROUP_VIEWS', view_limit) if view_limit else contextlib.nullcontext()
        with limit:
            code, dry = self.adopt(workspace=workspace)
            self.assertEqual(code, 0)
            digest = next(token for token in dry.split() if token.startswith('sha256:'))
            code, applied = self.adopt('--apply', '--expected-sha256', digest, workspace=workspace)
        self.assertEqual(code, 0)
        return dry, applied

    def golden_state(self):
        fingerprint = lambda rows: (len(rows), hashlib.sha256(repr(rows).encode('utf-8')).hexdigest()[:16])  # noqa: E731
        schemas, cells, views = self.group_state()
        return fingerprint(schemas), fingerprint(cells), fingerprint(views)

    def test_golden_state_fresh_path_rich_workspace(self):
        workspace = self.golden_workspace(uid(1))
        self.golden_rich_fixture(workspace)
        dry, applied = self.golden_run(workspace, view_limit=3)
        self.assertEqual((dry, applied, self.golden_state()), GOLDEN_RICH)

    def test_golden_state_fresh_path_archive_only_workspace(self):
        workspace = self.golden_workspace(uid(2))
        self.golden_put(workspace, '40', [col('Gone', identity=uid(4000), archived=True)])
        dry, applied = self.golden_run(workspace)
        self.assertEqual((dry, applied, self.golden_state()), GOLDEN_ARCHIVE_ONLY)

    def test_golden_state_fresh_path_layout_only_workspace(self):
        workspace = self.golden_workspace(uid(3))
        self.golden_put(workspace, '50', [], {'story': {'order': ['status', 'gone'], 'hidden': ['key']}})
        dry, applied = self.golden_run(workspace)
        self.assertEqual((dry, applied, self.golden_state()), GOLDEN_LAYOUT_ONLY)

    # Group state reader (merge mode, #299)
    def test_read_group_state_returns_plain_values_for_the_requested_groups_and_issues(self):
        group_column = {'id': uid(1), 'rowKind': 'story', 'label': 'Risk', 'type': 'number', 'aggregation': 'sum',
                        'archived': False, 'order': 0, 'after': None}
        with db_engine.session_scope(self.url) as session:
            schema = models.WorkspaceGroupReviewSchema(id=str(uuid.uuid4()), workspace_id=self.workspace, group_id='group-x',
                                                       schema_revision=3, columns=[group_column])
            session.add(schema)
            session.flush()
            session.add_all([models.GroupReviewCell(schema_id=schema.id, issue_id=issue, row_kind='story', column_id=uid(1),
                                                    value=value, revision=1)
                             for issue, value in (('101', '1'), ('102', None), ('999', '9'))])
            session.add_all([models.GroupSprintReviewView(workspace_id=self.workspace, group_id='group-x', sprint_id=sprint,
                                                          sprint_order=review.sprint_order(sprint), layouts={}, view_revision=1)
                             for sprint in ('100', '9', '10')])
        with db_engine.session_scope(self.url) as session:
            state = adopt._read_group_state(session, self.workspace, ['group-x', 'group-y'], {'101', '102'})
            self.assertEqual(len(session.identity_map), 0)  # nothing an identity map could keep stale after a lock
        self.assertEqual(state['group-x'], {'exists': True, 'revision': 3, 'columns': [group_column],
                                            'cells': {('101', 'story', uid(1)), ('102', 'story', uid(1))},
                                            'view_sprints': ['9', '10', '100']})
        self.assertEqual(state['group-y'], {'exists': False, 'revision': 0, 'columns': [], 'cells': set(), 'view_sprints': []})

    def test_read_group_state_aborts_on_malformed_group_columns_with_a_count(self):
        with db_engine.session_scope(self.url) as session:
            session.add(models.WorkspaceGroupReviewSchema(id=str(uuid.uuid4()), workspace_id=self.workspace, group_id='group-x',
                                                          schema_revision=1, columns=[{'id': 'x'}, {'id': 'y'}]))
        with db_engine.session_scope(self.url) as session:
            with self.assertRaisesRegex(ValueError, '2 group columns are malformed'):
                adopt._read_group_state(session, self.workspace, ['group-x'], set())

    def test_resolution_against_an_empty_state_equals_the_fresh_resolution(self):
        workspace = self.golden_workspace(uid(1))
        self.golden_rich_fixture(workspace)
        with db_engine.session_scope(self.url) as session:
            reviews, _skipped = adopt._legacy(session, workspace)
        normalized = adopt._normalize(reviews)
        empty = {'exists': False, 'revision': 0, 'columns': [], 'cells': set(), 'view_sprints': []}
        with patch.object(review, 'MAX_GROUP_VIEWS', 3):
            fresh, merged = adopt._resolve_group(normalized), adopt._resolve_group(normalized, empty)
        for key in ('columns', 'added', 'cells', 'views', 'revision', 'empty'):
            self.assertEqual(merged[key], fresh[key], key)

    # Merge mode (#299)
    def merge(self, *args, workspace=None):
        return self.adopt('--merge', *args, workspace=workspace)

    def merge_digest(self, *args, workspace=None):
        code, output = self.merge(*args, workspace=workspace)
        self.assertEqual(code, 0)
        self.assertIn('dry-run only; no database changes applied', output)
        return next(token for token in output.split() if token.startswith('sha256:'))

    def merge_apply(self, *args, workspace=None):
        digest = self.merge_digest(*args, workspace=workspace)
        return self.merge('--apply', '--expected-sha256', digest, *args, workspace=workspace)

    def live_group(self, group='group-x', columns=(), revision=1, cells=(), views=(), workspace=None):
        workspace = workspace or self.workspace
        with db_engine.session_scope(self.url) as session:
            schema = models.WorkspaceGroupReviewSchema(id=str(uuid.uuid4()), workspace_id=workspace, group_id=group,
                                                       schema_revision=revision, columns=list(columns))
            session.add(schema)
            session.flush()
            session.add_all([models.GroupReviewCell(schema_id=schema.id, issue_id=issue, row_kind=kind, column_id=column_id,
                                                    value=value, revision=1) for issue, kind, column_id, value in cells])
            session.add_all([models.GroupSprintReviewView(workspace_id=workspace, group_id=group, sprint_id=sprint,
                                                          sprint_order=review.sprint_order(sprint), layouts=layouts, view_revision=1)
                             for sprint, layouts in views])

    def live_revision(self, group='group-x'):
        with db_engine.session_scope(self.url) as session:
            row = session.query(models.WorkspaceGroupReviewSchema).filter_by(workspace_id=self.workspace, group_id=group).first()
            return row.schema_revision if row else 0

    def live_context(self):
        return RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
            atlassian_account_id='synthetic-account', workspace_id=self.workspace,
            auth_connection_id='synthetic-db-connection', cloud_id='synthetic-cloud',
            site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)

    def live_search(self, payload, **kwargs):
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')
        return Mock(status_code=200, json=lambda: {'issues': [
            {'id': issue, 'fields': {'issuetype': {'name': 'Story', 'subtask': False}}} for issue in ids], 'isLast': True})

    def live_schema(self, step, group='group-x', sprint='17'):
        return review.save_review(self.live_context(), sprint, {'groupId': group, 'baseSchemaRevision': self.live_revision(group),
                                                                'schemaChanges': [step], 'cellChanges': []}, self.url)

    def workspace_state(self, workspace=None):
        workspace = workspace or self.workspace
        with db_engine.session_scope(self.url) as session:
            schemas = session.query(models.WorkspaceGroupReviewSchema).filter_by(workspace_id=workspace).all()
            group_of = {schema.id: schema.group_id for schema in schemas}
            cells = session.query(models.GroupReviewCell).filter(models.GroupReviewCell.schema_id.in_(list(group_of))).all() if group_of else []
            views = session.query(models.GroupSprintReviewView).filter_by(workspace_id=workspace).all()
            return {'schemas': {s.group_id: (s.schema_revision, repr(s.columns)) for s in schemas},
                    'cells': sorted((group_of[c.schema_id], c.issue_id, c.row_kind, c.column_id, repr(c.value), c.revision) for c in cells),
                    'views': sorted((v.group_id, v.sprint_id, v.sprint_order, v.view_revision, repr(v.layouts)) for v in views)}

    def list_output(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(adopt.main(['--list', *args]), 0)
        return output.getvalue()

    def test_merge_into_empty_groups_equals_fresh_adoption(self):
        fresh = self.golden_workspace(uid(1))
        self.golden_rich_fixture(fresh)
        self.golden_row_base = 19000
        merged = self.golden_workspace(uid(2))
        self.golden_rich_fixture(merged)
        with patch.object(review, 'MAX_GROUP_VIEWS', 3):
            self.assertEqual(self.adopt('--apply', '--expected-sha256', self.digest(fresh), workspace=fresh)[0], 0)
            self.assertEqual(self.merge_apply(workspace=merged)[0], 0)
        self.assertEqual(self.workspace_state(merged), self.workspace_state(fresh))
        self.assertEqual((len(self.workspace_state(fresh)['cells']), len(self.workspace_state(fresh)['views'])), (10, 6))

    def test_created_row_ends_at_revision_one_including_views_only(self):
        workspace = self.golden_workspace(uid(3))
        self.golden_put(workspace, '50', [], {'story': {'order': ['status', 'gone'], 'hidden': ['key']}})
        self.assertEqual(self.merge_apply(workspace=workspace)[0], 0)
        state = self.workspace_state(workspace)
        self.assertEqual(state['schemas'], {'group-x': (1, '[]'), 'group-y': (1, '[]')})
        self.assertEqual([view[:2] for view in state['views']], [('group-x', '50'), ('group-y', '50')])

    def test_an_empty_plan_group_is_neither_locked_nor_written(self):
        risk = col('Risk', identity=uid(1))
        self.legacy('17', [risk], {}, [('101', 'story', uid(1), '1.000')])
        self.live_group('group-x', [group_col(1, 'Risk')], revision=2, cells=[('101', 'story', uid(1), '1.000')])
        before = self.workspace_state()
        locked, real = [], review._locked_schema
        with patch.object(review, '_locked_schema', side_effect=lambda session, context, group: (locked.append(group), real(session, context, group))[1]):
            self.assertEqual(self.merge_apply()[0], 0)
        self.assertEqual(locked, ['group-y'])
        after = self.workspace_state()
        self.assertEqual(after['schemas']['group-x'], before['schemas']['group-x'])
        self.assertEqual(after['schemas']['group-y'][0], 1)
        self.assertEqual([c for c in after['cells'] if c[0] == 'group-x'], before['cells'])

    def test_groups_are_locked_in_sorted_order(self):
        self.set_groups([{'id': 'group-z', 'name': 'Z'}, {'id': 'group-m', 'name': 'M'}, {'id': 'group-a', 'name': 'A'}])
        self.simple()
        locked, real = [], review._locked_schema
        with patch.object(review, '_locked_schema', side_effect=lambda session, context, group: (locked.append(group), real(session, context, group))[1]):
            self.assertEqual(self.merge_apply()[0], 0)
        self.assertEqual(locked, ['group-a', 'group-m', 'group-z'])

    def test_merge_lock_order_and_lock_timeout_mapping(self):
        class LockNotAvailable(Exception):
            sqlstate = '55P03'

        class FakeSession:
            def __init__(self, dialect, fail=False):
                self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
                self.statements, self.fail = [], fail

            def execute(self, statement, params=None):
                self.statements.append(str(statement))
                if self.fail and 'LOCK TABLE' in str(statement):
                    raise DBAPIError(str(statement), params, LockNotAvailable())

        calls = []
        locked = lambda session, context, group: (calls.append((group, context.workspace_id)), SimpleNamespace(id=group))[1]  # noqa: E731
        with patch.object(review, '_locked_schema', locked):
            session = FakeSession('postgresql')
            rows = adopt._lock_merge(session, 'w1', ['group-z', 'group-a'])
            self.assertEqual(session.statements, ['LOCK TABLE workspace_sprint_reviews IN SHARE MODE',
                                                  'LOCK TABLE sprint_review_cells IN SHARE MODE'])  # no lock on the group tables
            self.assertEqual((calls, sorted(rows)), ([('group-a', 'w1'), ('group-z', 'w1')], ['group-a', 'group-z']))
            with self.assertRaises(adopt.AdoptionLockTimeout):
                adopt._lock_merge(FakeSession('postgresql', fail=True), 'w1', ['group-a'])
            sqlite = FakeSession('sqlite')
            adopt._lock_merge(sqlite, 'w1', ['group-a'])
            self.assertEqual(sqlite.statements, [])

        def timing_out(session, context, group):
            raise DBAPIError('lock', None, LockNotAvailable())
        with patch.object(review, '_locked_schema', timing_out), self.assertRaises(adopt.AdoptionLockTimeout):
            adopt._lock_merge(FakeSession('postgresql'), 'w1', ['group-a'])

    def test_merge_dry_run_writes_nothing_and_apply_requires_a_matching_digest(self):
        self.simple()
        before = self.workspace_state()
        digest = self.merge_digest()
        self.assertEqual(self.workspace_state(), before)
        with self.assertRaisesRegex(ValueError, 'expected-sha256 is required'):
            self.merge('--apply')
        with self.assertRaisesRegex(ValueError, 'sha256: prefix'):
            self.merge('--apply', '--expected-sha256', 'abc')
        with self.assertRaisesRegex(ValueError, 'digest mismatch; no database changes applied'):
            self.merge('--apply', '--expected-sha256', 'sha256:' + '0' * 64)
        self.assertEqual(self.workspace_state(), before)
        code, output = self.merge('--apply', '--expected-sha256', digest)
        self.assertEqual(code, 0)
        self.assertIn('applied: 2 groups written, 0 unchanged', output)

    def test_merge_digest_precedence_a_stale_digest_exits_1_and_a_fresh_one_finds_nothing_to_merge(self):
        self.simple()
        first = self.merge_digest()
        self.assertEqual(self.merge('--apply', '--expected-sha256', first)[0], 0)
        applied = self.workspace_state()
        with self.assertRaisesRegex(ValueError, 'digest mismatch; no database changes applied'):
            self.merge('--apply', '--expected-sha256', first)
        code, output = self.merge('--apply', '--expected-sha256', self.merge_digest())
        self.assertEqual(code, 0)
        self.assertIn('nothing to merge; no database changes applied', output)
        self.assertEqual(self.workspace_state(), applied)

    def test_merge_digest_ignores_unrelated_live_edits_but_changes_with_a_column_or_a_decision(self):
        self.legacy('17', [col('Risk', identity=uid(1))], {}, [('101', 'story', uid(1), '1.000'), ('102', 'story', uid(1), '2.000')])
        self.live_group('group-x', [group_col(10, 'Risk')], revision=2)
        base = self.merge_digest()

        def edit(change):
            with db_engine.session_scope(self.url) as session:
                schema = session.query(models.WorkspaceGroupReviewSchema).filter_by(
                    workspace_id=self.workspace, group_id='group-x').one()
                change(session, schema)
        edit(lambda session, schema: session.add(models.GroupReviewCell(  # an issue the legacy data never mentions
            schema_id=schema.id, issue_id='999', row_kind='story', column_id=uid(10), value='9', revision=1)))
        self.assertEqual(self.merge_digest(), base)
        edit(lambda session, schema: session.add(models.GroupReviewCell(  # flips an insert into a skip
            schema_id=schema.id, issue_id='101', row_kind='story', column_id=uid(10), value='live', revision=1)))
        flipped = self.merge_digest()
        self.assertNotEqual(flipped, base)
        edit(lambda session, schema: setattr(schema, 'schema_revision', 3))  # a column change in a group being written
        self.assertNotEqual(self.merge_digest(), flipped)

    def test_merge_digest_ignores_a_column_change_in_a_group_with_nothing_to_merge(self):
        self.legacy('17', [col('Risk', identity=uid(1))], {}, [('101', 'story', uid(1), '1.000')])
        self.live_group('group-x', [group_col(1, 'Risk')], revision=2, cells=[('101', 'story', uid(1), '1.000')])  # complete
        base = self.merge_digest()  # group-y has no rows, so it is the group being written
        self.live_schema({'action': 'add', 'column': {'id': uid(20), 'rowKind': 'story', 'label': 'Live', 'type': 'number', 'aggregation': 'sum'}})
        self.assertEqual(self.live_revision(), 3)
        self.assertEqual(self.merge_digest(), base)
        self.assertEqual(self.merge('--apply', '--expected-sha256', base)[0], 0)
        self.assertEqual(self.schema('group-x')[0], 3)  # the written group was group-y; group-x kept its own revision
        self.assertEqual(self.schema('group-y')[0], 1)

    def test_a_live_save_between_the_phases_aborts_with_zero_writes_and_keeps_the_live_column(self):
        self.legacy('17', [col('Risk', identity=uid(1))], {}, [('101', 'story', uid(1), '1.000')])
        self.live_group('group-x', [group_col(10, 'Other')], revision=2)
        digest = self.merge_digest()
        live_column = {'action': 'add', 'column': {'id': uid(20), 'rowKind': 'story', 'label': 'Live', 'type': 'number', 'aggregation': 'sum'}}
        with patch.object(adopt, '_before_lock', lambda: self.live_schema(live_column)):
            with self.assertRaisesRegex(ValueError, 'data changed since the dry run'):
                self.merge('--apply', '--expected-sha256', digest)
        state = self.workspace_state()
        self.assertEqual(state['schemas']['group-x'][0], 3)  # the live save only
        self.assertIn(uid(20), state['schemas']['group-x'][1])  # the live column survived
        self.assertNotIn(uid(1), state['schemas']['group-x'][1])  # nothing was merged
        self.assertNotIn('group-y', state['schemas'])  # no lock-created row was committed
        self.assertEqual(state['cells'], [])

    def test_an_unrelated_live_cell_between_the_phases_still_applies(self):
        self.legacy('17', [col('Risk', identity=uid(1))], {}, [('101', 'story', uid(1), '1.000')])
        self.live_group('group-x', [group_col(10, 'Other')], revision=2)
        digest = self.merge_digest()

        def unrelated_cell():
            with db_engine.session_scope(self.url) as session:
                schema = session.query(models.WorkspaceGroupReviewSchema).filter_by(workspace_id=self.workspace, group_id='group-x').one()
                session.add(models.GroupReviewCell(schema_id=schema.id, issue_id='999', row_kind='story', column_id=uid(10), value='9', revision=1))
        with patch.object(adopt, '_before_lock', unrelated_cell):
            self.assertEqual(self.merge('--apply', '--expected-sha256', digest)[0], 0)
        state = self.workspace_state()
        self.assertIn(uid(1), state['schemas']['group-x'][1])
        self.assertIn(('group-x', '999', 'story', uid(10), "'9'", 1), state['cells'])

    def test_a_failure_in_a_later_group_rolls_back_every_group(self):
        self.simple()
        real, calls = adopt._insert, []

        def failing(session, model, rows):
            calls.append(model.__tablename__)
            if len(calls) > 2:  # the first group's cells and views went in
                raise RuntimeError('boom')
            return real(session, model, rows)
        with patch.object(adopt, '_insert', failing):
            with self.assertRaises(RuntimeError):
                self.merge_apply()
        self.assertEqual(self.workspace_state(), {'schemas': {}, 'cells': [], 'views': []})

    def test_every_preexisting_live_row_is_byte_identical_after_apply(self):
        risk, late = col('Risk', identity=uid(1)), col('Late', identity=uid(2))
        self.legacy('17', [risk, late], {}, [('101', 'story', uid(1), '1'), ('102', 'story', uid(2), '2')])
        self.live_group('group-x', [group_col(10, 'Risk')], revision=4, cells=[('101', 'story', uid(10), 'live')],
                        views=[('200', {'story': {'order': ['status'], 'hidden': []}})])

        def rows():
            with db_engine.session_scope(self.url) as session:
                schema = session.query(models.WorkspaceGroupReviewSchema).filter_by(workspace_id=self.workspace, group_id='group-x').one()
                return ((schema.id, schema.schema_revision, repr(schema.columns)),
                        {c.id: (c.issue_id, c.row_kind, c.column_id, c.value, c.revision)
                         for c in session.query(models.GroupReviewCell).filter_by(schema_id=schema.id).all()},
                        {v.id: (v.sprint_id, v.sprint_order, v.view_revision, repr(v.layouts))
                         for v in session.query(models.GroupSprintReviewView).filter_by(workspace_id=self.workspace, group_id='group-x').all()})
        (schema_id, revision, columns), cells, views = rows()
        self.assertEqual(self.merge_apply()[0], 0)
        (after_id, after_revision, after_columns), after_cells, after_views = rows()
        self.assertEqual((after_id, after_revision), (schema_id, revision + 1))  # "Late" was added
        self.assertTrue(after_columns.startswith(columns[:-1]))  # the live column is untouched, a column follows it
        self.assertEqual({key: value for key, value in after_cells.items() if key in cells}, cells)
        self.assertEqual({key: value for key, value in after_views.items() if key in views}, views)

    def test_applying_the_merge_twice_is_a_noop_and_list_says_adopted(self):
        self.simple()
        self.live_group('group-x', [group_col(10, 'Other')], revision=2)
        self.assertIn('status=needs-merge', self.list_output('--workspace-id', self.workspace))
        self.assertEqual(self.merge_apply()[0], 0)
        applied = self.workspace_state()
        self.assertIn('status=adopted', self.list_output('--workspace-id', self.workspace))
        code, output = self.merge_apply()
        self.assertEqual(code, 0)
        self.assertIn('nothing to merge', output)
        self.assertEqual(self.workspace_state(), applied)

    def test_rerun_after_renaming_a_label_matched_column_adds_a_duplicate(self):
        self.legacy('17', [col('Risk', identity=uid(1))], {}, [('101', 'story', uid(1), '1')])
        self.live_group('group-x', [group_col(10, 'Risk')], revision=2)
        self.live_group('group-y', [group_col(10, 'Risk')], revision=2)
        self.assertEqual(self.merge_apply()[0], 0)
        self.assertIn('nothing to merge', self.merge_apply()[1])
        with db_engine.session_scope(self.url) as session:  # a label match leaves no marker: renaming it forgets the pairing
            schema = session.query(models.WorkspaceGroupReviewSchema).filter_by(workspace_id=self.workspace, group_id='group-x').one()
            schema.columns = [dict(column, label='Points') for column in schema.columns]
        output = self.merge()[1]
        self.assertIn('group group-x: columns added: epic 0, story 1', output)  # the documented limit
        self.assertIn('group group-y: columns added: epic 0, story 0', output)

    def test_group_filter_limits_the_targets_and_an_unknown_group_aborts(self):
        self.simple()
        self.assertEqual(self.merge_apply('--group', 'group-y')[0], 0)
        self.assertEqual(sorted(self.workspace_state()['schemas']), ['group-y'])
        with self.assertRaisesRegex(ValueError, 'unknown group ids: nope'):
            self.merge('--group', 'nope')
        with self.assertRaisesRegex(ValueError, '--group requires --merge'):
            self.adopt('--group', 'group-y')
        with self.assertRaisesRegex(ValueError, '--group needs valid group ids'):
            self.merge('--group', ' padded ')

    def test_list_statuses_and_a_bad_workspace_does_not_abort_the_survey(self):
        nothing, pending, needs, done, bad = (self.golden_workspace(uid(number)) for number in (11, 12, 13, 14, 15))

        def put(workspace, label='Risk', sprint='17'):
            column = col(label)
            self.legacy(sprint, [column], {'story': {'order': ['status', column['id']], 'hidden': []}},
                        [('101', 'story', column['id'], '1')], workspace=workspace)
        put(pending)
        put(needs)
        self.live_group('group-x', [group_col(10, 'Other')], revision=1, workspace=needs)
        put(done)
        self.assertEqual(self.apply(done)[0], 0)
        repeated = col('Risk', identity=uid(77))
        self.legacy('17', [repeated], {}, [], workspace=bad)
        self.legacy('18', [dict(repeated, label='Different')], {}, [], workspace=bad)
        self.live_group('group-x', [group_col(10, 'Other')], revision=1, workspace=bad)
        output = self.list_output()
        for workspace, line in ((nothing, 'legacy_reviews=0 group_schemas=0 group_views=0 status=nothing to adopt'),
                                (pending, 'legacy_reviews=1 group_schemas=0 group_views=0 status=pending'),
                                (needs, 'legacy_reviews=1 group_schemas=1 group_views=0 status=needs-merge'),
                                (done, 'legacy_reviews=1 group_schemas=2 group_views=2 status=adopted'),
                                (bad, 'legacy_reviews=2 group_schemas=1 group_views=0 status=error')):
            self.assertIn(f'workspace {workspace} {line}', output)

    def test_a_plan_above_the_row_ceiling_aborts_before_any_lock(self):
        column = col('Risk')
        self.legacy('17', [column], {}, [(str(100 + number), 'story', column['id'], '1') for number in range(5)])
        locked = []
        with patch.object(adopt, 'MERGE_MAX_INSERT_ROWS', 4), \
                patch.object(review, '_locked_schema', side_effect=lambda *args: locked.append(args)):
            with self.assertRaisesRegex(ValueError, 'group group-x would insert 6 rows, above the 4 ceiling'):
                self.merge_apply()
        self.assertEqual(locked, [])

    def test_merge_output_has_counts_and_ids_only_even_with_secrets_on_both_sides(self):
        self.legacy('17', [col('LegacySecretLabel', type_='text', identity=uid(1))], {},
                    [('987654321', 'story', uid(1), 'LegacySecretValue')])
        self.live_group('group-x', [group_col(10, 'legacysecretlabel', type_='text'), group_col(11, 'GroupSecretLabel', type_='text')],
                        revision=2, cells=[('987654322', 'story', uid(11), 'GroupSecretValue')])
        dry = self.merge()[1]
        applied = self.merge_apply()[1]
        for text_ in (dry, applied):
            for secret in ('SecretLabel', 'SecretValue', '98765432', 'secretlabel'):
                self.assertNotIn(secret, text_)

    def test_merge_never_modifies_legacy_rows(self):
        self.simple()
        self.legacy('18', [col('Gone', archived=True)], {'epic': {'order': [], 'hidden': []}})
        before = self.legacy_state()
        self.merge_apply()
        self.merge_apply()
        self.assertEqual(self.legacy_state(), before)

    def test_merge_workspace_isolation_with_the_same_group_id_in_two_workspaces(self):
        other = self.golden_workspace(uid(21))
        self.legacy('17', [col('Risk', identity=uid(1))], {}, [('101', 'story', uid(1), '1')])
        self.legacy('17', [col('Else', identity=uid(2))], {}, [('201', 'story', uid(2), '2')], workspace=other)
        # In the other workspace the same group id archived this very column id: it must not leak into this plan.
        self.live_group('group-x', [group_col(1, 'Risk', archived=True)], revision=3, workspace=other)
        elsewhere = self.workspace_state(other)
        self.assertEqual(self.merge_apply()[0], 0)
        self.assertIn(uid(1), self.workspace_state()['schemas']['group-x'][1])
        self.assertEqual(self.workspace_state(other), elsewhere)

    def test_default_mode_still_refuses_with_a_merge_pointer(self):
        self.simple()
        digest = self.digest()
        self.live_group('group-x', [group_col(10, 'Other')], revision=1)
        before = self.workspace_state()
        with self.assertRaisesRegex(ValueError, 'already exist.*re-run with --merge'):
            self.adopt('--apply', '--expected-sha256', digest)
        self.assertEqual(self.workspace_state(), before)

    def test_merge_after_fresh_adoption_and_live_use_restores_only_missing_data(self):
        alpha, beta = col('Alpha', identity=uid(1)), col('Beta', identity=uid(2))
        self.legacy('17', [alpha, beta], {}, [('101', 'story', uid(1), '1'), ('102', 'story', uid(2), '2')])
        self.assertEqual(self.apply()[0], 0)  # the fresh adoption
        self.live_schema({'action': 'rename', 'columnId': uid(1), 'label': 'Renamed'})
        self.live_schema({'action': 'archive', 'columnId': uid(2), 'archived': True})
        self.live_schema({'action': 'add', 'column': {'id': uid(30), 'rowKind': 'story', 'label': 'Live', 'type': 'number', 'aggregation': 'sum'}})
        self.legacy('18', [col('Alpha', identity=uid(1)), col('Late', identity=uid(3))], {},
                    [('103', 'story', uid(1), '3'), ('104', 'story', uid(3), '4')])  # a late legacy row appears
        before = self.cells()
        self.assertEqual(self.merge_apply()[0], 0)
        revision, columns = self.schema()
        self.assertEqual(revision, 5)
        self.assertEqual([(c['id'], c['label'], c['archived']) for c in columns],
                         [(uid(1), 'Renamed', False), (uid(2), 'Beta', True), (uid(30), 'Live', False), (uid(3), 'Late', False)])
        self.assertEqual(sorted(set(self.cells()) - set(before)), [('103', 'story', uid(1), '3', 1), ('104', 'story', uid(3), '4', 1)])
        self.assertTrue(set(before) <= set(self.cells()))
        self.assertEqual(self.schema('group-y')[0], 2)  # the untouched group got the late column too
        self.assertIn(('104', 'story', uid(3), '4', 1), self.cells('group-y'))

    def test_after_a_merge_reads_return_the_merged_data_and_stale_clients_conflict(self):
        self.legacy('17', [col('Risk', identity=uid(1))], {'story': {'order': ['status', uid(1)], 'hidden': []}},
                    [('101', 'story', uid(1), '1.000'), ('102', 'story', uid(1), '2.000')])
        self.live_group('group-x', [group_col(10, 'Other')], revision=2, views=[('200', {'story': {'order': ['status'], 'hidden': []}})])
        context, search = self.live_context(), Mock(side_effect=self.live_search)
        self.assertEqual(self.merge_apply('--group', 'group-x')[0], 0)
        loaded = review.load_review(context, '17', 'group-x', self.url)
        self.assertEqual([c['id'] for c in loaded['columns']], [uid(10), uid(1)])
        self.assertEqual((loaded['schemaRevision'], loaded['viewRevision'], loaded['inheritedFrom']), (3, 1, None))
        self.assertEqual(loaded['layouts'], {'story': {'order': ['status', uid(1)], 'hidden': []}})
        values = review.read_values(context, '17', {'groupId': 'group-x', 'issueIds': ['101', '102'], 'rowKind': 'story'}, self.url, search)
        self.assertEqual(sorted((c['issueId'], c['value'], c['revision']) for c in values['cells']),
                         [('101', '1.000', 1), ('102', '2.000', 1)])

        def conflict(payload):  # a client that loaded before the merge still holds schema revision 2, view 0, cell revision 0
            with self.assertRaises(review.ReviewError) as caught:
                review.save_review(context, '17', payload, self.url, search)
            self.assertEqual((caught.exception.code, caught.exception.status), ('review_conflict', 409))
            return caught.exception.details
        added = {'action': 'add', 'column': {'id': uid(30), 'rowKind': 'story', 'label': 'Late', 'type': 'number', 'aggregation': 'sum'}}
        self.assertTrue(conflict({'groupId': 'group-x', 'baseSchemaRevision': 2, 'schemaChanges': [added], 'cellChanges': []})['schemaConflict'])
        layout = {'action': 'layout', 'rowKind': 'story', 'order': ['status'], 'hidden': []}
        self.assertTrue(conflict({'groupId': 'group-x', 'baseSchemaRevision': 3, 'baseViewRevision': 0,
                                  'schemaChanges': [layout], 'cellChanges': []})['viewConflict'])
        draft = {'issueId': '101', 'rowKind': 'story', 'columnId': uid(1), 'value': '9', 'baseRevision': 0}
        details = conflict({'groupId': 'group-x', 'baseSchemaRevision': 3, 'schemaChanges': [], 'cellChanges': [draft]})
        self.assertEqual([(c['issueId'], c['value'], c['revision']) for c in details['cellConflicts']], [('101', '1.000', 1)])
        untouched = dict(draft, issueId='103')  # a draft on a cell the merge did not insert is unaffected
        saved = review.save_review(context, '17', {'groupId': 'group-x', 'baseSchemaRevision': 3, 'schemaChanges': [],
                                                   'cellChanges': [untouched]}, self.url, search)
        self.assertEqual([(c['issueId'], c['revision']) for c in saved['cells']], [('103', 1)])

    def test_read_group_state_treats_an_untouched_row_as_absent(self):
        self.live_group('group-x', [], revision=0)
        self.live_group('group-y', [], revision=0, views=[('9', {})])
        with db_engine.session_scope(self.url) as session:
            state = adopt._read_group_state(session, self.workspace, ['group-x', 'group-y'], set())
        self.assertEqual((state['group-x']['exists'], state['group-y']['exists']), (False, True))

    def test_merge_runs_from_the_repo_root_with_exit_codes(self):
        self.simple()
        base = [sys.executable, 'scripts/adopt_legacy_sprint_reviews.py', '--workspace-id', self.workspace, '--merge']
        dry = subprocess.run(base, capture_output=True, text=True, timeout=120, cwd=str(ROOT), env=dict(os.environ))
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertIn('dry-run only; no database changes applied', dry.stdout)
        refused = subprocess.run(base + ['--apply'], capture_output=True, text=True, timeout=120, cwd=str(ROOT), env=dict(os.environ))
        self.assertEqual(refused.returncode, 1)
        self.assertIn('ValueError', refused.stderr)
        self.assertTrue(self.empty())

    # Process isolation
    def test_fresh_interpreter_import_does_not_load_jira_server(self):
        code = ("import importlib.util, sys; sys.path.insert(0, sys.argv[1]); "
                "spec = importlib.util.spec_from_file_location('adopt_legacy_sprint_reviews', sys.argv[2]); "
                "module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); "
                "assert callable(module.main); print('jira_server' in sys.modules)")
        result = subprocess.run([sys.executable, '-I', '-c', code, str(ROOT), str(SCRIPT)],
                                capture_output=True, text=True, timeout=120, cwd=str(ROOT / 'tests'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'False')

    def test_runs_from_the_repo_root_with_exit_codes(self):
        self.simple()
        listed = subprocess.run([sys.executable, 'scripts/adopt_legacy_sprint_reviews.py', '--list'],
                                capture_output=True, text=True, timeout=120, cwd=str(ROOT), env=dict(os.environ))
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertIn(f'workspace {self.workspace} legacy_reviews=1', listed.stdout)
        refused = subprocess.run([sys.executable, 'scripts/adopt_legacy_sprint_reviews.py', '--workspace-id', self.workspace, '--apply'],
                                 capture_output=True, text=True, timeout=120, cwd=str(ROOT), env=dict(os.environ))
        self.assertEqual(refused.returncode, 1)
        self.assertIn('ValueError', refused.stderr)
        self.assertTrue(self.empty())


class AdoptionMergeResolutionTests(unittest.TestCase):
    """Resolution of legacy data against a group that already holds rows (merge mode, #299). Pure functions."""

    @staticmethod
    def legacy(sprint, columns=(), layouts=None, cells=()):
        return {'id': uid(7000 + int(sprint)), 'sprintId': str(sprint), 'schemaRevision': 1, 'columns': list(columns),
                'layouts': layouts or {}, 'cells': [[str(sprint), *cell, 1] for cell in cells]}

    @staticmethod
    def column(number, label, kind='story', type_='number', archived=False):
        return col(label, kind=kind, type_=type_, archived=archived, identity=uid(number))

    @staticmethod
    def group_column(number, label, kind='story', type_='number', archived=False, order=0, aggregation=None):
        return {'id': uid(number), 'rowKind': kind, 'label': label, 'type': type_, 'archived': archived, 'order': order,
                'after': None, 'aggregation': aggregation or ('sum' if type_ == 'number' else 'none')}

    @staticmethod
    def state(columns=(), revision=0, exists=None, cells=(), views=()):
        columns = list(columns)
        return {'exists': (bool(columns) or revision > 0) if exists is None else exists, 'revision': revision,
                'columns': columns, 'cells': set(cells), 'view_sprints': sorted(views, key=int)}

    @staticmethod
    def resolve(reviews, state=None):
        return adopt._resolve_group(adopt._normalize(reviews), state)

    def test_claim_by_id_survives_rename_and_archive_intent(self):
        risk = self.column(1, 'Risk')
        reviews = [self.legacy(17, [risk], cells=[('101', 'story', uid(1), '1.000')])]
        renamed = self.group_column(1, 'Points', order=2)
        result = self.resolve(reviews, self.state([renamed], revision=3))
        self.assertEqual((result['added'], result['matched'], result['revision']), ([], [(uid(1), uid(1))], 3))
        self.assertEqual((result['cells'], result['columns']), ([('101', 'story', uid(1), '1.000')], [renamed]))
        archived = self.group_column(1, 'Points', archived=True)  # archived in the group: skipped, never resurrected
        result = self.resolve(reviews, self.state([archived], revision=3))
        self.assertEqual((result['added'], result['matched'], result['cells'], result['empty']), ([], [], [], True))
        self.assertIn('group-archived keys skipped: 1, cells dropped 1', result['report'])
        live, gone = self.column(2, 'Intent'), self.column(3, 'intent', archived=True)  # intent changes nothing
        reviews = [self.legacy(17, [live], cells=[('101', 'story', uid(2), 'a')]), self.legacy(18, [gone])]
        result = self.resolve(reviews, self.state([self.group_column(2, 'Intent')], revision=1))
        self.assertEqual((result['added'], result['matched'], result['cells']), ([], [], []))
        self.assertIn('archive intent: keys 1, cells dropped 1', result['report'])

    def test_claim_by_id_requires_the_same_kind_and_type_and_aborts_on_ambiguity(self):
        story = self.column(1, 'Risk')
        for other in (self.group_column(1, 'Risk', kind='epic'), self.group_column(1, 'Risk', type_='text')):
            with self.assertRaisesRegex(ValueError, '1 legacy column ids match a group column of another kind or type'):
                self.resolve([self.legacy(17, [story])], self.state([other], revision=1))
        again = self.column(2, 'risk')  # the same key under another id
        with self.assertRaisesRegex(ValueError, '1 legacy columns match more than one group column by id'):
            self.resolve([self.legacy(17, [story]), self.legacy(18, [again])],
                         self.state([self.group_column(1, 'Risk'), self.group_column(2, 'Risk')], revision=1))

    def test_label_match_is_one_to_one_lowest_order_then_position(self):
        risk = self.column(1, 'Risk')
        reviews = [self.legacy(17, [risk], cells=[('101', 'story', uid(1), '1.000')])]
        late, early, tied = self.group_column(10, 'Risk', order=3), self.group_column(11, ' risk ', order=1), self.group_column(12, 'RISK', order=1)
        result = self.resolve(reviews, self.state([late, early, tied], revision=2))
        self.assertEqual((result['matched'], result['added']), ([(uid(1), uid(11))], []))
        self.assertEqual(result['cells'], [('101', 'story', uid(11), '1.000')])
        other_type, other_kind = self.group_column(13, 'Risk', type_='text'), self.group_column(14, 'Risk', kind='epic')
        result = self.resolve(reviews, self.state([other_type, other_kind], revision=2))  # no match: a new column
        self.assertEqual(([c['id'] for c in result['added']], result['matched']), ([uid(1)], []))

    def test_a_renamed_adopted_column_is_never_claimed_twice(self):
        risk, impact = self.column(1, 'Risk'), self.column(2, 'Impact')
        reviews = [self.legacy(17, [risk], cells=[('101', 'story', uid(1), '1.000')]),
                   self.legacy(18, [impact], cells=[('101', 'story', uid(2), '2.000')])]
        renamed = self.group_column(1, 'Impact')  # adopted earlier as Risk, renamed since
        result = self.resolve(reviews, self.state([renamed], revision=2))
        self.assertEqual(result['matched'], [(uid(1), uid(1))])
        self.assertEqual([c['id'] for c in result['added']], [uid(2)])
        self.assertEqual(sorted(result['cells']), [('101', 'story', uid(1), '1.000'), ('101', 'story', uid(2), '2.000')])

    def test_a_group_archived_column_is_not_resurrected_and_its_cells_are_counted(self):
        risk = self.column(1, 'Risk')
        reviews = [self.legacy(17, [risk], cells=[('101', 'story', uid(1), '1'), ('102', 'story', uid(1), '2')])]
        archived = self.group_column(10, 'risk', archived=True)
        result = self.resolve(reviews, self.state([archived], revision=4))
        self.assertEqual((result['added'], result['cells'], result['matched'], result['empty']), ([], [], [], True))
        self.assertEqual(result['columns'], [archived])
        self.assertIn('group-archived keys skipped: 1, cells dropped 2', result['report'])
        live = self.group_column(11, 'Risk')  # a live column with the label beats the archived one
        result = self.resolve(reviews, self.state([archived, live], revision=4))
        self.assertEqual(result['matched'], [(uid(1), uid(11))])

    def test_a_matched_column_keeps_every_property_of_the_group_column(self):
        risk = col('Risk', aggregation='sum', identity=uid(1))
        group = self.group_column(10, 'RISK', order=5, aggregation='none')
        result = self.resolve([self.legacy(17, [risk])], self.state([group], revision=2))
        self.assertEqual((result['columns'], result['added'], result['matched']), ([group], [], [(uid(1), uid(10))]))

    def test_new_column_slots_count_existing_active_and_total_columns_across_kinds(self):
        fresh = [self.column(1, 'A'), self.column(2, 'B'), self.column(3, 'C')]
        reviews = [self.legacy(18, [fresh[0]]), self.legacy(19, [fresh[1]]), self.legacy(20, [fresh[2]])]
        full = [self.group_column(100 + i, f'G{i}', order=i) for i in range(29)]  # one Story slot left
        result = self.resolve(reviews, self.state(full, revision=1))
        self.assertEqual([c['id'] for c in result['added']], [uid(3)])
        self.assertIn(f'cap excluded: keys 2, cells dropped 0; members {uid(2)}@19 {uid(1)}@18', result['report'])
        crowded = ([self.group_column(1000 + i, f'AE{i}', kind='epic', archived=True) for i in range(100)]
                   + [self.group_column(2000 + i, f'AS{i}', archived=True) for i in range(100)]
                   + [self.group_column(3000 + i, f'LE{i}', kind='epic') for i in range(20)]
                   + [self.group_column(4000 + i, f'LS{i}') for i in range(19)])  # 239 columns, one total slot left
        new_epic, new_story = self.column(5, 'NewE', kind='epic'), self.column(6, 'NewS')
        result = self.resolve([self.legacy(18, [new_epic]), self.legacy(19, [new_story])], self.state(crowded, revision=1))
        self.assertEqual(([c['label'] for c in result['added']], len(result['columns'])), (['NewS'], 240))
        self.assertIn(f'cap excluded: keys 1, cells dropped 0; members {uid(5)}@18', result['report'])

    def test_the_total_column_cap_mirrors_apply_schema(self):
        self.assertEqual(adopt.MAX_TOTAL_COLUMNS, 240)
        archived = [self.group_column(i, f'C{i}', archived=True) for i in range(1, 242)]
        review.apply_schema(archived[:240], [])
        with self.assertRaises(review.ReviewError) as caught:
            review.apply_schema(archived, [])
        self.assertEqual(caught.exception.code, 'review_schema_limit')

    def test_a_live_cell_wins_including_a_retained_null(self):
        risk = self.column(1, 'Risk')
        reviews = [self.legacy(17, [risk], cells=[(issue, 'story', uid(1), value) for issue, value in (('101', '1'), ('102', '2'), ('103', '3'))])]
        live = {('101', 'story', uid(10)), ('102', 'story', uid(10))}  # 102 is a retained NULL
        result = self.resolve(reviews, self.state([self.group_column(10, 'Risk')], revision=2, cells=live))
        self.assertEqual(result['cells'], [('103', 'story', uid(10), '3')])
        self.assertIn('cells: inserted 1, skipped as live 2', result['report'])

    def test_a_live_view_wins_whole_and_an_older_legacy_view_is_inserted_remapped(self):
        risk = self.column(1, 'Risk')
        reviews = [self.legacy(100, [risk], {'story': {'order': ['status', uid(1)], 'hidden': []}}),
                   self.legacy(200, layouts={'story': {'order': ['status'], 'hidden': ['key']}})]
        result = self.resolve(reviews, self.state([self.group_column(10, 'Risk')], revision=2, views=['200']))
        self.assertEqual(result['views'], [('100', {'story': {'order': ['status', uid(10)], 'hidden': []}})])
        self.assertIn('views: inserted 1, skipped as live 1, skipped by cap 0, slots left 498', result['report'])
        self.assertIn('view 100 governs Sprint ids [100, 200)', result['report'])

    def test_zero_free_view_slots_insert_nothing(self):
        reviews = [self.legacy(sprint, layouts={'story': {'order': ['status'], 'hidden': []}}) for sprint in (100, 101)]
        with patch.object(review, 'MAX_GROUP_VIEWS', 2):
            result = self.resolve(reviews, self.state(revision=1, exists=True, views=['500', '600']))
            self.assertEqual(result['views'], [])
            self.assertIn('views: inserted 0, skipped as live 0, skipped by cap 2 (Sprints 100, 101), slots left 0', result['report'])
        with patch.object(review, 'MAX_GROUP_VIEWS', 0):  # the fresh path too (views[-0:] is the whole list)
            self.assertEqual(self.resolve(reviews)['views'], [])

    def test_the_report_names_view_intervals_and_remaining_slots(self):
        reviews = [self.legacy(sprint, layouts={'story': {'order': ['status'], 'hidden': []}}) for sprint in (100, 200, 400)]
        with patch.object(review, 'MAX_GROUP_VIEWS', 5):
            result = self.resolve(reviews, self.state(revision=1, exists=True, views=['300']))
        self.assertEqual([sprint for sprint, _ in result['views']], ['100', '200', '400'])
        for line in ('view 100 governs Sprint ids [100, 200)', 'view 200 governs Sprint ids [200, 300)',
                     'view 400 governs Sprint ids [400, open)',
                     'views: inserted 3, skipped as live 0, skipped by cap 0, slots left 1'):
            self.assertIn(line, result['report'])

    def test_revision_rules_and_the_empty_plan(self):
        risk = self.column(1, 'Risk')
        reviews = [self.legacy(17, [risk], cells=[('101', 'story', uid(1), '1')])]
        self.assertEqual(self.resolve(reviews, self.state())['revision'], 1)  # no row yet: created at 1
        self.assertEqual(self.resolve(reviews, self.state(revision=4, exists=True))['revision'], 5)  # a column is added
        self.assertEqual(self.resolve(reviews, self.state(revision=0, exists=True))['revision'], 1)
        matched = self.state([self.group_column(10, 'Risk')], revision=4)
        result = self.resolve(reviews, matched)  # matched column: only a cell is inserted, no revision change
        self.assertEqual((result['revision'], result['added'], len(result['cells'])), (4, [], 1))
        self.assertIn('schema revision: unchanged', result['report'])
        done = self.state([self.group_column(10, 'Risk')], revision=4, cells={('101', 'story', uid(10))})
        self.assertTrue(self.resolve(reviews, done)['empty'])


group_col = AdoptionMergeResolutionTests.group_column

# Captured from the unmodified script and checked against counts derived by hand from the fixtures
# (rich workspace: 10 reviews with content and 1 empty, 18 cells = 7 mapped [5 kept, 2 conflicts] + 1 archived + 3 intent
# + 4 cap + 3 orphan). Each tuple is (dry-run stdout, apply stdout, (schemas, cells, views) as (row count, sha256 prefix)).
_RICH_REPORT = (
    f'workspace {uid(1)} groups 2: group-x group-y\n'
    'legacy reviews 10 (skipped empty 1), legacy cells 18\n'
    'columns adopted: epic 30, story 30\n'
    f'merged {uid(3101)}: {uid(3101)}@13; archived {uid(3100)}@12\n'
    f'merged {uid(3200)}: {uid(3200)}@14 {uid(3201)}@15\n'
    'archive intent: keys 1, cells dropped 3\n'
    'archived members discarded: 1, cells dropped 1\n'
    f'cap excluded: keys 3, cells dropped 4; members {uid(1000)}@10 {uid(2000)}@10 {uid(2100)}@11 {uid(2001)}@10\n'
    'conflicting cell values dropped: 2\n'
    'orphan cells dropped: 3\n'
    'views: 3 written per group, skipped by cap 1 (Sprints 10)\n'
    'derived: story sum rollups 30, epic inherited 30\n'
    'group group-x: workspace_group_review_schemas=1 group_review_cells=5 group_sprint_review_views=3\n'
    'group group-y: workspace_group_review_schemas=1 group_review_cells=5 group_sprint_review_views=3\n'
    'sha256:d585664cead27674b5760b5e74caf30ec3bad5867e2e718c0156cacc788010ba\n')
GOLDEN_RICH = (_RICH_REPORT + 'dry-run only; no database changes applied\n', _RICH_REPORT + 'applied: 2 groups\n',
               ((2, '23cfad495609ff7d'), (10, 'cd803b24729363bf'), (6, '8e3eb23b5ae831c7')))

# An archive-only workspace and a layout-only workspace still get an empty revision-1 schema row in every group.
_ARCHIVE_ONLY_REPORT = (
    f'workspace {uid(2)} groups 2: group-x group-y\n'
    'legacy reviews 1 (skipped empty 0), legacy cells 0\n'
    'columns adopted: epic 0, story 0\n'
    'archive intent: keys 1, cells dropped 0\n'
    'archived members discarded: 0, cells dropped 0\n'
    'cap excluded: keys 0, cells dropped 0; members none\n'
    'conflicting cell values dropped: 0\n'
    'orphan cells dropped: 0\n'
    'views: 0 written per group, skipped by cap 0\n'
    'derived: story sum rollups 0, epic inherited 0\n'
    'group group-x: workspace_group_review_schemas=1 group_review_cells=0 group_sprint_review_views=0\n'
    'group group-y: workspace_group_review_schemas=1 group_review_cells=0 group_sprint_review_views=0\n'
    'sha256:38da22ea2bbee8604164aea9d0fd75aaf5e40794eb308283373388a88faf1418\n')
GOLDEN_ARCHIVE_ONLY = (_ARCHIVE_ONLY_REPORT + 'dry-run only; no database changes applied\n',
                       _ARCHIVE_ONLY_REPORT + 'applied: 2 groups\n',
                       ((2, '011ca447e5f7b66c'), (0, '4f53cda18c2baa0c'), (0, '4f53cda18c2baa0c')))

_LAYOUT_ONLY_REPORT = (
    f'workspace {uid(3)} groups 2: group-x group-y\n'
    'legacy reviews 1 (skipped empty 0), legacy cells 0\n'
    'columns adopted: epic 0, story 0\n'
    'archive intent: keys 0, cells dropped 0\n'
    'archived members discarded: 0, cells dropped 0\n'
    'cap excluded: keys 0, cells dropped 0; members none\n'
    'conflicting cell values dropped: 0\n'
    'orphan cells dropped: 0\n'
    'views: 1 written per group, skipped by cap 0\n'
    'derived: story sum rollups 0, epic inherited 0\n'
    'group group-x: workspace_group_review_schemas=1 group_review_cells=0 group_sprint_review_views=1\n'
    'group group-y: workspace_group_review_schemas=1 group_review_cells=0 group_sprint_review_views=1\n'
    'sha256:0c129877fe175ecc2934ee693dd6c742c931faf3923acce1aafbc459be1fb01d\n')
GOLDEN_LAYOUT_ONLY = (_LAYOUT_ONLY_REPORT + 'dry-run only; no database changes applied\n',
                      _LAYOUT_ONLY_REPORT + 'applied: 2 groups\n',
                      ((2, '2227f9ae11ea6f9d'), (0, '4f53cda18c2baa0c'), (2, 'd503cd3128994d50')))


if __name__ == '__main__':
    unittest.main()
