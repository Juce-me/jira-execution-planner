"""Automatic adoption of legacy review data by the 20261023_0020 revision (#299 follow-up plan).

Legacy fixtures are built through the retained legacy models. All data is synthetic; labels and values
that must never be logged are planted on purpose.
"""
import ast
import contextlib
import importlib.util
import io
import json
import logging
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine, models
from backend.services import sprint_review as review
from scripts import adopt_legacy_sprint_reviews as adopt

ROOT = Path(__file__).resolve().parents[1]
REVISION_FILE = ROOT / 'backend' / 'db' / 'migrations' / 'versions' / '20261023_0020_adopt_legacy_sprint_reviews.py'
PARENT, HEAD = '20261020_0019', '20261023_0020'
GROUPS = [{'id': 'group-x', 'name': 'Platform'}, {'id': 'group-y', 'name': 'Payments'}]
SECRET_LABEL, SECRET_VALUE = 'Secret-Label-Zq', 'Secret-Value-4711'
LOGGER = 'alembic.review_adoption'


def uid(number):
    return f'00000000-0000-4000-8000-{number:012d}'


def col(label='Estimate', kind='story', type_='number', archived=False, identity=None):
    return {'id': identity or str(uuid.uuid4()), 'rowKind': kind, 'label': label, 'type': type_,
            'aggregation': 'sum' if type_ == 'number' else 'none', 'archived': archived, 'order': 0}


def group_col(number, label, archived=False, order=0, kind='story', type_='number'):
    return {'id': uid(number), 'rowKind': kind, 'label': label, 'type': type_,
            'aggregation': 'sum' if type_ == 'number' else 'none', 'archived': archived, 'order': order, 'after': None}


