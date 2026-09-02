"""screen-scoped onboarding completion

Revision ID: 20260902_0011
Revises: 20260829_0009, 20260901_0010
Create Date: 2026-09-02
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = '20260902_0011'
down_revision = ('20260829_0009', '20260901_0010')
branch_labels = None
depends_on = None


ALL_MODULES = ['catch-up', 'configuration', 'planning', 'board', 'statistics']


def upgrade() -> None:
    completed_modules_exists = False
    if not op.get_context().as_sql:
        completed_modules_exists = any(
            column['name'] == 'onboarding_completed_modules'
            for column in inspect(op.get_bind()).get_columns('user_group_preferences')
        )

    if not completed_modules_exists:
        op.add_column(
            'user_group_preferences',
            sa.Column(
                'onboarding_completed_modules',
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )
    preferences = sa.table(
        'user_group_preferences',
        sa.column('onboarding_done', sa.Boolean()),
        sa.column('onboarding_completed_modules', sa.JSON()),
    )
    completed_modules = sa.literal(json.dumps(ALL_MODULES, separators=(',', ':')))
    if op.get_bind().dialect.name == 'postgresql':
        completed_modules = sa.cast(completed_modules, sa.JSON())
    op.execute(
        preferences.update()
        .where(preferences.c.onboarding_done.is_(True))
        .values(onboarding_completed_modules=completed_modules)
    )


def downgrade() -> None:
    op.drop_column('user_group_preferences', 'onboarding_completed_modules')
