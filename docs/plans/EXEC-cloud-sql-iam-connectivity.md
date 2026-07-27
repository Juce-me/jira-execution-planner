# Cloud SQL IAM Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Implementation complete and locally verified on 2026-07-27. Awaiting user acceptance or merge, so this file remains `EXEC-*`. The implementation is recorded through `6b8f621`.

**Goal:** Add an explicit hosted Cloud SQL IAM-auth connection mode that injects a current ADC login token immediately before every new psycopg physical connection while preserving existing local and CI `DATABASE_URL` behavior.

**Architecture:** Keep URL mode as the default and introduce `DATABASE_CONNECTION_MODE=cloud_sql_iam` as an opt-in hosted path. A focused Cloud SQL module validates the passwordless `postgresql+psycopg` URL, serializes ADC refresh, and builds a sanitized direct psycopg creator; the shared SQLAlchemy engine factory uses normal pooling for the web application and `NullPool` for online Alembic, while offline IAM Alembic pure-validates and consumes only the passwordless stable URL without ADC.

**Tech Stack:** Python 3.10+, SQLAlchemy 2.0.44, synchronous psycopg 3.2.13, Alembic 1.14.0, google-auth 2.56.2, `unittest`

## Execution Outcome

Implemented as planned with two approved amendments:

- Every Cloud SQL IAM psycopg connection uses the app-owned fixed
  10-second `connect_timeout`; `DATABASE_URL` cannot override it.
- Hosted operator guidance now requires the Cloud SQL PostgreSQL
  `cloudsql.iam_authentication` flag, the workload ADC principal as a Cloud SQL
  IAM database user, `roles/cloudsql.instanceUser` /
  `cloudsql.instances.login`, a database username matching the ADC identity
  mapping, and the required PostgreSQL database, schema, and table privileges.

Local verification completed on 2026-07-27:

- finding-focused RED/GREEN coverage passed 20 tests after the expected
  timeout, offline-validation, and documentation failures were captured;
- focused Cloud SQL/config/engine/migration/preflight/docs coverage passed
  66 tests;
- affected startup regression coverage passed 22 tests;
- the JSON-file compatibility preflight passed every check;
- a controlled loopback-only real Flask process returned HTTP 200 from
  `/api/test` through a synthetic Jira stub, with no Python dependency/runtime
  warning before the Flask startup banner, and both processes stopped cleanly;
- the full suite passed 1,133 tests with one skip when rerun with the existing
  local PostgreSQL socket available; known `ResourceWarning` output remains
  test-hygiene debt in unchanged paths;
- `git diff --check` passed and the forbidden-integration and token-environment
  scans returned no matches.

Live Cloud SQL connectivity was not verified. Unit and integration tests used
synthetic credentials and mocked psycopg connections; an approved Cloud SQL
instance, private network path, IAM principal, and SRE TLS configuration were
not provided.

## Global Constraints

- Scope only database connection construction, online migration connection construction, startup preflight, direct dependency pins, configuration documentation, and their tests.
- Preserve the existing `DATABASE_URL`, `TEST_DATABASE_URL`, synchronous psycopg, pooling, and session behavior unless `DATABASE_CONNECTION_MODE=cloud_sql_iam` is explicitly selected.
- The only allowed database transport in IAM mode is a direct psycopg TCP/TLS connection to the SRE-provided private IP or private DNS endpoint.
- Do not add or configure the Cloud SQL Python Connector, `pg8000`, `asyncpg`, a Cloud SQL Auth Proxy sidecar or binary, or any other proxy process.
- Do not modify Terraform, Helm, CI, Dockerfiles, container entrypoints, authentication UI, routes, database schema, Alembic revision files, product behavior, or analytics.
- Use an exact `postgresql+psycopg` URL with a non-empty IAM database user, host, explicit port, and database name.
- Reject any password in the IAM-mode URL; never fall back to database password authentication.
- Request ADC with only `https://www.googleapis.com/auth/sqlservice.login`.
- Supply the current token only as the ephemeral `password` argument to `psycopg.connect()` immediately before a new physical connection.
- Never store the IAM token in an environment variable, SQLAlchemy URL, configuration object, engine/session cache key, exception, traceback, or log.
- Serialize credential refresh and recheck credential validity inside the refresh lock.
- Require `sslmode=require`, `verify-ca`, or `verify-full`; reject missing TLS and `disable`, `allow`, or `prefer`.
- Add the fixed app-owned `connect_timeout=10` to every IAM psycopg
  connection; reject any operator-supplied `connect_timeout` query key.
- Retain normal SQLAlchemy pooling for the web application and use `sqlalchemy.pool.NullPool` for online migrations.
- Offline Alembic must not discover ADC, create a token provider, or refresh Google credentials.
- Add the direct pin `google-auth==2.56.2`; retain `psycopg[binary]==3.2.13`.
- Verification must not claim a live Cloud SQL connection unless an approved instance is tested separately.
- No analytics event is required because this infrastructure-only change introduces no user interaction or user-visible state transition.

## Approved Design

The implementation must follow
`docs/agents/features/2026-07-27-executed-cloud-sql-iam-connectivity-design.md`.
If execution needs a materially different configuration key, token lifecycle,
driver, transport, TLS rule, pooling rule, or file boundary, stop and obtain
approval before changing this plan.

## Configuration Contract

URL mode remains the default:

```env
DATABASE_CONNECTION_MODE=url
DATABASE_URL=postgresql+psycopg://jep:<password>@localhost:5432/jep_local
```

Hosted IAM mode is explicit and passwordless:

```env
DATABASE_CONNECTION_MODE=cloud_sql_iam
DATABASE_URL=postgresql+psycopg://<percent-encoded-iam-database-user>@<private-host>:5432/<database>?sslmode=verify-full&sslrootcert=<percent-encoded-mounted-ca-path>
```

Allowed mode values are exactly `url` and `cloud_sql_iam`. In IAM mode:

- username, host, port, and database are required;
- URL password is forbidden, including an empty password delimiter;
- `sslmode` is required and must be `require`, `verify-ca`, or `verify-full`;
- `verify-ca` and `verify-full` require an explicit `sslrootcert`;
- `sslcert` and `sslkey` must either both be present or both be absent;
- allowed query keys are `sslmode`, `sslrootcert`, `sslcert`, `sslkey`,
  `sslcrl`, `sslcrldir`, `sslsni`, `ssl_min_protocol_version`,
  `ssl_max_protocol_version`, and `channel_binding`;
- every query key must have one string value;
- no query parameter may carry a password, passfile, service definition, token,
  arbitrary libpq option, or `connect_timeout`;
- the app adds a fixed `connect_timeout=10` to every psycopg connection after
  URL validation; operators cannot configure or override it.

## File Map

### Create

- `backend/db/cloud_sql.py`: Cloud SQL IAM URL validation, ADC token provider,
  refresh lock, direct psycopg creator, and sanitized Cloud SQL exceptions.
- `tests/test_cloud_sql_iam.py`: configuration, token lifecycle, creator,
  secrecy, concurrency, dependency, and forbidden-integration coverage.

### Modify

- `backend/db/engine.py`: connection-mode selection, shared engine factory,
  stable cache keys, and existing web engine/session integration.
- `backend/db/migrations/env.py`: use the shared engine factory for online
  migrations with `NullPool`; pure-validate offline IAM URLs without ADC.
- `scripts/check_startup_preflight.py`: validate and safely summarize the
  selected database connection mode.
- `tests/test_db_session.py`: prove URL-mode compatibility, web pooling, and
  safe engine/session cache behavior.
- `tests/test_db_migrations.py`: prove shared online factory use, `NullPool`,
  and offline independence from ADC.
- `tests/test_startup_preflight.py`: prove safe IAM-mode configuration passes
  the database check and missing/unsafe fields fail without credential output.
