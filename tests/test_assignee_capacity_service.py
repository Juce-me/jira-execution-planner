"""Synthetic contract tests for the per-Team, per-Sprint assignee capacity store (#323)."""
import io
import json
import os
from pathlib import Path
import tempfile
from threading import Event, Thread, current_thread
import time
import unittest
import uuid
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine, models
from backend.services import assignee_capacity as capacity

TEAM = 'team-a'


def context_for(workspace_id):
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
        atlassian_account_id='synthetic-account', workspace_id=workspace_id,
        auth_connection_id='synthetic-db-connection', cloud_id='synthetic-cloud',
        site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)


class CapacityFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='tests')
        self.url = 'sqlite+pysqlite:///' + str(Path(self.temp.name).resolve() / 'capacity.db')
        models.Base.metadata.create_all(db_engine.get_engine(self.url))
        self.env = patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db'})
        self.env.start()
        with db_engine.session_scope(self.url) as session:
            first = models.Workspace(environment_key='synthetic-capacity', name='Synthetic')
            second = models.Workspace(environment_key='synthetic-capacity-other', name='Other')
            session.add_all([first, second])
            session.flush()
            self.workspace, self.other_workspace = first.id, second.id
        self.context = context_for(self.workspace)

    def tearDown(self):
        self.env.stop()
        db_engine.dispose_engines()
        self.temp.cleanup()

    def get(self, sprint='20', team=TEAM, context=None):
        return capacity.get_document(context or self.context, sprint, team, self.url)

    def patch_rows(self, changes, sprint='20', team=TEAM, context=None, planned=None):
        return capacity.apply_changes(context or self.context, sprint, team, changes, self.url, planned=planned)

    def patch_planned(self, planned, sprint='20', team=TEAM, changes=(), context=None):
        return self.patch_rows(list(changes), sprint, team, context, planned=planned)

    def count(self):
        with db_engine.session_scope(self.url) as session:
            return session.query(models.PlanningTeamSprintCapacity).count()

    def assert_error(self, code, status, fn, *args, **kwargs):
        with self.assertRaises(capacity.ReviewError) as raised:
            fn(*args, **kwargs)
        self.assertEqual((raised.exception.code, raised.exception.status), (code, status))

    @staticmethod
    def by_key(document):
        return {row['assigneeKey']: row for row in document['rows']}


