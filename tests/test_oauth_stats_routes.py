import base64
import unittest
from unittest.mock import patch

import jira_server
from tests.oauth_test_helpers import install_oauth_session


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthStatsRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()
        install_oauth_session(self.client)

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        jira_server.SCENARIO_CACHE.clear()
        jira_server.EPIC_COHORT_CACHE.clear()

    def test_sprints_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "is_cache_valid", return_value=True), \
             patch.object(jira_server, "load_sprints_cache", side_effect=AssertionError("OAuth must not read sprints file cache")), \
             patch.object(jira_server, "save_sprints_cache") as mock_save_cache, \
             patch.object(jira_server, "get_effective_board_id", return_value="42"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": [{"id": 42, "name": "2026Q2", "state": "active", "originBoardId": 42}],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/sprints")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["sprints"][0]["name"], "2026Q2")
        mock_get.assert_called()
        mock_save_cache.assert_not_called()

    def test_capacity_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "resolve_capacity_field_id", return_value="customfield_capacity"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [{
                     "key": "CAP-1",
                     "fields": {
                         "summary": "Team info 2026Q2 - Alpha",
                         "customfield_capacity": 5,
                     },
                 }]
             })) as mock_search:
            response = self.client.get("/api/capacity?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["enabled"], True)
        self.assertEqual(response.get_json()["capacities"], {"Alpha": 5.0})
        mock_search.assert_called()

    def test_planned_capacity_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "fetch_capacity_for_sprint", return_value=({"enabled": True, "capacities": {}}, None)) as mock_fetch:
            response = self.client.get("/api/planned-capacity?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_fetch.assert_called_once_with("2026Q2", None, debug=False, team_names=[])

    def test_stats_route_bypasses_file_cache_for_oauth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "load_stats_cache", side_effect=AssertionError("OAuth must not read stats file cache")), \
             patch.object(jira_server, "save_stats_cache") as mock_save_cache, \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "fetch_stats_for_sprint", return_value=({"teams": []}, None)):
            response = self.client.get("/api/stats?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["data"], {"teams": []})
        mock_save_cache.assert_not_called()

    def test_stats_route_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/stats?sprint=2026Q2")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_scenario_route_bypasses_sprint_cache_for_oauth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "load_sprints_cache", side_effect=AssertionError("OAuth must not read sprints file cache")), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "fetch_issues_by_jql", return_value=[]), \
             patch.object(jira_server, "collect_dependencies", return_value={}), \
             patch.object(jira_server, "fetch_capacity_team_sizes", return_value=({}, {})):
            response = self.client.post(
                "/api/scenario",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"filters": {"sprint": "2026Q2"}, "config": {}},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_burnout_route_bypasses_sprint_cache_for_oauth(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "load_sprints_cache", side_effect=AssertionError("OAuth must not read sprints file cache")), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [], "isLast": True})):
            response = self.client.get("/api/stats/burnout?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_stats_burnout_post_requires_oauth_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/stats/burnout", json={"sprint": "2026Q2"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_epic_cohort_post_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "fetch_epic_cohort_data", return_value=({"quarters": []}, None)) as mock_fetch:
            response = self.client.post(
                "/api/stats/epic-cohort",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"startQuarter": "2026Q2"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["data"], {"quarters": []})
        mock_fetch.assert_called_once()

    def test_scenario_overrides_routes_are_oauth_ready(self):
        overrides_payload = {"scenarios": {"2026Q2": {"overrides": {"PROD-1": {"start": "2026-04-01"}}}}}
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "load_scenario_overrides", return_value=overrides_payload), \
             patch.object(jira_server, "save_scenario_overrides") as mock_save:
            get_response = self.client.get("/api/scenario/overrides?scope_key=2026Q2")
            post_response = self.client.post(
                "/api/scenario/overrides",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"scope_key": "2026Q2", "overrides": {}, "name": "Synthetic"},
            )

        self.assertEqual(get_response.status_code, 200, get_response.get_data(as_text=True))
        self.assertEqual(get_response.get_json()["overrides"], {"PROD-1": {"start": "2026-04-01"}})
        self.assertEqual(post_response.status_code, 200, post_response.get_data(as_text=True))
        mock_save.assert_called_once()

    def test_unmigrated_epm_home_routes_stay_guarded(self):
        routes = [
            ("GET", "/api/epm/scope"),
            ("GET", "/api/epm/goals"),
            ("GET", "/api/epm/projects"),
            ("POST", "/api/epm/projects/configuration"),
            ("POST", "/api/epm/projects/preview"),
            ("GET", "/api/epm/projects/rollup/all"),
            ("GET", "/api/epm/projects/home-1/issues"),
            ("GET", "/api/epm/projects/project-1/rollup"),
        ]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            for method, path in routes:
                response = self.client.open(path, method=method, json={} if method == "POST" else None)

                self.assertEqual(response.status_code, 501, path)
                self.assertEqual(response.get_json()["error"], "route_not_oauth_ready", path)


class BasicStatsRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def test_sprints_basic_uses_jira_url_basic_auth_without_csrf_header(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {
                "values": [{"id": 42, "name": "2026Q2", "state": "active", "originBoardId": 42}],
                "isLast": True,
            })

        expected_token = base64.b64encode(b"basic@example.com:api-token").decode("ascii")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "JIRA_URL", "https://basic.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "basic@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "api-token"), \
             patch.object(jira_server, "get_effective_board_id", return_value="42"), \
             patch.object(jira_server, "save_sprints_cache"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get), \
             patch("jira_server.requests.get", side_effect=fake_get):
            response = self.client.get("/api/sprints?refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(calls[0][0], "https://basic.atlassian.net/rest/agile/1.0/board/42/sprint")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], f"Basic {expected_token}")

    def test_scenario_basic_mode_does_not_require_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "fetch_issues_by_jql", return_value=[]), \
             patch.object(jira_server, "collect_dependencies", return_value={}), \
             patch.object(jira_server, "fetch_capacity_team_sizes", return_value=({}, {})):
            response = self.client.post(
                "/api/scenario",
                json={"filters": {"sprint": "2026Q2"}, "config": {}},
            )

        self.assertNotEqual(response.status_code, 403)

    def test_stats_burnout_post_basic_mode_does_not_require_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "fetch_burnout_events_for_sprint", return_value=({"events": []}, None, {})):
            response = self.client.post("/api/stats/burnout", json={"sprint": "2026Q2"})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_epic_cohort_post_basic_mode_does_not_require_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "jira_home_process_cache_enabled", return_value=False), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "fetch_epic_cohort_data", return_value=({"quarters": []}, None)):
            response = self.client.post("/api/stats/epic-cohort", json={"startQuarter": "2026Q2"})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_scenario_overrides_basic_mode_does_not_require_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "load_scenario_overrides", return_value={"scenarios": {}}), \
             patch.object(jira_server, "save_scenario_overrides"):
            response = self.client.post(
                "/api/scenario/overrides",
                json={"scope_key": "2026Q2", "overrides": {}, "name": "Synthetic"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
