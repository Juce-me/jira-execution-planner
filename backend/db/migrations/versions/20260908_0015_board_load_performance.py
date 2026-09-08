"""add closed ENG Board load observations

Revision ID: 20260908_0015
Revises: 20260908_0014
Create Date: 2026-09-08
"""

from alembic import op
import sqlalchemy as sa


revision = '20260908_0015'
down_revision = '20260908_0014'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('load_performance') as batch_op:
        batch_op.alter_column('sprint_id', existing_type=sa.String(128), nullable=True)
        batch_op.add_column(sa.Column('schema_version', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('scope_type', sa.String(16), nullable=True))
        batch_op.add_column(sa.Column('focused_complete_ms', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('index_ms', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('epic_count', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('issue_count', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('payload_bytes', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('jira_requests', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('jira_pages', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('jira_retries', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('completeness', sa.String(16), nullable=True))
        batch_op.add_column(sa.Column('cache_state', sa.String(16), nullable=True))
        batch_op.add_column(sa.Column('peak_child_searches', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('scope_cohort_digest', sa.String(64), nullable=True))


def downgrade():
    # Legacy schema cannot represent All work's intentionally null sprint.
    op.execute("DELETE FROM load_performance WHERE surface = 'eng_board'")
    with op.batch_alter_table('load_performance') as batch_op:
        for name in (
            'scope_cohort_digest', 'peak_child_searches', 'cache_state', 'completeness',
            'jira_retries', 'jira_pages', 'jira_requests', 'payload_bytes', 'issue_count',
            'epic_count', 'index_ms', 'focused_complete_ms', 'scope_type', 'schema_version',
        ):
            batch_op.drop_column(name)
        batch_op.alter_column('sprint_id', existing_type=sa.String(128), nullable=False)
