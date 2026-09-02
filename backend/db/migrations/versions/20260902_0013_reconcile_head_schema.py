"""reconcile missing current-head schema objects

Revision ID: 20260902_0013
Revises: 20260902_0012
Create Date: 2026-09-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = '20260902_0013'
down_revision = '20260902_0012'
branch_labels = None
depends_on = None


def _capacity_columns() -> tuple[sa.Column, ...]:
    return (
        sa.Column('capacity_jira_site_url', sa.String(length=512)),
        sa.Column('capacity_jira_cloud_id', sa.String(length=255)),
        sa.Column('capacity_field_schema_type', sa.String(length=64)),
        sa.Column('capacity_field_verified_at', sa.DateTime(timezone=True)),
    )


def upgrade() -> None:
    if op.get_context().as_sql:
        return

    inspector = inspect(op.get_bind())
    if 'browser_sessions' not in inspector.get_table_names():
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

    dashboard_columns = {
        column['name']
        for column in inspector.get_columns('workspace_dashboard_configs')
    }
    missing_capacity_columns = [
        column
        for column in _capacity_columns()
        if column.name not in dashboard_columns
    ]
    if missing_capacity_columns:
        with op.batch_alter_table('workspace_dashboard_configs') as batch_op:
            for column in missing_capacity_columns:
                batch_op.add_column(column)


def downgrade() -> None:
    # The original branch migrations own these objects; this revision only reconciles drift.
    pass
