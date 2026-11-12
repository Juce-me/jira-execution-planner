"""Isolated review namespaces for the quarterly work-structure model (Task 5B/5C/5E).

Runs on per-test PostgreSQL databases: it proves constraints, migration retention, isolation and cap
arithmetic, not row-lock concurrency (see tests/test_sprint_review_postgresql.py, opt-in). All data is synthetic.
"""
from copy import deepcopy
import os
from pathlib import Path
import unittest
import uuid
from unittest.mock import Mock, patch

from alembic import command
from alembic.config import Config
from sqlalchemy import event, inspect, text
from sqlalchemy.exc import IntegrityError

from backend.db import engine as db_engine, models
from backend.services import sprint_review as review
from tests.postgres_test_db import fresh_database_url
from tests.test_sprint_review import ReviewFixture

ROOT = Path(__file__).resolve().parents[1]
PREVIOUS_HEAD, HEAD = '20261029_0022', '20261030_0022'
CFG, OTHER_CFG = 'cfg-2027q1', 'cfg-2027q2'
EPIC_TYPE, INITIATIVE_TYPE = '10001', '10002'
TYPE_MAP = {'epic': (EPIC_TYPE, 1), 'initiative': (INITIATIVE_TYPE, 2)}
Q1_2027 = review.quarter_ordinal_for(2027, 1)


def column(kind, label, type_='number'):
    return {'id': str(uuid.uuid4()), 'rowKind': kind, 'label': label, 'type': type_,
            'aggregation': 'sum' if type_ == 'number' else 'none'}


class NamespaceFixture(ReviewFixture):
    """ReviewFixture whose Jira stub also answers with mapped issue type ids and hierarchy levels."""

    def setUp(self):
        super().setUp()
        self.mapped = {'101': (EPIC_TYPE, 1), '102': (EPIC_TYPE, 1), '900': (INITIATIVE_TYPE, 2), '901': (INITIATIVE_TYPE, 2)}

    def _search(self, payload, **kwargs):
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')

        def issue(identity):
            type_id, level = self.mapped.get(identity, ('10003', 0))
            name = 'Epic' if identity in self.epics else 'Story'
            return {'id': identity, 'fields': {'issuetype': {'id': type_id, 'name': name, 'subtask': False, 'hierarchyLevel': level}}}
        return Mock(status_code=200, json=lambda: {'issues': [issue(i) for i in ids], 'isLast': True})

    def nsave(self, cells=None, schemas=None, base=0, sprint='17', view=None, cfg=CFG, ordinal=Q1_2027, type_map=TYPE_MAP):
        payload = {'groupId': self.group_id, 'baseSchemaRevision': base, 'schemaChanges': schemas or [], 'cellChanges': cells or []}
        if view is not None:
            payload['baseViewRevision'] = view
        return review.save_review(self.context, sprint, payload, self.url, self.search, configuration_id=cfg,
                                  quarter_ordinal=ordinal, type_map=type_map)

    def nload(self, sprint='17', cfg=CFG, ordinal=Q1_2027):
        return review.load_review(self.context, sprint, self.group_id, self.url, configuration_id=cfg, quarter_ordinal=ordinal)

    def nread(self, ids, kind, cfg=CFG, sprint='17'):
        return review.read_values(self.context, sprint, {'groupId': self.group_id, 'issueIds': ids, 'rowKind': kind},
                                  self.url, self.search, configuration_id=cfg, type_map=TYPE_MAP)

    def add_columns(self, *columns, cfg=CFG, base=0):
        return self.nsave(schemas=[{'action': 'add', 'column': c} for c in columns], base=base, cfg=cfg)

    def schema_rows(self):
        with db_engine.session_scope(self.url) as session:
            return sorted((s.configuration_id or '', s.schema_revision, len(s.columns))
                          for s in session.query(models.WorkspaceGroupReviewSchema).all())

    def statements(self, fn, *args, **kwargs):
        captured = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, *rest: captured.append(statement)
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            fn(*args, **kwargs)
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        return captured


