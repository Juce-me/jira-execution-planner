from unittest.mock import patch


def force_basic_auth_mode(test_case, jira_server):
    patcher = patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic')
    patcher.start()
    test_case.addCleanup(patcher.stop)