class AssigneeCapacityServiceTests(CapacityFixture):
    def test_empty_read_has_no_document_and_no_inheritance(self):
        self.assertEqual(self.get(), {'teamId': TEAM, 'sprintId': '20', 'revision': 0, 'rows': [], 'planned': None, 'inherited': None})
        self.assertEqual(self.count(), 0)

    def test_first_write_creates_the_document_with_revision_one(self):
        saved = self.patch_rows([{'assigneeKey': 'acc-1', 'displayName': 'Ada', 'capacity': '8.50', 'notes': 'half days'}])
        self.assertEqual((saved['revision'], saved['inherited']), (1, None))
        self.assertEqual(self.by_key(saved)['acc-1'], {'assigneeKey': 'acc-1', 'displayName': 'Ada', 'capacity': '8.5',
                                                      'vacations': None, 'notes': 'half days', 'removed': False})
        self.assertEqual(self.get()['rows'], saved['rows'])
        self.assertEqual(self.count(), 1)

    def test_later_sprint_reads_nearest_earlier_document_as_inherited_and_never_writes(self):
        self.patch_rows([{'assigneeKey': 'acc-1', 'displayName': 'Ada', 'capacity': '8', 'vacations': '2', 'notes': 'n'},
                         {'assigneeKey': 'acc-2', 'displayName': 'Bob', 'capacity': '5', 'removed': True}], sprint='10')
        self.patch_rows([{'assigneeKey': 'acc-1', 'capacity': '9'}], sprint='15')
        for sprint in ('16', '999'):
            document = self.get(sprint)
            self.assertEqual((document['revision'], document['rows']), (0, []))
            self.assertEqual(document['inherited']['fromSprintId'], '15')
            self.assertEqual(document['inherited']['rows'], [{'assigneeKey': 'acc-1', 'displayName': 'Ada', 'capacity': '9',
                                                              'vacations': None, 'notes': None, 'removed': False}])
        self.assertEqual(self.get('12')['inherited']['fromSprintId'], '10')
        self.assertIsNone(self.get('9')['inherited'])
        self.assertEqual(self.count(), 2)

    def test_numeric_sprint_order_beats_string_order(self):
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '1'}], sprint='9')
        self.patch_rows([{'assigneeKey': 'b', 'capacity': '2'}], sprint='100')
        self.assertEqual(self.get('101')['inherited']['fromSprintId'], '100')
        self.assertEqual(self.get('99')['inherited']['fromSprintId'], '9')

    def test_own_document_hides_inheritance(self):
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '1'}], sprint='10')
        self.patch_rows([{'assigneeKey': 'b', 'capacity': '2'}], sprint='11')
        document = self.get('11')
        self.assertIsNone(document['inherited'])
        self.assertEqual(sorted(self.by_key(document)), ['a', 'b'])

    def test_first_write_materialises_people_and_capacity_only(self):
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8', 'vacations': '3', 'notes': 'x'},
                         {'assigneeKey': 'b', 'displayName': 'Bob', 'capacity': '4', 'removed': True},
                         {'assigneeKey': 'c', 'displayName': 'Cy'}], sprint='10')
        saved = self.patch_rows([{'assigneeKey': 'c', 'capacity': '6'}], sprint='11')
        rows = self.by_key(saved)
        self.assertEqual(sorted(rows), ['a', 'c'])
        self.assertEqual((rows['a']['capacity'], rows['a']['vacations'], rows['a']['notes'], rows['a']['displayName']), ('8', None, None, 'Ada'))
        self.assertEqual((rows['c']['capacity'], rows['c']['displayName']), ('6', 'Cy'))
        self.assertEqual(saved['revision'], 1)
        # The source is untouched.
        self.assertEqual(self.get('10')['revision'], 1)
        self.assertEqual(len(self.get('10')['rows']), 3)

    def test_partial_edit_keeps_downstream_people(self):
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8'}, {'assigneeKey': 'b', 'displayName': 'Bob', 'capacity': '4'}], sprint='10')
        self.patch_rows([{'assigneeKey': 'a', 'notes': 'mid'}], sprint='11')
        downstream = self.get('12')
        self.assertEqual(downstream['inherited']['fromSprintId'], '11')
        self.assertEqual(sorted(row['assigneeKey'] for row in downstream['inherited']['rows']), ['a', 'b'])

    def test_vacation_edit_on_a_gray_row_keeps_its_capacity(self):
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8'}], sprint='10')
        saved = self.patch_rows([{'assigneeKey': 'a', 'vacations': '2'}], sprint='11')
        self.assertEqual((self.by_key(saved)['a']['capacity'], self.by_key(saved)['a']['vacations']), ('8', '2'))

    def test_per_field_last_write_wins_absent_unchanged_null_clears(self):
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8', 'vacations': '1', 'notes': 'n'}])
        saved = self.patch_rows([{'assigneeKey': 'a', 'capacity': '9', 'vacations': None}])
        row = self.by_key(saved)['a']
        self.assertEqual((row['capacity'], row['vacations'], row['notes'], row['displayName']), ('9', None, 'n', 'Ada'))
        self.assertEqual(saved['revision'], 2)

    def test_display_name_snapshot_refreshes_when_supplied_and_is_never_dropped(self):
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8'}])
        self.assertEqual(self.by_key(self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada L.'}]))['a']['displayName'], 'Ada L.')
        self.assertEqual(self.by_key(self.patch_rows([{'assigneeKey': 'a', 'capacity': '7'}]))['a']['displayName'], 'Ada L.')
        self.assert_error('invalid_review_request', 400, self.patch_rows, [{'assigneeKey': 'a', 'displayName': None}])

    def test_person_without_stories_stays_under_the_stored_name_and_reads_never_write(self):
        self.patch_rows([{'assigneeKey': 'gone', 'displayName': 'Deactivated Person', 'capacity': '5'}], sprint='10')
        statements = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, *args: statements.append(statement.split()[0].upper())
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            own, later = self.get('10'), self.get('14')
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        self.assertEqual(own['rows'][0]['displayName'], 'Deactivated Person')
        self.assertEqual(later['inherited']['rows'][0]['displayName'], 'Deactivated Person')
        self.assertEqual(set(statements), {'SELECT'})

    def test_get_runs_at_most_four_queries(self):
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '1'}], sprint='10')
        statements = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, *args: statements.append(statement)
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            self.get('10')
            self.get('11')
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        self.assertLessEqual(len(statements), 4)

    def test_empty_and_no_op_changes_create_no_document(self):
        self.assertEqual(self.patch_rows([])['revision'], 0)
        self.assertEqual(self.patch_rows([{'assigneeKey': 'ghost'}])['rows'], [])
        self.assertEqual(self.count(), 0)
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8'}], sprint='10')
        # Same value as the inherited gray row, and the same value on an existing document.
        inherited = self.patch_rows([{'assigneeKey': 'a', 'capacity': '8'}], sprint='11')
        self.assertEqual((inherited['revision'], self.count()), (0, 1))
        again = self.patch_rows([{'assigneeKey': 'a', 'capacity': '8.00'}], sprint='10')
        self.assertEqual(again['revision'], 1)

    def test_remove_and_restore_keep_values(self):
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8', 'notes': 'n'}])
        removed = self.by_key(self.patch_rows([{'assigneeKey': 'a', 'removed': True}]))['a']
        self.assertEqual((removed['removed'], removed['capacity'], removed['notes']), (True, '8', 'n'))
        restored = self.by_key(self.patch_rows([{'assigneeKey': 'a', 'removed': False}]))['a']
        self.assertEqual((restored['removed'], restored['capacity']), (False, '8'))

    def test_removing_a_gray_row_materialises_without_it_downstream(self):
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '8'}, {'assigneeKey': 'b', 'capacity': '4'}], sprint='10')
        self.patch_rows([{'assigneeKey': 'b', 'removed': True}], sprint='11')
        self.assertEqual([r['assigneeKey'] for r in self.get('12')['inherited']['rows']], ['a'])

    def test_validation_bounds(self):
        bad = [
            [{'assigneeKey': 'a', 'capacity': '10000.01'}], [{'assigneeKey': 'a', 'capacity': '1.234'}],
            [{'assigneeKey': 'a', 'capacity': '-1'}], [{'assigneeKey': 'a', 'capacity': 5}],
            [{'assigneeKey': 'a', 'capacity': '1e3'}], [{'assigneeKey': 'a', 'vacations': '10001'}],
            [{'assigneeKey': 'a', 'notes': 'x' * 501}], [{'assigneeKey': 'a', 'notes': 'two\nlines'}],
            [{'assigneeKey': 'a', 'displayName': 'x' * 201}], [{'assigneeKey': 'a', 'displayName': 'bad\x00'}],
            [{'assigneeKey': 'k' * 129}], [{'assigneeKey': ''}], [{'assigneeKey': ' a'}], [{'assigneeKey': 7}],
            [{'assigneeKey': 'a', 'removed': 'yes'}], [{'assigneeKey': 'a', 'removed': None}],
            [{'assigneeKey': 'a', 'unknown': 1}], [{'capacity': '1'}], ['a'],
            [{'assigneeKey': 'a'}, {'assigneeKey': 'a'}],
            [{'assigneeKey': f'p{i}'} for i in range(51)], 'nope', None,
        ]
        for changes in bad:
            with self.subTest(changes=str(changes)[:60]):
                self.assert_error('invalid_review_request', 400, self.patch_rows, changes)
        self.assertEqual(self.count(), 0)
        for good in ('0', '10000', '10000.00', '0.5', '12.25'):
            self.patch_rows([{'assigneeKey': 'a', 'capacity': good}])
        notes = 'x' * 500
        self.assertEqual(self.by_key(self.patch_rows([{'assigneeKey': 'a', 'notes': notes}]))['a']['notes'], notes)

    def test_bad_identities_are_rejected(self):
        self.assert_error('invalid_review_request', 400, self.get, 'abc')
        self.assert_error('invalid_review_request', 400, self.get, '20', 'x' * 129)
        self.assert_error('invalid_review_request', 400, self.get, '20', '')
        self.assert_error('invalid_review_request', 400, self.patch_rows, [], 'x1')

    def test_row_cap_is_one_hundred(self):
        self.patch_rows([{'assigneeKey': f'p{i}', 'capacity': '1'} for i in range(50)])
        self.patch_rows([{'assigneeKey': f'q{i}', 'capacity': '1'} for i in range(50)])
        self.assert_error('assignee_capacity_row_limit', 400, self.patch_rows, [{'assigneeKey': 'extra', 'capacity': '1'}])
        self.assertEqual(len(self.get()['rows']), 100)

    def test_write_time_size_guard_never_stores_an_unreadable_document(self):
        wide = '\U0001F600'  # one code point, four UTF-8 bytes
        row = lambda key: {'assigneeKey': key, 'displayName': wide * 200, 'notes': wide * 500, 'capacity': '1'}
        self.patch_rows([row(f'p{i}') for i in range(50)])
        before = self.get()
        self.assert_error('review_response_limit', 413, self.patch_rows, [row(f'q{i}') for i in range(50)])
        after = self.get()
        self.assertEqual((after['revision'], len(after['rows'])), (before['revision'], 50))
        # A first write that would already be too large creates no document at all.
        self.patch_rows([{'assigneeKey': 'only', 'capacity': '1'}], sprint='19')
        documents = self.count()
        with patch.object(capacity, 'MAX_RESPONSE_BYTES', 1100):
            self.assert_error('review_response_limit', 413, self.patch_rows, [{'assigneeKey': 'new', 'capacity': '1'}], '22')
        self.assertEqual(self.count(), documents)

    def test_lock_and_statement_timeouts_map_to_assignee_capacity_busy(self):
        class Orig(Exception):
            def __init__(self, sqlstate):
                super().__init__(sqlstate)
                self.sqlstate = sqlstate
        for sqlstate in ('55P03', '57014'):
            with patch.object(capacity.db_engine, 'session_scope', side_effect=capacity.DBAPIError('s', {}, Orig(sqlstate))):
                self.assert_error('assignee_capacity_busy', 503, self.patch_rows, [{'assigneeKey': 'a', 'capacity': '1'}])
        with patch.object(capacity.db_engine, 'session_scope', side_effect=capacity.DBAPIError('s', {}, Orig('23505'))):
            with self.assertRaises(capacity.DBAPIError):
                self.patch_rows([{'assigneeKey': 'a', 'capacity': '1'}])

    def test_document_cap_per_workspace(self):
        with patch.object(capacity, 'MAX_DOCUMENTS_PER_WORKSPACE', 2):
            self.patch_rows([{'assigneeKey': 'a', 'capacity': '1'}], sprint='1')
            self.patch_rows([{'assigneeKey': 'a', 'capacity': '2'}], sprint='2')
            self.assert_error('assignee_capacity_document_limit', 400, self.patch_rows, [{'assigneeKey': 'a', 'capacity': '3'}], '3')
            self.patch_rows([{'assigneeKey': 'a', 'capacity': '4'}], sprint='2')
            self.patch_rows([{'assigneeKey': 'a', 'capacity': '5'}], sprint='3', context=context_for(self.other_workspace))

    def test_workspace_and_team_isolation(self):
        other = context_for(self.other_workspace)
        self.patch_rows([{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8'}], sprint='10')
        self.assertEqual(self.get('10', context=other)['rows'], [])
        self.assertIsNone(self.get('11', context=other)['inherited'])
        self.assertIsNone(self.get('11', team='team-b')['inherited'])
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '1'}], sprint='10', context=other)
        self.assertEqual(self.by_key(self.get('10'))['a']['capacity'], '8')
        self.assertEqual(self.by_key(self.get('10', context=other))['a']['capacity'], '1')

    def test_context_requirements(self):
        anonymous = RequestAuthContext(auth_mode='atlassian_oauth', user_id='', stable_subject='', atlassian_account_id='',
                                       workspace_id='', auth_connection_id='', cloud_id='', site_url='', token_version='1',
                                       account_status='active', is_admin=False)
        with self.assertRaises(AuthError):
            self.get(context=anonymous)
        with self.assertRaises(AuthError):
            capacity.get_document(None, '20', TEAM, self.url)

    def test_cascade_on_workspace_delete_is_declared(self):
        fk = next(iter(models.PlanningTeamSprintCapacity.__table__.c.workspace_id.foreign_keys))
        self.assertEqual(fk.ondelete, 'CASCADE')


