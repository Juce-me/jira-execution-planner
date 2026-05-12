import base64
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlparse

import requests

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import (
    ATLASSIAN_AUTHORIZE_URL,
    AUTH_MODE_ATLASSIAN_OAUTH,
    AUTH_MODE_BASIC,
    AuthConfig,
    AuthError,
    build_authorize_url,
    build_jira_api_url,
    build_jira_headers,
    build_pkce_challenge,
    choose_accessible_resource,
    exchange_authorization_code,
    fetch_accessible_resources,
    fetch_current_user,
    is_oauth_token_expired,
    missing_oauth_scopes,
    normalize_site_url,
    refresh_oauth_token,
    token_session_payload,
    validate_auth_config,
)


class JiraAuthTests(unittest.TestCase):
    def test_auth_error_stores_code_and_uses_message(self):
        error = AuthError("auth_required", "Sign in with Atlassian before continuing.")

        self.assertEqual(error.code, "auth_required")
        self.assertEqual(error.message, "Sign in with Atlassian before continuing.")
        self.assertEqual(str(error), "Sign in with Atlassian before continuing.")

    def test_build_pkce_challenge_uses_s256_base64url_without_padding(self):
        challenge = build_pkce_challenge("verifier-123")

        self.assertEqual(challenge, "Ds3NpaREu9I2EYq6l0l3ZkFyv_Gt5O4EpGD6cZlY0Kg")
        self.assertNotIn("=", challenge)

    def test_default_scopes_include_read_me(self):
        self.assertIn("read:me", AuthConfig().scopes.split())

    def test_default_scopes_include_jira_software_agile_reads(self):
        scopes = set(AuthConfig().scopes.split())

        self.assertIn("read:board-scope:jira-software", scopes)
        self.assertIn("read:sprint:jira-software", scopes)
        self.assertIn("read:project:jira", scopes)

    def test_missing_oauth_scopes_detects_old_session(self):
        required = {
            "read:me",
            "read:jira-work",
            "read:jira-user",
            "read:board-scope:jira-software",
            "read:sprint:jira-software",
            "read:project:jira",
            "offline_access",
        }
        session_data = {
            "access_token": "access-123",
            "scope": "read:me read:jira-work read:jira-user offline_access",
        }

        self.assertEqual(
            missing_oauth_scopes(session_data, required),
            {"read:board-scope:jira-software", "read:sprint:jira-software", "read:project:jira"},
        )

    def test_validate_auth_config_uses_planned_error_codes(self):
        cases = [
            (AuthConfig(jira_url=""), "missing_jira_url"),
            (AuthConfig(jira_url="https://example.atlassian.net"), "missing_basic_auth"),
            (
                AuthConfig(auth_mode=AUTH_MODE_ATLASSIAN_OAUTH, jira_url="https://example.atlassian.net"),
                "missing_oauth_config",
            ),
            (
                AuthConfig(
                    auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
                    jira_url="https://example.atlassian.net",
                    client_id="client-123",
                    client_secret="secret-123",
                    redirect_uri="http://localhost:5050/auth/callback",
                ),
                "missing_flask_secret_key",
            ),
            (AuthConfig(auth_mode="unknown", jira_url="https://example.atlassian.net"), "invalid_auth_mode"),
        ]

        for config, expected_code in cases:
            with self.subTest(expected_code=expected_code):
                with self.assertRaises(AuthError) as raised:
                    validate_auth_config(config)

                self.assertEqual(raised.exception.code, expected_code)

    def test_normalize_site_url_removes_trailing_slash(self):
        self.assertEqual(normalize_site_url(" https://example.atlassian.net/ "), "https://example.atlassian.net")

    def test_choose_accessible_resource_matches_resource_url_to_jira_url(self):
        resources = [
            {"id": "wrong", "url": "https://wrong.atlassian.net"},
            {"id": "cloud-1", "url": "https://example.atlassian.net/", "name": "Example"},
        ]

        resource = choose_accessible_resource(resources, "https://example.atlassian.net")

        self.assertEqual(resource["id"], "cloud-1")

    def test_choose_accessible_resource_raises_when_no_site_matches(self):
        with self.assertRaises(AuthError) as raised:
            choose_accessible_resource([{"id": "cloud-1", "url": "https://other.atlassian.net"}], "https://example.atlassian.net")

        self.assertEqual(raised.exception.code, "jira_site_not_accessible")

    def test_choose_accessible_resource_rejects_malformed_resource_entry(self):
        with self.assertRaises(AuthError) as raised:
            choose_accessible_resource(["not-object"], "https://example.atlassian.net")

        self.assertEqual(raised.exception.code, "accessible_resources_failed")

    def test_choose_accessible_resource_rejects_non_string_resource_url(self):
        with self.assertRaises(AuthError) as raised:
            choose_accessible_resource([{"id": "cloud-1", "url": ["https://example.atlassian.net"]}], "https://example.atlassian.net")

        self.assertEqual(raised.exception.code, "accessible_resources_failed")

    def test_build_authorize_url_includes_atlassian_oauth_parameters_without_forcing_consent(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
            scopes="read:me read:jira-work read:jira-user offline_access",
            flask_secret_key="dev-secret",
        )

        authorize_url = build_authorize_url(config, "state-123", code_challenge="challenge-123")
        parsed = urlparse(authorize_url)
        query = parse_qs(parsed.query)

        self.assertEqual(f"{parsed.scheme}://{parsed.netloc}{parsed.path}", ATLASSIAN_AUTHORIZE_URL)
        self.assertEqual(query["audience"], ["api.atlassian.com"])
        self.assertEqual(query["client_id"], ["client-123"])
        self.assertEqual(query["response_type"], ["code"])
        self.assertNotIn("prompt", query)
        self.assertEqual(query["state"], ["state-123"])
        self.assertEqual(query["code_challenge"], ["challenge-123"])
        self.assertEqual(query["code_challenge_method"], ["S256"])

    def test_build_authorize_url_can_force_consent_for_scope_changes(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
            scopes="read:me read:jira-work read:jira-user offline_access",
            flask_secret_key="dev-secret",
        )

        authorize_url = build_authorize_url(
            config,
            "state-123",
            code_challenge="challenge-123",
            force_consent=True,
        )
        query = parse_qs(urlparse(authorize_url).query)

        self.assertEqual(query["prompt"], ["consent"])

    def test_build_authorize_url_requires_pkce_challenge(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
            flask_secret_key="dev-secret",
        )

        with self.assertRaises(AuthError) as raised:
            build_authorize_url(config, "state-123")

        self.assertEqual(raised.exception.code, "missing_pkce_challenge")

    def test_token_session_payload_preserves_atlassian_identity_profile_fields(self):
        token_data = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_in": 3600,
            "scope": "read:me",
        }
        resource = {
            "id": "cloud-1",
            "url": "https://example.atlassian.net/",
            "name": "Example Site",
        }
        user_profile = {
            "account_id": "account-123",
            "account_status": "active",
            "email": "person@example.com",
            "name": "Person Example",
        }

        payload = token_session_payload(token_data, resource, user_profile)

        self.assertEqual(payload["access_token"], "access-123")
        self.assertEqual(payload["refresh_token"], "refresh-123")
        self.assertGreaterEqual(payload["expires_at"], int(time.time()) + 3590)
        self.assertEqual(payload["scope"], "read:me")
        self.assertEqual(payload["cloudid"], "cloud-1")
        self.assertNotIn("cloud_id", payload)
        self.assertEqual(payload["site_url"], "https://example.atlassian.net")
        self.assertEqual(payload["site_name"], "Example Site")
        self.assertEqual(payload["account_id"], "account-123")
        self.assertEqual(payload["account_status"], "active")
        self.assertEqual(payload["email"], "person@example.com")
        self.assertEqual(payload["display_name"], "Person Example")

    def test_build_jira_headers_basic_mode_returns_json_and_basic_authorization(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_BASIC,
            jira_url="https://example.atlassian.net",
            jira_email="person@example.com",
            jira_token="token-123",
        )

        headers = build_jira_headers(config, {})
        expected_token = base64.b64encode(b"person@example.com:token-123").decode("ascii")

        self.assertEqual(headers["Accept"], "application/json")
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(headers["Authorization"], f"Basic {expected_token}")

    def test_build_jira_headers_oauth_mode_uses_session_access_token_as_bearer(self):
        config = AuthConfig(auth_mode=AUTH_MODE_ATLASSIAN_OAUTH, jira_url="https://example.atlassian.net")

        headers = build_jira_headers(config, {"access_token": "access-123"})

        self.assertEqual(headers["Authorization"], "Bearer access-123")

    def test_build_jira_headers_oauth_mode_raises_without_access_token(self):
        config = AuthConfig(auth_mode=AUTH_MODE_ATLASSIAN_OAUTH, jira_url="https://example.atlassian.net")

        with self.assertRaises(AuthError) as raised:
            build_jira_headers(config, {})

        self.assertEqual(raised.exception.code, "auth_required")

    def test_build_jira_api_url_basic_mode_uses_site_url_plus_path(self):
        config = AuthConfig(auth_mode=AUTH_MODE_BASIC, jira_url="https://example.atlassian.net/")
        context = self._auth_context()

        self.assertEqual(
            build_jira_api_url(config, context, "/rest/api/3/myself"),
            "https://example.atlassian.net/rest/api/3/myself",
        )

    def test_build_jira_api_url_oauth_mode_uses_atlassian_api_gateway(self):
        config = AuthConfig(auth_mode=AUTH_MODE_ATLASSIAN_OAUTH, jira_url="https://example.atlassian.net")
        context = self._auth_context(cloud_id="cloud-1")

        self.assertEqual(
            build_jira_api_url(config, context, "/rest/api/3/myself"),
            "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself",
        )

    def test_build_jira_api_url_oauth_mode_requires_cloud_id(self):
        config = AuthConfig(auth_mode=AUTH_MODE_ATLASSIAN_OAUTH, jira_url="https://example.atlassian.net")
        context = self._auth_context(cloud_id="")

        with self.assertRaises(AuthError) as raised:
            build_jira_api_url(config, context, "/rest/api/3/myself")

        self.assertEqual(raised.exception.code, "auth_required")

    def test_exchange_authorization_code_posts_json_with_timeout(self):
        calls = []

        def http_post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"access_token": "access-123", "refresh_token": "refresh-123", "expires_in": 3600})

        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
        )

        token_data = exchange_authorization_code(config, "code-123", code_verifier="verifier-123", http_post=http_post)

        self.assertEqual(token_data["access_token"], "access-123")
        self.assertEqual(calls[0][1]["json"]["grant_type"], "authorization_code")
        self.assertEqual(calls[0][1]["json"]["code_verifier"], "verifier-123")
        self.assertEqual(calls[0][1]["timeout"], 20)

    def test_exchange_authorization_code_requires_pkce_verifier(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
        )

        with self.assertRaises(AuthError) as raised:
            exchange_authorization_code(config, "code-123", http_post=lambda *args, **kwargs: self.fail("HTTP should not be called"))

        self.assertEqual(raised.exception.code, "missing_pkce_verifier")

    def test_exchange_authorization_code_wraps_request_exception(self):
        def http_post(url, **kwargs):
            raise requests.RequestException("network down")

        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
        )

        with self.assertRaises(AuthError) as raised:
            exchange_authorization_code(config, "code-123", code_verifier="verifier-123", http_post=http_post)

        self.assertEqual(raised.exception.code, "oauth_exchange_failed")

    def test_exchange_authorization_code_rejects_malformed_success(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
        )

        with self.assertRaises(AuthError) as raised:
            exchange_authorization_code(
                config,
                "code-123",
                code_verifier="verifier-123",
                http_post=lambda *args, **kwargs: FakeResponse(200, {"access_token": "access-123", "expires_in": "not-a-number"}),
            )

        self.assertEqual(raised.exception.code, "oauth_exchange_failed")

    def test_exchange_authorization_code_rejects_invalid_json_success(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
        )

        with self.assertRaises(AuthError) as raised:
            exchange_authorization_code(
                config,
                "code-123",
                code_verifier="verifier-123",
                http_post=lambda *args, **kwargs: InvalidJsonResponse(200),
            )

        self.assertEqual(raised.exception.code, "oauth_exchange_failed")

    def test_exchange_authorization_code_rejects_non_dict_success(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
            redirect_uri="http://localhost:5050/auth/callback",
        )

        with self.assertRaises(AuthError) as raised:
            exchange_authorization_code(
                config,
                "code-123",
                code_verifier="verifier-123",
                http_post=lambda *args, **kwargs: FakeResponse(200, []),
            )

        self.assertEqual(raised.exception.code, "oauth_exchange_failed")

    def test_fetch_current_user_passes_bearer_headers_and_timeout(self):
        calls = []

        def http_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"account_id": "account-123"})

        profile = fetch_current_user("access-123", http_get=http_get)

        self.assertEqual(profile["account_id"], "account-123")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer access-123")
        self.assertEqual(calls[0][1]["headers"]["Accept"], "application/json")
        self.assertEqual(calls[0][1]["timeout"], 20)

    def test_fetch_current_user_wraps_request_exception(self):
        def http_get(url, **kwargs):
            raise requests.RequestException("network down")

        with self.assertRaises(AuthError) as raised:
            fetch_current_user("access-123", http_get=http_get)

        self.assertEqual(raised.exception.code, "user_identity_failed")

    def test_fetch_current_user_rejects_invalid_json(self):
        with self.assertRaises(AuthError) as raised:
            fetch_current_user("access-123", http_get=lambda *args, **kwargs: InvalidJsonResponse(200))

        self.assertEqual(raised.exception.code, "user_identity_failed")

    def test_fetch_current_user_rejects_non_dict_json(self):
        with self.assertRaises(AuthError) as raised:
            fetch_current_user("access-123", http_get=lambda *args, **kwargs: FakeResponse(200, []))

        self.assertEqual(raised.exception.code, "user_identity_failed")

    def test_fetch_accessible_resources_passes_bearer_headers_and_timeout(self):
        calls = []

        def http_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, [{"id": "cloud-1"}])

        resources = fetch_accessible_resources("access-123", http_get=http_get)

        self.assertEqual(resources, [{"id": "cloud-1"}])
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer access-123")
        self.assertEqual(calls[0][1]["headers"]["Accept"], "application/json")
        self.assertEqual(calls[0][1]["timeout"], 20)

    def test_fetch_accessible_resources_rejects_invalid_json(self):
        with self.assertRaises(AuthError) as raised:
            fetch_accessible_resources("access-123", http_get=lambda *args, **kwargs: InvalidJsonResponse(200))

        self.assertEqual(raised.exception.code, "accessible_resources_failed")

    def test_fetch_accessible_resources_rejects_non_list_json(self):
        with self.assertRaises(AuthError) as raised:
            fetch_accessible_resources("access-123", http_get=lambda *args, **kwargs: FakeResponse(200, {}))

        self.assertEqual(raised.exception.code, "accessible_resources_failed")

    def test_refresh_oauth_token_posts_json_and_preserves_refresh_token(self):
        calls = []

        def http_post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"access_token": "new-access-123", "expires_in": 3600, "scope": "read:me"})

        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
        )
        session_data = {"access_token": "old-access-123", "refresh_token": "old-refresh-123", "scope": "old-scope"}

        refreshed = refresh_oauth_token(config, session_data, http_post=http_post)

        self.assertEqual(refreshed["access_token"], "new-access-123")
        self.assertEqual(refreshed["refresh_token"], "old-refresh-123")
        self.assertEqual(refreshed["scope"], "read:me")
        self.assertEqual(calls[0][1]["json"]["grant_type"], "refresh_token")
        self.assertEqual(calls[0][1]["json"]["refresh_token"], "old-refresh-123")
        self.assertEqual(calls[0][1]["timeout"], 20)

    def test_refresh_oauth_token_rejects_malformed_success(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
        )
        session_data = {"access_token": "old-access-123", "refresh_token": "old-refresh-123"}

        with self.assertRaises(AuthError) as raised:
            refresh_oauth_token(config, session_data, http_post=lambda *args, **kwargs: FakeResponse(200, {"expires_in": 3600}))

        self.assertEqual(raised.exception.code, "auth_required")

    def test_refresh_oauth_token_rejects_invalid_json_success(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
        )
        session_data = {"access_token": "old-access-123", "refresh_token": "old-refresh-123"}

        with self.assertRaises(AuthError) as raised:
            refresh_oauth_token(config, session_data, http_post=lambda *args, **kwargs: InvalidJsonResponse(200))

        self.assertEqual(raised.exception.code, "auth_required")

    def test_refresh_oauth_token_rejects_non_dict_success(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
        )
        session_data = {"access_token": "old-access-123", "refresh_token": "old-refresh-123"}

        with self.assertRaises(AuthError) as raised:
            refresh_oauth_token(config, session_data, http_post=lambda *args, **kwargs: FakeResponse(200, []))

        self.assertEqual(raised.exception.code, "auth_required")

    def test_refresh_oauth_token_detects_reused_refresh_token_errors(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
        )
        session_data = {"access_token": "old-access-123", "refresh_token": "old-refresh-123"}

        with self.assertRaises(AuthError) as raised:
            refresh_oauth_token(
                config,
                session_data,
                http_post=lambda *args, **kwargs: FakeResponse(400, {
                    "error": "invalid_request",
                    "error_description": "token_already_used",
                }),
            )

        self.assertEqual(raised.exception.code, "refresh_reuse_detected")

    def test_is_oauth_token_expired_uses_sixty_second_buffer(self):
        self.assertTrue(is_oauth_token_expired({"expires_at": int(time.time()) + 30}))
        self.assertFalse(is_oauth_token_expired({"expires_at": int(time.time()) + 600}))

    def test_jira_get_uses_built_url_and_headers(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_BASIC,
            jira_url="https://example.atlassian.net",
            jira_email="user@example.com",
            jira_token="token-123",
        )
        context = self._auth_context()
        calls = []

        def http_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"ok": True})

        from backend.auth.jira_auth import jira_get

        response = jira_get(config, context, {}, "/rest/api/3/project/search", http_get=http_get, timeout=15)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://example.atlassian.net/rest/api/3/project/search")
        self.assertIn("Authorization", calls[0][1]["headers"])
        self.assertEqual(calls[0][1]["timeout"], 15)

    def test_concurrent_oauth_refresh_only_calls_provider_once(self):
        from backend.auth.jira_auth import ensure_oauth_token

        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
        )
        shared_session = {
            "access_token": "old-access",
            "refresh_token": "refresh-1",
            "expires_at": time.time() - 10,
        }
        session_lock = threading.Lock()
        refresh_lock = threading.Lock()
        start = threading.Barrier(2)

        def load_session():
            with session_lock:
                return dict(shared_session)

        def save_session(data):
            with session_lock:
                shared_session.update(data)

        http_post_calls = []

        def http_post(url, **kwargs):
            http_post_calls.append((url, kwargs))
            return FakeResponse(200, {
                "access_token": "access-2",
                "refresh_token": "refresh-2",
                "expires_in": 3600,
            })

        def worker():
            initial = load_session()
            start.wait(timeout=5)
            return ensure_oauth_token(
                config,
                initial,
                save_session,
                http_post=http_post,
                reload_session=load_session,
                refresh_lock=refresh_lock,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: worker(), range(2)))

        self.assertEqual(len(http_post_calls), 1)
        self.assertEqual(shared_session["refresh_token"], "refresh-2")
        self.assertEqual([result["access_token"] for result in results], ["access-2", "access-2"])

    def test_oauth_refresh_does_not_save_after_session_cleared(self):
        from backend.auth.jira_auth import ensure_oauth_token

        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url="https://example.atlassian.net",
            client_id="client-123",
            client_secret="secret-123",
        )
        expired_session = {
            "access_token": "old-access",
            "refresh_token": "refresh-1",
            "expires_at": time.time() - 10,
        }
        reloads = []
        saved = []

        def reload_session():
            reloads.append(True)
            if len(reloads) == 1:
                return dict(expired_session)
            return {}

        def save_session(data):
            saved.append(data)

        def http_post(url, **kwargs):
            return FakeResponse(200, {
                "access_token": "access-2",
                "refresh_token": "refresh-2",
                "expires_in": 3600,
            })

        with self.assertRaises(AuthError) as raised:
            ensure_oauth_token(
                config,
                expired_session,
                save_session,
                http_post=http_post,
                reload_session=reload_session,
                refresh_lock=threading.Lock(),
            )

        self.assertEqual(raised.exception.code, "auth_required")
        self.assertEqual(saved, [])

    def _auth_context(self, cloud_id=""):
        return RequestAuthContext(
            auth_mode=AUTH_MODE_BASIC,
            user_id="user-1",
            stable_subject="subject-1",
            atlassian_account_id="account-1",
            workspace_id="workspace-1",
            auth_connection_id="connection-1",
            cloud_id=cloud_id,
            site_url="https://example.atlassian.net",
            token_version="1",
            account_status="active",
            is_admin=False,
        )


class FakeResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self.body = body

    def json(self):
        return self.body


class InvalidJsonResponse:
    def __init__(self, status_code):
        self.status_code = status_code

    def json(self):
        raise ValueError("invalid json")


if __name__ == "__main__":
    unittest.main()
