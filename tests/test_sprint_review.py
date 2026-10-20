"""Synthetic review contract tests; no real Jira data or writes."""
from copy import deepcopy
from dataclasses import replace
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
import uuid
from unittest.mock import Mock, patch

from alembic import command
from alembic.config import Config
from sqlalchemy import event, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.selectable import Select

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine, models
from backend.services import shared_group_config, sprint_review as review


GROUPS = [{'id': 'group-x', 'name': 'Platform'}, {'id': 'group-y', 'name': 'Payments'}]
OTHER_GROUPS = [{'id': 'group-x', 'name': 'Platform'}, {'id': 'other-only', 'name': 'Elsewhere'}]


class ReviewFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='tests')
        self.url = 'sqlite+pysqlite:///' + str(Path(self.temp.name).resolve() / 'review.db')
        models.Base.metadata.create_all(db_engine.get_engine(self.url))
        self.env = patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db'})
        self.env.start()
        with db_engine.session_scope(self.url) as session:
            workspace = models.Workspace(environment_key='synthetic-review', name='Synthetic')
            other_workspace = models.Workspace(environment_key='synthetic-review-other', name='Other')
            session.add_all([workspace, other_workspace])
            session.flush()
            self.workspace, self.other_workspace = workspace.id, other_workspace.id
            session.add_all([
                models.WorkspaceGroupConfig(workspace_id=workspace.id, payload={'version': 1, 'groups': deepcopy(GROUPS), 'defaultGroupId': 'group-x'}),
                models.WorkspaceGroupConfig(workspace_id=other_workspace.id, payload={'version': 1, 'groups': deepcopy(OTHER_GROUPS), 'defaultGroupId': 'group-x'}),
            ])
        self.group_id = 'group-x'
        self.context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
            atlassian_account_id='synthetic-account', workspace_id=self.workspace,
            auth_connection_id='synthetic-db-connection', cloud_id='synthetic-cloud',
            site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)
        self.column = {'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': 'Estimate', 'type': 'number', 'aggregation': 'sum'}
        self.epics = set()
        self.search = Mock(side_effect=self._search)

    def tearDown(self):
        self.env.stop()
        db_engine.dispose_engines()
        self.temp.cleanup()

    def _search(self, payload, **kwargs):
        self.assertIn(kwargs['context'].workspace_id, (self.workspace, self.other_workspace))
        self.assertLessEqual(kwargs['timeout'], 15)
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')
        return Mock(status_code=200, json=lambda: {'issues': [{'id': i, 'fields': {'issuetype': {'name': 'Epic' if i in self.epics else 'Story', 'subtask': False}}} for i in ids], 'isLast': True})

    def save(self, cells=None, schemas=None, base=1, sprint='17', context=None, view=None, group=None):
        payload = {'groupId': group or self.group_id, 'baseSchemaRevision': base, 'schemaChanges': schemas or [], 'cellChanges': cells or []}
        if view is not None:
            payload['baseViewRevision'] = view
        return review.save_review(context or self.context, sprint, payload, self.url, self.search)

    def load(self, sprint='17', context=None, group=None):
        return review.load_review(context or self.context, sprint, group or self.group_id, self.url)

    def read(self, ids, kind='story', sprint='17', context=None, group=None, search=None):
        return review.read_values(context or self.context, sprint, {'groupId': group or self.group_id, 'issueIds': ids, 'rowKind': kind},
                                  self.url, search or self.search)

    def add(self, **kwargs):
        return self.save(schemas=[{'action': 'add', 'column': self.column}], base=0, **kwargs)

    def cell(self, value='1.1', base=0, issue='101', column=None, kind='story'):
        return {'issueId': issue, 'rowKind': kind, 'columnId': column or self.column['id'], 'value': value, 'baseRevision': base}

    def layout(self, kind='story', order=None, hidden=None):
        return {'action': 'layout', 'rowKind': kind, 'order': ['status'] if order is None else order, 'hidden': [] if hidden is None else hidden}

    def counts(self):
        with db_engine.session_scope(self.url) as session:
            return tuple(session.query(model).count() for model in (models.WorkspaceGroupReviewSchema, models.GroupReviewCell, models.GroupSprintReviewView))

    def set_groups(self, payload, workspace=None):
        with db_engine.session_scope(self.url) as session:
            row = session.query(models.WorkspaceGroupConfig).filter_by(workspace_id=workspace or self.workspace).one()
            row.payload = payload

    def assert_error(self, code, status, fn, *args, **kwargs):
        with self.assertRaises(review.ReviewError) as raised:
            fn(*args, **kwargs)
        self.assertEqual((raised.exception.code, raised.exception.status), (code, status))
        return raised.exception


