"""Add shared Sprint inclusion and actor-bound save receipts without importing old selections.

Revision ID: 20261102_0023
Revises: 20261030_0022
"""
from alembic import op
import sqlalchemy as sa

revision = '20261102_0023'
down_revision = '20261030_0022'
branch_labels = None
depends_on = None
TABLES = ('group_sprint_plans', 'group_sprint_plan_entries', 'planning_save_operations')


def upgrade():
    op.create_table(TABLES[0],
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('schema_id', sa.Uuid(as_uuid=False), sa.ForeignKey('workspace_group_review_schemas.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sprint_id', sa.String(128), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('schema_id', 'sprint_id', name='uq_group_sprint_plan'),
        sa.CheckConstraint('revision >= 1', name='ck_group_sprint_plan_revision'))
    op.create_table(TABLES[1],
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('plan_id', sa.Uuid(as_uuid=False), sa.ForeignKey('group_sprint_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('issue_id', sa.String(128), nullable=False),
        sa.Column('included', sa.Boolean(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.UniqueConstraint('plan_id', 'issue_id', name='uq_group_sprint_plan_entry'),
        sa.CheckConstraint('revision >= 1', name='ck_group_sprint_plan_entry_revision'))
    op.create_table(TABLES[2],
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('workspace_id', sa.String(36), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('actor_user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('operation_id', sa.String(36), nullable=False),
        sa.Column('plan_id', sa.Uuid(as_uuid=False), sa.ForeignKey('group_sprint_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('acknowledgement', sa.JSON(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('workspace_id', 'actor_user_id', 'operation_id', name='uq_planning_save_operation'),
        sa.CheckConstraint('length(request_hash) = 64', name='ck_planning_save_operation_hash'))
    op.create_index('ix_planning_save_operation_expiry', TABLES[2], ['actor_user_id', 'plan_id', 'expires_at'])


def downgrade():
    # Check every new table before any DDL; even saved-empty documents are user data.
    if op.get_context().as_sql:
        raise RuntimeError('Refusing to downgrade shared plans offline: populated-table checks require a database.')
    if any(op.get_bind().execute(sa.text(f'SELECT count(*) FROM {table}')).scalar() for table in TABLES):
        raise RuntimeError('Refusing to downgrade 20261102_0023: shared plan data exists. Remove it deliberately first.')
    op.drop_index('ix_planning_save_operation_expiry', table_name=TABLES[2])
    for table in reversed(TABLES):
        op.drop_table(table)
