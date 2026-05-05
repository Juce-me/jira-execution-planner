AUTH_MODE_BASIC = 'basic'


def jira_home_process_cache_enabled(context):
    return getattr(context, 'auth_mode', AUTH_MODE_BASIC) == AUTH_MODE_BASIC