class SprintReviewTests(ReviewFixture, unittest.TestCase):
    def test_layout_accepts_the_default_hidden_columns_the_table_sends(self):
        # The table posts its default hidden set with every layout draft; rejecting any of them made
        # every column change fail to save. Read the real list so the two sides cannot drift.
        model = (Path(__file__).resolve().parents[1] / 'frontend/src/eng/planningReviewTableModel.js').read_text()
        defaults = re.findall(r"'([^']+)'", re.search(r'DEFAULT_REVIEW_HIDDEN_COLUMNS = \[([^\]]*)\]', model).group(1))
        self.assertIn('projectTrack', defaults)
        revision = self.add()['schemaRevision']
        view = 0
        for kind in ('story', 'epic'):
            with self.subTest(kind=kind):
                result = self.save(schemas=[{'action': 'layout', 'rowKind': kind, 'order': ['status', 'priority', 'storyPoints'] + defaults, 'hidden': defaults}], base=revision, view=view)
                view = result['viewRevision']
                self.assertEqual(result['layouts'][kind]['hidden'], defaults)
        with self.assertRaises(review.ReviewError):
            self.save(schemas=[{'action': 'layout', 'rowKind': 'story', 'order': ['status'], 'hidden': ['summary']}], base=revision, view=view)

    def test_layout_hides_every_column_but_summary_and_keeps_key_out_of_the_order(self):
        revision = self.add()['schemaRevision']
        view = 0
        every = {'epic': ['key', 'status', 'priority', 'storyPoints', 'teamsInScope', 'team'], 'story': ['key', 'status', 'priority', 'storyPoints', 'team', 'epic']}
        for kind, hidden in every.items():
            with self.subTest(kind=kind):
                order = [column for column in hidden if column != 'key']
                result = self.save(schemas=[{'action': 'layout', 'rowKind': kind, 'order': order, 'hidden': hidden}], base=revision, view=view)
                view = result['viewRevision']
                self.assertEqual(result['layouts'][kind], {'order': order, 'hidden': hidden})
        for invalid in ({'order': ['key'], 'hidden': []}, {'order': ['status'], 'hidden': ['summary']}, {'order': ['summary'], 'hidden': []}):
            with self.subTest(invalid=invalid), self.assertRaises(review.ReviewError):
                self.save(schemas=[{'action': 'layout', 'rowKind': 'story', **invalid}], base=revision, view=view)

    def test_layout_accepts_the_accepted_column_in_order_and_hidden(self):
        # The computed Accepted column is a built-in the table can order and hide like Assignee.
        revision = self.add()['schemaRevision']
        view = 0
        for kind in ('story', 'epic'):
            with self.subTest(kind=kind):
                result = self.save(schemas=[{'action': 'layout', 'rowKind': kind, 'order': ['status', 'accepted', 'storyPoints'], 'hidden': ['accepted']}], base=revision, view=view)
                view = result['viewRevision']
                self.assertEqual(result['layouts'][kind], {'order': ['status', 'accepted', 'storyPoints'], 'hidden': ['accepted']})

    def test_layout_shared_between_users_and_revision_conflicts(self):
        self.add()
        layout = {'action': 'layout', 'rowKind': 'story', 'order': [self.column['id'], 'status', 'storyPoints'], 'hidden': ['assignee','components','project','capacity']}
        result = self.save(schemas=[layout], view=0)
        other = replace(self.context, user_id='another-user')
        self.assertEqual(self.load(context=other)['layouts'], result['layouts'])
        self.assertEqual(self.load('16', context=other)['layouts'], {})
        self.assertEqual(self.load(context=replace(other, workspace_id=self.other_workspace))['layouts'], {})
        error = self.assert_error('review_conflict', 409, self.save, schemas=[layout], view=0)
        self.assertTrue(error.details['viewConflict'])
        for invalid in ({**layout, 'order': ['key']}, {**layout, 'order': ['status', 'status']}, {**layout, 'order': ['unknown']}, {**layout, 'hidden': ['summary']}):
            with self.assertRaises(review.ReviewError):
                self.save(schemas=[invalid], view=1)
        self.assertEqual(self.load(context=other)['layouts'], result['layouts'])
        epic = self.save(schemas=[{'action':'layout','rowKind':'epic','order':['storyPoints','status'],'hidden':['components']}], view=1)
        self.assertEqual(epic['layouts']['story'], result['layouts']['story'])
        self.assertEqual(self.load(context=other)['layouts']['epic']['order'], ['storyPoints','status'])

    def test_defaults_never_create_or_return_cells(self):
        value = self.load()
        self.assertEqual(value['schemaRevision'], 0)
        self.assertEqual((value['viewRevision'], value['inheritedFrom'], value['layouts'], value['groupId']), (0, None, {}, 'group-x'))
        self.assertNotIn('cells', value)
        self.assertTrue(value['capabilities']['canSave'])
        self.assertEqual(self.counts(), (0, 0, 0))

    def test_shared_users_and_group_workspace_row_kind_isolation(self):
        self.add()
        self.save([self.cell()])
        second = replace(self.context, user_id='another-user')
        snapshot = self.load(context=second)
        self.assertEqual(snapshot['columns'][0]['id'], self.column['id'])
        self.assertEqual(self.read(['101'], sprint='18', context=second)['cells'][0]['value'], '1.100')
        for ctx, group, kind in [(replace(self.context, workspace_id=self.other_workspace), 'group-x', 'story'), (self.context, 'group-y', 'story'), (self.context, 'group-x', 'epic')]:
            allowed_search = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [{'id': '101', 'fields': {'issuetype': {'name': 'Epic' if kind == 'epic' else 'Story'}}}], 'isLast': True}))
            self.assertEqual(self.read(['101'], kind, context=ctx, group=group, search=allowed_search)['cells'], [])

    def test_disjoint_saves_ignore_unrelated_cell_revision_and_same_cell_conflicts_atomic(self):
        self.add()
        self.save([self.cell(issue='101')])
        self.save([self.cell(issue='102')])
        with self.assertRaises(review.ReviewError) as raised:
            self.save([self.cell('8', base=0, issue='101'), self.cell('9', issue='103')])
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(raised.exception.details['cellConflicts'][0]['value'], '1.100')
        saved = self.read(['101', '102', '103'])
        self.assertEqual(len(saved['cells']), 2)

    def test_schema_conflicts_and_invalid_cells_roll_back_schema_changes(self):
        self.add()
        self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Renamed'}])
        with self.assertRaises(review.ReviewError) as raised:
            self.save(schemas=[{'action': 'archive', 'columnId': self.column['id'], 'archived': True}])
        self.assertTrue(raised.exception.details['schemaConflict'])
        with self.assertRaises(review.ReviewError):
            self.save([self.cell('9999999999')], schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Unsaved'}], base=2)
        self.assertEqual(self.load()['columns'][0]['label'], 'Renamed')

    def test_decimal_exact_null_zero_limits_and_text(self):
        self.add()
        for value, expected in [('0', '0.000'), ('-0.0', '0.000'), ('12', '12.000'), ('12.5', '12.500'), ('999999999.9', '999999999.900'), ('-999999999.9', '-999999999.900'), (None, None)]:
            self.assertEqual(review.normalize_value(value, self.column), expected)
        for value in [1.1, True, '', '1.25', '1.001', '12.000', '999999999.99', '999999999.999', 'NaN', '1e2', '1000000000', '-1000000000']:
            with self.subTest(value=value), self.assertRaises(review.ReviewError):
                review.normalize_value(value, self.column)
        text = {**self.column, 'type': 'text'}
        self.assertEqual(review.normalize_value('0', text), '0')
        with self.assertRaises(review.ReviewError):
            review.normalize_value('a' * 501, text)

    def test_column_actions_limits_archiving_preserves_values(self):
        self.add()
        self.save([self.cell()])
        self.save(schemas=[{'action': 'aggregation', 'columnId': self.column['id'], 'aggregation': 'none'},
                           {'action': 'reorder', 'rowKind': 'story', 'columnIds': [self.column['id']]},
                           {'action': 'archive', 'columnId': self.column['id'], 'archived': True}])
        # Archived columns' cells stay stored but are no longer read back.
        self.assertEqual(self.read(['101'])['cells'], [])
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupReviewCell).one().value, '1.100')
        with self.assertRaises(review.ReviewError):
            self.save([self.cell(base=1)], base=2)
        changes = [{'action': 'add', 'column': {**self.column, 'id': str(uuid.uuid4())}} for _ in range(31)]
        review.validate_schema_changes(changes)
        with self.assertRaises(review.ReviewError):
            review.apply_schema([], changes)
        for column in [{**self.column, 'label': 'a' * 81}, {**self.column, 'type': 'text', 'aggregation': 'sum'}]:
            with self.assertRaises(review.ReviewError):
                review.validate_schema_changes([{'action': 'add', 'column': column}])

    def test_requested_authority_rejected_and_bounds(self):
        self.add()
        for payload in [{'groupId': 'group-x', 'baseSchemaRevision': 1, 'workspaceId': self.workspace},
                        {'groupId': 'group-x', 'baseSchemaRevision': 1, 'cellChanges': [self.cell()] * 101},
                        {'groupId': 'group-x', 'baseSchemaRevision': True},
                        {'groupId': 'group-x', 'baseSchemaRevision': 1, 'cellChanges': [self.cell(), self.cell()]},
                        {'baseSchemaRevision': 1}]:
            with self.assertRaises(review.ReviewError):
                review.save_review(self.context, '17', payload, self.url, self.search)
        for ids in [['DEMO-1'], ['0'], ['101'] * 501, ['101', '101']]:
            with self.assertRaises(review.ReviewError):
                review.issue_ids(ids)

    def test_inaccessible_issue_never_reveals_cell_and_prevents_atomic_save(self):
        self.add()
        self.save([self.cell()])
        empty = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [], 'isLast': True}))
        data = self.read(['101'], search=empty)
        self.assertEqual(data, {'cells': [], 'unavailableIssueIds': ['101']})
        with self.assertRaises(review.ReviewError) as raised:
            review.save_review(self.context, '17', {'groupId': 'group-x', 'baseSchemaRevision': 1, 'cellChanges': [self.cell('2', base=1)],
                'schemaChanges': [{'action': 'rename', 'columnId': self.column['id'], 'label': 'No'}]}, self.url, empty)
        self.assertEqual(raised.exception.status, 403)
        self.assertEqual(self.load()['schemaRevision'], 1)

    def test_issue_kind_matches_epic_or_configured_leaf_and_rejects_subtasks(self):
        self.add()
        for issue_type in [{'name': 'Epic'}, {'name': 'Initiative'}, {'name': 'Story', 'hierarchyLevel': 2}, {'name': 'Story', 'subtask': True}, {}]:
            search = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [{'id': '101', 'fields': {'issuetype': issue_type}}], 'isLast': True}))
            self.assertEqual(self.read(['101'], search=search)['unavailableIssueIds'], ['101'])
            with self.assertRaises(review.ReviewError):
                review.save_review(self.context, '17', {'groupId': 'group-x', 'baseSchemaRevision': 1, 'cellChanges': [self.cell()]}, self.url, search)
        epic_column = {**self.column, 'id': str(uuid.uuid4()), 'rowKind': 'epic'}
        self.save(schemas=[{'action': 'add', 'column': epic_column}])
        search = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [
            {'id': '101', 'fields': {'issuetype': {'name': 'Story'}}},
            {'id': '102', 'fields': {'issuetype': {'name': 'Epic'}}}], 'isLast': True}))
        result = review.save_review(self.context, '17', {'groupId': 'group-x', 'baseSchemaRevision': 2, 'cellChanges': [
            self.cell(issue='101'), self.cell(issue='102', column=epic_column['id'], kind='epic')]}, self.url, search)
        self.assertEqual(len(result['cells']), 2)
        self.assertEqual(search.call_count, 1)

    def test_authorization_batches_complete_pagination_and_deadline(self):
        ids = [str(i) for i in range(1, 501)]
        self.assertEqual(review.authorize_issues(self.context, ids, self.search), set(ids))
        self.assertEqual(self.search.call_count, 5)
        self.search.reset_mock()
        large_ids = [str(i) + '1' * 120 for i in range(1, 101)]
        self.assertEqual(review.authorize_issues(self.context, large_ids, self.search), set(large_ids))
        self.assertTrue(all(len(call.args[0]['jql']) <= 3010 for call in self.search.call_args_list))
        self.assertGreater(self.search.call_count, 1)
        incomplete = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [], 'isLast': False, 'nextPageToken': 'repeat'}))
        with self.assertRaises(review.ReviewError) as raised:
            review.authorize_issues(self.context, ['101'], incomplete)
        self.assertEqual(raised.exception.code, 'review_authorization_incomplete')
        counter = iter(range(20))
        forever = Mock(side_effect=lambda *a, **kw: Mock(status_code=200, json=lambda: {'issues': [], 'isLast': False, 'nextPageToken': str(next(counter))}))
        with self.assertRaises(review.ReviewError):
            review.authorize_issues(self.context, ['101'], forever)
        self.assertEqual(forever.call_count, 10)
        with patch.object(review.EngBoardRequestBudget, 'check', side_effect=review.EngBoardRequestDeadline()), self.assertRaises(review.ReviewError):
            review.authorize_issues(self.context, ['101'], self.search)

    def test_profiles_and_auth_errors_never_call_jira(self):
        for context in [None, replace(self.context, auth_mode='basic')]:
            with self.assertRaises(AuthError):
                review.authorize_issues(context, ['101'], self.search)
        self.search.assert_not_called()
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'file'}):
            self.assertFalse(self.load()['capabilities']['canSave'])
            with self.assertRaises(review.ReviewError):
                review.load_review(self.context, '17', ' group-x', self.url)
        expired = Mock(return_value=Mock(status_code=401))
        with self.assertRaises(AuthError):
            review.authorize_issues(self.context, ['101'], expired)

    def test_no_request_context_reaches_real_oauth_wrapper_without_forbidden_fallbacks(self):
        import jira_server
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'db_oauth_session_data_for_auth_context', side_effect=AuthError('auth_required')) as token, \
             patch.object(jira_server, 'oauth_session_data_for_auth_context', side_effect=AssertionError('local token store forbidden')), \
             patch.object(jira_server, 'jira_session_data', side_effect=AssertionError('Basic/session fallback forbidden')), \
             patch.object(jira_server.HTTP_SESSION, 'request', side_effect=AssertionError('mutation forbidden')), \
             self.assertRaises(AuthError):
            review.authorize_issues(self.context, ['101'])
        token.assert_called_once()


