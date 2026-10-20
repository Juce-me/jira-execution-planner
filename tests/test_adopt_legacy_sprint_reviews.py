"""Legacy per-Sprint review adoption into Department-group tables (#267, AC 22).

Legacy fixtures are built through the retained legacy models because save_review
writes only the new group tables. All data is synthetic.
"""
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
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


if __name__ == '__main__':
    unittest.main()
