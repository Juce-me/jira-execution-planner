"""remove workspace-owned EPM configuration with a reversible archive

Revision ID: 20260827_0008
Revises: 20260826_0007
Create Date: 2026-08-27

Run this migration only during a quiesced deployment and after taking a database backup. The archive
exists only until downgrade or the migration is superseded; it is not application-owned storage and
must never be used to infer a private EPM owner. Concurrent workspace-row deletion is outside the
migration contract because application writers must remain stopped for the upgrade and downgrade.
"""

from __future__ import annotations

from alembic import op
import json
import sqlalchemy as sa


revision = '20260827_0008'
down_revision = '20260826_0007'
branch_labels = None
depends_on = None


def _dialect_name():
    return op.get_context().dialect.name


def _top_level_members(raw_payload):
    """Return decoded keys plus exact member/value slices for one strict JSON object."""
    if not isinstance(raw_payload, str):
        return None
    decoder = json.JSONDecoder(parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    length = len(raw_payload)

    def skip_space(index):
        while index < length and raw_payload[index].isspace():
            index += 1
        return index

    try:
        index = skip_space(0)
        if index >= length or raw_payload[index] != '{':
            return None
        index = skip_space(index + 1)
        if index < length and raw_payload[index] == '}':
            return [] if skip_space(index + 1) == length else None
        members = []
        while index < length:
            member_start = index
            key, key_end = decoder.raw_decode(raw_payload, index)
            if not isinstance(key, str):
                return None
            index = skip_space(key_end)
            if index >= length or raw_payload[index] != ':':
                return None
            value_start = skip_space(index + 1)
            _value, value_end = decoder.raw_decode(raw_payload, value_start)
            members.append((key, raw_payload[member_start:value_end], raw_payload[value_start:value_end]))
            index = skip_space(value_end)
            if index < length and raw_payload[index] == ',':
                index = skip_space(index + 1)
                continue
            if index < length and raw_payload[index] == '}':
                return members if skip_space(index + 1) == length else None
            return None
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return None


def _object_with_archived_epm(raw_payload, archived_epm):
    members = _top_level_members(raw_payload)
    preserved = [] if members is None else [member for key, member, _value in members if key != 'epm']
    preserved.append(f'{json.dumps("epm")}:{archived_epm}')
    return '{' + ','.join(preserved) + '}'


def upgrade() -> None:
    op.create_table(
        'workspace_epm_config_migration_archive',
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('epm_payload', sa.Text(), nullable=True),
        sa.Column('original_revision', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('workspace_id'),
    )
    if _dialect_name() == 'postgresql':
        op.execute(sa.text("""
            INSERT INTO workspace_epm_config_migration_archive
                (workspace_id, epm_payload, original_revision)
            SELECT workspace_id, (payload::jsonb -> 'epm')::text, config_revision
            FROM workspace_dashboard_configs
            WHERE jsonb_typeof(payload::jsonb) = 'object'
              AND payload::jsonb ? 'epm'
        """))
        op.execute(sa.text("""
            UPDATE workspace_dashboard_configs AS workspace_config
            SET payload = (workspace_config.payload::jsonb - 'epm')::json,
                config_revision = workspace_config.config_revision + 1
            FROM workspace_epm_config_migration_archive AS archive
            WHERE archive.workspace_id = workspace_config.workspace_id
        """))
        return
    if _dialect_name() == 'sqlite':
        bind = op.get_bind()
        rows = bind.exec_driver_sql(
            'SELECT workspace_id, payload, config_revision FROM workspace_dashboard_configs'
        ).all()
        for workspace_id, raw_payload, config_revision in rows:
            members = _top_level_members(raw_payload)
            if members is None:
                continue
            epm_values = [value for key, _member, value in members if key == 'epm']
            if not epm_values:
                continue
            bind.exec_driver_sql(
                'INSERT INTO workspace_epm_config_migration_archive '
                '(workspace_id, epm_payload, original_revision) VALUES (?, ?, ?)',
                (workspace_id, epm_values[-1], config_revision),
            )
            without_epm = '{' + ','.join(
                member for key, member, _value in members if key != 'epm'
            ) + '}'
            bind.exec_driver_sql(
                'UPDATE workspace_dashboard_configs '
                'SET payload = ?, config_revision = config_revision + 1 WHERE workspace_id = ?',
                (without_epm, workspace_id),
            )
        return
    raise RuntimeError('unsupported migration dialect')


def downgrade() -> None:
    if _dialect_name() == 'postgresql':
        op.execute(sa.text("""
            UPDATE workspace_dashboard_configs AS workspace_config
            SET payload = (
                    CASE
                        WHEN jsonb_typeof(workspace_config.payload::jsonb) = 'object'
                        THEN workspace_config.payload::jsonb
                        ELSE '{}'::jsonb
                    END
                    || jsonb_build_object('epm', archive.epm_payload::jsonb)
                )::json,
                config_revision = workspace_config.config_revision + 1
            FROM workspace_epm_config_migration_archive AS archive
            WHERE archive.workspace_id = workspace_config.workspace_id
        """))
    elif _dialect_name() == 'sqlite':
        bind = op.get_bind()
        rows = bind.exec_driver_sql(
            'SELECT workspace_config.workspace_id, workspace_config.payload, archive.epm_payload '
            'FROM workspace_dashboard_configs AS workspace_config '
            'JOIN workspace_epm_config_migration_archive AS archive '
            'ON archive.workspace_id = workspace_config.workspace_id'
        ).all()
        for workspace_id, raw_payload, archived_epm in rows:
            bind.exec_driver_sql(
                'UPDATE workspace_dashboard_configs '
                'SET payload = ?, config_revision = config_revision + 1 WHERE workspace_id = ?',
                (_object_with_archived_epm(raw_payload, archived_epm), workspace_id),
            )
    else:
        raise RuntimeError('unsupported migration dialect')
    op.drop_table('workspace_epm_config_migration_archive')
