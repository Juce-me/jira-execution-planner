import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.db import engine as db_engine
from backend.db import models
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session


class SharedGroupConfigRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'shared-groups-routes.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.connection_id = self._seed_user('account-1')
        _, self.other_user_id, self.other_connection_id = self._seed_user('account-2')
        self._install_session('session-1', 'account-1', self.connection_id)

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_user(self, account_id, *, site_url='https://example.atlassian.net', cloud_id='cloud-1'):
        with self.factory() as session:
            workspace = session.query(models.Workspace).filter_by(jira_cloud_id=cloud_id).first()
            if workspace is None:
                workspace = models.Workspace(
                    environment_key='local',
                    name=f'Workspace {cloud_id}',
                    jira_site_url=site_url,
                    jira_cloud_id=cloud_id,
                    created_by='test',
                )
                session.add(workspace)
                session.flush()
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add(user)
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url=workspace.jira_site_url,
                cloud_id=workspace.jira_cloud_id,
                scopes=FULL_OAUTH_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            return workspace.id, user.id, connection.id

    def _install_session(self, session_id, account_id, connection_id, *, site_url='https://example.atlassian.net', cloud_id='cloud-1'):
        install_oauth_session(
            self.client,
            session_id=session_id,
            account_id=account_id,
            site_url=site_url,
            cloudid=cloud_id,
            db_auth_connection_id=connection_id,
            db_token_version='1',
            expires_at=time.time() + 3600,
        )

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }, clear=False)

    def _csrf_headers(self):
        response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return {
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': response.get_json()['csrfToken'],
        }

    def _legacy_config(self):
        return {
            'version': 1,
            'teamGroups': {
                'version': 1,
                'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
                'defaultGroupId': 'platform',
            },
        }

    def _favorite_config(self):
        return {
            'version': 1,
            'teamGroups': {
                'version': 1,
                'groups': [
                    {'id': 'default', 'name': 'Default', 'teamIds': ['team-default']},
                    {'id': 'platform', 'name': 'Platform', 'teamIds': ['team-platform']},
                    {'id': 'mobile', 'name': 'Mobile', 'teamIds': ['team-mobile']},
                    {'id': 'empty', 'name': 'Empty', 'teamIds': []},
                ],
                'defaultGroupId': 'default',
            },
        }

    def _get_groups_config(self, *, fallback=None):
        fallback = self._legacy_config() if fallback is None else fallback
        with self._env_patch(), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'load_dashboard_config', return_value=fallback):
            return self.client.get('/api/groups-config')

    def _save_personal_favorite(self, favorite_group_id='platform'):
        self._get_groups_config(fallback=self._favorite_config())
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            return self.client.post(
                '/api/groups-preferences',
                json={
                    'visibleGroupIds': [favorite_group_id],
                    'activeGroupId': favorite_group_id,
                },
                headers=self._csrf_headers(),
            )

    def _post_onboarding(self, payload, headers=None, **kwargs):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            return self.client.post(
                '/api/me/onboarding',
                json=payload,
                headers=headers or self._csrf_headers(),
                **kwargs,
            )

    def test_get_groups_config_imports_shared_catalog_and_requires_first_run(self):
        first = self._get_groups_config()
        self._install_session('session-2', 'account-2', self.other_connection_id)
        second = self._get_groups_config(fallback={'version': 1})

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        first_json = first.get_json()
        second_json = second.get_json()
        self.assertEqual(first_json['source'], 'workspace_db')
        self.assertEqual(second_json['groups'], first_json['groups'])
        self.assertEqual(first_json['groups'][0]['adHocCapacityEpics'], [])
        self.assertTrue(first_json['preferences']['onboardingRequired'])
        self.assertEqual(first_json['preferences']['effectiveVisibleGroupIds'], [])

    def test_post_groups_config_allows_user_write_and_rejects_stale_revision(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a', 'team-b']}],
            'defaultGroupId': 'platform',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            saved = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())
            stale = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(saved.get_json()['configRevision'], loaded['configRevision'] + 1)
        self.assertEqual(stale.status_code, 409, stale.get_data(as_text=True))
        self.assertEqual(stale.get_json()['error'], 'group_config_conflict')
        self.assertIn('current', stale.get_json())
        self.assertEqual(stale.get_json()['current']['groups'][0]['adHocCapacityEpics'], [])

    def test_post_groups_config_persists_excluded_capacity_epics_as_shared_catalog(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{
                'id': 'platform',
                'name': 'Platform',
                'teamIds': ['team-a'],
                'excludedCapacityEpics': ['PLAN-EPIC'],
                'adHocCapacityEpics': [' product-adhoc ', 'PRODUCT-ADHOC'],
            }],
            'defaultGroupId': 'platform',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            saved = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())

        self._install_session('session-2', 'account-2', self.other_connection_id)
        loaded_for_other_user = self._get_groups_config(fallback={'version': 1}).get_json()
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            preferences = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers=self._csrf_headers(),
            )
        after_preferences = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(saved.get_json()['groups'][0]['excludedCapacityEpics'], ['PLAN-EPIC'])
        self.assertEqual(saved.get_json()['groups'][0]['adHocCapacityEpics'], ['PRODUCT-ADHOC'])
        self.assertEqual(loaded_for_other_user['groups'][0]['excludedCapacityEpics'], ['PLAN-EPIC'])
        self.assertEqual(loaded_for_other_user['groups'][0]['adHocCapacityEpics'], ['PRODUCT-ADHOC'])
        self.assertEqual(preferences.status_code, 200, preferences.get_data(as_text=True))
        self.assertEqual(after_preferences['groups'][0]['excludedCapacityEpics'], ['PLAN-EPIC'])
        self.assertEqual(after_preferences['groups'][0]['adHocCapacityEpics'], ['PRODUCT-ADHOC'])

    def test_post_groups_config_rejects_excluded_and_ad_hoc_overlap_without_persisting(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{
                'id': 'platform',
                'name': 'Platform',
                'teamIds': ['team-a'],
                'excludedCapacityEpics': ['PLAN-EPIC'],
                'adHocCapacityEpics': [' plan-epic '],
            }],
            'defaultGroupId': 'platform',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())
        after = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'invalid_groups_config')
        self.assertTrue(any('both excludedCapacityEpics and adHocCapacityEpics' in error for error in response.get_json().get('errors', [])))
        self.assertEqual(after['groups'][0]['excludedCapacityEpics'], [])
        self.assertEqual(after['groups'][0]['adHocCapacityEpics'], [])

    def test_shared_ad_hoc_epics_are_workspace_scoped(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{
                'id': 'platform',
                'name': 'Platform',
                'teamIds': ['team-a'],
                'adHocCapacityEpics': ['PRODUCT-ADHOC'],
            }],
            'defaultGroupId': 'platform',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())
        _, other_workspace_user_id, other_workspace_connection_id = self._seed_user(
            'account-3',
            site_url='https://other.example.atlassian.net',
            cloud_id='cloud-2',
        )
        del other_workspace_user_id
        self._install_session(
            'session-3',
            'account-3',
            other_workspace_connection_id,
            site_url='https://other.example.atlassian.net',
            cloud_id='cloud-2',
        )
        other_workspace = self._get_groups_config(fallback=self._legacy_config()).get_json()

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['groups'][0]['adHocCapacityEpics'], ['PRODUCT-ADHOC'])
        self.assertEqual(other_workspace['groups'][0]['adHocCapacityEpics'], [])

    def test_post_groups_config_rejects_identity_spoofing_fields(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
            'defaultGroupId': 'platform',
            'workspaceId': 'other-workspace',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'unsupported_group_config_field')

    def test_post_groups_config_requires_explicit_clear_groups_for_final_delete(self):
        loaded = self._get_groups_config().get_json()
        payload = {'version': 1, 'baseRevision': loaded['configRevision'], 'groups': [], 'defaultGroupId': ''}
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            implicit = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())
            explicit = self.client.post(
                '/api/groups-config',
                json={**payload, 'clearGroups': True},
                headers=self._csrf_headers(),
            )

        self.assertEqual(implicit.status_code, 400, implicit.get_data(as_text=True))
        self.assertEqual(implicit.get_json()['error'], 'team_groups_cannot_be_cleared_implicitly')
        self.assertEqual(explicit.status_code, 200, explicit.get_data(as_text=True))

    def test_post_group_preferences_saves_user_visibility_without_catalog_change(self):
        before = self._get_groups_config().get_json()
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers=self._csrf_headers(),
            )
        after = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['preferences']['visibleGroupIds'], ['platform'])
        self.assertEqual(after['groups'], before['groups'])
        self.assertFalse(after['preferences']['onboardingRequired'])

    def test_post_group_preferences_rejects_json_mode_and_identity_spoofing_fields(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}, clear=False):
            json_mode = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers=self._csrf_headers(),
            )
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            spoofed = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'workspaceId': 'other-workspace'},
                headers=self._csrf_headers(),
            )

        self.assertEqual(json_mode.status_code, 409, json_mode.get_data(as_text=True))
        self.assertEqual(json_mode.get_json()['error'], 'group_preferences_db_required')
        self.assertEqual(spoofed.status_code, 400, spoofed.get_data(as_text=True))
        self.assertEqual(spoofed.get_json()['error'], 'unsupported_group_preference_field')

    def test_post_group_preferences_rejects_invalid_json_and_non_object_payloads(self):
        self._get_groups_config(fallback=self._favorite_config())
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            malformed = self.client.post(
                '/api/groups-preferences',
                data='{',
                content_type='application/json',
                headers=self._csrf_headers(),
            )
            non_object = self.client.post(
                '/api/groups-preferences',
                json=['platform'],
                headers=self._csrf_headers(),
            )
            wrong_content_type = self.client.post(
                '/api/groups-preferences',
                data='visibleGroupIds=platform',
                content_type='application/x-www-form-urlencoded',
                headers=self._csrf_headers(),
            )

        self.assertEqual(malformed.status_code, 400, malformed.get_data(as_text=True))
        self.assertEqual(malformed.get_json()['error'], 'invalid_json')
        self.assertEqual(non_object.status_code, 400, non_object.get_data(as_text=True))
        self.assertEqual(non_object.get_json()['error'], 'invalid_group_preferences')
        self.assertEqual(wrong_content_type.status_code, 400, wrong_content_type.get_data(as_text=True))
        self.assertEqual(wrong_content_type.get_json()['error'], 'invalid_json')

    def test_post_group_preferences_rejects_missing_extra_and_invalid_first_run_fields(self):
        self._get_groups_config(fallback=self._favorite_config())
        invalid_payloads = (
            {},
            {'visibleGroupIds': ['platform']},
            {'activeGroupId': 'platform'},
            {'visibleGroupIds': [], 'activeGroupId': None},
            {'visibleGroupIds': ['platform', 'mobile'], 'activeGroupId': 'platform'},
            {'visibleGroupIds': ['platform'], 'activeGroupId': None},
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'mobile'},
            {'visibleGroupIds': ['platform', 'platform'], 'activeGroupId': 'platform'},
            {'visibleGroupIds': ['unknown'], 'activeGroupId': 'unknown'},
            {'visibleGroupIds': ['empty'], 'activeGroupId': 'empty'},
            {'visibleGroupIds': 'platform', 'activeGroupId': 'platform'},
            {'visibleGroupIds': ['platform'], 'activeGroupId': 7},
        )
        unsupported_fields = (
            'defaultGroupId',
            'workspaceId',
            'workspace_id',
            'userId',
            'user_id',
            'cloudId',
            'cloud_id',
            'siteUrl',
            'site_url',
            'accountId',
            'account_id',
            'futureField',
        )
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            invalid_responses = [
                self.client.post('/api/groups-preferences', json=payload, headers=self._csrf_headers())
                for payload in invalid_payloads
            ]
            unsupported_responses = [
                self.client.post(
                    '/api/groups-preferences',
                    json={
                        'visibleGroupIds': ['platform'],
                        'activeGroupId': 'platform',
                        field: 'forbidden',
                    },
                    headers=self._csrf_headers(),
                )
                for field in unsupported_fields
            ]

        for response in invalid_responses:
            self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['error'], 'invalid_group_preferences')
        for response in unsupported_responses:
            self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['error'], 'unsupported_group_preference_field')

    def test_post_group_preferences_returns_canonical_snapshot_and_last_write_wins(self):
        before = self._get_groups_config(fallback=self._favorite_config()).get_json()
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            first = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['default'], 'activeGroupId': 'default'},
                headers=self._csrf_headers(),
            )
            second = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['mobile'], 'activeGroupId': 'mobile'},
                headers=self._csrf_headers(),
            )
        after = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        first_body = first.get_json()
        self.assertEqual(set(first_body), {'preferences', 'groupsConfigSnapshot'})
        self.assertEqual(first_body['groupsConfigSnapshot']['preferences'], first_body['preferences'])
        self.assertEqual(first_body['groupsConfigSnapshot']['source'], 'workspace_db')
        self.assertEqual(first_body['groupsConfigSnapshot']['configRevision'], before['configRevision'])
        selected_group = next(
            group for group in first_body['groupsConfigSnapshot']['groups']
            if group['id'] == 'default'
        )
        self.assertEqual(selected_group['teamIds'], ['team-default'])
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        self.assertEqual(after['preferences']['visibleGroupIds'], ['mobile'])
        self.assertEqual(after['preferences']['activeGroupId'], 'mobile')

    def test_group_preference_responses_preserve_onboarding_done_without_changing_groups_or_favorite(self):
        before = self._get_groups_config(fallback=self._favorite_config()).get_json()
        self.assertFalse(before['preferences']['onboardingDone'])
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            saved = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers=self._csrf_headers(),
            )
        after = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        saved_body = saved.get_json()
        self.assertFalse(saved_body['preferences']['onboardingDone'])
        self.assertFalse(saved_body['groupsConfigSnapshot']['preferences']['onboardingDone'])
        self.assertEqual(saved_body['preferences']['activeGroupId'], 'platform')
        self.assertEqual(after['groups'], before['groups'])
        self.assertEqual(after['preferences']['activeGroupId'], 'platform')
        self.assertFalse(after['preferences']['onboardingDone'])

        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}, clear=False), \
             patch.object(jira_server, 'load_dashboard_config', return_value=self._favorite_config()):
            json_mode = self.client.get('/api/groups-config')

        self.assertEqual(json_mode.status_code, 200, json_mode.get_data(as_text=True))
        self.assertTrue(json_mode.get_json()['preferences']['onboardingDone'])

    def test_post_group_preferences_requires_requested_with_and_token_bound_csrf(self):
        self._get_groups_config(fallback=self._favorite_config())
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            csrf_headers = self._csrf_headers()
            missing_requested_with = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers={'X-CSRF-Token': csrf_headers['X-CSRF-Token']},
            )
            missing_csrf = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(missing_requested_with.status_code, 403, missing_requested_with.get_data(as_text=True))
        self.assertEqual(missing_csrf.status_code, 403, missing_csrf.get_data(as_text=True))

    def test_post_onboarding_updates_only_scalar_and_is_idempotent(self):
        self.assertEqual(self._save_personal_favorite().status_code, 200)
        before = self._get_groups_config(fallback={'version': 1}).get_json()

        first = self._post_onboarding({'onboardingDone': True})
        repeated = self._post_onboarding({'onboardingDone': True})
        replay = self._post_onboarding({'onboardingDone': False})
        after = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(first.get_json(), {'onboardingDone': True})
        self.assertEqual(repeated.status_code, 200, repeated.get_data(as_text=True))
        self.assertEqual(repeated.get_json(), {'onboardingDone': True})
        self.assertEqual(replay.status_code, 200, replay.get_data(as_text=True))
        self.assertEqual(replay.get_json(), {'onboardingDone': False})
        self.assertEqual(after['groups'], before['groups'])
        self.assertEqual(after['preferences']['visibleGroupIds'], ['platform'])
        self.assertEqual(after['preferences']['activeGroupId'], 'platform')
        self.assertFalse(after['preferences']['onboardingDone'])
        with self.factory() as session:
            rows = session.query(models.UserGroupPreference).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].visible_group_ids, ['platform'])
        self.assertEqual(rows[0].active_group_id, 'platform')
        self.assertTrue(rows[0].customized)
        self.assertFalse(rows[0].onboarding_done)

    def test_post_onboarding_rejects_invalid_json_and_non_object_payloads(self):
        self._get_groups_config(fallback=self._favorite_config())
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            malformed = self.client.post(
                '/api/me/onboarding',
                data='{',
                content_type='application/json',
                headers=self._csrf_headers(),
            )
            non_object = self.client.post(
                '/api/me/onboarding',
                json=['onboardingDone'],
                headers=self._csrf_headers(),
            )
            wrong_content_type = self.client.post(
                '/api/me/onboarding',
                data='onboardingDone=true',
                content_type='application/x-www-form-urlencoded',
                headers=self._csrf_headers(),
            )

        for response in (malformed, non_object, wrong_content_type):
            self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), {'error': 'invalid_json'})

    def test_post_onboarding_rejects_extra_and_spoofed_fields_before_service(self):
        self._get_groups_config(fallback=self._favorite_config())
        unsupported_fields = (
            'workspaceId',
            'workspace_id',
            'userId',
            'user_id',
            'cloudId',
            'cloud_id',
            'siteUrl',
            'site_url',
            'accountId',
            'account_id',
            'futureField',
        )

        for field in unsupported_fields:
            with self.subTest(field=field):
                response = self._post_onboarding({'onboardingDone': True, field: 'forbidden'})
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json(), {'error': 'unsupported_onboarding_field'})

    def test_post_onboarding_requires_a_boolean_done_field(self):
        self._get_groups_config(fallback=self._favorite_config())
        invalid_payloads = (
            {},
            {'onboardingDone': None},
            {'onboardingDone': 1},
            {'onboardingDone': 'true'},
            {'onboardingDone': []},
        )

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self._post_onboarding(payload)
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json(), {'error': 'onboarding_done_required'})

    def test_post_onboarding_requires_current_personal_group_selection_without_creating_rows(self):
        missing = self._post_onboarding({'onboardingDone': True})

        self.assertEqual(missing.status_code, 409, missing.get_data(as_text=True))
        self.assertEqual(missing.get_json(), {'error': 'group_selection_required'})
        with self.factory() as session:
            self.assertEqual(session.query(models.UserGroupPreference).count(), 0)
            self.assertEqual(session.query(models.WorkspaceGroupConfig).count(), 0)

    def test_post_onboarding_rejects_json_mode(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}, clear=False):
            response = self.client.post(
                '/api/me/onboarding',
                json={'onboardingDone': True},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'error': 'onboarding_db_required'})

    def test_post_onboarding_requires_requested_with_and_token_bound_csrf(self):
        self.assertEqual(self._save_personal_favorite().status_code, 200)
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            csrf_headers = self._csrf_headers()
            missing_requested_with = self.client.post(
                '/api/me/onboarding',
                json={'onboardingDone': True},
                headers={'X-CSRF-Token': csrf_headers['X-CSRF-Token']},
            )
            missing_csrf = self.client.post(
                '/api/me/onboarding',
                json={'onboardingDone': True},
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(missing_requested_with.status_code, 403, missing_requested_with.get_data(as_text=True))
        self.assertEqual(missing_csrf.status_code, 403, missing_csrf.get_data(as_text=True))

    def test_post_onboarding_requires_authentication_with_safe_login_url(self):
        unauthenticated_client = jira_server.app.test_client()
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = unauthenticated_client.post(
                '/api/me/onboarding',
                json={'onboardingDone': True},
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertEqual(response.get_json()['loginUrl'], '/login?reason=session_expired')
        self.assertNotIn('code=', response.get_json()['loginUrl'])
        self.assertNotIn('state=', response.get_json()['loginUrl'])

    def test_post_onboarding_is_isolated_per_authenticated_user(self):
        self.assertEqual(self._save_personal_favorite().status_code, 200)
        self._install_session('session-2', 'account-2', self.other_connection_id)
        self.assertEqual(self._save_personal_favorite().status_code, 200)
        self._install_session('session-1', 'account-1', self.connection_id)

        saved = self._post_onboarding({'onboardingDone': True})
        self._install_session('session-2', 'account-2', self.other_connection_id)
        other_preferences = self._get_groups_config(fallback={'version': 1}).get_json()['preferences']

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(saved.get_json(), {'onboardingDone': True})
        self.assertFalse(other_preferences['onboardingDone'])

    def test_post_onboarding_is_isolated_per_authenticated_workspace(self):
        self.assertEqual(self._save_personal_favorite().status_code, 200)
        with self.factory() as session:
            other_workspace = models.Workspace(
                environment_key='other-workspace',
                name='Other Workspace',
                jira_site_url='https://other.example.atlassian.net',
                jira_cloud_id='cloud-2',
                created_by='test',
            )
            session.add(other_workspace)
            session.flush()
            other_connection = models.AuthConnection(
                user_id=self.user_id,
                workspace_id=other_workspace.id,
                provider='atlassian_oauth',
                site_url=other_workspace.jira_site_url,
                cloud_id=other_workspace.jira_cloud_id,
                scopes=FULL_OAUTH_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(other_connection)
            session.commit()
            other_workspace_id = other_workspace.id
            other_connection_id = other_connection.id

        self._install_session(
            'session-other-workspace',
            'account-1',
            other_connection_id,
            site_url='https://other.example.atlassian.net',
            cloud_id='cloud-2',
        )
        self.assertEqual(self._save_personal_favorite().status_code, 200)
        self._install_session('session-1', 'account-1', self.connection_id)

        saved = self._post_onboarding({'onboardingDone': True})

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        with self.factory() as session:
            rows = {
                row.workspace_id: row
                for row in session.query(models.UserGroupPreference).filter_by(user_id=self.user_id)
            }
        self.assertTrue(rows[self.workspace_id].onboarding_done)
        self.assertFalse(rows[other_workspace_id].onboarding_done)


if __name__ == '__main__':
    unittest.main()
