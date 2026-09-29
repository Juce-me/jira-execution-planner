"""add workspace Sprint and per-Sprint Team catalogs

Revision ID: 20260913_0016
Revises: 20260908_0015
Create Date: 2026-09-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260913_0016'
down_revision = '20260908_0015'
branch_labels = None
depends_on = None


FAILURE_CODES = (
    'refresh_budget_exhausted',
    'catalog_refresh_lock_timeout',
    'oauth_refresh_timeout',
    'jira_unavailable',
    'catalog_incomplete',
    'catalog_identity_changed',
    'auth_required',
    'catalog_runtime_unavailable',
)


def _positive_decimal_check(column_name: str) -> str:
    digits_removed = column_name
    for digit in '0123456789':
        digits_removed = f"replace({digits_removed}, '{digit}', '')"
    return (
        f"{column_name} <> '' AND substr({column_name}, 1, 1) BETWEEN '1' AND '9' "
        f"AND {digits_removed} = ''"
    )


def _checks(*, prefix: str, identity_column: str, team: bool) -> list[sa.CheckConstraint]:
    attempt_columns = [
        'refresh_attempt_id', 'attempt_identity', 'attempt_config_digest',
        'attempt_deadline_at',
    ]
    if team:
        attempt_columns.append('attempt_scope_digest')
    attempt_empty = ' AND '.join(f'{column} IS NULL' for column in attempt_columns)
    attempt_present = ' AND '.join(f'{column} IS NOT NULL' for column in attempt_columns)
    no_lease = 'refresh_lease_owner IS NULL AND refresh_lease_until IS NULL'
    has_lease = 'refresh_lease_owner IS NOT NULL AND refresh_lease_until IS NOT NULL'
    no_failure = 'failure_code IS NULL AND last_failure_at IS NULL AND retry_at IS NULL'
    has_failure = 'failure_code IS NOT NULL AND last_failure_at IS NOT NULL AND retry_at IS NOT NULL'
    failure_codes = ', '.join(f"'{code}'" for code in FAILURE_CODES)
    checks = [
        sa.CheckConstraint(
            _positive_decimal_check(identity_column),
            name=f'ck_{prefix}_positive_identity',
        ),
        sa.CheckConstraint(
            "refresh_status IN ('idle', 'pending', 'completed', 'failed')",
            name=f'ck_{prefix}_refresh_status',
        ),
        sa.CheckConstraint(
            f'failure_code IS NULL OR failure_code IN ({failure_codes})',
            name=f'ck_{prefix}_failure_code',
        ),
        sa.CheckConstraint(
            '(validated_at IS NULL AND catalog_version IS NULL) OR '
            '(validated_at IS NOT NULL AND catalog_version IS NOT NULL)',
            name=f'ck_{prefix}_validation_version',
        ),
        sa.CheckConstraint(
            '(refresh_lease_owner IS NULL AND refresh_lease_until IS NULL) OR '
            '(refresh_lease_owner IS NOT NULL AND refresh_lease_until IS NOT NULL)',
            name=f'ck_{prefix}_lease_pair',
        ),
        sa.CheckConstraint(
            f'({attempt_empty}) OR ({attempt_present})',
            name=f'ck_{prefix}_attempt_group',
        ),
        sa.CheckConstraint(
            f"(refresh_status = 'idle' AND {attempt_empty} AND {no_lease} AND {no_failure}) OR "
            f"(refresh_status = 'pending' AND {attempt_present} AND {has_lease} AND {no_failure}) OR "
            f"(refresh_status = 'completed' AND {attempt_present} AND {no_lease} AND {no_failure}) OR "
            f"(refresh_status = 'failed' AND {attempt_present} AND {no_lease} AND {has_failure})",
            name=f'ck_{prefix}_state_metadata',
        ),
    ]
    if team:
        checks.append(sa.CheckConstraint(
            'validated_at IS NULL OR scope_digest IS NOT NULL',
            name=f'ck_{prefix}_validated_scope',
        ))
    return checks


def upgrade() -> None:
    op.create_table(
        'workspace_sprint_catalogs',
        sa.Column('id', sa.Uuid(as_uuid=False), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('board_id', sa.String(length=128), nullable=False),
        sa.Column('payload_version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('sprints', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('next_refresh_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('validated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('catalog_version', sa.Uuid(as_uuid=False), nullable=True),
        sa.Column('refresh_attempt_id', sa.Uuid(as_uuid=False), nullable=True),
        sa.Column('attempt_identity', sa.String(length=128), nullable=True),
        sa.Column('attempt_config_digest', sa.String(length=128), nullable=True),
        sa.Column('attempt_deadline_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refresh_status', sa.String(length=16), nullable=False, server_default='idle'),
        sa.Column('failure_code', sa.String(length=64), nullable=True),
        sa.Column('last_failure_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refresh_lease_owner', sa.Uuid(as_uuid=False), nullable=True),
        sa.Column('refresh_lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'workspace_id', 'board_id',
            name='uq_workspace_sprint_catalogs_workspace_board',
        ),
        *_checks(
            prefix='workspace_sprint_catalogs', identity_column='board_id', team=False,
        ),
    )
    op.create_index(
        'ix_workspace_sprint_catalogs_attempt_deadline',
        'workspace_sprint_catalogs', ['workspace_id', 'attempt_deadline_at'],
    )
    op.create_index(
        'ix_workspace_sprint_catalogs_lease_until',
        'workspace_sprint_catalogs', ['workspace_id', 'refresh_lease_until'],
    )

    op.create_table(
        'workspace_sprint_team_catalogs',
        sa.Column('id', sa.Uuid(as_uuid=False), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('sprint_id', sa.String(length=128), nullable=False),
        sa.Column('sprint_name', sa.String(length=255), nullable=False),
        sa.Column('scope_digest', sa.String(length=128), nullable=True),
        sa.Column('payload_version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('teams', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('updated_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('validated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('catalog_version', sa.Uuid(as_uuid=False), nullable=True),
        sa.Column('refresh_attempt_id', sa.Uuid(as_uuid=False), nullable=True),
        sa.Column('attempt_identity', sa.String(length=128), nullable=True),
        sa.Column('attempt_config_digest', sa.String(length=128), nullable=True),
        sa.Column('attempt_scope_digest', sa.String(length=128), nullable=True),
        sa.Column('attempt_deadline_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refresh_status', sa.String(length=16), nullable=False, server_default='idle'),
        sa.Column('failure_code', sa.String(length=64), nullable=True),
        sa.Column('last_failure_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refresh_lease_owner', sa.Uuid(as_uuid=False), nullable=True),
        sa.Column('refresh_lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'workspace_id', 'sprint_id',
            name='uq_workspace_sprint_team_catalogs_workspace_sprint',
        ),
        *_checks(
            prefix='workspace_sprint_team_catalogs', identity_column='sprint_id', team=True,
        ),
    )
    op.create_index(
        'ix_workspace_sprint_team_catalogs_attempt_deadline',
        'workspace_sprint_team_catalogs', ['workspace_id', 'attempt_deadline_at'],
    )
    op.create_index(
        'ix_workspace_sprint_team_catalogs_lease_until',
        'workspace_sprint_team_catalogs', ['workspace_id', 'refresh_lease_until'],
    )


def downgrade() -> None:
    op.drop_table('workspace_sprint_team_catalogs')
    op.drop_table('workspace_sprint_catalogs')
