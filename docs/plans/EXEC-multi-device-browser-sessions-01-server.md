# Multi-Device Browser Sessions Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Holistic server review fixes implemented on 2026-09-01; Task 6 acceptance rerun pending. Kept as `EXEC-*` pending acceptance or merge; the frontend slice remains gated.

**Goal:** Replace mutable OAuth `token_version` browser validity with persistent opaque DB browser-profile sessions while preserving cache invalidation, per-profile logout, connection-wide revocation, legacy-cookie compatibility, and existing API contracts.

**Architecture:** A new `browser_sessions` table links one opaque signed-cookie id to the existing user, workspace, and shared OAuth connection. Request resolution obtains the latest connection token version from the database, while CSRF binds to the stable browser-session id. Callback, logout, refresh-reuse revocation, and Scenario internal reloads use one lifecycle module; no route queries the table directly.

**Tech Stack:** Python 3.10+, Flask signed sessions, SQLAlchemy 2, Alembic, `unittest`, SQLite/PostgreSQL-compatible schema.

---

## File Map

- Create: `backend/db/migrations/versions/20260830_0009_browser_sessions.py`
- Create: `backend/auth/db_browser_sessions.py`
- Create: `tests/test_db_browser_sessions.py`
- Modify: `docs/plans/EXEC-multi-device-browser-sessions-01-server.md`
- Modify: `docs/plans/SUPPORT-multi-device-browser-sessions-design.md`
- Modify (Task 0 gate record only): `docs/plans/GATE-05-home-write-capability.md`
- Modify (pre-execution cross-slice coordination only): `docs/plans/EXEC-multi-device-browser-sessions-02-tab-resume.md`
- Modify (pre-execution plan-index coordination only): `docs/plans/README.md`
- Modify: `backend/db/models.py`
- Modify: `backend/auth/context.py`
- Modify: `backend/auth/db_context.py`
- Modify: `backend/auth/db_tokens.py`
- Modify: `backend/auth/csrf.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `backend/routes/scenario_draft_routes.py`
- Modify: `jira_server.py`
- Modify: `tests/test_db_migrations.py`
- Modify: `tests/test_auth_context_db.py`
- Modify: `tests/test_auth_routes.py`
- Modify: `tests/test_codebase_structure_budgets.py`
- Modify: `tests/test_db_oauth_cutover.py`
- Modify: `tests/test_token_refresh_reuse.py`
- Modify: `tests/test_token_refresh_race.py`
- Modify: `tests/test_scenario_draft_routes.py`
- Modify: `tests/test_endpoint_security_matrix.py`
- Modify: `tests/test_epm_config_api.py`

No frontend source, generated asset, Home/Townsquare route, Jira mutation route, credential schema, or configuration ownership file changes in this slice.

The sibling frontend plan and plan index changes on this execution branch are pre-execution coordination that records the server-first dependency and naming state; they are included in the aggregate review scope but are not server runtime implementation, so this holistic server fix does not modify them. The Home write gate is likewise a Task 0 status input only, while the support design remains the architecture map for this slice.

### Task 0: Verify the execution baseline and gate

**Files:**

- Modify: `docs/plans/EXEC-multi-device-browser-sessions-01-server.md`
- Modify (status check only): `docs/plans/GATE-05-home-write-capability.md`

- [x] **Step 1: Confirm the branch contains the global auth-lock prerequisite**

Run:

```bash
git fetch origin main
git merge-base --is-ancestor b38e8f7 HEAD
```

Expected: both commands exit `0`. If the ancestry check fails, stop; update the execution branch from `origin/main` before editing. Do not reimplement `frontend/src/api/authRequired.js` in this slice.

- [x] **Step 2: Confirm the migration head and planned file map**

Run:

```bash
.venv/bin/python -m alembic -c backend/db/alembic.ini heads
test -f backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py
test -f backend/auth/db_context.py
test -f backend/routes/scenario_draft_routes.py
test -f tests/test_db_migrations.py
```

Expected at the reviewed baseline: one head, `20260827_0008 (head)`, and every `test -f` exits `0`. If the migration head differs, stop and update this plan's migration filename, `revision`, and `down_revision` before implementation.

- [x] **Step 3: Recheck the unrelated Home write gate without executing it**

Run:

```bash
rg -n "Status|Checked on|Last result" docs/plans/GATE-05-home-write-capability.md
```

Expected: `Status` remains `Blocked`, `Checked on` is current for the execution session, and no Home write probe or mutation is part of this plan.

### Task 1: Add the browser-session schema

**Files:**

- Create: `backend/db/migrations/versions/20260830_0009_browser_sessions.py`
- Modify: `backend/db/models.py`
- Modify: `tests/test_db_migrations.py`

- [x] **Step 1: Write failing migration and model tests**

Add assertions that the upgraded schema contains exactly the safe columns and indexes, and that downgrade removes only the new table:

```python
def test_browser_sessions_migration_contract(self):
    self._upgrade('20260830_0009')
    inspector = sa.inspect(self.engine)
    self.assertIn('browser_sessions', inspector.get_table_names())
    self.assertEqual(
        {column['name'] for column in inspector.get_columns('browser_sessions')},
        {'id', 'user_id', 'workspace_id', 'auth_connection_id', 'created_at'},
    )
    index_names = {index['name'] for index in inspector.get_indexes('browser_sessions')}
    self.assertEqual(index_names, {
        'ix_browser_sessions_connection',
        'ix_browser_sessions_user_workspace',
    })
    self.assertNotIn('access_token', str(inspector.get_columns('browser_sessions')))
    self._downgrade('20260827_0008')
    self.assertNotIn('browser_sessions', sa.inspect(self.engine).get_table_names())
    self.assertIn('auth_connections', sa.inspect(self.engine).get_table_names())
