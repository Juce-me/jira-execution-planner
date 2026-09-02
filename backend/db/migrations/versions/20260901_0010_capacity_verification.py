"""add capacity field verification and OAuth scope provenance

Revision ID: 20260901_0010
Revises: 20260830_0009
Create Date: 2026-09-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260901_0010'
down_revision = '20260830_0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('workspace_dashboard_configs') as batch_op:
        batch_op.add_column(sa.Column('capacity_jira_site_url', sa.String(length=512)))
        batch_op.add_column(sa.Column('capacity_jira_cloud_id', sa.String(length=255)))
        batch_op.add_column(sa.Column('capacity_field_schema_type', sa.String(length=64)))
        batch_op.add_column(sa.Column('capacity_field_verified_at', sa.DateTime(timezone=True)))
    with op.batch_alter_table('auth_connections') as batch_op:
        batch_op.add_column(
            sa.Column('scope_provenance', sa.String(length=32), nullable=False, server_default='unknown'),
        )
        batch_op.create_check_constraint(
            'ck_auth_connections_scope_provenance',
            "scope_provenance in ('provider', 'unknown')",
        )


def downgrade() -> None:
    with op.batch_alter_table('auth_connections') as batch_op:
        batch_op.drop_constraint('ck_auth_connections_scope_provenance', type_='check')
        batch_op.drop_column('scope_provenance')
    with op.batch_alter_table('workspace_dashboard_configs') as batch_op:
        batch_op.drop_column('capacity_field_verified_at')
        batch_op.drop_column('capacity_field_schema_type')
        batch_op.drop_column('capacity_jira_cloud_id')
        batch_op.drop_column('capacity_jira_site_url')
