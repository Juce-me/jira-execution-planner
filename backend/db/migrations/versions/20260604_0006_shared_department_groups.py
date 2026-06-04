"""shared department groups

Revision ID: 20260604_0006
Revises: 20260514_0005
Create Date: 2026-06-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260604_0006'
down_revision = '20260514_0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'workspace_group_configs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('payload_version', sa.Integer(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('config_revision', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('updated_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', name='uq_workspace_group_configs_workspace'),
    )
    op.create_table(
        'user_group_preferences',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('payload_version', sa.Integer(), nullable=False),
        sa.Column('visible_group_ids', sa.JSON(), nullable=False),
        sa.Column('active_group_id', sa.String(length=255), nullable=True),
        sa.Column('customized', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'user_id', name='uq_user_group_preferences_workspace_user'),
    )
    op.create_index(
        'ix_user_group_preferences_user_workspace',
        'user_group_preferences',
        ['user_id', 'workspace_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_user_group_preferences_user_workspace', table_name='user_group_preferences')
    op.drop_table('user_group_preferences')
    op.drop_table('workspace_group_configs')
