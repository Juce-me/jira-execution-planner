"""Owner-private `view.epm.viewEnabled` preference: validation, serialized service, route and rollback helper.

Synthetic data only. Routes run against the real DB OAuth browser session built by the cutover
test helper; service tests run against a throwaway SQLite database.
"""

import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from sqlalchemy import select

from backend.auth.context import RequestAuthContext
from backend.config.shared_config import validate_private_view_ownership
from backend.config.view_validation import (
    ViewPayloadValidationError,
    normalize_epm_settings_payload,
    normalize_user_view_payload,
)
from backend.db import engine as db_engine
from backend.db import models
from backend.services import user_view_config
from backend.services.user_view_config import (
    UserViewConfigStorageError,
    create_user_view,
    load_user_epm_view_enabled,
    mutate_user_view,
    save_imported_user_view,
    save_user_epm_config,
    set_user_epm_view_enabled,
    strip_epm_view_enabled,
)
import jira_server


def epm_settings(label='alpha'):
    return {
        'version': 2,
        'labelPrefix': 'portfolio_project_*',
        'scope': {'rootGoalKey': 'ROOT-A', 'subGoalKeys': ['GOAL-B']},
        'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
        'projects': {label: {'id': label, 'name': label.title(), 'label': f'portfolio_project_{label}'}},
    }


class ViewEnabledValidationTests(unittest.TestCase):
    def test_boolean_is_accepted_in_a_private_view_and_kept(self):
        for value in (True, False):
            normalized = normalize_user_view_payload({'epm': {'viewEnabled': value, 'tab': 'active'}})
            self.assertIs(normalized['epm']['viewEnabled'], value)
            self.assertEqual(normalized['epm']['tab'], 'active')

    def test_boolean_coexists_with_settings_and_personal_strings(self):
        payload = {'eng': {'mode': 'catchup'}, 'epm': {**epm_settings(), 'tab': 'backlog',
                                                       'selectedSprint': '42', 'viewEnabled': True}}
        normalized = validate_private_view_ownership(payload)
        self.assertIs(normalized['epm']['viewEnabled'], True)
        self.assertEqual(normalized['epm']['selectedSprint'], '42')
        self.assertEqual(normalized['eng'], {'mode': 'catchup'})

    def test_non_boolean_values_are_rejected(self):
        for value in ('true', 'false', 1, 0, None, [], {}):
            with self.subTest(value=value), self.assertRaises(ViewPayloadValidationError):
                normalize_user_view_payload({'epm': {'viewEnabled': value}})

    def test_string_personal_fields_still_reject_booleans_and_unknown_keys_still_fail(self):
        for payload in ({'epm': {'tab': True}}, {'epm': {'selectedSprint': 1}}, {'epm': {'viewEnabledX': True}}):
            with self.subTest(payload=payload), self.assertRaises(ViewPayloadValidationError):
                normalize_user_view_payload(payload)

    def test_five_key_epm_config_payload_is_unchanged_and_rejects_the_preference(self):
        with self.assertRaises(ViewPayloadValidationError):
            normalize_epm_settings_payload({**epm_settings(), 'viewEnabled': True})
        self.assertEqual(set(normalize_epm_settings_payload(epm_settings())),
                         {'version', 'labelPrefix', 'scope', 'issueTypes', 'projects'})