```

Add a model test that constructs `models.BrowserSession` with valid foreign keys and confirms cascade delete from `auth_connections` removes it.

- [x] **Step 2: Run the migration tests to verify they fail**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_migrations
```

Expected: FAIL because revision `20260830_0009`, table `browser_sessions`, and `models.BrowserSession` do not exist.

- [x] **Step 3: Add the model and migration**

Add this model after `AuthConnection` and before `AuthToken`:

```python
class BrowserSession(Base):
    __tablename__ = 'browser_sessions'
    __table_args__ = (
        Index('ix_browser_sessions_connection', 'auth_connection_id'),
        Index('ix_browser_sessions_user_workspace', 'user_id', 'workspace_id'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    auth_connection_id: Mapped[str] = mapped_column(
        ForeignKey('auth_connections.id', ondelete='CASCADE'),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
```

Create the Alembic revision with this complete upgrade/downgrade contract:

```python
"""add opaque DB browser sessions

Revision ID: 20260830_0009
Revises: 20260827_0008
Create Date: 2026-08-30
"""

from alembic import op
import sqlalchemy as sa

revision = '20260830_0009'
down_revision = '20260827_0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'browser_sessions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('auth_connection_id', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['auth_connection_id'], ['auth_connections.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_browser_sessions_connection', 'browser_sessions', ['auth_connection_id'])
    op.create_index('ix_browser_sessions_user_workspace', 'browser_sessions', ['user_id', 'workspace_id'])


def downgrade() -> None:
    op.drop_index('ix_browser_sessions_user_workspace', table_name='browser_sessions')
    op.drop_index('ix_browser_sessions_connection', table_name='browser_sessions')
    op.drop_table('browser_sessions')
```

- [x] **Step 4: Run the focused migration tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_migrations
```

Expected: PASS, including upgrade from `20260827_0008`, downgrade back to it, foreign keys, indexes, and forbidden-column assertions.

- [x] **Step 5: Commit the schema slice**

```bash
git add backend/db/models.py backend/db/migrations/versions/20260830_0009_browser_sessions.py tests/test_db_migrations.py
git commit -m "Add persistent DB browser sessions"
```

### Task 2: Add one browser-session lifecycle boundary

**Files:**

- Create: `backend/auth/db_browser_sessions.py`
- Create: `tests/test_db_browser_sessions.py`
- Modify: `docs/plans/EXEC-multi-device-browser-sessions-01-server.md`

- [x] **Step 1: Write failing lifecycle tests**

Cover create, resolve, single delete, connection-wide delete, ownership mismatch, and the exact OAuth provider boundary. `test_create_rejects_non_oauth_connection_provider` must raise `auth_required`, while `test_resolve_rejects_non_oauth_connection_provider` must treat a persisted row referencing any provider other than `atlassian_oauth` as unresolved:

```python
def test_create_and_resolve_browser_session(self):
    """A created browser session resolves to its expected ownership metadata."""
    with self.factory() as session:
        handle = create_browser_session(
            session,
            user_id=self.user_id,
            workspace_id=self.workspace_id,
            auth_connection_id=self.connection_id,
        )
        session.commit()
    with self.factory() as session:
        resolved = resolve_browser_session(session, handle.id)
    self.assertEqual(resolved, handle)
    self.assertEqual(set(handle.__dataclass_fields__), {
        'id', 'user_id', 'workspace_id', 'auth_connection_id',
    })

def test_delete_all_for_connection_does_not_cross_connection(self):
    """Connection-wide deletion preserves sessions owned by other connections."""
    with self.factory() as session:
        first = create_browser_session(session, user_id=self.user_id, workspace_id=self.workspace_id, auth_connection_id=self.connection_id)
        second = create_browser_session(session, user_id=self.user_id, workspace_id=self.workspace_id, auth_connection_id=self.connection_id)
        other = create_browser_session(session, user_id=self.other_user_id, workspace_id=self.workspace_id, auth_connection_id=self.other_connection_id)
        self.assertEqual(delete_browser_sessions_for_connection(session, f' {self.connection_id} '), 2)
        session.commit()
    with self.factory() as session:
        self.assertIsNone(resolve_browser_session(session, first.id))
        self.assertIsNone(resolve_browser_session(session, second.id))
        self.assertEqual(resolve_browser_session(session, other.id).id, other.id)
        self.assertEqual(delete_browser_sessions_for_connection(session, ''), 0)
```

Assert the module never serializes tokens, email, user agent, IP, or callback values.

- [x] **Step 2: Run the new tests to verify they fail**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_browser_sessions
```

Expected: FAIL with `ModuleNotFoundError: backend.auth.db_browser_sessions`.