class NamespaceIsolationTests(NamespaceFixture, unittest.TestCase):
    def test_new_epic_and_initiative_definitions_values_and_layouts_are_independent_of_legacy(self):
        legacy_epic, legacy_story = column('epic', 'Legacy parent'), column('story', 'Legacy child')
        self.epics = {'101'}
        self.save(schemas=[{'action': 'add', 'column': legacy_epic}, {'action': 'add', 'column': legacy_story}], base=0)
        self.save([self.cell('9.0', column=legacy_epic['id'], kind='epic')], base=1)
        self.save(schemas=[self.layout('epic', order=['status', legacy_epic['id']])], base=1, view=0)
        new_epic, new_initiative = column('epic', 'Quarter child'), column('initiative', 'Quarter parent')
        saved = self.add_columns(new_epic, new_initiative)
        self.assertEqual((saved['configurationId'], saved['schemaRevision']), (CFG, 1))
        self.nsave([{'issueId': '101', 'rowKind': 'epic', 'columnId': new_epic['id'], 'value': '3', 'baseRevision': 0},
                    {'issueId': '900', 'rowKind': 'initiative', 'columnId': new_initiative['id'], 'value': '5', 'baseRevision': 0}], base=1)
        layouts = self.nsave(schemas=[
            {'action': 'layout', 'rowKind': 'epic', 'order': ['status', 'initiative', new_epic['id']], 'hidden': ['key']},
            {'action': 'layout', 'rowKind': 'initiative', 'order': ['status', 'teamsInScope', new_initiative['id']], 'hidden': []}],
            base=1, view=0)
        self.assertEqual(layouts['viewRevision'], 1)
        # Legacy keeps exactly its own columns, values and layout; the new namespace has its own.
        legacy = self.load()
        self.assertEqual([c['id'] for c in legacy['columns']], [legacy_epic['id'], legacy_story['id']])
        self.assertEqual(legacy['layouts'], {'epic': {'order': ['status', legacy_epic['id']], 'hidden': []}})
        self.assertEqual([c['value'] for c in self.read(['101'], 'epic')['cells']], ['9.000'])
        fresh = self.nload()
        self.assertEqual([c['id'] for c in fresh['columns']], [new_epic['id'], new_initiative['id']])
        self.assertEqual(fresh['layouts']['epic']['order'], ['status', 'initiative', new_epic['id']])
        self.assertEqual([c['value'] for c in self.nread(['101'], 'epic')['cells']], ['3.000'])
        self.assertEqual([c['value'] for c in self.nread(['900'], 'initiative')['cells']], ['5.000'])
        # The same Epic issue has a different value in each namespace; neither sees the other's column.
        self.assertEqual([c['columnId'] for c in self.nread(['101'], 'epic')['cells']], [new_epic['id']])
        self.assertEqual([c['columnId'] for c in self.read(['101'], 'epic')['cells']], [legacy_epic['id']])
        self.assertEqual(self.schema_rows(), [('', 1, 2), (CFG, 1, 2)])
        # A second configuration is a third, empty namespace.
        self.assertEqual(self.nload(cfg=OTHER_CFG)['columns'], [])

    def test_builtin_sets_follow_the_role_table(self):
        self.assertIn('initiative', review.layout_builtins(CFG)['epic'])
        self.assertNotIn('epic', review.layout_builtins(CFG)['epic'])
        self.assertIn('teamsInScope', review.layout_builtins(CFG)['initiative'])
        self.assertNotIn('initiative', review.layout_builtins(None)['story'])
        self.assertEqual(review.layout_builtins(None), review.REVIEW_LAYOUT_BUILTINS)
        parent = {'status', 'priority', 'storyPoints', 'accepted', 'team', 'teamsInScope', 'project', 'assignee', 'deliveryOwner', 'components', 'capacity', 'projectTrack'}
        self.assertEqual(review.layout_builtins(CFG)['initiative'], parent)
        self.assertEqual(review.layout_builtins(None)['epic'], parent)
        self.assertEqual(review.layout_builtins(CFG)['epic'], (parent - {'teamsInScope'}) | {'initiative'})
        self.assertEqual(review.layout_builtins(None)['story'], (parent - {'teamsInScope'}) | {'epic'})
        for bad in ({'rowKind': 'epic', 'order': ['epic']}, {'rowKind': 'initiative', 'order': ['initiative']},
                    {'rowKind': 'epic', 'order': ['story']}):
            with self.subTest(bad=bad):
                self.assert_error('invalid_review_request', 400, self.nsave, schemas=[{'action': 'layout', 'hidden': [], **bad}], view=0)
        self.assert_error('invalid_review_request', 400, self.save, schemas=[self.layout('epic', order=['initiative'])], view=0)
        self.assert_error('invalid_review_request', 400, self.save, schemas=[self.layout('story', order=['epic', 'initiative'])], view=0)
        self.assertEqual(self.counts(), (0, 0, 0))

    def test_row_kinds_are_validated_per_namespace(self):
        self.assert_error('invalid_review_request', 400, self.add_columns, column('story', 'Nope'))
        self.assert_error('invalid_review_request', 400, self.save, schemas=[{'action': 'add', 'column': column('initiative', 'Nope')}], base=0)
        self.assert_error('invalid_review_request', 400, self.nread, ['101'], 'story')
        self.assert_error('invalid_review_request', 400, self.read, ['101'], 'initiative')
        self.assertEqual(self.counts(), (0, 0, 0))

    def test_unmapped_or_wrong_level_ids_are_rejected_for_the_new_model(self):
        initiative = column('initiative', 'Parent')
        self.add_columns(initiative)
        cell = {'issueId': '900', 'rowKind': 'initiative', 'columnId': initiative['id'], 'value': '1', 'baseRevision': 0}
        wrong_kind = {**cell, 'issueId': '101'}                  # a mapped Epic written as an Initiative
        error = self.assert_error('review_issues_unavailable', 403, self.nsave, [wrong_kind], base=1)
        self.assertEqual(error.details['unavailableIssueIds'], ['101'])
        self.mapped['900'] = (INITIATIVE_TYPE, 1)                # right type id, wrong hierarchy level
        self.assert_error('review_issues_unavailable', 403, self.nsave, [cell], base=1)
        self.mapped['900'] = ('99999', 2)                        # wrong type id, right level
        self.assert_error('review_issues_unavailable', 403, self.nsave, [cell], base=1)
        self.mapped['900'] = (INITIATIVE_TYPE, 2)
        self.assert_error('review_issues_unavailable', 403, self.nsave, [cell], base=1, type_map={'initiative': ('77777', 2)})
        self.assert_error('review_issues_unavailable', 403, self.nsave, [{**cell, 'issueId': '555'}], base=1)
        self.assertEqual(self.counts()[1], 0)
        self.assertEqual(self.nsave([cell], base=1)['cells'][0]['revision'], 1)
        # Reading unauthorized ids reports them unavailable rather than returning values.
        self.mapped['900'] = (INITIATIVE_TYPE, 1)
        read = self.nread(['900'], 'initiative')
        self.assertEqual((read['cells'], read['unavailableIssueIds']), ([], ['900']))

    def test_a_type_map_is_required_with_requested_kinds_and_must_be_well_formed(self):
        self.assert_error('invalid_review_request', 400, review.authorize_issues, self.context, ['101'], self.search, {'101': {'epic'}}, {'epic': (1, 1)})
        self.assert_error('invalid_review_request', 400, review.authorize_issues, self.context, ['101'], self.search, None, TYPE_MAP)
        self.assert_error('invalid_review_request', 400, review.authorize_issues, self.context, ['101'], self.search, {'101': {'epic'}}, {'task': ('1', 1)})

    def test_legacy_name_and_level_authorization_is_unchanged(self):
        self.epics = {'101'}
        self.assertEqual(review.authorize_issues(self.context, ['101', '102'], self.search, {'101': {'epic'}, '102': {'story'}}), {'101'})

    def test_empty_requests_and_reads_create_no_rows(self):
        self.assertEqual(self.nsave()['cells'], [])
        self.nload()
        self.nread(['101'], 'epic')
        self.load()
        self.assertEqual(self.counts(), (0, 0, 0))

    def test_first_create_takes_the_legacy_fence_row_before_the_namespace_row(self):
        statements = self.statements(self.add_columns, column('epic', 'Child'))
        writes = [s for s in statements if s.lstrip().upper().startswith(('INSERT', 'SELECT')) and 'workspace_group_review_schemas' in s
                  and 'workspace_group_configs' not in s]
        shape = [('INSERT' if s.lstrip().upper().startswith('INSERT') else 'SELECT',
                  'configuration_id IS NULL' in s, 'configuration_id = %(' in s) for s in writes]
        self.assertEqual(shape[:4], [('INSERT', False, False), ('SELECT', True, False),
                                     ('INSERT', False, False), ('SELECT', False, True)], statements)
        self.assertEqual(self.schema_rows(), [('', 0, 0), (CFG, 1, 1)])
        # The fence row is the empty Legacy row: it carries no columns and Legacy adoption treats it as absent.
        self.assertEqual(self.load()['columns'], [])

    def test_legacy_save_does_not_create_a_namespace_row(self):
        self.add()
        self.assertEqual(self.schema_rows(), [('', 1, 1)])


