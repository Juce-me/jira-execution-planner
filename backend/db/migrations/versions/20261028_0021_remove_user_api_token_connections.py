"""Remove the user-owned Atlassian API token Home connection.

Revision ID: 20261028_0021
Revises: 20261023_0020

Home is read only through the user's OAuth grant (public-read-v1). By explicit operator decision every stored
`atlassian_user_api_token` connection and its encrypted tokens are deleted, the partial unique index for that provider
is dropped, and the provider CHECK no longer admits it. This is destructive of stored tokens by design.

downgrade() re-creates the schema only (index and the wider CHECK, so earlier downgrades still run). It never
restores connections or tokens: deleted credentials are gone and are never fabricated.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20261028_0021'
down_revision = '20261023_0020'
branch_labels = None
depends_on = None

REMOVED_PROVIDER = 'atlassian_user_api_token'
INDEX_NAME = 'uq_auth_connections_user_api_token_cloud'
INDEX_PREDICATE = f"provider = '{REMOVED_PROVIDER}' AND cloud_id IS NOT NULL AND status != 'revoked'"
CHECK_NAME = 'ck_auth_connections_provider'
CHECK_AFTER = "provider in ('atlassian_oauth', 'jira_basic', 'confluence_oauth')"
CHECK_BEFORE = "provider in ('atlassian_oauth', 'jira_basic', 'atlassian_user_api_token', 'confluence_oauth')"
_OWNED = f"(SELECT id FROM auth_connections WHERE provider = '{REMOVED_PROVIDER}')"


def upgrade() -> None:
    # Explicit deletes: SQLite does not enforce FK cascades unless the pragma is on.
    op.execute(f'DELETE FROM auth_tokens WHERE connection_id IN {_OWNED}')
    op.execute(f'DELETE FROM browser_sessions WHERE auth_connection_id IN {_OWNED}')
    op.execute(f'DELETE FROM jira_project_access WHERE connection_id IN {_OWNED}')
    op.execute(f'UPDATE audit_events SET auth_connection_id = NULL WHERE auth_connection_id IN {_OWNED}')
    op.execute(f"DELETE FROM auth_connections WHERE provider = '{REMOVED_PROVIDER}'")
    op.drop_index(INDEX_NAME, table_name='auth_connections')
    with op.batch_alter_table('auth_connections') as batch_op:
        batch_op.drop_constraint(CHECK_NAME, type_='check')
        batch_op.create_check_constraint(CHECK_NAME, CHECK_AFTER)


def downgrade() -> None:
    with op.batch_alter_table('auth_connections') as batch_op:
        batch_op.drop_constraint(CHECK_NAME, type_='check')
        batch_op.create_check_constraint(CHECK_NAME, CHECK_BEFORE)
    op.create_index(
        INDEX_NAME,
        'auth_connections',
        ['user_id', 'workspace_id', 'cloud_id'],
        unique=True,
        sqlite_where=sa.text(INDEX_PREDICATE),
        postgresql_where=sa.text(INDEX_PREDICATE),
    )
