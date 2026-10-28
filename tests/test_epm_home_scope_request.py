"""Optional EPM Home read scopes: authorize-request union, callback grant handling and profile selection.

Synthetic data only; the cutover helper builds real DB OAuth browser sessions on SQLite. No network.
"""

import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError, build_authorize_url, merge_oauth_scopes, AuthConfig
from backend.db import models
from backend.epm import home as epm_home
from backend.services.user_view_config import set_user_epm_view_enabled
import jira_server

HOME = tuple(epm_home.EPM_HOME_READ_SCOPES)
FORBIDDEN_REQUEST_SCOPES = ('identity:atlassian-external',)


def requested_scopes(location):
    return parse_qs(urlsplit(location).query)['scope'][0].split()


class AuthorizeUnionUnitTests(unittest.TestCase):
    def config(self, scopes):
        return AuthConfig(auth_mode='atlassian_oauth', jira_url='https://example.atlassian.net', jira_email='',
                          jira_token='', client_id='client', client_secret='secret',
                          redirect_uri='http://localhost/cb', scopes=scopes, flask_secret_key='k')

    def test_home_scope_set_is_the_four_read_scopes_defined_once(self):
        self.assertEqual(set(HOME), {'read:goal:goals', 'read:access:goals',
                                      'read:project:projects', 'read:access:projects'})
        self.assertTrue(all(scope.startswith('read:') for scope in HOME))
        for scope in HOME:
            self.assertNotIn(scope, jira_server.ATLASSIAN_SCOPES.split())

    def test_merge_dedupes_and_keeps_base_order_first(self):
        self.assertEqual(merge_oauth_scopes('a b offline_access', ['b', 'c', 'a', 'd']), 'a b offline_access c d')
        self.assertEqual(merge_oauth_scopes('', ()), '')
        self.assertEqual(merge_oauth_scopes('x  y', ()), 'x y')

    def test_no_extra_scopes_leaves_the_base_string_byte_identical(self):
        config = self.config('read:me   read:jira-work offline_access')
        url = build_authorize_url(config, 'state', 'challenge')
        self.assertEqual(parse_qs(urlsplit(url).query)['scope'], ['read:me   read:jira-work offline_access'])

    def test_extra_scopes_are_unioned_with_an_explicit_base_override(self):
        config = self.config('custom:base read:goal:goals offline_access')
        url = build_authorize_url(config, 'state', 'challenge', extra_scopes=HOME)
        self.assertEqual(requested_scopes(url), ['custom:base', 'read:goal:goals', 'offline_access',
                                                 'read:access:goals', 'read:project:projects', 'read:access:projects'])


class DbJourneyMixin:
    def start(self, signed_in=True):
        from tests import test_db_oauth_cutover as cutover
        self.helper = cutover.DbOauthCutoverTests('test_callback_writes_encrypted_db_tokens_and_returns_session_metadata')
        self.helper.setUp()
        self.addCleanup(self.helper.tearDown)
        self.client = self.helper.client
        self.database_url = self.helper.database_url
        if signed_in:
            self.callback = self.helper._store_callback_through_route(client=self.client)
            with self.helper.factory() as session:
                connection = session.get(models.AuthConnection, self.callback.connection_id)
                self.connection_id = connection.id
                self.context = RequestAuthContext(
                    auth_mode='atlassian_oauth', user_id=connection.user_id, stable_subject='account-123',
                    atlassian_account_id='account-123', workspace_id=connection.workspace_id,
                    auth_connection_id=connection.id, cloud_id=connection.cloud_id,
                    site_url='https://example.atlassian.net', token_version=str(connection.token_version),
                    account_status='active', is_admin=False,
                )

    def set_grant(self, scopes, provenance='provider'):
        with self.helper.factory() as session:
            connection = session.get(models.AuthConnection, self.connection_id)
            connection.scopes = list(scopes)
            connection.scope_provenance = provenance
            session.commit()

    def login(self, query_string=None, client=None):
        with self.helper._db_route_mode():
            return (client or self.client).get('/api/auth/atlassian/login', query_string=query_string)

    def enable(self, value=True):
        set_user_epm_view_enabled(self.context, value, database_url=self.database_url)