class PlannedTeamCapacityServiceTests(CapacityFixture):
    """Stored team capacity ("Team capacity (not in Jira)") on the same document."""

    def stored(self, sprint='20'):
        with db_engine.session_scope(self.url) as session:
            row = session.query(models.PlanningTeamSprintCapacity).filter_by(sprint_id=sprint).one()
            return row.planned_capacity, row.planned_source

    def test_planned_only_patch_creates_and_persists(self):
        saved = self.patch_planned({'value': '12.50', 'source': 'user'})
        self.assertEqual((saved['revision'], saved['rows'], saved['planned']), (1, [], {'value': '12.5', 'source': 'user'}))
        self.assertEqual(self.get()['planned'], {'value': '12.5', 'source': 'user'})
        self.assertEqual(self.stored(), ('12.5', 'user'))
        again = self.patch_planned({'value': '13', 'source': 'jira'})
        self.assertEqual((again['revision'], again['planned']), (2, {'value': '13', 'source': 'jira'}))

    def test_null_value_clears_value_and_source(self):
        self.patch_planned({'value': '8', 'source': 'user'})
        cleared = self.patch_planned({'value': None})
        self.assertEqual((cleared['planned'], cleared['revision']), (None, 2))
        self.assertEqual(self.stored(), (None, None))
        self.assertIsNone(self.patch_planned({'value': None, 'source': None})['planned'])
        self.assertEqual(self.get()['revision'], 2)

    def test_same_planned_is_a_no_op(self):
        self.patch_planned({'value': '8', 'source': 'user'})
        self.assertEqual(self.patch_planned({'value': '8.00', 'source': 'user'})['revision'], 1)
        self.assertEqual(self.count(), 1)

    def test_empty_patch_is_a_no_op_without_lock_or_document(self):
        statements = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, *args: statements.append(statement.split()[0].upper())
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            document = self.patch_rows([])
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        self.assertEqual((document['revision'], document['planned'], self.count()), (0, None, 0))
        self.assertEqual(set(statements), {'SELECT'})

    def test_planned_validation_and_inherited_source_rejected_from_client(self):
        bad = [
            {'value': '10000.01', 'source': 'user'}, {'value': '1.234', 'source': 'user'}, {'value': '-1', 'source': 'user'},
            {'value': 5, 'source': 'user'}, {'value': '1e3', 'source': 'user'}, {'value': '5'},
            {'value': '5', 'source': 'inherited'}, {'value': '5', 'source': 'other'}, {'value': '5', 'source': None},
            {'value': None, 'source': 'user'}, {'source': 'user'}, {'value': '5', 'source': 'user', 'extra': 1},
            {'value': '5', 'source': 'jira', 'onlyIfSource': []}, {'value': '5', 'source': 'jira', 'onlyIfSource': 'jira'},
            {'value': '5', 'source': 'jira', 'onlyIfSource': ['jira', 'jira']},
            {'value': '5', 'source': 'jira', 'onlyIfSource': ['bogus']}, 'nope', ['value'], 0,
        ]
        for planned in bad:
            with self.subTest(planned=planned):
                self.assert_error('invalid_review_request', 400, self.patch_planned, planned)
        self.assertEqual(self.count(), 0)
        for good in ('0', '10000', '0.5', '12.25'):
            self.assertEqual(self.patch_planned({'value': good, 'source': 'user'})['planned']['value'], good)

    def test_inheritance_carries_planned_and_reads_never_write(self):
        self.patch_planned({'value': '30', 'source': 'user'}, sprint='10',
                           changes=[{'assigneeKey': 'a', 'displayName': 'Ada', 'capacity': '8'}])
        statements = []
        engine = db_engine.get_engine(self.url)
        listener = lambda conn, cursor, statement, *args: statements.append(statement.split()[0].upper())
        event.listen(engine, 'before_cursor_execute', listener)
        try:
            later = self.get('11')
        finally:
            event.remove(engine, 'before_cursor_execute', listener)
        self.assertEqual(set(statements), {'SELECT'})
        self.assertEqual((later['revision'], later['planned']), (0, None))
        self.assertEqual(later['inherited']['planned'], {'value': '30', 'source': 'inherited'})
        self.assertEqual(self.count(), 1)
        self.patch_rows([{'assigneeKey': 'b', 'capacity': '1'}], sprint='12')
        self.assertIsNone(self.get('12')['inherited'])

    def test_source_without_planned_inherits_null(self):
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '8'}], sprint='10')
        self.assertIsNone(self.get('11')['inherited']['planned'])
        self.assertIsNone(self.patch_rows([{'assigneeKey': 'a', 'notes': 'n'}], sprint='11')['planned'])

    def test_first_write_materialises_planned_as_inherited(self):
        self.patch_planned({'value': '30', 'source': 'user'}, sprint='10')
        saved = self.patch_rows([{'assigneeKey': 'a', 'capacity': '4'}], sprint='11')
        self.assertEqual((saved['revision'], saved['planned'], saved['inherited']), (1, {'value': '30', 'source': 'inherited'}, None))
        self.assertEqual(self.stored('11'), ('30', 'inherited'))
        # The next Sprint still shows it, still as inherited.
        self.assertEqual(self.get('12')['inherited']['planned'], {'value': '30', 'source': 'inherited'})
        # A planned write on the gray number materialises the user's value instead.
        typed = self.patch_planned({'value': '25', 'source': 'user'}, sprint='13')
        self.assertEqual((typed['planned'], self.stored('13')), ({'value': '25', 'source': 'user'}, ('25', 'user')))

    def test_only_if_source_applies_when_stored_source_matches(self):
        self.patch_planned({'value': '30', 'source': 'user'}, sprint='10')
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '4'}], sprint='11')  # stored source: inherited
        mirror = {'value': '28', 'source': 'jira', 'onlyIfSource': ['jira', 'inherited']}
        applied = self.patch_planned(mirror, sprint='11')
        self.assertEqual((applied['planned'], applied['revision']), ({'value': '28', 'source': 'jira'}, 2))
        self.assertEqual(self.patch_planned({**mirror, 'value': '27'}, sprint='11')['planned'], {'value': '27', 'source': 'jira'})

    def test_only_if_source_never_overwrites_a_user_edit(self):
        self.patch_planned({'value': '30', 'source': 'user'})
        unchanged = self.patch_planned({'value': '28', 'source': 'jira', 'onlyIfSource': ['jira', 'inherited']})
        self.assertEqual((unchanged['planned'], unchanged['revision']), ({'value': '30', 'source': 'user'}, 1))
        self.assertEqual(self.stored(), ('30', 'user'))

    def test_only_if_source_matches_absent_number_only_when_listed(self):
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '4'}])
        self.assertIsNone(self.patch_planned({'value': '28', 'source': 'jira', 'onlyIfSource': ['jira', 'inherited']})['planned'])
        filled = self.patch_planned({'value': '28', 'source': 'jira', 'onlyIfSource': [None, 'jira', 'inherited']})
        self.assertEqual((filled['planned'], filled['revision']), ({'value': '28', 'source': 'jira'}, 2))

    def test_mirror_never_creates_a_document(self):
        mirror = {'value': '28', 'source': 'jira', 'onlyIfSource': [None, 'jira', 'inherited']}
        self.assertEqual(self.patch_planned(mirror)['revision'], 0)
        self.assertEqual(self.count(), 0)
        self.patch_planned({'value': '30', 'source': 'user'}, sprint='10')
        inherited = self.patch_planned(mirror, sprint='11')
        self.assertEqual((inherited['revision'], inherited['inherited']['planned']), (0, {'value': '30', 'source': 'inherited'}))
        self.assertEqual(self.count(), 1)
        # With row changes the document is created, but the guarded planned part is not applied.
        created = self.patch_planned(mirror, sprint='11', changes=[{'assigneeKey': 'a', 'capacity': '1'}])
        self.assertEqual(created['planned'], {'value': '30', 'source': 'inherited'})

    def test_check_constraints_reject_unpaired_or_unknown_sources(self):
        self.patch_rows([{'assigneeKey': 'a', 'capacity': '1'}])
        for capacity_value, source in (('5', None), (None, 'user'), ('5', 'bogus')):
            with self.subTest(capacity=capacity_value, source=source):
                with self.assertRaises(IntegrityError):
                    with db_engine.session_scope(self.url) as session:
                        row = session.query(models.PlanningTeamSprintCapacity).one()
                        row.planned_capacity, row.planned_source = capacity_value, source
                        session.flush()

    def test_planned_counts_in_the_write_time_size_guard(self):
        bare = {'teamId': TEAM, 'sprintId': '20', 'revision': 1, 'rows': [], 'planned': None, 'inherited': None}
        fits_null = capacity.RESPONSE_RESERVE_BYTES + len(json.dumps(bare, separators=(',', ':'))) + 5
        with patch.object(capacity, 'MAX_RESPONSE_BYTES', fits_null):
            self.assert_error('review_response_limit', 413, self.patch_planned, {'value': '5', 'source': 'user'})
        self.assertEqual(self.count(), 0)

    def test_planned_is_isolated_by_workspace_and_team(self):
        self.patch_planned({'value': '30', 'source': 'user'}, sprint='10')
        self.assertIsNone(self.get('11', context=context_for(self.other_workspace))['inherited'])
        self.assertIsNone(self.get('11', team='team-b')['inherited'])