class NamespaceCapTests(NamespaceFixture, unittest.TestCase):
    def seed_schema(self, cfg, columns):
        with db_engine.session_scope(self.url) as session:
            session.add(models.WorkspaceGroupReviewSchema(workspace_id=self.workspace, group_id=self.group_id, configuration_id=cfg,
                                                          schema_revision=1, columns=columns))

    def archived(self, kind, count):
        return [{**column(kind, f'Old {n}'), 'archived': True, 'order': n, 'after': None} for n in range(count)]

    def test_active_columns_are_capped_per_native_kind_per_namespace(self):
        self.add_columns(*[column('epic', f'E{n}') for n in range(30)])
        self.assert_error('review_column_limit', 400, self.add_columns, column('epic', 'E30'), base=1)
        # Another kind in the same namespace and the same kind in Legacy have their own 30.
        self.nsave(schemas=[{'action': 'add', 'column': column('initiative', f'I{n}')} for n in range(30)], base=1)
        self.save(schemas=[{'action': 'add', 'column': column('epic', f'L{n}')} for n in range(30)], base=0)
        self.assert_error('review_column_limit', 400, self.save,
                          schemas=[{'action': 'add', 'column': column('epic', 'L30')}], base=1)

    def test_total_definitions_are_capped_per_group_across_namespaces(self):
        self.seed_schema(None, self.archived('story', 200))
        self.seed_schema(CFG, self.archived('epic', 39))
        self.nsave(schemas=[{'action': 'add', 'column': column('epic', 'Fits')}], base=1)       # 240 in total
        self.assert_error('review_schema_limit', 400, self.nsave, schemas=[{'action': 'add', 'column': column('epic', 'Over')}], base=2)
        self.assert_error('review_schema_limit', 400, self.save, schemas=[{'action': 'add', 'column': column('story', 'Over')}], base=1)
        # A second configuration cannot multiply the group limit.
        self.assert_error('review_schema_limit', 400, self.add_columns, column('epic', 'Third'), cfg=OTHER_CFG)
        # Other groups are unaffected.
        other = review.save_review(self.context, '17', {'groupId': 'group-y', 'baseSchemaRevision': 0, 'cellChanges': [],
                                   'schemaChanges': [{'action': 'add', 'column': column('story', 'Elsewhere')}]}, self.url, self.search)
        self.assertEqual(other['schemaRevision'], 1)

    def test_saved_views_are_capped_per_group_across_namespaces(self):
        with db_engine.session_scope(self.url) as session:
            for n in range(499):
                cfg = None if n % 2 else CFG
                session.add(models.GroupSprintReviewView(
                    workspace_id=self.workspace, group_id=self.group_id, sprint_id=str(1000 + n), configuration_id=cfg,
                    quarter_ordinal=None if cfg is None else Q1_2027, sprint_order=review.sprint_order(str(1000 + n)),
                    layouts={}, view_revision=1))
        layout = {'action': 'layout', 'rowKind': 'epic', 'order': ['status'], 'hidden': []}
        self.assertEqual(self.nsave(schemas=[layout], view=0, sprint='5000')['viewRevision'], 1)     # the 500th
        self.assert_error('review_view_limit', 400, self.nsave, schemas=[layout], view=0, sprint='5001')
        self.assert_error('review_view_limit', 400, self.save, schemas=[self.layout()], view=0, sprint='5002')
        # An existing view still updates at the cap.
        self.assertEqual(self.nsave(schemas=[layout], view=1, sprint='5000')['viewRevision'], 2)


