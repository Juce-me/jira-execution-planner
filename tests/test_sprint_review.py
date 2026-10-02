"""Synthetic review contract tests; no real Jira data or writes."""
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
from sqlalchemy import inspect, text

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine, models
from backend.services import sprint_review as review


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
        self.context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
            atlassian_account_id='synthetic-account', workspace_id=self.workspace,
            auth_connection_id='synthetic-db-connection', cloud_id='synthetic-cloud',
            site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)
        self.column = {'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': 'Estimate', 'type': 'number', 'aggregation': 'sum'}
        self.search = Mock(side_effect=self._search)

    def tearDown(self):
        self.env.stop()
        db_engine.dispose_engines()
        self.temp.cleanup()

    def _search(self, payload, **kwargs):
        self.assertIs(kwargs['context'], self.context)
        self.assertLessEqual(kwargs['timeout'], 15)
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')
        return Mock(status_code=200, json=lambda: {'issues': [{'id': i, 'fields': {'issuetype': {'name': 'Story', 'subtask': False}}} for i in ids], 'isLast': True})

    def save(self, cells=None, schemas=None, base=1, sprint='17', context=None):
        return review.save_review(context or self.context, sprint,
            {'baseSchemaRevision': base, 'schemaChanges': schemas or [], 'cellChanges': cells or []}, self.url, self.search)

    def add(self):
        return self.save(schemas=[{'action': 'add', 'column': self.column}], base=0)

    def cell(self, value='1.1', base=0, issue='101', column=None, kind='story'):
        return {'issueId': issue, 'rowKind': kind, 'columnId': column or self.column['id'], 'value': value, 'baseRevision': base}