- [x] **Step 3: Implement the lifecycle module**

Create these exact public types and functions:

```python
from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import delete

from backend.auth.jira_auth import AuthError
from backend.db import models


@dataclass(frozen=True)
class BrowserSessionHandle:
    id: str
    user_id: str
    workspace_id: str
    auth_connection_id: str


def _handle(row: models.BrowserSession) -> BrowserSessionHandle:
    return BrowserSessionHandle(
        id=row.id,
        user_id=row.user_id,
        workspace_id=row.workspace_id,
        auth_connection_id=row.auth_connection_id,
    )


def create_browser_session(
    session,
    *,
    user_id: str,
    workspace_id: str,
    auth_connection_id: str,
) -> BrowserSessionHandle:
    connection = session.get(models.AuthConnection, auth_connection_id)
    if (
        connection is None
        or connection.provider != 'atlassian_oauth'
        or connection.user_id != user_id
        or connection.workspace_id != workspace_id
    ):
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    row = models.BrowserSession(
        id=str(uuid4()),
        user_id=user_id,
        workspace_id=workspace_id,
        auth_connection_id=auth_connection_id,
    )
    session.add(row)
    session.flush()
    return _handle(row)


def resolve_browser_session(session, browser_session_id: str) -> BrowserSessionHandle | None:
    value = str(browser_session_id or '').strip()
    if not value:
        return None
    row = session.get(models.BrowserSession, value)
    if row is None:
        return None
    connection = session.get(models.AuthConnection, row.auth_connection_id)
    if connection is None or connection.provider != 'atlassian_oauth':
        return None
    return _handle(row)


def delete_browser_session(session, browser_session_id: str) -> int:
    value = str(browser_session_id or '').strip()
    if not value:
        return 0
    result = session.execute(delete(models.BrowserSession).where(models.BrowserSession.id == value))
    return int(result.rowcount or 0)


def delete_browser_sessions_for_connection(session, auth_connection_id: str) -> int:
    value = str(auth_connection_id or '').strip()
    if not value:
        return 0
    result = session.execute(
        delete(models.BrowserSession).where(models.BrowserSession.auth_connection_id == value)
    )
    return int(result.rowcount or 0)
```

- [x] **Step 4: Run the focused lifecycle tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_browser_sessions
```

Expected: PASS with no token-bearing field in the handle or table.

- [x] **Step 5: Commit the lifecycle slice**

```bash
git add backend/auth/db_browser_sessions.py tests/test_db_browser_sessions.py docs/plans/EXEC-multi-device-browser-sessions-01-server.md
git commit -m "Add browser session lifecycle boundary"
```

### Task 3: Resolve opaque sessions and lazily upgrade legacy cookies

**Files:**

- Modify: `backend/auth/context.py`
- Modify: `backend/auth/db_context.py`
- Modify: `jira_server.py`
- Modify: `tests/test_auth_context_db.py`
- Modify: `tests/test_db_oauth_cutover.py`
- Modify: `docs/plans/EXEC-multi-device-browser-sessions-01-server.md`

- [x] **Step 1: Write failing request-context tests**

Add tests with two browser rows sharing one connection. Rotate the connection token version and prove both rows resolve the new version:

```python
def test_browser_sessions_ignore_cookie_token_version_and_return_current_connection_version(self):
    """Opaque sessions ignore cookie versions and expose the current connection version."""
    first_id, second_id, connection_id = self._seed_browser_sessions(token_version=3)
    self._set_connection_token_version(connection_id, 4)

    first_context = resolve_db_request_auth_context(
        {'db_browser_session_id': first_id, 'db_token_version': '3'},
        database_url=self.database_url,
        required_scopes=FULL_SCOPE,
    )
    second_context = resolve_db_request_auth_context(
        {'db_browser_session_id': second_id, 'db_token_version': '3'},
        database_url=self.database_url,
        required_scopes=FULL_SCOPE,
    )

    self.assertEqual(first_context.browser_session_id, first_id)
    self.assertEqual(second_context.browser_session_id, second_id)
    self.assertEqual(first_context.token_version, '4')
    self.assertEqual(second_context.token_version, '4')

def test_legacy_connection_requires_a_nonempty_exact_token_version(self):
    """Reject missing and empty legacy versions with the stale-connection contract."""
    _, _, connection_id = self._seed_connection(token_version=3)

    for name, session_data in (
        ('missing', {'db_auth_connection_id': connection_id}),
        ('empty', {'db_auth_connection_id': connection_id, 'db_token_version': ''}),
    ):
        with self.subTest(name=name):
            with self.assertRaises(AuthError) as raised:
                resolve_db_request_auth_context(
                    session_data,
                    database_url=self.database_url,
                    required_scopes=FULL_SCOPE,
                )

            self.assertEqual(raised.exception.code, 'auth_connection_stale')
```

Also cover the exact implemented ownership/provider cases in `test_browser_session_rejects_user_owner_mismatch`, `test_browser_session_rejects_workspace_owner_mismatch`, and `test_browser_session_rejects_non_oauth_connection_provider`. Retain the valid and stale legacy exact-version cases. Flask coverage must include `test_valid_legacy_cookie_is_replaced_with_opaque_browser_session`, `test_stale_legacy_cookie_is_not_upgraded`, and `test_missing_or_empty_legacy_version_uses_exact_recovery_without_row_creation`.

- [x] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
.venv/bin/python -m unittest tests.test_auth_context_db tests.test_db_oauth_cutover
```

