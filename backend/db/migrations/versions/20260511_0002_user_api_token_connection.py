"""user api token connection

Revision ID: 20260511_0002
Revises: 20260511_0001
Create Date: 2026-05-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260511_0002'
down_revision = '20260511_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('auth_connections', sa.Column('credential_subject', sa.String(length=255), nullable=True))
    op.add_column(
        'auth_connections',
        sa.Column('capabilities', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.create_index(
        'uq_auth_connections_user_api_token_cloud',
        'auth_connections',
        ['user_id', 'workspace_id', 'cloud_id'],
        unique=True,
        sqlite_where=sa.text("provider = 'atlassian_user_api_token' AND cloud_id IS NOT NULL AND status != 'revoked'"),
        postgresql_where=sa.text("provider = 'atlassian_user_api_token' AND cloud_id IS NOT NULL AND status != 'revoked'"),
    )


def downgrade() -> None:
    op.drop_index('uq_auth_connections_user_api_token_cloud', table_name='auth_connections')
    op.drop_column('auth_connections', 'capabilities')
    op.drop_column('auth_connections', 'credential_subject')
