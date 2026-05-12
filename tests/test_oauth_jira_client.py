import base64
import unittest
from unittest.mock import patch

import jira_server
from backend.auth.context import RequestAuthContext
from tests.oauth_test_helpers import install_oauth_session, push_oauth_request


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthJiraClientTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def _push_oauth_request(self):
        request_context = push_oauth_request(jira_server.app)
        self.addCleanup(request_context.pop)

    def _oauth_context(self, session_id="session-1"):
        return RequestAuthContext(
            auth_mode="atlassian_oauth",
            user_id="local-oauth-user:account-123",
            stable_subject="account-123",
            atlassian_account_id="account-123",
            workspace_id="workspace-1",
            auth_connection_id=f"local-oauth-connection:{session_id}",
            cloud_id="cloud-123",
            site_url="https://example.atlassian.net",
            token_version="1",
            account_status="active",
            is_admin=True,
        )

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_current_jira_get_oauth_uses_gateway_and_bearer_token(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"ok": True})

        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = jira_server.current_jira_get("/rest/api/3/project/search", params={"maxResults": 1})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/project/search")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer access-123")
        self.assertEqual(calls[0][1]["params"], {"maxResults": 1})

    def test_current_jira_search_oauth_uses_search_jql_params(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"issues": []})

        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = jira_server.current_jira_search({
                "jql": 'project = "PROD"',
                "fields": ["summary", "status"],
                "maxResults": 50,
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/search/jql")
        self.assertEqual(calls[0][1]["params"]["fields"], "summary,status")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer access-123")

    def test_current_jira_search_oauth_uses_explicit_context_without_request_context(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"issues": []})

        jira_server.OAUTH_TOKEN_STORE["session-1"] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "account_id": "account-123",
            "stored_at": 9999999999,
        }
        context = self._oauth_context("session-1")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = jira_server.current_jira_search({
                "jql": 'project = "PROD"',
                "fields": ["summary"],
                "maxResults": 50,
            }, context=context)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/search/jql")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], "Bearer access-123")

    def test_current_jira_get_basic_uses_site_url_and_basic_auth_without_request_context(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"ok": True})

        expected_token = base64.b64encode(b"basic@example.com:api-token").decode("ascii")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "JIRA_URL", "https://basic.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "basic@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "api-token"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = jira_server.current_jira_get("/rest/api/3/project/search", params={"maxResults": 1})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://basic.atlassian.net/rest/api/3/project/search")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], f"Basic {expected_token}")
        self.assertEqual(calls[0][1]["params"], {"maxResults": 1})

    def test_current_jira_search_basic_uses_site_url_and_basic_auth_without_request_context(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"issues": []})

        expected_token = base64.b64encode(b"basic@example.com:api-token").decode("ascii")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "JIRA_URL", "https://basic.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "basic@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "api-token"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = jira_server.current_jira_search({
                "jql": 'project = "PROD"',
                "fields": ["summary"],
                "maxResults": 50,
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "https://basic.atlassian.net/rest/api/3/search/jql")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], f"Basic {expected_token}")
        self.assertEqual(calls[0][1]["params"]["fields"], "summary")

    def test_current_jira_request_basic_uses_site_url_and_basic_auth_without_csrf_header(self):
        calls = []

        def fake_request(method, url, **kwargs):
            calls.append((method, url, kwargs))
            return FakeResponse(200, {"ok": True})

        expected_token = base64.b64encode(b"basic@example.com:api-token").decode("ascii")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "JIRA_URL", "https://basic.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "basic@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "api-token"), \
             patch.object(jira_server.HTTP_SESSION, "request", side_effect=fake_request):
            response = jira_server.current_jira_request("POST", "/rest/api/3/search/jql", json_body={"jql": "project = PROD"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][0], "POST")
        self.assertEqual(calls[0][1], "https://basic.atlassian.net/rest/api/3/search/jql")
        self.assertEqual(calls[0][2]["headers"]["Authorization"], f"Basic {expected_token}")
        self.assertNotIn("X-Requested-With", calls[0][2]["headers"])

    def test_current_jira_get_auth_required_returns_stable_payload(self):
        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            payload, status = jira_server.oauth_auth_required_payload()

        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "auth_required")
        self.assertEqual(payload["loginUrl"], "/login?reason=session_expired")

    def test_jira_search_request_uses_current_auth_boundary(self):
        self._push_oauth_request()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": []})) as mock_search:
            response = jira_server.jira_search_request({"jql": 'project = "PROD"', "fields": ["summary"]})

        self.assertEqual(response.status_code, 200)
        mock_search.assert_called_once_with({"jql": 'project = "PROD"', "fields": ["summary"]})

    def test_api_test_route_uses_current_jira_get_boundary(self):
        install_oauth_session(self.client)
        context = self._oauth_context()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=context), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "displayName": "Synthetic User",
             })) as mock_get, \
             patch.object(jira_server, "jira_get", side_effect=AssertionError("/api/test must use current_jira_get")):
            response = self.client.get("/api/test")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["status"], "success")
        mock_get.assert_called_once_with("/rest/api/3/myself", timeout=15)

    def test_resolve_team_field_id_uses_current_jira_get_in_oauth_mode(self):
        self._push_oauth_request()
        fields_payload = [
            {"id": "customfield_12345", "name": "Team[Team]"},
        ]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "TEAM_FIELD_CACHE", None), \
             patch.object(jira_server, "get_team_field_id", return_value=""), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, fields_payload)) as mock_get:
            auth_context = jira_server.current_request_auth_context()
            field_id = jira_server.resolve_team_field_id(None, context=auth_context)

        self.assertEqual(field_id, "customfield_12345")
        mock_get.assert_called_once_with("/rest/api/3/field", timeout=20, context=auth_context)
