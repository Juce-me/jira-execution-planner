"""Shared Sprint review column layouts.

Revision ID: 20261001_0018
Revises: 20261001_0017
"""
from alembic import op
import sqlalchemy as sa

revision = '20261001_0018'
down_revision = '20261001_0017'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('workspace_sprint_reviews', sa.Column('layouts', sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade():
    op.drop_column('workspace_sprint_reviews', 'layouts')
