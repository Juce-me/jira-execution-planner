import os
import sqlite3
import tempfile
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from sqlalchemy.engine import make_url

from backend.auth.context import RequestAuthContext
from backend.config.db_repository import DbConfigRepository
from backend.config.view_validation import FORBIDDEN_VIEW_PAYLOAD_KEYS, ViewPayloadValidationError
from backend.db import engine as db_engine
from backend.db import models
from backend.services.user_view_config import (
    UserViewConfigConflict,
    UserViewConfigStorageError,
    create_user_view,
    mutate_user_view,
    save_user_epm_config,
    save_imported_user_view,
)
from backend.services import user_view_config


def epm_payload(label):
    return {
        'version': 2,
        'labelPrefix': 'portfolio_project_*',
        'scope': {'rootGoalKey': 'ROOT-A', 'subGoalKeys': ['GOAL-B']},
        'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
        'projects': {
            label: {'id': label, 'name': label.title(), 'label': f'portfolio_project_{label}'},
        },
    }


class UserViewConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'views.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.other_workspace_id, self.user_id, self.other_user_id = self._seed()
        self.context = self._context(self.workspace_id, self.user_id)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed(self):
        with self.factory() as session:
            workspaces = [
                models.Workspace(environment_key='local', name='One', jira_site_url='https://one.invalid', jira_cloud_id='c1', created_by='test'),
                models.Workspace(environment_key='local', name='Two', jira_site_url='https://two.invalid', jira_cloud_id='c2', created_by='test'),
            ]
            users = [
                models.User(external_provider='atlassian', external_subject='u1', account_type='user', status='active', created_by='test'),
                models.User(external_provider='atlassian', external_subject='u2', account_type='user', status='active', created_by='test'),
            ]
            session.add_all(workspaces + users)
            session.commit()
            return workspaces[0].id, workspaces[1].id, users[0].id, users[1].id

    def _context(self, workspace_id, user_id):
        return RequestAuthContext(
            auth_mode='atlassian_oauth', user_id=user_id, stable_subject=user_id,
            atlassian_account_id=user_id, workspace_id=workspace_id,
            auth_connection_id=f'connection-{user_id}', cloud_id=workspace_id,
            site_url='https://example.invalid', token_version='1', account_status='active', is_admin=False,
        )

    def _race(self, left, right):
        gate = threading.Barrier(2)
        def run(operation):
            gate.wait()
            return operation()
        with ThreadPoolExecutor(max_workers=2) as executor:
            return [future.result() for future in (executor.submit(run, left), executor.submit(run, right))]

    def _default(self, context=None):
        context = context or self.context
        with self.factory() as session:
            return session.execute(select(models.ViewConfig).where(
                models.ViewConfig.workspace_id == context.workspace_id,
                models.ViewConfig.owner_user_id == context.user_id,
                models.ViewConfig.is_default.is_(True),
                models.ViewConfig.archived_at.is_(None),
            )).scalars().one()

    def _versions(self, view_id):
        with self.factory() as session:
            return session.execute(select(models.ViewConfigVersion).where(
                models.ViewConfigVersion.view_config_id == view_id,
            ).order_by(models.ViewConfigVersion.version_number)).scalars().all()

    def _assert_complete_epm(self, payload):
        epm = payload.get('epm') if isinstance(payload, dict) else None
        settings_keys = set(epm_payload('example'))
        if not isinstance(epm, dict) or not settings_keys.intersection(epm):
            return
        self.assertTrue(settings_keys.issubset(epm))
        self.assertEqual(len(epm['projects']), 1)

    def test_two_existing_default_saves_are_complete_last_write_wins(self):
        created = create_user_view(
            self.context, name='Default', view_type='mixed',
            payload={'filters': {'keep': True}, 'epm': {'tab': 'active'}},
            is_default=True, database_url=self.database_url,
        )
        results = self._race(
            lambda: save_user_epm_config(self.context, epm_payload('alpha'), database_url=self.database_url),
            lambda: save_user_epm_config(self.context, epm_payload('beta'), database_url=self.database_url),
        )

        view = self._default()
        self.assertEqual(view.payload['filters'], {'keep': True})
        self.assertEqual(view.payload['epm']['tab'], 'active')
        self.assertEqual(set(view.payload['epm']['projects']), {next(iter(view.payload['epm']['projects']))})
        self.assertIn(next(iter(view.payload['epm']['projects'])), {'alpha', 'beta'})
        self.assertEqual([item.version_number for item in self._versions(view.id)], [1, 2, 3])
        self.assertEqual([item.change_note for item in self._versions(view.id)][1:], [
            'user EPM update', 'user EPM update',
        ])
        self.assertEqual(sorted(result.version_number for result in results), [2, 3])
        self.assertTrue(all(result.effective_epm_changed for result in results))
        self.assertEqual(created.version_number, 1)

    def test_two_first_saves_create_one_default_with_monotonic_versions(self):
        results = self._race(
            lambda: save_user_epm_config(self.context, epm_payload('alpha'), database_url=self.database_url),
            lambda: save_user_epm_config(self.context, epm_payload('beta'), database_url=self.database_url),
        )
        view = self._default()
        self.assertEqual([version.version_number for version in self._versions(view.id)], [1, 2])
        self.assertEqual(sorted(result.version_number for result in results), [1, 2])

    def test_stale_whole_view_replacement_cannot_overwrite_epm_save(self):
        created = create_user_view(
            self.context, name='Default', view_type='mixed',
            payload={'filters': {'keep': True}, 'epm': {**epm_payload('old'), 'tab': 'active'}},
            is_default=True, database_url=self.database_url,
        )
        save_user_epm_config(self.context, epm_payload('new'), database_url=self.database_url)
        with self.assertRaises(UserViewConfigConflict) as raised:
            mutate_user_view(
                self.context, created.view_config_id, payload={'filters': {'keep': False}},
                base_version=created.version_number, database_url=self.database_url,
            )
        self.assertEqual(raised.exception.current.version_number, 2)
        self.assertIn('new', self._default().payload['epm']['projects'])

    def test_first_save_serializes_with_default_create_and_switch(self):
        non_default = create_user_view(
            self.context, name='Candidate', view_type='eng', payload={'eng': {'mode': 'planning'}},
            is_default=False, database_url=self.database_url,
        )
        create_results = self._race(
            lambda: save_user_epm_config(self.context, epm_payload('first'), database_url=self.database_url),
            lambda: create_user_view(
                self.context, name='Posted default', view_type='eng', payload={'filters': {'posted': True}},
                is_default=True, database_url=self.database_url,
            ),
        )
        with self.factory() as session:
            active = session.execute(select(models.ViewConfig).where(
                models.ViewConfig.workspace_id == self.context.workspace_id,
                models.ViewConfig.owner_user_id == self.context.user_id,
                models.ViewConfig.archived_at.is_(None),
            )).scalars().all()
        self.assertEqual(sum(bool(view.is_default) for view in active), 1)
        for view in active:
            self._assert_complete_epm(view.payload)
            numbers = [version.version_number for version in self._versions(view.id)]
            self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
        posted = next(view for view in active if view.name == 'Posted default')
        self.assertEqual(posted.payload['filters'], {'posted': True})

        switch_results = self._race(
            lambda: save_user_epm_config(self.context, epm_payload('second'), database_url=self.database_url),
            lambda: mutate_user_view(
                self.context, non_default.view_config_id, is_default=True, database_url=self.database_url,
            ),
        )
        default = self._default()
        self.assertEqual(default.id, non_default.view_config_id)
        self.assertEqual(default.payload['eng'], {'mode': 'planning'})
        with self.factory() as session:
            active = session.execute(select(models.ViewConfig).where(
                models.ViewConfig.workspace_id == self.context.workspace_id,
                models.ViewConfig.owner_user_id == self.context.user_id,
                models.ViewConfig.archived_at.is_(None),
            )).scalars().all()
        self.assertEqual(sum(bool(view.is_default) for view in active), 1)
        for view in active:
            self._assert_complete_epm(view.payload)
            numbers = [version.version_number for version in self._versions(view.id)]
            self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
        self.assertEqual(len(create_results), 2)
        self.assertEqual(len(switch_results), 2)

    def test_scope_isolation_and_post_commit_callback_contract(self):
        callbacks = []
        contexts = [
            self.context,
            self._context(self.workspace_id, self.other_user_id),
            self._context(self.other_workspace_id, self.user_id),
        ]
        first_pair = self._race(
            lambda: save_user_epm_config(
                contexts[0], epm_payload('p0'), database_url=self.database_url,
                post_commit=lambda committed: callbacks.append((0, committed.after_effective_epm)),
            ),
            lambda: save_user_epm_config(
                contexts[1], epm_payload('p1'), database_url=self.database_url,
                post_commit=lambda committed: callbacks.append((1, committed.after_effective_epm)),
            ),
        )
        second_pair = self._race(
            lambda: save_user_epm_config(
                contexts[0], epm_payload('p0-next'), database_url=self.database_url,
            ),
            lambda: save_user_epm_config(
                contexts[2], epm_payload('p2'), database_url=self.database_url,
                post_commit=lambda committed: callbacks.append((2, committed.after_effective_epm)),
            ),
        )
        self.assertTrue(all(result.effective_epm_changed for result in first_pair + second_pair))
        result = save_user_epm_config(self.context, epm_payload('p0'), database_url=self.database_url)
        self.assertEqual(len(callbacks), 3)
        with self.assertRaises(FrozenInstanceError):
            result.effective_epm_changed = False
        for index, context in enumerate(contexts):
            loaded = DbConfigRepository(database_url=self.database_url).load_user_epm_config(context)
            self.assertIn(f'p{index}', loaded['projects'])

        same = save_user_epm_config(
            self.context, epm_payload('p0'), database_url=self.database_url,
            post_commit=lambda committed: callbacks.append(('same', committed.after_effective_epm)),
        )
        self.assertFalse(same.effective_epm_changed)
        self.assertEqual(len(callbacks), 3)

        with self.assertRaises(ViewPayloadValidationError):
            save_user_epm_config(
                self.context, {**epm_payload('bad'), 'projects': {'bad': {
                    'id': 'bad', 'name': 'Bad', 'label': 'bad', 'homeProjectId': '',
                }}}, database_url=self.database_url,
                post_commit=lambda committed: callbacks.append(('validation', committed.after_effective_epm)),
            )
        self.assertEqual(len(callbacks), 3)

        class PostgresUniqueViolation(Exception):
            def __init__(self, constraint_name):
                super().__init__(constraint_name)
                self.diag = SimpleNamespace(constraint_name=constraint_name)

        retryable_errors = (
            IntegrityError('insert', {}, sqlite3.IntegrityError(
                'UNIQUE constraint failed: view_configs.workspace_id, view_configs.owner_user_id'
            )),
            IntegrityError('insert', {}, sqlite3.IntegrityError(
                'UNIQUE constraint failed: view_config_versions.view_config_id, view_config_versions.version_number'
            )),
            IntegrityError('insert', {}, PostgresUniqueViolation('uq_view_configs_active_default')),
            IntegrityError('insert', {}, PostgresUniqueViolation('uq_view_config_versions_number')),
        )
        for integrity_error in retryable_errors:
            with self.subTest(error=str(integrity_error.orig)):
                with patch.object(user_view_config, '_run_mutation_once', side_effect=integrity_error):
                    with self.assertRaises(UserViewConfigStorageError):
                        save_user_epm_config(
                            self.context, epm_payload('retry'), database_url=self.database_url,
                            post_commit=lambda committed: callbacks.append(('retry', committed.after_effective_epm)),
                        )
                    self.assertEqual(user_view_config._run_mutation_once.call_count, 3)
        self.assertEqual(len(callbacks), 3)

        with self.assertRaises(UserViewConfigConflict):
            mutate_user_view(
                self.context, same.view_config_id, payload={'eng': {}}, base_version=0,
                database_url=self.database_url,
                post_commit=lambda committed: callbacks.append(('conflict', committed.after_effective_epm)),
            )
        self.assertEqual(len(callbacks), 3)

    def test_nonretryable_storage_failures_translate_once_and_suppress_callback(self):
        callbacks = []
        failures = (
            IntegrityError('insert', {}, sqlite3.IntegrityError('FOREIGN KEY constraint failed')),
            OperationalError('select', {}, sqlite3.OperationalError('disk I/O error')),
            DBAPIError('select', {}, sqlite3.DatabaseError('database error')),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), \
                 patch.object(user_view_config, '_run_mutation_once', side_effect=failure) as run_once:
                with self.assertRaises(UserViewConfigStorageError):
                    save_user_epm_config(
                        self.context,
                        epm_payload('failure'),
                        database_url=self.database_url,
                        post_commit=lambda committed: callbacks.append(committed),
                    )
                self.assertEqual(run_once.call_count, 1)
        self.assertEqual(callbacks, [])

    def test_success_callback_observes_committed_state_and_result_is_deeply_immutable(self):
        observed = []

        def after_commit(result):
            with self.factory() as session:
                row = session.get(models.ViewConfig, result.view_config_id)
                version_count = session.query(models.ViewConfigVersion).filter_by(
                    view_config_id=result.view_config_id,
                ).count()
                observed.append((row.payload, version_count))

        result = save_user_epm_config(
            self.context,
            epm_payload('committed'),
            database_url=self.database_url,
            post_commit=after_commit,
        )

        self.assertEqual(observed, [(
            {'epm': epm_payload('committed')},
            1,
        )])
        with self.assertRaises(TypeError):
            result.view['epm']['projects']['committed']['label'] = 'changed'
        with self.assertRaises(TypeError):
            result.view['epm']['issueTypes']['leaf'][0] = 'Other'

    def test_rename_nondefault_and_rollback_do_not_publish_effective_change(self):
        default = create_user_view(
            self.context, name='Default', view_type='epm', payload={'epm': epm_payload('default')},
            is_default=True, database_url=self.database_url,
        )
        self.assertTrue(default.effective_epm_changed)
        other = create_user_view(
            self.context, name='Other', view_type='epm', payload={'epm': epm_payload('other')},
            is_default=False, database_url=self.database_url,
        )
        self.assertFalse(other.effective_epm_changed)
        renamed = mutate_user_view(
            self.context, other.view_config_id, name='Renamed', database_url=self.database_url,
        )
        self.assertFalse(renamed.effective_epm_changed)
        identical = mutate_user_view(
            self.context, default.view_config_id, payload={'epm': epm_payload('default')},
            base_version=default.version_number, database_url=self.database_url,
        )
        self.assertFalse(identical.effective_epm_changed)
        replaced = mutate_user_view(
            self.context, default.view_config_id, payload={'epm': epm_payload('replacement')},
            base_version=identical.version_number, database_url=self.database_url,
        )
        self.assertTrue(replaced.effective_epm_changed)
        switched = mutate_user_view(
            self.context, other.view_config_id, is_default=True, database_url=self.database_url,
        )
        self.assertTrue(switched.effective_epm_changed)
        demoted = mutate_user_view(
            self.context, other.view_config_id, is_default=False, database_url=self.database_url,
        )
        self.assertTrue(demoted.effective_epm_changed)
        restored = mutate_user_view(
            self.context, default.view_config_id, is_default=True, database_url=self.database_url,
        )
        self.assertTrue(restored.effective_epm_changed)
        archived = mutate_user_view(
            self.context, default.view_config_id, archive=True, database_url=self.database_url,
        )
        self.assertTrue(archived.effective_epm_changed)
        callbacks = []
        with self.assertRaises(RuntimeError):
            create_user_view(
                self.context, name='Rollback', view_type='eng', payload={'eng': {}},
                is_default=True, database_url=self.database_url,
                post_commit=lambda result: callbacks.append(result),
                _before_commit=lambda: (_ for _ in ()).throw(RuntimeError('rollback')),
            )
        self.assertEqual(callbacks, [])

    def test_legacy_result_and_conflict_recursively_sanitize_without_rewriting_storage(self):
        forbidden_legacy = {key: f'legacy-{key}' for key in FORBIDDEN_VIEW_PAYLOAD_KEYS}
        legacy_payload = {
            'filters': {
                'keep': True,
                'workspaceId': 'legacy-workspace',
                'nested': {
                    **forbidden_legacy,
                    'userId': 'legacy-user',
                    'apiToken': 'legacy-api-token',
                    'access_token': 'legacy-access-token',
                    'safe': 'preserved',
                },
            },
            'epm': epm_payload('legacy'),
        }
        with self.factory() as session:
            view = models.ViewConfig(
                workspace_id=self.workspace_id,
                owner_user_id=self.user_id,
                name='Legacy',
                view_type='mixed',
                payload=legacy_payload,
                visibility='private',
                is_default=True,
            )
            session.add(view)
            session.flush()
            session.add(models.ViewConfigVersion(
                view_config_id=view.id,
                version_number=1,
                payload=legacy_payload,
                created_by=self.user_id,
                change_note='legacy seed',
            ))
            session.commit()
            view_id = view.id

        renamed = mutate_user_view(
            self.context, view_id, name='Renamed', database_url=self.database_url,
        )
        self.assertTrue(renamed.view['filters']['keep'])
        self.assertEqual(renamed.view['filters']['nested']['safe'], 'preserved')
        self.assertNotIn('workspaceId', renamed.view['filters'])
        self.assertNotIn('userId', renamed.view['filters']['nested'])
        self.assertNotIn('apiToken', renamed.view['filters']['nested'])
        self.assertNotIn('access_token', renamed.view['filters']['nested'])
        for key in FORBIDDEN_VIEW_PAYLOAD_KEYS:
            self.assertNotIn(key, renamed.view['filters']['nested'])

        with self.assertRaises(UserViewConfigConflict) as raised:
            mutate_user_view(
                self.context,
                view_id,
                payload={'eng': {}},
                base_version=1,
                database_url=self.database_url,
            )
        current = raised.exception.current.view
        self.assertNotIn('workspaceId', current['filters'])
        self.assertNotIn('userId', current['filters']['nested'])
        self.assertNotIn('apiToken', current['filters']['nested'])
        self.assertNotIn('access_token', current['filters']['nested'])
        for key in FORBIDDEN_VIEW_PAYLOAD_KEYS:
            self.assertNotIn(key, current['filters']['nested'])

        with self.factory() as session:
            stored = session.get(models.ViewConfig, view_id).payload
        self.assertEqual(stored, legacy_payload)

    def test_legacy_import_mutation_reports_effective_epm_change(self):
        result = save_imported_user_view(
            self.context,
            {'filters': {'keep': True}, 'epm': epm_payload('imported')},
            source_path='synthetic-config.json',
            source_hash='synthetic-hash',
            database_url=self.database_url,
        )
        self.assertTrue(result.effective_epm_changed)
        self.assertEqual(result.view['filters'], {'keep': True})


