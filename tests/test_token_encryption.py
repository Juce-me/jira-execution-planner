import base64
import unittest

from backend.auth.key_provider import KeyProviderConfigurationError, LocalKeyProvider, key_provider_from_env
from backend.auth.token_crypto import (
    TokenCryptoError,
    decrypt_token,
    encrypt_token,
    redact_token_material,
)


def _key(byte_value):
    return bytes([byte_value]) * 32


class TokenEncryptionTests(unittest.TestCase):
    def test_auth_token_ciphertext_is_not_plaintext_and_decrypts(self):
        provider = LocalKeyProvider(primary_key_id='local-v1', primary_key=_key(1))

        envelope = encrypt_token(
            'access-token-123',
            workspace_id='workspace-1',
            auth_connection_id='connection-1',
            token_kind='access_token',
            key_provider=provider,
        )

        self.assertEqual(envelope.algorithm, 'AES-256-GCM')
        self.assertEqual(envelope.key_id, 'local-v1')
        self.assertNotIn('access-token-123', envelope.ciphertext)
        self.assertNotIn('access-token-123', envelope.wrapped_dek)
        self.assertEqual(
            decrypt_token(
                envelope,
                workspace_id='workspace-1',
                auth_connection_id='connection-1',
                token_kind='access_token',
                key_provider=provider,
            ),
            'access-token-123',
        )

    def test_aad_prevents_cross_connection_decrypt(self):
        provider = LocalKeyProvider(primary_key_id='local-v1', primary_key=_key(2))
        envelope = encrypt_token(
            'refresh-token-123',
            workspace_id='workspace-1',
            auth_connection_id='connection-1',
            token_kind='refresh_token',
            key_provider=provider,
        )

        with self.assertRaises(TokenCryptoError):
            decrypt_token(
                envelope,
                workspace_id='workspace-1',
                auth_connection_id='connection-2',
                token_kind='refresh_token',
                key_provider=provider,
            )

    def test_service_integration_token_binds_service_id(self):
        provider = LocalKeyProvider(primary_key_id='local-v1', primary_key=_key(3))
        envelope = encrypt_token(
            'home-service-api-token',
            workspace_id='workspace-1',
            service_integration_id='service-1',
            token_kind='api_token',
            key_provider=provider,
        )

        self.assertEqual(
            decrypt_token(
                envelope,
                workspace_id='workspace-1',
                service_integration_id='service-1',
                token_kind='api_token',
                key_provider=provider,
            ),
            'home-service-api-token',
        )
        with self.assertRaises(TokenCryptoError):
            decrypt_token(
                envelope,
                workspace_id='workspace-1',
                service_integration_id='service-2',
                token_kind='api_token',
                key_provider=provider,
            )

    def test_redacts_token_material_for_logs(self):
        redacted = redact_token_material({
            'access_token': 'access-123',
            'authorization': 'Bearer access-123',
            'nested': {
                'refresh_token': 'refresh-123',
                'status': 'ok',
            },
        })

        self.assertEqual(redacted['access_token'], '[redacted]')
        self.assertEqual(redacted['authorization'], '[redacted]')
        self.assertEqual(redacted['nested']['refresh_token'], '[redacted]')
        self.assertEqual(redacted['nested']['status'], 'ok')

    def test_production_refuses_local_master_key(self):
        environ = {
            'APP_ENVIRONMENT_KEY': 'production',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(_key(4)).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'prod-key',
        }

        with self.assertRaises(KeyProviderConfigurationError):
            key_provider_from_env(environ)

    def test_env_key_source_allows_master_key_outside_local_dev(self):
        env = {
            "APP_ENVIRONMENT_KEY": "production",
            "TOKEN_ENCRYPTION_KEY_SOURCE": "env",
            "TOKEN_ENCRYPTION_MASTER_KEY_B64": base64.b64encode(bytes([3]) * 32).decode("ascii"),
            "TOKEN_ENCRYPTION_KEY_ID": "container-key",
        }

        provider = key_provider_from_env(env)
        wrapped = provider.wrap_key(bytes([4]) * 32, b"aad")

        self.assertEqual(provider.primary_key_id(), "container-key")
        self.assertEqual(provider.unwrap_key(wrapped, b"aad"), bytes([4]) * 32)

    def test_key_id_only_external_provider_fails_closed_until_adapter_exists(self):
        env = {
            "APP_ENVIRONMENT_KEY": "production",
            "TOKEN_ENCRYPTION_KEY_ID": "kms-key",
        }

        with self.assertRaises(KeyProviderConfigurationError) as raised:
            key_provider_from_env(env)

        self.assertIn("TOKEN_ENCRYPTION_KEY_SOURCE=env", str(raised.exception))

    def test_local_key_provider_from_env(self):
        environ = {
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(_key(5)).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }

        provider = key_provider_from_env(environ)

        self.assertEqual(provider.primary_key_id(), 'local-key')


if __name__ == '__main__':
    unittest.main()