class AuthorizeRequestTests(DbJourneyMixin, unittest.TestCase):
    BASE = jira_server.ATLASSIAN_SCOPES.split()

    def test_initial_login_without_a_resolvable_user_finishes_base_consent_first(self):
        self.start(signed_in=False)
        response = self.login()
        self.assertEqual(response.status_code, 302)
        self.assertEqual(requested_scopes(response.headers['Location']), self.BASE)

    def test_signed_in_jira_only_user_is_never_asked_for_home_scopes(self):
        self.start()
        for state in (None, False):
            if state is False:
                self.enable(False)
            with self.subTest(saved=state):
                self.assertEqual(requested_scopes(self.login().headers['Location']), self.BASE)

    def test_enabled_user_gets_the_deduplicated_union_through_the_existing_pkce_state_flow(self):
        self.start()
        self.enable(True)
        response = self.login(query_string={'prompt': 'consent'})
        location = response.headers['Location']
        scopes = requested_scopes(location)
        self.assertEqual(scopes, self.BASE + list(HOME))
        self.assertEqual(len(scopes), len(set(scopes)))
        query = parse_qs(urlsplit(location).query)
        self.assertEqual(query['prompt'], ['consent'])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertTrue(query['state'][0])
        with self.client.session_transaction() as flask_session:
            self.assertEqual(flask_session['oauth_state'], query['state'][0])
            self.assertTrue(flask_session['oauth_pkce_verifier'])

    def test_explicit_base_override_is_unioned_not_replaced_and_ordinary_login_keeps_it_base_only(self):
        self.start()
        override = 'read:me offline_access read:goal:goals custom:jira'
        with patch.object(jira_server, 'ATLASSIAN_SCOPES', override):
            self.set_grant(override.split())
            ordinary = requested_scopes(self.login().headers['Location'])
            self.enable(True)
            enabled = requested_scopes(self.login().headers['Location'])
        self.assertEqual(ordinary, override.split())
        self.assertEqual(enabled, ['read:me', 'offline_access', 'read:goal:goals', 'custom:jira',
                                   'read:access:goals', 'read:project:projects', 'read:access:projects'])

    def test_browser_supplied_scope_lists_are_ignored(self):
        self.start()
        injected = {'scope': 'write:goal:goals manage:project:projects identity:atlassian-external',
                    'scopes': 'write:jira-work', 'extraScopes': 'read:goal:goals'}
        self.assertEqual(requested_scopes(self.login(query_string=injected).headers['Location']), self.BASE)
        self.enable(False)
        self.assertEqual(requested_scopes(self.login(query_string=injected).headers['Location']), self.BASE)
        self.enable(True)
        self.assertEqual(requested_scopes(self.login(query_string=injected).headers['Location']),
                         self.BASE + list(HOME))

    def test_another_users_preference_does_not_leak_into_an_anonymous_or_other_session(self):
        self.start()
        self.enable(True)
        anonymous = jira_server.app.test_client()
        self.assertEqual(requested_scopes(self.login(client=anonymous).headers['Location']), self.BASE)

    def test_user_whose_base_scopes_are_missing_is_not_resolvable_and_gets_base_only(self):
        self.start()
        self.enable(True)
        self.set_grant(['read:me'])
        self.assertEqual(requested_scopes(self.login().headers['Location']), self.BASE)

    def test_no_write_manage_or_internal_identity_scope_is_ever_added(self):
        self.start()
        self.enable(True)
        scopes = requested_scopes(self.login().headers['Location'])
        added = [scope for scope in scopes if scope not in self.BASE]
        self.assertEqual(added, list(HOME))
        for scope in added:
            self.assertTrue(scope.startswith('read:'))
            self.assertFalse(scope.startswith(('write:', 'manage:', 'delete:')))
        for forbidden in FORBIDDEN_REQUEST_SCOPES:
            self.assertNotIn(forbidden, scopes)

    def test_storage_failure_while_resolving_the_preference_falls_back_to_base_only(self):
        self.start()
        self.enable(True)
        from backend.services.user_view_config import UserViewConfigStorageError
        with patch('backend.services.user_view_config.load_user_epm_view_enabled',
                   side_effect=UserViewConfigStorageError('down')):
            self.assertEqual(requested_scopes(self.login().headers['Location']), self.BASE)

    def test_existing_missing_scope_entry_still_reaches_the_consent_login(self):
        self.start()
        with self.helper._db_route_mode():
            page = self.client.get('/login?reason=missing_scope')
        self.assertEqual(page.status_code, 200)
        self.assertIn('/api/auth/atlassian/login?prompt=consent', page.get_data(as_text=True))


