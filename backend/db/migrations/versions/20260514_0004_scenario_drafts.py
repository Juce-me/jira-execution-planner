"""scenario drafts

Revision ID: 20260514_0004
Revises: 20260511_0003
Create Date: 2026-05-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260514_0004'
down_revision = '20260511_0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'scenario_drafts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('scope_key', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('scope_payload', sa.JSON(), nullable=False),
        sa.Column('scenario_source_hash', sa.String(length=128), nullable=True),
        sa.Column('overrides', sa.JSON(), nullable=False),
        sa.Column('draft_revision', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('updated_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_scenario_drafts_active_scope',
        'scenario_drafts',
        ['workspace_id', 'scope_key'],
        unique=True,
        sqlite_where=sa.text('archived_at IS NULL'),
        postgresql_where=sa.text('archived_at IS NULL'),
    )
    op.create_index(
        'ix_scenario_drafts_workspace_updated',
        'scenario_drafts',
        ['workspace_id', 'updated_at'],
    )

    op.create_table(
        'scenario_draft_versions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('scenario_draft_id', sa.String(length=36), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('draft_revision', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('scope_payload', sa.JSON(), nullable=False),
        sa.Column('scenario_source_hash', sa.String(length=128), nullable=True),
        sa.Column('overrides', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('change_note', sa.String(length=255), nullable=True),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.CheckConstraint(
            "source in ('user', 'legacy_json', 'rollback', 'reload_from_jira')",
            name='ck_scenario_draft_versions_source',
        ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scenario_draft_id'], ['scenario_drafts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('scenario_draft_id', 'version_number', name='uq_scenario_draft_versions_number'),
    )


def downgrade() -> None:
    op.drop_table('scenario_draft_versions')
    op.drop_index('ix_scenario_drafts_workspace_updated', table_name='scenario_drafts')
    op.drop_index('uq_scenario_drafts_active_scope', table_name='scenario_drafts')
    op.drop_table('scenario_drafts')
