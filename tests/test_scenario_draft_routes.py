import os
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from flask import jsonify, request

from backend.auth.context import RequestAuthContext
from backend.auth.csrf import issue_csrf_token
from backend.db import engine as db_engine
from backend.db import models
from backend.scenario_drafts import acquire_lock, append_event, save_draft
import jira_server


FULL_SCOPE = (
    'read:me read:jira-work write:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


class ScenarioDraftRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'scenario-draft-routes.db')}"
        self._env_patcher = patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }, clear=False)
        self._env_patcher.start()
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.connection_id = self._seed_user('account-1')
        self.other_workspace_id, self.other_user_id, self.other_connection_id = self._seed_user('account-2', site='https://other.atlassian.net', cloud='cloud-2')
        self.context = self._context(self.workspace_id, self.user_id, self.connection_id, account_id='account-1')
        self.other_context = self._context(self.other_workspace_id, self.other_user_id, self.other_connection_id, account_id='account-2', site='https://other.atlassian.net', cloud='cloud-2')
        self._install_session('session-1', 'account-1', self.connection_id)

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._env_patcher.stop()
        self._tmpdir.cleanup()

    def _seed_user(self, account_id, *, site='https://example.atlassian.net', cloud='cloud-1'):
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name=f'Workspace {account_id}',
                jira_site_url=site,
                jira_cloud_id=cloud,
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, user])
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url=site,
                cloud_id=cloud,
                scopes=FULL_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            return workspace.id, user.id, connection.id

    def _context(self, workspace_id, user_id, connection_id, *, account_id='account-1', site='https://example.atlassian.net', cloud='cloud-1'):
        return RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id=user_id,
            stable_subject=account_id,
            atlassian_account_id=account_id,
            workspace_id=workspace_id,
            auth_connection_id=connection_id,
            cloud_id=cloud,
            site_url=site,
            token_version='1',
            account_status='active',
            is_admin=True,
        )

    def _install_session(self, session_id, account_id, connection_id):
        with self.client.session_transaction() as flask_session:
            flask_session['atlassian_oauth_session_id'] = session_id
            flask_session['db_oauth_session'] = {'db_auth_connection_id': connection_id}
        jira_server.OAUTH_TOKEN_STORE[session_id] = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 3600,
            'scope': FULL_SCOPE,
            'cloudid': 'cloud-1',
            'site_url': 'https://example.atlassian.net',
            'account_id': account_id,
            'account_status': 'active',
            'db_auth_connection_id': connection_id,
            'db_token_version': '1',
            'stored_at': time.time(),
        }

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }, clear=False)

    def _csrf_headers(self, context=None):
        return {
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': self._csrf_token(context),
        }

    def _csrf_token(self, context=None):
        context = context or self.context
        data = {
            'db_auth_connection_id': context.auth_connection_id,
            'db_token_version': context.token_version,
            'account_id': context.atlassian_account_id,
        }
        with self.client.session_transaction() as flask_session:
            return issue_csrf_token(flask_session, data)

    def _route_patch(self, context=None):
        return patch.object(jira_server, 'scenario_draft_request_auth_context', return_value=context or self.context)

    def test_get_active_draft_requires_scope_key(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.get('/api/scenario/drafts')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'scope_key_required')

    def test_get_active_draft_requires_auth_context(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'scenario_draft_request_auth_context', side_effect=jira_server.AuthError('auth_required', 'Atlassian authentication is required.')):
            response = self.client.get('/api/scenario/drafts?scope_key=scope-1')

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')

    def test_get_active_draft_imports_legacy_json_only_for_single_workspace(self):
        with self.factory() as session:
            session.query(models.AuthConnection).delete()
            session.query(models.User).delete()
            session.query(models.Workspace).delete()
            workspace = models.Workspace(environment_key='local', name='Only', jira_site_url='https://example.atlassian.net', jira_cloud_id='cloud-1', created_by='test')
            user = models.User(external_provider='atlassian', external_subject='account-only', account_type='user', status='active', created_by='test')
            session.add_all([workspace, user])
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url=workspace.jira_site_url,
                cloud_id=workspace.jira_cloud_id,
                scopes=FULL_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            self.context = self._context(workspace.id, user.id, connection.id)
        self._install_session('session-only', 'account-only', self.context.auth_connection_id)

        legacy = {'version': 1, 'scenarios': {'scope-legacy': {'name': 'Legacy', 'overrides': {'ENG-1': {'start': '2026-05-18'}}}}}
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             self._route_patch(self.context), patch.object(jira_server, 'load_scenario_overrides', return_value=legacy):
            response = self.client.get('/api/scenario/drafts?scope_key=scope-legacy')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['activeDraft']['name'], 'Legacy')
        self.assertEqual(response.get_json()['versions'][0]['source'], 'legacy_json')

    def test_get_active_draft_skips_legacy_import_for_ambiguous_workspace(self):
        legacy = {'version': 1, 'scenarios': {'scope-legacy': {'name': 'Legacy', 'overrides': {'ENG-1': {'start': '2026-05-18'}}}}}
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             self._route_patch(), patch.object(jira_server, 'load_scenario_overrides', return_value=legacy) as loader:
            response = self.client.get('/api/scenario/drafts?scope_key=scope-legacy')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIsNone(response.get_json()['activeDraft'])
        loader.assert_not_called()

    def test_get_active_draft_stateless_mode_skips_legacy_import(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'local_file_state_enabled', return_value=False), \
             self._route_patch(self.context), \
             patch.object(jira_server, 'load_scenario_overrides', side_effect=AssertionError('legacy loader must not run')):
            response = self.client.get('/api/scenario/drafts?scope_key=scope-stateless')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIsNone(response.get_json()['activeDraft'])

    def test_post_create_first_draft_allows_null_base_revision(self):
        payload = {'scope_key': 'scope-create', 'name': 'Create', 'overrides': {'ENG-1': {'start': '2026-05-18'}}, 'baseDraftRevision': None, 'scope': {'groupId': 'platform'}}
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post('/api/scenario/drafts', json=payload, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['activeDraft']['draftRevision'], 1)
        self.assertNotIn('revision', response.get_json()['activeDraft'])

    def test_post_update_requires_base_draft_revision(self):
        save_draft(self.context, 'scope-update', 'Update', {'ENG-1': {'start': '2026-05-18'}})
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post('/api/scenario/drafts', json={'scope_key': 'scope-update', 'name': 'Update 2', 'overrides': {}}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['error'], 'scenario_draft_conflict')

    def test_post_stale_base_returns_canonical_conflict(self):
        save_draft(self.context, 'scope-stale', 'Stale', {})
        save_draft(self.context, 'scope-stale', 'Stale 2', {}, base_draft_revision=1)
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post('/api/scenario/drafts', json={'scope_key': 'scope-stale', 'name': 'Stale 3', 'overrides': {}, 'baseDraftRevision': 1}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 409)
        body = response.get_json()
        self.assertEqual(body['error'], 'scenario_draft_conflict')
        self.assertEqual(body['conflict'], {
            'reason': 'stale_base_draft_revision',
            'receivedBaseDraftRevision': 1,
            'currentDraftRevision': 2,
            'currentVersionNumber': 2,
        })
        self.assertEqual(body['activeDraft']['draftRevision'], 2)
        self.assertEqual(body['storage'], 'db')
        self.assertNotIn('reason', body)
        self.assertNotIn('receivedBaseDraftRevision', body)
        self.assertNotIn('currentDraftRevision', body)
        self.assertNotIn('currentVersionNumber', body)

    def test_post_rejects_membership_scope_payload(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post('/api/scenario/drafts', json={'scope_key': 'scope-members', 'name': 'Members', 'overrides': {}, 'scope': {'members': ['acct-1']}}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'scenario_scope_membership_not_allowed')

    def test_post_requires_token_bound_csrf(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            missing_header = self.client.post('/api/scenario/drafts', json={'scope_key': 'scope-csrf', 'name': 'CSRF', 'overrides': {}})
            missing_token = self.client.post('/api/scenario/drafts', headers={'X-Requested-With': 'jira-execution-planner'}, json={'scope_key': 'scope-csrf', 'name': 'CSRF', 'overrides': {}})
            token_without_header = self.client.post('/api/scenario/drafts', headers={'X-CSRF-Token': self._csrf_token()}, json={'scope_key': 'scope-csrf', 'name': 'CSRF', 'overrides': {}})

        self.assertEqual(missing_header.status_code, 403)
        self.assertEqual(missing_header.get_json()['error'], 'csrf_required')
        self.assertEqual(missing_token.status_code, 403)
        self.assertEqual(missing_token.get_json()['error'], 'csrf_required')
        self.assertEqual(token_without_header.status_code, 403)
        self.assertEqual(token_without_header.get_json()['error'], 'csrf_required')

    def test_auth_csrf_token_supports_db_bound_scenario_draft_post(self):
        jira_server.OAUTH_TOKEN_STORE['session-1'].pop('db_auth_connection_id', None)
        jira_server.OAUTH_TOKEN_STORE['session-1'].pop('db_token_version', None)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            csrf_response = self.client.get('/api/auth/csrf')
            self.assertEqual(csrf_response.status_code, 200, csrf_response.get_data(as_text=True))
            response = self.client.post(
                '/api/scenario/drafts',
                json={
                    'scope_key': 'scope-auth-csrf',
                    'name': 'CSRF endpoint',
                    'overrides': {},
                    'baseDraftRevision': None,
                    'scope': {'groupId': 'platform'},
                },
                headers={
                    'X-Requested-With': 'jira-execution-planner',
                    'X-CSRF-Token': csrf_response.get_json()['csrfToken'],
                },
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['activeDraft']['draftRevision'], 1)

    def test_rollback_requires_requested_with_and_token_bound_csrf(self):
        saved = save_draft(self.context, 'scope-rollback-csrf', 'Rollback CSRF', {})
        path = f"/api/scenario/drafts/{saved['activeDraft']['draftId']}/rollback"
        body = {'targetVersionNumber': 1, 'baseDraftRevision': 1}

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            missing_both = self.client.post(path, json=body)
            missing_token = self.client.post(path, headers={'X-Requested-With': 'jira-execution-planner'}, json=body)
            token_without_header = self.client.post(path, headers={'X-CSRF-Token': self._csrf_token()}, json=body)

        self.assertEqual(missing_both.status_code, 403)
        self.assertEqual(missing_both.get_json()['error'], 'csrf_required')
        self.assertEqual(missing_token.status_code, 403)
        self.assertEqual(missing_token.get_json()['error'], 'csrf_required')
        self.assertEqual(token_without_header.status_code, 403)
        self.assertEqual(token_without_header.get_json()['error'], 'csrf_required')

    def test_get_version_returns_snapshot_overrides(self):
        saved = save_draft(self.context, 'scope-version', 'Version', {'ENG-1': {'end': '2026-05-21'}})
        draft_id = saved['activeDraft']['draftId']
        save_draft(self.context, 'scope-version', 'Version 2', {'ENG-2': {'start': '2026-05-22'}}, base_draft_revision=1)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.get(f'/api/scenario/drafts/{draft_id}/versions/1')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['overrides'], {'ENG-1': {'end': '2026-05-21'}})
        self.assertEqual(response.get_json()['versionNumber'], 1)

    def test_get_version_rejects_other_workspace_draft(self):
        saved = save_draft(self.other_context, 'scope-other', 'Other', {})
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.get(f"/api/scenario/drafts/{saved['activeDraft']['draftId']}/versions/1")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error'], 'scenario_draft_not_found')

    def test_get_version_missing_version_returns_not_found(self):
        saved = save_draft(self.context, 'scope-missing-version', 'Missing', {})
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.get(f"/api/scenario/drafts/{saved['activeDraft']['draftId']}/versions/99")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error'], 'scenario_draft_version_not_found')

    def test_rollback_creates_new_version(self):
        saved = save_draft(self.context, 'scope-rollback', 'Rollback', {'ENG-1': {'start': '2026-05-18'}})
        save_draft(self.context, 'scope-rollback', 'Rollback 2', {'ENG-2': {'end': '2026-05-22'}}, base_draft_revision=1)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post(f"/api/scenario/drafts/{saved['activeDraft']['draftId']}/rollback", json={'targetVersionNumber': 1, 'baseDraftRevision': 2}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['activeDraft']['draftRevision'], 3)
        self.assertEqual(response.get_json()['versions'][-1]['source'], 'rollback')

    def test_rollback_requires_base_draft_revision(self):
        saved = save_draft(self.context, 'scope-rollback-base', 'Rollback', {})
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post(f"/api/scenario/drafts/{saved['activeDraft']['draftId']}/rollback", json={'targetVersionNumber': 1}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'base_draft_revision_required')

    def test_rollback_rejects_non_integer_target_version(self):
        invalid_values = ['not-a-version', '', ' ', 1.9, True, False, 0, -1]
        for value in invalid_values:
            with self.subTest(targetVersionNumber=value):
                saved = save_draft(
                    self.context,
                    f'scope-rollback-invalid-version-{repr(value)}',
                    'Rollback',
                    {'ENG-1': {'start': '2026-05-18'}},
                )
                draft_id = saved['activeDraft']['draftId']
                save_draft(
                    self.context,
                    f'scope-rollback-invalid-version-{repr(value)}',
                    'Rollback updated',
                    {'ENG-2': {'end': '2026-05-22'}},
                    base_draft_revision=1,
                )
                with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
                    response = self.client.post(
                        f'/api/scenario/drafts/{draft_id}/rollback',
                        json={'targetVersionNumber': value, 'baseDraftRevision': 2},
                        headers=self._csrf_headers(),
                    )
                    loaded = self.client.get(f'/api/scenario/drafts/{draft_id}/versions/2')
                    missing = self.client.get(f'/api/scenario/drafts/{draft_id}/versions/3')

                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'target_version_required')
                self.assertEqual(loaded.status_code, 200, loaded.get_data(as_text=True))
                self.assertEqual(loaded.get_json()['source'], 'user')
                self.assertEqual(missing.status_code, 404, missing.get_data(as_text=True))
                self.assertEqual(missing.get_json()['error'], 'scenario_draft_version_not_found')

    def test_rollback_rejects_invalid_base_draft_revision_without_mutation(self):
        invalid_values = ['', ' ', 1.9, True, False, 0, -1]
        for value in invalid_values:
            with self.subTest(baseDraftRevision=value):
                saved = save_draft(
                    self.context,
                    f'scope-rollback-invalid-base-{repr(value)}',
                    'Rollback',
                    {'ENG-1': {'start': '2026-05-18'}},
                )
                draft_id = saved['activeDraft']['draftId']
                save_draft(
                    self.context,
                    f'scope-rollback-invalid-base-{repr(value)}',
                    'Rollback updated',
                    {'ENG-2': {'end': '2026-05-22'}},
                    base_draft_revision=1,
                )
                with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
                    response = self.client.post(
                        f'/api/scenario/drafts/{draft_id}/rollback',
                        json={'targetVersionNumber': 1, 'baseDraftRevision': value},
                        headers=self._csrf_headers(),
                    )
                    loaded = self.client.get(f'/api/scenario/drafts/{draft_id}/versions/2')
                    missing = self.client.get(f'/api/scenario/drafts/{draft_id}/versions/3')

                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'base_draft_revision_required')
                self.assertEqual(loaded.status_code, 200, loaded.get_data(as_text=True))
                self.assertEqual(loaded.get_json()['source'], 'user')
                self.assertEqual(missing.status_code, 404, missing.get_data(as_text=True))
                self.assertEqual(missing.get_json()['error'], 'scenario_draft_version_not_found')

    def test_rollback_stale_base_returns_canonical_conflict(self):
        saved = save_draft(self.context, 'scope-rollback-stale', 'Rollback', {})
        save_draft(self.context, 'scope-rollback-stale', 'Rollback 2', {}, base_draft_revision=1)
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post(f"/api/scenario/drafts/{saved['activeDraft']['draftId']}/rollback", json={'targetVersionNumber': 1, 'baseDraftRevision': 1}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 409)
        body = response.get_json()
        self.assertEqual(body['error'], 'scenario_draft_conflict')
        self.assertEqual(body['conflict'], {
            'reason': 'stale_base_draft_revision',
            'receivedBaseDraftRevision': 1,
            'currentDraftRevision': 2,
            'currentVersionNumber': 2,
        })
        self.assertEqual(body['activeDraft']['draftRevision'], 2)
        self.assertEqual(body['storage'], 'db')
        self.assertNotIn('reason', body)
        self.assertNotIn('receivedBaseDraftRevision', body)
        self.assertNotIn('currentDraftRevision', body)
        self.assertNotIn('currentVersionNumber', body)

    def test_rollback_rejects_other_workspace_draft(self):
        saved = save_draft(self.other_context, 'scope-rollback-other', 'Other', {})
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post(f"/api/scenario/drafts/{saved['activeDraft']['draftId']}/rollback", json={'targetVersionNumber': 1, 'baseDraftRevision': 1}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error'], 'scenario_draft_not_found')

    def test_events_route_paginates_at_100_and_advances_next_since(self):
        saved = save_draft(self.context, 'scope-events-page', 'Events', {})
        draft_id = saved['activeDraft']['draftId']
        for index in range(105):
            append_event(
                self.context,
                draft_id,
                event_type='test.event',
                draft_revision=1,
                payload={'index': index},
            )

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            first = self.client.get(f'/api/scenario/drafts/{draft_id}/events?since=0')
            second = self.client.get(f"/api/scenario/drafts/{draft_id}/events?since={first.get_json()['nextSince']}")

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        first_body = first.get_json()
        self.assertEqual(len(first_body['events']), 100)
        self.assertEqual(first_body['nextSince'], first_body['events'][-1]['eventNumber'])
        self.assertFalse(first_body['isLast'])
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        second_body = second.get_json()
        self.assertEqual(len(second_body['events']), 6)
        self.assertTrue(second_body['isLast'])

    def test_events_route_returns_received_since_when_no_events(self):
        saved = save_draft(self.context, 'scope-events-empty', 'Events', {})
        draft_id = saved['activeDraft']['draftId']
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.get(f'/api/scenario/drafts/{draft_id}/events?since=1')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['events'], [])
        self.assertEqual(body['nextSince'], 1)
        self.assertTrue(body['isLast'])

    def test_sse_route_is_disabled_by_default_and_available_when_enabled(self):
        saved = save_draft(self.context, 'scope-sse', 'SSE', {})
        draft_id = saved['activeDraft']['draftId']
        append_event(self.context, draft_id, event_type='test.event', draft_revision=1, payload={})

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            disabled = self.client.get(f'/api/scenario/drafts/{draft_id}/events/stream?since=0')
        with self._env_patch(), patch.dict(os.environ, {'SCENARIO_DRAFT_SSE_ENABLED': 'true'}, clear=False), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            enabled = self.client.get(f'/api/scenario/drafts/{draft_id}/events/stream?since=0')

        self.assertEqual(disabled.status_code, 404)
        self.assertEqual(disabled.get_json()['error'], 'scenario_draft_sse_disabled')
        self.assertEqual(enabled.status_code, 200, enabled.get_data(as_text=True))
        self.assertIn('text/event-stream', enabled.content_type)
        self.assertIn('event: test.event', enabled.get_data(as_text=True))

    def test_presence_requires_csrf_and_emits_event_without_revision_change(self):
        saved = save_draft(self.context, 'scope-presence', 'Presence', {})
        draft_id = saved['activeDraft']['draftId']

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            missing = self.client.post(f'/api/scenario/drafts/{draft_id}/presence', json={'cursorPayload': {}, 'mode': 'viewing'})
            response = self.client.post(
                f'/api/scenario/drafts/{draft_id}/presence',
                json={'cursorPayload': {'issueKey': 'ENG-1'}, 'mode': 'viewing'},
                headers=self._csrf_headers(),
            )
            events = self.client.get(f'/api/scenario/drafts/{draft_id}/events?since=0')

        self.assertEqual(missing.status_code, 403)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['event']['eventType'], 'presence.updated')
        self.assertEqual(events.get_json()['events'][-1]['eventType'], 'presence.updated')
        self.assertEqual(save_draft(self.context, 'scope-presence', 'Presence 2', {}, base_draft_revision=1)['activeDraft']['draftRevision'], 2)

    def test_presence_ignores_spoofed_display_name_and_draft_revision(self):
        saved = save_draft(self.context, 'scope-presence-spoof', 'Presence', {})
        draft_id = saved['activeDraft']['draftId']
        save_draft(self.context, 'scope-presence-spoof', 'Presence updated', {}, base_draft_revision=1)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post(
                f'/api/scenario/drafts/{draft_id}/presence',
                json={
                    'displayName': 'Spoofed Name',
                    'cursorPayload': {'issueKey': 'ENG-1'},
                    'mode': 'viewing',
                    'draftRevision': 999,
                },
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['presence']['displayName'], 'account-1')
        self.assertEqual(body['event']['draftRevision'], 2)

    def test_locks_support_acquire_refresh_release_and_conflict(self):
        saved = save_draft(self.context, 'scope-locks', 'Locks', {})
        draft_id = saved['activeDraft']['draftId']
        same_workspace_other_context = self._context(
            self.workspace_id,
            self.other_user_id,
            self.connection_id,
            account_id='account-2',
        )

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            acquired = self.client.post(
                f'/api/scenario/drafts/{draft_id}/locks',
                json={'action': 'acquire', 'resourceType': 'issue', 'resourceId': 'ENG-1'},
                headers=self._csrf_headers(),
            )
            refreshed = self.client.post(
                f'/api/scenario/drafts/{draft_id}/locks',
                json={'action': 'refresh', 'resourceType': 'issue', 'resourceId': 'ENG-1'},
                headers=self._csrf_headers(),
            )
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch(same_workspace_other_context):
            conflict = self.client.post(
                f'/api/scenario/drafts/{draft_id}/locks',
                json={'action': 'acquire', 'resourceType': 'issue', 'resourceId': 'ENG-1'},
                headers=self._csrf_headers(same_workspace_other_context),
            )
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            released = self.client.post(
                f'/api/scenario/drafts/{draft_id}/locks',
                json={'action': 'release', 'resourceType': 'issue', 'resourceId': 'ENG-1'},
                headers=self._csrf_headers(),
            )

        self.assertEqual(acquired.status_code, 200, acquired.get_data(as_text=True))
        self.assertEqual(refreshed.status_code, 200, refreshed.get_data(as_text=True))
        self.assertEqual(conflict.status_code, 409, conflict.get_data(as_text=True))
        self.assertEqual(conflict.get_json()['error'], 'scenario_draft_lock_held')
        self.assertEqual(released.status_code, 200, released.get_data(as_text=True))

    def test_lock_ignores_spoofed_holder_display_name_and_draft_revision(self):
        saved = save_draft(self.context, 'scope-lock-spoof', 'Locks', {})
        draft_id = saved['activeDraft']['draftId']
        save_draft(self.context, 'scope-lock-spoof', 'Locks updated', {}, base_draft_revision=1)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post(
                f'/api/scenario/drafts/{draft_id}/locks',
                json={
                    'action': 'acquire',
                    'resourceType': 'issue',
                    'resourceId': 'ENG-1',
                    'holderDisplayName': 'Spoofed Holder',
                    'draftRevision': 999,
                },
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['lock']['holderDisplayName'], 'account-1')
        self.assertEqual(body['event']['draftRevision'], 2)

    def test_lock_release_by_non_holder_returns_conflict_without_release_event(self):
        saved = save_draft(self.context, 'scope-lock-release-non-holder', 'Locks', {})
        draft_id = saved['activeDraft']['draftId']
        same_workspace_other_context = self._context(
            self.workspace_id,
            self.other_user_id,
            self.connection_id,
            account_id='account-2',
        )
        acquire_lock(self.context, draft_id, resource_type='issue', resource_id='ENG-1', holder_display_name='First User')

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch(same_workspace_other_context):
            response = self.client.post(
                f'/api/scenario/drafts/{draft_id}/locks',
                json={'action': 'release', 'resourceType': 'issue', 'resourceId': 'ENG-1'},
                headers=self._csrf_headers(same_workspace_other_context),
            )
            events = self.client.get(f'/api/scenario/drafts/{draft_id}/events?since=0')

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'scenario_draft_lock_held')
        self.assertEqual(response.get_json()['activeLock']['holderUserId'], self.user_id)
        self.assertNotIn('lock.released', [event['eventType'] for event in events.get_json()['events']])
        with self.factory() as session:
            self.assertEqual(session.query(models.ScenarioDraftLock).filter_by(scenario_draft_id=draft_id).count(), 1)

    def test_reload_from_jira_updates_source_hash_invalidates_locks_and_conflicts_on_stale_base(self):
        saved = save_draft(
            self.context,
            'scope-reload',
            'Reload',
            {'ENG-1': {'start': '2026-05-18'}},
            scope_payload={
                'config': {'lane_mode': 'team'},
                'filters': {'sprint': '2026Q2', 'teams': ['team-1']},
            },
        )
        draft_id = saved['activeDraft']['draftId']
        acquire_lock(self.context, draft_id, resource_type='issue', resource_id='ENG-1', holder_display_name='First User')
        loaded_sources = []
        original_current_request_auth_context = jira_server.current_request_auth_context

        def planner():
            self.assertIs(jira_server.current_request_auth_context, original_current_request_auth_context)
            auth_context = jira_server.current_request_auth_context()
            payload = request.get_json(silent=True) or {}
            loaded_sources.append({
                'context': auth_context,
                'payload': payload,
            })
            return jsonify({
                'config': {'sprint': '2026Q2'},
                'filters': payload.get('filters') or {},
                'issues': [{'key': 'ENG-1', 'jiraStartDate': '2026-05-19'}],
                'dependencies': [],
            })

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch(), \
             patch.object(jira_server, 'scenario_planner', side_effect=planner):
            response = self.client.post(
                f'/api/scenario/drafts/{draft_id}/reload-from-jira',
                json={'baseDraftRevision': 1},
                headers=self._csrf_headers(),
            )
            stale = self.client.post(
                f'/api/scenario/drafts/{draft_id}/reload-from-jira',
                json={'baseDraftRevision': 1},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['activeDraft']['draftRevision'], 2)
        self.assertEqual(body['versions'][-1]['source'], 'reload_from_jira')
        self.assertIsNotNone(body['activeDraft']['scenarioSourceHash'])
        self.assertEqual(len(loaded_sources), 1)
        self.assertEqual(loaded_sources[0]['context'].auth_connection_id, self.context.auth_connection_id)
        self.assertEqual(loaded_sources[0]['context'].workspace_id, self.context.workspace_id)
        self.assertEqual(loaded_sources[0]['context'].atlassian_account_id, self.context.atlassian_account_id)
        self.assertEqual(loaded_sources[0]['payload'], {
            'config': {'lane_mode': 'team'},
            'filters': {'sprint': '2026Q2', 'teams': ['team-1']},
        })
        self.assertLess(response.elapsed.total_seconds() if hasattr(response, 'elapsed') else 0, 20)
        self.assertEqual(stale.status_code, 409)
        with self.factory() as session:
            self.assertEqual(session.query(models.ScenarioDraftLock).filter_by(scenario_draft_id=draft_id).count(), 0)
            event = session.query(models.ScenarioDraftEvent).filter_by(
                scenario_draft_id=draft_id,
                event_type='draft.reloaded_from_jira',
            ).one()
            self.assertEqual(event.draft_revision, 2)

    def test_reload_from_jira_timeout_returns_503_and_preserves_draft_state(self):
        saved = save_draft(self.context, 'scope-reload-timeout', 'Reload timeout', {'ENG-1': {'start': '2026-05-18'}})
        draft_id = saved['activeDraft']['draftId']
        original_hash = saved['activeDraft']['scenarioSourceHash']
        acquire_lock(self.context, draft_id, resource_type='issue', resource_id='ENG-1', holder_display_name='First User')

        def timeout_planner():
            raise TimeoutError('scenario reload exceeded SLA')

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch(), \
             patch.object(jira_server, 'scenario_planner', side_effect=timeout_planner):
            response = self.client.post(
                f'/api/scenario/drafts/{draft_id}/reload-from-jira',
                json={'baseDraftRevision': 1},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'scenario_reload_timeout')
        with self.factory() as session:
            draft = session.get(models.ScenarioDraft, draft_id)
            self.assertEqual(draft.draft_revision, 1)
            self.assertEqual(draft.overrides, {'ENG-1': {'start': '2026-05-18'}})
            self.assertEqual(draft.scenario_source_hash, original_hash)
            self.assertEqual(session.query(models.ScenarioDraftLock).filter_by(scenario_draft_id=draft_id).count(), 1)
            self.assertEqual(session.query(models.ScenarioDraftEvent).filter_by(scenario_draft_id=draft_id).count(), 1)

    def test_reload_from_jira_slow_non_main_loader_times_out_without_waiting_or_mutating(self):
        saved = save_draft(self.context, 'scope-reload-slow', 'Reload slow', {'ENG-1': {'start': '2026-05-18'}})
        draft_id = saved['activeDraft']['draftId']
        original_hash = saved['activeDraft']['scenarioSourceHash']

        def slow_planner():
            time.sleep(0.5)
            return jsonify({
                'config': {},
                'filters': {},
                'issues': [{'key': 'ENG-1'}],
                'dependencies': [],
            })

        result = {}

        def post_reload():
            client = jira_server.app.test_client()
            with client.session_transaction() as flask_session:
                flask_session['atlassian_oauth_session_id'] = 'thread-session'
                flask_session['db_oauth_session'] = {'db_auth_connection_id': self.connection_id}
                token = issue_csrf_token(flask_session, {
                    'db_auth_connection_id': self.context.auth_connection_id,
                    'db_token_version': self.context.token_version,
                    'account_id': self.context.atlassian_account_id,
                })
            started = time.monotonic()
            response = client.post(
                f'/api/scenario/drafts/{draft_id}/reload-from-jira',
                json={'baseDraftRevision': 1},
                headers={
                    'X-Requested-With': 'jira-execution-planner',
                    'X-CSRF-Token': token,
                },
            )
            result['elapsed'] = time.monotonic() - started
            result['status'] = response.status_code
            result['body'] = response.get_json()

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'scenario_draft_request_auth_context', return_value=self.context), \
             patch.object(jira_server, 'scenario_planner', side_effect=slow_planner), \
             patch('backend.routes.scenario_draft_routes.SCENARIO_RELOAD_TIMEOUT_SECONDS', 0.05):
            worker = threading.Thread(target=post_reload)
            worker.start()
            worker.join(1)

        self.assertFalse(worker.is_alive())
        self.assertLess(result['elapsed'], 0.4)
        self.assertEqual(result['status'], 503)
        self.assertEqual(result['body']['error'], 'scenario_reload_timeout')
        with self.factory() as session:
            draft = session.get(models.ScenarioDraft, draft_id)
            self.assertEqual(draft.draft_revision, 1)
            self.assertEqual(draft.overrides, {'ENG-1': {'start': '2026-05-18'}})
            self.assertEqual(draft.scenario_source_hash, original_hash)
            self.assertEqual(session.query(models.ScenarioDraftEvent).filter_by(scenario_draft_id=draft_id).count(), 1)

    def test_writeback_preview_is_dry_run_and_writeback_is_blocked_without_credential_paths(self):
        saved = save_draft(self.context, 'scope-writeback', 'Writeback', {})
        draft_id = saved['activeDraft']['draftId']
        guards = [
            patch.object(jira_server, 'jira_get', side_effect=AssertionError('jira_get forbidden')),
            patch.object(jira_server, 'jira_post', side_effect=AssertionError('jira_post forbidden')),
            patch.object(jira_server, 'jira_request', side_effect=AssertionError('jira_request forbidden')),
            patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('current_jira_request forbidden')),
            patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('current_jira_get forbidden')),
            patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('current_jira_search forbidden')),
            patch.object(jira_server, 'jira_search_request', side_effect=AssertionError('jira_search_request forbidden')),
            patch('backend.auth.home_credentials.resolve_home_credential', side_effect=AssertionError('home credential forbidden')),
            patch('backend.auth.service_integrations.get_service_integration_summary', side_effect=AssertionError('service integration forbidden')),
            patch('backend.auth.service_integrations.list_service_integration_summaries', side_effect=AssertionError('service integration list forbidden')),
        ]
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            with guards[0], guards[1], guards[2], guards[3], guards[4], guards[5], guards[6], guards[7], guards[8], guards[9]:
                preview = self.client.post(f'/api/scenario/drafts/{draft_id}/writeback/preview', json={}, headers=self._csrf_headers())
                blocked = self.client.post(f'/api/scenario/drafts/{draft_id}/writeback', json={}, headers=self._csrf_headers())

        self.assertEqual(preview.status_code, 200, preview.get_data(as_text=True))
        self.assertTrue(preview.get_json()['dryRun'])
        self.assertEqual(blocked.status_code, 403, blocked.get_data(as_text=True))
        self.assertEqual(blocked.get_json()['error'], 'jira_writeback_gate_blocked')

    def test_descendant_routes_reject_other_workspace_draft_ids(self):
        saved = save_draft(self.other_context, 'scope-descendant-other', 'Other', {})
        draft_id = saved['activeDraft']['draftId']
        routes = [
            ('get', f'/api/scenario/drafts/{draft_id}/events', None),
            ('get', f'/api/scenario/drafts/{draft_id}/events/stream', None),
            ('get', f'/api/scenario/drafts/{draft_id}/presence', None),
            ('post', f'/api/scenario/drafts/{draft_id}/presence', {'cursorPayload': {}, 'mode': 'viewing'}),
            ('post', f'/api/scenario/drafts/{draft_id}/locks', {'action': 'acquire', 'resourceType': 'issue', 'resourceId': 'ENG-1'}),
            ('post', f'/api/scenario/drafts/{draft_id}/reload-from-jira', {'baseDraftRevision': 1}),
            ('post', f'/api/scenario/drafts/{draft_id}/writeback/preview', {}),
            ('post', f'/api/scenario/drafts/{draft_id}/writeback', {}),
        ]

        with self._env_patch(), patch.dict(os.environ, {'SCENARIO_DRAFT_SSE_ENABLED': 'true'}, clear=False), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            for method, path, payload in routes:
                with self.subTest(path=path):
                    if method == 'get':
                        response = self.client.get(path)
                    else:
                        response = self.client.post(path, json=payload, headers=self._csrf_headers())
                    self.assertEqual(response.status_code, 404, response.get_data(as_text=True))
                    self.assertEqual(response.get_json()['error'], 'scenario_draft_not_found')

    def test_oauth_ready_paths_are_declared_before_unsafe_header_guard(self):
        saved = save_draft(self.context, 'scope-oauth-ready', 'OAuth Ready', {})
        draft_id = saved['activeDraft']['draftId']
        paths = [
            f'/api/scenario/drafts/{draft_id}/events',
            f'/api/scenario/drafts/{draft_id}/presence',
            f'/api/scenario/drafts/{draft_id}/locks',
            f'/api/scenario/drafts/{draft_id}/reload-from-jira',
            f'/api/scenario/drafts/{draft_id}/writeback/preview',
            f'/api/scenario/drafts/{draft_id}/writeback',
        ]
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(jira_server.is_oauth_ready_api_path(path))

    def test_draft_save_load_does_not_resolve_external_credentials(self):
        guards = [
            patch.object(jira_server, 'jira_get', side_effect=AssertionError('jira_get forbidden')),
            patch.object(jira_server, 'jira_post', side_effect=AssertionError('jira_post forbidden')),
            patch.object(jira_server, 'jira_request', side_effect=AssertionError('jira_request forbidden')),
            patch('backend.auth.home_credentials.resolve_home_credential', side_effect=AssertionError('home credential forbidden')),
            patch('backend.auth.service_integrations.get_service_integration_summary', side_effect=AssertionError('service integration forbidden')),
            patch('backend.auth.service_integrations.list_service_integration_summaries', side_effect=AssertionError('service integration list forbidden')),
        ]
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            with guards[0], guards[1], guards[2], guards[3], guards[4], guards[5]:
                saved = self.client.post('/api/scenario/drafts', json={'scope_key': 'scope-guards', 'name': 'Guards', 'overrides': {}}, headers=self._csrf_headers())
                loaded = self.client.get('/api/scenario/drafts?scope_key=scope-guards')

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(loaded.status_code, 200, loaded.get_data(as_text=True))

    def test_draft_write_csrf_does_not_use_local_oauth_token_store(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             self._route_patch(), \
             patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('local token store read forbidden')):
            response = self.client.post(
                '/api/scenario/drafts',
                json={'scope_key': 'scope-no-local-token-store', 'name': 'No local store', 'overrides': {}},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['activeDraft']['draftRevision'], 1)

    def test_draft_write_unmocked_auth_csrf_does_not_use_local_oauth_token_store(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('local token store read forbidden')):
            response = self.client.post(
                '/api/scenario/drafts',
                json={'scope_key': 'scope-unmocked-no-local-store', 'name': 'No local store', 'overrides': {}},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['activeDraft']['draftRevision'], 1)

    def test_draft_write_missing_db_browser_session_does_not_use_local_oauth_token_store(self):
        with self.client.session_transaction() as flask_session:
            flask_session.pop('db_oauth_session', None)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('local token store read forbidden')):
            response = self.client.post(
                '/api/scenario/drafts',
                json={'scope_key': 'scope-no-db-session', 'name': 'No DB session', 'overrides': {}},
                headers={'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': self._csrf_token()},
            )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'auth_required')

    def test_legacy_get_delegates_to_active_draft_in_db_mode(self):
        save_draft(self.context, 'scope-legacy-get', 'Legacy GET', {'ENG-1': {'start': '2026-05-18'}})

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.get('/api/scenario/overrides?scope_key=scope-legacy-get')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['overrides'], {'ENG-1': {'start': '2026-05-18'}})
        self.assertEqual(body['storage'], 'db')
        self.assertEqual(body['activeDraft']['draftRevision'], 1)

    def test_legacy_get_preserves_json_fallback_shape_in_basic_mode(self):
        legacy = {'version': 1, 'scenarios': {'scope-basic-get': {'overrides': {'ENG-1': {'end': '2026-05-20'}}}}}
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': ''}, clear=False), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'load_scenario_overrides', return_value=legacy):
            response = self.client.get('/api/scenario/overrides?scope_key=scope-basic-get')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'overrides': {'ENG-1': {'end': '2026-05-20'}}})

    def test_legacy_post_is_not_oauth_ready_in_db_mode_without_revision(self):
        save_draft(self.context, 'scope-legacy-post', 'Legacy POST', {'ENG-1': {'start': '2026-05-18'}})
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post('/api/scenario/overrides', json={'scope_key': 'scope-legacy-post', 'overrides': {}}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 501, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')

    def test_legacy_post_is_not_oauth_ready_in_db_mode_with_base_revision(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post('/api/scenario/overrides', json={'scope_key': 'scope-legacy-base', 'overrides': {}, 'baseDraftRevision': 1}, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 501, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')

    def test_legacy_post_no_scope_is_not_oauth_ready_in_db_mode(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
            response = self.client.post(
                '/api/scenario/overrides',
                json={'overrides': {}},
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(response.status_code, 501, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')

    def test_legacy_post_rejection_does_not_import_legacy_json_or_create_draft(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.dict(os.environ, {'SCENARIO_DRAFT_LEGACY_IMPORT_WORKSPACE_ID': self.workspace_id}, clear=False), \
             self._route_patch(), \
             patch.object(jira_server, 'load_scenario_overrides', side_effect=AssertionError('legacy loader must not run')):
            response = self.client.post('/api/scenario/overrides', json={'scope_key': 'scope-no-import', 'overrides': {}}, headers=self._csrf_headers())

        with self.factory() as session:
            draft_count = session.query(models.ScenarioDraft).filter_by(scope_key='scope-no-import').count()
            version_count = session.query(models.ScenarioDraftVersion).count()

        self.assertEqual(response.status_code, 501, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')
        self.assertEqual(draft_count, 0)
        self.assertEqual(version_count, 0)

    def test_legacy_post_rejection_csrf_does_not_use_local_oauth_token_store(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             self._route_patch(), \
             patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('local token store read forbidden')):
            response = self.client.post(
                '/api/scenario/overrides',
                json={'scope_key': 'scope-legacy-no-local-store', 'overrides': {}},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 501, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')

    def test_legacy_post_unmocked_rejection_csrf_does_not_use_local_oauth_token_store(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('local token store read forbidden')):
            response = self.client.post(
                '/api/scenario/overrides',
                json={'scope_key': 'scope-legacy-unmocked-no-local-store', 'overrides': {}},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 501, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')

    def test_legacy_post_basic_mode_writes_json_without_csrf(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, 'scenario-overrides.json')
            with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': ''}, clear=False), \
                 patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
                 patch.object(jira_server, 'SCENARIO_OVERRIDES_PATH', path):
                response = self.client.post('/api/scenario/overrides', json={'scope_key': 'scope-basic-post', 'name': 'Basic', 'overrides': {'ENG-1': {'start': '2026-05-18'}}})
                loaded = jira_server.load_scenario_overrides()

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'ok': True})
        self.assertEqual(loaded['scenarios']['scope-basic-post']['overrides'], {'ENG-1': {'start': '2026-05-18'}})

    def test_scope_payload_rejects_membership_shapes(self):
        payloads = [
            {'members': []},
            {'teamIds': []},
            {'memberUserIds': []},
            {'group': {'groupDefinitions': [{'id': 'platform'}]}},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), self._route_patch():
                    response = self.client.post('/api/scenario/drafts', json={'scope_key': 'scope-member-shape', 'name': 'Bad', 'overrides': {}, 'scope': payload}, headers=self._csrf_headers())
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()['error'], 'scenario_scope_membership_not_allowed')


if __name__ == '__main__':
    unittest.main()
