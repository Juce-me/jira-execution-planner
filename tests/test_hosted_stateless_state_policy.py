import os
import unittest
from unittest.mock import patch

import jira_server


class HostedStatelessStatePolicyTests(unittest.TestCase):
    def test_local_file_state_defaults_false_outside_local_dev(self):
        with patch.dict(os.environ, {"APP_ENVIRONMENT_KEY": "production"}, clear=False):
            self.assertFalse(jira_server.local_file_state_enabled())

    def test_clear_auth_sensitive_caches_skips_file_invalidators_when_disabled(self):
        with patch.object(jira_server, "local_file_state_enabled", return_value=False), \
             patch.object(jira_server, "invalidate_sprints_cache") as invalidate_sprints, \
             patch.object(jira_server, "invalidate_stats_cache") as invalidate_stats:
            jira_server.clear_auth_sensitive_caches("test")

        invalidate_sprints.assert_not_called()
        invalidate_stats.assert_not_called()


if __name__ == "__main__":
    unittest.main()