class AssigneeCapacityMigrationTests(unittest.TestCase):
    def config(self, url):
        config = Config('backend/db/alembic.ini')
        config.set_main_option('sqlalchemy.url', url)
        return config

    def test_postgresql_offline_sql(self):
        config = self.config('postgresql+psycopg://user@db.example:5432/planner?sslmode=require')
        output = io.StringIO()
        config.output_buffer = output
        with patch.dict(os.environ, {'DATABASE_CONNECTION_MODE': 'url'}, clear=False):
            command.upgrade(config, '20261028_0021:20261029_0022', sql=True)
        sql = output.getvalue()
        for required in ('CREATE TABLE planning_team_sprint_capacity', 'ON DELETE CASCADE', 'length(sprint_order) = 128',
                         'revision >= 1', 'uq_planning_team_sprint_capacity', 'CREATE INDEX ix_planning_team_sprint_capacity_order',
                         '(workspace_id, team_id, sprint_order)', 'planned_capacity VARCHAR(16)', 'planned_source VARCHAR(16)',
                         "CONSTRAINT ck_planning_team_sprint_capacity_planned_source CHECK (planned_source IN ('user', 'jira', 'inherited'))",
                         'CONSTRAINT ck_planning_team_sprint_capacity_planned_pair CHECK ((planned_capacity IS NULL) = (planned_source IS NULL))'):
            self.assertIn(required, sql)
        self.assertNotIn('DROP TABLE', sql)

    def test_downgrade_drops_only_the_new_table(self):
        config = self.config('postgresql+psycopg://user@db.example:5432/planner?sslmode=require')
        output = io.StringIO()
        config.output_buffer = output
        with patch.dict(os.environ, {'DATABASE_CONNECTION_MODE': 'url'}, clear=False):
            command.downgrade(config, '20261029_0022:20261028_0021', sql=True)
        sql = output.getvalue()
        self.assertIn('DROP TABLE planning_team_sprint_capacity', sql)
        self.assertEqual(sql.count('DROP TABLE'), 1)

    def test_head_schema_matches_the_model(self):
        with tempfile.TemporaryDirectory(dir='tests') as tmp:
            url = 'sqlite+pysqlite:///' + str(Path(tmp).resolve() / 'head.db')
            with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': url, 'DATABASE_CONNECTION_MODE': 'url'}):
                command.upgrade(self.config(url), 'head')
                from sqlalchemy import inspect
                inspector = inspect(db_engine.get_engine(url))
                columns = {c['name']: c for c in inspector.get_columns('planning_team_sprint_capacity')}
                self.assertEqual(set(columns), set(models.PlanningTeamSprintCapacity.__table__.c.keys()))
                self.assertTrue(columns['planned_capacity']['nullable'] and columns['planned_source']['nullable'])
                checks = {c['name'] for c in inspector.get_check_constraints('planning_team_sprint_capacity')}
                model_checks = {c.name for c in models.PlanningTeamSprintCapacity.__table__.constraints
                                if c.__class__.__name__ == 'CheckConstraint'}
                self.assertEqual(checks, model_checks)
                self.assertIn('ck_planning_team_sprint_capacity_planned_pair', checks)
                self.assertEqual([i['column_names'] for i in inspector.get_indexes('planning_team_sprint_capacity')],
                                 [['workspace_id', 'team_id', 'sprint_order']])
                db_engine.dispose_engines()