Expected: FAIL because `RequestAuthContext` has no `browser_session_id` and resolver still rejects shared token rotation as stale.

- [x] **Step 3: Extend the immutable request context**

Add a defaulted field so existing explicit test constructors remain compatible:

```python
@dataclass(frozen=True)
class RequestAuthContext:
    auth_mode: str
    user_id: str
    stable_subject: str
    atlassian_account_id: str
    workspace_id: str
    auth_connection_id: str
    cloud_id: str
    site_url: str
    token_version: str
    account_status: str
    is_admin: bool
    project_access: tuple[ProjectAccessSnapshot, ...] = field(default_factory=tuple)
    browser_session_id: str = ''
```

- [x] **Step 4: Resolve the row before the shared connection**

In `backend/auth/db_context.py`, branch on `db_browser_session_id`. Resolve that id only through `db_browser_sessions.resolve_browser_session`, then load `AuthConnection`, `User`, and `Workspace`; reject any id mismatch; skip the legacy `session_token_version` comparison; and return the current DB token version plus the row id. Do not query `models.BrowserSession` outside the lifecycle module (migration/model tests may inspect the table directly):

```python
browser_session_id = str((session_data or {}).get('db_browser_session_id') or '').strip()
browser_session = (
    resolve_browser_session(session, browser_session_id) if browser_session_id else None
)
if browser_session_id and browser_session is None:
    raise AuthError('auth_required', 'Atlassian authentication is required.')
connection = (
    session.get(models.AuthConnection, browser_session.auth_connection_id)
    if browser_session else _find_connection(session, session_data)
)
if connection is None or connection.provider != 'atlassian_oauth':
    raise AuthError('auth_required', 'Atlassian authentication is required.')
user = session.get(models.User, connection.user_id)
workspace = session.get(models.Workspace, connection.workspace_id)
if user is None or workspace is None:
    raise AuthError('auth_required', 'Atlassian authentication is required.')
if browser_session and (
    browser_session.user_id != user.id
    or browser_session.workspace_id != workspace.id
    or browser_session.auth_connection_id != connection.id
):
    raise AuthError('auth_required', 'Atlassian authentication is required.')

user_status, connection_status = _status_for(user, connection, current_time)
if user_status != 'active':
    raise AuthError('account_disabled', 'Your account is disabled.')
if connection_status != 'active':
    raise AuthError('auth_connection_revoked', 'Your Jira connection needs to be reconnected.')

session_token_version = str((session_data or {}).get('db_token_version') or '')
if not browser_session_id and session_token_version != str(connection.token_version):
    raise AuthError('auth_connection_stale', 'Your Jira connection changed. Reconnect to continue.')
```

Set `browser_session_id=browser_session_id` in the returned context. Keep the exact legacy token-version comparison only when `browser_session_id` is empty; a missing or empty version becomes `''` and must fail the same `auth_connection_stale` recovery contract without creating a browser-session row.

- [x] **Step 5: Update the cookie parser and lazy upgrade**

Change `_db_oauth_browser_session_payload` to prefer the opaque id and retain the old shape only for legacy cookies:

```python
browser_session_id = str((data or {}).get('db_browser_session_id') or '').strip()
if browser_session_id:
    return {'db_browser_session_id': browser_session_id}
connection_id = str((data or {}).get('db_auth_connection_id') or '').strip()
if not connection_id:
    return {}
payload = {'db_auth_connection_id': connection_id}
token_version = str((data or {}).get('db_token_version') or '').strip()
if token_version:
    payload['db_token_version'] = token_version
return payload
```

After a successful legacy resolution in `current_request_auth_context`, create one row through `db_browser_sessions.create_browser_session`, replace the Flask payload with only its id, and return `dataclasses.replace(context, browser_session_id=handle.id)`. Do not write when the input already contains `db_browser_session_id`.

- [x] **Step 6: Run the focused context/cutover tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_auth_context_db tests.test_db_oauth_cutover
```

Expected: PASS. Existing stale legacy-cookie tests still return `auth_connection_stale`; opaque rows follow current token version.

- [x] **Step 7: Commit the request-resolution slice**

```bash
git add backend/auth/context.py backend/auth/db_context.py jira_server.py tests/test_auth_context_db.py tests/test_db_oauth_cutover.py docs/plans/EXEC-multi-device-browser-sessions-01-server.md
git commit -m "Resolve OAuth requests through browser sessions"
```

### Task 4: Make callback, refresh, logout, and revocation lifecycle-safe

**Files:**

- Modify: `backend/auth/db_tokens.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `jira_server.py`
- Modify: `tests/test_auth_routes.py`
- Modify: `tests/test_db_oauth_cutover.py`
- Modify: `tests/test_token_refresh_reuse.py`
- Modify: `tests/test_token_refresh_race.py`
- Modify: `tests/test_endpoint_security_matrix.py`
- Modify: `docs/plans/EXEC-multi-device-browser-sessions-01-server.md`