def load_revision():
    spec = importlib.util.spec_from_file_location('adopt_revision_0020', REVISION_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RevisionCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='tests')
        self.url = 'sqlite+pysqlite:///' + str(Path(self.temp.name).resolve() / 'adopt.db')
        self.env = patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.url,
                                           'DATABASE_CONNECTION_MODE': 'url'})
        self.env.start()
        os.environ.pop('REVIEW_ADOPTION_ON_UPGRADE', None)
        self.config = Config(str(ROOT / 'backend' / 'db' / 'alembic.ini'))
        self.config.set_main_option('sqlalchemy.url', self.url)
        self.config.set_main_option('script_location', str(ROOT / 'backend' / 'db' / 'migrations'))
        command.upgrade(self.config, PARENT)
        self.workspace = self.make_workspace('main', GROUPS)

    def tearDown(self):
        self.env.stop()
        db_engine.dispose_engines()
        self.temp.cleanup()

    def make_workspace(self, name, groups=None, payload=None, identity=None):
        with db_engine.session_scope(self.url) as session:
            workspace = models.Workspace(id=identity, environment_key='synthetic-' + name, name=name) if identity else \
                models.Workspace(environment_key='synthetic-' + name, name=name)
            session.add(workspace)
            session.flush()
            if payload is not None or groups is not None:
                session.add(models.WorkspaceGroupConfig(workspace_id=workspace.id, payload=payload if payload is not None else {
                    'version': 1, 'groups': [dict(g) for g in groups], 'defaultGroupId': ''}))
            return workspace.id

    def legacy(self, sprint, columns=(), layouts=None, cells=(), workspace=None):
        with db_engine.session_scope(self.url) as session:
            row = models.WorkspaceSprintReview(id=str(uuid.uuid4()), workspace_id=workspace or self.workspace,
                                               sprint_id=sprint, schema_revision=1, columns=list(columns), layouts=layouts or {})
            session.add(row)
            session.flush()
            for issue, kind, column_id, value in cells:
                session.add(models.SprintReviewCell(review_id=row.id, issue_id=issue, row_kind=kind, column_id=column_id,
                                                    value=value, revision=1))

    def simple(self, workspace=None, label='Estimate', value='1.000'):
        column = col(label, identity=uid(1))
        self.legacy('17', [column], {'story': {'order': ['status', column['id']], 'hidden': []}},
                    [('101', 'story', column['id'], value)], workspace=workspace)
        return column

    def live_group(self, group, columns, revision=2, workspace=None, cells=()):
        with db_engine.session_scope(self.url) as session:
            row = models.WorkspaceGroupReviewSchema(id=str(uuid.uuid4()), workspace_id=workspace or self.workspace,
                                                    group_id=group, schema_revision=revision, columns=columns)
            session.add(row)
            session.flush()
            for issue, kind, column_id, value in cells:
                session.add(models.GroupReviewCell(schema_id=row.id, issue_id=issue, row_kind=kind, column_id=column_id,
                                                   value=value, revision=1))

    def group_state(self, strip_ids=True):
        with db_engine.session_scope(self.url) as session:
            schemas = {s.id: s for s in session.query(models.WorkspaceGroupReviewSchema).all()}
            return (sorted((s.workspace_id, s.group_id, s.schema_revision, repr(s.columns)) for s in schemas.values()),
                    sorted((schemas[c.schema_id].workspace_id, schemas[c.schema_id].group_id, c.issue_id, c.row_kind,
                            c.column_id, repr(c.value), c.revision) for c in session.query(models.GroupReviewCell).all()),
                    sorted((v.workspace_id, v.group_id, v.sprint_id, v.sprint_order, v.view_revision, repr(v.layouts))
                           for v in session.query(models.GroupSprintReviewView).all()))

    def legacy_state(self):
        with db_engine.session_scope(self.url) as session:
            return (sorted((r.id, r.workspace_id, r.sprint_id, r.schema_revision, repr(r.columns), repr(r.layouts))
                           for r in session.query(models.WorkspaceSprintReview).all()),
                    sorted((c.id, c.review_id, c.issue_id, c.row_kind, c.column_id, repr(c.value), c.revision)
                           for c in session.query(models.SprintReviewCell).all()))

    def version(self):
        with db_engine.session_scope(self.url) as session:
            return session.execute(text('SELECT version_num FROM alembic_version')).scalar()

    def upgrade(self):
        with self.assertLogs(LOGGER, 'WARNING') as logs:
            command.upgrade(self.config, 'head')
        return '\n'.join(logs.output)

    def context(self, workspace=None):
        return RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
            atlassian_account_id='synthetic-account', workspace_id=workspace or self.workspace,
            auth_connection_id='synthetic-connection', cloud_id='synthetic-cloud',
            site_url='https://synthetic.example.test', token_version='1', account_status='active', is_admin=False)

    @staticmethod
    def search(payload, **kwargs):
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')
        return Mock(status_code=200, json=lambda: {'issues': [
            {'id': i, 'fields': {'issuetype': {'name': 'Story', 'subtask': False}}} for i in ids], 'isLast': True})


