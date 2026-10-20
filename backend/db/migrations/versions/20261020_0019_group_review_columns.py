"""Department-group review schemas, cells and per-Sprint views.

Revision ID: 20261020_0019
Revises: 20261001_0018

Create-table only: the three tables are new and nothing else in any earlier
revision creates them, so no inspect/as_sql existence guard is needed (offline
rendering emits plain CREATE TABLE statements). The legacy review tables are
neither read nor modified here; downgrade drops only the three new tables.
"""
from alembic import op
import sqlalchemy as sa

revision = '20261020_0019'
down_revision = '20261001_0018'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'workspace_group_review_schemas',
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('workspace_id', sa.String(36), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('group_id', sa.String(128), nullable=False),
        sa.Column('schema_revision', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('columns', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.UniqueConstraint('workspace_id', 'group_id', name='uq_group_review_schema_workspace_group'),
        sa.CheckConstraint('schema_revision >= 0', name='ck_group_review_schema_revision'),
    )
    op.create_table(
        'group_review_cells',
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('schema_id', sa.Uuid(as_uuid=False), sa.ForeignKey('workspace_group_review_schemas.id', ondelete='CASCADE'), nullable=False),
        sa.Column('issue_id', sa.String(128), nullable=False),
        sa.Column('row_kind', sa.String(8), nullable=False),
        sa.Column('column_id', sa.String(36), nullable=False),
        sa.Column('value', sa.String(500), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.UniqueConstraint('schema_id', 'issue_id', 'row_kind', 'column_id', name='uq_group_review_cell_identity'),
        sa.CheckConstraint("row_kind IN ('epic', 'story')", name='ck_group_review_cell_row_kind'),
        sa.CheckConstraint('revision >= 1', name='ck_group_review_cell_revision'),
    )
    op.create_table(
        'group_sprint_review_views',
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('workspace_id', sa.String(36), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('group_id', sa.String(128), nullable=False),
        sa.Column('sprint_id', sa.String(128), nullable=False),
        sa.Column('sprint_order', sa.String(128), nullable=False),
        sa.Column('layouts', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('view_revision', sa.Integer(), nullable=False),
        sa.UniqueConstraint('workspace_id', 'group_id', 'sprint_id', name='uq_group_sprint_review_view'),
        sa.CheckConstraint('length(sprint_order) = 128', name='ck_group_sprint_review_view_order'),
        sa.CheckConstraint('view_revision >= 1', name='ck_group_sprint_review_view_revision'),
    )
    op.create_index('ix_group_sprint_review_views_order', 'group_sprint_review_views', ['workspace_id', 'group_id', 'sprint_order'])


def downgrade():
    op.drop_index('ix_group_sprint_review_views_order', table_name='group_sprint_review_views')
    op.drop_table('group_sprint_review_views')
    op.drop_table('group_review_cells')
    op.drop_table('workspace_group_review_schemas')