- [x] **Step 1: Write failing multi-client callback/refresh/logout tests**

Add two Flask clients backed by the same user/connection and assert the separate-cookie-jar contract. These clients represent two browser profiles/devices, not two tabs; tabs in one browser profile share one Flask cookie and therefore one browser-session row:

```python
self.assertNotEqual(browser_a_id, browser_b_id)
self.assertEqual(connection_a_id, connection_b_id)
self.assertEqual(client_a.get('/api/auth/status').get_json()['authenticated'], True)
self.assertEqual(client_b.get('/api/auth/status').get_json()['authenticated'], True)
```

After client A refreshes, assert B remains authenticated and its signed payload still contains `browser_b_id`. After B logs out with the existing `X-Requested-With: jira-execution-planner` auth-flow guard, assert A remains authenticated and only B's row is absent; assert the missing header retains the existing `403 csrf_required` response, without introducing token-bound CSRF for this endpoint. `test_non_active_connection_callback_deletes_all_old_rows_before_new_browser_row` proves a previously revoked/expired/error target connection deletes every old target row before creating one replacement. `test_revoked_reconnect_deletes_target_rows_and_previous_other_connection_row` must additionally start client A on connection A, reconnect revoked connection B through A's browser, and prove A's captured prior row and every old B row are gone with exactly one new B row remaining. Do not add a per-tab server row or claim that logout is isolated between tabs sharing one cookie; same-profile tab behavior is verified in the frontend slice.

Add callback failure coverage for the existing distinction: `invalid_oauth_state`, authorization denial, missing code, and missing PKCE verifier leave a current browser row intact because they fail before token exchange; an `AuthError` after exchange begins may delete only the current row. Every failure must leave the other client's row active.

Extend `tests/test_token_refresh_reuse.py` to seed two browser rows and assert committed reuse detection removes both rows while preserving the existing revoked connection, deleted token, and audit assertions.

Extend the existing PostgreSQL harness in `tests/test_token_refresh_race.py` with both callback races:

1. Start from no matching user, workspace, connection, token, or browser-session row. Start two first-ever callback-storage transactions for the same Atlassian account/environment/resource, hold the first after it acquires the callback natural-key locks, and prove the second blocks before any select-then-insert upsert. Release the first and assert both callbacks commit: exactly one user, one workspace, one active connection, one active access/refresh token pair, and two distinct browser-session rows remain. No `IntegrityError` or rejected callback is allowed.
2. Seed a revoked connection with old browser rows, start two callback-storage transactions against it, hold the first transaction open after it creates its replacement row, and prove the second remains blocked. In each transaction, conditionally delete all target-connection rows when `invalidate_browser_sessions` is true, then unconditionally delete that callback's captured previous browser id before creating the replacement. Release the first, then assert both callbacks commit distinct new browser rows and every old row is gone.

The tests keep the existing `TEST_DATABASE_URL` PostgreSQL guard; a skipped run proves neither absent-row creation nor reconnect serialization.

- [x] **Step 2: Run the focused route and reuse tests to verify they fail**

Run:

```bash
.venv/bin/python -m unittest tests.test_auth_routes tests.test_db_oauth_cutover tests.test_token_refresh_reuse tests.test_token_refresh_race tests.test_endpoint_security_matrix
```

Expected: FAIL because callback/refresh still write connection/token-version cookies and logout does not delete the DB browser row.

- [x] **Step 3: Serialize callback upserts and carry reconnect state out**

Before `_upsert_user`, `_upsert_workspace`, or `_upsert_connection`, acquire PostgreSQL transaction-scoped advisory locks for both stable natural identities involved in callback creation:

- `atlassian-user:<external_provider>:<external_subject>`;
- `jira-workspace:<environment_key>:<cloud_id-or-normalized-site-url>`.

Derive each signed 64-bit lock key deterministically from SHA-256, sort the two integer keys before acquiring them, and call `SELECT pg_advisory_xact_lock(:lock_key)` for each. Never use Python's randomized `hash()`, emails/display names, tokens, OAuth state, or PKCE data. Keep the helper local to `backend/auth/db_tokens.py`; it is a documented no-op for SQLite test/dev sessions, whose concurrency result is not acceptance evidence. Holding both locks until transaction end makes first-ever user/workspace/connection select-then-insert upserts conflict-safe and gives every same-identity callback an existing row to lock after the first commit. Add focused stable-key, sorted-order, PostgreSQL SQL, and SQLite no-op unit/source assertions.

Implement the boundary explicitly before the three upserts:

```python
def _callback_lock_key(value):
    digest = hashlib.sha256(value.encode('utf-8')).digest()
    return int.from_bytes(digest[:8], byteorder='big', signed=True)


def _lock_callback_natural_keys(
    session,
    *,
    user_profile,
    environment_key,
    resource,
    configured_jira_url,
):
    """Serialize callback natural-key upserts on PostgreSQL; SQLite is a no-op."""
    if session.get_bind().dialect.name != 'postgresql':
        return
    account_id = str((user_profile or {}).get('account_id') or '').strip()
    cloud_id = str((resource or {}).get('id') or '').strip()
    site_url = normalize_site_url((resource or {}).get('url') or configured_jira_url)
    identities = {
        f'atlassian-user:atlassian:{account_id}',
        f'jira-workspace:{environment_key}:{cloud_id or site_url}',
    }
    for lock_key in sorted(_callback_lock_key(value) for value in identities):
        session.execute(
            text('SELECT pg_advisory_xact_lock(:lock_key)'),
            {'lock_key': lock_key},
        )
```

