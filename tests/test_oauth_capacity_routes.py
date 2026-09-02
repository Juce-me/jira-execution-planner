import os
import unittest
from contextlib import ExitStack
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.config.repository import ConfigStorageError
from backend.db.engine import DatabaseConfigurationError
from backend.routes import capacity_routes
from backend.services.capacity import CapacityInputError, CapacityServiceError
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


def verified_context(*, scopes=None, connection_id='local-oauth-connection:session-1', is_admin=False):
    return RequestAuthContext(
        auth_mode='atlassian_oauth',
        user_id='synthetic-user',
        stable_subject='synthetic-subject',
        atlassian_account_id='synthetic-account',
        workspace_id='synthetic-workspace',
        auth_connection_id=connection_id,
        cloud_id='synthetic-cloud',
        site_url='https://example.atlassian.net',
        token_version='1',
        account_status='active',
        is_admin=is_admin,
        granted_scopes=tuple((scopes or FULL_OAUTH_SCOPE).split()),
        granted_scopes_verified=True,
    )


class OAuthCapacityRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.env = patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'jsonfile',
            'DATABASE_URL': '',
            'TEST_DATABASE_URL': '',
            'APP_ENVIRONMENT_KEY': 'local',
        }, clear=False)
        self.env.start()
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.env.stop()

    def _oauth_mode(self):
        return patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth')

    def _csrf_token(self):
        with self._oauth_mode():
            response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()['csrfToken']

    def _patch(self, payload=None, *, headers=None, environ_base=None):
        kwargs = {}
        if environ_base is not None:
            kwargs['environ_base'] = environ_base
        return self.client.patch(
            '/api/capacity/CAP-101',
            json=payload if payload is not None else {
                'sprintName': '2026Q2',
                'teamName': 'Alpha',
                'expectedCapacity': 5.5,
                'capacity': 6,
            },
            headers=headers or {},
            **kwargs,
        )

    def _authorized_headers(self):
        return {
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': self._csrf_token(),
        }

    def test_anonymous_oauth_is_rejected_before_route_code(self):
        with self._oauth_mode(), \
             patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=AssertionError('route code reached')):
            response = self._patch(headers={'X-Requested-With': 'jira-execution-planner'})

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        })

    def test_missing_x_requested_with_is_rejected_before_route_code(self):
        install_oauth_session(self.client)
        with self._oauth_mode(), \
             patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=AssertionError('route code reached')):
            response = self._patch()

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'csrf_required',
            'message': 'Unsafe OAuth requests require X-Requested-With: jira-execution-planner',
        })

    def test_missing_invalid_and_consumed_csrf_are_rejected_before_route_code(self):
        install_oauth_session(self.client)
        valid_token = self._csrf_token()
        cases = [None, 'invalid-token', valid_token, valid_token]
        for index, token in enumerate(cases):
            headers = {'X-Requested-With': 'jira-execution-planner'}
            if token:
                headers['X-CSRF-Token'] = token
            with self.subTest(index=index), self._oauth_mode(), \
                 patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=AssertionError('route code reached')):
                response = self._patch(headers=headers)
            if index == 2:
                self.assertNotEqual(response.status_code, 403, response.get_data(as_text=True))
                continue
            self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), {
                'error': 'csrf_required',
                'message': 'A valid CSRF token is required for this request.',
            })

    def test_non_loopback_basic_is_hidden(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            response = self._patch(environ_base={'REMOTE_ADDR': '198.51.100.20'})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json(), {'error': 'not_found'})

    def test_loopback_basic_rejects_valid_and_malformed_body_before_parsing(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=AssertionError('route code reached')):
            valid = self._patch()
            malformed = self.client.patch(
                '/api/capacity/CAP-101',
                data='{',
                content_type='application/json',
            )
        self.assertEqual(valid.status_code, 403)
        self.assertEqual(valid.get_json(), {'error': 'jira_oauth_required'})
        self.assertEqual(malformed.status_code, 403)
        self.assertEqual(malformed.get_json(), {'error': 'jira_oauth_required'})

    def test_signed_in_non_admin_uses_context_config_and_jira_request(self):
        install_oauth_session(self.client)
        context = verified_context(is_admin=False)
        captured = {'jira': []}

        def jira_request(method, path, **kwargs):
            captured['jira'].append((method, path, kwargs))
            if method == 'GET':
                return FakeResponse(200, {'fields': {
                    'project': {'key': 'CAP'},
                    'summary': 'Team info 2026Q2 - Alpha',
                    'customfield_12345': 5.5,
                }})
            return FakeResponse(204)

        forbidden_helpers = (
            'build_jira_headers',
            'resolve_capacity_field_id',
            'fetch_epm_home_projects',
            'db_oauth_session_data',
            'save_oauth_session_for_auth_context',
        )
        with ExitStack() as stack:
            stack.enter_context(self._oauth_mode())
            stack.enter_context(patch.object(
                jira_server,
                'current_request_auth_context',
                return_value=context,
            ))
            config_loader = stack.enter_context(patch.object(
                jira_server,
                'load_request_capacity_config',
                return_value={
                    'project': 'CAP', 'fieldId': 'customfield_12345',
                    'requiresResolution': False, 'mutationEnabled': True,
                },
            ))
            stack.enter_context(patch.object(
                jira_server,
                'current_jira_request',
                side_effect=jira_request,
            ))
            for helper_name in forbidden_helpers:
                stack.enter_context(patch.object(
                    jira_server,
                    helper_name,
                    side_effect=AssertionError(f'forbidden helper reached: {helper_name}'),
                ))
            response = self._patch(headers=self._authorized_headers())

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'issueKey': 'CAP-101', 'teamName': 'Alpha', 'previousCapacity': 5.5,
            'capacity': 6.0, 'result': 'success',
        })
        config_loader.assert_called_once_with(context)
        self.assertEqual([call[0] for call in captured['jira']], ['GET', 'PUT'])
        self.assertTrue(all(call[2]['context'] is context for call in captured['jira']))
        self.assertEqual(captured['jira'][1][2]['json_body'], {'fields': {'customfield_12345': 6.0}})

    def test_already_current_response_is_preserved(self):
        install_oauth_session(self.client)
        context = verified_context()

        def jira_request(method, _path, **_kwargs):
            self.assertEqual(method, 'GET')
            return FakeResponse(200, {'fields': {
                'project': {'key': 'CAP'},
                'summary': 'Team info 2026Q2 - Alpha',
                'customfield_12345': 6,
            }})

        with self._oauth_mode(), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'load_request_capacity_config', return_value={
                 'project': 'CAP', 'fieldId': 'customfield_12345',
                 'requiresResolution': False, 'mutationEnabled': True,
             }), \
             patch.object(jira_server, 'current_jira_request', side_effect=jira_request):
            response = self._patch(headers=self._authorized_headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['result'], 'already_current')

    def test_route_and_service_succeed_with_all_forbidden_route_dependencies_disabled(self):
        context = verified_context()
        captured = []

        def jira_request(method, path, **kwargs):
            captured.append((method, path, kwargs))
            if method == 'GET':
                return FakeResponse(200, {'fields': {
                    'project': {'key': 'CAP'},
                    'summary': 'Team info 2026Q2 - Alpha',
                    'customfield_12345': 5.5,
                }})
            return FakeResponse(204)

        forbidden_names = (
            'build_jira_headers',
            'resolve_capacity_field_id',
            'resolve_user_api_token_connection',
            'resolve_home_credential',
            'resolve_home_credentials',
            'get_service_integration_summary',
            'list_service_integration_summaries',
            'fetch_epm_home_projects',
            'oauth_session_data',
            'db_oauth_session_data',
            'save_oauth_session',
            'oauth_refresh_lock',
        )
        with jira_server.app.test_request_context(
            '/api/capacity/CAP-101',
            method='PATCH',
            json={
                'sprintName': '2026Q2',
                'teamName': 'Alpha',
                'expectedCapacity': 5.5,
                'capacity': 6,
            },
        ):
            capacity_routes._sync_server_globals()
            with ExitStack() as stack:
                stack.enter_context(patch.object(
                    capacity_routes,
                    'JIRA_AUTH_MODE',
                    'atlassian_oauth',
                ))
                stack.enter_context(patch.object(
                    capacity_routes,
                    'current_request_auth_context',
                    return_value=context,
                ))
                stack.enter_context(patch.object(
                    capacity_routes,
                    'load_request_capacity_config',
                    return_value={
                        'project': 'CAP', 'fieldId': 'customfield_12345',
                        'requiresResolution': False, 'mutationEnabled': True,
                    },
                ))
                stack.enter_context(patch.object(
                    capacity_routes,
                    'current_jira_request',
                    side_effect=jira_request,
                ))
                for name in forbidden_names:
                    stack.enter_context(patch.object(
                        capacity_routes,
                        name,
                        create=True,
                        side_effect=AssertionError(f'forbidden dependency reached: {name}'),
                    ))
                stack.enter_context(patch.object(
                    capacity_routes,
                    'OAUTH_TOKEN_STORE',
                    object(),
                    create=True,
                ))
                response = capacity_routes.patch_capacity('CAP-101')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['result'], 'success')
        self.assertEqual([call[0] for call in captured], ['GET', 'PUT'])
        self.assertTrue(all(call[2]['context'] is context for call in captured))

    def test_route_unconditionally_requires_provider_verified_write_scope(self):
        read_scopes = 'read:me read:jira-work'
        install_oauth_session(self.client, scope=read_scopes, scope_provenance='provider')
        with self._oauth_mode(), \
             patch.object(jira_server, 'ATLASSIAN_SCOPES', read_scopes), \
             patch.object(jira_server, 'load_request_capacity_config', side_effect=AssertionError('config reached')), \
             patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('Jira reached')):
            response = self._patch(headers=self._authorized_headers())
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'missing_oauth_scope',
            'message': 'Your Jira sign-in needs updated permissions.',
            'recoveryUrl': '/login?reason=missing_scope',
        })

    def test_db_context_unconditionally_requires_provider_verified_write_scope(self):
        read_scopes = 'read:me read:jira-work'
        install_oauth_session(self.client, scope=read_scopes, scope_provenance='provider')
        context = verified_context(scopes=read_scopes, connection_id='db-connection-1')
        with self._oauth_mode(), \
             patch.object(jira_server, 'ATLASSIAN_SCOPES', read_scopes), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'load_request_capacity_config', side_effect=AssertionError('config reached')), \
             patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('Jira reached')):
            response = self._patch(headers=self._authorized_headers())
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'missing_oauth_scope',
            'message': 'Your Jira sign-in needs updated permissions.',
            'recoveryUrl': '/login?reason=missing_scope',
        })

    def test_db_context_with_unknown_scope_provenance_requires_reauthentication(self):
        install_oauth_session(self.client)
        context = verified_context(connection_id='db-connection-1')
        context = RequestAuthContext(
            **{
                **context.__dict__,
                'granted_scopes_verified': False,
            },
        )
        with self._oauth_mode(), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'load_request_capacity_config', side_effect=AssertionError('config reached')), \
             patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('Jira reached')):
            response = self._patch(headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'auth_required',
            'loginUrl': '/login?reason=missing_scope',
        })

    def test_global_guard_rejects_provider_verified_missing_configured_scope(self):
        read_scopes = 'read:me read:jira-work'
        install_oauth_session(self.client, scope=read_scopes, scope_provenance='provider')
        with self._oauth_mode(), \
             patch.object(jira_server, 'load_request_capacity_config', side_effect=AssertionError('config reached')):
            response = self._patch(headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {
            'error': 'auth_required',
            'loginUrl': '/login?reason=missing_scope',
        })

    def test_global_guard_rejects_db_context_missing_configured_write_scope(self):
        read_scopes = 'read:me read:jira-work'
        install_oauth_session(self.client, scope=read_scopes, scope_provenance='provider')
        context = verified_context(scopes=read_scopes, connection_id='db-connection-1')
        with self._oauth_mode(), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'load_request_capacity_config', side_effect=AssertionError('config reached')):
            response = self._patch(headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {
            'error': 'auth_required',
            'loginUrl': '/login?reason=missing_scope',
        })

    def test_global_guard_rejects_requested_only_local_scope_provenance(self):
        install_oauth_session(self.client, scope=FULL_OAUTH_SCOPE, scope_provenance='unknown')
        with self._oauth_mode(), \
             patch.object(jira_server, 'load_request_capacity_config', side_effect=AssertionError('config reached')):
            response = self._patch(headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['loginUrl'], '/login?reason=missing_scope')

    def test_config_preconditions_stop_before_service_and_field_catalog(self):
        install_oauth_session(self.client)
        context = verified_context()
        cases = [
            ({'project': 'CAP', 'fieldId': '', 'requiresResolution': False, 'mutationEnabled': False}, 'capacity_config_missing'),
            ({'project': 'CAP', 'fieldId': 'customfield_12345', 'requiresResolution': True, 'mutationEnabled': False}, 'capacity_config_conflict'),
            ({'project': 'CAP', 'fieldId': 'customfield_12345', 'requiresResolution': False, 'mutationEnabled': False}, 'capacity_config_unverified'),
        ]
        for config, expected_error in cases:
            with self.subTest(expected_error=expected_error), self._oauth_mode(), \
                 patch.object(jira_server, 'current_request_auth_context', return_value=context), \
                 patch.object(jira_server, 'load_request_capacity_config', return_value=config), \
                 patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('Jira reached')), \
                 patch.object(jira_server, 'get_fields', create=True, side_effect=AssertionError('field catalog reached')), \
                 patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=AssertionError('service reached')):
                response = self._patch(headers=self._authorized_headers())
            self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), {'error': expected_error})

    def test_invalid_json_and_unsupported_fields_are_fixed_errors(self):
        install_oauth_session(self.client)
        with self._oauth_mode():
            malformed = self.client.patch(
                '/api/capacity/CAP-101',
                data='{',
                content_type='application/json',
                headers=self._authorized_headers(),
            )
            unsupported = self._patch(
                payload={'sprintName': '2026Q2', 'teamName': 'Alpha', 'expectedCapacity': 5.5, 'capacity': 6, 'project': 'OTHER'},
                headers=self._authorized_headers(),
            )
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(malformed.get_json(), {'error': 'invalid_json'})
        self.assertEqual(unsupported.status_code, 400)
        self.assertEqual(unsupported.get_json(), {'error': 'unsupported_capacity_field'})

    def test_input_errors_are_fixed(self):
        install_oauth_session(self.client)
        context = verified_context()
        with self._oauth_mode(), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'load_request_capacity_config', return_value={
                 'project': 'CAP', 'fieldId': 'customfield_12345',
                 'requiresResolution': False, 'mutationEnabled': True,
             }), \
             patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=CapacityInputError('invalid_capacity')):
            response = self._patch(headers=self._authorized_headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'error': 'invalid_capacity'})

    def test_service_error_matrix_and_conflict_payload_are_allowlisted(self):
        install_oauth_session(self.client)
        context = verified_context()
        cases = {
            'capacity_forbidden': 403,
            'capacity_issue_not_found': 404,
            'capacity_config_missing': 409,
            'capacity_config_unverified': 409,
            'capacity_config_conflict': 409,
            'capacity_issue_mismatch': 409,
            'capacity_conflict': 409,
            'capacity_field_not_editable': 409,
            'jira_capacity_update_conflict': 502,
            'jira_capacity_update_failed': 502,
            'secret-upstream-detail': 502,
        }
        for code, expected_status in cases.items():
            error = CapacityServiceError(code, 418, current_capacity=7 if code == 'capacity_conflict' else 99)
            with self.subTest(code=code), self._oauth_mode(), \
                 patch.object(jira_server, 'current_request_auth_context', return_value=context), \
                 patch.object(jira_server, 'load_request_capacity_config', return_value={
                     'project': 'CAP', 'fieldId': 'customfield_12345',
                     'requiresResolution': False, 'mutationEnabled': True,
                 }), \
                 patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=error):
                response = self._patch(headers=self._authorized_headers())
            self.assertEqual(response.status_code, expected_status, response.get_data(as_text=True))
            expected_code = code if code in cases and code != 'secret-upstream-detail' else 'jira_capacity_update_failed'
            body = response.get_json()
            self.assertEqual(body['error'], expected_code)
            self.assertEqual(set(body), {'error', 'currentCapacity'} if code == 'capacity_conflict' else {'error'})
            if code == 'capacity_conflict':
                self.assertEqual(body['currentCapacity'], 7)

    def test_auth_errors_preserve_only_fixed_recovery_fields(self):
        install_oauth_session(self.client)
        context = verified_context()
        cases = {
            'auth_required': ('/login?reason=session_expired', None),
            'account_disabled': (None, '/auth/account-disabled'),
            'auth_connection_revoked': (None, '/auth/reconnect'),
            'auth_connection_stale': (None, '/auth/reconnect'),
            'missing_project_access': (None, '/auth/missing-project-access'),
        }
        for code, (login_url, recovery_url) in cases.items():
            install_oauth_session(self.client)
            error = jira_server.AuthError(code, 'Fixed safe message')
            with self.subTest(code=code), self._oauth_mode(), \
                 patch.object(jira_server, 'current_request_auth_context', return_value=context), \
                 patch.object(jira_server, 'load_request_capacity_config', return_value={
                     'project': 'CAP', 'fieldId': 'customfield_12345',
                     'requiresResolution': False, 'mutationEnabled': True,
                 }), \
                 patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=error):
                response = self._patch(headers=self._authorized_headers())
            self.assertEqual(response.status_code, 401)
            body = response.get_json()
            self.assertEqual(body['error'], code)
            if login_url:
                self.assertEqual(body['loginUrl'], login_url)
            if recovery_url:
                self.assertEqual(body['recoveryUrl'], recovery_url)

    def test_real_service_propagates_jira_auth_failures_from_get_and_put_to_recovery(self):
        context = verified_context()
        cases = (
            ('GET', jira_server.AuthError('auth_required', 'Synthetic expired session'), 'auth_required', 'loginUrl', '/login?reason=session_expired'),
            ('PUT', jira_server.AuthError('auth_connection_stale', 'Reconnect required.'), 'auth_connection_stale', 'recoveryUrl', '/auth/reconnect'),
            ('PUT', FakeResponse(401, {'detail': 'synthetic-secret-upstream'}), 'auth_required', 'loginUrl', '/login?reason=session_expired'),
        )
        for failing_method, failure, error_code, recovery_field, recovery_url in cases:
            install_oauth_session(self.client)

            def jira_request(method, _path, **_kwargs):
                if method == failing_method:
                    if isinstance(failure, Exception):
                        raise failure
                    return failure
                return FakeResponse(200, {'fields': {
                    'project': {'key': 'CAP'},
                    'summary': 'Team info 2026Q2 - Alpha',
                    'customfield_12345': 5.5,
                }})

            with self.subTest(failing_method=failing_method, error_code=error_code), self._oauth_mode(), \
                 patch.object(jira_server, 'current_request_auth_context', return_value=context), \
                 patch.object(jira_server, 'load_request_capacity_config', return_value={
                     'project': 'CAP', 'fieldId': 'customfield_12345',
                     'requiresResolution': False, 'mutationEnabled': True,
                 }), \
                 patch.object(jira_server, 'current_jira_request', side_effect=jira_request):
                response = self._patch(headers=self._authorized_headers())

            self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['error'], error_code)
            self.assertEqual(response.get_json()[recovery_field], recovery_url)
            self.assertNotIn('secret', response.get_data(as_text=True))

    def test_storage_failures_are_fixed_and_do_not_leak(self):
        install_oauth_session(self.client)
        context = verified_context()
        for error in (
            ConfigStorageError('secret storage DSN'),
            DatabaseConfigurationError('secret database password'),
        ):
            with self.subTest(error=type(error).__name__), self._oauth_mode(), \
                 patch.object(jira_server, 'current_request_auth_context', return_value=context), \
                 patch.object(jira_server, 'load_request_capacity_config', side_effect=error):
                response = self._patch(headers=self._authorized_headers())
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.get_json(), {
                'error': 'config_storage_unavailable',
                'message': 'Configuration storage is temporarily unavailable.',
            })
            self.assertNotIn('secret', response.get_data(as_text=True))

    def test_generic_failures_expose_only_fixed_upstream_error(self):
        install_oauth_session(self.client)
        context = verified_context()
        with self.assertLogs('jira_server', level='ERROR') as logs:
            with self._oauth_mode(), \
                 patch.object(jira_server, 'current_request_auth_context', return_value=context), \
                 patch.object(jira_server, 'load_request_capacity_config', return_value={
                     'project': 'CAP', 'fieldId': 'customfield_12345',
                     'requiresResolution': False, 'mutationEnabled': True,
                 }), \
                 patch.object(capacity_routes, 'update_capacity_issue', create=True, side_effect=RuntimeError('secret Jira response')):
                response = self._patch(headers=self._authorized_headers())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json(), {'error': 'jira_capacity_update_failed'})
        self.assertNotIn('secret', response.get_data(as_text=True))
        self.assertNotIn('secret', '\n'.join(logs.output))


class BasicCapacityRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()

    def test_loopback_basic_never_reaches_jira_or_config(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'load_request_capacity_config', side_effect=AssertionError('config reached')), \
             patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('Jira reached')):
            response = self.client.patch('/api/capacity/CAP-101', json={})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json(), {'error': 'jira_oauth_required'})
