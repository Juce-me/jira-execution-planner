import unittest
from unittest.mock import patch

import jira_server
from backend.db import engine as db_engine, models
from tests.oauth_test_helpers import install_oauth_session, set_up_db_oauth



class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthSettingsRouteTests(unittest.TestCase):
    def setUp(self):
        set_up_db_oauth(self)
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()
        self.session_payload = install_oauth_session(self.client, site_url="https://oauth-site.atlassian.net")

    def tearDown(self):
        jira_server.PROJECTS_CACHE.update({"data": None, "timestamp": 0})
        jira_server.COMPONENTS_CACHE.update({"data": None, "timestamp": 0})
        jira_server.EPICS_SEARCH_CACHE.clear()
        jira_server.LABELS_CACHE.update({"data": None, "timestamp": 0})
        jira_server.ISSUE_TYPES_CACHE.update({"data": None, "timestamp": 0})

    def db_identity(self, db):
        browser = db.get(models.BrowserSession, self.session_payload['db_browser_session_id'])
        return browser.user_id, browser.workspace_id

    def save_workspace_config(self, payload):
        with db_engine.session_scope() as db:
            user_id, workspace_id = self.db_identity(db)
            db.add(models.WorkspaceDashboardConfig(workspace_id=workspace_id, payload=payload,
                                                   created_by=user_id, updated_by=user_id))

    def test_config_is_oauth_ready_and_uses_session_site_url(self):
        with patch.object(jira_server, 'JIRA_URL', 'https://other-site.atlassian.net'):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['jiraUrl'], 'https://oauth-site.atlassian.net')
        self.assertEqual(response.get_json()['authMode'], 'atlassian_oauth')

    def test_config_rejects_retired_basic_auth_profile(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'load_dashboard_config', side_effect=AssertionError('route reached')):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'runtime_auth_unsupported')

    def test_config_non_admin_cannot_gain_settings_access_from_obsolete_environment_grant(self):
        with patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True), \
             patch.dict('os.environ', {'TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS': 'account-123'}, clear=False):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertFalse(response.get_json()['userCanEditSettings'])

    def test_config_reports_environment_config_exists_from_workspace_db(self):
        self.save_workspace_config({'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
                                    'board': {'boardId': '7', 'boardName': 'Product'}})
        response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.get_json()['environmentConfigExists'])

    def test_config_reports_environment_config_missing_for_private_view_and_groups_only(self):
        with db_engine.session_scope() as db:
            user_id, workspace_id = self.db_identity(db)
            db.add(models.ViewConfig(workspace_id=workspace_id, owner_user_id=user_id,
                                     name='Private view', view_type='mixed', is_default=True,
                                     payload={'epm': {'viewEnabled': False}}))
            db.add(models.WorkspaceGroupConfig(workspace_id=workspace_id,
                payload={'version': 2, 'groups': [{'id': 'g1', 'name': 'Group 1', 'teamIds': []}],
                         'defaultGroupId': 'g1'}))
        response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertFalse(response.get_json()['environmentConfigExists'])

    def test_config_reports_tool_admin_settings_access_from_db_role(self):
        self.session_payload = install_oauth_session(self.client, account_id='tool-admin-account',
            site_url='https://oauth-site.atlassian.net', roles=('admin',))
        with patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.get_json()['userCanEditSettings'])
        self.assertTrue(response.get_json()['adminUserManagementAvailable'])

    def test_obsolete_version_route_is_removed(self):
        self.assertNotIn('/api/version', {rule.rule for rule in jira_server.app.url_map.iter_rules()})

    def test_local_config_get_routes_are_oauth_ready(self):
        routes = [
            "/api/groups-config",
            "/api/team-catalog",
            "/api/projects/selected",
            "/api/capacity/config",
            "/api/board-config",
            "/api/sprint-field/config",
            "/api/story-points-field/config",
            "/api/parent-name-field/config",
            "/api/team-field/config",
            "/api/stats/priority-weights-config",
            "/api/issue-types/config",
            "/api/epm/config",
        ]
        for route in routes:
            with self.subTest(route=route):
                response = self.client.get(route)
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_projects_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": [{"key": "PROD", "name": "Product", "id": "100"}],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/projects?refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["projects"][0]["key"], "PROD")
        mock_get.assert_called_once_with(
            "/rest/api/3/project/search",
            params={"startAt": 0, "maxResults": 200, "orderBy": "key"},
            timeout=15,
        )

    def test_projects_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/projects?refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_boards_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": [{"id": 7, "name": "Product board", "type": "scrum"}],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/boards?limit=1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["boards"][0]["id"], 7)
        mock_get.assert_called_once_with(
            "/rest/agile/1.0/board",
            params={"maxResults": 100, "startAt": 0},
            timeout=30,
        )

    def test_components_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_selected_projects", return_value=["PROD"]), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, [
                 {"id": "11", "name": "API"}
             ])) as mock_get:
            response = self.client.get("/api/components?query=api")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["components"][0]["name"], "API")
        mock_get.assert_called_once_with("/rest/api/3/project/PROD/components", timeout=10)

    def test_epics_search_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_selected_projects", return_value=["PROD"]), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [{
                     "key": "PROD-1",
                     "fields": {
                         "summary": "Synthetic epic",
                         "status": {"name": "To Do"},
                         "project": {"key": "PROD"},
                         "issuetype": {"name": "Epic"},
                     },
                 }]
             })) as mock_search:
            response = self.client.get("/api/epics/search?query=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["epics"][0]["key"], "PROD-1")
        mock_search.assert_called_once()

    def test_labels_route_bypasses_process_cache_for_oauth(self):
        jira_server.LABELS_CACHE.update({"data": ["cached"], "timestamp": 9999999999})
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": ["fresh"],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/jira/labels")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["labels"], ["fresh"])
        mock_get.assert_called_once()

    def test_issue_types_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, [
                 {"name": "Story", "subtask": False, "iconUrl": "https://example/icon.svg"}
             ])) as mock_get:
            response = self.client.get("/api/issue-types")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issueTypes"][0]["name"], "Story")
        mock_get.assert_called_once_with("/rest/api/3/issuetype", timeout=15)

    def test_fields_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, [
                 {"id": "customfield_10004", "name": "Story Points", "custom": True}
             ])) as mock_get:
            response = self.client.get("/api/fields")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["fields"][0]["id"], "customfield_10004")
        mock_get.assert_called_once_with("/rest/api/3/field", timeout=15)

    def test_board_statuses_route_reads_epic_workflows_from_selected_projects(self):
        calls = []
        responses = [
            FakeResponse(200, [
                {"id": "100", "name": "Epic", "statuses": [
                    {"id": "1", "name": "To Do"},
                    {"id": "2", "name": "In Progress"},
                ]},
                {"id": "101", "name": "Story", "statuses": [
                    {"id": "3", "name": "Story Review"},
                ]},
            ]),
            FakeResponse(200, [
                {"id": "200", "name": "Epic", "statuses": [
                    {"id": "2", "name": "In Progress"},
                    {"id": "4", "name": "Done"},
                ]},
            ]),
        ]

        def fake_get(path, **kwargs):
            calls.append((path, kwargs.get("context")))
            return responses[len(calls) - 1]

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7", "boardName": "Delivery", "source": "config"}), \
             patch.object(jira_server, "get_selected_projects", return_value=["PROJ", "TECH"]), \
             patch.object(jira_server, "current_jira_get", side_effect=fake_get), \
             patch.object(jira_server, "current_jira_request", side_effect=AssertionError("must not load the global status catalog")):
            response = self.client.get("/api/board-config/statuses?boardId=999")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([path for path, _context in calls], [
            '/rest/api/3/project/PROJ/statuses', '/rest/api/3/project/TECH/statuses',
        ])
        with db_engine.session_scope() as db:
            user_id, workspace_id = self.db_identity(db)
        for _path, context in calls:
            self.assertEqual(context.user_id, user_id)
            self.assertEqual(context.workspace_id, workspace_id)
            self.assertEqual(context.browser_session_id, self.session_payload['db_browser_session_id'])
            self.assertEqual(context.site_url, 'https://oauth-site.atlassian.net')
        self.assertEqual(response.get_json(), {
            "boardId": "7",
            "projectKeys": ["PROJ", "TECH"],
            "statuses": [
                {"id": "1", "name": "To Do"},
                {"id": "2", "name": "In Progress"},
                {"id": "4", "name": "Done"},
            ],
        })

    def test_board_statuses_route_does_not_require_board_project_location(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7"}), \
             patch.object(jira_server, "get_selected_projects", return_value=["PROJ"]), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, [
                 {"id": "100", "name": "Epic", "statuses": [{"id": "1", "name": "To Do"}]},
             ])):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["statuses"], [{"id": "1", "name": "To Do"}])

    def test_board_statuses_route_distinguishes_board_without_a_project(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7"}), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {"id": 7, "location": {}})):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "board_project_unavailable")

    def test_board_statuses_route_distinguishes_forbidden_board_read(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7"}), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(403, {})):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "board_statuses_forbidden")
        self.assertNotIn("configuration", response.get_json()["message"].lower())

    def test_board_statuses_route_distinguishes_forbidden_project_status_read(self):
        responses = [
            FakeResponse(200, {"location": {"projectKey": "PROJ"}}),
            FakeResponse(403, {}),
        ]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7"}), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "current_jira_get", side_effect=responses):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "board_statuses_forbidden")
        self.assertNotIn("configuration", response.get_json()["message"].lower())

    def test_board_statuses_route_distinguishes_other_upstream_failure(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7"}), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(503, {})):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "board_statuses_fetch_failed")

    def test_board_statuses_route_distinguishes_empty_project_statuses(self):
        responses = [
            FakeResponse(200, {"location": {"projectKey": "PROJ"}}),
            FakeResponse(200, [{"id": "100", "name": "Story", "statuses": []}]),
        ]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7"}), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "current_jira_get", side_effect=responses):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "board_statuses_unavailable")
        self.assertNotIn("statuses", response.get_json())

    def test_board_statuses_route_preserves_auth_error_handling(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7"}), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "current_jira_get", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_board_statuses_route_requires_configured_board(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "", "boardName": "", "source": "default"}), \
             patch.object(jira_server, "current_jira_get", side_effect=AssertionError("must not call Jira without a configured board")):
            response = self.client.get("/api/board-config/statuses")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "no_board_configured")

    def test_local_config_post_requires_csrf_header_in_oauth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/board-config", json={"boardId": "7"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")


class RetiredBasicSettingsRouteTests(unittest.TestCase):
    def setUp(self):
        set_up_db_oauth(self)
        jira_server.app.config['TESTING'] = True
        self.client = jira_server.app.test_client()

    def test_projects_basic_profile_is_rejected_before_jira_io(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('Jira reached')):
            response = self.client.get('/api/projects?refresh=true')
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'runtime_auth_unsupported')

    def test_board_post_basic_profile_is_rejected_before_config_io(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'save_dashboard_config', side_effect=AssertionError('config reached')):
            response = self.client.post('/api/board-config', json={'boardId': '7', 'boardName': 'Product'})
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'runtime_auth_unsupported')