class NamespaceInheritanceTests(NamespaceFixture, unittest.TestCase):
    def layout(self, kind='epic', order=('status',)):
        return {'action': 'layout', 'rowKind': kind, 'order': list(order), 'hidden': []}

    def test_ordinal_formula(self):
        self.assertEqual((review.quarter_ordinal_for(1, 1), review.quarter_ordinal_for(2026, 3), Q1_2027), (0, 8106 - 4, 8104))
        for year, quarter in ((0, 1), (2027, 0), (2027, 5), (True, 1), ('2027', 1), (2027, 1.0)):
            with self.subTest(year=year, quarter=quarter):
                self.assert_error('invalid_review_request', 400, review.quarter_ordinal_for, year, quarter)

    def test_views_stamp_the_authoritative_ordinal(self):
        self.nsave(schemas=[self.layout()], view=0, sprint='900', ordinal=Q1_2027)
        with db_engine.session_scope(self.url) as session:
            view = session.query(models.GroupSprintReviewView).one()
            self.assertEqual((view.configuration_id, view.quarter_ordinal, view.sprint_order), (CFG, Q1_2027, review.sprint_order('900')))
        self.nsave(schemas=[self.layout(order=('priority',))], view=1, sprint='900', ordinal=Q1_2027 + 1)
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintReviewView).one().quarter_ordinal, Q1_2027 + 1)

    def test_a_configuration_layout_save_without_an_ordinal_is_refused_and_writes_nothing(self):
        self.assert_error('review_quarter_unresolved', 400, self.nsave, schemas=[self.layout()], view=0, ordinal=None)
        self.assertEqual(self.counts(), (0, 0, 0))
        # Column and cell saves do not stamp a view, so they do not need one.
        self.nsave(schemas=[{'action': 'add', 'column': column('epic', 'Plain')}], ordinal=None)

    def test_inheritance_follows_the_ordinal_not_the_physical_sprint_id(self):
        # Reversed numeric order: the earlier quarter holds the larger Sprint id.
        self.nsave(schemas=[self.layout(order=('status', 'team'))], view=0, sprint='900', ordinal=Q1_2027)
        later = self.nload(sprint='100', ordinal=Q1_2027 + 4)
        self.assertEqual((later['layouts']['epic']['order'], later['viewRevision'], later['inheritedFrom']),
                         (['status', 'team'], 0, {'sprintId': '900', 'viewRevision': 1}))
        # A numerically later Sprint in an earlier quarter does not inherit it.
        earlier = self.nload(sprint='1000', ordinal=Q1_2027 - 1)
        self.assertEqual((earlier['layouts'], earlier['inheritedFrom']), ({}, None))
        # An unresolved ordinal is an exact historical read only, whatever the ids say.
        unresolved = self.nload(sprint='1000', ordinal=None)
        self.assertEqual((unresolved['layouts'], unresolved['inheritedFrom']), ({}, None))
        exact = self.nload(sprint='900', ordinal=None)
        self.assertEqual((exact['layouts']['epic']['order'], exact['viewRevision'], exact['inheritedFrom']), (['status', 'team'], 1, None))
        # The nearest earlier ordinal wins; an edited range that moves a Sprint to another ordinal changes the answer.
        self.nsave(schemas=[self.layout(order=('priority',))], view=0, sprint='50', ordinal=Q1_2027 + 2)
        self.assertEqual(self.nload(sprint='60', ordinal=Q1_2027 + 3)['layouts']['epic']['order'], ['priority'])
        self.assertEqual(self.nload(sprint='60', ordinal=Q1_2027 + 1)['layouts']['epic']['order'], ['status', 'team'])
        # A view in the same quarter does not stand in for chronology the ids cannot give.
        self.assertEqual(self.nload(sprint='70', ordinal=Q1_2027 + 2)['layouts']['epic']['order'], ['status', 'team'])

    def test_legacy_and_configuration_views_never_inherit_across_eras(self):
        self.save(schemas=[self.layout('story', ('priority',))], view=0, sprint='5')
        self.nsave(schemas=[self.layout()], view=0, sprint='900', ordinal=Q1_2027)
        legacy = self.load(sprint='950')
        self.assertEqual(legacy['layouts'], {'story': {'order': ['priority'], 'hidden': []}})
        self.assertEqual(legacy['inheritedFrom'], {'sprintId': '5', 'viewRevision': 1})
        self.assertEqual(self.nload(sprint='6', ordinal=Q1_2027 + 4)['inheritedFrom'], {'sprintId': '900', 'viewRevision': 1})
        self.assertEqual(self.load(sprint='900')['layouts'], {'story': {'order': ['priority'], 'hidden': []}})
        self.assertEqual(self.nload(sprint='5', ordinal=Q1_2027 - 4)['layouts'], {})
        self.assertEqual(self.nload(sprint='5', cfg=OTHER_CFG, ordinal=Q1_2027 + 9)['layouts'], {})
        # The same Sprint id keeps one view per namespace.
        self.assertEqual(self.nload(sprint='5', ordinal=None)['viewRevision'], 0)
        self.assertEqual(self.load(sprint='5')['viewRevision'], 1)

    def test_stale_view_and_schema_revisions_conflict_inside_one_namespace_only(self):
        self.nsave(schemas=[self.layout()], view=0, sprint='900')
        error = self.assert_error('review_conflict', 409, self.nsave, schemas=[self.layout(order=('team',))], view=0, sprint='900')
        self.assertEqual((error.details['viewConflict'], error.details['schemaConflict']), (True, False))
        self.assertEqual(self.save(schemas=[self.layout('story')], view=0, sprint='900')['viewRevision'], 1)


