"""Direct Cloud SQL IAM connectivity for the synchronous psycopg stack."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import threading
from types import MappingProxyType
from typing import Mapping

import google.auth
from google.auth.credentials import Credentials
from google.auth.transport.requests import Request
import psycopg
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


CLOUD_SQL_LOGIN_SCOPE = "https://www.googleapis.com/auth/sqlservice.login"
CLOUD_SQL_CONNECT_TIMEOUT_SECONDS = 10
ALLOWED_CLOUD_SQL_SSLMODES = frozenset({"require", "verify-ca", "verify-full"})
ALLOWED_CLOUD_SQL_QUERY_KEYS = frozenset({
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslcrl",
    "sslcrldir",
    "sslsni",
    "ssl_min_protocol_version",
    "ssl_max_protocol_version",
    "channel_binding",
})


class CloudSqlConfigurationError(RuntimeError):
    """Raised when direct Cloud SQL IAM settings are missing or unsafe."""


class CloudSqlIamTokenError(RuntimeError):
    """Raised when a current IAM database login token cannot be obtained."""


class CloudSqlConnectionError(RuntimeError):
    """Raised when psycopg cannot establish a direct Cloud SQL connection."""


class IamLoginTokenProvider:
    def __init__(self, credentials: Credentials, request: Request):
        self._credentials = credentials
        self._request = request
        self._refresh_lock = threading.Lock()

    @classmethod
    def from_adc(cls) -> "IamLoginTokenProvider":
        credentials = None
        request = None
        discovery_failed = False
        try:
            credentials, _ = google.auth.default(
                scopes=(CLOUD_SQL_LOGIN_SCOPE,),
            )
            request = Request()
        except Exception:
            discovery_failed = True
        if discovery_failed or credentials is None or request is None:
            raise CloudSqlIamTokenError(
                "Cloud SQL IAM credentials are unavailable."
            )
        return cls(credentials, request)

    def current_token(self) -> str:
        validity_failed = False
        needs_refresh = False
        try:
            needs_refresh = not self._credentials.valid
        except Exception:
            validity_failed = True
        if validity_failed:
            raise CloudSqlIamTokenError(
                "Cloud SQL IAM credential state is unavailable."
            )

        if needs_refresh:
            with self._refresh_lock:
                refresh_failed = False
                try:
                    if not self._credentials.valid:
                        self._credentials.refresh(self._request)
                except Exception:
                    refresh_failed = True
                if refresh_failed:
                    raise CloudSqlIamTokenError(
                        "Cloud SQL IAM login token refresh failed."
                    )

        state_failed = False
        is_current = False
        token = None
        try:
            is_current = self._credentials.valid
            token = self._credentials.token
        except Exception:
            state_failed = True
        if state_failed:
            raise CloudSqlIamTokenError(
                "Cloud SQL IAM credential state is unavailable."
            )
        if not is_current:
            raise CloudSqlIamTokenError(
                "Cloud SQL IAM credential refresh did not return a current login token."
            )
        if not isinstance(token, str) or not token:
            raise CloudSqlIamTokenError(
                "Cloud SQL IAM credential refresh did not return a login token."
            )
        return token


@dataclass(frozen=True)
class CloudSqlIamConfig:
    safe_url: URL
    username: str
    host: str
    port: int
    database: str
    tls_options: Mapping[str, str]

    @classmethod
    def from_database_url(cls, database_url: str) -> "CloudSqlIamConfig":
        url = None
        try:
            url = make_url(database_url)
        except (ArgumentError, TypeError, ValueError):
            pass
        if url is None:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM mode requires a valid DATABASE_URL."
            )
        if url.drivername != "postgresql+psycopg":
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM mode requires the postgresql+psycopg driver."
            )
        if url.password is not None:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL must not contain a password."
            )
        if not url.username:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL requires an IAM database user."
            )
        if not url.host:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL requires a host."
            )
        port = None
        port_invalid = False
        try:
            port = url.port
        except ValueError:
            port_invalid = True
        if port_invalid:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL requires an explicit valid port."
            )
        if port is None or not 1 <= port <= 65535:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL requires an explicit valid port."
            )
        if not url.database:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL requires a database name."
            )

        repeated = [key for key, values in url.normalized_query.items() if len(values) != 1]
        if repeated:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL query options must have one value each."
            )
        unknown = set(url.query).difference(ALLOWED_CLOUD_SQL_QUERY_KEYS)
        if unknown:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM DATABASE_URL contains unsupported query options."
            )
        tls_options = {
            key: values[0]
            for key, values in url.normalized_query.items()
        }
        sslmode = tls_options.get("sslmode")
        if sslmode not in ALLOWED_CLOUD_SQL_SSLMODES:
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM mode requires TLS with sslmode=require, verify-ca, or verify-full."
            )
        if sslmode in {"verify-ca", "verify-full"} and not tls_options.get("sslrootcert"):
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM verify-ca and verify-full require sslrootcert."
            )
        if bool(tls_options.get("sslcert")) != bool(tls_options.get("sslkey")):
            raise CloudSqlConfigurationError(
                "Cloud SQL IAM sslcert and sslkey must be configured together."
            )

        safe_url = URL.create(
            drivername="postgresql+psycopg",
            username=url.username,
            host=url.host,
            port=port,
            database=url.database,
            query=tls_options,
        )
        return cls(
            safe_url=safe_url,
            username=url.username,
            host=url.host,
            port=port,
            database=url.database,
            tls_options=MappingProxyType(tls_options),
        )

    @property
    def cache_key(self) -> str:
        return self.safe_url.render_as_string(hide_password=False)

    def connect_kwargs(self) -> dict[str, object]:
        return {
            "connect_timeout": CLOUD_SQL_CONNECT_TIMEOUT_SECONDS,
            "user": self.username,
            "host": self.host,
            "port": self.port,
            "dbname": self.database,
            **self.tls_options,
        }


def build_psycopg_creator(
    config: CloudSqlIamConfig,
    token_provider: IamLoginTokenProvider,
    *,
    connect_fn: Callable[..., object] | None = None,
) -> Callable[[], object]:
    connect = psycopg.connect if connect_fn is None else connect_fn
    stable_kwargs = config.connect_kwargs()

    def connect_cloud_sql() -> object:
        token = token_provider.current_token()
        connection = None
        connection_failed = False
        try:
            connection = connect(
                **stable_kwargs,
                password=token,
            )
        except Exception:
            connection_failed = True
        token = None
        if connection_failed:
            raise CloudSqlConnectionError(
                "Cloud SQL IAM database connection failed."
            )
        return connection

    return connect_cloud_sql
