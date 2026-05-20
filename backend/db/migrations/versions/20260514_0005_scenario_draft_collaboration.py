"""scenario draft collaboration

Revision ID: 20260514_0005
Revises: 20260514_0004
Create Date: 2026-05-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260514_0005'
down_revision = '20260514_0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'scenario_draft_events',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('scenario_draft_id', sa.String(length=36), nullable=False),
        sa.Column('event_number', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(length=64), nullable=False),
        sa.Column('draft_revision', sa.Integer(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scenario_draft_id'], ['scenario_drafts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('scenario_draft_id', 'event_number', name='uq_scenario_draft_events_number'),
    )
    op.create_index(
        'ix_scenario_draft_events_draft_created',
        'scenario_draft_events',
        ['scenario_draft_id', 'created_at'],
    )

    op.create_table(
        'scenario_draft_presence',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('scenario_draft_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('cursor_payload', sa.JSON(), nullable=False),
        sa.Column('mode', sa.String(length=32), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['scenario_draft_id'], ['scenario_drafts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('scenario_draft_id', 'user_id', name='uq_scenario_draft_presence_user'),
    )
    op.create_index(
        'ix_scenario_draft_presence_seen',
        'scenario_draft_presence',
        ['scenario_draft_id', 'last_seen_at'],
    )

    op.create_table(
        'scenario_draft_locks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('scenario_draft_id', sa.String(length=36), nullable=False),
        sa.Column('resource_type', sa.String(length=64), nullable=False),
        sa.Column('resource_id', sa.String(length=255), nullable=False),
        sa.Column('holder_user_id', sa.String(length=36), nullable=False),
        sa.Column('holder_display_name', sa.String(length=255), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['holder_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scenario_draft_id'], ['scenario_drafts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'scenario_draft_id',
            'resource_type',
            'resource_id',
            name='uq_scenario_draft_locks_resource',
        ),
    )
    op.create_index(
        'ix_scenario_draft_locks_expires',
        'scenario_draft_locks',
        ['scenario_draft_id', 'expires_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_scenario_draft_locks_expires', table_name='scenario_draft_locks')
    op.drop_table('scenario_draft_locks')
    op.drop_index('ix_scenario_draft_presence_seen', table_name='scenario_draft_presence')
    op.drop_table('scenario_draft_presence')
    op.drop_index('ix_scenario_draft_events_draft_created', table_name='scenario_draft_events')
    op.drop_table('scenario_draft_events')
