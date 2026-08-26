"""user onboarding state

Revision ID: 20260826_0007
Revises: 20260604_0006
Create Date: 2026-08-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260826_0007'
down_revision = '20260604_0006'
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
