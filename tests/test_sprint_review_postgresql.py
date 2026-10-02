"""Opt-in PostgreSQL first-create, schema and cell race evidence.

Requires an explicitly approved disposable TEST_DATABASE_URL. Every test owns an
isolated schema; no configured application schema or production migration is used.
"""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import os
from threading import Barrier
import unittest
import uuid
from unittest.mock import Mock, patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine, models
from backend.services import sprint_review as review


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
            workspace_id = workspace.id
        self.context = RequestAuthContext(auth_mode='atlassian_oauth', user_id='synthetic-user',
            stable_subject='synthetic-user', atlassian_account_id='synthetic-account', workspace_id=workspace_id,
            auth_connection_id='synthetic-connection', cloud_id='synthetic-cloud',
            site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)
        self.column = {'id': str(uuid.uuid4()), 'rowKind': 'story', 'label': 'Estimate', 'type': 'number', 'aggregation': 'sum'}

    def cleanup_schema(self):
        db_engine.dispose_engines()
        with self.admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        self.admin.dispose()

    def search(self, payload, **kwargs):
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')
        return Mock(status_code=200, json=lambda: {'issues': [{'id': i, 'fields': {'issuetype': {'name': 'Story'}}} for i in ids], 'isLast': True})

    def save(self, changes=None, schemas=None, base=1):
        return review.save_review(self.context, '17', {'baseSchemaRevision': base, 'schemaChanges': schemas or [],
            'cellChanges': changes or []}, self.url, self.search)

    def cell(self, issue, value='1', base=0):
        return {'issueId': issue, 'rowKind': 'story', 'columnId': self.column['id'], 'value': value, 'baseRevision': base}

    def race(self, actions):
        barrier = Barrier(len(actions))
        def run(action):
            barrier.wait(timeout=5)
            try:
                return action()
            except review.ReviewError as error:
                return error
        with ThreadPoolExecutor(max_workers=len(actions)) as pool:
            return list(pool.map(run, actions))

    def test_first_create_race_one_schema_winner(self):
        results = self.race([lambda: self.save(schemas=[{'action': 'add', 'column': self.column}], base=0)] * 2)
        self.assertEqual(sum(isinstance(r, dict) for r in results), 1)
        self.assertEqual([r.code for r in results if isinstance(r, review.ReviewError)], ['review_conflict'])
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.WorkspaceSprintReview).count(), 1)

    def test_disjoint_and_same_cell_races_are_atomic(self):
        self.save(schemas=[{'action': 'add', 'column': self.column}], base=0)
        results = self.race([lambda: self.save([self.cell('101')]), lambda: self.save([self.cell('102')])])
        self.assertTrue(all(isinstance(r, dict) for r in results))
        results = self.race([lambda: self.save([self.cell('101', '2', 1), self.cell('103')]),
                             lambda: self.save([self.cell('101', '3', 1), self.cell('104')])])
        self.assertEqual(sum(isinstance(r, dict) for r in results), 1)
        data = review.read_values(self.context, '17', {'issueIds': ['101', '102', '103', '104'], 'rowKind': 'story'}, self.url, self.search)
        self.assertEqual(len(data['cells']), 3)
        self.assertEqual(next(c['revision'] for c in data['cells'] if c['issueId'] == '101'), 2)

    def test_rename_archive_reorder_races_have_one_winner(self):
        self.save(schemas=[{'action': 'add', 'column': self.column}], base=0)
        results = self.race([
            lambda: self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Renamed'}]),
            lambda: self.save(schemas=[{'action': 'archive', 'columnId': self.column['id'], 'archived': True}]),
            lambda: self.save(schemas=[{'action': 'reorder', 'rowKind': 'story', 'columnIds': [self.column['id']]}]),
        ])
        self.assertEqual(sum(isinstance(r, dict) for r in results), 1)
        self.assertTrue(all(r.details['schemaConflict'] for r in results if isinstance(r, review.ReviewError)))
        self.assertEqual(review.load_review(self.context, '17', self.url)['schemaRevision'], 2)

    def test_migration_model_parity_and_downgrade_preserves_previous_tables(self):
        engine = db_engine.get_engine(self.url)
        for name in ('workspace_sprint_reviews', 'sprint_review_cells'):
            self.assertEqual(set(c['name'] for c in inspect(engine).get_columns(name)), set(models.Base.metadata.tables[name].columns.keys()))
            self.assertEqual({tuple(c['column_names']) for c in inspect(engine).get_unique_constraints(name)},
                             {tuple(c.columns.keys()) for c in models.Base.metadata.tables[name].constraints if c.__class__.__name__ == 'UniqueConstraint'})
        command.downgrade(self.config, '20260913_0016')
        self.assertNotIn('workspace_sprint_reviews', inspect(engine).get_table_names())
        self.assertIn('workspace_sprint_catalogs', inspect(engine).get_table_names())
