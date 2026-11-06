"""Real encrypted DB actors for tests running in an explicitly synthetic runtime.

This module deliberately does not import jira_server. Callers own the DB
transaction and Flask cookie; no local token store or identity patch is used.
"""

from dataclasses import dataclass

from backend.auth.db_browser_sessions import create_browser_session
from backend.auth.db_tokens import store_oauth_callback_tokens
from backend.auth.key_provider import key_provider_from_env
from backend.db import models


FULL_OAUTH_SCOPE = (
    'read:me read:jira-work write:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access'
)


@dataclass(frozen=True)
class DbActor:
    user_id: str
    workspace_id: str
    connection_id: str
    browser_session_id: str
    key_provider: object

    @property
    def session_payload(self):
        # A fresh copy prevents cookie consumers mutating the reusable actor.
        return {'db_browser_session_id': self.browser_session_id}


def seed_db_actor(session, *, workspace, account_identity, roles=(), key_provider=None, token_data=None):
    """Persist one actor; workspace may be a Workspace row or a synthetic dict.

    Dict keys: cloud_id, site_url, environment_key, name. Identity is an account
    id or dict with account_id/display_name/email. Only the explicit 'admin'
    role grants the application's tool-admin account type. Does not commit.
    """
    if set(roles) - {'admin', 'user'}:
        raise ValueError('Unknown fixture role.')
    if isinstance(workspace, models.Workspace):
        resource = {'id': workspace.jira_cloud_id, 'url': workspace.jira_site_url,
                    'name': workspace.name}
        environment_key = workspace.environment_key
    else:
        resource = {'id': workspace['cloud_id'], 'url': workspace['site_url'],
                    'name': workspace.get('name', 'Synthetic workspace')}
        environment_key = workspace.get('environment_key', 'local')
    identity = ({'account_id': account_identity} if isinstance(account_identity, str)
                else dict(account_identity))
    profile = {'account_status': 'active', 'display_name': 'Synthetic user', **identity}
    provider = key_provider if key_provider is not None else key_provider_from_env()
    tokens = {'access_token': 'synthetic-access-' + profile['account_id'],
              'refresh_token': 'synthetic-refresh-' + profile['account_id'],
              'expires_in': 3600, 'scope': FULL_OAUTH_SCOPE}
    tokens.update(token_data or {})
    stored = store_oauth_callback_tokens(
        session, token_data=tokens,
        resource=resource, user_profile=profile, environment_key=environment_key,
        configured_jira_url=resource['url'], key_provider=provider,
    )
    user = session.get(models.User, stored.user_id)
    user.account_type = 'admin' if 'admin' in roles else 'user'
    browser = create_browser_session(session, user_id=stored.user_id,
                                     workspace_id=stored.workspace_id,
                                     auth_connection_id=stored.connection_id)
    session.flush()
    return DbActor(stored.user_id, stored.workspace_id, stored.connection_id, browser.id, provider)