- `requirements.txt`: add the direct `google-auth==2.56.2` pin only.
- `.env.example`: document default URL mode and the commented hosted IAM
  contract.
- `README.md`: update the internal-hosting database contract.
- `INSTALL.md`: document operator/SRE configuration and migration behavior.
- `tests/test_env_config_docs.py`: guard the exact hosted environment contract.
- `docs/plans/README.md`: index this active execution plan.

### Read Only / Must Not Modify

- `Dockerfile`
- `scripts/docker-entrypoint.sh`
- `.github/workflows/**`
- any Terraform, Helm, Kubernetes, or deployment files
- `frontend/**`
- `jira_server.py`
- `backend/db/models.py`
- `backend/db/migrations/versions/**`
- authentication, Jira, Home/Townsquare, EPM, analytics, and product modules

## Interfaces

`backend/db/cloud_sql.py` produces:

```python
CLOUD_SQL_LOGIN_SCOPE = "https://www.googleapis.com/auth/sqlservice.login"
CLOUD_SQL_CONNECT_TIMEOUT_SECONDS = 10
ALLOWED_CLOUD_SQL_SSLMODES = frozenset({"require", "verify-ca", "verify-full"})

class CloudSqlConfigurationError(RuntimeError): ...
class CloudSqlIamTokenError(RuntimeError): ...
class CloudSqlConnectionError(RuntimeError): ...

@dataclass(frozen=True)
class CloudSqlIamConfig:
    safe_url: sqlalchemy.engine.URL
    username: str
    host: str
    port: int
    database: str
    tls_options: Mapping[str, str]

    @classmethod
    def from_database_url(cls, database_url: str) -> "CloudSqlIamConfig": ...

    @property
    def cache_key(self) -> str: ...

    def connect_kwargs(self) -> dict[str, object]: ...

class IamLoginTokenProvider:
    @classmethod
    def from_adc(cls) -> "IamLoginTokenProvider": ...

    def current_token(self) -> str: ...

def build_psycopg_creator(
    config: CloudSqlIamConfig,
    token_provider: IamLoginTokenProvider,
    *,
    connect_fn: Callable[..., object] | None = None,
) -> Callable[[], object]: ...
```

`backend/db/engine.py` produces:

```python
DATABASE_CONNECTION_MODE_URL = "url"
DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM = "cloud_sql_iam"

def resolve_database_connection_mode(
    environ: Mapping[str, str] | None = None,
) -> str: ...

def validate_startup_database_config(
    environ: Mapping[str, str] | None = None,
) -> str: ...

def create_database_engine(
    database_url: str,
    *,
    environ: Mapping[str, str] | None = None,
    poolclass: type[sqlalchemy.pool.Pool] | None = None,
    token_provider_factory: Callable[[], IamLoginTokenProvider] | None = None,
    psycopg_connect: Callable[..., object] | None = None,
) -> sqlalchemy.engine.Engine: ...
```

`get_engine()`, `session_factory()`, `session_scope()`,
`require_postgresql_refresh_locking()`, and `dispose_engines()` remain public
with their current call signatures and behavior.

---

### Task 1: Validate the hosted connection contract and pin ADC support

**Files:**

- Create: `backend/db/cloud_sql.py`
- Create: `tests/test_cloud_sql_iam.py`
- Modify: `requirements.txt`

**Interfaces:**

- Consumes: SQLAlchemy `URL`/`make_url`; the existing pinned psycopg dependency.
- Produces: `CloudSqlIamConfig`, its stable `cache_key` and
  `connect_kwargs()`, the three sanitized exception classes, the exact login
  scope constant, and the pinned Google Auth dependency used by later tasks.

- [x] **Step 1: Write failing configuration and dependency tests**

Create `tests/test_cloud_sql_iam.py` with these initial tests:

```python
from pathlib import Path
import unittest

from backend.db.cloud_sql import (
    CLOUD_SQL_CONNECT_TIMEOUT_SECONDS,
    CLOUD_SQL_LOGIN_SCOPE,
    CloudSqlConfigurationError,
    CloudSqlIamConfig,
)


ROOT = Path(__file__).resolve().parents[1]


class CloudSqlIamConfigTests(unittest.TestCase):
    def test_parses_passwordless_psycopg_url_and_builds_safe_kwargs(self):
        config = CloudSqlIamConfig.from_database_url(
            "postgresql+psycopg://service-account%40project.iam@"
            "private-db.internal.example:5432/planner"
            "?sslmode=verify-full&sslrootcert=%2Fmounted-secrets%2Fserver-ca.pem"
        )

        self.assertEqual(config.safe_url.drivername, "postgresql+psycopg")
        self.assertIsNone(config.safe_url.password)
        self.assertEqual(config.username, "service-account@project.iam")
        self.assertEqual(config.host, "private-db.internal.example")
        self.assertEqual(config.port, 5432)
        self.assertEqual(config.database, "planner")
        self.assertEqual(
            config.connect_kwargs(),
            {
                "connect_timeout": 10,
                "user": "service-account@project.iam",
                "host": "private-db.internal.example",
                "port": 5432,
                "dbname": "planner",
                "sslmode": "verify-full",
                "sslrootcert": "/mounted-secrets/server-ca.pem",
            },
        )
        self.assertEqual(CLOUD_SQL_CONNECT_TIMEOUT_SECONDS, 10)

    def test_cache_key_contains_only_passwordless_stable_configuration(self):
        config = CloudSqlIamConfig.from_database_url(
            "postgresql+psycopg://iam-user@10.20.30.40:5432/planner"
            "?sslmode=require"
        )

        self.assertNotIn("password", config.cache_key.lower())
        self.assertNotIn("token", config.cache_key.lower())
        self.assertEqual(config.cache_key, config.safe_url.render_as_string(hide_password=False))

    def test_requires_exact_psycopg_driver(self):
        for url in (
            "postgresql://iam-user@db:5432/planner?sslmode=require",
            "postgresql+psycopg2://iam-user@db:5432/planner?sslmode=require",
            "postgresql+pg8000://iam-user@db:5432/planner?sslmode=require",
            "postgresql+asyncpg://iam-user@db:5432/planner?sslmode=require",
        ):
            with self.subTest(url=url):
                with self.assertRaisesRegex(
                    CloudSqlConfigurationError,
                    "postgresql\\+psycopg",
                ):
                    CloudSqlIamConfig.from_database_url(url)

    def test_rejects_password_in_url_without_fallback(self):
        for url in (
            "postgresql+psycopg://iam-user:secret@db:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user:@db:5432/planner?sslmode=require",
        ):
            with self.subTest(url=url):
                with self.assertRaisesRegex(
                    CloudSqlConfigurationError,
                    "must not contain a password",
                ):
                    CloudSqlIamConfig.from_database_url(url)

    def test_requires_host_user_port_and_database(self):
        invalid_urls = (
            "postgresql+psycopg://db:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@db/planner?sslmode=require",
            "postgresql+psycopg://iam-user@db:not-a-port/planner?sslmode=require",
            "postgresql+psycopg://iam-user@db:5432/?sslmode=require",
        )
        for url in invalid_urls:
            with self.subTest(url=url):
                with self.assertRaises(CloudSqlConfigurationError):
                    CloudSqlIamConfig.from_database_url(url)

    def test_rejects_missing_or_unsafe_tls(self):
        for suffix in ("", "?sslmode=disable", "?sslmode=allow", "?sslmode=prefer"):
            with self.subTest(suffix=suffix):
                with self.assertRaisesRegex(CloudSqlConfigurationError, "TLS"):
                    CloudSqlIamConfig.from_database_url(
                        f"postgresql+psycopg://iam-user@db:5432/planner{suffix}"
                    )

    def test_verify_modes_require_explicit_root_certificate(self):
        for sslmode in ("verify-ca", "verify-full"):
            with self.subTest(sslmode=sslmode):
                with self.assertRaisesRegex(CloudSqlConfigurationError, "sslrootcert"):
                    CloudSqlIamConfig.from_database_url(
                        "postgresql+psycopg://iam-user@db:5432/planner"
                        f"?sslmode={sslmode}"
                    )

    def test_client_certificate_and_key_must_be_paired(self):
        for option in (
            "sslcert=%2Fmounted%2Fclient.pem",
            "sslkey=%2Fmounted%2Fclient-key.pem",
        ):
            with self.subTest(option=option):
                with self.assertRaisesRegex(CloudSqlConfigurationError, "sslcert and sslkey"):
                    CloudSqlIamConfig.from_database_url(
                        "postgresql+psycopg://iam-user@db:5432/planner"
                        f"?sslmode=require&{option}"
                    )

    def test_rejects_unapproved_or_repeated_query_options(self):
        for query in (
            "sslmode=require&password=secret",
            "sslmode=require&passfile=%2Fmounted%2Fpgpass",
            "sslmode=require&service=cloud-sql",
            "sslmode=require&options=-csearch_path%3Dpublic",
            "sslmode=require&connect_timeout=60",
            "sslmode=require&sslmode=verify-full",
        ):
            with self.subTest(query=query):
                with self.assertRaises(CloudSqlConfigurationError):
                    CloudSqlIamConfig.from_database_url(
                        f"postgresql+psycopg://iam-user@db:5432/planner?{query}"
                    )

    def test_login_scope_is_exact(self):
        self.assertEqual(
            CLOUD_SQL_LOGIN_SCOPE,
            "https://www.googleapis.com/auth/sqlservice.login",
        )

    def test_requirements_pin_google_auth_and_retain_psycopg(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf8").splitlines()
        self.assertIn("google-auth==2.56.2", requirements)
        self.assertIn("psycopg[binary]==3.2.13", requirements)
```

