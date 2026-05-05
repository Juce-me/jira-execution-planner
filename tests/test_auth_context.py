import unittest

from backend.auth.context import (
    RequestAuthContext,
    build_auth_cache_key,
    stable_local_workspace_id,
)


class AuthContextTests(unittest.TestCase):
    def test_stable_local_workspace_id_normalizes_site_and_changes_by_environment(self):
        self.assertEqual(
            stable_local_workspace_id("local", "https://example.atlassian.net/"),
            stable_local_workspace_id("local", "https://example.atlassian.net"),
        )
        self.assertNotEqual(
            stable_local_workspace_id("local", "https://example.atlassian.net"),
            stable_local_workspace_id("dev", "https://example.atlassian.net"),
        )

    def test_stable_local_workspace_id_defaults_optional_inputs(self):
        site = "https://example.atlassian.net"

        self.assertEqual(
            stable_local_workspace_id(None, site),
            stable_local_workspace_id("local", site),
        )
        self.assertEqual(
            stable_local_workspace_id("local", site, None),
            stable_local_workspace_id("local", site, ""),
        )

    def test_build_auth_cache_key_includes_context_and_extra_parts(self):
        context = RequestAuthContext(
            auth_mode="oauth",
            user_id="user-1",
            stable_subject="subject-1",
            atlassian_account_id="atlassian-1",
            workspace_id="workspace-1",
            auth_connection_id="connection-1",
            cloud_id="cloud-1",
            site_url="https://example.atlassian.net",
            token_version="7",
            account_status="active",
            is_admin=False,
        )

        self.assertEqual(
            build_auth_cache_key(context, "projects", 42),
            ("workspace-1", "connection-1", "cloud-1", "7", "projects", "42"),
        )

    def test_build_auth_cache_key_changes_when_token_version_changes(self):
        context = RequestAuthContext(
            auth_mode="oauth",
            user_id="user-1",
            stable_subject="subject-1",
            atlassian_account_id="atlassian-1",
            workspace_id="workspace-1",
            auth_connection_id="connection-1",
            cloud_id="cloud-1",
            site_url="https://example.atlassian.net",
            token_version="7",
            account_status="active",
            is_admin=False,
        )
        changed_context = RequestAuthContext(
            auth_mode="oauth",
            user_id="user-1",
            stable_subject="subject-1",
            atlassian_account_id="atlassian-1",
            workspace_id="workspace-1",
            auth_connection_id="connection-1",
            cloud_id="cloud-1",
            site_url="https://example.atlassian.net",
            token_version="8",
            account_status="active",
            is_admin=False,
        )

        self.assertNotEqual(
            build_auth_cache_key(context, "projects"),
            build_auth_cache_key(changed_context, "projects"),
        )


if __name__ == "__main__":
    unittest.main()