class GroupReviewContractTests(ReviewFixture, unittest.TestCase):
    """Group-wide columns and values, per-Sprint views, the groupId contract (#267)."""

    # Isolation and values
    def test_group_isolation_with_identical_column_ids(self):
        for group in ('group-x', 'group-y'):
            self.save(schemas=[{'action': 'add', 'column': self.column}], base=0, group=group)
        self.save([self.cell('5')], group='group-x')
        self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Renamed'}], group='group-x')
        self.save(schemas=[{'action': 'archive', 'columnId': self.column['id'], 'archived': True}], base=2, group='group-x')
        y = self.load('40', group='group-y')
        self.assertEqual((y['schemaRevision'], y['columns'][0]['label'], y['columns'][0]['archived']), (1, 'Estimate', False))
        self.assertEqual(self.read(['101'], group='group-y')['cells'], [])
        x = self.load('3', group='group-x')
        self.assertEqual((x['schemaRevision'], x['columns'][0]['label'], x['columns'][0]['archived']), (3, 'Renamed', True))

    def test_group_hidden_by_user_preference_still_reads_and_writes_without_preference_writes(self):
        # AC 14: visibility is a personal display preference; the server never gates review access on it.
        with db_engine.session_scope(self.url) as session:
            session.add(models.UserGroupPreference(workspace_id=self.workspace, user_id=self.context.user_id, visible_group_ids=['group-y'], active_group_id='group-y', customized=True))

        def rows():
            with db_engine.session_scope(self.url) as session:
                return [(row.visible_group_ids, row.active_group_id, row.updated_at) for row in session.query(models.UserGroupPreference).all()], \
                       [(row.workspace_id, row.payload, row.updated_at) for row in session.query(models.WorkspaceGroupConfig).order_by(models.WorkspaceGroupConfig.workspace_id).all()]
        before = rows()
        self.add(group='group-x')
        self.assertEqual(self.save([self.cell('4')], group='group-x')['cells'][0]['value'], '4.000')
        self.assertEqual(self.load(group='group-x')['columns'][0]['id'], self.column['id'])
        self.assertEqual(self.read(['101'], group='group-x')['cells'][0]['value'], '4.000')
        self.assertEqual(rows(), before)

    def test_one_value_per_issue_across_sprints_and_cross_sprint_cell_conflict(self):
        self.add(sprint='30')
        self.save([self.cell('2')], sprint='30')
        self.assertEqual(self.read(['101'], sprint='10')['cells'][0]['value'], '2.000')
        error = self.assert_error('review_conflict', 409, self.save, [self.cell('3', base=0)], sprint='10')
        self.assertEqual(error.details['cellConflicts'][0]['revision'], 1)
        self.assertEqual(self.save([self.cell('3', base=1)], sprint='10')['cells'][0]['revision'], 2)
        self.assertEqual(self.read(['101'], sprint='30')['cells'][0]['value'], '3.000')

    def test_cross_workspace_isolation_with_identical_ids(self):
        other = replace(self.context, workspace_id=self.other_workspace)
        self.add()
        self.add(context=other)
        self.save([self.cell('1')])
        self.save([self.cell('2')], context=other)
        self.save(schemas=[self.layout(order=['status'])], view=0)
        self.assertEqual(self.read(['101'])['cells'][0]['value'], '1.000')
        self.assertEqual(self.read(['101'], context=other)['cells'][0]['value'], '2.000')
        self.assertEqual(self.load(context=other)['layouts'], {})
        self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Other'}], context=other)
        self.assertEqual(self.load()['columns'][0]['label'], 'Estimate')

    def test_inaccessible_issue_absent_listed_and_no_cell_query(self):
        self.add()
        self.save([self.cell()])
        statements = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, *args: statements.append(statement)
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            empty = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [], 'isLast': True}))
            self.assertEqual(self.read(['101'], search=empty), {'cells': [], 'unavailableIssueIds': ['101']})
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        self.assertFalse([s for s in statements if 'group_review_cells' in s])

    def test_values_read_returns_only_active_columns(self):
        active = [{'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': f'A{i}', 'type': 'text', 'aggregation': 'none', 'archived': False, 'order': i} for i in range(30)]
        archived = [{'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': f'R{i}', 'type': 'text', 'aggregation': 'none', 'archived': True, 'order': 30 + i} for i in range(100)]
        with db_engine.session_scope(self.url) as session:
            schema = models.WorkspaceGroupReviewSchema(workspace_id=self.workspace, group_id='group-x', schema_revision=1, columns=active + archived)
            session.add(schema)
            session.flush()
            session.add_all([models.GroupReviewCell(schema_id=schema.id, issue_id='101', row_kind='story', column_id=c['id'], value='v', revision=1) for c in active + archived])
        cells = self.read(['101'])['cells']
        self.assertEqual(sorted(c['columnId'] for c in cells), sorted(c['id'] for c in active))

    def test_archive_in_one_sprint_removes_column_everywhere_while_views_keep_its_id(self):
        self.save(schemas=[{'action': 'add', 'column': self.column}, self.layout(order=[self.column['id'], 'status'])], base=0, view=0, sprint='20')
        self.save(schemas=[{'action': 'archive', 'columnId': self.column['id'], 'archived': True}], sprint='30')
        for sprint in ('20', '25', '40'):
            snapshot = self.load(sprint)
            self.assertTrue(snapshot['columns'][0]['archived'])
            self.assertIn(self.column['id'], snapshot['layouts']['story']['order'])

    # Views
    def test_view_resolution_own_nearest_earlier_and_none(self):
        big = '9' * 128
        self.save(schemas=[self.layout(order=['status'])], base=0, view=0, sprint='9')
        self.assertEqual(self.load('8')['layouts'], {})
        self.assertIsNone(self.load('8')['inheritedFrom'])
        ten = self.load('10')
        self.assertEqual((ten['layouts']['story']['order'], ten['viewRevision'], ten['inheritedFrom']), (['status'], 0, {'sprintId': '9', 'viewRevision': 1}))
        self.save(schemas=[self.layout(order=['priority'])], base=0, view=0, sprint='10')
        own = self.load('10')
        self.assertEqual((own['layouts']['story']['order'], own['viewRevision'], own['inheritedFrom']), (['priority'], 1, None))
        self.assertEqual(self.load(big)['inheritedFrom'], {'sprintId': '10', 'viewRevision': 1})
        self.save(schemas=[self.layout(order=['storyPoints'])], base=0, view=0, sprint=big)
        self.assertEqual(self.load('11')['inheritedFrom'], {'sprintId': '10', 'viewRevision': 1})
        self.assertEqual(self.load('9')['layouts']['story']['order'], ['status'])
        self.assertEqual(self.load(big)['inheritedFrom'], None)

    def test_single_kind_row_does_not_inherit_the_other_kind(self):
        self.save(schemas=[self.layout('story'), self.layout('epic', order=['priority'])], base=0, view=0, sprint='9')
        self.assertEqual(set(self.load('10')['layouts']), {'story', 'epic'})
        result = self.save(schemas=[self.layout('epic', order=['storyPoints'])], base=0, view=0, sprint='10')
        self.assertEqual(result['layouts'], {'epic': {'order': ['storyPoints'], 'hidden': []}})
        self.assertEqual(self.load('10')['layouts'], {'epic': {'order': ['storyPoints'], 'hidden': []}})

    def test_resolution_loads_at_most_one_view_row_and_cap_refuses_new_views(self):
        with db_engine.session_scope(self.url) as session:
            session.add_all([models.GroupSprintReviewView(workspace_id=self.workspace, group_id='group-x', sprint_id=str(i),
                                                          sprint_order=review.sprint_order(str(i)), layouts={'story': {'order': ['status'], 'hidden': []}}, view_revision=1)
                             for i in range(1, review.MAX_GROUP_VIEWS + 1)])
        loaded = []
        listener = lambda target, context: loaded.append(target.sprint_id)
        event.listen(models.GroupSprintReviewView, 'load', listener)
        try:
            self.assertEqual(self.load('1000')['inheritedFrom'], {'sprintId': '500', 'viewRevision': 1})
        finally:
            event.remove(models.GroupSprintReviewView, 'load', listener)
        self.assertLessEqual(len(loaded), 1)
        before = self.counts()
        request = dict(cells=[self.cell('4')], schemas=[{'action': 'add', 'column': self.column}, self.layout(order=[self.column['id']])], base=0, sprint='1001')
        error = self.assert_error('review_view_limit', 400, self.save, view=0, **request)
        self.assertEqual(error.details, {})
        conflict = self.assert_error('review_conflict', 409, self.save, view=3, **request)
        self.assertTrue(conflict.details['viewConflict'])
        self.assertEqual(self.counts(), before)
        self.assertEqual(self.load('1001')['schemaRevision'], 0)
        # Updating an existing view at the cap still succeeds.
        self.assertEqual(self.save(schemas=[self.layout(order=['priority'])], base=0, view=1, sprint='500')['viewRevision'], 2)

    def test_view_row_creation_and_revision_rules(self):
        self.assert_error('review_conflict', 409, self.save, schemas=[self.layout()], base=0, view=1)
        first = self.save(schemas=[self.layout()], base=0)
        self.assertEqual((first['viewRevision'], first['inheritedFrom']), (1, None))
        error = self.assert_error('review_conflict', 409, self.save, schemas=[self.layout()], base=0, view=0)
        self.assertTrue(error.details['viewConflict'])
        self.assertFalse(error.details['schemaConflict'])
        self.assertEqual(self.save(schemas=[self.layout()], base=0, view=1)['viewRevision'], 2)
        self.assert_error('review_conflict', 409, self.save, schemas=[self.layout()], base=0, view=1)

    def test_first_layout_save_stores_exactly_the_request(self):
        source = {'story': {'order': ['status'], 'hidden': ['project']}, 'epic': {'order': ['priority'], 'hidden': []}}
        self.save(schemas=[self.layout('story', ['status'], ['project']), self.layout('epic', ['priority'])], base=0, view=0, sprint='9')
        result = self.save(schemas=[self.layout('story', ['storyPoints'])], base=0, view=0, sprint='10')
        self.assertEqual((result['layouts'], result['viewRevision'], result['inheritedFrom']), ({'story': {'order': ['storyPoints'], 'hidden': []}}, 1, None))
        self.assertEqual(self.load('9')['layouts'], source)
        self.assertNotIn('epic', self.load('10')['layouts'])
        for missing in ('order', 'hidden'):
            change = self.layout('epic')
            del change[missing]
            self.assert_error('invalid_review_request', 400, self.save, schemas=[change], base=0, view=1, sprint='10')

    def test_cell_column_rename_archive_and_total_saves_create_no_view_row(self):
        self.save(schemas=[self.layout()], base=0, view=0, sprint='9')
        self.add()
        for request in (dict(cells=[self.cell()]),
                        dict(schemas=[{'action': 'add', 'column': {**self.column, 'id': str(uuid.uuid4())}}]),
                        dict(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Renamed'}], base=2),
                        dict(schemas=[{'action': 'aggregation', 'columnId': self.column['id'], 'aggregation': 'none'}], base=3),
                        dict(schemas=[{'action': 'archive', 'columnId': self.column['id'], 'archived': True}], base=4)):
            with self.subTest(request=request):
                result = self.save(**request)
                self.assertFalse({'layouts', 'viewRevision', 'inheritedFrom'} & set(result))
                self.assertEqual(self.counts()[2], 1)
                self.assertEqual(self.load()['inheritedFrom'], {'sprintId': '9', 'viewRevision': 1})

    # Revisions and validation
    def test_layout_only_never_checks_or_bumps_schema_revision(self):
        self.add()
        result = self.save(schemas=[self.layout()], base=0, view=0)
        self.assertEqual(result['schemaRevision'], 1)
        stale_column = self.assert_error('review_conflict', 409, self.save, schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'X'}], base=0)
        self.assertEqual((stale_column.details['schemaConflict'], stale_column.details['viewConflict']), (True, False))
        stale_view = self.assert_error('review_conflict', 409, self.save, schemas=[self.layout()], base=1, view=0)
        self.assertEqual((stale_view.details['schemaConflict'], stale_view.details['viewConflict']), (False, True))
        renamed = self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'X'}])
        self.assertEqual(renamed['schemaRevision'], 2)

    def test_both_conflict_sites_carry_five_fields_and_cell_only_body_omits_view_keys(self):
        fields = {'schemaConflict', 'viewConflict', 'cellConflicts', 'columns', 'schemaRevision'}
        self.add()
        first = self.assert_error('review_conflict', 409, self.save, [self.cell(base=3)])
        self.assertEqual(set(first.details), fields)
        cell_only = self.save([self.cell()])
        self.assertEqual(set(cell_only), {'schemaVersion', 'sprintId', 'groupId', 'columns', 'schemaRevision', 'cells'})
        self.save(schemas=[{'action': 'archive', 'columnId': self.column['id'], 'archived': True}])
        second = self.assert_error('review_conflict', 409, self.save, [self.cell(base=1)], base=2)
        self.assertEqual(set(second.details), fields)
        self.assertEqual((second.details['schemaConflict'], second.details['viewConflict'], second.details['cellConflicts']), (True, False, []))
        with_layout = self.save(schemas=[self.layout()], base=2, view=0)
        self.assertEqual(set(with_layout), {'schemaVersion', 'sprintId', 'groupId', 'columns', 'schemaRevision', 'cells', 'layouts', 'viewRevision', 'inheritedFrom'})

    def test_add_with_layout_referencing_the_new_column_succeeds(self):
        result = self.save(schemas=[{'action': 'add', 'column': self.column}, self.layout(order=['status', self.column['id']])], base=0, view=0)
        self.assertEqual((result['schemaRevision'], result['viewRevision']), (1, 1))
        self.assertEqual(result['layouts']['story']['order'], ['status', self.column['id']])

    def test_malformed_layout_is_rejected_before_jira_authorization(self):
        self.add()
        self.search.reset_mock()
        for layout in ({'action': 'layout', 'rowKind': 'story', 'order': 'status', 'hidden': []},
                       {'action': 'layout', 'rowKind': 'story', 'order': ['status']},
                       {'action': 'layout', 'rowKind': 'task', 'order': [], 'hidden': []},
                       {'action': 'add', 'column': {**self.column, 'id': str(uuid.uuid4()), 'after': 7}}):
            with self.subTest(layout=layout):
                self.assert_error('invalid_review_request', 400, self.save, [self.cell()], schemas=[layout], view=0)
        self.search.assert_not_called()
        # Layout-id membership is a state check, decided after authorization inside the transaction.
        self.assert_error('invalid_review_request', 400, self.save, [self.cell()], schemas=[self.layout(order=[str(uuid.uuid4())])], view=0)
        self.assertEqual(self.search.call_count, 1)
        self.assertEqual(self.counts(), (1, 0, 0))

    def test_layouts_accept_custom_ids_of_both_kinds(self):
        epic_column = {**self.column, 'id': str(uuid.uuid4()), 'rowKind': 'epic'}
        self.save(schemas=[{'action': 'add', 'column': self.column}, {'action': 'add', 'column': epic_column}], base=0)
        result = self.save(schemas=[self.layout('story', [epic_column['id'], self.column['id']], [epic_column['id']]),
                                    self.layout('epic', [self.column['id'], epic_column['id']])], view=0)
        self.assertEqual(result['layouts']['story']['hidden'], [epic_column['id']])
        self.assertEqual(result['layouts']['epic']['order'], [self.column['id'], epic_column['id']])
        self.assert_error('invalid_review_request', 400, self.save, schemas=[self.layout('epic', [str(uuid.uuid4())])], view=1)

    def test_add_after_accepts_same_kind_anchors_and_rejects_others(self):
        epic_column = {**self.column, 'id': str(uuid.uuid4()), 'rowKind': 'epic'}
        archived = {**self.column, 'id': str(uuid.uuid4()), 'label': 'Old'}
        revision = self.save(schemas=[{'action': 'add', 'column': self.column}, {'action': 'add', 'column': epic_column},
                                      {'action': 'add', 'column': archived},
                                      {'action': 'archive', 'columnId': archived['id'], 'archived': True}], base=0)['schemaRevision']
        chained = str(uuid.uuid4())
        accepted = [('summary', None), ('status', None), (self.column['id'], None), (archived['id'], None), (None, None), (chained, chained)]
        for after, same_request in accepted:
            with self.subTest(after=after):
                identity = str(uuid.uuid4())
                schemas = []
                if same_request:
                    schemas.append({'action': 'add', 'column': {**self.column, 'id': same_request, 'label': 'Chain'}})
                schemas.append({'action': 'add', 'column': {**self.column, 'id': identity, 'label': 'New', 'after': after}})
                result = self.save(schemas=schemas, base=revision)
                revision = result['schemaRevision']
                self.assertEqual(next(c for c in result['columns'] if c['id'] == identity)['after'], after)
        missing = self.load()['columns'][0]
        self.assertIsNone(missing.get('after'))
        for after in ('teamsInScope', epic_column['id'], str(uuid.uuid4()), 'key', 'x' * 65, ''):
            with self.subTest(after=after):
                self.assert_error('invalid_review_request', 400, self.save, schemas=[{'action': 'add', 'column': {**self.column, 'id': str(uuid.uuid4()), 'after': after}}], base=revision)
        story_anchor_on_epic = {**epic_column, 'id': str(uuid.uuid4()), 'after': 'epic'}
        self.assert_error('invalid_review_request', 400, self.save, schemas=[{'action': 'add', 'column': story_anchor_on_epic}], base=revision)

    # groupId contract
    def test_group_identity_shape(self):
        for value in ('group-x', 'a', 'a' * 128, 'New Group', 'Grüppe'):
            self.assertEqual(review.group_identity(value), value)
        for value in (None, 5, '', ' group-x', 'group-x ', '\tg', 'a' * 129, 'a\x00b', 'a\nb', 'a\x7fb', 'a\x85b', ['group-x']):
            with self.subTest(value=value), self.assertRaises(review.ReviewError):
                review.group_identity(value)

    def test_group_id_required_on_all_three_operations(self):
        for bad in (None, ' group-x', 'a' * 129):
            with self.subTest(bad=bad):
                self.assert_error('invalid_review_request', 400, review.load_review, self.context, '17', bad, self.url)
                payload = {'issueIds': ['101'], 'rowKind': 'story'}
                if bad is not None:
                    payload['groupId'] = bad
                self.assert_error('invalid_review_request', 400, review.read_values, self.context, '17', payload, self.url, self.search)
                save = {'baseSchemaRevision': 0, 'schemaChanges': [], 'cellChanges': []}
                if bad is not None:
                    save['groupId'] = bad
                self.assert_error('invalid_review_request', 400, review.save_review, self.context, '17', save, self.url, self.search)
        self.search.assert_not_called()

    def test_membership_precedence_and_exact_stripped_match(self):
        with patch.object(shared_group_config, 'current_shared_groups_config', side_effect=AssertionError('membership read before structure')):
            self.assert_error('invalid_review_request', 400, review.save_review, self.context, '17',
                              {'groupId': 'unlisted', 'baseSchemaRevision': 'x'}, self.url, self.search)
        error = self.assert_error('review_group_unknown', 400, self.save, [self.cell()], group='unlisted')
        self.assertEqual(error.details, {})
        self.search.assert_not_called()
        self.assert_error('review_group_unknown', 400, self.save, group='Group-X')
        self.assert_error('review_group_unknown', 400, self.save, group='other-only')
        self.set_groups({'version': 1, 'groups': [{'id': '  padded  ', 'name': 'Padded'}, {'id': None}, {}]})
        self.assertEqual(self.save(schemas=[{'action': 'add', 'column': self.column}], base=0, group='padded')['groupId'], 'padded')
        self.assert_error('invalid_review_request', 400, self.save, group='  padded  ')
        for payload in ({'version': 1}, {'version': 1, 'groups': None}, {'version': 1, 'groups': []}):
            with self.subTest(payload=payload):
                self.set_groups(payload)
                self.assert_error('review_group_unknown', 400, self.save, group='padded')
        with db_engine.session_scope(self.url) as session:
            session.query(models.WorkspaceGroupConfig).filter_by(workspace_id=self.workspace).delete()
        self.assert_error('review_group_unknown', 400, self.save, group='group-x')

    def test_malformed_group_payload_is_unavailable(self):
        for payload in ({'groups': {'id': 'group-x'}}, {'groups': ['group-x']}, {'groups': 'group-x'}, {'groups': [{'id': 'group-x'}, 3]}):
            with self.subTest(payload=payload):
                self.set_groups(payload)
                self.assert_error('review_unavailable', 503, self.save)

    def test_reads_never_consult_the_group_catalog_and_reattach(self):
        self.add()
        self.save([self.cell('7')])
        self.save(schemas=[self.layout()], view=0)
        self.set_groups({'version': 1, 'groups': [{'id': 'group-y', 'name': 'Payments'}]})
        with patch.object(shared_group_config, 'current_shared_groups_config', side_effect=AssertionError('catalog read on GET/values read')):
            snapshot = self.load('18')
            self.assertEqual((snapshot['columns'][0]['id'], snapshot['inheritedFrom']), (self.column['id'], {'sprintId': '17', 'viewRevision': 1}))
            self.assertEqual(self.read(['101'])['cells'][0]['value'], '7.000')
            self.assertEqual(self.load(group='never-configured')['columns'], [])
            self.assertEqual(self.read(['101'], group='never-configured')['cells'], [])
        self.assert_error('review_group_unknown', 400, self.save, [self.cell('8', base=1)])
        self.set_groups({'version': 1, 'groups': [{'id': 'group-x', 'name': 'Recreated'}]})
        self.assertEqual(self.save([self.cell('8', base=1)])['cells'][0]['value'], '8.000')

    # Forbidden paths
    def test_review_code_never_writes_config_preferences_catalog_or_resolves_credentials(self):
        from backend.auth import home_credentials, token_crypto
        from backend.services import sprints, workspace_catalog_cache
        forbidden = [(shared_group_config, name) for name in ('save_shared_groups', 'ensure_workspace_group_config', 'load_shared_groups',
                                                             'save_group_preferences', 'complete_onboarding_module', 'set_onboarding_done',
                                                             'load_group_preferences')]
        forbidden += [(workspace_catalog_cache, name) for name in ('load_sprint_catalog', 'load_sprint_team_catalog', 'claim_catalog_refresh', 'publish_catalog')]
        forbidden += [(sprints, name) for name in ('load_sprints_cache', 'save_sprints_cache', 'invalidate_sprints_cache', 'fetch_sprints_from_jira')]
        forbidden += [(home_credentials, 'resolve_home_credential'), (token_crypto, 'decrypt_token')]
        patchers = [patch.object(target, name, side_effect=AssertionError(name + ' forbidden')) for target, name in forbidden]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.load()
        self.save(schemas=[{'action': 'add', 'column': self.column}, self.layout(order=[self.column['id']])], base=0, view=0)
        self.save([self.cell()])
        self.read(['101'])
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.WorkspaceGroupConfig).filter_by(workspace_id=self.workspace).one().config_revision, 1)
            self.assertEqual(session.query(models.UserGroupPreference).count(), 0)

    def test_reads_and_empty_patch_write_nothing_and_take_no_lock(self):
        self.load()
        self.read(['101'])
        self.assertEqual(self.counts(), (0, 0, 0))
        with patch.object(Select, 'with_for_update', side_effect=AssertionError('lock taken')) as spy:
            empty = self.save(base=0)
        spy.assert_not_called()
        self.assertEqual(empty, {'schemaVersion': 1, 'sprintId': '17', 'groupId': 'group-x', 'columns': [], 'schemaRevision': 0, 'cells': []})
        self.assertEqual(self.counts(), (0, 0, 0))
        self.add()
        with patch.object(Select, 'with_for_update', side_effect=AssertionError('lock taken')) as spy:
            self.assertEqual(self.save()['columns'][0]['id'], self.column['id'])
        spy.assert_not_called()


