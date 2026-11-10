"""Store outstanding single-use CSRF token hashes per DB browser session.

Revision ID: 20261106_0024
Revises: 20261102_0023
"""
from alembic import op
import sqlalchemy as sa

revision = '20261106_0024'
down_revision = '20261102_0023'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('browser_csrf_tokens',
        sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('browser_session_id', sa.String(36),
                  sa.ForeignKey('browser_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_browser_csrf_tokens_session_created', 'browser_csrf_tokens',
                    ['browser_session_id', 'created_at'])


def downgrade():
    op.drop_index('ix_browser_csrf_tokens_session_created', table_name='browser_csrf_tokens')
    op.drop_table('browser_csrf_tokens')
