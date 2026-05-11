import base64
import unittest

from backend.auth.key_provider import key_provider_from_env
from backend.auth.token_crypto import decrypt_token, encrypt_token


def _key(byte_value):
    return bytes([byte_value]) * 32


class TokenKeyRotationTests(unittest.TestCase):
    def test_retired_keys_decrypt_existing_rows_and_primary_key_encrypts_new_rows(self):
        old_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(_key(8)).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'old-key',
        })
        existing = encrypt_token(
            'existing-token',
            workspace_id='workspace-1',
            auth_connection_id='connection-1',
            token_kind='access_token',
            key_provider=old_provider,
        )

        rotated_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(_key(9)).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'new-key',
            'TOKEN_ENCRYPTION_RETIRED_KEY_IDS': 'old-key',
            'TOKEN_ENCRYPTION_RETIRED_KEYS_B64': base64.b64encode(_key(8)).decode('ascii'),
        })

        self.assertEqual(
            decrypt_token(
                existing,
                workspace_id='workspace-1',
                auth_connection_id='connection-1',
                token_kind='access_token',
                key_provider=rotated_provider,
            ),
            'existing-token',
        )

        new_envelope = encrypt_token(
            'new-token',
            workspace_id='workspace-1',
            auth_connection_id='connection-1',
            token_kind='access_token',
            key_provider=rotated_provider,
        )
        self.assertEqual(new_envelope.key_id, 'new-key')


if __name__ == '__main__':
    unittest.main()
