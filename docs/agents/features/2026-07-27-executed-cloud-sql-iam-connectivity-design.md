# Cloud SQL IAM Connectivity Design

Status: executed
Type: feature

## Goal

Add an explicit hosted Cloud SQL for PostgreSQL connection mode that keeps the
existing synchronous SQLAlchemy 2 and psycopg 3 stack, obtains short-lived IAM
database login tokens from Application Default Credentials (ADC), and supplies a
current token only when psycopg opens a new physical database connection.

Local development and CI continue to use the existing `DATABASE_URL` behavior
unless the hosted IAM mode is explicitly selected.

## Scope

This change is limited to database connection construction, online Alembic
connection construction, startup configuration validation, direct runtime
dependencies, and the matching environment and infrastructure documentation.

It does not change Terraform, Helm, CI, container packaging, authentication UI,
database schema, migrations, application routes, product behavior, or analytics.
No analytics event is needed because the change has no user interaction or
user-visible state transition.

## External Constraints

- Continue using `postgresql+psycopg` with the pinned synchronous psycopg 3
  driver.
- The only allowed database transport is a direct psycopg TCP/TLS connection to
  the private IP or private DNS endpoint supplied by SRE. Do not add or
  configure the Cloud SQL Python Connector, `pg8000`, `asyncpg`, a Cloud SQL
  Auth Proxy sidecar or binary, or any other proxy process. The Python
  Connector is excluded because its PostgreSQL driver support is currently
  `pg8000` and `asyncpg`, not psycopg.
- Use manual Cloud SQL IAM database authentication: the IAM access token is the
  PostgreSQL password for the connection attempt.
- Request ADC credentials with the exact
  `https://www.googleapis.com/auth/sqlservice.login` scope.
- IAM database authentication requires TLS. Hosted mode must reject
  opportunistic or disabled TLS settings.

References:

