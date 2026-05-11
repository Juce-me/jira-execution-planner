import base64
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from backend.auth.key_provider import key_provider_from_env
from backend.auth.token_crypto import decrypt_token, encrypt_token
from backend.db import engine as db_engine
from backend.db import models
import jira_server


REPO_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = REPO_ROOT / 'backend' / 'db' / 'alembic.ini'
FULL_SCOPE = (
    'read:me read:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


def migration_config(database_url):
    config = Config(str(ALEMBIC_INI))
    config.set_main_option('sqlalchemy.url', database_url)
    config.set_main_option('script_location', str(REPO_ROOT / 'backend' / 'db' / 'migrations'))
    return config


class UserApiTokenConnectionSchemaTests(unittest.TestCase):
    def test_followup_migration_adds_subject_capabilities_and_user_token_index(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'user-token-migration.db')}"
            config = migration_config(database_url)

            command.upgrade(config, '20260511_0001')
            engine = create_engine(database_url, future=True)
            with engine.begin() as connection:
                connection.execute(text(
                    "insert into users (id, external_provider, external_subject, account_type, status, created_by, created_at, updated_at) "
                    "values ('user-1', 'atlassian', 'account-1', 'user', 'active', 'test', '2026-05-11', '2026-05-11')"
                ))
                connection.execute(text(
                    "insert into workspaces (id, environment_key, name, jira_site_url, jira_cloud_id, created_by, created_at, updated_at) "
                    "values ('workspace-1', 'local', 'Local', 'https://example.atlassian.net', 'cloud-1', 'test', '2026-05-11', '2026-05-11')"
                ))
                connection.execute(text(
                    "insert into auth_connections (id, user_id, workspace_id, provider, site_url, cloud_id, scopes, status, token_version, created_at, updated_at) "
                    "values ('connection-1', 'user-1', 'workspace-1', 'atlassian_oauth', 'https://example.atlassian.net', 'cloud-1', '[]', 'active', 1, '2026-05-11', '2026-05-11')"
                ))
            engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            try:
                inspector = inspect(engine)
                columns = {column['name']: column for column in inspector.get_columns('auth_connections')}
                indexes = {index['name']: index for index in inspector.get_indexes('auth_connections')}
                with engine.connect() as connection:
                    capabilities = connection.execute(
                        text("select capabilities from auth_connections where id = 'connection-1'")
                    ).scalar_one()
            finally:
                engine.dispose()

            self.assertIn('credential_subject', columns)
            self.assertIn('capabilities', columns)
            self.assertFalse(columns['capabilities']['nullable'])
            self.assertIn('uq_auth_connections_user_api_token_cloud', indexes)
            self.assertTrue(indexes['uq_auth_connections_user_api_token_cloud']['unique'])
            self.assertEqual(capabilities, '[]')

    def test_provider_constraints_separate_user_tokens_from_service_integrations(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'provider-contract.db')}"
            engine = db_engine.get_engine(database_url)
            models.Base.metadata.create_all(engine)
            factory = db_engine.session_factory(database_url)
            with factory() as session:
                workspace = models.Workspace(
                    environment_key='local',
                    name='Local',
                    jira_site_url='https://example.atlassian.net',
                    jira_cloud_id='cloud-1',
                    created_by='test',
                )
                user = models.User(
                    external_provider='atlassian',
                    external_subject='account-1',
                    account_type='user',
                    status='active',
                    created_by='test',
                )
                session.add_all([workspace, user])
                session.flush()

                session.add(models.ServiceIntegration(
                    workspace_id=workspace.id,
                    provider='atlassian_user_api_token',
                    credential_subject='user@example.com',
                    status='active',
                ))
                with self.assertRaises(IntegrityError):
                    session.commit()
                session.rollback()

                session.add(models.AuthConnection(
                    user_id=user.id,
                    workspace_id=workspace.id,
                    provider='home_townsquare_basic',
                    site_url='https://example.atlassian.net',
                    cloud_id='cloud-1',
                    status='active',
                ))
                with self.assertRaises(IntegrityError):
                    session.commit()

    def test_user_api_token_connection_defaults_capabilities(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'capabilities.db')}"
            engine = db_engine.get_engine(database_url)
            models.Base.metadata.create_all(engine)
            factory = db_engine.session_factory(database_url)
            with factory() as session:
                workspace = models.Workspace(
                    environment_key='local',
                    name='Local',
                    jira_site_url='https://example.atlassian.net',
                    jira_cloud_id='cloud-1',
                    created_by='test',
                )
                user = models.User(
                    external_provider='atlassian',
                    external_subject='account-1',
                    account_type='user',
                    status='active',
                    created_by='test',
                )
                session.add_all([workspace, user])
                session.flush()
                connection = models.AuthConnection(
                    user_id=user.id,
                    workspace_id=workspace.id,
                    provider='atlassian_user_api_token',
                    site_url='https://example.atlassian.net',
                    cloud_id='cloud-1',
                    credential_subject='user@example.com',
                    status='active',
                )
                session.add(connection)
                session.commit()
                session.refresh(connection)

                self.assertEqual(connection.capabilities, [])


class UserApiTokenConnectionTokenTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'user-token-admin.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([21]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })
        self.workspace_id, self.admin_connection_id = self._seed_oauth_user('admin-account', 'admin')
        self.normal_user_id, self.user_token_connection_id = self._seed_user_api_token_connection()

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_oauth_user(self, account_id, account_type):
        with self.factory() as session:
            workspace = session.query(models.Workspace).first()
            if workspace is None:
                workspace = models.Workspace(
                    environment_key='local',
                    name='Local',
                    jira_site_url='https://example.atlassian.net',
                    jira_cloud_id='cloud-1',
                    created_by='test',
                )
                session.add(workspace)
                session.flush()
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                email=f'{account_id}@example.com',
                account_type=account_type,
                status='active',
                created_by='test',
            )
            session.add(user)
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url='https://example.atlassian.net',
                cloud_id='cloud-1',
                scopes=FULL_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            return workspace.id, connection.id

    def _seed_user_api_token_connection(self):
        plaintext_token = 'plain-user-api-token-123'
        with self.factory() as session:
            workspace = session.get(models.Workspace, self.workspace_id)
            user = models.User(
                external_provider='atlassian',
                external_subject='normal-account',
                email='normal@example.com',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add(user)
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_user_api_token',
                site_url=workspace.jira_site_url,
                cloud_id=workspace.jira_cloud_id,
                credential_subject='normal@example.com',
                capabilities=['home_townsquare_graphql'],
                status='active',
                token_version=1,
            )
            session.add(connection)
            session.flush()
            envelope = encrypt_token(
                plaintext_token,
                workspace_id=workspace.id,
                auth_connection_id=connection.id,
                token_kind='api_token',
                key_provider=self.key_provider,
            )
            token = models.AuthToken(
                connection_id=connection.id,
                token_kind='api_token',
                algorithm=envelope.algorithm,
                ciphertext=envelope.ciphertext,
                nonce=envelope.nonce,
                wrapped_dek=envelope.wrapped_dek,
                key_id=envelope.key_id,
                aad_hash=envelope.aad_hash,
            )
            session.add(token)
            session.add(models.audit_event(
                workspace_id=workspace.id,
                actor_user_id=user.id,
                auth_connection_id=connection.id,
                event_type='user_api_token_connected',
                metadata={'api_token': plaintext_token},
            ))
            session.commit()

            self.assertNotIn(plaintext_token, repr(connection))
            self.assertNotIn(plaintext_token, repr(token))
            self.assertNotIn(plaintext_token, token.ciphertext)
            return user.id, connection.id

    def _install_admin_session(self):
        session_id = 'session-admin'
        with self.client.session_transaction() as flask_session:
            flask_session['atlassian_oauth_session_id'] = session_id
        jira_server.OAUTH_TOKEN_STORE[session_id] = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 3600,
            'scope': FULL_SCOPE,
            'cloudid': 'cloud-1',
            'site_url': 'https://example.atlassian.net',
            'site_name': 'Example',
            'account_id': 'admin-account',
            'account_status': 'active',
            'db_auth_connection_id': self.admin_connection_id,
            'db_token_version': '1',
            'stored_at': time.time(),
        }

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([21]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }, clear=False)

    def test_api_token_rows_for_user_connection_do_not_leak_token_material(self):
        self._install_admin_session()

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            users_response = self.client.get('/api/admin/users')
            audit_response = self.client.get('/api/admin/audit-events')

        self.assertEqual(users_response.status_code, 200, users_response.get_data(as_text=True))
        self.assertEqual(audit_response.status_code, 200, audit_response.get_data(as_text=True))
        rendered_users = str(users_response.get_json())
        rendered_audit = str(audit_response.get_json())
        self.assertIn('atlassian_user_api_token', rendered_users)
        self.assertNotIn('plain-user-api-token-123', rendered_users)
        self.assertNotIn('ciphertext', rendered_users)
        self.assertNotIn('wrapped_dek', rendered_users)
        self.assertNotIn('plain-user-api-token-123', rendered_audit)
        self.assertIn('[redacted]', rendered_audit)


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