Call `_lock_callback_natural_keys(...)` at the start of `store_oauth_callback_tokens`, before `_upsert_user`. Import only standard-library `hashlib` and SQLAlchemy `text`.

Extend `StoredOAuthConnection` with `invalidate_browser_sessions: bool`. In `_upsert_connection`, add `with_for_update()` to the existing-connection lookup before reading its status or incrementing `token_version`, matching the refresh path's row lock. Record whether an existing connection status was not `active` before setting it active. Return that boolean through `store_oauth_callback_tokens`; a normal active callback returns `False`, while revoked/expired/error reconnect returns `True`. Add a source assertion for the row lock and callback advisory-lock call. Both PostgreSQL race tests from Step 1 are required behavioral proof; do not treat their SQLite skips as sufficient evidence.

Use the returned flag inside the existing `session_scope()` in `store_db_oauth_callback_session_metadata`:

```python
if stored.invalidate_browser_sessions:
    delete_browser_sessions_for_connection(db_session, stored.connection_id)
delete_browser_session(db_session, previous_browser_session_id)
handle = create_browser_session(
    db_session,
    user_id=stored.user_id,
    workspace_id=stored.workspace_id,
    auth_connection_id=stored.connection_id,
)
clear_auth_sensitive_caches('oauth_reconnect')
return {'db_browser_session_id': handle.id}
```

Capture `previous_browser_session_id` from the current Flask cookie before entering the DB transaction. The previous-id delete is unconditional and has no `else`: it may remove a row from another connection when that browser profile reconnects a non-active target. Do not return connection id or token version to `save_oauth_session` after a successful DB callback.

- [x] **Step 4: Stop refresh from replacing the browser id**

In every DB-backed refresh path, preserve the opaque browser id without a cookie-writer wrapper. `current_request_auth_context()` already resolves the stable row, and `current_jira_session_data(context)` returns the current shared token version for cache/token work. Cover the no-rewrite behavior through the refresh lifecycle tests.

- [x] **Step 5: Delete only the current row on post-exchange clear or logout**

Before `save_oauth_session({})` clears a DB cookie after token exchange has begun, capture its `db_browser_session_id` and delete that row in a short DB transaction. Do not move pre-exchange callback validation into this clearing path: invalid state, authorization denial, missing code, and missing PKCE verifier keep the current session unchanged. `POST /api/auth/logout` keeps its current `200 {"ok": true}` response and `X-Requested-With` auth-flow guard; it adds no token-bound CSRF requirement and must not update or revoke `auth_connections`.

- [x] **Step 6: Delete all rows on committed connection revocation**

Inside `_revoke_for_refresh_reuse`, call:

```python
delete_browser_sessions_for_connection(session, connection.id)
```

before `session.flush()`. In the real `db_oauth_session_data_for_auth_context` wrapper, catch `AuthError('auth_connection_revoked')`, commit the already-applied revocation/token/session deletes, then re-raise so `session_scope` does not roll them back. Keep every other error rollback behavior unchanged.

- [x] **Step 7: Run the focused lifecycle route tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_auth_routes tests.test_db_oauth_cutover tests.test_token_refresh_reuse tests.test_token_refresh_race tests.test_endpoint_security_matrix
```

Expected: PASS. Route JSON/status shapes and unsafe-method guards remain unchanged; only cookie/session lifecycle changes. Under PostgreSQL, both first-ever callbacks and reconnect callbacks commit distinct browser sessions without unique-index failures.

- [x] **Step 8: Commit the callback/logout/revocation slice**

```bash
git add backend/auth/db_tokens.py backend/routes/auth_routes.py jira_server.py tests/test_auth_routes.py tests/test_db_oauth_cutover.py tests/test_token_refresh_reuse.py tests/test_token_refresh_race.py tests/test_endpoint_security_matrix.py docs/plans/EXEC-multi-device-browser-sessions-01-server.md
git commit -m "Keep OAuth browser sessions independent"
```

### Task 5: Rebind CSRF and propagate internal browser context

**Files:**

- Modify: `backend/auth/csrf.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `backend/routes/scenario_draft_routes.py`
- Modify: `jira_server.py`
- Modify: `tests/test_auth_routes.py`
- Modify: `tests/test_scenario_draft_routes.py`
- Modify: `docs/plans/EXEC-multi-device-browser-sessions-01-server.md`

- [x] **Step 1: Write failing CSRF and Scenario tests**

Add a CSRF test that issues a token in browser profile B, rotates the shared connection from profile A, and proves the token still validates in B but not A. Add `test_csrf_context_mapping_preserves_precedence_and_is_shared_by_consumers` to prove opaque ids suppress token-version data, legacy contexts retain their exact token version, and both the HTTP and internal consumers call the same mapper. Add a Scenario reload test that patches the real auth resolver and asserts the synthetic request contains the captured browser id:

```python
def resolver(session_data, **_kwargs):
    self.assertEqual(session_data, {'db_browser_session_id': self.context.browser_session_id})
    return self.context
```

Assert a context without `browser_session_id` is rejected by the DB-only Scenario reload helper instead of synthesizing a connection-only cookie.

- [x] **Step 2: Run focused tests to verify they fail**

Run:

```bash
.venv/bin/python -m unittest tests.test_auth_routes tests.test_scenario_draft_routes
```

Expected: FAIL because CSRF still binds to token version and Scenario reload writes only `db_auth_connection_id`.

- [x] **Step 3: Branch the CSRF binding by session generation**

Build CSRF session data once in `backend/auth/csrf.py`; the opaque branch omits `db_token_version`, while the legacy branch includes it:

```python
def csrf_session_data_for_auth_context(context) -> dict:
    data = {
        'db_browser_session_id': str(getattr(context, 'browser_session_id', '') or ''),
        'db_auth_connection_id': str(getattr(context, 'auth_connection_id', '') or ''),
        'account_id': str(getattr(context, 'atlassian_account_id', '') or ''),
    }
    if not data['db_browser_session_id']:
        data['db_token_version'] = str(getattr(context, 'token_version', '') or '')
    return data
```

Use the stable browser id for upgraded DB sessions and retain the current legacy/local binding otherwise:

```python
def _binding(session_id: str, session_data: dict) -> str:
    browser_session_id = str((session_data or {}).get('db_browser_session_id') or '')
    if browser_session_id:
        return ':'.join([
            browser_session_id,
            str((session_data or {}).get('db_auth_connection_id') or ''),
            str((session_data or {}).get('account_id') or ''),
        ])
    return ':'.join([
        str(session_id or ''),
        str((session_data or {}).get('db_auth_connection_id') or ''),
        str((session_data or {}).get('db_token_version') or ''),
        str((session_data or {}).get('account_id') or ''),
    ])
```

Import and call `csrf_session_data_for_auth_context(context)` from both `api_auth_csrf()` and `csrf_session_data_for_request()`; neither consumer may duplicate the context-to-dict mapping. The helper preserves `db_browser_session_id`, `db_auth_connection_id`, and `account_id`, gives opaque browser ids precedence, and includes `db_token_version` only for the legacy fallback.

- [x] **Step 4: Propagate the browser id in Scenario reload**

Replace the synthesized connection-only payload with:

```python
if not context.browser_session_id:
    raise ScenarioDraftReloadUnavailable('browser session is required for DB OAuth Scenario reload')
with app.test_request_context('/api/scenario', method='POST', json=payload):
    session['db_oauth_session'] = {'db_browser_session_id': context.browser_session_id}
    response = planner()
```

Worker-thread Jira calls continue receiving the immutable `RequestAuthContext`; they do not create rows.

- [x] **Step 5: Run the focused CSRF/Scenario tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_auth_routes tests.test_scenario_draft_routes
```

Expected: PASS, including cross-profile token rejection and no-request-context Scenario coverage through the real resolver. The existing client-side Flask-cookie hash list retains consume-on-validation behavior, but this plan does not claim atomic one-use consumption for concurrent requests that start from the same cookie; server-side CSRF/session state is separate future scope.

- [x] **Step 6: Commit the CSRF/internal-context slice**

```bash
git add backend/auth/csrf.py backend/routes/auth_routes.py backend/routes/scenario_draft_routes.py jira_server.py tests/test_auth_routes.py tests/test_scenario_draft_routes.py docs/plans/EXEC-multi-device-browser-sessions-01-server.md
git commit -m "Bind OAuth CSRF to browser sessions"
```

### Task 6: Verify the complete server slice

**Files:**

- Modify: `backend/db/migrations/versions/20260830_0009_browser_sessions.py`
- Modify: `jira_server.py`
- Modify: `tests/test_db_oauth_cutover.py`
- Modify: `tests/test_codebase_structure_budgets.py`
- Modify: `tests/test_endpoint_security_matrix.py`
- Modify: `docs/plans/EXEC-multi-device-browser-sessions-01-server.md`
- Modify: `docs/plans/SUPPORT-multi-device-browser-sessions-design.md`
- Modify only if verification identifies a direct regression: files listed in Tasks 1-5

- [ ] **Step 1: Run focused auth, migration, revocation, and Scenario coverage**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_db_browser_sessions tests.test_auth_context_db tests.test_auth_routes tests.test_db_oauth_cutover tests.test_token_refresh_reuse tests.test_token_refresh_race tests.test_scenario_draft_routes tests.test_endpoint_security_matrix
```

Expected: PASS for the default focused matrix. The PostgreSQL-only refresh/callback race may skip here when `TEST_DATABASE_URL` is absent; Step 2 must then prove it separately with zero skips.

- [ ] **Step 2: Run the mandatory PostgreSQL concurrency proof with zero skips**

In terminal 1, start the repository-owned fixed local PostgreSQL runner:

```bash
env \
  JIRA_AUTH_MODE=atlassian_oauth \
  OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false \
  ./runners/local/run.sh
```

