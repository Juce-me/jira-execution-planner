"""reconcile missing OAuth scope provenance schema

Revision ID: 20260902_0012
Revises: 20260902_0011
Create Date: 2026-09-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = '20260902_0012'
down_revision = '20260902_0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_context().as_sql:
        return

    inspector = inspect(op.get_bind())
    columns = {column['name'] for column in inspector.get_columns('auth_connections')}
    constraints = {
        constraint['name']
        for constraint in inspector.get_check_constraints('auth_connections')
    }
    scope_provenance_exists = 'scope_provenance' in columns
    constraint_exists = 'ck_auth_connections_scope_provenance' in constraints
    if scope_provenance_exists and constraint_exists:
        return

    with op.batch_alter_table('auth_connections') as batch_op:
        if not scope_provenance_exists:
            batch_op.add_column(
                sa.Column('scope_provenance', sa.String(length=32), nullable=False, server_default='unknown'),
            )
        if not constraint_exists:
            batch_op.create_check_constraint(
                'ck_auth_connections_scope_provenance',
                "scope_provenance in ('provider', 'unknown')",
            )


def downgrade() -> None:
    # Migration 0010 owns this schema; the reconciliation revision owns no independent change.
    pass
