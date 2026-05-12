from unittest.mock import patch


def force_basic_auth_mode(test_case, jira_server):
    patchers = [
        patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'),
        patch.dict('os.environ', {'CONFIG_STORAGE_BACKEND': 'jsonfile'}, clear=False),
    ]
    for patcher in patchers:
        patcher.start()
        test_case.addCleanup(patcher.stop)
