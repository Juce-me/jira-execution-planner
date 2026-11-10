import unittest
from unittest.mock import patch

import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session, push_oauth_request, set_up_db_oauth


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthJiraClientTests(unittest.TestCase):
    def setUp(self):
        set_up_db_oauth(self)
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def _push_oauth_request(self):
        request_context = push_oauth_request(jira_server.app)
        self.addCleanup(request_context.pop)

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

        request_context = push_oauth_request(jira_server.app)
        context = jira_server.current_request_auth_context()
        request_context.pop()
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

    def test_retired_basic_transport_fails_before_any_http(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'resilient_jira_get') as get, \
             patch.object(jira_server.HTTP_SESSION, 'request') as request:
            for call in (
                lambda: jira_server.current_jira_get('/rest/api/3/project/search'),
                lambda: jira_server.current_jira_search({'jql': 'project = SYN'}),
                lambda: jira_server.current_jira_request('POST', '/rest/api/3/search/jql', json_body={}),
            ):
                with self.subTest(call=call), self.assertRaises(jira_server.AuthError):
                    call()
            get.assert_not_called()
            request.assert_not_called()

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
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
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
