"""Pure OAuth scope checks against request auth context provenance."""

from backend.auth.jira_auth import oauth_scope_set


def missing_context_oauth_scopes(context, required_scopes):
    required = oauth_scope_set(required_scopes)
    if not getattr(context, 'granted_scopes_verified', False):
        return required
    granted = oauth_scope_set(getattr(context, 'granted_scopes', ()))
    return required - granted
