"""Dedicated shared workspace/Sprint custom review storage.

Revision ID: 20261001_0017
Revises: 20260913_0016
"""
from alembic import op
import sqlalchemy as sa

revision = '20261001_0017'
down_revision = '20260913_0016'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'workspace_sprint_reviews',
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('workspace_id', sa.String(36), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sprint_id', sa.String(128), nullable=False),
        sa.Column('schema_revision', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('columns', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.UniqueConstraint('workspace_id', 'sprint_id', name='uq_sprint_review_workspace_sprint'),
        sa.CheckConstraint('schema_revision >= 0', name='ck_sprint_review_schema_revision'),
    )
    op.create_table(
        'sprint_review_cells',
        sa.Column('id', sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column('review_id', sa.Uuid(as_uuid=False), sa.ForeignKey('workspace_sprint_reviews.id', ondelete='CASCADE'), nullable=False),
        sa.Column('issue_id', sa.String(128), nullable=False),
        sa.Column('row_kind', sa.String(8), nullable=False),
        sa.Column('column_id', sa.String(36), nullable=False),
        sa.Column('value', sa.String(500), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.UniqueConstraint('review_id', 'issue_id', 'row_kind', 'column_id', name='uq_sprint_review_cell_identity'),
        sa.CheckConstraint("row_kind IN ('epic', 'story')", name='ck_sprint_review_cell_row_kind'),
        sa.CheckConstraint('revision >= 1', name='ck_sprint_review_cell_revision'),
    )


def downgrade():
    op.drop_table('sprint_review_cells')
    op.drop_table('workspace_sprint_reviews')