Expected: the digest-pinned PostgreSQL service becomes healthy on `127.0.0.1:5432`, Alembic reaches the current head, startup preflight passes, and Flask starts without a dependency/runtime warning. The runner's preflight and Flask child inherit the explicit `JIRA_AUTH_MODE=atlassian_oauth` and `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false` values, so Step 5 cannot fall through to Basic mode or a local token store. Leave this repository runner active for the next command; do not start an ad-hoc PostgreSQL container.

In terminal 2, run the complete refresh/callback race module against the runner's fixed local database:

```bash
TEST_DATABASE_URL=postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_local \
  .venv/bin/python -m unittest -v tests.test_token_refresh_race
```

Expected: `OK` with zero skipped tests. The existing refresh serialization test, the new first-ever absent-row callback test, and the concurrent reconnect-callback test all execute against PostgreSQL. A skipped test, SQLite-only pass, unavailable Docker runner, or missing `TEST_DATABASE_URL` is a failed acceptance gate. Keep terminal 1 active through Step 5 so startup, full-suite, and HTTP verification use the same fixed migrated DB/OAuth runner environment.

- [ ] **Step 3: Run startup and structural verification**

Run:

```bash
env \
  DATABASE_URL=postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_local \
  DATABASE_CONNECTION_MODE=url \
  CONFIG_STORAGE_BACKEND=db \
  JIRA_AUTH_MODE=atlassian_oauth \
  OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false \
  APP_ENVIRONMENT_KEY=local \
  APP_BIND_HOST=127.0.0.1 \
  ALLOW_NETWORK_BIND=false \
  ALLOW_BASIC_AUTH_ON_NETWORK=false \
  DEBUG_MODE=false \
  .venv/bin/python scripts/check_startup_preflight.py
.venv/bin/python -m unittest tests.test_codebase_structure_budgets tests.test_initiative_extraction
```

Expected: PASS. The preflight process receives the runner's fixed DB/OAuth/config/bind environment explicitly; a separate terminal does not inherit exports from `run.sh`. Required local encryption configuration may still load from `.env`, but the command must not print or copy it. If the legitimate lifecycle module changes a ratcheted budget, update only the named budget with the measured value and document the reason in the same commit.

- [ ] **Step 4: Run the full Python suite**

Run:

```bash
env \
  DATABASE_URL=postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_local \
  TEST_DATABASE_URL=postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_local \
  DATABASE_CONNECTION_MODE=url \
  CONFIG_STORAGE_BACKEND=db \
  JIRA_AUTH_MODE=atlassian_oauth \
  OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false \
  APP_ENVIRONMENT_KEY=local \
  APP_BIND_HOST=127.0.0.1 \
  ALLOW_NETWORK_BIND=false \
  ALLOW_BASIC_AUTH_ON_NETWORK=false \
  DEBUG_MODE=false \
  .venv/bin/python -m unittest discover -s tests
```

Expected: PASS against the runner's fixed migrated database. The explicit `TEST_DATABASE_URL` makes the Task 6 PostgreSQL race cases execute in the complete suite. Do not substitute or print any user-configured `.env` database URL or secret.

- [ ] **Step 5: Verify cookie-free OAuth health and authentication boundaries**

With the exact repository runner from Step 2 still active on port `5050`, run in another terminal:

```bash
curl --disable --silent --show-error --include http://127.0.0.1:5050/health
curl --disable --silent --show-error --include http://127.0.0.1:5050/api/test
```

Expected in this DB-backed Atlassian OAuth runner environment:

- Flask has started with no dependency/runtime warning before the startup banner.
- Cookie-free `GET /health` returns HTTP `200` with exactly the existing safe JSON shape `{"message":"Jira proxy server is running","status":"OK"}`.
- Cookie-free `GET /api/test` returns HTTP `401` with exactly the existing sanitized recovery payload `{"error":"auth_required","loginUrl":"/login?reason=session_expired","message":"Your Jira sign-in expired. Sign in again to continue."}`.

This is an OAuth-specific anonymous boundary check. Do not authenticate curl, forge or reuse a cookie, seed an OAuth token, or make this gate depend on live Jira. Basic-auth loopback behavior is outside this slice. Stop terminal 1 with `Ctrl+C` after the check and confirm the runner removes only its owned container/network while retaining its documented volume.

- [ ] **Step 6: Review the diff for scope and secrets**

Run:

```bash
git diff --check
git diff --stat origin/main...HEAD
git grep -n -E "access_token|refresh_token|apiToken|Authorization" -- backend/db/migrations/versions/20260830_0009_browser_sessions.py backend/auth/db_browser_sessions.py
```

Expected: `git diff --check` passes; changed files match this plan; the final grep returns no browser-session storage of credential material.

- [ ] **Step 7: Commit any verification-only correction**

If verification required a scoped correction, stage only its named files and commit:

```bash
git add backend/db/migrations/versions/20260830_0009_browser_sessions.py jira_server.py tests/test_db_oauth_cutover.py tests/test_codebase_structure_budgets.py tests/test_endpoint_security_matrix.py docs/plans/EXEC-multi-device-browser-sessions-01-server.md docs/plans/SUPPORT-multi-device-browser-sessions-design.md
git commit -m "Verify DB browser session lifecycle"
```

If no correction was required, do not create an empty commit.
