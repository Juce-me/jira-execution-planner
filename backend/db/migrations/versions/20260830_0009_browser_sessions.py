"""add opaque DB browser sessions

Revision ID: 20260830_0009
Revises: 20260827_0008
Create Date: 2026-08-30
"""

from __future__ import annotations

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