class ReviewStatementCountTests(ReviewFixture, unittest.TestCase):
    """Statements per call, pinned to the design's Performance table (AC 19).

    The fixture is an existing group schema with one story column; every count is
    measured with before_cursor_execute on the engine both review sessions share.
    """

    def setUp(self):
        super().setUp()
        self.add()
        self.revision = 1

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

    def assert_count(self, expected, fn, *args, **kwargs):
        captured = self.statements(fn, *args, **kwargs)
        self.assertEqual(len(captured), expected, captured)
        return captured

    def new_column(self):
        return {'action': 'add', 'column': {**self.column, 'id': str(uuid.uuid4()), 'label': 'Another'}}

    def test_get_and_values_read(self):
        self.assert_count(2, self.load)
        self.save(schemas=[self.layout()], view=0, sprint='9')
        self.assert_count(2, self.load)
        self.save([self.cell()])
        self.assert_count(2, self.read, ['101'])

    def test_empty_patch_reads_config_and_schema_only(self):
        captured = self.assert_count(2, self.save)
        self.assertFalse([s for s in captured if s.lstrip().upper().startswith(('INSERT', 'UPDATE'))])

    def test_cell_only_patch_is_four_plus_upserts(self):
        # The design fixture: one new cell on an existing group schema is 5 (4 plus one insert).
        captured = self.assert_count(5, self.save, [self.cell()])
        self.assertFalse([s for s in captured if 'group_sprint_review_views' in s])
        # Updating the same cell is also 4 plus one upsert.
        self.assert_count(5, self.save, [self.cell('2', base=1)])

    def test_column_only_patch(self):
        self.assert_count(4, self.save, schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Renamed'}])

    def test_layout_only_patch_first_and_existing_view(self):
        self.assert_count(6, self.save, schemas=[self.layout()], view=0)
        self.assert_count(5, self.save, schemas=[self.layout(order=['priority'])], view=1)

    def test_add_plus_layout_patch_first_and_existing_view(self):
        self.assert_count(7, self.save, schemas=[self.new_column(), self.layout()], view=0)
        self.assert_count(6, self.save, schemas=[self.new_column(), self.layout(order=['priority'])], base=2, view=1)


class GroupReviewMigrationTests(unittest.TestCase):
    TABLES = ('workspace_group_review_schemas', 'group_review_cells', 'group_sprint_review_views')

    def _config(self, directory, name):
        url = 'sqlite+pysqlite:///' + str(Path(directory).resolve() / name)
        config = Config('backend/db/alembic.ini')
        config.set_main_option('sqlalchemy.url', url)
        return url, config

    def test_model_database_parity(self):
        with tempfile.TemporaryDirectory(dir='tests') as directory:
            url, config = self._config(directory, 'group.db')
            command.upgrade(config, 'head')
            engine = db_engine.get_engine(url)
            insp = inspect(engine)
            for name in self.TABLES:
                table = models.Base.metadata.tables[name]
                columns = {c['name']: c for c in insp.get_columns(name)}
                self.assertEqual(set(columns), set(table.columns.keys()))
                for column in table.columns:
                    self.assertEqual(columns[column.name]['nullable'], column.nullable, (name, column.name))
                self.assertEqual({u['name']: tuple(u['column_names']) for u in insp.get_unique_constraints(name)},
                                 {c.name: tuple(col.name for col in c.columns) for c in table.constraints
                                  if c.__class__.__name__ == 'UniqueConstraint'})
                self.assertEqual({c['name'] for c in insp.get_check_constraints(name)},
                                 {c.name for c in table.constraints if c.__class__.__name__ == 'CheckConstraint'})
                self.assertEqual({(tuple(f['constrained_columns']), f['referred_table'], f['options'].get('ondelete'))
                                  for f in insp.get_foreign_keys(name)},
                                 {(tuple(c.parent.name for c in f.elements), f.elements[0].column.table.name, f.ondelete)
                                  for f in table.foreign_key_constraints})
            self.assertEqual({(f['referred_table'], f['options'].get('ondelete')) for f in insp.get_foreign_keys('group_review_cells')},
                             {('workspace_group_review_schemas', 'CASCADE')})
            self.assertEqual({(f['referred_table'], f['options'].get('ondelete')) for f in insp.get_foreign_keys('workspace_group_review_schemas')},
                             {('workspaces', 'CASCADE')})
            self.assertEqual({(f['referred_table'], f['options'].get('ondelete')) for f in insp.get_foreign_keys('group_sprint_review_views')},
                             {('workspaces', 'CASCADE')})
            indexes = {i['name']: i['column_names'] for i in insp.get_indexes('group_sprint_review_views')}
            self.assertIn(['workspace_id', 'group_id', 'sprint_order'], indexes.values())
            db_engine.dispose_engines()

    def test_legacy_rows_survive_upgrade_and_downgrade(self):
        with tempfile.TemporaryDirectory(dir='tests') as directory:
            url, config = self._config(directory, 'legacy.db')
            command.upgrade(config, '20261001_0018')
            engine = db_engine.get_engine(url)
            with db_engine.session_scope(url) as session:
                workspace = models.Workspace(environment_key='synthetic-group', name='Synthetic')
                session.add(workspace)
                session.flush()
                session.execute(text("INSERT INTO workspace_sprint_reviews (id,workspace_id,sprint_id,schema_revision,columns,layouts) VALUES ('00000000000000000000000000000001',:w,'17',3,'[]','{}')"), {'w': workspace.id})
                session.execute(text("INSERT INTO sprint_review_cells (id,review_id,issue_id,row_kind,column_id,value,revision) VALUES ('00000000000000000000000000000002','00000000000000000000000000000001','1','epic','c','v',2)"))

            def legacy():
                with db_engine.session_scope(url) as session:
                    review_row = session.get(models.WorkspaceSprintReview, '00000000-0000-0000-0000-000000000001')
                    cell = session.get(models.SprintReviewCell, '00000000-0000-0000-0000-000000000002')
                    return (review_row.schema_revision, review_row.columns, review_row.layouts, cell.value, cell.revision)

            expected = (3, [], {}, 'v', 2)
            command.upgrade(config, 'head')
            self.assertTrue(set(self.TABLES) <= set(inspect(engine).get_table_names()))
            self.assertEqual(legacy(), expected)
            command.downgrade(config, '20261001_0018')
            tables = set(inspect(engine).get_table_names())
            self.assertFalse(set(self.TABLES) & tables)
            self.assertTrue({'workspace_sprint_reviews', 'sprint_review_cells'} <= tables)
            self.assertEqual(legacy(), expected)
            command.upgrade(config, 'head')
            self.assertEqual(legacy(), expected)
            db_engine.dispose_engines()

    def test_unpadded_sprint_order_is_rejected(self):
        with tempfile.TemporaryDirectory(dir='tests') as directory:
            url, config = self._config(directory, 'order.db')
            command.upgrade(config, 'head')
            with db_engine.session_scope(url) as session:
                workspace = models.Workspace(environment_key='synthetic-order', name='Synthetic')
                session.add(workspace)
                session.flush()
                workspace_id = workspace.id
            insert = text("INSERT INTO group_sprint_review_views (id,workspace_id,group_id,sprint_id,sprint_order,layouts,view_revision) VALUES (:id,:w,'g','17',:o,'{}',1)")
            with self.assertRaises(IntegrityError):
                with db_engine.session_scope(url) as session:
                    session.execute(insert, {'id': '00000000000000000000000000000003', 'w': workspace_id, 'o': '17'})
            with db_engine.session_scope(url) as session:
                session.execute(insert, {'id': '00000000000000000000000000000004', 'w': workspace_id, 'o': review.sprint_order('17')})
            db_engine.dispose_engines()

    def test_sprint_order_pads_to_128(self):
        self.assertEqual(review.sprint_order('17'), '0' * 126 + '17')
        self.assertEqual(len(review.sprint_order('9' * 128)), 128)
        self.assertLess(review.sprint_order('9'), review.sprint_order('10'))


class SprintReviewMigrationTests(unittest.TestCase):
    def test_layout_upgrade_preserves_existing_review(self):
        with tempfile.TemporaryDirectory(dir='tests') as directory:
            url = 'sqlite+pysqlite:///' + str(Path(directory).resolve() / 'layout.db')
            config = Config('backend/db/alembic.ini')
            config.set_main_option('sqlalchemy.url', url)
            command.upgrade(config, '20261001_0017')
            engine = db_engine.get_engine(url)
            with db_engine.session_scope(url) as session:
                workspace = models.Workspace(environment_key='synthetic-layout', name='Synthetic')
                session.add(workspace)
                session.flush()
                session.execute(text("INSERT INTO workspace_sprint_reviews (id,workspace_id,sprint_id,schema_revision,columns) VALUES ('00000000000000000000000000000001',:workspace,'17',3,'[]')"), {'workspace':workspace.id})
            command.upgrade(config, 'head')
            with db_engine.session_scope(url) as session:
                row = session.get(models.WorkspaceSprintReview, '00000000-0000-0000-0000-000000000001')
                self.assertEqual((row.schema_revision,row.columns,row.layouts), (3,[],{}))
            command.downgrade(config, '20261001_0017')
            self.assertNotIn('layouts', [column['name'] for column in inspect(engine).get_columns('workspace_sprint_reviews')])
            command.upgrade(config, 'head')
            with db_engine.session_scope(url) as session:
                self.assertEqual(session.get(models.WorkspaceSprintReview, '00000000-0000-0000-0000-000000000001').schema_revision,3)
            db_engine.dispose_engines()

    def test_upgrade_downgrade_and_model_contract(self):
        with tempfile.TemporaryDirectory(dir='tests') as directory:
            url = 'sqlite+pysqlite:///' + str(Path(directory).resolve() / 'migration.db')
            config = Config('backend/db/alembic.ini')
            config.set_main_option('sqlalchemy.url', url)
            command.upgrade(config, 'head')
            engine = db_engine.get_engine(url)
            for name in ('workspace_sprint_reviews', 'sprint_review_cells'):
                self.assertIn(name, inspect(engine).get_table_names())
                self.assertEqual(set(c['name'] for c in inspect(engine).get_columns(name)), set(models.Base.metadata.tables[name].columns.keys()))
            command.downgrade(config, '20260913_0016')
            self.assertNotIn('workspace_sprint_reviews', inspect(engine).get_table_names())
            self.assertNotIn('sprint_review_cells', inspect(engine).get_table_names())
            self.assertIn('workspace_sprint_team_catalogs', inspect(engine).get_table_names())
            db_engine.dispose_engines()