class UpgradeBehaviorTests(RevisionCase):
    def test_upgrade_adopts_every_fresh_group_and_the_app_reads_it_back(self):
        column = self.simple()
        before = self.legacy_state()
        self.upgrade()
        self.assertEqual(self.version(), HEAD)
        self.assertEqual(self.legacy_state(), before)
        for group in ('group-x', 'group-y'):
            loaded = review.load_review(self.context(), '17', group, self.url)
            self.assertEqual([c['id'] for c in loaded['columns']], [column['id']])
            self.assertEqual((loaded['schemaRevision'], loaded['viewRevision']), (1, 1))
            self.assertEqual(loaded['layouts'], {'story': {'order': ['status', column['id']], 'hidden': []}})
            values = review.read_values(self.context(), '17', {'groupId': group, 'issueIds': ['101'], 'rowKind': 'story'},
                                        self.url, self.search)
            self.assertEqual([(c['issueId'], c['value'], c['revision']) for c in values['cells']], [('101', '1.000', 1)])

    def test_stored_forms_are_what_the_orm_writes(self):
        self.simple()
        self.upgrade()
        with db_engine.session_scope(self.url) as session:
            ids = [row[0] for row in session.execute(text('SELECT id FROM workspace_group_review_schemas'))]
            self.assertEqual(len(ids), 2)
            self.assertTrue(all(len(i) == 32 and i == i.lower() and '-' not in i for i in ids))
            self.assertIsInstance(session.execute(text('SELECT columns FROM workspace_group_review_schemas')).scalar(), str)
            self.assertEqual(session.execute(text('SELECT count(*) FROM group_review_cells')).scalar(), 2)

    def test_group_that_holds_rows_is_untouched_and_logged(self):
        self.simple()
        live = [group_col(10, 'Live')]
        self.live_group('group-x', live, revision=2, cells=[('900', 'story', uid(10), '5.000')])
        before_live = [row for row in self.group_state()[0] if row[1] == 'group-x']
        cells_live = [row for row in self.group_state()[1] if row[1] == 'group-x']
        log = self.upgrade()
        state = self.group_state()
        self.assertEqual([row for row in state[0] if row[1] == 'group-x'], before_live)
        self.assertEqual([row for row in state[1] if row[1] == 'group-x'], cells_live)
        self.assertFalse([row for row in state[2] if row[1] == 'group-x'])
        self.assertEqual([row[2] for row in state[0] if row[1] == 'group-y'], [1])
        self.assertIn('group-x', log)
        self.assertIn('holds review rows', log)

    def test_no_legacy_content_stamps_and_writes_nothing(self):
        self.legacy('17')  # an empty legacy row has no content
        command.upgrade(self.config, 'head')
        self.assertEqual(self.version(), HEAD)
        self.assertEqual(self.group_state(), ([], [], []))

    def test_replay_after_a_downgrade_to_the_parent_adopts_nothing_new(self):
        self.simple()
        self.upgrade()
        first = self.group_state()
        command.downgrade(self.config, PARENT)
        self.assertEqual(self.group_state(), first)
        self.upgrade()
        self.assertEqual(self.group_state(), first)

    def test_downgrade_below_the_group_tables_then_upgrade_adopts_again(self):
        self.simple()
        self.upgrade()
        first = self.group_state()
        command.downgrade(self.config, '20261001_0018')
        self.assertNotIn('workspace_group_review_schemas', inspect(db_engine.get_engine(self.url)).get_table_names())
        self.upgrade()
        self.assertEqual(self.group_state(), first)

    def test_downgrade_to_the_parent_is_a_no_op(self):
        self.simple()
        self.upgrade()
        first = self.group_state()
        command.downgrade(self.config, PARENT)
        self.assertEqual(self.version(), PARENT)
        self.assertEqual(self.group_state(), first)

    def test_skipped_workspaces_do_not_stop_the_others_and_leak_nothing(self):
        no_group = self.make_workspace('no-group')
        broken = self.make_workspace('broken', GROUPS)
        bad_catalog = self.make_workspace('bad-catalog', payload=[1])
        self.simple(label=SECRET_LABEL, value=SECRET_VALUE)
        self.simple(workspace=no_group, label=SECRET_LABEL, value=SECRET_VALUE)
        self.legacy('17', [{'id': 'not-a-uuid', 'label': SECRET_LABEL}], workspace=broken)
        self.simple(workspace=bad_catalog, label=SECRET_LABEL, value=SECRET_VALUE)
        log = self.upgrade()
        self.assertEqual(self.version(), HEAD)
        adopted = {row[0] for row in self.group_state()[0]}
        self.assertEqual(adopted, {self.workspace})
        for skipped in (no_group, broken, bad_catalog):
            self.assertIn(skipped, log)
        self.assertNotIn(SECRET_LABEL, log)
        self.assertNotIn(SECRET_VALUE, log)

    def test_kill_switch_off_stamps_logs_the_count_and_writes_nothing(self):
        self.simple()
        with patch.dict(os.environ, {'REVIEW_ADOPTION_ON_UPGRADE': 'false'}):
            log = self.upgrade()
        self.assertEqual(self.version(), HEAD)
        self.assertEqual(self.group_state(), ([], [], []))
        self.assertIn('disabled', log)
        self.assertIn('1 workspace', log)

    def test_kill_switch_accepts_true_and_rejects_any_other_value(self):
        self.simple()
        with patch.dict(os.environ, {'REVIEW_ADOPTION_ON_UPGRADE': 'flase'}):
            with self.assertRaisesRegex(ValueError, 'REVIEW_ADOPTION_ON_UPGRADE'):
                command.upgrade(self.config, 'head')
        self.assertEqual(self.version(), PARENT)
        self.assertEqual(self.group_state(), ([], [], []))
        with patch.dict(os.environ, {'REVIEW_ADOPTION_ON_UPGRADE': 'TRUE'}):
            self.upgrade()
        self.assertEqual(len(self.group_state()[0]), 2)

    def test_fresh_database_upgrades_to_head(self):
        with tempfile.TemporaryDirectory(dir='tests') as directory:
            url = 'sqlite+pysqlite:///' + str(Path(directory).resolve() / 'fresh.db')
            config = Config(str(ROOT / 'backend' / 'db' / 'alembic.ini'))
            config.set_main_option('sqlalchemy.url', url)
            config.set_main_option('script_location', str(ROOT / 'backend' / 'db' / 'migrations'))
            command.upgrade(config, 'head')
            with db_engine.session_scope(url) as session:
                self.assertEqual(session.execute(text('SELECT version_num FROM alembic_version')).scalar(), HEAD)

    def test_a_missing_required_table_fails_the_upgrade_before_any_write(self):
        self.simple()
        with db_engine.session_scope(self.url) as session:
            session.execute(text('DROP TABLE group_sprint_review_views'))
        with self.assertRaisesRegex(Exception, 'required tables missing'):
            command.upgrade(self.config, 'head')
        self.assertEqual(self.version(), PARENT)