class IndexAndConstraintTests(NamespaceFixture, unittest.TestCase):
    def add_schema(self, session, cfg, group='group-x'):
        session.add(models.WorkspaceGroupReviewSchema(workspace_id=self.workspace, group_id=group, configuration_id=cfg,
                                                      schema_revision=0, columns=[]))
        session.flush()

    def add_view(self, session, cfg, sprint='1'):
        session.add(models.GroupSprintReviewView(workspace_id=self.workspace, group_id='group-x', sprint_id=sprint,
                                                 configuration_id=cfg, sprint_order=review.sprint_order(sprint), layouts={}, view_revision=1))
        session.flush()

    def test_null_and_non_null_uniqueness_are_enforced_separately(self):
        with db_engine.session_scope(self.url) as session:
            self.add_schema(session, None)
            self.add_schema(session, CFG)
            self.add_schema(session, OTHER_CFG)
            self.add_schema(session, None, 'group-y')
            self.add_view(session, None)
            self.add_view(session, CFG)
            self.add_view(session, OTHER_CFG)
        for cfg in (None, CFG):
            with self.subTest(table='schema', cfg=cfg), self.assertRaises(IntegrityError), db_engine.session_scope(self.url) as session:
                self.add_schema(session, cfg)
            with self.subTest(table='view', cfg=cfg), self.assertRaises(IntegrityError), db_engine.session_scope(self.url) as session:
                self.add_view(session, cfg)

    def test_initiative_cells_are_admitted_and_other_kinds_are_not(self):
        with db_engine.session_scope(self.url) as session:
            self.add_schema(session, CFG)
            schema_id = session.query(models.WorkspaceGroupReviewSchema).one().id
            for kind in ('epic', 'story', 'initiative'):
                session.add(models.GroupReviewCell(schema_id=schema_id, issue_id='1', row_kind=kind, column_id='c', value='v', revision=1))
        with self.assertRaises(IntegrityError), db_engine.session_scope(self.url) as session:
            session.add(models.GroupReviewCell(schema_id=schema_id, issue_id='1', row_kind='initiatives', column_id='d', value='v', revision=1))

    def test_model_declares_the_indexes_the_migration_creates(self):
        names = {i.name for t in (models.WorkspaceGroupReviewSchema, models.GroupSprintReviewView) for i in t.__table__.indexes}
        self.assertTrue({'uq_group_review_schema_legacy', 'uq_group_review_schema_configuration', 'uq_group_sprint_review_view_legacy',
                         'uq_group_sprint_review_view_configuration', 'ix_group_sprint_review_views_quarter'} <= names)


