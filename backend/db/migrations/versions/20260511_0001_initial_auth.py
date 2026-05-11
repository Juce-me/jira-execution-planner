"""initial auth schema

Revision ID: 20260511_0001
Revises:
Create Date: 2026-05-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '20260511_0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('external_provider', sa.String(length=64), nullable=False),
        sa.Column('external_subject', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('account_type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('created_by', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("account_type in ('user', 'admin')", name='ck_users_account_type'),
        sa.CheckConstraint("status in ('active', 'disabled', 'deleted')", name='ck_users_status'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('external_provider', 'external_subject', name='uq_users_external_identity'),
    )

    op.create_table(
        'workspaces',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('environment_key', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('jira_site_url', sa.String(length=512), nullable=True),
        sa.Column('jira_cloud_id', sa.String(length=255), nullable=True),
        sa.Column('created_by', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_workspaces_environment_cloud',
        'workspaces',
        ['environment_key', 'jira_cloud_id'],
        unique=True,
        sqlite_where=sa.text('jira_cloud_id IS NOT NULL'),
        postgresql_where=sa.text('jira_cloud_id IS NOT NULL'),
    )
    op.create_index(
        'uq_workspaces_environment_site',
        'workspaces',
        ['environment_key', 'jira_site_url'],
        unique=True,
        sqlite_where=sa.text('jira_site_url IS NOT NULL'),
        postgresql_where=sa.text('jira_site_url IS NOT NULL'),
    )

    op.create_table(
        'auth_connections',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('provider', sa.String(length=64), nullable=False),
        sa.Column('site_url', sa.String(length=512), nullable=True),
        sa.Column('cloud_id', sa.String(length=255), nullable=True),
        sa.Column('scopes', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('token_version', sa.Integer(), nullable=False),
        sa.Column('last_validated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "provider in ('atlassian_oauth', 'jira_basic', 'atlassian_user_api_token', 'confluence_oauth')",
            name='ck_auth_connections_provider',
        ),
        sa.CheckConstraint("status in ('active', 'expired', 'revoked', 'error')", name='ck_auth_connections_status'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_auth_connections_current_cloud',
        'auth_connections',
        ['user_id', 'workspace_id', 'provider', 'cloud_id'],
        unique=True,
        sqlite_where=sa.text('cloud_id IS NOT NULL'),
        postgresql_where=sa.text('cloud_id IS NOT NULL'),
    )
    op.create_index(
        'uq_auth_connections_current_site',
        'auth_connections',
        ['user_id', 'workspace_id', 'provider', 'site_url'],
        unique=True,
        sqlite_where=sa.text('site_url IS NOT NULL'),
        postgresql_where=sa.text('site_url IS NOT NULL'),
    )

    op.create_table(
        'auth_tokens',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('connection_id', sa.String(length=36), nullable=False),
        sa.Column('token_kind', sa.String(length=32), nullable=False),
        sa.Column('algorithm', sa.String(length=64), nullable=False),
        sa.Column('ciphertext', sa.Text(), nullable=False),
        sa.Column('nonce', sa.String(length=255), nullable=False),
        sa.Column('wrapped_dek', sa.Text(), nullable=False),
        sa.Column('key_id', sa.String(length=255), nullable=False),
        sa.Column('aad_hash', sa.String(length=128), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rotated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("token_kind in ('access_token', 'refresh_token', 'api_token')", name='ck_auth_tokens_kind'),
        sa.ForeignKeyConstraint(['connection_id'], ['auth_connections.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_auth_tokens_active_kind',
        'auth_tokens',
        ['connection_id', 'token_kind'],
        unique=True,
        sqlite_where=sa.text('revoked_at IS NULL'),
        postgresql_where=sa.text('revoked_at IS NULL'),
    )

    op.create_table(
        'service_integrations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('provider', sa.String(length=64), nullable=False),
        sa.Column('credential_subject', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('token_version', sa.Integer(), nullable=False),
        sa.Column('last_validated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('updated_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("provider in ('jira_basic', 'home_townsquare_basic')", name='ck_service_integrations_provider'),
        sa.CheckConstraint(
            "status in ('active', 'disabled', 'expired', 'revoked', 'error')",
            name='ck_service_integrations_status',
        ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_service_integrations_active_provider',
        'service_integrations',
        ['workspace_id', 'provider'],
        unique=True,
        sqlite_where=sa.text("status = 'active'"),
        postgresql_where=sa.text("status = 'active'"),
    )

    op.create_table(
        'service_integration_tokens',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('service_integration_id', sa.String(length=36), nullable=False),
        sa.Column('token_kind', sa.String(length=32), nullable=False),
        sa.Column('algorithm', sa.String(length=64), nullable=False),
        sa.Column('ciphertext', sa.Text(), nullable=False),
        sa.Column('nonce', sa.String(length=255), nullable=False),
        sa.Column('wrapped_dek', sa.Text(), nullable=False),
        sa.Column('key_id', sa.String(length=255), nullable=False),
        sa.Column('aad_hash', sa.String(length=128), nullable=False),
        sa.Column('rotated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("token_kind in ('api_token')", name='ck_service_integration_tokens_kind'),
        sa.ForeignKeyConstraint(['service_integration_id'], ['service_integrations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_service_integration_tokens_active_kind',
        'service_integration_tokens',
        ['service_integration_id', 'token_kind'],
        unique=True,
        sqlite_where=sa.text('revoked_at IS NULL'),
        postgresql_where=sa.text('revoked_at IS NULL'),
    )

    op.create_table(
        'jira_project_access',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('connection_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('project_key', sa.String(length=64), nullable=False),
        sa.Column('project_type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('error_code', sa.String(length=128), nullable=True),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("project_type in ('product', 'tech', 'other')", name='ck_jira_project_access_type'),
        sa.CheckConstraint("status in ('accessible', 'inaccessible', 'unknown')", name='ck_jira_project_access_status'),
        sa.ForeignKeyConstraint(['connection_id'], ['auth_connections.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'connection_id',
            'workspace_id',
            'project_key',
            'project_type',
            name='uq_jira_project_access_project',
        ),
    )

    op.create_table(
        'audit_events',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('actor_user_id', sa.String(length=36), nullable=True),
        sa.Column('target_user_id', sa.String(length=36), nullable=True),
        sa.Column('auth_connection_id', sa.String(length=36), nullable=True),
        sa.Column('event_type', sa.String(length=128), nullable=False),
        sa.Column('metadata', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['auth_connection_id'], ['auth_connections.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['target_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('audit_events')
    op.drop_table('jira_project_access')
    op.drop_index('uq_service_integration_tokens_active_kind', table_name='service_integration_tokens')
    op.drop_table('service_integration_tokens')
    op.drop_index('uq_service_integrations_active_provider', table_name='service_integrations')
    op.drop_table('service_integrations')
    op.drop_index('uq_auth_tokens_active_kind', table_name='auth_tokens')
    op.drop_table('auth_tokens')
    op.drop_index('uq_auth_connections_current_site', table_name='auth_connections')
    op.drop_index('uq_auth_connections_current_cloud', table_name='auth_connections')
    op.drop_table('auth_connections')
    op.drop_index('uq_workspaces_environment_site', table_name='workspaces')
    op.drop_index('uq_workspaces_environment_cloud', table_name='workspaces')
    op.drop_table('workspaces')
    op.drop_table('users')
