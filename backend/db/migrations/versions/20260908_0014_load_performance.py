"""Store debug group-load observations separately from application configuration."""

from alembic import op
import sqlalchemy as sa


revision = '20260908_0014'
down_revision = '20260902_0013'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'load_performance',
        sa.Column('workspace_id', sa.String(128), primary_key=True),
        sa.Column('load_id', sa.String(36), primary_key=True),
        sa.Column('group_id', sa.String(128), nullable=False),
        sa.Column('sprint_id', sa.String(128), nullable=False),
        sa.Column('surface', sa.String(32), nullable=False),
        sa.Column('outcome', sa.String(16), nullable=False),
        sa.Column('duration_ms', sa.Float(), nullable=False),
        sa.Column('dependency_duration_ms', sa.Float(), nullable=True),
        sa.Column('first_content_ms', sa.Float(), nullable=True),
        sa.Column('lanes', sa.JSON(), nullable=False),
        sa.Column('environment', sa.String(128), nullable=False),
        sa.Column('revision', sa.String(128), nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_load_performance_workspace_recorded', 'load_performance', ['workspace_id', 'recorded_at'])


def downgrade():
    op.drop_index('ix_load_performance_workspace_recorded', table_name='load_performance')
    op.drop_table('load_performance')