class SprintReviewTests(ReviewFixture, unittest.TestCase):
    def test_layout_accepts_the_default_hidden_columns_the_table_sends(self):
        # The table posts its default hidden set with every layout draft; rejecting any of them made
        # every column change fail to save. Read the real list so the two sides cannot drift.
        model = (Path(__file__).resolve().parents[1] / 'frontend/src/eng/planningReviewTableModel.js').read_text()
        defaults = re.findall(r"'([^']+)'", re.search(r'DEFAULT_REVIEW_HIDDEN_COLUMNS = \[([^\]]*)\]', model).group(1))
        self.assertIn('projectTrack', defaults)
        revision = self.add()['schemaRevision']
        for kind in ('story', 'epic'):
            with self.subTest(kind=kind):
                result = self.save(schemas=[{'action': 'layout', 'rowKind': kind, 'order': ['status', 'priority', 'storyPoints'] + defaults, 'hidden': defaults}], base=revision)
                revision = result['schemaRevision']
                self.assertEqual(result['layouts'][kind]['hidden'], defaults)
        with self.assertRaises(review.ReviewError):
            self.save(schemas=[{'action': 'layout', 'rowKind': 'story', 'order': ['status'], 'hidden': ['status']}], base=revision)

    def test_layout_accepts_the_accepted_column_in_order_and_hidden(self):
        # The computed Accepted column is a built-in the table can order and hide like Assignee.
        revision = self.add()['schemaRevision']
        for kind in ('story', 'epic'):
            with self.subTest(kind=kind):
                result = self.save(schemas=[{'action': 'layout', 'rowKind': kind, 'order': ['status', 'accepted', 'storyPoints'], 'hidden': ['accepted']}], base=revision)
                revision = result['schemaRevision']
                self.assertEqual(result['layouts'][kind], {'order': ['status', 'accepted', 'storyPoints'], 'hidden': ['accepted']})

    def test_layout_shared_between_users_and_revision_conflicts(self):
        self.add()
        layout = {'action': 'layout', 'rowKind': 'story', 'order': [self.column['id'], 'status', 'storyPoints'], 'hidden': ['assignee','components','project','capacity']}
        result = self.save(schemas=[layout])
        other = replace(self.context, user_id='another-user')
        self.assertEqual(review.load_review(other, '17', self.url)['layouts'], result['layouts'])
        self.assertEqual(review.load_review(other, '18', self.url)['layouts'], {})
        self.assertEqual(review.load_review(replace(other, workspace_id=self.other_workspace), '17', self.url)['layouts'], {})
        with self.assertRaises(review.ReviewError) as error:
            self.save(schemas=[layout], base=1)
        self.assertEqual(error.exception.status, 409)
        for invalid in ({**layout, 'order': ['key']}, {**layout, 'order': ['status', 'status']}, {**layout, 'order': ['unknown']}, {**layout, 'hidden': ['storyPoints']}):
            with self.assertRaises(review.ReviewError):
                self.save(schemas=[invalid], base=2)
        self.assertEqual(review.load_review(other, '17', self.url)['layouts'], result['layouts'])
        epic = self.save(schemas=[{'action':'layout','rowKind':'epic','order':['storyPoints','status'],'hidden':['components']}],base=2)
        self.assertEqual(epic['layouts']['story'], result['layouts']['story'])
        self.assertEqual(review.load_review(other,'17',self.url)['layouts']['epic']['order'],['storyPoints','status'])

    def test_defaults_never_create_or_return_cells(self):
        value = review.load_review(self.context, '17', self.url)
        self.assertEqual(value['schemaRevision'], 0)
        self.assertNotIn('cells', value)
        self.assertTrue(value['capabilities']['canSave'])
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.WorkspaceSprintReview).count(), 0)

    def test_shared_users_and_sprint_workspace_row_kind_isolation(self):
        self.add()
        self.save([self.cell()])
        second = replace(self.context, user_id='another-user')
        snapshot = review.load_review(second, '17', self.url)
        self.assertEqual(snapshot['columns'][0]['id'], self.column['id'])
        for ctx, sprint, kind in [(self.context, '18', 'story'), (replace(self.context, workspace_id=self.other_workspace), '17', 'story'), (self.context, '17', 'epic')]:
            allowed_search = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [{'id': '101', 'fields': {'issuetype': {'name': 'Epic' if kind == 'epic' else 'Story'}}}], 'isLast': True}))
            self.assertEqual(review.read_values(ctx, sprint, {'issueIds': ['101'], 'rowKind': kind}, self.url, allowed_search)['cells'], [])

    def test_disjoint_saves_ignore_unrelated_cell_revision_and_same_cell_conflicts_atomic(self):
        self.add()
        self.save([self.cell(issue='101')])
        self.save([self.cell(issue='102')])
        with self.assertRaises(review.ReviewError) as raised:
            self.save([self.cell('8', base=0, issue='101'), self.cell('9', issue='103')])
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(raised.exception.details['cellConflicts'][0]['value'], '1.100')
        saved = review.read_values(self.context, '17', {'issueIds': ['101', '102', '103'], 'rowKind': 'story'}, self.url, self.search)
        self.assertEqual(len(saved['cells']), 2)

    def test_schema_conflicts_and_invalid_cells_roll_back_schema_changes(self):
        self.add()
        self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Renamed'}])
        with self.assertRaises(review.ReviewError) as raised:
            self.save(schemas=[{'action': 'archive', 'columnId': self.column['id'], 'archived': True}])
        self.assertTrue(raised.exception.details['schemaConflict'])
        with self.assertRaises(review.ReviewError):
            self.save([self.cell('9999999999')], schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Unsaved'}], base=2)
        self.assertEqual(review.load_review(self.context, '17', self.url)['columns'][0]['label'], 'Renamed')

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
        self.assertEqual(review.read_values(self.context, '17', {'issueIds': ['101'], 'rowKind': 'story'}, self.url, self.search)['cells'][0]['value'], '1.100')
        with self.assertRaises(review.ReviewError):
            self.save([self.cell(base=1)], base=2)
        changes = [{'action': 'add', 'column': {**self.column, 'id': str(uuid.uuid4())}} for _ in range(31)]
        with self.assertRaises(review.ReviewError):
            review.apply_schema([], changes)
        for column in [{**self.column, 'label': 'a' * 81}, {**self.column, 'type': 'text', 'aggregation': 'sum'}]:
            with self.assertRaises(review.ReviewError):
                review.apply_schema([], [{'action': 'add', 'column': column}])

    def test_requested_authority_rejected_and_bounds(self):
        self.add()
        for payload in [{'baseSchemaRevision': 1, 'workspaceId': self.workspace},
                        {'baseSchemaRevision': 1, 'cellChanges': [self.cell()] * 101},
                        {'baseSchemaRevision': True}, {'baseSchemaRevision': 1, 'cellChanges': [self.cell(), self.cell()]}]:
            with self.assertRaises(review.ReviewError):
                review.save_review(self.context, '17', payload, self.url, self.search)
        for ids in [['DEMO-1'], ['0'], ['101'] * 501, ['101', '101']]:
            with self.assertRaises(review.ReviewError):
                review.issue_ids(ids)

    def test_inaccessible_issue_never_reveals_cell_and_prevents_atomic_save(self):
        self.add()
        self.save([self.cell()])
        empty = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [], 'isLast': True}))
        data = review.read_values(self.context, '17', {'issueIds': ['101'], 'rowKind': 'story'}, self.url, empty)
        self.assertEqual(data, {'cells': [], 'unavailableIssueIds': ['101']})
        with self.assertRaises(review.ReviewError) as raised:
            review.save_review(self.context, '17', {'baseSchemaRevision': 1, 'cellChanges': [self.cell('2', base=1)],
                'schemaChanges': [{'action': 'rename', 'columnId': self.column['id'], 'label': 'No'}]}, self.url, empty)
        self.assertEqual(raised.exception.status, 403)
        self.assertEqual(review.load_review(self.context, '17', self.url)['schemaRevision'], 1)

    def test_issue_kind_matches_epic_or_configured_leaf_and_rejects_subtasks(self):
        self.add()
        for issue_type in [{'name': 'Epic'}, {'name': 'Initiative'}, {'name': 'Story', 'hierarchyLevel': 2}, {'name': 'Story', 'subtask': True}, {}]:
            search = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [{'id': '101', 'fields': {'issuetype': issue_type}}], 'isLast': True}))
            self.assertEqual(review.read_values(self.context, '17', {'issueIds': ['101'], 'rowKind': 'story'}, self.url, search)['unavailableIssueIds'], ['101'])
            with self.assertRaises(review.ReviewError):
                review.save_review(self.context, '17', {'baseSchemaRevision': 1, 'cellChanges': [self.cell()]}, self.url, search)
        epic_column = {**self.column, 'id': str(uuid.uuid4()), 'rowKind': 'epic'}
        self.save(schemas=[{'action': 'add', 'column': epic_column}])
        search = Mock(return_value=Mock(status_code=200, json=lambda: {'issues': [
            {'id': '101', 'fields': {'issuetype': {'name': 'Story'}}},
            {'id': '102', 'fields': {'issuetype': {'name': 'Epic'}}}], 'isLast': True}))
        result = review.save_review(self.context, '17', {'baseSchemaRevision': 2, 'cellChanges': [
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
            self.assertFalse(review.load_review(self.context, '17', self.url)['capabilities']['canSave'])
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