class AdoptAllSeamTests(RevisionCase):
    def run_adopt(self, **kwargs):
        revision = load_revision()
        with db_engine.get_engine(self.url).begin() as connection:
            return revision.adopt_all(connection, **kwargs)

    def test_a_workspace_over_the_run_budget_is_skipped_whole(self):
        self.simple()
        summary = self.run_adopt(budget=3)
        self.assertEqual(self.group_state(), ([], [], []))
        self.assertIn('budget', summary['skipped'][self.workspace])

    def test_budget_covers_the_whole_run_not_each_workspace(self):
        second = self.make_workspace('second', GROUPS)
        self.simple()
        self.simple(workspace=second)
        # One workspace plans columns 2 + cells 2 + views 2 = 6 rows across its two groups; 8 fits one, not both.
        summary = self.run_adopt(budget=8)
        self.assertEqual(len(summary['adopted']), 1)
        self.assertEqual(len(summary['skipped']), 1)
        self.assertEqual(summary['rows'], 6)

    def test_a_workspace_with_more_legacy_cells_than_the_budget_is_skipped_before_it_is_read(self):
        column = col(identity=uid(1))
        self.legacy('17', [column], {}, [(str(100 + n), 'story', column['id'], '1') for n in range(6)])
        revision = load_revision()
        with patch.object(revision, 'canonical_legacy', side_effect=AssertionError('read before the pre-count')):
            with db_engine.get_engine(self.url).begin() as connection:
                summary = revision.adopt_all(connection, budget=5)
        self.assertIn('budget', summary['skipped'][self.workspace])

    def test_a_database_error_is_reraised_without_driver_text(self):
        self.simple(label=SECRET_LABEL, value=SECRET_VALUE)
        with db_engine.get_engine(self.url).begin() as connection:
            connection.execute(text("CREATE TRIGGER boom BEFORE INSERT ON group_review_cells BEGIN "
                                    "SELECT RAISE(ABORT, 'boom'); END"))
        revision = load_revision()
        with self.assertRaises(revision.ReviewAdoptionError) as caught:
            with db_engine.get_engine(self.url).begin() as connection:
                revision.adopt_all(connection)
        message = str(caught.exception) + repr(caught.exception.__cause__) + repr(caught.exception.__context__)
        for planted in (SECRET_LABEL, SECRET_VALUE, 'INSERT', 'parameters'):
            self.assertNotIn(planted, message)
        self.assertEqual(self.group_state()[1], [])

    def test_summary_names_adopted_groups_and_groups_that_hold_rows(self):
        self.simple()
        self.live_group('group-y', [group_col(10, 'Live')])
        summary = self.run_adopt()
        self.assertEqual(summary['adopted'], {self.workspace: ['group-x']})
        self.assertEqual(summary['groups_with_rows'], {self.workspace: ['group-y']})


