"""Per-Team, per-Sprint assignee capacity documents for Planning (#323).

Revision ID: 20261029_0022
Revises: 20261028_0021

Create-table only: the table is new, so no existence guard is needed (offline
rendering emits plain CREATE TABLE and CREATE INDEX). Downgrade drops only it.
"""
from alembic import op
import sqlalchemy as sa

revision = '20261029_0022'
down_revision = '20261028_0021'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'planning_team_sprint_capacity',
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('workspace_id', sa.String(36), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sprint_id', sa.String(128), nullable=False),
        sa.Column('sprint_order', sa.String(128), nullable=False),
        sa.Column('team_id', sa.String(128), nullable=False),
        sa.Column('rows', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('workspace_id', 'sprint_id', 'team_id', name='uq_planning_team_sprint_capacity'),
        sa.CheckConstraint('length(sprint_order) = 128', name='ck_planning_team_sprint_capacity_order'),
        sa.CheckConstraint('revision >= 1', name='ck_planning_team_sprint_capacity_revision'),
    )
    op.create_index('ix_planning_team_sprint_capacity_order', 'planning_team_sprint_capacity',
                    ['workspace_id', 'team_id', 'sprint_order'])


def downgrade():
    op.drop_index('ix_planning_team_sprint_capacity_order', table_name='planning_team_sprint_capacity')
    op.drop_table('planning_team_sprint_capacity')
