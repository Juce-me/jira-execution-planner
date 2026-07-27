"""Direct Cloud SQL IAM connectivity for the synchronous psycopg stack."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


CLOUD_SQL_LOGIN_SCOPE = "https://www.googleapis.com/auth/sqlservice.login"
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
            tls_options=tls_options,
        )

    @property
    def cache_key(self) -> str:
        return self.safe_url.render_as_string(hide_password=False)

    def connect_kwargs(self) -> dict[str, object]:
        return {
            "user": self.username,
            "host": self.host,
            "port": self.port,
            "dbname": self.database,
            **self.tls_options,
        }
