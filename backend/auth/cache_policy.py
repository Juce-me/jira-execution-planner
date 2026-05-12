AUTH_MODE_BASIC = 'basic'


def _project_access_cache_part(context):
    snapshots = getattr(context, 'project_access', ()) or ()
    if not snapshots:
        return ''
    return '|'.join(sorted(
        ':'.join((
            str(getattr(snapshot, 'project_key', '') or ''),
            str(getattr(snapshot, 'project_type', '') or ''),
            str(getattr(snapshot, 'status', '') or ''),
        ))
        for snapshot in snapshots
    ))


def jira_home_process_cache_enabled(context):
    return getattr(context, 'auth_mode', AUTH_MODE_BASIC) == AUTH_MODE_BASIC


def jira_home_partitioned_process_cache_enabled(context):
    if jira_home_process_cache_enabled(context):
        return True
    return bool(
        getattr(context, 'workspace_id', '')
        and (getattr(context, 'auth_connection_id', '') or getattr(context, 'user_id', ''))
        and getattr(context, 'token_version', '')
    )


def build_jira_home_process_cache_key(context, *parts):
    if not parts:
        parts = ('',)
    if jira_home_process_cache_enabled(context):
        return parts[0] if len(parts) == 1 else tuple(parts)
    return (
        getattr(context, 'workspace_id', ''),
        getattr(context, 'auth_connection_id', '') or getattr(context, 'user_id', ''),
        getattr(context, 'cloud_id', ''),
        str(getattr(context, 'token_version', '')),
        _project_access_cache_part(context),
        *(str(part) for part in parts),
    )