class CallbackGrantTests(DbJourneyMixin, unittest.TestCase):
    def callback_with(self, token_scope, account='account-9'):
        self.start(signed_in=False)
        token = {'access_token': 'access-9', 'refresh_token': 'refresh-9', 'expires_in': 3600}
        if token_scope is not None:
            token['scope'] = token_scope
        with self.client.session_transaction() as flask_session:
            flask_session['oauth_state'] = 'state-9'
            flask_session['oauth_pkce_verifier'] = 'verifier-9'
        with self.helper._db_route_mode(), \
             patch.object(jira_server, 'exchange_authorization_code', return_value=token), \
             patch.object(jira_server, 'fetch_current_user', return_value={
                 'account_id': account, 'account_status': 'active', 'email': f'{account}@example.invalid',
                 'display_name': 'Synthetic'}), \
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[
                 {'id': 'cloud-123', 'url': 'https://example.atlassian.net/', 'name': 'Example'}]):
            response = self.client.get('/api/auth/atlassian/callback?state=state-9&code=abc')
        with self.helper.factory() as session:
            connection = session.query(models.AuthConnection).filter_by(provider='atlassian_oauth').one()
            grant = (list(connection.scopes), connection.scope_provenance)
        return response, grant

    def test_missing_home_scopes_do_not_fail_jira_sign_in_and_the_actual_grant_is_stored(self):
        base = jira_server.ATLASSIAN_SCOPES
        response, grant = self.callback_with(base)
        self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
        self.assertEqual(grant, (base.split(), 'provider'))
        with self.helper._db_route_mode():
            status = self.client.get('/api/auth/status').get_json()
            epm_config = self.client.get('/api/epm/config')
        self.assertTrue(status['authenticated'])
        self.assertEqual(epm_config.status_code, 200)

    def test_partial_home_grant_is_stored_as_confirmed_and_never_completed_from_the_request(self):
        granted = jira_server.ATLASSIAN_SCOPES + ' read:goal:goals read:access:goals'
        response, grant = self.callback_with(granted)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(grant, (granted.split(), 'provider'))
        self.assertFalse(set(HOME) <= set(grant[0]))

    def test_full_home_grant_is_persisted_verbatim(self):
        granted = jira_server.ATLASSIAN_SCOPES + ' ' + ' '.join(HOME)
        response, grant = self.callback_with(granted)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(grant, (granted.split(), 'provider'))

    def test_grant_without_a_scope_field_is_unverified_and_infers_nothing(self):
        response, grant = self.callback_with(None)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(grant, ([], 'unknown'))


class ProfileSelectionTests(unittest.TestCase):
    def ctx(self, **overrides):
        values = dict(auth_mode='atlassian_oauth', user_id='u', stable_subject='s', atlassian_account_id='s',
                      workspace_id='w', auth_connection_id='conn-1', cloud_id='c', site_url='https://example.invalid',
                      token_version='1', account_status='active', is_admin=False, granted_scopes=HOME,
                      granted_scopes_verified=True)
        values.update(overrides)
        return RequestAuthContext(**values)

    def test_home_oauth_only_when_enabled_and_every_scope_is_provider_confirmed(self):
        select = epm_home.select_epm_home_read_profile
        self.assertEqual(select(self.ctx(), view_enabled=True), 'public-read-v1')
        self.assertEqual(select(self.ctx(), view_enabled=False), 'legacy')

    def test_enabled_without_the_full_confirmed_grant_never_moves_to_the_legacy_token_path(self):
        select = epm_home.select_epm_home_read_profile
        for overrides in (dict(granted_scopes=HOME[:3]), dict(granted_scopes=()), dict(granted_scopes_verified=False)):
            with self.subTest(overrides=overrides):
                self.assertEqual(select(self.ctx(**overrides), view_enabled=True), 'epm-scope-required')

    def test_basic_local_store_and_missing_contexts_stay_legacy_even_when_enabled(self):
        select = epm_home.select_epm_home_read_profile
        for context in (self.ctx(auth_mode='basic'), self.ctx(auth_connection_id='local-oauth-connection:x'),
                        self.ctx(auth_connection_id=''), None):
            with self.subTest(context=context):
                self.assertEqual(select(context, view_enabled=True), 'legacy')

    def test_scope_required_snapshot_fails_closed_before_any_io(self):
        calls = []
        snapshot = epm_home.HomeReadAuth(
            'epm-scope-required', self.ctx(granted_scopes=HOME[:2]),
            revalidate=lambda captured: calls.append('revalidate'),
            load_session=lambda context: calls.append('load') or {},
        )
        self.assertTrue(snapshot.strict)
        for action in (snapshot.revalidate, snapshot.lease, snapshot.cloud_id, snapshot.access_token):
            with self.subTest(action=action.__name__):
                with self.assertRaises(AuthError) as raised:
                    action()
                self.assertEqual(raised.exception.code, 'epm_scope_required')
        with self.assertRaises(AuthError):
            snapshot.client().execute('query { x }', {})
        self.assertEqual(calls, [])

    def test_resolver_reads_the_owner_preference_once_and_only_for_db_contexts(self):
        with patch.object(jira_server, 'config_storage_db_enabled', return_value=True), \
             patch.object(jira_server, 'build_db_config_repository') as repository:
            repository.return_value.load_user_epm_view_enabled.return_value = True
            self.assertEqual(jira_server.resolve_epm_home_read_auth(self.ctx()).profile, 'public-read-v1')
            repository.return_value.load_user_epm_view_enabled.return_value = False
            self.assertEqual(jira_server.resolve_epm_home_read_auth(self.ctx()).profile, 'legacy')
            repository.return_value.load_user_epm_view_enabled.reset_mock()
            for context in (self.ctx(auth_connection_id='local-oauth-connection:x'), self.ctx(auth_mode='basic', auth_connection_id='')):
                self.assertEqual(jira_server.resolve_epm_home_read_auth(context).profile, 'legacy')
            repository.return_value.load_user_epm_view_enabled.assert_not_called()

    def test_json_storage_never_enables_home_oauth(self):
        with patch.object(jira_server, 'config_storage_db_enabled', return_value=False):
            self.assertEqual(jira_server.resolve_epm_home_read_auth(self.ctx()).profile, 'legacy')