- [x] **Step 2: Run the new tests and confirm the expected failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cloud_sql_iam.CloudSqlIamConfigTests
```

Expected: `ERROR` because `backend.db.cloud_sql` does not exist.

- [x] **Step 3: Add the direct Google Auth pin**

Add this line to `requirements.txt` next to the database dependencies:

```text
google-auth==2.56.2
```

Do not change `psycopg[binary]==3.2.13` or add a Google Cloud SQL package.

- [x] **Step 4: Implement the immutable Cloud SQL configuration**

Create `backend/db/cloud_sql.py` with this structure:

```python
"""Direct Cloud SQL IAM connectivity for the synchronous psycopg stack."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

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
            "connect_timeout": CLOUD_SQL_CONNECT_TIMEOUT_SECONDS,
            "user": self.username,
            "host": self.host,
            "port": self.port,
            "dbname": self.database,
            **self.tls_options,
        }
```

Do not import Google Auth or psycopg yet; Task 1 is configuration-only and must
not perform credential or network work.

- [x] **Step 5: Install the updated pinned runtime requirements**

Run:

```bash
.venv/bin/python -m pip install -r requirements.txt
```

Expected: installation succeeds with `google-auth==2.56.2`; no Cloud SQL
Connector or alternate PostgreSQL driver is installed.

- [x] **Step 6: Run the focused configuration tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cloud_sql_iam.CloudSqlIamConfigTests
```

Expected: all `CloudSqlIamConfigTests` pass.

- [x] **Step 7: Commit Task 1**

```bash
git add \
  backend/db/cloud_sql.py \
  tests/test_cloud_sql_iam.py \
  requirements.txt
git commit -m "feat: validate Cloud SQL IAM database config"
```

---

### Task 2: Add lock-protected ADC token refresh with sanitized failures

**Files:**

- Modify: `backend/db/cloud_sql.py`
- Modify: `tests/test_cloud_sql_iam.py`

**Interfaces:**

- Consumes: `google.auth.default()`,
  `google.auth.transport.requests.Request`, and
  `CLOUD_SQL_LOGIN_SCOPE` from Task 1.
- Produces: `IamLoginTokenProvider.from_adc()` and
  `IamLoginTokenProvider.current_token()` for the physical-connection creator.

- [x] **Step 1: Add failing ADC, refresh, concurrency, and sanitization tests**

Append these imports and tests to `tests/test_cloud_sql_iam.py`:

```python
import threading
import traceback
from unittest.mock import Mock, patch

from backend.db.cloud_sql import CloudSqlIamTokenError, IamLoginTokenProvider


class _FakeCredentials:
    def __init__(self, *, token=None, expired=True, refresh_error=None):
        self.token = token
        self.expired = expired
        self.refresh_error = refresh_error
        self.refresh_calls = 0

    @property
    def valid(self):
        return bool(self.token) and not self.expired

    def refresh(self, request):
        self.refresh_calls += 1
        if self.refresh_error:
            raise self.refresh_error
        self.token = f"fresh-token-{self.refresh_calls}"
        self.expired = False


class IamLoginTokenProviderTests(unittest.TestCase):
    def test_from_adc_requests_only_sqlservice_login_scope(self):
        credentials = _FakeCredentials(token="current-token", expired=False)
        with patch(
            "backend.db.cloud_sql.google.auth.default",
            return_value=(credentials, "project-id"),
        ) as default_credentials:
            provider = IamLoginTokenProvider.from_adc()

        self.assertEqual(provider.current_token(), "current-token")
        default_credentials.assert_called_once_with(
            scopes=("https://www.googleapis.com/auth/sqlservice.login",)
        )

    def test_valid_credentials_are_reused_without_refresh(self):
        credentials = _FakeCredentials(token="current-token", expired=False)
        provider = IamLoginTokenProvider(credentials, request=object())

        self.assertEqual(provider.current_token(), "current-token")
        self.assertEqual(provider.current_token(), "current-token")
        self.assertEqual(credentials.refresh_calls, 0)

    def test_expired_credentials_are_refreshed(self):
        credentials = _FakeCredentials(token="expired-token", expired=True)
        provider = IamLoginTokenProvider(credentials, request=object())

        self.assertEqual(provider.current_token(), "fresh-token-1")
        self.assertEqual(credentials.refresh_calls, 1)

    def test_concurrent_requests_perform_one_refresh(self):
        credentials = _FakeCredentials(token=None, expired=True)
        provider = IamLoginTokenProvider(credentials, request=object())
        barrier = threading.Barrier(8)
        results = []
        errors = []

        def worker():
            try:
                barrier.wait()
                results.append(provider.current_token())
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)

        self.assertEqual(errors, [])
        self.assertEqual(results, ["fresh-token-1"] * 8)
        self.assertEqual(credentials.refresh_calls, 1)

    def test_adc_discovery_failure_is_sanitized_without_exception_chain(self):
        secret = "adc-secret-detail"
        with patch(
            "backend.db.cloud_sql.google.auth.default",
            side_effect=RuntimeError(secret),
        ):
            with self.assertRaises(CloudSqlIamTokenError) as raised:
                IamLoginTokenProvider.from_adc()

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertEqual(str(raised.exception), "Cloud SQL IAM credentials are unavailable.")
        self.assertNotIn(secret, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_refresh_failure_is_sanitized_without_token_or_exception_chain(self):
        old_token = "expired-sensitive-token"
        secret = "refresh-secret-detail"
        credentials = _FakeCredentials(
            token=old_token,
            expired=True,
            refresh_error=RuntimeError(secret),
        )
        provider = IamLoginTokenProvider(credentials, request=object())

        with self.assertRaises(CloudSqlIamTokenError) as raised:
            provider.current_token()

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertEqual(
            str(raised.exception),
            "Cloud SQL IAM login token refresh failed.",
        )
        self.assertNotIn(old_token, rendered)
        self.assertNotIn(secret, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_missing_refreshed_token_fails_safely(self):
        credentials = Mock()
        credentials.valid = False
        credentials.token = None
        credentials.refresh.return_value = None
        provider = IamLoginTokenProvider(credentials, request=object())

        with self.assertRaisesRegex(
            CloudSqlIamTokenError,
            "did not return a current login token",
        ):
            provider.current_token()
```

- [x] **Step 2: Run the token-provider tests and confirm failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cloud_sql_iam.IamLoginTokenProviderTests
```

Expected: `ImportError` because `IamLoginTokenProvider` is not implemented.

- [x] **Step 3: Implement ADC discovery and double-checked refresh locking**

Add these imports and the provider to `backend/db/cloud_sql.py`:

```python
import threading

import google.auth
from google.auth.credentials import Credentials
from google.auth.transport.requests import Request


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
```

Do not log credential classes, project IDs, refresh errors, or token values.
The credentials object may retain its current token in memory as required by
Google Auth; no application-owned token cache may be added.

- [x] **Step 4: Run the token and configuration tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cloud_sql_iam.CloudSqlIamConfigTests \
  tests.test_cloud_sql_iam.IamLoginTokenProviderTests
```

Expected: all tests pass and the concurrency test records exactly one refresh.

- [x] **Step 5: Commit Task 2**

```bash
git add backend/db/cloud_sql.py tests/test_cloud_sql_iam.py
git commit -m "feat: refresh Cloud SQL IAM login tokens"
```

---

### Task 3: Inject tokens per physical psycopg connection and share the engine factory

**Files:**

- Modify: `backend/db/cloud_sql.py`
- Modify: `backend/db/engine.py`
- Modify: `tests/test_cloud_sql_iam.py`
- Modify: `tests/test_db_session.py`

**Interfaces:**

- Consumes: `CloudSqlIamConfig`, `IamLoginTokenProvider`, and sanitized
  exceptions from Tasks 1-2.
- Produces: `build_psycopg_creator()`,
  `resolve_database_connection_mode()`,
  `create_database_engine()`, mode-aware stable cache keys, and existing
  `get_engine()`/`session_factory()` integration.

- [x] **Step 1: Add failing physical-connection and secrecy tests**

Append to `tests/test_cloud_sql_iam.py`:

```python
import logging

from backend.db.cloud_sql import (
    CloudSqlConnectionError,
    build_psycopg_creator,
)


class _SequencedTokenProvider:
    def __init__(self, tokens):
        self._tokens = iter(tokens)
        self.calls = 0

    def current_token(self):
        self.calls += 1
        return next(self._tokens)


class CloudSqlPsycopgCreatorTests(unittest.TestCase):
    def setUp(self):
        self.config = CloudSqlIamConfig.from_database_url(
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
            "?sslmode=require"
        )

    def test_every_creator_call_receives_the_current_token(self):
        provider = _SequencedTokenProvider(["token-one", "token-two"])
        connect_fn = Mock(side_effect=["connection-one", "connection-two"])
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=connect_fn,
        )

        self.assertEqual(creator(), "connection-one")
        self.assertEqual(creator(), "connection-two")
        self.assertEqual(provider.calls, 2)
        self.assertEqual(
            [call.kwargs["password"] for call in connect_fn.call_args_list],
            ["token-one", "token-two"],
        )
        for call in connect_fn.call_args_list:
            self.assertEqual(call.kwargs["connect_timeout"], 10)
            self.assertEqual(call.kwargs["user"], "iam-user")
            self.assertEqual(call.kwargs["host"], "private-db.internal.example")
            self.assertEqual(call.kwargs["dbname"], "planner")
            self.assertEqual(call.kwargs["sslmode"], "require")

    def test_token_provider_failure_propagates_without_calling_psycopg(self):
        token_error = CloudSqlIamTokenError("synthetic token failure")
        provider = Mock()
        provider.current_token.side_effect = token_error
        connect_fn = Mock()
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=connect_fn,
        )

        with self.assertRaises(CloudSqlIamTokenError) as raised:
            creator()

        self.assertIs(raised.exception, token_error)
        connect_fn.assert_not_called()

    def test_connection_failure_is_sanitized(self):
        token = "sensitive-login-token"
        secret = "libpq-secret-detail"
        provider = _SequencedTokenProvider([token])
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=Mock(side_effect=RuntimeError(f"{secret} {token}")),
        )

        with self.assertRaises(CloudSqlConnectionError) as raised:
            creator()

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertEqual(
            str(raised.exception),
            "Cloud SQL IAM database connection failed.",
        )
        self.assertNotIn(token, rendered)
        self.assertNotIn(secret, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_creator_does_not_log_token_or_connection_arguments(self):
        token = "sensitive-login-token"
        provider = _SequencedTokenProvider([token])
        connect_fn = Mock(return_value="connection")
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=connect_fn,
        )

        with self.assertLogs(level=logging.DEBUG) as captured:
            logging.getLogger().debug("creator test boundary")
            creator()

        output = "\n".join(captured.output)
        self.assertNotIn(token, output)
        self.assertNotIn("private-db.internal.example", output)
```

- [x] **Step 2: Add failing shared-engine and URL-compatibility tests**

Add these tests to `tests/test_db_session.py`:

```python
from unittest.mock import Mock, patch

from sqlalchemy.pool import NullPool, QueuePool


class DbSessionTests(unittest.TestCase):
    # Keep the existing tests and tearDown.

    def test_default_url_mode_preserves_existing_create_engine_path(self):
        env = {"DATABASE_CONNECTION_MODE": "url"}
        with patch("backend.db.engine.create_engine") as create_engine:
            expected = create_engine.return_value
            actual = db_engine.create_database_engine(
                "postgresql+psycopg://jep:password@localhost:5432/jep_local",
                environ=env,
            )

        self.assertIs(actual, expected)
        create_engine.assert_called_once_with(
            "postgresql+psycopg://jep:password@localhost:5432/jep_local",
            future=True,
            pool_pre_ping=True,
        )

    def test_test_database_url_precedence_is_unchanged_in_url_mode(self):
        env = {
            "DATABASE_CONNECTION_MODE": "url",
            "CONFIG_STORAGE_BACKEND": "db",
            "DATABASE_URL": "postgresql+psycopg://jep@db:5432/app",
            "TEST_DATABASE_URL": "sqlite+pysqlite:///:memory:",
        }

        self.assertEqual(
            db_engine.resolve_database_url(environ=env, testing=True),
            "sqlite+pysqlite:///:memory:",
        )

    def test_unknown_connection_mode_fails_closed(self):
        with self.assertRaisesRegex(
            db_engine.DatabaseConfigurationError,
            "DATABASE_CONNECTION_MODE must be url or cloud_sql_iam",
        ):
            db_engine.resolve_database_connection_mode(
                {"DATABASE_CONNECTION_MODE": "automatic"}
            )

    def test_cloud_sql_engine_uses_psycopg_safe_url_and_normal_web_pool(self):
        env = {"DATABASE_CONNECTION_MODE": "cloud_sql_iam"}
        database_url = (
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
            "?sslmode=require"
        )
        provider = Mock()
        provider.current_token.return_value = "current-token"
        connection = object()
        psycopg_connect = Mock(return_value=connection)

        engine = db_engine.create_database_engine(
            database_url,
            environ=env,
            token_provider_factory=lambda: provider,
            psycopg_connect=psycopg_connect,
        )
        try:
            self.assertEqual(engine.url.drivername, "postgresql+psycopg")
            self.assertIsNone(engine.url.password)
            self.assertIsInstance(engine.pool, QueuePool)
            creator = engine.pool._creator
            self.assertIs(creator(), connection)
            self.assertEqual(psycopg_connect.call_args.kwargs["password"], "current-token")
        finally:
            engine.dispose()

    def test_cloud_sql_engine_and_session_cache_keys_never_contain_token(self):
        env = {"DATABASE_CONNECTION_MODE": "cloud_sql_iam"}
        database_url = (
            "postgresql+psycopg://iam-user@db:5432/planner?sslmode=require"
        )
        token = "sensitive-login-token"
        provider = Mock()
        provider.current_token.return_value = token

        with patch(
            "backend.db.engine.IamLoginTokenProvider.from_adc",
            return_value=provider,
        ):
            first = db_engine.get_engine(database_url, environ=env)
            second = db_engine.get_engine(database_url, environ=env)
            first_factory = db_engine.session_factory(database_url, environ=env)
            second_factory = db_engine.session_factory(database_url, environ=env)

        self.assertIs(first, second)
        self.assertIs(first_factory, second_factory)
        rendered_keys = repr((
            tuple(db_engine._ENGINES),
            tuple(db_engine._SESSION_FACTORIES),
        ))
        self.assertNotIn(token, rendered_keys)
        self.assertNotIn("password", rendered_keys.lower())
```

Do not delete or weaken the existing SQLite session, uniqueness, or locking
tests.

- [x] **Step 3: Run the new creator and engine tests and confirm failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cloud_sql_iam.CloudSqlPsycopgCreatorTests \
  tests.test_db_session
```

Expected: failures because the creator, mode resolver, and shared engine factory
are not implemented.

- [x] **Step 4: Implement the direct psycopg creator**

Add these imports and function to `backend/db/cloud_sql.py`:

```python
from collections.abc import Callable

import psycopg


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
```

Do not catch `CloudSqlIamTokenError` inside the psycopg `try` block; token
acquisition occurs first and retains its own fixed error category.

- [x] **Step 5: Refactor `backend/db/engine.py` around one engine factory**

Keep the existing public functions, but introduce mode-aware construction:

```python
from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy.pool import Pool

from backend.db.cloud_sql import (
    CloudSqlConfigurationError,
    CloudSqlIamConfig,
    IamLoginTokenProvider,
    build_psycopg_creator,
)


DATABASE_CONNECTION_MODE_URL = "url"
DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM = "cloud_sql_iam"
DATABASE_CONNECTION_MODES = {
    DATABASE_CONNECTION_MODE_URL,
    DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM,
}

_ENGINES: dict[tuple[str, str], Engine] = {}
_SESSION_FACTORIES: dict[tuple[str, str], sessionmaker[Session]] = {}


def resolve_database_connection_mode(
    environ: Mapping[str, str] | None = None,
) -> str:
    env = os.environ if environ is None else environ
    mode = str(
        env.get("DATABASE_CONNECTION_MODE") or DATABASE_CONNECTION_MODE_URL
    ).strip().lower()
    if mode not in DATABASE_CONNECTION_MODES:
        raise DatabaseConfigurationError(
            "DATABASE_CONNECTION_MODE must be url or cloud_sql_iam."
        )
    return mode


def _validated_cloud_sql_config(database_url: str) -> CloudSqlIamConfig:
    try:
        return CloudSqlIamConfig.from_database_url(database_url)
    except CloudSqlConfigurationError as error:
        raise DatabaseConfigurationError(str(error)) from None


def _engine_cache_key(
    database_url: str,
    environ: Mapping[str, str] | None,
) -> tuple[str, str]:
    mode = resolve_database_connection_mode(environ)
    if mode == DATABASE_CONNECTION_MODE_URL:
        return mode, database_url
    return mode, _validated_cloud_sql_config(database_url).cache_key


def create_database_engine(
    database_url: str,
    *,
    environ: Mapping[str, str] | None = None,
    poolclass: type[Pool] | None = None,
    token_provider_factory: Callable[[], IamLoginTokenProvider] | None = None,
    psycopg_connect: Callable[..., object] | None = None,
) -> Engine:
    mode = resolve_database_connection_mode(environ)
    engine_kwargs: dict[str, Any] = {
        "future": True,
        "pool_pre_ping": True,
    }
    if poolclass is not None:
        engine_kwargs["poolclass"] = poolclass
    if mode == DATABASE_CONNECTION_MODE_URL:
        return create_engine(database_url, **engine_kwargs)

    config = _validated_cloud_sql_config(database_url)
    provider_factory = (
        IamLoginTokenProvider.from_adc
        if token_provider_factory is None
        else token_provider_factory
    )
    token_provider = provider_factory()
    creator = build_psycopg_creator(
        config,
        token_provider,
        connect_fn=psycopg_connect,
    )
    return create_engine(
        config.safe_url,
        creator=creator,
        **engine_kwargs,
    )
```

Update `validate_startup_database_config()` to validate the selected mode
without loading ADC:

```python
def validate_startup_database_config(
    environ: Mapping[str, str] | None = None,
) -> str:
    env = os.environ if environ is None else environ
    url = resolve_database_url(
        environ=env,
        required=database_storage_enabled(env),
    )
    mode = resolve_database_connection_mode(env)
    if url and mode == DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM:
        _validated_cloud_sql_config(url)
    return mode
```

Update `get_engine()` and `session_factory()` to use the stable tuple key and
forward `environ`:

```python
def get_engine(...):
    url = (
        database_url
        or resolve_database_url(environ=environ, testing=testing, required=True)
    ).strip()
    if not url:
        raise DatabaseConfigurationError(
            "DATABASE_URL is required to create a database engine"
        )
    key = _engine_cache_key(url, environ)
    if key not in _ENGINES:
        _ENGINES[key] = create_database_engine(url, environ=environ)
    return _ENGINES[key]


def session_factory(...):
    url = (
        database_url
        or resolve_database_url(environ=environ, testing=testing, required=True)
    ).strip()
    key = _engine_cache_key(url, environ)
    if key not in _SESSION_FACTORIES:
        _SESSION_FACTORIES[key] = sessionmaker(
            bind=get_engine(url, environ=environ),
            future=True,
            expire_on_commit=False,
        )
    return _SESSION_FACTORIES[key]
```

Leave `dispose_engines()` semantically unchanged: dispose every cached engine,
then clear both dictionaries. Do not add an application-owned token-provider
cache.

- [x] **Step 6: Run creator, engine, and existing session tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cloud_sql_iam.CloudSqlPsycopgCreatorTests \
  tests.test_db_session
```

Expected: all tests pass, including existing URL/SQLite session tests.

- [x] **Step 7: Commit Task 3**

```bash
git add \
  backend/db/cloud_sql.py \
  backend/db/engine.py \
  tests/test_cloud_sql_iam.py \
  tests/test_db_session.py
git commit -m "feat: inject IAM tokens into psycopg connections"
```

---

### Task 4: Route online Alembic through the shared factory and validate offline IAM URLs

**Files:**

- Modify: `backend/db/migrations/env.py`
- Modify: `tests/test_db_migrations.py`

**Interfaces:**

- Consumes: `db_engine.create_database_engine()` from Task 3.
- Produces: online migration construction through the same URL/IAM branch with
  `NullPool`; offline migration configuration that pure-validates IAM URLs and
  touches no ADC, provider, refresh, or connection path.

- [x] **Step 1: Add failing online factory and offline independence tests**

Add these imports and tests to `tests/test_db_migrations.py`:

```python
import io
from unittest.mock import patch

from sqlalchemy import pool

from backend.db import engine as db_engine


class DbMigrationTests(unittest.TestCase):
    # Keep existing helpers and migration round-trip test.

    def test_online_migrations_use_shared_engine_factory_with_null_pool(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'shared.db')}"
            config = self._config(database_url)

            with patch.dict(
                os.environ,
                {"DATABASE_CONNECTION_MODE": "url"},
                clear=False,
            ), patch.object(
                db_engine,
                "create_database_engine",
                wraps=db_engine.create_database_engine,
            ) as factory:
                command.upgrade(config, "head")

            factory.assert_called()
            self.assertEqual(factory.call_args.args[0], database_url)
            self.assertIs(factory.call_args.kwargs["poolclass"], pool.NullPool)

    def test_offline_migrations_do_not_discover_or_refresh_adc(self):
        config = self._config(
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
            "?sslmode=require"
        )
        output = io.StringIO()
        config.output_buffer = output

        with patch.dict(
            os.environ,
            {"DATABASE_CONNECTION_MODE": "cloud_sql_iam"},
            clear=False,
        ), patch(
            "backend.db.cloud_sql.google.auth.default",
            side_effect=AssertionError("offline migrations must not load ADC"),
        ):
            command.upgrade(config, "head", sql=True)

        self.assertIn("CREATE TABLE", output.getvalue())

    def test_offline_iam_migrations_reject_password_wrong_driver_and_unsafe_tls(self):
        # Password-bearing, non-psycopg, missing-TLS, and unsafe-TLS URLs each
        # raise the fixed DatabaseConfigurationError without a sensitive chain.
        ...
```

- [x] **Step 2: Run the migration tests and confirm the online test fails**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_migrations
```

Expected: the online factory assertion fails because Alembic still uses
`engine_from_config`.

- [x] **Step 3: Replace only the online engine construction**

In `backend/db/migrations/env.py`:

- remove the `engine_from_config` import;
- retain `pool` for `NullPool`;
- leave URL-mode offline behavior unchanged;
- when offline mode is `cloud_sql_iam`, pure-validate `_database_url()` through
  `CloudSqlIamConfig`, translate `CloudSqlConfigurationError` to the fixed
  `DatabaseConfigurationError` without an underlying chain, and pass only the
  passwordless `safe_url` to `context.configure()`;
- do not construct a token provider, discover ADC, refresh credentials, or
  connect in offline mode;
- replace `run_migrations_online()` with:

```python
def run_migrations_online() -> None:
    connectable = db_engine.create_database_engine(
        _database_url(),
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
```

Do not create, cache, or reuse a migration engine through `get_engine()`.

- [x] **Step 4: Run focused migration and database tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_db_migrations \
  tests.test_cloud_sql_iam \
  tests.test_db_session
```

Expected: all tests pass; online migrations record `NullPool`, and offline SQL
generation succeeds while ADC is patched to fail if called.

- [x] **Step 5: Commit Task 4**

```bash
git add backend/db/migrations/env.py tests/test_db_migrations.py
git commit -m "feat: share Cloud SQL path with Alembic"
```

---

### Task 5: Fail startup preflight on missing or unsafe IAM configuration

**Files:**

- Modify: `scripts/check_startup_preflight.py`
- Modify: `tests/test_startup_preflight.py`

**Interfaces:**

- Consumes: `db_engine.validate_startup_database_config()` and the existing
  preflight check registry.
- Produces: sanitized `database_url` PASS/FAIL output for URL and
  `cloud_sql_iam` modes without printing connection identifiers or credentials.

- [x] **Step 1: Add failing preflight tests for the explicit mode contract**

Add `from unittest.mock import patch`, then add this helper and these tests to
`tests/test_startup_preflight.py`:

```python
    def _cloud_sql_env(self, database_url):
        return self._hosted_oauth_env({
            "DATABASE_CONNECTION_MODE": "cloud_sql_iam",
            "DATABASE_URL": database_url,
        })

    def test_cloud_sql_database_check_accepts_safe_passwordless_psycopg_url(self):
        with patch(
            "scripts.check_startup_preflight.validate_config_storage_startup",
            return_value=None,
        ):
            code, output = self._run(self._cloud_sql_env(
                "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
                "?sslmode=verify-full&sslrootcert=%2Fmounted-secrets%2Fserver-ca.pem"
            ))

        self.assertEqual(code, 0, output)
        self.assertIn(
            "PASS database_url: configured for cloud_sql_iam with TLS",
            output,
        )
        self.assertNotIn("iam-user", output)
        self.assertNotIn("private-db.internal.example", output)
        self.assertNotIn("planner", output)

    def test_cloud_sql_preflight_rejects_missing_url_fields(self):
        invalid_urls = (
            "postgresql+psycopg://private-db.internal.example:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@private-db.internal.example/planner?sslmode=require",
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/?sslmode=require",
        )
        for database_url in invalid_urls:
            with self.subTest(database_url=database_url):
                code, output = self._run(self._cloud_sql_env(database_url))
                self.assertEqual(code, 1)
                self.assertIn("FAIL database_url:", output)

    def test_cloud_sql_preflight_rejects_password_and_wrong_driver(self):
        invalid_urls = (
            "postgresql+psycopg://iam-user:secret@db:5432/planner?sslmode=require",
            "postgresql+pg8000://iam-user@db:5432/planner?sslmode=require",
            "postgresql+asyncpg://iam-user@db:5432/planner?sslmode=require",
        )
        for database_url in invalid_urls:
            with self.subTest(database_url=database_url):
                code, output = self._run(self._cloud_sql_env(database_url))
                self.assertEqual(code, 1)
                self.assertIn("FAIL database_url:", output)
                self.assertNotIn("secret", output)

    def test_cloud_sql_preflight_rejects_missing_or_unsafe_tls(self):
        for suffix in ("", "?sslmode=disable", "?sslmode=allow", "?sslmode=prefer"):
            with self.subTest(suffix=suffix):
                code, output = self._run(self._cloud_sql_env(
                    "postgresql+psycopg://iam-user@db:5432/planner" + suffix
                ))
                self.assertEqual(code, 1)
                self.assertIn("FAIL database_url:", output)
                self.assertIn("TLS", output)

    def test_unknown_database_connection_mode_fails_preflight(self):
        code, output = self._run(self._hosted_oauth_env({
            "DATABASE_CONNECTION_MODE": "automatic",
        }))

        self.assertEqual(code, 1)
        self.assertIn(
            "FAIL database_url: DATABASE_CONNECTION_MODE must be url or cloud_sql_iam.",
            output,
        )

    def test_preflight_never_prints_rejected_database_password(self):
        password = "database-password-secret"
        env = self._cloud_sql_env(
            f"postgresql+psycopg://iam-user:{password}@db:5432/planner?sslmode=require"
        )

        code, output = self._run(env)

        self.assertEqual(code, 1)
        self.assertNotIn(password, output)
```

The implementation and documentation must not define or read any environment
variable for the Cloud SQL IAM login token.

- [x] **Step 2: Run startup-preflight tests and confirm failure**

Run:

```bash
.venv/bin/python -m unittest tests.test_startup_preflight
```

Expected: new Cloud SQL assertions fail because `_check_database_url()` does
not call the mode-aware validator.

- [x] **Step 3: Make the database check mode-aware and sanitized**

Replace `_check_database_url()` in `scripts/check_startup_preflight.py` with:

```python
def _check_database_url(env: dict[str, str]) -> str:
    if not db_engine.database_storage_enabled(env):
        return "not required for jsonfile config storage"
    try:
        mode = db_engine.validate_startup_database_config(env)
    except db_engine.DatabaseConfigurationError as error:
        raise PreflightError(str(error)) from None
    if mode == db_engine.DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM:
        return "configured for cloud_sql_iam with TLS"
    return "configured"
```

Do not render the URL or any parsed field. Leave `_check_migrations()` intact:
in a real hosted startup it uses the shared engine path and therefore validates
actual database reachability/migration state; unit tests do not claim that live
check.

- [x] **Step 4: Run preflight and database tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_startup_preflight \
  tests.test_db_session \
  tests.test_cloud_sql_iam
```

Expected: all tests pass; unsafe configurations fail under `database_url`
without connection identifiers or credential text.

- [x] **Step 5: Commit Task 5**

```bash
git add scripts/check_startup_preflight.py tests/test_startup_preflight.py
git commit -m "feat: preflight Cloud SQL IAM configuration"
```

---

### Task 6: Document the exact SRE contract and guard against forbidden integrations

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `tests/test_env_config_docs.py`
- Modify: `tests/test_cloud_sql_iam.py`

**Interfaces:**

- Consumes: the exact configuration and scope constants implemented in Tasks
  1-5.
- Produces: one consistent operator contract and negative guards that prevent
  connector, alternate-driver, or proxy scope creep.

- [x] **Step 1: Add failing documentation contract assertions**

Extend `HOSTED_ENV_TERMS` in `tests/test_env_config_docs.py`:

```python
HOSTED_ENV_TERMS = (
    # Keep every existing term.
    "DATABASE_CONNECTION_MODE=cloud_sql_iam",
    "postgresql+psycopg://",
    "sslmode=verify-full",
    "https://www.googleapis.com/auth/sqlservice.login",
)
```

Add:

```python
    def test_cloud_sql_iam_contract_is_consistent_and_passwordless(self):
        docs = (
            REPO_ROOT / ".env.example",
            REPO_ROOT / "README.md",
            REPO_ROOT / "INSTALL.md",
        )
        for path in docs:
            text = path.read_text(encoding="utf8")
            with self.subTest(path=path.relative_to(REPO_ROOT)):
                self.assertIn("DATABASE_CONNECTION_MODE=cloud_sql_iam", text)
                self.assertIn("postgresql+psycopg://", text)
                self.assertIn("sslmode=verify-full", text)
                self.assertIn(
                    "https://www.googleapis.com/auth/sqlservice.login",
                    text,
                )
                self.assertIn("Cloud SQL Python Connector", text)
                self.assertIn("must not contain a password", text)
                self.assertIn("Application Default Credentials", text)
                self.assertIn("private IP or private DNS", text)

    def test_local_database_url_contract_remains_documented(self):
        env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf8")
        install = (REPO_ROOT / "INSTALL.md").read_text(encoding="utf8")
        for text in (env_example, install):
            self.assertIn(
                "DATABASE_URL=postgresql+psycopg://jep:",
                text,
            )
```

- [x] **Step 2: Add failing forbidden-integration source guards**

Append to `tests/test_cloud_sql_iam.py`:

```python
class CloudSqlScopeGuardTests(unittest.TestCase):
    def test_runtime_dependencies_exclude_connector_and_alternate_drivers(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf8").lower()
        self.assertNotIn("cloud-sql-python-connector", requirements)
        self.assertNotIn("pg8000", requirements)
        self.assertNotIn("asyncpg", requirements)
        self.assertIn("psycopg[binary]==3.2.13", requirements)

    def test_database_runtime_has_no_connector_or_proxy_imports(self):
        source = "\n".join(
            path.read_text(encoding="utf8")
            for path in sorted((ROOT / "backend" / "db").rglob("*.py"))
        ).lower()
        for forbidden in (
            "google.cloud.sql.connector",
            "cloud_sql_python_connector",
            "import pg8000",
            "import asyncpg",
            "cloud-sql-proxy",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_container_entrypoints_have_no_proxy_process_integration(self):
        runtime_files = (
            ROOT / "Dockerfile",
            ROOT / "scripts" / "docker-entrypoint.sh",
        )
        source = "\n".join(
            path.read_text(encoding="utf8")
            for path in runtime_files
        ).lower()
        for forbidden in ("cloud-sql-proxy", "cloud_sql_proxy"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
```

The tests read `Dockerfile` and `scripts/docker-entrypoint.sh`; implementation
must not edit those files.

- [x] **Step 3: Run the documentation tests and confirm failure**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_env_config_docs \
  tests.test_cloud_sql_iam.CloudSqlScopeGuardTests
```

Expected: documentation assertions fail because the hosted contract is not yet
present; forbidden-integration guards already pass.

- [x] **Step 4: Update `.env.example` without changing local defaults**

Keep the existing local block and add:

```env
# Defaults to url; local development and CI keep using DATABASE_URL normally.
DATABASE_CONNECTION_MODE=url
DATABASE_URL=postgresql+psycopg://jep:jep@localhost:5432/jep_local
```

Replace only the hosted database lines in the commented hosting block with:

```env
# Direct Cloud SQL PostgreSQL IAM authentication through synchronous psycopg.
# SRE supplies the exact percent-encoded IAM DB user, private IP/private DNS,
# explicit port, database, and mounted TLS paths.
# This URL must not contain a password.
# The app obtains the short-lived password token from Application Default
# Credentials with https://www.googleapis.com/auth/sqlservice.login.
# Enable cloudsql.iam_authentication; add the workload ADC principal as a Cloud
# SQL IAM database user; grant roles/cloudsql.instanceUser for
# cloudsql.instances.login; match the database username to the ADC identity;
# and grant the required PostgreSQL database, schema, and table privileges.
# Every connection uses a fixed 10-second connection timeout; connect_timeout
# is app-owned and forbidden in DATABASE_URL.
# Do not add the Cloud SQL Python Connector, alternate drivers, or an Auth Proxy.
# DATABASE_CONNECTION_MODE=cloud_sql_iam
# DATABASE_URL=postgresql+psycopg://<percent-encoded-iam-database-user>@<private-host>:5432/<database>?sslmode=verify-full&sslrootcert=<percent-encoded-mounted-ca-path>
```

Do not introduce a token environment variable or uncomment hosted values.

- [x] **Step 5: Update `README.md` and `INSTALL.md` infrastructure sections**

In each internal-hosting environment block, replace the generic database line
with:

```env
DATABASE_CONNECTION_MODE=cloud_sql_iam
DATABASE_URL=postgresql+psycopg://<percent-encoded-iam-database-user>@<private-host>:5432/<database>?sslmode=verify-full&sslrootcert=<percent-encoded-mounted-ca-path>
```

Immediately below each block, document all of these exact statements:

```text
This is a direct synchronous psycopg TCP/TLS connection to the SRE-provided
private IP or private DNS endpoint. The app does not use the Cloud SQL Python
Connector, pg8000, asyncpg, a Cloud SQL Auth Proxy sidecar/binary, or another
proxy process.

The IAM-mode DATABASE_URL must not contain a password. The application obtains
a short-lived login token from Application Default Credentials using only
https://www.googleapis.com/auth/sqlservice.login and passes it to psycopg only
when a new physical connection is opened. There is no password-auth fallback.

SRE supplies the exact percent-encoded IAM database username, host, explicit
port, database name, and TLS settings. sslmode must be require, verify-ca, or
verify-full; verify-ca and verify-full require sslrootcert. sslcert and sslkey
must be provided together when client certificates are required.

Before enabling IAM mode, SRE enables `cloudsql.iam_authentication`, adds the
workload ADC principal as a Cloud SQL IAM database user, grants
`roles/cloudsql.instanceUser` / `cloudsql.instances.login`, matches the
database username to the ADC identity mapping, and grants the required
PostgreSQL database, schema, and table privileges. Every IAM psycopg connection
uses the fixed app-owned 10-second timeout; `connect_timeout` is rejected in
`DATABASE_URL`.

Online Alembic uses the same IAM path with NullPool. Offline Alembic SQL
generation does not need Google credentials. Normal web processes retain
SQLAlchemy pooling.

Local development and CI omit cloud_sql_iam mode and keep their existing
DATABASE_URL/TEST_DATABASE_URL behavior.

No live Cloud SQL verification is claimed by the unit test suite. A live claim
requires a separately approved instance, identity, private network path, and TLS
configuration.
```

Keep existing local PostgreSQL setup examples and migration commands unchanged.
Do not add Terraform, Helm, CI, container, sidecar, or proxy setup instructions.

- [x] **Step 6: Run documentation and scope-guard tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_env_config_docs \
  tests.test_cloud_sql_iam.CloudSqlScopeGuardTests
```

Expected: all tests pass; the source guards confirm direct psycopg-only scope.

- [x] **Step 7: Commit Task 6**

```bash
git add \
  .env.example \
  README.md \
  INSTALL.md \
  tests/test_env_config_docs.py \
  tests/test_cloud_sql_iam.py
git commit -m "docs: define Cloud SQL IAM connection contract"
```

---

### Task 7: Verify the complete database-only change

**Files:**

- Verify only: all files in the approved file map
- Do not create a live Cloud SQL test or modify deployment infrastructure

**Interfaces:**

- Consumes: all previous tasks.
- Produces: focused and complete Python verification evidence plus a final
  scope/secrecy audit.

- [x] **Step 1: Install the pinned direct dependency through the project workflow**

Run:

```bash
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e .
```

Expected: installation succeeds with `google-auth==2.56.2` and the retained
`psycopg[binary]==3.2.13`. Do not install any Cloud SQL Connector or alternate
driver package.

- [x] **Step 2: Run the focused database, migration, preflight, and docs tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_cloud_sql_iam \
  tests.test_db_session \
  tests.test_db_migrations \
  tests.test_startup_preflight \
  tests.test_env_config_docs
```

Expected: all focused tests pass.

- [x] **Step 3: Run affected DB configuration/startup regression tests**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_config_storage_selector \
  tests.test_dashboard_bootstrap_config_source \
  tests.test_config_jsonfile_fallback \
  tests.test_app_startup \
  tests.test_project_packaging \
  tests.test_env_file_pinning
```

Expected: all tests pass with unchanged URL-mode behavior.

- [x] **Step 4: Run startup preflight in the local non-DB compatibility mode**

Run:

```bash
env \
  JIRA_AUTH_MODE=basic \
  JIRA_URL=https://example.atlassian.invalid \
  JIRA_EMAIL=synthetic@example.invalid \
  JIRA_TOKEN=synthetic-token \
  CONFIG_STORAGE_BACKEND=jsonfile \
  DATABASE_CONNECTION_MODE=url \
  DATABASE_URL= \
  TEST_DATABASE_URL= \
  APP_BIND_HOST=127.0.0.1 \
  .venv/bin/python scripts/check_startup_preflight.py
```

Expected: preflight does not require a database for JSON-file mode and does not
attempt ADC discovery.

- [x] **Step 5: Run the complete Python suite**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: the complete Python suite passes. Read and resolve the complete
failure output; do not infer success from focused tests.

- [x] **Step 6: Audit the changed-file boundary**

Run:

```bash
git status --short
git diff --name-only main...HEAD
git diff --check main...HEAD
```

Expected: implementation changes are confined to:

```text
.env.example
INSTALL.md
README.md
backend/db/cloud_sql.py
backend/db/engine.py
backend/db/migrations/env.py
requirements.txt
scripts/check_startup_preflight.py
tests/test_cloud_sql_iam.py
tests/test_db_migrations.py
tests/test_db_session.py
tests/test_env_config_docs.py
tests/test_startup_preflight.py
```

The plan/design/index/gate documentation may also differ on the planning
branch. `.playwright-mcp/` is pre-existing unrelated untracked state and must
remain untouched. No Terraform, Helm, CI, Docker, entrypoint, frontend, route,
model, migration-version, authentication, or product file may be in the
implementation diff.

- [x] **Step 7: Audit secrets and forbidden integrations**

Run:

```bash
rg -n \
  'cloud-sql-python-connector|google\\.cloud\\.sql\\.connector|import pg8000|import asyncpg|cloud-sql-proxy|cloud_sql_proxy' \
  requirements.txt backend/db Dockerfile scripts/docker-entrypoint.sh
```

Expected: no matches.

Run:

```bash
rg -n \
  'CLOUD_SQL_(IAM_)?TOKEN|GOOGLE_OAUTH_ACCESS_TOKEN' \
  .env.example README.md INSTALL.md backend/db scripts/check_startup_preflight.py
```

Expected: no token environment-variable contract, assignment, or production
read path.

- [x] **Step 8: Record the live-verification boundary**

In the execution summary or PR description, use this exact statement unless a
separately approved live test was actually run:

```text
Live Cloud SQL connectivity was not verified. Unit and integration tests used
synthetic credentials and mocked psycopg connections; an approved Cloud SQL
instance, private network path, IAM principal, and SRE TLS configuration were
not provided.
```

- [x] **Step 9: Review commits before any push**

Run:

```bash
git log --oneline -5
```

Expected: atomic feature/docs commits with no agent/tool branding, secrets,
production identifiers, or unrelated changes. Stop for explicit user
confirmation before pushing, as required by the repository workflow.

## Acceptance Criteria Matrix

| Requirement | Proof |
| --- | --- |
| Local and CI URL behavior unchanged | `test_default_url_mode_preserves_existing_create_engine_path`, `test_test_database_url_precedence_is_unchanged_in_url_mode`, existing `tests.test_db_session`, full suite |
| Cloud SQL uses psycopg | exact driver validation, engine dialect assertion, direct `psycopg.connect`, dependency/source guards |
| ADC refreshes expired credentials | `test_expired_credentials_are_refreshed` |
| Concurrent refresh is serialized | `test_concurrent_requests_perform_one_refresh` |
| Every new physical connection gets a current token | `test_every_creator_call_receives_the_current_token` and engine pool creator test |
| Private-endpoint connection attempts are bounded | fixed `CLOUD_SQL_CONNECT_TIMEOUT_SECONDS`, creator kwargs assertions, and rejected URL override |
| Token-provider failures retain their error boundary | `test_token_provider_failure_propagates_without_calling_psycopg` |
| Token absent from URLs, logs, errors, and cache keys | safe URL/cache tests, creator log/error tests, ADC error tests, final scans |
| Online Alembic shares factory | patched factory assertion in `tests.test_db_migrations` |
| Web pooling and migration `NullPool` | `QueuePool` web assertion and `NullPool` migration assertion |
| Offline Alembic validates IAM configuration without credentials | unsafe URL rejection plus ADC/provider/connect paths patched to raise during `command.upgrade(..., sql=True)` |
| Unsafe config fails preflight | missing-field, driver, password, mode, and TLS preflight tests |
| No Connector, alternate driver, or proxy integration | `CloudSqlScopeGuardTests`, final source scan, changed-file audit |
| Sanitized token/connection failures | traceback assertions with secret-bearing fake failures |
| Exact operator contract | `.env.example`, `README.md`, `INSTALL.md`, `tests.test_env_config_docs` |
| Focused and full verification | Task 7 commands |
| No unsupported live claim | exact Task 7 execution-summary statement |

## Residual Risks

- Unit tests cannot prove SRE private routing, DNS resolution, certificate
  identity, IAM role assignment, instance IAM-auth enablement, or the exact
  database username. Those remain operator-owned and require an approved live
  test.
- `sslmode=require` encrypts traffic but does not verify server identity.
  `verify-full` with an SRE-provided private DNS name and CA is preferred when
  the certificate supports it; the implementation accepts `require` because
  the feature requirements permit SRE-owned TLS settings and only mandate
  encryption.
- Existing pooled physical connections remain usable until SQLAlchemy or the
  server closes them; the short-lived token is required only at login. New
  physical connections always call the current-token provider.
