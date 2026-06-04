"""Token encryption key providers."""

from __future__ import annotations

import base64
import json
import os
import secrets
from dataclasses import dataclass
from typing import Protocol

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


LOCAL_KEY_ENVIRONMENTS = {'local', 'dev'}


class KeyProviderConfigurationError(RuntimeError):
    """Raised when token encryption keys are missing or unsafe."""


class KeyProvider(Protocol):
    def wrap_key(self, dek: bytes, aad: bytes) -> str:
        ...

    def unwrap_key(self, wrapped_dek: str, aad: bytes) -> bytes:
        ...

    def primary_key_id(self) -> str:
        ...


def _decode_key(value: str, label: str) -> bytes:
    try:
        key = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise KeyProviderConfigurationError(f'{label} must be valid base64.') from exc
    if len(key) != 32:
        raise KeyProviderConfigurationError(f'{label} must decode to 32 bytes.')
    return key


def _encode_payload(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return base64.urlsafe_b64encode(raw).decode('ascii')


def _decode_payload(value: str) -> dict:
    try:
        raw = base64.urlsafe_b64decode(value.encode('ascii'))
        payload = json.loads(raw.decode('utf-8'))
    except Exception as exc:
        raise KeyProviderConfigurationError('wrapped_dek is not a valid wrapped key payload.') from exc
    if not isinstance(payload, dict):
        raise KeyProviderConfigurationError('wrapped_dek must decode to an object.')
    return payload


@dataclass(frozen=True)
class LocalKeyProvider:
    primary_key_id_value: str
    primary_key: bytes
    retired_keys: dict[str, bytes] | None = None

    def __init__(self, primary_key_id: str, primary_key: bytes, retired_keys: dict[str, bytes] | None = None):
        if len(primary_key) != 32:
            raise KeyProviderConfigurationError('primary_key must be 32 bytes.')
        object.__setattr__(self, 'primary_key_id_value', primary_key_id)
        object.__setattr__(self, 'primary_key', primary_key)
        object.__setattr__(self, 'retired_keys', dict(retired_keys or {}))

    def primary_key_id(self) -> str:
        return self.primary_key_id_value

    def wrap_key(self, dek: bytes, aad: bytes) -> str:
        if len(dek) != 32:
            raise KeyProviderConfigurationError('Data encryption keys must be 32 bytes.')
        nonce = secrets.token_bytes(12)
        ciphertext = AESGCM(self.primary_key).encrypt(nonce, dek, aad)
        return _encode_payload({
            'key_id': self.primary_key_id(),
            'nonce': base64.b64encode(nonce).decode('ascii'),
            'ciphertext': base64.b64encode(ciphertext).decode('ascii'),
        })

    def unwrap_key(self, wrapped_dek: str, aad: bytes) -> bytes:
        payload = _decode_payload(wrapped_dek)
        key_id = str(payload.get('key_id') or '')
        key = self._keys_by_id().get(key_id)
        if not key:
            raise KeyProviderConfigurationError(f'No token encryption key available for key id {key_id!r}.')
        try:
            nonce = base64.b64decode(str(payload.get('nonce') or ''), validate=True)
            ciphertext = base64.b64decode(str(payload.get('ciphertext') or ''), validate=True)
            return AESGCM(key).decrypt(nonce, ciphertext, aad)
        except (InvalidTag, ValueError) as exc:
            raise KeyProviderConfigurationError('Wrapped data encryption key could not be decrypted.') from exc

    def _keys_by_id(self) -> dict[str, bytes]:
        keys = dict(self.retired_keys or {})
        keys[self.primary_key_id()] = self.primary_key
        return keys


@dataclass(frozen=True)
class ExternalKeyProvider:
    key_id: str

    def primary_key_id(self) -> str:
        return self.key_id

    def wrap_key(self, dek: bytes, aad: bytes) -> str:
        raise KeyProviderConfigurationError('External key provider adapter is not configured.')

    def unwrap_key(self, wrapped_dek: str, aad: bytes) -> bytes:
        raise KeyProviderConfigurationError('External key provider adapter is not configured.')


def _retired_keys_from_env(environ: dict[str, str]) -> dict[str, bytes]:
    raw_ids = str(environ.get('TOKEN_ENCRYPTION_RETIRED_KEY_IDS') or '').strip()
    raw_keys = str(environ.get('TOKEN_ENCRYPTION_RETIRED_KEYS_B64') or '').strip()
    if not raw_ids and not raw_keys:
        return {}
    key_ids = [item.strip() for item in raw_ids.split(',') if item.strip()]
    keys = [item.strip() for item in raw_keys.split(',') if item.strip()]
    if len(key_ids) != len(keys):
        raise KeyProviderConfigurationError('Retired token key ids and keys must have the same count.')
    return {
        key_id: _decode_key(key, f'TOKEN_ENCRYPTION_RETIRED_KEYS_B64[{index}]')
        for index, (key_id, key) in enumerate(zip(key_ids, keys))
    }


def key_provider_from_env(environ: dict[str, str] | None = None) -> KeyProvider:
    env = os.environ if environ is None else environ
    environment_key = str(env.get('APP_ENVIRONMENT_KEY') or 'local').strip().lower()
    local_key = str(env.get('TOKEN_ENCRYPTION_MASTER_KEY_B64') or '').strip()
    key_id = str(env.get('TOKEN_ENCRYPTION_KEY_ID') or '').strip()
    key_source = str(env.get('TOKEN_ENCRYPTION_KEY_SOURCE') or '').strip().lower()

    if local_key:
        if environment_key not in LOCAL_KEY_ENVIRONMENTS and key_source != 'env':
            raise KeyProviderConfigurationError(
                'TOKEN_ENCRYPTION_MASTER_KEY_B64 outside local/dev requires TOKEN_ENCRYPTION_KEY_SOURCE=env.'
            )
        return LocalKeyProvider(
            primary_key_id=key_id or ('local-dev' if environment_key in LOCAL_KEY_ENVIRONMENTS else 'env'),
            primary_key=_decode_key(local_key, 'TOKEN_ENCRYPTION_MASTER_KEY_B64'),
            retired_keys=_retired_keys_from_env(env),
        )
    if key_id:
        raise KeyProviderConfigurationError(
            'External token encryption key provider is not configured; use '
            'TOKEN_ENCRYPTION_KEY_SOURCE=env with TOKEN_ENCRYPTION_MASTER_KEY_B64 or add a real external adapter.'
        )
    raise KeyProviderConfigurationError('TOKEN_ENCRYPTION_MASTER_KEY_B64 or TOKEN_ENCRYPTION_KEY_ID is required.')