class TestUserApiTokenConnections(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'home-token-routes.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([22]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })
        self.workspace_id, self.user_id, self.oauth_connection_id = self._seed_oauth_user(
            account_id='normal-account',
            email='normal@example.com',
        )

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_oauth_user(self, *, account_id, email=None):
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                email=email,
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
                site_url=workspace.jira_site_url,
                cloud_id=workspace.jira_cloud_id,
                scopes=FULL_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            return workspace.id, user.id, connection.id

    def _install_session(self, *, email='normal@example.com'):
        session_id = 'session-normal'
        with self.client.session_transaction() as flask_session:
            flask_session['atlassian_oauth_session_id'] = session_id
        data = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 3600,
            'scope': FULL_SCOPE,
            'cloudid': 'cloud-1',
            'site_url': 'https://example.atlassian.net',
            'site_name': 'Example',
            'account_id': 'normal-account',
            'account_status': 'active',
            'db_auth_connection_id': self.oauth_connection_id,
            'db_token_version': '1',
            'stored_at': time.time(),
        }
        if email is not None:
            data['email'] = email
        jira_server.OAUTH_TOKEN_STORE[session_id] = data

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([22]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }, clear=False)

    def _csrf(self):
        response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()['csrfToken']

    def _headers(self, csrf_token):
        return {
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': csrf_token,
        }

    def _post_home_token(self, body, csrf_token=None):
        headers = {'X-Requested-With': 'jira-execution-planner'}
        if csrf_token is not None:
            headers['X-CSRF-Token'] = csrf_token
        return self.client.post('/api/me/connections/home-token', json=body, headers=headers)

    def _delete_home_token(self, csrf_token):
        return self.client.delete('/api/me/connections/home-token', headers=self._headers(csrf_token))

    def _connection_and_token(self):
        with self.factory() as session:
            connection = session.query(models.AuthConnection).filter_by(
                user_id=self.user_id,
                workspace_id=self.workspace_id,
                provider='atlassian_user_api_token',
            ).first()
            token = None
            if connection is not None:
                token = session.query(models.AuthToken).filter_by(
                    connection_id=connection.id,
                    token_kind='api_token',
                ).first()
            return connection, token

    def test_connect_get_and_revoke_home_token_for_normal_user(self):
        self._install_session()

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.auth.user_api_tokens.fetch_jira_myself_with_basic_auth', return_value={'accountId': 'normal-account'}), \
             patch('backend.auth.user_api_tokens.probe_home_basic_credential', return_value=True):
            missing = self.client.get('/api/me/connections/home-token')
            self.assertEqual(missing.status_code, 200, missing.get_data(as_text=True))
            self.assertEqual(missing.get_json(), {'connected': False})

            connect = self._post_home_token(
                {'email': 'normal@example.com', 'apiToken': 'plain-user-api-token-456'},
                self._csrf(),
            )
            self.assertEqual(connect.status_code, 200, connect.get_data(as_text=True))
            body = connect.get_json()
            self.assertEqual(body['connected'], True)
            self.assertEqual(body['provider'], 'atlassian_user_api_token')
            self.assertEqual(body['credentialSubject'], 'normal@example.com')
            self.assertEqual(body['status'], 'active')
            self.assertEqual(body['needsReconnect'], False)
            self.assertIn('lastValidatedAt', body)
            self.assertNotIn('apiToken', str(body))
            self.assertNotIn('plain-user-api-token-456', str(body))

            connected = self.client.get('/api/me/connections/home-token')
            self.assertEqual(connected.status_code, 200, connected.get_data(as_text=True))
            self.assertEqual(set(connected.get_json().keys()), {
                'connected',
                'provider',
                'credentialSubject',
                'status',
                'lastValidatedAt',
                'needsReconnect',
            })

            revoke = self._delete_home_token(self._csrf())
            self.assertEqual(revoke.status_code, 200, revoke.get_data(as_text=True))
            self.assertEqual(revoke.get_json(), {'connected': False})

        connection, token = self._connection_and_token()
        self.assertIsNotNone(connection)
        self.assertEqual(connection.status, 'revoked')
        self.assertEqual(connection.token_version, 2)
        self.assertIsNone(token)

    def test_connect_uses_oauth_profile_email_when_body_email_missing(self):
        self._install_session(email='profile@example.com')

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.auth.user_api_tokens.fetch_jira_myself_with_basic_auth', return_value={'accountId': 'normal-account'}), \
             patch('backend.auth.user_api_tokens.probe_home_basic_credential', return_value=True):
            response = self._post_home_token({'apiToken': 'plain-user-api-token-456'}, self._csrf())

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['credentialSubject'], 'profile@example.com')
        connection, token = self._connection_and_token()
        self.assertEqual(connection.credential_subject, 'profile@example.com')
        decrypted = decrypt_token(
            {
                'algorithm': token.algorithm,
                'ciphertext': token.ciphertext,
                'nonce': token.nonce,
                'wrapped_dek': token.wrapped_dek,
                'key_id': token.key_id,
                'aad_hash': token.aad_hash,
            },
            workspace_id=self.workspace_id,
            auth_connection_id=connection.id,
            token_kind='api_token',
            key_provider=self.key_provider,
        )
        self.assertEqual(decrypted, 'plain-user-api-token-456')

    def test_missing_email_returns_credential_email_required(self):
        self._install_session(email=None)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self._post_home_token({'apiToken': 'plain-user-api-token-456'}, self._csrf())

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'credential_email_required')

    def test_post_home_token_requires_token_bound_csrf(self):
        self._install_session()

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self._post_home_token({'email': 'normal@example.com', 'apiToken': 'plain-user-api-token-456'})

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'csrf_required')

    def test_home_credential_rejected_when_home_probe_fails(self):
        self._install_session()

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.auth.user_api_tokens.fetch_jira_myself_with_basic_auth', return_value={'accountId': 'normal-account'}), \
             patch('backend.auth.user_api_tokens.probe_home_basic_credential', return_value=False):
            response = self._post_home_token(
                {'email': 'normal@example.com', 'apiToken': 'plain-user-api-token-456'},
                self._csrf(),
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'home_credential_not_authorized')
        connection, token = self._connection_and_token()
        self.assertIsNone(connection)
        self.assertIsNone(token)

    def test_credential_subject_mismatch_when_account_id_differs(self):
        self._install_session()

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.auth.user_api_tokens.fetch_jira_myself_with_basic_auth', return_value={'accountId': 'other-account'}), \
             patch('backend.auth.user_api_tokens.probe_home_basic_credential') as home_probe:
            response = self._post_home_token(
                {'email': 'normal@example.com', 'apiToken': 'plain-user-api-token-456'},
                self._csrf(),
            )

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'credential_subject_mismatch')
        home_probe.assert_not_called()
        connection, token = self._connection_and_token()
        self.assertIsNone(connection)
        self.assertIsNone(token)


if __name__ == '__main__':
    unittest.main()