class EpmRouteStateTests(DbJourneyMixin, unittest.TestCase):
    """Disabled, enabled without the confirmed scopes, and enabled with them, on the real EPM routes."""

    ROUTES = ('/api/epm/goals', '/api/epm/scope', '/api/epm/projects', '/api/epm/projects/rollup/all?tab=active&sprint=42')

    def setUp(self):
        self.start()
        from backend.services.user_view_config import save_user_epm_config
        save_user_epm_config(self.context, {
            'version': 2, 'labelPrefix': 'portfolio_project_*',
            'scope': {'rootGoalKey': 'ROOT-A', 'subGoalKeys': ['GOAL-B']},
            'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
            'projects': {},
        }, database_url=self.database_url)
        self.home_calls = []

        def forbidden_urlopen(request, timeout=None):
            self.home_calls.append(request.full_url)
            raise AssertionError('Home I/O must not happen')

        patcher = patch.object(epm_home, 'urlopen', forbidden_urlopen)
        patcher.start()
        self.addCleanup(patcher.stop)

    def get(self, path):
        with self.helper._db_route_mode():
            return self.client.get(path)

    def test_enabled_without_confirmed_scopes_is_a_409_feature_error_with_no_home_io_and_no_token_fallback(self):
        self.enable(True)
        self.set_grant(self.helper_base_scopes())
        for path in self.ROUTES:
            with self.subTest(path=path), patch.object(epm_home, '_read_metadata_credential',
                                                        side_effect=AssertionError('API-token fallback')):
                response = self.get(path)
                if path == '/api/epm/scope':
                    # The scope route needs no Home scope: the site id comes from the validated context.
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.get_json()['error'], '')
                    continue
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.get_json()['error'], 'epm_scope_required')
                self.assertEqual(response.get_json()['loginUrl'], '/login?reason=missing_scope')
        self.assertEqual(self.home_calls, [])

    def test_enabled_with_a_partial_grant_is_the_same_as_missing(self):
        self.enable(True)
        self.set_grant(self.helper_base_scopes() + list(HOME[:3]))
        response = self.get('/api/epm/goals')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'epm_scope_required'))
        self.assertEqual(self.home_calls, [])

    def test_enabled_with_unverified_provenance_is_treated_as_missing(self):
        self.enable(True)
        self.set_grant(self.helper_base_scopes() + list(HOME), provenance='unknown')
        # Unverified provenance fails the base guard first (existing behavior): 401, never a Home call.
        self.assertEqual(self.get('/api/epm/goals').status_code, 401)
        self.assertEqual(self.home_calls, [])

    def test_disabled_user_with_the_full_grant_does_not_move_to_home_oauth(self):
        self.enable(False)
        self.set_grant(self.helper_base_scopes() + list(HOME))
        seen = []
        with patch.object(jira_server, 'resolve_epm_home_read_auth', wraps=jira_server.resolve_epm_home_read_auth):
            with patch.object(epm_home, 'select_epm_home_read_profile',
                              wraps=epm_home.select_epm_home_read_profile) as select:
                # Legacy user-token path: no connected token, so the existing typed prompt, never a Home OAuth call.
                response = self.get('/api/epm/goals')
                seen = [call.kwargs for call in select.call_args_list]
        self.assertIn(response.status_code, {200, 409})
        self.assertTrue(seen and all(kwargs.get('view_enabled') is False for kwargs in seen))
        self.assertEqual(self.home_calls, [])

    def test_config_routes_stay_reachable_for_every_state(self):
        for enabled, scopes in ((False, self.helper_base_scopes()), (True, self.helper_base_scopes()),
                                (True, self.helper_base_scopes() + list(HOME))):
            self.enable(enabled)
            self.set_grant(scopes)
            for path in ('/api/epm/config', '/api/auth/status'):
                with self.subTest(enabled=enabled, scopes=len(scopes), path=path):
                    self.assertEqual(self.get(path).status_code, 200)
        self.assertEqual(self.home_calls, [])

    @staticmethod
    def helper_base_scopes():
        return jira_server.ATLASSIAN_SCOPES.split()


if __name__ == '__main__':
    unittest.main()