class DbFixtureMixin:
    def setUpDb(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'views.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspaces = [
                models.Workspace(environment_key='local', name='One', jira_site_url='https://one.invalid',
                                 jira_cloud_id='c1', created_by='test'),
                models.Workspace(environment_key='local', name='Two', jira_site_url='https://two.invalid',
                                 jira_cloud_id='c2', created_by='test'),
            ]
            users = [
                models.User(external_provider='atlassian', external_subject=f'u{i}', account_type='user',
                            status='active', created_by='test') for i in (1, 2)
            ]
            session.add_all(workspaces + users)
            session.commit()
            self.workspace_id, self.other_workspace_id = workspaces[0].id, workspaces[1].id
            self.user_id, self.other_user_id = users[0].id, users[1].id
        self.context = self.make_context(self.workspace_id, self.user_id)

    def tearDownDb(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    @staticmethod
    def make_context(workspace_id, user_id):
        return RequestAuthContext(
            auth_mode='atlassian_oauth', user_id=user_id, stable_subject=user_id, atlassian_account_id=user_id,
            workspace_id=workspace_id, auth_connection_id=f'connection-{user_id}', cloud_id=workspace_id,
            site_url='https://example.invalid', token_version='1', account_status='active', is_admin=False,
        )

    def default_view(self, context=None):
        context = context or self.context
        with self.factory() as session:
            return session.execute(select(models.ViewConfig).where(
                models.ViewConfig.workspace_id == context.workspace_id,
                models.ViewConfig.owner_user_id == context.user_id,
                models.ViewConfig.is_default.is_(True),
                models.ViewConfig.archived_at.is_(None),
            )).scalars().one()

    def versions(self, view_id):
        with self.factory() as session:
            return session.execute(select(models.ViewConfigVersion).where(
                models.ViewConfigVersion.view_config_id == view_id,
            ).order_by(models.ViewConfigVersion.version_number)).scalars().all()

    def enabled(self, context=None):
        return load_user_epm_view_enabled(context or self.context, database_url=self.database_url)

    def set_enabled(self, value, context=None, **kwargs):
        return set_user_epm_view_enabled(context or self.context, value, database_url=self.database_url, **kwargs)


class ViewEnabledServiceTests(DbFixtureMixin, unittest.TestCase):
    def setUp(self):
        self.setUpDb()

    def tearDown(self):
        self.tearDownDb()

    def test_missing_default_view_reads_false_and_toggle_creates_the_private_default(self):
        self.assertIs(self.enabled(), False)
        result = self.set_enabled(True)
        self.assertIs(self.enabled(), True)
        self.assertTrue(result.is_default)
        self.assertEqual(self.default_view().payload, {'epm': {'viewEnabled': True}})
        self.set_enabled(False)
        self.assertIs(self.enabled(), False)

    def test_non_boolean_input_is_rejected_before_any_write(self):
        for value in ('true', 1, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.set_enabled(value)
        with self.factory() as session:
            self.assertEqual(session.execute(select(models.ViewConfig)).scalars().all(), [])

    def test_toggle_preserves_every_other_private_field_and_appends_one_version(self):
        save_user_epm_config(self.context, epm_settings('alpha'), database_url=self.database_url)
        view = self.default_view()
        with self.factory() as session:
            row = session.get(models.ViewConfig, view.id)
            payload = dict(row.payload)
            payload['eng'] = {'mode': 'catchup'}
            payload['epm'] = {**payload['epm'], 'tab': 'active', 'selectedSprint': '77'}
            row.payload = payload
            session.commit()
        before = self.default_view().payload
        before_versions = len(self.versions(view.id))

        self.set_enabled(True)

        after = self.default_view().payload
        self.assertEqual({**after, 'epm': {k: v for k, v in after['epm'].items() if k != 'viewEnabled'}}, before)
        self.assertIs(after['epm']['viewEnabled'], True)
        self.assertEqual(len(self.versions(view.id)), before_versions + 1)
        self.assertEqual(self.default_view().id, view.id)

    def test_setting_the_same_value_does_not_append_a_version(self):
        self.set_enabled(True)
        view = self.default_view()
        count = len(self.versions(view.id))
        self.set_enabled(True)
        self.assertEqual(len(self.versions(view.id)), count)

    def test_epm_config_save_preserves_the_flag_and_the_normalized_five_key_body(self):
        self.set_enabled(True)
        save_user_epm_config(self.context, epm_settings('beta'), database_url=self.database_url)
        epm = self.default_view().payload['epm']
        self.assertIs(epm['viewEnabled'], True)
        self.assertEqual({k: v for k, v in epm.items() if k != 'viewEnabled'},
                         normalize_epm_settings_payload(epm_settings('beta')))
        self.assertEqual(user_view_config.load_user_epm_config(self.context, database_url=self.database_url),
                         normalize_epm_settings_payload(epm_settings('beta')))

    def test_users_and_workspaces_are_isolated(self):
        other_user = self.make_context(self.workspace_id, self.other_user_id)
        other_workspace = self.make_context(self.other_workspace_id, self.user_id)
        self.set_enabled(True)
        self.assertIs(self.enabled(other_user), False)
        self.assertIs(self.enabled(other_workspace), False)
        self.set_enabled(True, other_workspace)
        self.set_enabled(False)
        self.assertIs(self.enabled(other_workspace), True)
        self.assertIs(self.enabled(), False)

    def test_failed_transaction_rolls_back_the_toggle(self):
        self.set_enabled(False)
        view = self.default_view()
        count = len(self.versions(view.id))

        def boom():
            raise RuntimeError('synthetic failure before commit')

        with self.assertRaises(RuntimeError):
            self.set_enabled(True, _before_commit=boom)
        self.assertIs(self.enabled(), False)
        self.assertEqual(len(self.versions(view.id)), count)

    def test_storage_failure_is_a_typed_error(self):
        with patch.object(db_engine, 'session_scope', side_effect=__import__('sqlalchemy').exc.OperationalError('x', {}, Exception('db'))):
            with self.assertRaises(UserViewConfigStorageError):
                self.set_enabled(True)

    def _race(self, left, right):
        gate = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(lambda operation=op: (gate.wait(), operation())[1]) for op in (left, right)]
            return [future.result(timeout=15) for future in futures]

    def test_concurrent_toggle_and_epm_save_keep_both(self):
        self.set_enabled(False)
        self._race(
            lambda: self.set_enabled(True),
            lambda: save_user_epm_config(self.context, epm_settings('gamma'), database_url=self.database_url),
        )
        epm = self.default_view().payload['epm']
        self.assertIs(epm['viewEnabled'], True)
        self.assertEqual(list(epm['projects']), ['gamma'])

    def test_concurrent_toggle_and_default_replacement_keep_the_owner_flag(self):
        self.set_enabled(False)
        view = self.default_view()
        base = len(self.versions(view.id))
        self._race(
            lambda: self.set_enabled(True),
            lambda: mutate_user_view(self.context, view.id, payload={'eng': {'mode': 'planning'}}, base_version=base,
                                     database_url=self.database_url),
        )
        payload = self.default_view().payload
        self.assertEqual(payload['eng'], {'mode': 'planning'})
        self.assertIs(payload['epm']['viewEnabled'], True)

    def test_default_replacement_preserves_the_flag_and_ignores_a_client_supplied_value(self):
        self.set_enabled(True)
        view = self.default_view()
        base = len(self.versions(view.id))
        mutate_user_view(self.context, view.id, payload={'eng': {'mode': 'planning'}, 'epm': {'viewEnabled': False}},
                         base_version=base, database_url=self.database_url)
        self.assertIs(self.default_view().payload['epm']['viewEnabled'], True)
        self.assertEqual(self.default_view().payload['eng'], {'mode': 'planning'})

        self.set_enabled(False)
        base = len(self.versions(view.id))
        mutate_user_view(self.context, view.id, payload={'eng': {}, 'epm': {'viewEnabled': True}},
                         base_version=base, database_url=self.database_url)
        self.assertIs(self.enabled(), False)

    def test_replacement_of_a_default_without_a_saved_flag_does_not_invent_one(self):
        created = create_user_view(self.context, name='Default', view_type='eng', payload={'eng': {}},
                                   is_default=True, database_url=self.database_url)
        mutate_user_view(self.context, created.view_config_id, payload={'eng': {'mode': 'x'}}, base_version=1,
                         database_url=self.database_url)
        self.assertNotIn('epm', self.default_view().payload)

    def test_new_default_view_and_promotion_never_adopt_or_reset_the_flag(self):
        self.set_enabled(True)
        first_id = self.default_view().id
        # A new saved view that carries its own flag value, created non-default: kept as given.
        saved = create_user_view(self.context, name='Saved', view_type='eng',
                                 payload={'eng': {'mode': 'a'}, 'epm': {'viewEnabled': False}},
                                 is_default=False, database_url=self.database_url)
        self.assertIs(self.enabled(), True)
        # Promotion: the promoted view becomes default and carries the OWNER's current flag.
        mutate_user_view(self.context, saved.view_config_id, is_default=True, database_url=self.database_url)
        self.assertNotEqual(self.default_view().id, first_id)
        self.assertIs(self.enabled(), True)
        self.assertEqual(self.default_view().payload['eng'], {'mode': 'a'})
        # A new default view replacing the default: flag still the owner's, even if payload says otherwise.
        create_user_view(self.context, name='Newer', view_type='eng',
                         payload={'eng': {'mode': 'b'}, 'epm': {'viewEnabled': False}},
                         is_default=True, database_url=self.database_url)
        self.assertIs(self.enabled(), True)
        # And a disabled owner is not enabled by an imported/promoted payload.
        self.set_enabled(False)
        create_user_view(self.context, name='Newest', view_type='eng',
                         payload={'eng': {'mode': 'c'}, 'epm': {'viewEnabled': True}},
                         is_default=True, database_url=self.database_url)
        self.assertIs(self.enabled(), False)

    def test_legacy_import_replacement_preserves_the_flag(self):
        self.set_enabled(True)
        result = save_imported_user_view(
            self.context, {'eng': {'mode': 'imported'}, 'epm': {'viewEnabled': False}},
            source_path='synthetic.json', source_hash='h1', database_url=self.database_url,
        )
        self.assertTrue(result.mutation_applied)
        payload = self.default_view().payload
        self.assertEqual(payload['eng'], {'mode': 'imported'})
        self.assertIs(payload['epm']['viewEnabled'], True)

    def test_legacy_import_creating_the_first_default_never_enables(self):
        save_imported_user_view(
            self.context, {'eng': {}, 'epm': {'viewEnabled': True}},
            source_path='synthetic.json', source_hash='h2', database_url=self.database_url,
        )
        self.assertIs(self.enabled(), False)


class ViewEnabledDowngradeCleanupTests(DbFixtureMixin, unittest.TestCase):
    """The operator rollback step: remove ONLY viewEnabled, keep every other field, view and user."""

    def setUp(self):
        self.setUpDb()

    def tearDown(self):
        self.tearDownDb()

    def test_strip_removes_only_the_flag_for_every_owner_and_keeps_versions(self):
        other_user = self.make_context(self.workspace_id, self.other_user_id)
        other_workspace = self.make_context(self.other_workspace_id, self.user_id)
        for context, label in ((self.context, 'a'), (other_user, 'b'), (other_workspace, 'c')):
            save_user_epm_config(context, epm_settings(label), database_url=self.database_url)
            self.set_enabled(True, context)
        create_user_view(self.context, name='Eng', view_type='eng', payload={'eng': {'mode': 'x'}},
                         database_url=self.database_url)
        with self.factory() as session:
            before = {row.id: (row.payload, row.owner_user_id, row.workspace_id, row.is_default, row.name)
                      for row in session.execute(select(models.ViewConfig)).scalars()}
            version_counts = {row.id: len(self.versions(row.id)) for row in session.execute(select(models.ViewConfig)).scalars()}

        changed = strip_epm_view_enabled(database_url=self.database_url)

        self.assertEqual(changed, 3)
        with self.factory() as session:
            rows = session.execute(select(models.ViewConfig)).scalars().all()
            self.assertEqual({row.id for row in rows}, set(before))
            for row in rows:
                payload, owner, workspace, is_default, name = before[row.id]
                expected = {**payload}
                if isinstance(expected.get('epm'), dict):
                    expected['epm'] = {k: v for k, v in expected['epm'].items() if k != 'viewEnabled'}
                self.assertEqual(row.payload, expected)
                self.assertEqual((row.owner_user_id, row.workspace_id, row.is_default, row.name),
                                 (owner, workspace, is_default, name))
                self.assertEqual(len(self.versions(row.id)), version_counts[row.id])
                for version in self.versions(row.id):
                    self.assertNotIn('viewEnabled', (version.payload.get('epm') or {}))
            self.assertEqual(session.execute(select(models.User)).scalars().all().__len__(), 2)
        for context in (self.context, other_user, other_workspace):
            self.assertIs(self.enabled(context), False)
            self.assertEqual(len(user_view_config.load_user_epm_config(context, database_url=self.database_url)['projects']), 1)

    def test_strip_is_idempotent_and_owner_scoped_when_asked(self):
        other_user = self.make_context(self.workspace_id, self.other_user_id)
        self.set_enabled(True)
        self.set_enabled(True, other_user)
        self.assertEqual(strip_epm_view_enabled(database_url=self.database_url, context=self.context), 1)
        self.assertIs(self.enabled(), False)
        self.assertIs(self.enabled(other_user), True)
        self.assertEqual(strip_epm_view_enabled(database_url=self.database_url), 1)
        self.assertEqual(strip_epm_view_enabled(database_url=self.database_url), 0)

    def test_strip_leaves_credentials_untouched(self):
        with self.factory() as session:
            session.add(models.AuthConnection(
                user_id=self.user_id, workspace_id=self.workspace_id, provider='atlassian_oauth',
                site_url='https://one.invalid', cloud_id='c1', scopes=['read:me'], scope_provenance='provider',
                status='active', token_version=1))
            session.commit()
        self.set_enabled(True)
        strip_epm_view_enabled(database_url=self.database_url)
        with self.factory() as session:
            rows = session.execute(select(models.AuthConnection)).scalars().all()
            self.assertEqual([(r.status, r.token_version, r.scopes) for r in rows], [('active', 1, ['read:me'])])


class ViewEnabledRouteTests(unittest.TestCase):
    """POST /api/epm/preferences and the bootstrap flag through a real DB OAuth browser session."""

    def setUp(self):
        from tests import test_db_oauth_cutover as cutover
        self.helper = cutover.DbOauthCutoverTests('test_callback_writes_encrypted_db_tokens_and_returns_session_metadata')
        self.helper.setUp()
        self.addCleanup(self.helper.tearDown)
        self.client = self.helper.client
        self.callback = self.helper._store_callback_through_route(client=self.client)
        self.database_url = self.helper.database_url
        with self.helper.factory() as session:
            connection = session.get(models.AuthConnection, self.callback.connection_id)
            self.context = RequestAuthContext(
                auth_mode='atlassian_oauth', user_id=connection.user_id, stable_subject='account-123',
                atlassian_account_id='account-123', workspace_id=connection.workspace_id,
                auth_connection_id=connection.id, cloud_id=connection.cloud_id,
                site_url='https://example.atlassian.net', token_version=str(connection.token_version),
                account_status='active', is_admin=False,
            )

    def headers(self, **extra):
        with self.helper._db_route_mode():
            response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200)
        return {'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': response.get_json()['csrfToken'], **extra}

    def post(self, body, headers=None, **kwargs):
        headers = self.headers() if headers is None else headers
        with self.helper._db_route_mode():
            return self.client.post('/api/epm/preferences', json=body, headers=headers, **kwargs)

    def stored_flag(self):
        return load_user_epm_view_enabled(self.context, database_url=self.database_url)

    def test_true_then_false_return_the_committed_boolean(self):
        for value in (True, False, True):
            response = self.post({'viewEnabled': value})
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), {'epmViewEnabled': value})
            self.assertIs(self.stored_flag(), value)

    def test_exact_body_contract_rejects_everything_else_with_invalid_epm_preferences(self):
        bodies = [
            {}, {'viewEnabled': 'true'}, {'viewEnabled': 1}, {'viewEnabled': None}, {'viewEnabled': []},
            {'viewEnabled': True, 'extra': 1}, {'viewEnabled': True, 'userId': 'someone-else'},
            {'viewEnabled': True, 'workspaceId': 'other-workspace'}, {'viewEnabled': True, 'scope': 'read:me'},
            [True], 'true', None, 7,
        ]
        for body in bodies:
            with self.subTest(body=body):
                response = self.post(body)
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'invalid_epm_preferences')
        self.assertIs(self.stored_flag(), False)

    def test_non_json_and_malformed_json_are_invalid_preferences(self):
        wrong_headers, malformed_headers = self.headers(), None
        with self.helper._db_route_mode():
            wrong_type = self.client.post('/api/epm/preferences', data='viewEnabled=true', headers=wrong_headers)
        malformed_headers = self.headers()
        with self.helper._db_route_mode():
            malformed = self.client.post('/api/epm/preferences', data='{',
                                         headers={**malformed_headers, 'Content-Type': 'application/json'})
        for response in (wrong_type, malformed):
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()['error'], 'invalid_epm_preferences')

    def test_query_string_selectors_are_ignored_and_never_widen_the_owner(self):
        response = self.post({'viewEnabled': True}, query_string={'userId': 'x', 'workspaceId': 'y'})
        self.assertEqual(response.status_code, 200)
        self.assertIs(self.stored_flag(), True)

    def test_csrf_and_requested_with_are_both_required(self):
        good = self.headers()
        no_csrf = {k: v for k, v in good.items() if k != 'X-CSRF-Token'}
        no_requested_with = {k: v for k, v in good.items() if k != 'X-Requested-With'}
        wrong_csrf = {**good, 'X-CSRF-Token': 'forged'}
        for headers in (no_csrf, no_requested_with, wrong_csrf, {}):
            with self.subTest(headers=sorted(headers)):
                response = self.post({'viewEnabled': True}, headers=headers)
                self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'csrf_required')
        self.assertIs(self.stored_flag(), False)

    def test_missing_session_returns_the_existing_base_auth_401(self):
        anonymous = jira_server.app.test_client()
        with self.helper._db_route_mode():
            response = anonymous.post('/api/epm/preferences', json={'viewEnabled': True},
                                      headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 401)
        self.assertIs(self.stored_flag(), False)

    def test_toggle_does_not_touch_tokens_connections_or_the_epm_config(self):
        save_user_epm_config(self.context, epm_settings('alpha'), database_url=self.database_url)
        with self.helper.factory() as session:
            tokens_before = [(t.id, t.ciphertext) for t in session.execute(select(models.AuthToken)).scalars()]
            connection = session.get(models.AuthConnection, self.callback.connection_id)
            connection_before = (connection.token_version, connection.status, list(connection.scopes))
        response = self.post({'viewEnabled': True})
        self.assertEqual(response.status_code, 200)
        with self.helper.factory() as session:
            self.assertEqual([(t.id, t.ciphertext) for t in session.execute(select(models.AuthToken)).scalars()], tokens_before)
            connection = session.get(models.AuthConnection, self.callback.connection_id)
            self.assertEqual((connection.token_version, connection.status, list(connection.scopes)), connection_before)
        self.assertEqual(user_view_config.load_user_epm_config(self.context, database_url=self.database_url),
                         normalize_epm_settings_payload(epm_settings('alpha')))

    def test_storage_failure_is_503_and_changes_nothing(self):
        with patch('backend.services.user_view_config.set_user_epm_view_enabled',
                   side_effect=UserViewConfigStorageError('down')):
            response = self.post({'viewEnabled': True})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error'], 'config_storage_unavailable')
        self.assertIs(self.stored_flag(), False)

    def test_non_db_storage_cannot_hold_the_preference(self):
        headers = self.headers()
        with self.helper._db_route_mode(), patch.object(jira_server, 'config_storage_db_enabled', return_value=False):
            response = self.client.post('/api/epm/preferences', json={'viewEnabled': True}, headers=headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error'], 'config_storage_unavailable')
        self.assertIs(self.stored_flag(), False)

    def test_policy_is_exactly_user_write_post(self):
        from backend.security.policy import classify_rule, matching_policies
        self.assertEqual(classify_rule('/api/epm/preferences', ['POST']).policy_class, 'user_write')
        self.assertEqual(matching_policies('/api/epm/preferences', ['GET'], 'epm_routes.save_epm_preferences'), [])

    def test_preference_is_not_part_of_workspace_admin_or_group_config(self):
        self.post({'viewEnabled': True})
        with self.helper.factory() as session:
            for model in (models.WorkspaceGroupConfig,):
                for row in session.execute(select(model)).scalars():
                    self.assertNotIn('viewEnabled', str(getattr(row, 'payload', '')))


class ViewEnabledBootstrapTests(unittest.TestCase):
    def test_basic_json_bootstrap_reports_false(self):
        from tests.auth_mode_test_utils import force_basic_auth_mode
        force_basic_auth_mode(self, jira_server)
        client = jira_server.app.test_client()
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            jira_server, 'resolve_dashboard_config_path', return_value=os.path.join(tmp, 'dashboard-config.json'),
        ):
            payload = client.get('/api/config').get_json()
        self.assertIs(payload['epmViewEnabled'], False)

    def test_db_bootstrap_reports_the_owner_flag_only(self):
        from tests import test_db_oauth_cutover as cutover
        helper = cutover.DbOauthCutoverTests('test_callback_writes_encrypted_db_tokens_and_returns_session_metadata')
        helper.setUp()
        self.addCleanup(helper.tearDown)
        callback = helper._store_callback_through_route(client=helper.client)
        with helper.factory() as session:
            connection = session.get(models.AuthConnection, callback.connection_id)
            context = RequestAuthContext(
                auth_mode='atlassian_oauth', user_id=connection.user_id, stable_subject='account-123',
                atlassian_account_id='account-123', workspace_id=connection.workspace_id,
                auth_connection_id=connection.id, cloud_id=connection.cloud_id,
                site_url='https://example.atlassian.net', token_version=str(connection.token_version),
                account_status='active', is_admin=False,
            )
        from backend.routes import settings_routes
        with helper._db_route_mode():
            self.assertIs(settings_routes.epm_view_enabled_for_bootstrap(context, None), False)
            set_user_epm_view_enabled(context, True, database_url=helper.database_url)
            self.assertIs(settings_routes.epm_view_enabled_for_bootstrap(context, None), True)
            view = {'view': {'epm': {'viewEnabled': True}}}
            self.assertIs(settings_routes.epm_view_enabled_for_bootstrap(context, view), True)
            self.assertIs(settings_routes.epm_view_enabled_for_bootstrap(context, {'view': {'epm': {}}}), False)


if __name__ == '__main__':
    unittest.main()
