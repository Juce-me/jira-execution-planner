"""DB OAuth retirement checks; run only through run_isolated_runtime_tests.py."""
import base64
import os
import unittest
from contextlib import ExitStack
from dataclasses import replace
from unittest.mock import patch, Mock
from types import SimpleNamespace

from flask import session
from sqlalchemy.exc import OperationalError

import jira_server as server
from backend.auth import jira_auth
from backend.auth.db_browser_sessions import create_browser_session
from backend.auth.db_context import resolve_db_request_auth_context
from backend.auth.db_tokens import store_oauth_callback_tokens
from backend.auth.key_provider import key_provider_from_env
from backend.db import engine, models
from backend.epm import home as epm_home
from tests.postgres_test_db import fresh_database_url


class RuntimeAuthCutoverTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.url = fresh_database_url(self.addCleanup)
        self.stack.enter_context(patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.url,
            'APP_ENVIRONMENT_KEY': 'local', 'APP_BIND_HOST': '127.0.0.1',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes(range(32))).decode(),
            'TOKEN_ENCRYPTION_KEY_ID': 'synthetic-key',
        }))
        self.stack.enter_context(patch.object(server, 'JIRA_AUTH_MODE', 'atlassian_oauth'))
        self.stack.enter_context(patch.object(server, 'APP_ENVIRONMENT_KEY', 'local'))
        self.stack.enter_context(patch.object(server, 'JIRA_URL', 'https://example.atlassian.net'))
        self.stack.enter_context(patch.object(jira_auth, 'base64', SimpleNamespace(b64encode=Mock(side_effect=AssertionError('Basic encoding called')), urlsafe_b64encode=base64.urlsafe_b64encode)))
        models.Base.metadata.create_all(engine.get_engine(self.url))
        self.factory = engine.session_factory(self.url)
        self.addCleanup(engine.dispose_engines)
        server.app.config['TESTING'] = True
        self.client = server.app.test_client()

    def seed(self, *, legacy=False):
        with self.factory() as db:
            stored = store_oauth_callback_tokens(db,
                token_data={'access_token': 'synthetic-access', 'refresh_token': 'synthetic-refresh',
                            'expires_in': 3600, 'scope': server.ATLASSIAN_SCOPES},
                resource={'id': 'synthetic-cloud', 'url': 'https://example.atlassian.net', 'name': 'Synthetic'},
                user_profile={'account_id': 'synthetic-user', 'account_status': 'active', 'display_name': 'Synthetic'},
                environment_key='local', configured_jira_url='https://example.atlassian.net',
                key_provider=key_provider_from_env(), requested_scopes=server.ATLASSIAN_SCOPES)
            handle = create_browser_session(db, user_id=stored.user_id, workspace_id=stored.workspace_id,
                                            auth_connection_id=stored.connection_id)
            payload = dict(stored.session_metadata) if legacy else {'db_browser_session_id': handle.id}
            db.commit()
        with self.client.session_transaction() as cookie:
            cookie['db_oauth_session'] = payload
        return stored

    def test_real_db_identity_token_csrf_and_logout(self):
        self.seed()
        self.assertTrue(self.client.get('/api/auth/status').json['authenticated'])
        self.assertTrue(self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'}).json['csrfToken'])
        refreshed = self.client.post('/api/auth/refresh', headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(refreshed.status_code, 200)
        self.assertTrue(refreshed.json['authenticated'])
        self.assertEqual(self.client.post('/api/auth/logout', headers={'X-Requested-With': 'jira-execution-planner'}).status_code, 200)
        self.assertFalse(self.client.get('/api/auth/status').json['authenticated'])

    def test_valid_older_db_cookie_upgrades(self):
        self.seed(legacy=True)
        self.assertTrue(self.client.get('/api/auth/status').json['authenticated'])
        with self.client.session_transaction() as cookie:
            self.assertIn('db_browser_session_id', cookie['db_oauth_session'])

    def test_upgrade_operational_error_retains_valid_db_identity(self):
        self.seed(legacy=True)
        with patch.object(server, 'create_browser_session', side_effect=OperationalError('synthetic', {}, Exception())):
            self.assertTrue(self.client.get('/api/auth/status').json['authenticated'])
        with self.client.session_transaction() as cookie:
            self.assertIn('db_auth_connection_id', cookie['db_oauth_session'])

    def test_local_cookie_and_basic_header_do_not_authenticate(self):
        with self.client.session_transaction() as cookie:
            cookie['atlassian_oauth_session_id'] = 'poisoned-local-session'
        self.assertFalse(self.client.get('/api/auth/status', headers={'Authorization': 'Basic synthetic'}).json['authenticated'])
        self.assertEqual(self.client.get('/api/config').status_code, 401)
        self.assertEqual(self.client.post('/api/auth/refresh', headers={'X-Requested-With': 'jira-execution-planner'}).status_code, 401)
        self.assertEqual(self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'}).status_code, 401)

    def test_bypassed_launcher_invalid_profiles_fail_closed(self):
        for auth, storage in [('basic', 'db'), ('unexpected', 'db'), ('atlassian_oauth', 'json')]:
            with self.subTest(auth=auth, storage=storage), patch.object(server, 'JIRA_AUTH_MODE', auth), patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': storage}):
                self.assertEqual(self.client.get('/api/config').status_code, 503)
                self.assertEqual(self.client.get('/api/auth/status').status_code, 503)
                with self.assertRaises(jira_auth.AuthError):
                    server.create_serving_app()

    def test_cli_credentials_sanitized_and_supported_overrides_retained(self):
        for flag in ('--jira_email', '--jira_token', '--jira_tok'):
            with self.assertRaises(jira_auth.AuthError) as caught:
                server.parse_args([flag + '=do-not-echo'])
            self.assertNotIn('do-not-echo', str(caught.exception))
        args = server.parse_args(['--server_port', '9999', '--jira_url', 'https://example.atlassian.net', '--jira_query', 'synthetic'])
        self.assertEqual((args.server_port, args.jira_query), (9999, 'synthetic'))

    def test_basic_builders_and_local_principals_are_rejected(self):
        config = jira_auth.AuthConfig(auth_mode='basic', jira_url='https://example.atlassian.net', jira_email='synthetic', jira_token='synthetic')
        for call in (lambda: jira_auth.validate_auth_config(config), lambda: jira_auth.build_jira_headers(config, {}),
                     lambda: jira_auth.refresh_oauth_token(config, {}, http_post=Mock(side_effect=AssertionError("Basic refresh called"))),
                     lambda: jira_auth.build_jira_api_url(config, None, '/rest/api/3/myself'), lambda: server.build_jira_headers()):
            with self.assertRaises(jira_auth.AuthError):
                call()
        with server.app.test_request_context('/'):
            session['atlassian_oauth_session_id'] = 'poisoned'
            with self.assertRaises(jira_auth.AuthError):
                server.current_request_auth_context()

    def test_serving_factory_rejects_a_sqlite_database(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'sqlite:///synthetic-retired.db'}):  # sqlite-refusal-check
            with self.assertRaises(jira_auth.AuthError) as caught:
                server.create_serving_app()
        self.assertEqual(caught.exception.code, 'config_storage_invalid')
        self.assertIn('PostgreSQL is the only supported database', str(caught.exception))

    def test_serving_factory_validates_existing_configured_app(self):
        with patch.object(server, 'validate_startup_auth_config') as validate, patch.object(server, 'validate_network_bind') as bind:
            self.assertIs(server.create_serving_app(), server.app)
            validate.assert_called_once_with()
            bind.assert_called_once()

    def captured_context(self):
        self.seed()
        with self.client.session_transaction() as cookie:
            payload = dict(cookie['db_oauth_session'])
        return resolve_db_request_auth_context(payload)

    def test_captured_disabled_user_and_deleted_browser_never_load_tokens_or_call_jira(self):
        for mutation in ('disabled', 'browser_deleted'):
            for method in ('GET', 'PUT'):
                with self.subTest(mutation=mutation, method=method):
                    captured = self.captured_context()
                    with self.factory() as db:
                        if mutation == 'disabled':
                            db.get(models.User, captured.user_id).status = 'disabled'
                        else:
                            db.delete(db.get(models.BrowserSession, captured.browser_session_id))
                        db.commit()
                    with patch.object(server, 'db_oauth_session_data', side_effect=AssertionError('tokens reached')), \
                         patch.object(server, 'resilient_jira_get', side_effect=AssertionError('Jira reached')), \
                         patch.object(server.HTTP_SESSION, 'request', side_effect=AssertionError('Jira reached')):
                        with self.assertRaises(jira_auth.AuthError) as caught:
                            if method == 'GET':
                                server.current_jira_get('/rest/api/3/myself', context=captured)
                            else:
                                server.current_jira_request('PUT', '/rest/api/3/issue/SYN-1', context=captured,
                                                            json_body={'fields': {'summary': 'Synthetic'}})
                    self.assertEqual(caught.exception.code, 'account_disabled' if mutation == 'disabled' else 'auth_required')
                    with self.factory() as db:
                        db.get(models.User, captured.user_id).status = 'active'
                        db.commit()

    def test_valid_captured_context_works_outside_request_and_keeps_actual_tokens(self):
        captured = self.captured_context()
        response = Mock(status_code=200)
        with patch.object(server, 'resilient_jira_get', return_value=response) as provider:
            self.assertIs(server.current_jira_get('/rest/api/3/myself', context=captured), response)
        self.assertEqual(provider.call_args.kwargs['headers']['Authorization'], 'Bearer synthetic-access')

    def test_valid_legacy_db_upgrade_failure_can_still_use_tokens(self):
        self.seed(legacy=True)
        with self.client.session_transaction() as cookie:
            payload = dict(cookie['db_oauth_session'])
        with server.app.test_request_context('/'):
            session['db_oauth_session'] = payload
            with patch.object(server, 'create_browser_session', side_effect=OperationalError('synthetic', {}, Exception())):
                captured = server.current_request_auth_context()
            self.assertFalse(captured.browser_session_id)
            with patch.object(server, 'resilient_jira_get', return_value=Mock(status_code=200)) as provider:
                server.current_jira_get('/rest/api/3/myself', context=captured)
            provider.assert_called_once()
            with self.factory() as db:
                db.get(models.AuthConnection, captured.auth_connection_id).token_version += 1
                db.commit()
            with patch.object(server, 'resilient_jira_get', side_effect=AssertionError('stale legacy Jira reached')):
                with self.assertRaises(jira_auth.AuthError) as caught:
                    server.current_jira_get('/rest/api/3/myself', context=captured)
            self.assertEqual(caught.exception.code, 'auth_connection_stale')

    def test_browserless_unbound_or_forged_context_has_no_legacy_bypass(self):
        original = self.captured_context()
        captured = replace(original, browser_session_id='')
        for cookie in (None, {}, {'db_browser_session_id': original.browser_session_id},
                       {'db_auth_connection_id': 'forged', 'db_token_version': captured.token_version}):
            with self.subTest(cookie=cookie), ExitStack() as stack:
                if cookie is not None:
                    stack.enter_context(server.app.test_request_context('/'))
                    session['db_oauth_session'] = cookie
                stack.enter_context(patch.object(server, 'db_oauth_session_data', side_effect=AssertionError('tokens reached')))
                with self.assertRaises(jira_auth.AuthError) as caught:
                    server.current_jira_get('/rest/api/3/myself', context=captured)
                self.assertEqual(caught.exception.code, 'auth_required')

    def test_token_revalidation_and_loading_share_one_db_session(self):
        captured = self.captured_context()
        with patch.object(server, 'revalidate_db_request_auth_context', wraps=server.revalidate_db_request_auth_context) as validate, \
             patch.object(server, 'db_oauth_session_data', wraps=server.db_oauth_session_data) as load:
            self.assertEqual(server.current_jira_session_data(captured)['access_token'], 'synthetic-access')
        self.assertIs(validate.call_args.kwargs['db_session'], load.call_args.args[0])

    def test_revalidation_refreshes_an_existing_session_identity_map(self):
        captured = self.captured_context()
        with self.factory() as current:
            cached = current.get(models.User, captured.user_id)
            self.assertEqual(cached.status, 'active')
            with self.factory() as writer:
                writer.get(models.User, captured.user_id).status = 'disabled'
                writer.commit()
            with self.assertRaises(jira_auth.AuthError) as caught:
                server.revalidate_db_request_auth_context(captured, db_session=current)
            self.assertEqual(caught.exception.code, 'account_disabled')

    def test_missing_or_invalid_encryption_rejects_factory_and_cli_without_serving(self):
        invalid = (
            {'TOKEN_ENCRYPTION_MASTER_KEY_B64': '', 'TOKEN_ENCRYPTION_KEY_ID': ''},
            {'TOKEN_ENCRYPTION_MASTER_KEY_B64': 'synthetic-invalid-private-value'},
            {'TOKEN_ENCRYPTION_RETIRED_KEY_IDS': 'retired-one', 'TOKEN_ENCRYPTION_RETIRED_KEYS_B64': ''},
            {'APP_ENVIRONMENT_KEY': 'production', 'TOKEN_ENCRYPTION_KEY_SOURCE': ''},
        )
        for values in invalid:
            with self.subTest(values=tuple(values)), patch.dict(os.environ, values), \
                 patch.object(server, 'validate_config_storage_startup'), \
                 patch.object(server.app, 'run', side_effect=AssertionError('server reached')) as run:
                with self.assertRaises(jira_auth.AuthError) as caught:
                    server.create_serving_app()
                self.assertEqual(caught.exception.code, 'token_encryption_invalid')
                self.assertEqual(caught.exception.message, 'Token encryption configuration is invalid.')
                with patch.object(server, 'parse_args', return_value=SimpleNamespace(jira_url=None, jira_query=None, server_port=None)):
                    with self.assertLogs(server.logger.name, level='INFO') as logs:
                        self.assertEqual(server.main(), 1)
                self.assertNotIn('synthetic-invalid-private-value', str(logs.output))
                run.assert_not_called()

    def test_serving_preserves_local_derived_key_and_hosted_explicit_retired_keyring(self):
        retired_key = base64.b64encode(bytes([23]) * 32).decode()
        old_provider = key_provider_from_env({'APP_ENVIRONMENT_KEY': 'production',
            'TOKEN_ENCRYPTION_KEY_SOURCE': 'env', 'TOKEN_ENCRYPTION_MASTER_KEY_B64': retired_key,
            'TOKEN_ENCRYPTION_KEY_ID': 'retired-one'})
        old_wrapped = old_provider.wrap_key(bytes([17]) * 32, b'synthetic-serving-check')
        cases = (
            {'APP_ENVIRONMENT_KEY': 'local', 'TOKEN_ENCRYPTION_KEY_ID': '', 'TOKEN_ENCRYPTION_KEY_SOURCE': ''},
            {'APP_ENVIRONMENT_KEY': 'production', 'TOKEN_ENCRYPTION_KEY_SOURCE': 'env',
             'TOKEN_ENCRYPTION_RETIRED_KEY_IDS': 'retired-one', 'TOKEN_ENCRYPTION_RETIRED_KEYS_B64': retired_key},
        )
        for values in cases:
            with self.subTest(environment=values['APP_ENVIRONMENT_KEY']), patch.dict(os.environ, values), \
                 patch.object(server, 'validate_config_storage_startup'):
                provider = key_provider_from_env()
                payload = bytes([17]) * 32
                wrapped = provider.wrap_key(payload, b'synthetic-serving-check')
                self.assertIs(server.create_serving_app(), server.app)
                self.assertEqual(provider.unwrap_key(wrapped, b'synthetic-serving-check'), payload)
                if values['APP_ENVIRONMENT_KEY'] == 'production':
                    self.assertEqual(key_provider_from_env().unwrap_key(old_wrapped, b'synthetic-serving-check'), payload)

    def test_serving_matches_preflight_hosted_local_store_optin_rejection(self):
        from scripts import check_startup_preflight as preflight
        cases = (('local', '127.0.0.1', True), ('dev', 'localhost', True),
                 ('local', '0.0.0.0', False), ('production', '127.0.0.1', False),
                 ('production', '0.0.0.0', False))
        for environment, host, allowed in cases:
            values = {'JIRA_AUTH_MODE': 'atlassian_oauth', 'CONFIG_STORAGE_BACKEND': 'db',
                      'APP_ENVIRONMENT_KEY': environment, 'APP_BIND_HOST': host,
                      'OAUTH_LOCAL_TOKEN_STORE_ALLOWED': 'true', 'TOKEN_ENCRYPTION_KEY_SOURCE': 'env',
                      'ALLOW_NETWORK_BIND': 'true', 'SESSION_COOKIE_SECURE': 'true',
                      'APP_ALLOWED_ORIGINS': 'https://synthetic.example.invalid'}
            with self.subTest(environment=environment, host=host), patch.dict(os.environ, values), \
                 patch.object(server, 'validate_config_storage_startup'), \
                 patch.object(server.app, 'run', side_effect=AssertionError('server reached')) as run:
                if allowed:
                    preflight._check_oauth_local_token_store(values)
                    self.assertIs(server.create_serving_app(), server.app)
                else:
                    with self.assertRaises(preflight.PreflightError):
                        preflight._check_oauth_local_token_store(values)
                    with self.assertRaises(jira_auth.AuthError) as caught:
                        server.create_serving_app()
                    self.assertEqual(caught.exception.code, 'local_token_store_not_allowed')
                    self.assertEqual(caught.exception.message, 'DB/OAuth hosted mode must not enable local token storage.')
                    with patch.object(server, 'parse_args', return_value=SimpleNamespace(jira_url=None, jira_query=None, server_port=None)):
                        with self.assertLogs(server.logger.name, level='INFO'):
                            self.assertEqual(server.main(), 1)
                    run.assert_not_called()

    def test_home_wrappers_reject_retired_profiles_and_preserve_scope_recovery(self):
        context = SimpleNamespace(auth_mode='atlassian_oauth', auth_connection_id='synthetic-db',
                                  user_id='synthetic-user')
        for profile, code in ((epm_home.HOME_READ_PROFILE_LEGACY, 'epm_view_disabled'),
                              (epm_home.HOME_READ_PROFILE_SCOPE_REQUIRED, 'epm_scope_required')):
            auth = epm_home.HomeReadAuth(profile, context,
                revalidate=Mock(side_effect=AssertionError('non-serving profile revalidated')),
                load_session=Mock(side_effect=AssertionError('non-serving profile loaded tokens')))
            with patch.object(epm_home, 'urlopen', side_effect=AssertionError('Home network fallback called')), \
                 patch.object(epm_home, '_read_metadata_credential', create=True,
                              side_effect=AssertionError('retired credential fallback called')), \
                 patch.object(epm_home, 'build_home_graphql_client', create=True,
                              side_effect=AssertionError('retired Basic factory called')):
                for wrapper in (server.fetch_home_site_cloud_id, server._build_epm_home_graphql_client):
                    with self.subTest(profile=profile, wrapper=wrapper.__name__), self.assertRaises(jira_auth.AuthError) as caught:
                        wrapper(context, home_auth=auth)
                    self.assertEqual(caught.exception.code, code)
        for wrapper in (server.fetch_home_site_cloud_id, server._build_epm_home_graphql_client):
            with self.subTest(wrapper=wrapper.__name__), self.assertRaises(jira_auth.AuthError) as caught:
                wrapper()
            self.assertEqual(caught.exception.code, 'epm_view_disabled')
