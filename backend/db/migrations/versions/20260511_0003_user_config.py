"""user view configuration

Revision ID: 20260511_0003
Revises: 20260511_0002
Create Date: 2026-05-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260511_0003'
down_revision = '20260511_0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'view_configs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('owner_user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('view_type', sa.String(length=32), nullable=False),
        sa.Column('mode_policy', sa.String(length=32), nullable=False),
        sa.Column('payload_version', sa.Integer(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('visibility', sa.String(length=32), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('source_path', sa.String(length=1024), nullable=True),
        sa.Column('source_hash', sa.String(length=128), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode_policy in ('configuration')", name='ck_view_configs_mode_policy'),
        sa.CheckConstraint("view_type in ('eng', 'epm', 'mixed')", name='ck_view_configs_type'),
        sa.CheckConstraint("visibility in ('private')", name='ck_view_configs_visibility'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_view_configs_owner_workspace',
        'view_configs',
        ['workspace_id', 'owner_user_id'],
    )
    op.create_index(
        'uq_view_configs_active_default',
        'view_configs',
        ['workspace_id', 'owner_user_id'],
        unique=True,
        sqlite_where=sa.text('is_default = 1 AND archived_at IS NULL'),
        postgresql_where=sa.text('is_default IS TRUE AND archived_at IS NULL'),
    )
    op.create_index(
        'uq_view_configs_import_source',
        'view_configs',
        ['workspace_id', 'owner_user_id', 'source_path', 'source_hash'],
        unique=True,
        sqlite_where=sa.text('source_path IS NOT NULL AND source_hash IS NOT NULL'),
        postgresql_where=sa.text('source_path IS NOT NULL AND source_hash IS NOT NULL'),
    )

    op.create_table(
        'view_config_versions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('view_config_id', sa.String(length=36), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('change_note', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['view_config_id'], ['view_configs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('view_config_id', 'version_number', name='uq_view_config_versions_number'),
    )


def downgrade() -> None:
    op.drop_table('view_config_versions')
    op.drop_index('uq_view_configs_import_source', table_name='view_configs')
    op.drop_index('uq_view_configs_active_default', table_name='view_configs')
    op.drop_index('ix_view_configs_owner_workspace', table_name='view_configs')
    op.drop_table('view_configs')