- [Cloud SQL Python Connector supported drivers](https://github.com/GoogleCloudPlatform/cloud-sql-python-connector#supported-drivers)
- [Cloud SQL PostgreSQL IAM login](https://docs.cloud.google.com/sql/docs/postgres/iam-logins)
- [Google Auth ADC API](https://google-auth.readthedocs.io/en/latest/reference/google.auth.html)
- [SQLAlchemy dynamic authentication tokens](https://docs.sqlalchemy.org/en/20/core/engines.html#generating-dynamic-authentication-tokens)
- [PostgreSQL libpq TLS modes](https://www.postgresql.org/docs/current/libpq-ssl.html)

## Configuration Contract

Introduce one selector:

```env
DATABASE_CONNECTION_MODE=url
```

Allowed values:

- `url` (default): preserve the current `DATABASE_URL` and
  `TEST_DATABASE_URL` behavior exactly.
- `cloud_sql_iam`: enable the hosted direct-connection IAM path.

In `cloud_sql_iam` mode, `DATABASE_URL` remains the single source for stable
database connection metadata:

```env
DATABASE_CONNECTION_MODE=cloud_sql_iam
DATABASE_URL=postgresql+psycopg://<percent-encoded-iam-database-user>@<private-host>:5432/<database>?sslmode=verify-full&sslrootcert=<percent-encoded-mounted-ca-path>
```

SRE owns the exact host or private DNS name, IAM database username, database
name, port, and TLS query parameters. The IAM username must be URL encoded when
it contains reserved characters.

Hosted IAM mode requires all of the following:

- URL driver is exactly `postgresql+psycopg`.
- URL includes a non-empty host, username, database name, and valid port.
- URL contains no password. A password is a configuration error, not a fallback.
- `sslmode` is exactly `require`, `verify-ca`, or `verify-full`.
- Missing `sslmode`, `disable`, `allow`, and `prefer` fail validation.
- `verify-ca` and `verify-full` require an explicit `sslrootcert`; `sslcert`
  and `sslkey` must be provided together when client certificates are used.
- Allowed query keys are limited to `sslmode`, `sslrootcert`, `sslcert`,
  `sslkey`, `sslcrl`, `sslcrldir`, `sslsni`,
  `ssl_min_protocol_version`, `ssl_max_protocol_version`, and
  `channel_binding`. These are stable, non-secret TLS metadata passed to
  psycopg. The IAM token is never a query setting. `connect_timeout` is also
  rejected as a URL query key.
- The application adds a fixed 10-second `connect_timeout` to every validated
  IAM psycopg connection. It is not an environment setting or operator URL
  option.

ADC discovery remains the standard Google Auth mechanism. The application does
not define an environment variable for the IAM login token. SRE is responsible
for enabling the Cloud SQL PostgreSQL `cloudsql.iam_authentication` database
flag, adding the workload ADC principal as a Cloud SQL IAM database user,
granting `roles/cloudsql.instanceUser` (which supplies
`cloudsql.instances.login`), matching the database username to the ADC identity
mapping, granting the required PostgreSQL database, schema, and table
privileges, and making the private endpoint and TLS materials reachable.

## Recommended Architecture

### Cloud SQL boundary

Add `backend/db/cloud_sql.py` as the only Cloud SQL-specific runtime module. It
owns:

- parsing and validating the hosted IAM configuration;
- loading ADC with the `sqlservice.login` scope;
- serializing refresh through one lock per credential provider;
- returning the current in-memory credential token;
- constructing a synchronous psycopg connection with stable URL metadata and
  the current token supplied as the password and the fixed 10-second connection
  timeout;
- translating credential-refresh and connection failures into fixed,
  sanitized exception messages.

The token provider may reuse a still-valid token held by the Google credentials
object. It refreshes when the credentials are expired or otherwise invalid.
Every creator invocation asks the provider for the current token, so every new
physical connection gets a current token even though SQLAlchemy may reuse
already-open pooled connections.

The refresh path uses double-checked locking: check validity, acquire the lock,
check validity again, then refresh only if still necessary. Concurrent pool
growth therefore performs one refresh instead of racing multiple refreshes.

### Shared SQLAlchemy engine factory

Refactor `backend/db/engine.py` so one engine-construction function owns both
connection modes:

- URL mode calls `sqlalchemy.create_engine()` the same way it does today.
- Cloud SQL IAM mode creates a `postgresql+psycopg` engine whose URL contains
  only stable, passwordless connection metadata and whose `creator` calls the
  Cloud SQL boundary immediately before psycopg opens a physical connection.
- Web application callers continue through `get_engine()` and retain normal
  SQLAlchemy pooling, `pool_pre_ping=True`, session-factory reuse, and engine
  caching.
- The engine and session cache keys contain only the selected mode and stable,
  passwordless URL configuration. Credential objects and tokens never
  participate in a key.
- `dispose_engines()` continues to dispose cached web engines and also releases
  the associated creator/provider references.

Use SQLAlchemy's `creator` hook instead of storing a password-producing object in
the URL. SQLAlchemy documents that a URL password object is stringified once per
engine, which cannot satisfy per-physical-connection token injection.

### Alembic

Online Alembic migrations call the same engine-construction function with
`sqlalchemy.pool.NullPool` and without placing the migration engine in the web
engine cache. This gives online migrations the identical Cloud SQL creator and
IAM-token path while opening and closing physical connections per migration
process.

Offline Alembic migrations preserve URL-mode behavior. In Cloud SQL IAM mode
they pure-validate the configured URL through `CloudSqlIamConfig`, translate
the fixed configuration error without a sensitive chain, and configure the
migration context with only the passwordless `safe_url`. They do not
instantiate an ADC provider, call `google.auth.default()`, refresh credentials,
connect, or require Google credentials.

## Secret Handling

The IAM token exists only as the return value of the token provider and as the
ephemeral `password` argument passed to `psycopg.connect()`.

It must never be:

- written to an environment variable;
- inserted into a SQLAlchemy URL;
- included in an engine or session-factory cache key;
- attached to a configuration object or exception;
- interpolated into a log message;
- retained in diagnostic output.

Credential-loading, token-refresh, and psycopg connection failures are converted
to fixed messages and raised without retaining a sensitive exception chain.
Preflight output reports only the validated connection mode and non-secret field
presence; it does not print the URL, username, host, database, TLS paths, ADC
details, or tokens.

## Dependencies

Add the direct runtime pin:

```text
google-auth==2.56.2
```

The existing pinned `requests` dependency supplies the synchronous Google Auth
transport, and the existing `psycopg[binary]==3.2.13` dependency remains
unchanged. No Cloud SQL Connector package or alternate PostgreSQL driver is
added.

## Failure Behavior

- Unknown `DATABASE_CONNECTION_MODE`: startup and engine construction fail with
  a fixed configuration error.
- Missing or malformed hosted URL fields: preflight and engine construction
  fail before ADC is loaded.
- Password present in hosted URL: fail; never fall back to it.
- Unsafe or missing TLS mode: fail before ADC or network access.
- ADC unavailable or refresh rejected: fail with a fixed IAM-token acquisition
  error that contains no underlying credential text.
- Psycopg connection rejected or unreachable: fail with a fixed Cloud SQL
  connection error that contains no token or raw connection arguments; the
  connection attempt is bounded by the fixed 10-second timeout.
- URL mode errors and behavior remain unchanged.

## Verification Design

Add focused unit coverage for:

- unchanged URL-mode resolution, engine creation, pooling, cache reuse, and
  `TEST_DATABASE_URL` precedence;
- exact `postgresql+psycopg` dialect and psycopg DBAPI use in IAM mode;
- ADC loading with only the `sqlservice.login` scope;
- reuse of valid credentials and refresh of expired credentials;
- one refresh under concurrent creator calls;
- a current token supplied on every creator invocation/new physical
  connection;
- token absence from engine URLs, cache keys, logs, exception strings, and
  tracebacks;
- rejection of passwords, missing URL fields, wrong drivers, and unsafe TLS;
- fixed 10-second connection kwargs and rejection of operator-supplied
  `connect_timeout`;
- sanitized ADC-refresh and psycopg-connect failure messages;
- online Alembic use of the shared engine factory with `NullPool`;
- offline Alembic execution without ADC access;
- source and dependency guards preventing the Cloud SQL Python Connector,
  `pg8000`, `asyncpg`, and proxy integration;
- exact hosted configuration documentation in `.env.example`, `README.md`, and
  `INSTALL.md`.

Implementation verification must run the focused database, migration, startup
preflight, dependency, and documentation tests, followed by the complete Python
test suite. Live Cloud SQL verification is explicitly unproven unless a separate
approved instance test is performed and recorded.

## Acceptance Criteria

The change is complete when all requested positive and negative tests pass, URL
mode remains backward compatible, the web app and online Alembic share the same
IAM connection creator, migrations retain the required pool behavior, offline
migrations need no Google credentials, unsafe hosted configuration fails
closed, and the diff contains no infrastructure or product changes outside this
design's file map.

## Outcome

Implemented with the approved fixed-timeout and operator-prerequisite
amendments. The implementation is now the source of truth.

## Current Accuracy

Accurate as of 2026-07-27. Local unit, integration, preflight, source-scan, and
controlled real-process startup verification passed. Live Cloud SQL
connectivity remains unverified because no approved instance, private network
path, IAM principal, or SRE TLS configuration was provided.
