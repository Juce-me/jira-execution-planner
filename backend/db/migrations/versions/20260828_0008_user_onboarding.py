"""user onboarding state

Revision ID: 20260828_0008
Revises: 20260826_0007
Create Date: 2026-08-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260828_0008'
down_revision = '20260826_0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'user_group_preferences',
        sa.Column(
            'onboarding_done',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.execute('UPDATE user_group_preferences SET onboarding_done = true')


def downgrade() -> None:
    op.drop_column('user_group_preferences', 'onboarding_done')