@unittest.skipUnless(os.environ.get('REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY') == '1', 'PostgreSQL gate not required')
class PostgresUserViewConcurrencyGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database_url = os.environ.get('TEST_DATABASE_URL', '').strip()
        try:
            parsed_url = make_url(cls.database_url)
        except Exception as error:
            raise AssertionError('TEST_DATABASE_URL must be an explicit PostgreSQL URL') from error
        if parsed_url.get_backend_name() != 'postgresql':
            raise AssertionError('TEST_DATABASE_URL must be an explicit PostgreSQL URL')
        cls.schema = f'user_view_gate_{uuid.uuid4().hex}'
        existing_options = str(parsed_url.query.get('options') or '').strip()
        bounded_options = ' '.join(filter(None, (
            existing_options,
            '-cstatement_timeout=5000',
            '-clock_timeout=1500',
        )))
        admin_url = parsed_url.update_query_dict({'options': bounded_options})
        cls.admin_engine = create_engine(
            admin_url.render_as_string(hide_password=False),
            future=True,
        )
        with cls.admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{cls.schema}"'))
        cls.addClassCleanup(cls._drop_schema)
        scoped_url = parsed_url.update_query_dict({
            'options': f'{bounded_options} -csearch_path={cls.schema}',
        })
        cls.scoped_url = scoped_url.render_as_string(hide_password=False)
        cls.engine = db_engine.get_engine(cls.scoped_url)
        models.Base.metadata.create_all(cls.engine)
        cls.factory = db_engine.session_factory(cls.scoped_url)
        with cls.factory() as session:
            cls.workspaces = [
                models.Workspace(environment_key='test', name='One', jira_site_url='https://one.invalid', jira_cloud_id='c1', created_by='test'),
                models.Workspace(environment_key='test', name='Two', jira_site_url='https://two.invalid', jira_cloud_id='c2', created_by='test'),
            ]
            cls.users = [
                models.User(external_provider='atlassian', external_subject='u1', account_type='user', status='active', created_by='test'),
                models.User(external_provider='atlassian', external_subject='u2', account_type='user', status='active', created_by='test'),
            ]
            session.add_all(cls.workspaces + cls.users)
            session.commit()

    def setUp(self):
        with self.factory() as session:
            session.query(models.ViewConfigVersion).delete()
            session.query(models.ViewConfig).delete()
            session.commit()

    @classmethod
    def _drop_schema(cls):
        try:
            db_engine.dispose_engines()
        finally:
            try:
                with cls.admin_engine.begin() as connection:
                    connection.execute(text(f'DROP SCHEMA IF EXISTS "{cls.schema}" CASCADE'))
            finally:
                cls.admin_engine.dispose()

    def _context(self, workspace_index=0, user_index=0):
        return RequestAuthContext(
            auth_mode='atlassian_oauth', user_id=self.users[user_index].id,
            stable_subject=self.users[user_index].id, atlassian_account_id=self.users[user_index].id,
            workspace_id=self.workspaces[workspace_index].id, auth_connection_id='connection',
            cloud_id=f'cloud-{workspace_index}', site_url='https://example.invalid',
            token_version='1', account_status='active', is_admin=False,
        )

    def _race(self, left, right):
        gate = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(lambda operation=op: (gate.wait(), operation())[1]) for op in (left, right)]
            return [future.result(timeout=10) for future in futures]

    def test_advisory_lock_serializes_same_scope_without_row_contention(self):
        first = self.engine.connect()
        second = self.engine.connect()
        try:
            self.assertIsNot(first.connection, second.connection)
            self.assertEqual(first.execute(text('select current_schema()')).scalar_one(), self.schema)
            self.assertEqual(second.execute(text('select current_schema()')).scalar_one(), self.schema)
        finally:
            first.close()
            second.close()

        context = self._context()
        entered = threading.Event()
        second_started = threading.Event()
        release = threading.Event()

        def create_blocked_view():
            second_started.set()
            return create_user_view(
                context,
                name='Blocked',
                view_type='eng',
                payload={'eng': {'blocked': True}},
                is_default=False,
                database_url=self.scoped_url,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            held = None
            blocked = None
            try:
                held = executor.submit(
                    create_user_view, context,
                    name='Held', view_type='eng', payload={'eng': {'held': True}},
                    is_default=False, database_url=self.scoped_url,
                    _before_commit=lambda: (entered.set(), release.wait(5)),
                )
                self.assertTrue(entered.wait(5))
                blocked = executor.submit(create_blocked_view)
                self.assertTrue(second_started.wait(2))
                time.sleep(0.2)
                self.assertFalse(blocked.done())
            finally:
                release.set()
            if held is not None:
                held.result(timeout=5)
            if blocked is not None:
                blocked.result(timeout=5)

    def test_selected_view_for_update_blocks_stale_service_read_on_raw_row_lock(self):
        context = self._context()
        created = create_user_view(
            context, name='Row lock', view_type='eng', payload={'eng': {}},
            is_default=False, database_url=self.scoped_url,
        )
        holder_connection = self.engine.connect()
        holder_transaction = holder_connection.begin()
        executor = ThreadPoolExecutor(max_workers=1)
        try:
            holder_connection.execute(
                select(models.ViewConfig).where(
                    models.ViewConfig.id == created.view_config_id,
                ).with_for_update()
            ).one()
            blocked = executor.submit(
                mutate_user_view,
                context,
                created.view_config_id,
                payload={'eng': {'mode': 'stale'}},
                base_version=0,
                database_url=self.scoped_url,
            )
            with self.assertRaises(UserViewConfigStorageError):
                blocked.result(timeout=3)
        finally:
            holder_transaction.rollback()
            holder_connection.close()
            executor.shutdown(wait=True, cancel_futures=True)

    def test_first_default_race_and_complete_last_write_winner(self):
        context = self._context(workspace_index=0, user_index=1)
        first_results = self._race(
            lambda: save_user_epm_config(context, epm_payload('alpha'), database_url=self.scoped_url),
            lambda: save_user_epm_config(context, epm_payload('beta'), database_url=self.scoped_url),
        )
        self.assertEqual(sorted(result.version_number for result in first_results), [1, 2])
        current_id = first_results[0].view_config_id
        seeded = mutate_user_view(
            context, current_id,
            payload={'filters': {'keep': True}, 'epm': epm_payload('seeded')},
            base_version=2, database_url=self.scoped_url,
        )
        save_results = self._race(
            lambda: save_user_epm_config(context, epm_payload('winner-a'), database_url=self.scoped_url),
            lambda: save_user_epm_config(context, epm_payload('winner-b'), database_url=self.scoped_url),
        )
        self.assertEqual(sorted(result.version_number for result in save_results), [4, 5])
        with self.factory() as session:
            defaults = session.execute(select(models.ViewConfig).where(
                models.ViewConfig.workspace_id == context.workspace_id,
                models.ViewConfig.owner_user_id == context.user_id,
                models.ViewConfig.is_default.is_(True),
                models.ViewConfig.archived_at.is_(None),
            )).scalars().all()
            self.assertEqual(len(defaults), 1)
            default = defaults[0]
            self.assertEqual(default.payload['filters'], {'keep': True})
            self.assertIn(next(iter(default.payload['epm']['projects'])), {'winner-a', 'winner-b'})
            versions = session.execute(select(models.ViewConfigVersion).where(
                models.ViewConfigVersion.view_config_id == default.id,
            ).order_by(models.ViewConfigVersion.version_number)).scalars().all()
            self.assertEqual([version.version_number for version in versions], [1, 2, 3, 4, 5])
            self.assertEqual(seeded.version_number, 3)

    def test_stale_replacement_waits_for_overlapping_epm_save_then_conflicts(self):
        context = self._context(workspace_index=1, user_index=0)
        created = create_user_view(
            context,
            name='Default',
            view_type='mixed',
            payload={'filters': {'keep': True}, 'epm': epm_payload('old')},
            is_default=True, database_url=self.scoped_url,
        )
        entered = threading.Event()
        release = threading.Event()
        executor = ThreadPoolExecutor(max_workers=2)
        try:
            saving = executor.submit(
                save_user_epm_config,
                context,
                epm_payload('new'),
                database_url=self.scoped_url,
                _before_commit=lambda: (entered.set(), release.wait(2)),
            )
            self.assertTrue(entered.wait(2))
            stale = executor.submit(
                mutate_user_view,
                context,
                created.view_config_id,
                payload={'filters': {'keep': False}},
                base_version=created.version_number,
                database_url=self.scoped_url,
            )
            time.sleep(0.2)
            self.assertFalse(stale.done())
            release.set()
            saved = saving.result(timeout=3)
            self.assertEqual(saved.version_number, 2)
            with self.assertRaises(UserViewConfigConflict) as raised:
                stale.result(timeout=3)
            self.assertEqual(raised.exception.current.version_number, 2)
            self.assertIn('new', raised.exception.current.view['epm']['projects'])
        finally:
            release.set()
            executor.shutdown(wait=True, cancel_futures=True)

    def _assert_scopes_do_not_block(self, left_context, right_context):
        entered = threading.Event()
        release = threading.Event()
        with ThreadPoolExecutor(max_workers=2) as executor:
            held = None
            try:
                held = executor.submit(
                    create_user_view, left_context,
                    name='Held', view_type='eng', payload={'eng': {'held': True}},
                    is_default=False, database_url=self.scoped_url,
                    _before_commit=lambda: (entered.set(), release.wait(5)),
                )
                self.assertTrue(entered.wait(5))
                unblocked = executor.submit(
                    create_user_view, right_context,
                    name='Independent', view_type='eng', payload={'eng': {'independent': True}},
                    is_default=False, database_url=self.scoped_url,
                )
                unblocked.result(timeout=2)
            finally:
                release.set()
            if held is not None:
                held.result(timeout=5)

    def test_advisory_scope_same_workspace_different_owner_does_not_block(self):
        self._assert_scopes_do_not_block(
            self._context(workspace_index=0, user_index=0),
            self._context(workspace_index=0, user_index=1),
        )

    def test_advisory_scope_same_owner_different_workspace_does_not_block(self):
        self._assert_scopes_do_not_block(
            self._context(workspace_index=0, user_index=0),
            self._context(workspace_index=1, user_index=0),
        )