class ReleasePathTests(RevisionCase):
    def test_logs_reach_stderr_under_the_repository_logging_config(self):
        self.simple(label=SECRET_LABEL, value=SECRET_VALUE)
        env = {**os.environ, 'PYTHONPATH': str(ROOT)}
        result = subprocess.run([sys.executable, '-m', 'alembic', '-c', 'backend/db/alembic.ini', 'upgrade', 'head'],
                                cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('review adoption', result.stderr)
        self.assertNotIn(SECRET_LABEL, result.stderr + result.stdout)
        self.assertNotIn(SECRET_VALUE, result.stderr + result.stdout)

    def test_offline_sql_renders_no_data_statements_and_carries_the_note(self):
        config = Config(str(ROOT / 'backend' / 'db' / 'alembic.ini'))
        config.set_main_option('sqlalchemy.url', 'postgresql+psycopg://user@db.example:5432/planner?sslmode=require')
        output = io.StringIO()
        config.output_buffer = output
        with patch.dict(os.environ, {'DATABASE_CONNECTION_MODE': 'url'}, clear=False):
            command.upgrade(config, f'{PARENT}:{HEAD}', sql=True)
        sql = output.getvalue()
        self.assertIn('adopt', sql.lower())
        self.assertNotIn('INSERT INTO group_review_cells', sql)
        self.assertNotIn('INSERT INTO workspace_group_review_schemas', sql)
        self.assertNotIn('LOCK TABLE', sql)


class RevisionIsolationTests(unittest.TestCase):
    def test_the_revision_imports_only_the_shared_planner_from_the_repository(self):
        tree = ast.parse(REVISION_FILE.read_text(encoding='utf-8'))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {alias.name for alias in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported |= {node.module + '.' + alias.name for alias in node.names} | {node.module}
        repository = {name for name in imported if name.split('.')[0] in ('backend', 'scripts')}
        allowed = {name for name in repository if name in ('backend', 'backend.services')
                   or name.startswith('backend.services.review_adoption')}
        self.assertEqual(repository, allowed)
        self.assertIn('backend.services.review_adoption', repository)

    def test_the_shared_planner_imports_nothing_from_the_repository(self):
        path = ROOT / 'backend' / 'services' / 'review_adoption.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            names = [alias.name for alias in node.names] if isinstance(node, ast.Import) else \
                [node.module or ''] if isinstance(node, ast.ImportFrom) else []
            for name in names:
                self.assertNotIn(name.split('.')[0], ('backend', 'scripts', 'flask', 'requests'), name)


class FrozenRulesTests(unittest.TestCase):
    """The revision carries a snapshot of the review rules; it must match the live rules until someone decides otherwise."""

    UPDATE = 'backend/db/migrations/versions/20261023_0020_adopt_legacy_sprint_reviews.py'

    def setUp(self):
        self.rules = load_revision().RULES

    def test_constants_and_builtins_match_the_live_rules(self):
        message = f'the live review rules changed; update the frozen snapshot in {self.UPDATE} on purpose'
        self.assertEqual(self.rules.MAX_ACTIVE_COLUMNS, review.MAX_ACTIVE_COLUMNS, message)
        self.assertEqual(self.rules.MAX_GROUP_VIEWS, review.MAX_GROUP_VIEWS, message)
        self.assertEqual(self.rules.REVIEW_LAYOUT_BUILTINS, review.REVIEW_LAYOUT_BUILTINS, message)
        for sprint in ('1', '17', '9' * 128):
            self.assertEqual(self.rules.sprint_order(sprint), review.sprint_order(sprint), message)

    def test_identity_helpers_agree_on_valid_and_invalid_input(self):
        samples = ['1', '17', '0', '01', '', ' x', 'x ', 'a' * 129, '9' * 129, 'g\x00', 'group', None, 7]
        for sample in samples:
            for name in ('sprint_identity', 'group_identity'):
                self.assertEqual(self.outcome(getattr(self.rules, name), sample), self.outcome(getattr(review, name), sample),
                                 (name, sample))

    @staticmethod
    def outcome(call, *args):
        try:
            return ('ok', json.dumps(call(*args), sort_keys=True, default=str))
        except ValueError as error:
            return ('error', type(error).__name__, getattr(error, 'code', None))

    def random_add(self, rng):
        identity = rng.choice([str(uuid.UUID(int=rng.getrandbits(128), version=4)), 'bad-id', None, 7])
        return {'action': 'add', 'column': {
            'id': identity, 'rowKind': rng.choice(['epic', 'story', 'sub']),
            'label': rng.choice(['Alpha', ' Beta ', '', 'x' * 81, None]),
            'type': rng.choice(['number', 'text', 'date']), 'aggregation': rng.choice(['sum', 'none', 'avg']),
            **({'after': rng.choice(['summary', 'status', 'nope'])} if rng.random() < 0.3 else {})}}

    def test_validation_schema_and_layout_rules_agree_on_randomized_input(self):
        rng = random.Random(299)
        for _ in range(400):
            adds = [self.random_add(rng) for _ in range(rng.randint(0, 4))]
            existing = []
            valid = self.outcome(review.validate_schema_changes, adds)
            self.assertEqual(self.outcome(self.rules.validate_schema_changes, adds), valid)
            if valid[0] == 'ok':
                live = self.outcome(review.apply_schema, existing, adds)
                self.assertEqual(self.outcome(self.rules.apply_schema, existing, adds), live)
                if live[0] == 'ok':
                    columns = json.loads(live[1])
                    ids = [c['id'] for c in columns] + ['status', 'summary', 'key', 'bogus']
                    kind = rng.choice(['epic', 'story'])
                    layout = [{'action': 'layout', 'rowKind': kind,
                               'order': rng.sample(ids, rng.randint(0, len(ids))),
                               'hidden': rng.sample(ids, rng.randint(0, len(ids)))}]
                    self.assertEqual(self.outcome(self.rules.validate_schema_changes, layout),
                                     self.outcome(review.validate_schema_changes, layout))
                    self.assertEqual(self.outcome(self.rules.apply_layouts, {}, columns, layout),
                                     self.outcome(review.apply_layouts, {}, columns, layout))

    def test_the_active_column_cap_agrees(self):
        adds = [{'action': 'add', 'column': {'id': uid(n), 'rowKind': 'story', 'label': f'C{n}', 'type': 'number',
                                              'aggregation': 'sum'}} for n in range(review.MAX_ACTIVE_COLUMNS + 1)]
        self.assertEqual(self.outcome(self.rules.apply_schema, [], adds), self.outcome(review.apply_schema, [], adds))


class DifferentialTests(RevisionCase):
    """The revision's adapter and the operator script's adapter write the same thing on the same legacy data."""

    def seed(self, rng, workspace, number):
        labels = ['Alpha', 'beta ', 'Gamma', 'Delta', 'Epsilon']
        ids = {}
        for sprint in sorted(rng.sample(range(10, 40), rng.randint(1, 4))):
            columns, cells, order = [], [], ['status']
            for _ in range(rng.randint(0, 4)):
                label, kind, type_ = rng.choice(labels), rng.choice(['epic', 'story']), rng.choice(['number', 'text'])
                identity = ids.setdefault((label.strip().casefold(), kind, type_), uid(number * 100 + len(ids) + 1))
                if any(c['id'] == identity for c in columns):
                    continue
                columns.append(col(label, kind, type_, archived=rng.random() < 0.15, identity=identity))
                order.append(identity)
                for issue in rng.sample(range(100, 110), rng.randint(0, 3)):
                    cells.append((str(issue), kind, identity, '1.5' if type_ == 'number' else 'note'))
            layouts = {'story': {'order': [o for o in order if o == 'status' or any(
                c['id'] == o and c['rowKind'] == 'story' for c in columns)], 'hidden': []}} if rng.random() < 0.7 else {}
            self.legacy(str(sprint), columns, layouts, cells, workspace=workspace)

    def run_case(self, seed):
        rng = random.Random(seed)
        script_url = 'sqlite+pysqlite:///' + str(Path(self.temp.name).resolve() / f'script{seed}.db')
        models.Base.metadata.create_all(db_engine.get_engine(script_url))
        workspaces = [uid(9000 + n) for n in range(rng.randint(1, 3))]
        group_sets = [[{'id': f'g{n}-{k}', 'name': 'G'} for k in range(rng.randint(1, 3))] for n in range(len(workspaces))]
        for url in (script_url, self.url):
            with db_engine.session_scope(url) as session:
                for identity, groups in zip(workspaces, group_sets):
                    if session.get(models.Workspace, identity) is None:
                        session.add(models.Workspace(id=identity, environment_key='diff-' + identity, name='W'))
                        session.flush()
                        session.add(models.WorkspaceGroupConfig(workspace_id=identity, payload={
                            'version': 1, 'groups': groups, 'defaultGroupId': ''}))
        for index, identity in enumerate(workspaces):
            self.seed(random.Random(seed * 10 + index), identity, index + 1)
        # Script side: copy the legacy rows, then run the reviewed fresh adoption per workspace.
        with db_engine.session_scope(self.url) as source, db_engine.session_scope(script_url) as target:
            for row in source.query(models.WorkspaceSprintReview).filter(models.WorkspaceSprintReview.workspace_id.in_(workspaces)).all():
                target.add(models.WorkspaceSprintReview(id=row.id, workspace_id=row.workspace_id, sprint_id=row.sprint_id,
                                                        schema_revision=row.schema_revision, columns=row.columns, layouts=row.layouts))
            target.flush()
            for cell in source.query(models.SprintReviewCell).all():
                target.add(models.SprintReviewCell(id=cell.id, review_id=cell.review_id, issue_id=cell.issue_id, row_kind=cell.row_kind,
                                                   column_id=cell.column_id, value=cell.value, revision=cell.revision))
        expected = self.script_state(script_url, workspaces)
        command.upgrade(self.config, 'head')
        return expected, self.group_state(), workspaces

    def script_state(self, script_url, workspaces):
        with patch.dict(os.environ, {'DATABASE_URL': script_url}):
            for identity in workspaces:
                out = io.StringIO()
                try:
                    with contextlib.redirect_stdout(out):
                        adopt.main(['--workspace-id', identity])
                    digest = next((t for t in out.getvalue().split() if t.startswith('sha256:')), None)
                    if digest:
                        with contextlib.redirect_stdout(io.StringIO()):
                            adopt.main(['--workspace-id', identity, '--apply', '--expected-sha256', digest])
                except ValueError:
                    pass  # the script refuses the workspace; the revision must skip it too
        with db_engine.session_scope(script_url) as session:
            schemas = {s.id: s for s in session.query(models.WorkspaceGroupReviewSchema).all()}
            state = (sorted((s.workspace_id, s.group_id, s.schema_revision, repr(s.columns)) for s in schemas.values()),
                     sorted((schemas[c.schema_id].workspace_id, schemas[c.schema_id].group_id, c.issue_id, c.row_kind,
                             c.column_id, repr(c.value), c.revision) for c in session.query(models.GroupReviewCell).all()),
                     sorted((v.workspace_id, v.group_id, v.sprint_id, v.sprint_order, v.view_revision, repr(v.layouts))
                            for v in session.query(models.GroupSprintReviewView).all()))
        db_engine.dispose_engines()
        return state

    def test_randomized_seeds_write_what_the_script_writes(self):
        compared = 0
        for seed in range(1, 13):
            with self.subTest(seed=seed):
                self.tearDown()
                self.setUp()
                expected, actual, _workspaces = self.run_case(seed)
                self.assertEqual(actual, expected)
                compared += bool(expected[0])
        self.assertGreater(compared, 3)  # the seeds must exercise real adoptions, not only empty ones


if __name__ == '__main__':
    unittest.main()
