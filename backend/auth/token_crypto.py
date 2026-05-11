"""Envelope encryption helpers for auth and service tokens."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


ALGORITHM = 'AES-256-GCM'
SENSITIVE_TOKEN_KEYS = {
    'access_token',
    'api_token',
    'authorization',
    'client_secret',
    'code',
    'code_verifier',
    'ciphertext',
    'oauth_code',
    'oauth_pkce_verifier',
    'pkce_verifier',
    'refresh_token',
    'token',
    'wrapped_dek',
}


class TokenCryptoError(RuntimeError):
    """Raised when encrypted token material cannot be used safely."""


@dataclass(frozen=True)
class TokenEnvelope:
    algorithm: str
    ciphertext: str
    nonce: str
    wrapped_dek: str
    key_id: str
    aad_hash: str


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode('ascii')


def _unb64(value: str, field_name: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except Exception as exc:
        raise TokenCryptoError(f'{field_name} must be valid base64.') from exc


def _token_subject(
    auth_connection_id: str | None = None,
    service_integration_id: str | None = None,
) -> tuple[str, str]:
    if bool(auth_connection_id) == bool(service_integration_id):
        raise TokenCryptoError('Exactly one auth_connection_id or service_integration_id is required.')
    if auth_connection_id:
        return 'auth_connection_id', str(auth_connection_id)
    return 'service_integration_id', str(service_integration_id)


def _aad(
    *,
    workspace_id: str,
    token_kind: str,
    key_id: str,
    auth_connection_id: str | None = None,
    service_integration_id: str | None = None,
) -> bytes:
    subject_key, subject_value = _token_subject(auth_connection_id, service_integration_id)
    payload = {
        'key_id': str(key_id),
        'token_kind': str(token_kind),
        'workspace_id': str(workspace_id),
        subject_key: subject_value,
    }
    return json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')


def _aad_hash(aad: bytes) -> str:
    return hashlib.sha256(aad).hexdigest()


def encrypt_token(
    plaintext: str,
    *,
    workspace_id: str,
    token_kind: str,
    key_provider,
    auth_connection_id: str | None = None,
    service_integration_id: str | None = None,
) -> TokenEnvelope:
    key_id = key_provider.primary_key_id()
    aad = _aad(
        workspace_id=workspace_id,
        token_kind=token_kind,
        key_id=key_id,
        auth_connection_id=auth_connection_id,
        service_integration_id=service_integration_id,
    )
    dek = secrets.token_bytes(32)
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(dek).encrypt(nonce, str(plaintext).encode('utf-8'), aad)
    return TokenEnvelope(
        algorithm=ALGORITHM,
        ciphertext=_b64(ciphertext),
        nonce=_b64(nonce),
        wrapped_dek=key_provider.wrap_key(dek, aad),
        key_id=key_id,
        aad_hash=_aad_hash(aad),
    )


def _envelope_value(envelope: TokenEnvelope | dict[str, Any], field_name: str) -> str:
    if isinstance(envelope, dict):
        value = envelope.get(field_name)
    else:
        value = getattr(envelope, field_name)
    return str(value or '')


def decrypt_token(
    envelope: TokenEnvelope | dict[str, Any],
    *,
    workspace_id: str,
    token_kind: str,
    key_provider,
    auth_connection_id: str | None = None,
    service_integration_id: str | None = None,
) -> str:
    if _envelope_value(envelope, 'algorithm') != ALGORITHM:
        raise TokenCryptoError('Unsupported token encryption algorithm.')
    key_id = _envelope_value(envelope, 'key_id')
    aad = _aad(
        workspace_id=workspace_id,
        token_kind=token_kind,
        key_id=key_id,
        auth_connection_id=auth_connection_id,
        service_integration_id=service_integration_id,
    )
    if _envelope_value(envelope, 'aad_hash') != _aad_hash(aad):
        raise TokenCryptoError('Token associated data does not match this row.')
    try:
        dek = key_provider.unwrap_key(_envelope_value(envelope, 'wrapped_dek'), aad)
        plaintext = AESGCM(dek).decrypt(
            _unb64(_envelope_value(envelope, 'nonce'), 'nonce'),
            _unb64(_envelope_value(envelope, 'ciphertext'), 'ciphertext'),
            aad,
        )
        return plaintext.decode('utf-8')
    except (InvalidTag, UnicodeDecodeError) as exc:
        raise TokenCryptoError('Token ciphertext could not be decrypted.') from exc


def redact_token_material(value):
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            normalized = str(key).strip().lower()
            if normalized in SENSITIVE_TOKEN_KEYS:
                redacted[key] = '[redacted]'
            else:
                redacted[key] = redact_token_material(item)
        return redacted
    if isinstance(value, list):
        return [redact_token_material(item) for item in value]
    if isinstance(value, str) and any(marker in value.lower() for marker in ('bearer ', 'basic ')):
        return '[redacted]'
    return value
