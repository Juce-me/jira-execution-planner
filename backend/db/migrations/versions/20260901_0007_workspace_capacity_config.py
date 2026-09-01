"""workspace shared capacity configuration

Revision ID: 20260901_0007
Revises: 20260604_0006
Create Date: 2026-09-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260901_0007'
down_revision = '20260604_0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'workspace_capacity_configs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('jira_site_url', sa.String(length=512), nullable=False),
        sa.Column('jira_cloud_id', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('project_key', sa.String(length=64), nullable=False),
        sa.Column('field_id', sa.String(length=255), nullable=False),
        sa.Column('field_name', sa.String(length=255), nullable=False),
        sa.Column('field_schema_type', sa.String(length=64), nullable=False),
        sa.Column('field_verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('config_revision', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('updated_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status in ('active', 'requires_resolution')", name='ck_workspace_capacity_configs_status'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', name='uq_workspace_capacity_configs_workspace'),
    )
    op.add_column(
        'auth_connections',
        sa.Column(
            'scope_provenance',
            sa.String(length=32),
            sa.CheckConstraint("scope_provenance in ('provider', 'unknown')", name='ck_auth_connections_scope_provenance'),
            nullable=False,
            server_default='unknown',
        ),
    )


def downgrade() -> None:
    op.drop_column('auth_connections', 'scope_provenance')
    op.drop_table('workspace_capacity_configs')