class MigrationTests(unittest.TestCase):
    SCHEMA_OLD = 'SELECT id, workspace_id, group_id, schema_revision, columns FROM workspace_group_review_schemas ORDER BY id'
    CELL_ALL = 'SELECT id, schema_id, issue_id, row_kind, column_id, value, revision FROM group_review_cells ORDER BY id'
    VIEW_OLD = 'SELECT id, workspace_id, group_id, sprint_id, sprint_order, layouts, view_revision FROM group_sprint_review_views ORDER BY id'
    LEGACY_ALL = ('SELECT id, workspace_id, sprint_id, schema_revision, columns, layouts FROM workspace_sprint_reviews ORDER BY id',
                  'SELECT id, review_id, issue_id, row_kind, column_id, value, revision FROM sprint_review_cells ORDER BY id')
    REVIEW_TABLES = "('workspace_group_review_schemas', 'group_review_cells', 'group_sprint_review_views')"
    SHAPE = ("SELECT table_name, concat_ws(' ', ordinal_position, column_name, data_type, is_nullable, column_default) "
             f"FROM information_schema.columns WHERE table_name IN {REVIEW_TABLES} "
             f"UNION ALL SELECT tablename, indexdef FROM pg_indexes WHERE tablename IN {REVIEW_TABLES} "
             "UNION ALL SELECT conrelid::regclass::text, conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint "
             f"WHERE conrelid::regclass::text IN {REVIEW_TABLES} ORDER BY 1, 2")

    def setUp(self):
        self.url = fresh_database_url(self.addCleanup)
        self.env = patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.url, 'DATABASE_CONNECTION_MODE': 'url'})
        self.env.start()
        self.config = Config(str(ROOT / 'backend' / 'db' / 'alembic.ini'))
        self.config.set_main_option('sqlalchemy.url', self.url)
        self.config.set_main_option('script_location', str(ROOT / 'backend' / 'db' / 'migrations'))

    def tearDown(self):
        self.env.stop()
        db_engine.dispose_engines()

    def sql(self, statement, **params):
        with db_engine.session_scope(self.url) as session:
            result = session.execute(text(statement), params)
            return [tuple(row) for row in result.all()] if result.returns_rows else []

    def populate(self):
        """Legacy rows as the previous head stored them, including Legacy-era cells of both kinds."""
        workspace = str(uuid.uuid4())
        with db_engine.session_scope(self.url) as session:
            session.add(models.Workspace(id=workspace, environment_key='synthetic-migrate', name='Synthetic'))
            session.flush()
            legacy = str(uuid.uuid4())
            session.execute(text("INSERT INTO workspace_sprint_reviews (id, workspace_id, sprint_id, schema_revision, columns, layouts) "
                                 "VALUES (:i, :w, '17', 3, :c, '{}')"), {'i': legacy, 'w': workspace, 'c': '[{"id": "legacy-synthetic"}]'})
            session.execute(text("INSERT INTO sprint_review_cells (id, review_id, issue_id, row_kind, column_id, value, revision) "
                                 "VALUES (:i, :r, '1', 'story', 'legacy-synthetic', 'v', 2)"), {'i': str(uuid.uuid4()), 'r': legacy})
            for group, columns in (('group-x', [{'id': str(uuid.uuid4()), 'rowKind': 'epic', 'label': 'Parent', 'type': 'number',
                                                 'aggregation': 'sum', 'archived': False, 'order': 0, 'after': None}]), ('group-y', [])):
                schema = str(uuid.uuid4())
                session.execute(text("INSERT INTO workspace_group_review_schemas (id, workspace_id, group_id, schema_revision, columns) "
                                     "VALUES (:i, :w, :g, 4, :c)"), {'i': schema, 'w': workspace, 'g': group, 'c': __import__('json').dumps(columns)})
                for kind in ('epic', 'story'):
                    session.execute(text("INSERT INTO group_review_cells (id, schema_id, issue_id, row_kind, column_id, value, revision) "
                                         "VALUES (:i, :s, '101', :k, 'c1', '1.000', 5)"), {'i': str(uuid.uuid4()), 's': schema, 'k': kind})
            for sprint in ('9', '17', '300'):
                session.execute(text("INSERT INTO group_sprint_review_views (id, workspace_id, group_id, sprint_id, sprint_order, layouts, view_revision) "
                                     "VALUES (:i, :w, 'group-x', :s, :o, '{\"epic\": {\"order\": [\"status\"], \"hidden\": []}}', 2)"),
                                {'i': str(uuid.uuid4()), 'w': workspace, 's': sprint, 'o': review.sprint_order(sprint)})
        return workspace

    def snapshot(self):
        return {'schema': self.sql(self.SCHEMA_OLD), 'cells': self.sql(self.CELL_ALL), 'views': self.sql(self.VIEW_OLD),
                'legacy': [self.sql(q) for q in self.LEGACY_ALL]}

    def test_migration_retains_populated_legacy_data_byte_for_byte_with_null_namespace(self):
        command.upgrade(self.config, PREVIOUS_HEAD)
        workspace = self.populate()
        before = self.snapshot()
        self.assertEqual(len(before['cells']), 4)
        command.upgrade(self.config, HEAD)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.sql('SELECT DISTINCT configuration_id FROM workspace_group_review_schemas'), [(None,)])
        self.assertEqual(self.sql('SELECT DISTINCT configuration_id, quarter_ordinal FROM group_sprint_review_views'), [(None, None)])
        engine = db_engine.get_engine(self.url)
        inspector = inspect(engine)
        indexes = {i['name']: i for t in ('workspace_group_review_schemas', 'group_sprint_review_views') for i in inspector.get_indexes(t)}
        self.assertTrue({'uq_group_review_schema_legacy', 'uq_group_review_schema_configuration', 'uq_group_sprint_review_view_legacy',
                         'uq_group_sprint_review_view_configuration', 'ix_group_sprint_review_views_quarter'} <= set(indexes))
        self.assertEqual(indexes['uq_group_sprint_review_view_configuration']['column_names'],
                         ['workspace_id', 'group_id', 'sprint_id', 'configuration_id'])
        self.assertEqual(indexes['ix_group_sprint_review_views_quarter']['column_names'],
                         ['workspace_id', 'group_id', 'configuration_id', 'quarter_ordinal'])
        self.assertTrue(all(indexes[n]['unique'] for n in indexes if n.startswith('uq_')))
        self.assertEqual({c['name'] for c in inspector.get_unique_constraints('workspace_group_review_schemas')}, set())
        self.assertEqual({c['name'] for c in inspector.get_unique_constraints('group_sprint_review_views')}, set())
        # The migrated database behaves like a fresh one: NULL uniqueness, an Initiative cell and a new namespace row.
        cfg_row = uuid.uuid4()
        with self.assertRaises(IntegrityError):
            self.sql("INSERT INTO workspace_group_review_schemas (id, workspace_id, group_id, schema_revision, columns) "
                     "VALUES (:i, :w, 'group-x', 0, '[]')", i=str(uuid.uuid4()), w=workspace)
        self.sql("INSERT INTO workspace_group_review_schemas (id, workspace_id, group_id, configuration_id, schema_revision, columns) "
                 "VALUES (:i, :w, 'group-x', 'cfg-1', 0, '[]')", i=str(cfg_row), w=workspace)
        self.sql("INSERT INTO group_review_cells (id, schema_id, issue_id, row_kind, column_id, value, revision) "
                 "VALUES (:i, :s, '900', 'initiative', 'c9', 'v', 1)", i=str(uuid.uuid4()), s=str(cfg_row))
        with self.assertRaises(IntegrityError):
            self.sql("INSERT INTO workspace_group_review_schemas (id, workspace_id, group_id, configuration_id, schema_revision, columns) "
                     "VALUES (:i, :w, 'group-x', 'cfg-1', 0, '[]')", i=str(uuid.uuid4()), w=workspace)
        self.assertEqual([row for row in self.snapshot()['schema'] if row[0] != cfg_row], before['schema'])

    def test_downgrade_without_new_data_restores_the_previous_shape_and_keeps_legacy_data(self):
        command.upgrade(self.config, PREVIOUS_HEAD)
        self.populate()
        before = self.snapshot()
        command.upgrade(self.config, HEAD)
        command.downgrade(self.config, PREVIOUS_HEAD)
        self.assertEqual(self.snapshot(), before)
        names = {c['name'] for t in ('workspace_group_review_schemas', 'group_sprint_review_views') for c in inspect(db_engine.get_engine(self.url)).get_columns(t)}
        self.assertFalse({'configuration_id', 'quarter_ordinal'} & names)
        command.upgrade(self.config, HEAD)
        self.assertEqual(self.snapshot(), before)

    def test_downgrade_refuses_every_kind_of_new_data_before_changing_anything(self):
        for label, statement in (
                ('schema', "INSERT INTO workspace_group_review_schemas (id, workspace_id, group_id, configuration_id, schema_revision, columns) "
                           "VALUES ('00000000-0000-0000-0000-0000000000a1', :w, 'group-z', 'cfg-1', 0, '[]')"),
                ('view', "INSERT INTO group_sprint_review_views (id, workspace_id, group_id, sprint_id, sprint_order, configuration_id, quarter_ordinal, layouts, view_revision) "
                         "VALUES ('00000000-0000-0000-0000-0000000000a2', :w, 'group-x', '77', :o, 'cfg-1', 8104, '{}', 1)"),
                ('ordinal only', "UPDATE group_sprint_review_views SET quarter_ordinal = 8104 WHERE sprint_id = '17'"),
                ('initiative cell', "INSERT INTO group_review_cells (id, schema_id, issue_id, row_kind, column_id, value, revision) "
                                    "SELECT '00000000-0000-0000-0000-0000000000a3', id, '900', 'initiative', 'c', 'v', 1 FROM workspace_group_review_schemas LIMIT 1")):
            with self.subTest(label=label):
                command.upgrade(self.config, PREVIOUS_HEAD)
                workspace = self.populate()
                command.upgrade(self.config, HEAD)
                self.sql(statement, w=workspace, o=review.sprint_order('77'))
                shape = self.sql(self.SHAPE)
                rows = self.sql(self.CELL_ALL), self.sql(self.SCHEMA_OLD), self.sql(self.VIEW_OLD)
                with self.assertRaisesRegex(RuntimeError, 'Refusing to downgrade'):
                    command.downgrade(self.config, PREVIOUS_HEAD)
                self.assertEqual(self.sql('SELECT version_num FROM alembic_version'), [(HEAD,)])
                self.assertEqual(self.sql(self.SHAPE), shape)
                self.assertEqual((self.sql(self.CELL_ALL), self.sql(self.SCHEMA_OLD), self.sql(self.VIEW_OLD)), rows)
                db_engine.dispose_engines()
                # Each kind starts from an empty database.
                self.url = os.environ['DATABASE_URL'] = fresh_database_url(self.addCleanup)
                self.config.set_main_option('sqlalchemy.url', self.url)

    def test_migrated_database_serves_both_namespaces_through_the_service(self):
        command.upgrade(self.config, HEAD)
        with db_engine.session_scope(self.url) as session:
            workspace = models.Workspace(environment_key='synthetic-migrated-app', name='Synthetic')
            session.add(workspace)
            session.flush()
            session.add(models.WorkspaceGroupConfig(workspace_id=workspace.id, payload={'version': 1, 'groups': [{'id': 'group-x', 'name': 'P'}], 'defaultGroupId': 'group-x'}))
            workspace_id = workspace.id
        fixture = NamespaceFixture()
        fixture.url, fixture.workspace, fixture.group_id = self.url, workspace_id, 'group-x'
        fixture.context = deepcopy_context(workspace_id)
        fixture.epics = set()
        fixture.search = Mock(side_effect=fixture._search)
        fixture.mapped = {'101': (EPIC_TYPE, 1)}
        child = column('epic', 'Child')
        fixture.add_columns(child)
        fixture.nsave([{'issueId': '101', 'rowKind': 'epic', 'columnId': child['id'], 'value': '2', 'baseRevision': 0}], base=1)
        self.assertEqual(self.sql('SELECT configuration_id, schema_revision FROM workspace_group_review_schemas ORDER BY configuration_id NULLS FIRST'),
                         [(None, 0), (CFG, 1)])


def deepcopy_context(workspace_id):
    from backend.auth.context import RequestAuthContext
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
        atlassian_account_id='synthetic-account', workspace_id=workspace_id, auth_connection_id='synthetic-db-connection',
        cloud_id='synthetic-cloud', site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)


if __name__ == '__main__':
    unittest.main()