@unittest.skipUnless(os.environ.get('REQUIRE_POSTGRES_REVIEW_CONCURRENCY') == '1',
                     'Explicit approved PostgreSQL review test target is required')
class AssigneeCapacityPostgresqlRaceTests(unittest.TestCase):
    """Two first-writers of one new document: the loser waits on the winner's row and merges, losing nothing."""

    def setUp(self):
        parsed = make_url(os.environ.get('TEST_DATABASE_URL', ''))
        if parsed.get_backend_name() != 'postgresql':
            raise AssertionError('An explicit PostgreSQL TEST_DATABASE_URL is required')
        self.env = patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_CONNECTION_MODE': 'url'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.schema = 'capacity_race_' + uuid.uuid4().hex
        self.admin = create_engine(parsed, future=True)
        with self.admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.addCleanup(self.cleanup_schema)
        bounded = parsed.update_query_dict({'options': f'-csearch_path={self.schema} -cstatement_timeout=10000'})
        self.url = bounded.render_as_string(hide_password=False)
        config = Config('backend/db/alembic.ini')
        config.set_main_option('sqlalchemy.url', self.url.replace('%', '%%'))
        command.upgrade(config, 'head')
        with db_engine.session_scope(self.url) as session:
            workspace = models.Workspace(environment_key='capacity-' + uuid.uuid4().hex, name='Synthetic')
            session.add(workspace)
            session.flush()
            self.context = context_for(workspace.id)

    def cleanup_schema(self):
        db_engine.dispose_engines()
        with self.admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        self.admin.dispose()

    def wait_until_blocked(self):
        deadline = time.monotonic() + 4
        query = text("""
            SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0
              AND query ILIKE '%planning_team_sprint_capacity%'
        """)
        while time.monotonic() < deadline:
            with self.admin.connect() as conn:
                if conn.execute(query).scalar() >= 1:
                    return
            time.sleep(0.02)
        raise AssertionError('second first-writer never waited on the document row lock')

    def test_two_first_writers_of_one_new_document_both_land(self):
        entered, release, results = Event(), Event(), {}
        real_merge, calls = capacity.merge_changes, {}

        def pausing_merge(rows, changes):
            # The first call per thread is the unlocked no-op precheck; the second runs under the row lock.
            name = current_thread().name
            calls[name] = calls.get(name, 0) + 1
            if name == 'first' and calls[name] == 2:
                entered.set()
                if not release.wait(8):
                    raise AssertionError('first writer was never released')
            return real_merge(rows, changes)

        def run(name, key):
            try:
                results[name] = capacity.apply_changes(self.context, '20', 'team-a', [{'assigneeKey': key, 'capacity': '3'}], self.url)
            except Exception as error:  # noqa: BLE001 - returned to the test for assertion
                results[name] = error

        with patch.object(capacity, 'merge_changes', pausing_merge):
            first = Thread(target=run, args=('first', 'acc-1'), name='first')
            second = Thread(target=run, args=('second', 'acc-2'), name='second')
            first.start()
            self.assertTrue(entered.wait(5))
            second.start()
            try:
                self.wait_until_blocked()
            finally:
                release.set()
            first.join(10)
            second.join(10)
        self.assertFalse(isinstance(results.get('first'), Exception) or isinstance(results.get('second'), Exception), results)
        document = capacity.get_document(self.context, '20', 'team-a', self.url)
        self.assertEqual(sorted(row['assigneeKey'] for row in document['rows']), ['acc-1', 'acc-2'])
        self.assertEqual(document['revision'], 2)
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.PlanningTeamSprintCapacity).count(), 1)


if __name__ == '__main__':
    unittest.main()
