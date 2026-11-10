import os
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.auth.cache_policy import build_jira_home_process_cache_key
from backend.auth.context import ProjectAccessSnapshot
from backend.auth.db_context import is_db_auth_context
from backend.db import engine as db_engine
from backend.db import models
from backend.routes import eng_routes
from backend.services.jira_issue_priorities import IssuePriorityServiceError
from backend.services.jira_issue_project_track import ProjectTrackServiceError
from backend.services.jira_issue_transitions import IssueTransitionServiceError
import jira_server
from tests.oauth_test_helpers import install_oauth_session
from tests.postgres_test_db import fresh_database_url


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


def _synthetic_issue():
    return {
        "id": "10001",
        "key": "PROD-1",
        "fields": {
            "summary": "Synthetic task",
            "status": {"name": "To Do"},
            "priority": {"name": "Major"},
            "issuetype": {"name": "Story"},
            "assignee": {"displayName": "Synthetic Owner"},
            "updated": "2026-05-01T00:00:00.000+0000",
            "customfield_sp": 3,
            "customfield_sprint": [{"id": 42, "name": "2026Q2"}],
            "customfield_team": {"id": "team-alpha", "name": "Alpha Team"},
            "parent": {},
            "project": {"key": "PROD", "name": "Product"},
        },
    }


def _synthetic_epic():
    return {
        "id": "20001",
        "key": "PROD-EPIC",
        "fields": {
            "summary": "Synthetic epic",
            "status": {"name": "To Do"},
            "assignee": {"displayName": "Synthetic Owner"},
            "labels": [],
            "customfield_team": {"id": "team-alpha", "name": "Alpha Team"},
            "customfield_sprint": [{"id": 42, "name": "2026Q2"}],
        },
    }


class DbOAuthFixture:
    def _setup_db(self):
        from backend.auth.db_context import invalidate_auth_status_cache
        self.database_url = fresh_database_url(self.addCleanup)
        self._env_patcher = patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
            'TEST_DATABASE_URL': self.database_url, 'WORK_CONFIGURATIONS_ENABLED': 'false',
        })
        self._env_patcher.start()
        self.addCleanup(self._env_patcher.stop)
        for name, value in [('JIRA_AUTH_MODE', 'atlassian_oauth'), ('JIRA_URL', 'https://example.atlassian.net')]:
            patcher = patch.object(jira_server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(db_engine.dispose_engines)
        self.addCleanup(invalidate_auth_status_cache)
        self.client = jira_server.app.test_client()
        install_oauth_session(self.client)

    def _auth_context(self, *, project_access=None):
        from flask import session as cookie
        from backend.auth.db_context import invalidate_auth_status_cache
        with self.client.session_transaction() as stored:
            payload = dict(stored['db_oauth_session'])
        with jira_server.app.test_request_context('/'):
            cookie['db_oauth_session'] = payload
            context = jira_server.current_request_auth_context()
        if project_access is not None:
            with db_engine.session_scope() as db:
                for entry in project_access:
                    db.add(models.JiraProjectAccess(connection_id=context.auth_connection_id,
                        workspace_id=context.workspace_id, project_key=entry.project_key,
                        project_type=entry.project_type, status=entry.status))
            invalidate_auth_status_cache()
            return self._auth_context()
        return context


class OAuthEngRouteTests(DbOAuthFixture, unittest.TestCase):
    def test_story_readiness_team_catalog_unwraps_the_persisted_catalog_envelope(self):
        context = self._auth_context()
        team_id = '2100282b-b1ef-408f-b668-c27d1a302d11'
        envelope = {
            'catalog': {
                team_id: {'id': team_id, 'name': 'Orbit'},
            },
            'meta': {'source': 'synthetic'},
        }

        with db_engine.session_scope() as db:
            db.add(models.WorkspaceTeamCatalog(workspace_id=context.workspace_id, payload=envelope))
        catalog = eng_routes._story_readiness_team_catalog(context)

        self.assertEqual(catalog[team_id]['name'], 'Orbit')

    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._setup_db()

    def tearDown(self):
        jira_server.TASKS_CACHE.clear()
        if hasattr(jira_server, "MISSING_INFO_CACHE"):
            jira_server.MISSING_INFO_CACHE.clear()
        if hasattr(jira_server, "DEPENDENCIES_CACHE"):
            jira_server.DEPENDENCIES_CACHE.clear()

    def test_tasks_route_is_oauth_ready(self):
        issue = _synthetic_issue()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [issue],
                 "names": {"customfield_team": "Team[Team]"},
                 "isLast": True,
             })) as mock_search, \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}):
            response = self.client.get("/api/tasks?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["key"], "PROD-1")
        mock_search.assert_called()

    def test_tasks_with_team_name_is_oauth_ready(self):
        issue = _synthetic_issue()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [issue],
                 "names": {"customfield_team": "Team[Team]"},
                 "isLast": True,
             })) as mock_search, \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["key"], "PROD-1")
        mock_search.assert_called()

    def test_tasks_with_team_name_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "current_jira_search", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_tasks_with_team_name_stale_oauth_returns_reconnect_payload(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=jira_server.AuthError("auth_connection_stale", "Your Jira connection changed. Reconnect to continue.")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "auth_connection_stale")
        self.assertEqual(body["message"], "Your Jira connection changed. Reconnect to continue.")
        self.assertEqual(body["recoveryUrl"], "/auth/reconnect")

    def test_story_readiness_worker_receives_captured_oauth_context(self):
        context = self._auth_context(
            project_access=(
                ProjectAccessSnapshot('PROD', 'product', 'accessible'),
                ProjectAccessSnapshot('TECH', 'tech', 'accessible'),
            ),
        )
        groups = {
            'configRevision': 2,
            'groups': [{
                'id': 'dept', 'teamIds': ['team-a'],
                'teamLabels': {'team-a': 'team_alpha'},
            }],
        }
        config = {'projects': {'selected': [
            {'key': 'PROD', 'type': 'product'}, {'key': 'TECH', 'type': 'tech'},
        ]}}
        payload = {
            'schemaVersion': 1,
            'scope': {'groupId': 'dept', 'groupRevision': 2, 'sprintId': '42',
                      'sprintName': 'Sprint 42', 'sprintState': 'active'},
            'complete': True,
            'epics': [],
        }

        def compute(captured, *_args):
            self.assertEqual(captured, context)
            return payload, 'total;dur=1.0'

        with eng_routes._STORY_READINESS_LOCK:
            eng_routes._STORY_READINESS_CACHE.clear()
            eng_routes._STORY_READINESS_INFLIGHT.clear()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(eng_routes, '_story_readiness_dashboard_snapshot', return_value=SimpleNamespace(
                 payload=config, config_revision=4)), \
             patch.object(eng_routes, '_story_readiness_effective_groups', return_value=groups), \
             patch.object(eng_routes, '_story_readiness_team_catalog', return_value={
                 'team-a': {'id': 'team-a', 'name': 'Alpha'}}), \
             patch.object(jira_server, 'get_jira_issue_cache_generation', return_value=1), \
             patch.object(eng_routes, '_story_readiness_compute', side_effect=compute):
            response = self.client.get(
                '/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept'
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.get_json()['complete'])

    def test_story_readiness_allows_absent_access_snapshots_for_configured_projects(self):
        context = self._auth_context()
        groups = {
            'configRevision': 2,
            'groups': [{
                'id': 'dept', 'teamIds': ['team-a'],
                'teamLabels': {'team-a': 'team_alpha'},
            }],
        }
        config = {'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]}}
        payload = {
            'schemaVersion': 1,
            'scope': {'groupId': 'dept', 'groupRevision': 2, 'sprintId': '42',
                      'sprintName': 'Sprint 42', 'sprintState': 'active'},
            'complete': True,
            'epics': [],
        }

        with eng_routes._STORY_READINESS_LOCK:
            eng_routes._STORY_READINESS_CACHE.clear()
            eng_routes._STORY_READINESS_INFLIGHT.clear()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(eng_routes, '_story_readiness_dashboard_snapshot', return_value=SimpleNamespace(
                 payload=config, config_revision=4)), \
             patch.object(eng_routes, '_story_readiness_effective_groups', return_value=groups), \
             patch.object(eng_routes, '_story_readiness_team_catalog', return_value={
                 'team-a': {'id': 'team-a', 'name': 'Alpha'}}), \
             patch.object(jira_server, 'get_jira_issue_cache_generation', return_value=1), \
             patch.object(eng_routes, '_story_readiness_compute', return_value=(payload, 'total;dur=1.0')) as compute:
            response = self.client.get(
                '/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept'
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        compute.assert_called_once()

    def test_story_readiness_checks_only_configured_project_types(self):
        context = self._auth_context(
            project_access=(ProjectAccessSnapshot('TECH', 'tech', 'unknown'),),
        )
        groups = {
            'configRevision': 2,
            'groups': [{
                'id': 'dept', 'teamIds': ['team-a'],
                'teamLabels': {'team-a': 'team_alpha'},
            }],
        }
        config = {'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]}}
        payload = {
            'schemaVersion': 1,
            'scope': {'groupId': 'dept', 'groupRevision': 2, 'sprintId': '42',
                      'sprintName': 'Sprint 42', 'sprintState': 'active'},
            'complete': True,
            'epics': [],
        }

        with eng_routes._STORY_READINESS_LOCK:
            eng_routes._STORY_READINESS_CACHE.clear()
            eng_routes._STORY_READINESS_INFLIGHT.clear()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(eng_routes, '_story_readiness_dashboard_snapshot', return_value=SimpleNamespace(
                 payload=config, config_revision=4)), \
             patch.object(eng_routes, '_story_readiness_effective_groups', return_value=groups), \
             patch.object(eng_routes, '_story_readiness_team_catalog', return_value={
                 'team-a': {'id': 'team-a', 'name': 'Alpha'}}), \
             patch.object(jira_server, 'get_jira_issue_cache_generation', return_value=1), \
             patch.object(eng_routes, '_story_readiness_compute', return_value=(payload, 'total;dur=1.0')) as compute:
            response = self.client.get(
                '/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept'
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        compute.assert_called_once()

    def test_story_readiness_denies_explicit_unknown_for_configured_project_type(self):
        context = self._auth_context(
            project_access=(ProjectAccessSnapshot('PROD', 'product', 'unknown'),),
        )
        config = {'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]}}

        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(eng_routes, '_story_readiness_dashboard_snapshot', return_value=SimpleNamespace(
                 payload=config, config_revision=4)), \
             patch.object(eng_routes, '_story_readiness_compute') as compute:
            response = self.client.get(
                '/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept'
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['projectAccessStatus'], 'unknown')
        compute.assert_not_called()

    def test_story_readiness_denies_explicit_inaccessible_for_configured_project_type(self):
        context = self._auth_context(
            project_access=(ProjectAccessSnapshot('PROD', 'product', 'inaccessible'),),
        )
        config = {'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]}}

        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(eng_routes, '_story_readiness_dashboard_snapshot', return_value=SimpleNamespace(
                 payload=config, config_revision=4)), \
             patch.object(eng_routes, '_story_readiness_compute') as compute:
            response = self.client.get(
                '/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept'
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['projectAccessStatus'], 'inaccessible')
        compute.assert_not_called()

    def test_story_readiness_reports_jira_failure_after_absent_snapshot_falls_through(self):
        context = self._auth_context()
        groups = {
            'configRevision': 2,
            'groups': [{
                'id': 'dept', 'teamIds': ['team-a'],
                'teamLabels': {'team-a': 'team_alpha'},
            }],
        }
        config = {'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]}}

        with eng_routes._STORY_READINESS_LOCK:
            eng_routes._STORY_READINESS_CACHE.clear()
            eng_routes._STORY_READINESS_INFLIGHT.clear()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(eng_routes, '_story_readiness_dashboard_snapshot', return_value=SimpleNamespace(
                 payload=config, config_revision=4)), \
             patch.object(eng_routes, '_story_readiness_effective_groups', return_value=groups), \
             patch.object(eng_routes, '_story_readiness_team_catalog', return_value={
                 'team-a': {'id': 'team-a', 'name': 'Alpha'}}), \
             patch.object(jira_server, 'get_jira_issue_cache_generation', return_value=1), \
             patch.object(eng_routes, '_story_readiness_compute', side_effect=RuntimeError('jira_unavailable')):
            response = self.client.get(
                '/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept'
            )

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'story_readiness_unavailable')

    def test_tasks_with_team_name_uses_oauth_partitioned_cache(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = self._auth_context()
        raw_key = jira_server.build_tasks_cache_key(
            "2026Q2",
            "default",
            "all",
            [],
            [],
            True,
            False,
            "dashboard",
            [],
            sprint_name="",
        )
        partitioned_key = build_jira_home_process_cache_key(auth_context, raw_key)
        jira_server.TASKS_CACHE[raw_key] = {
            "timestamp": time.time(),
            "data": {"issues": [{"key": "OTHER-1"}]},
        }
        jira_server.TASKS_CACHE[partitioned_key] = {
            "timestamp": time.time(),
            "data": {"issues": [{"key": "PROD-1"}]},
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=AssertionError("cache hit should not resolve Jira fields")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"issues": [{"key": "PROD-1"}]})
        self.assertRegex(response.headers.get("Server-Timing"), r"^cache;dur=1, groups;dur=[0-9.]+$")

    def _seed_db_group_row(self, database_url, team_labels):
        models.Base.metadata.create_all(db_engine.get_engine(database_url))
        factory = db_engine.session_factory(database_url)
        with factory() as session:
            workspace = session.get(models.Workspace, self._auth_context().workspace_id)
            row = models.WorkspaceGroupConfig(
                workspace_id=workspace.id, payload_version=1, config_revision=1,
                payload={"version": 1, "defaultGroupId": "department-a", "groups": [{
                    "id": "department-a", "name": "Department A", "teamIds": ["team-a"],
                    "teamLabels": team_labels,
                }]},
            )
            session.add(row)
            session.commit()
            return workspace.id, row.id, factory

    def test_tasks_route_reads_saved_aliases_from_workspace_group_configs_for_cache_and_jql(self):
        database_url = self.database_url
        workspace_id, row_id, factory = self._seed_db_group_row(database_url, {"team-a": "label_team_a"})
        db_context = self._auth_context()
        self.assertTrue(is_db_auth_context(db_context))
        epic_jqls = []

        def fake_search(payload, *args, **kwargs):
            jql = payload.get("jql", "")
            if 'type = "Epic"' in jql:
                epic_jqls.append(jql)
                return FakeResponse(200, {"issues": [], "isLast": True})
            return FakeResponse(200, {"issues": [], "names": {"customfield_team": "Team[Team]"}, "isLast": True})

        dashboard = {"teamGroups": {"version": 2, "defaultGroupId": "department-a", "groups": [{
            "id": "department-a", "name": "Department A", "teamIds": ["team-a"],
            "teamLabels": {"team-a": ["label_from_dashboard"]},
        }]}}
        query = ("/api/tasks-with-team-name?sprint=42&sprintName=2026Q2&project=all&purpose=alerts"
                 "&groupId=department-a&teamIds=team-a&teamLabels=label_team_a")
        with patch.dict(os.environ, {"DATABASE_URL": database_url}, clear=False), \
             patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=db_context), \
             patch.object(jira_server, "jira_home_partitioned_process_cache_enabled", return_value=True), \
             patch.object(jira_server, "load_dashboard_config", return_value=dashboard), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROJ"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=["Story"]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}), \
             patch.object(jira_server, "jira_search_request", side_effect=fake_search):
            first = self.client.get(query)
            with factory() as session:
                row = session.get(models.WorkspaceGroupConfig, row_id)
                row.payload = dict(row.payload, groups=[dict(row.payload["groups"][0], teamLabels={
                    "team-a": ["label_team_a", "label_team_b"]})])
                row.config_revision = 2
                session.commit()
            second = self.client.get(query)
            third = self.client.get(query)

        for response in (first, second, third):
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(len(epic_jqls), 2, "identical saved aliases must hit the cache")
        self.assertIn('labels = "label_team_a"', epic_jqls[0])
        self.assertIn('labels in ("label_team_a", "label_team_b")', epic_jqls[1])
        self.assertTrue(all("label_from_dashboard" not in jql for jql in epic_jqls))
        self.assertRegex(third.headers["Server-Timing"], r"^cache;dur=1, groups;dur=[0-9.]+$")

    def test_tasks_with_team_name_keeps_oauth_context_for_epic_enrichment(self):
        main_thread_id = threading.get_ident()
        calls = []
        story = _synthetic_issue()
        story["fields"]["customfield_epic"] = "PROD-EPIC"
        epic = _synthetic_epic()

        def fake_search(payload, *args, **kwargs):
            if threading.get_ident() != main_thread_id:
                raise jira_server.AuthError("auth_required", "Atlassian authentication is required.")
            calls.append(payload.get("jql", ""))
            jql = payload.get("jql", "")
            if "Sprint = 2026Q2" in jql and "type" not in jql.lower() and "issuetype" not in jql.lower():
                return FakeResponse(200, {
                    "issues": [story],
                    "names": {
                        "customfield_team": "Team[Team]",
                        "customfield_epic": "Epic Link",
                    },
                    "isLast": True,
                })
            if "issueKey in" in jql:
                return FakeResponse(200, {"issues": [epic], "isLast": True})
            if "type = Epic" in jql or "issuetype = Epic" in jql:
                return FakeResponse(200, {"issues": [epic], "isLast": True})
            return FakeResponse(200, {"issues": [], "isLast": True})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value="customfield_epic"), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["fields"]["epicKey"], "PROD-EPIC")
        self.assertTrue(any("issueKey in" in jql for jql in calls))
        self.assertTrue(any("type = Epic" in jql for jql in calls))

    def test_missing_info_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [], "isLast": True})) as mock_search:
            response = self.client.get("/api/missing-info?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"], [])
        mock_search.assert_called()

    def test_missing_info_stale_oauth_returns_reconnect_payload(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=jira_server.AuthError("auth_connection_stale", "Your Jira connection changed. Reconnect to continue.")):
            response = self.client.get("/api/missing-info?sprint=2026Q2")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "auth_connection_stale")
        self.assertEqual(body["message"], "Your Jira connection changed. Reconnect to continue.")
        self.assertEqual(body["recoveryUrl"], "/auth/reconnect")

    def test_missing_info_uses_oauth_partitioned_cache_and_timing(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = self._auth_context()
        if not hasattr(jira_server, "MISSING_INFO_CACHE"):
            jira_server.MISSING_INFO_CACHE = {}
        cache_key = build_jira_home_process_cache_key(
            auth_context,
            "missing-info",
            "2026Q2",
            "team-alpha",
            "Comp A",
        )
        jira_server.MISSING_INFO_CACHE[cache_key] = {
            "timestamp": time.time(),
            "data": {"issues": [{"key": "PROD-1"}], "epics": [], "count": 1},
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=AssertionError("cache hit should not resolve Jira fields")):
            response = self.client.get("/api/missing-info?sprint=2026Q2&teamIds=team-alpha&components=Comp%20A")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"issues": [{"key": "PROD-1"}], "epics": [], "count": 1})
        self.assertEqual(response.headers.get("Server-Timing"), "cache;dur=1")

    def _missing_info_search(self, calls):
        def fake_search(payload, *args, **kwargs):
            jql = payload["jql"]
            calls.append(jql)
            if "issuetype = Epic" in jql:
                keys = [key for key in ("PROD-5", "PROD-6") if f'"{key}"' in jql or "issueKey in" not in jql]
                return FakeResponse(200, {
                    "issues": [{"key": key, "fields": {"summary": key, "status": {"name": "To Do"}}} for key in keys],
                    "isLast": True,
                })
            return FakeResponse(200, {"issues": [], "isLast": True})
        return fake_search

    def _missing_info_patches(self, calls):
        return (
            patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"),
            patch.object(jira_server, "database_storage_enabled", return_value=True),
            patch.object(jira_server, "resolve_team_field_id", return_value=None),
            patch.object(jira_server, "resolve_epic_link_field_id", return_value=None),
            patch.object(jira_server, "current_jira_search", side_effect=self._missing_info_search(calls)),
        )

    def test_missing_info_epic_keys_scopes_epic_query_and_keeps_other_scope(self):
        calls = []
        patches = self._missing_info_patches(calls)
        with patches[0], patches[1], patches[2], patches[3], patches[4], \
             patch.dict(jira_server.MISSING_INFO_CACHE, {}, clear=True):
            response = self.client.get(
                "/api/missing-info?sprint=2026Q2&teamIds=team-alpha&components=Comp%20A&epicKeys=PROD-5")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        epic_jql = calls[0]
        self.assertIn('issueKey in ("PROD-5")', epic_jql)
        self.assertIn("Sprint = 2026Q2", epic_jql)
        self.assertIn("issuetype = Epic", epic_jql)
        self.assertIn("Comp A", epic_jql)
        self.assertIn("team-alpha", epic_jql)
        self.assertIn('status not in ("Killed","Done","Incomplete")', epic_jql)
        self.assertIn("project in (", epic_jql)
        self.assertEqual([epic["key"] for epic in response.get_json()["epics"]], ["PROD-5"])

    def test_missing_info_without_epic_keys_has_no_issue_key_clause(self):
        calls = []
        patches = self._missing_info_patches(calls)
        with patches[0], patches[1], patches[2], patches[3], patches[4], \
             patch.dict(jira_server.MISSING_INFO_CACHE, {}, clear=True):
            response = self.client.get("/api/missing-info?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertNotIn("issueKey", calls[0])

    def test_missing_info_rejects_bad_or_multiple_epic_keys(self):
        for value in ("not-a-key", "PROD-1,PROD-2"):
            with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
                 patch.object(jira_server, "current_jira_search", side_effect=AssertionError("must not query Jira")):
                response = self.client.get(f"/api/missing-info?sprint=2026Q2&epicKeys={value}")
            self.assertEqual(response.status_code, 400, value)
            self.assertEqual(response.get_json()["error"], "invalid_epic_keys")

    def test_missing_info_cache_key_gains_epic_key_only_when_present(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = self._auth_context()
        base = build_jira_home_process_cache_key(auth_context, "missing-info", "2026Q2", "", "")
        scoped = build_jira_home_process_cache_key(auth_context, "missing-info", "2026Q2", "", "", "PROD-5")
        calls = []
        cache = jira_server.MISSING_INFO_CACHE
        patches = self._missing_info_patches(calls)
        with patches[0], patches[1], patches[2], patches[3], patches[4], \
             patch.dict(cache, {}, clear=True):
            self.client.get("/api/missing-info?sprint=2026Q2&epicKeys=PROD-5")
            self.assertEqual(list(cache), [scoped])
            full = self.client.get("/api/missing-info?sprint=2026Q2")
            cached_keys = set(cache)

        self.assertEqual(full.status_code, 200, full.get_data(as_text=True))
        self.assertEqual(cached_keys, {base, scoped})
        self.assertEqual(len(calls), 4, "the full-scope call must not be served from the per-epic entry")
        self.assertIn("issueKey", calls[0])
        self.assertNotIn("issueKey", calls[2])
        self.assertEqual([epic["key"] for epic in full.get_json()["epics"]], ["PROD-5", "PROD-6"])

    def test_missing_info_refresh_true_bypasses_cache_read_and_rewrites_entry(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = self._auth_context()
        key = build_jira_home_process_cache_key(auth_context, "missing-info", "2026Q2", "", "")
        cache = jira_server.MISSING_INFO_CACHE
        seeded = {key: {"timestamp": time.time(), "data": {"issues": [], "epics": [], "count": 7}}}
        calls = []
        patches = self._missing_info_patches(calls)
        with patches[0], patches[1], patches[2], patches[3], patches[4], \
             patch.dict(cache, seeded, clear=True):
            cached = self.client.get("/api/missing-info?sprint=2026Q2")
            self.assertEqual(cached.get_json()["count"], 7)
            self.assertEqual(calls, [])
            fresh = self.client.get("/api/missing-info?sprint=2026Q2&refresh=true")
            rewritten_count = cache[key]["data"]["count"]

        self.assertEqual(fresh.status_code, 200, fresh.get_data(as_text=True))
        self.assertEqual(len(calls), 2)
        self.assertEqual(fresh.get_json()["count"], 0)
        self.assertEqual(rewritten_count, 0)

    def test_single_epic_alert_reads_use_no_write_or_service_credential_path(self):
        forbidden = AssertionError("a service-account or write credential path was touched")
        calls = []
        patches = self._missing_info_patches(calls)
        with patches[0], patches[1], patches[2], patches[3], patches[4], \
             patch.dict(jira_server.MISSING_INFO_CACHE, {}, clear=True), \
             patch("backend.auth.jira_auth.jira_request", side_effect=forbidden), \
             patch("backend.auth.jira_auth.jira_post", side_effect=forbidden), \
             patch.object(jira_server, "current_jira_request", side_effect=forbidden), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"):
            missing = self.client.get("/api/missing-info?sprint=2026Q2&epicKeys=PROD-5&refresh=true")
            backlog = self.client.get("/api/backlog-epics?project=all&epicKeys=PROD-5")

        self.assertEqual(missing.status_code, 200, missing.get_data(as_text=True))
        self.assertEqual(backlog.status_code, 200, backlog.get_data(as_text=True))
        self.assertIn("issueKey in", calls[0])
        self.assertTrue(any("issueKey in" in jql and "assignee is not EMPTY" in jql for jql in calls))

    def test_dependencies_requires_oauth_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/dependencies", json={"keys": ["PROD-1"]})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_dependencies_is_oauth_ready_with_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "collect_dependencies", return_value={"PROD-1": []}):
            response = self.client.post(
                "/api/dependencies",
                json={"keys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"dependencies": {"PROD-1": []}})

    def test_dependencies_uses_oauth_partitioned_cache_and_timing(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = self._auth_context()
        if not hasattr(jira_server, "DEPENDENCIES_CACHE"):
            jira_server.DEPENDENCIES_CACHE = {}
        cache_key = build_jira_home_process_cache_key(
            auth_context,
            "dependencies",
            "PROD-1,TECH-2",
        )
        jira_server.DEPENDENCIES_CACHE[cache_key] = {
            "timestamp": time.time(),
            "data": {"PROD-1": [{"key": "TECH-2"}]},
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "collect_dependencies", side_effect=AssertionError("cache hit should not query Jira")):
            response = self.client.post(
                "/api/dependencies",
                json={"keys": ["TECH-2", "PROD-1", "PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"dependencies": {"PROD-1": [{"key": "TECH-2"}]}})
        self.assertEqual(response.headers.get("Server-Timing"), "cache;dur=1")

    def test_dependencies_refresh_body_field_bypasses_cache_and_rewrites_entry(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = self._auth_context()
        cache_key = build_jira_home_process_cache_key(auth_context, "dependencies", "PROD-1")
        seeded = {cache_key: {"timestamp": time.time(), "data": {"PROD-1": [{"key": "TECH-2"}]}}}
        headers = {"X-Requested-With": "jira-execution-planner"}

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict(jira_server.DEPENDENCIES_CACHE, seeded, clear=True), \
             patch.object(jira_server, "collect_dependencies", return_value={"PROD-1": []}) as collect:
            cached = self.client.post("/api/dependencies", json={"keys": ["PROD-1"]}, headers=headers)
            collect.assert_not_called()
            fresh = self.client.post(
                "/api/dependencies", json={"keys": ["PROD-1"], "refresh": True}, headers=headers)
            rewritten = jira_server.DEPENDENCIES_CACHE[cache_key]["data"]

        self.assertEqual(cached.get_json(), {"dependencies": {"PROD-1": [{"key": "TECH-2"}]}})
        self.assertEqual(fresh.status_code, 200, fresh.get_data(as_text=True))
        self.assertEqual(fresh.get_json(), {"dependencies": {"PROD-1": []}})
        collect.assert_called_once()
        self.assertEqual(rewritten, {"PROD-1": []})

    def test_dependencies_rejects_malformed_keys_before_querying_jira(self):
        headers = {"X-Requested-With": "jira-execution-planner"}
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "collect_dependencies", side_effect=AssertionError("must not query Jira")):
            response = self.client.post(
                "/api/dependencies", json={"keys": ["PROD-1", "x) OR (y"]}, headers=headers)

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_keys")

    def test_dependencies_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "collect_dependencies", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.post(
                "/api/dependencies",
                json={"keys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_issue_lookup_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [_synthetic_issue()], "isLast": True})) as mock_search:
            response = self.client.get("/api/issues/lookup?ids=10001")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["key"], "PROD-1")
        mock_search.assert_called()

    def test_teams_db_catalog_rejects_quarter_name_before_jira(self):
        with patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('invalid catalog selector queried Jira')):
            response = self.client.get('/api/teams?sprint=2026Q2')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'invalid_sprint')

    def test_teams_resolve_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [_synthetic_issue()], "isLast": True})) as mock_search:
            response = self.client.get("/api/teams/resolve?teamIds=team-alpha")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["teams"][0]["id"], "team-alpha")
        mock_search.assert_called()

    def test_teams_all_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [_synthetic_issue()], "isLast": True})) as mock_search:
            response = self.client.get("/api/teams/all?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["teams"][0]["id"], "team-alpha")
        mock_search.assert_called()

    def test_teams_all_rejects_quarter_selector_without_project_scan_fallback(self):
        with patch.object(jira_server, 'jira_search_request', side_effect=AssertionError('project scan fallback called')), \
             patch.object(jira_server, 'fetch_teams_from_jira_api', side_effect=AssertionError('global team fallback called')):
            response = self.client.get('/api/teams?sprint=2026Q2&all=true')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'invalid_sprint')

    def test_backlog_epics_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "fetch_backlog_epics_for_alert", return_value=[{"key": "PROD-1"}]) as mock_fetch:
            response = self.client.get("/api/backlog-epics")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["epics"], [{"key": "PROD-1"}])
        mock_fetch.assert_called()


class IssueTransitionRouteTests(DbOAuthFixture, unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._setup_db()

    def _csrf_token(self):
        # Mint the token against the actual DB browser session before the POST.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/auth/csrf", headers={"X-Requested-With": "jira-execution-planner"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["csrfToken"]

    def test_transition_options_returns_statuses_in_oauth_mode(self):
        def fake_search(payload, *, context=None, timeout=30):
            return FakeResponse(200, {"issues": [
                {"key": "PROD-1", "fields": {"summary": "S", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
            ]})

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            self.assertEqual(method, "GET")
            return FakeResponse(200, {"transitions": [{"id": "11", "name": "Start Progress", "to": {"name": "In Progress"}}]})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request):
            response = self.client.post(
                "/api/issues/transitions/options",
                json={"issueKeys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["issues"], [{
            "key": "PROD-1",
            "issueType": "Story",
            "currentStatus": "To Do",
            "transitions": [{"name": "Start Progress", "toStatus": "In Progress"}],
        }])
        self.assertEqual(body["targetStatuses"], [{"name": "In Progress", "availableCount": 1, "blockedCount": 0}])

    def test_transition_options_requires_x_requested_with_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_transition_options", side_effect=AssertionError("route code reached")):
            response = self.client.post("/api/issues/transitions/options", json={"issueKeys": ["PROD-1"]})

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_transition_options_service_error_returns_sanitized_502(self):
        def fake_load_options(issue_keys, *, jira_request, search_request, context=None):
            raise IssueTransitionServiceError("issue_snapshot_fetch_failed", 503)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_transition_options", side_effect=fake_load_options):
            response = self.client.post(
                "/api/issues/transitions/options",
                json={"issueKeys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_transition_options_failed")

    def test_transitions_write_rejects_missing_x_requested_with_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("X-Requested-With", response.get_json()["message"])

    def test_transitions_write_rejects_missing_csrf_token_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("CSRF", response.get_json()["message"])

    def test_transitions_write_returns_missing_scope_before_jira_call_when_write_scope_absent(self):
        # A provider grant missing write:jira-work is rejected by actual DB
        # admission before the route can reach Jira.
        old_scope = (
            "read:me read:jira-work read:jira-user read:board-scope:jira-software "
            "read:sprint:jira-software read:project:jira offline_access"
        )
        csrf_token = self._csrf_token()
        install_oauth_session(self.client, scope=old_scope)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            with patch.object(eng_routes, "transition_issues", side_effect=AssertionError("must not resolve/post transitions")), \
                 patch.object(jira_server, "current_jira_request", side_effect=AssertionError("must not call Jira")), \
                 patch.object(jira_server, "current_jira_search", side_effect=AssertionError("must not call Jira")):
                response = self.client.post(
                    "/api/issues/transitions",
                    json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                    headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
                )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "auth_required")
        self.assertEqual(body["loginUrl"], "/login?reason=missing_scope")

    def test_transitions_write_uses_auth_context_and_forwards_to_service(self):
        sentinel_context = self._auth_context()
        captured = {}

        def fake_transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
            captured["context"] = context
            return {
                "requested": 1,
                "succeeded": 1,
                "failed": 0,
                "targetStatus": target_status,
                "results": [{"key": "PROD-1", "result": "success", "fromStatus": "To Do", "toStatus": target_status}],
            }

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(eng_routes, "transition_issues", side_effect=fake_transition_issues), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        mock_clear.assert_called_once()

    def test_transitions_write_does_not_call_build_jira_headers(self):
        def fake_search(payload, *, context=None, timeout=30):
            return FakeResponse(200, {"issues": [
                {"key": "PROD-1", "fields": {"summary": "S", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
            ]})

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            if method == "GET":
                return FakeResponse(200, {"transitions": [{"id": "11", "name": "Start Progress", "to": {"name": "Accepted"}}]})
            return FakeResponse(204, {})

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request), \
             patch.object(jira_server, "build_jira_headers", side_effect=AssertionError("build_jira_headers must not be called")), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["succeeded"], 1)
        mock_clear.assert_called_once()

    def test_transitions_write_does_not_clear_caches_when_nothing_succeeded(self):
        def fake_transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
            return {
                "requested": 1,
                "succeeded": 0,
                "failed": 1,
                "targetStatus": target_status,
                "results": [{"key": "PROD-1", "result": "failure", "error": "transition_not_available"}],
            }

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=fake_transition_issues), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_clear.assert_not_called()

    def test_transitions_write_maps_input_error_to_400(self):
        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": [], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "issue_keys_required")

    def test_transitions_write_invalid_json_body_returns_400(self):
        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/issues/transitions",
                data="not-json",
                content_type="application/json",
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_json")

    def test_transitions_write_service_error_returns_sanitized_502(self):
        def fake_transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
            raise IssueTransitionServiceError("issue_snapshot_fetch_failed", 503)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=fake_transition_issues):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_transition_failed")


class IssuePriorityRouteTests(DbOAuthFixture, unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._setup_db()

    def _csrf_token(self):
        # Mint the token against the actual DB browser session.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/auth/csrf", headers={"X-Requested-With": "jira-execution-planner"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["csrfToken"]

    def test_priority_options_route_uses_current_auth_context(self):
        sentinel_context = self._auth_context()
        captured = {}

        def fake_load_priority_options(*, jira_request, context=None):
            captured["context"] = context
            return {
                "priorities": [{"id": "3", "name": "Major", "statusColor": "#ffab00", "iconUrl": "", "rank": 10}],
                "source": "jira",
            }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(eng_routes, "load_priority_options", side_effect=fake_load_priority_options):
            response = self.client.get("/api/issues/priorities/options")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        body = response.get_json()
        self.assertEqual(body["source"], "jira")
        self.assertEqual(body["cached"], False)
        self.assertEqual(body["priorities"][0]["id"], "3")

    def test_priority_options_service_error_returns_sanitized_502(self):
        def fake_load_options(*, jira_request, context=None):
            raise IssuePriorityServiceError("priority_options_fetch_failed", 503)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_priority_options", side_effect=fake_load_options):
            response = self.client.get("/api/issues/priorities/options")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_priority_options_failed")

    def test_priority_options_route_with_issue_key_filters_via_editmeta(self):
        sentinel_context = self._auth_context()
        calls = []

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            calls.append({"method": method, "path": path, "context": context})
            if "editmeta" in path:
                return FakeResponse(200, {"fields": {"priority": {"allowedValues": [
                    {"id": "2", "name": "High"},
                    {"id": "4", "name": "Major"},
                ]}}})
            return FakeResponse(200, [
                {"id": "1", "name": "Highest", "statusColor": "#ff5630", "iconUrl": ""},
                {"id": "2", "name": "High", "statusColor": "#ff7452", "iconUrl": ""},
                {"id": "3", "name": "Medium", "statusColor": "#ffab00", "iconUrl": ""},
                {"id": "4", "name": "Major", "statusColor": "#f5cd47", "iconUrl": ""},
                {"id": "5", "name": "Low", "statusColor": "#2d8738", "iconUrl": ""},
            ])

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request):
            response = self.client.get("/api/issues/priorities/options?issueKey=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        # Site catalog filtered to the issue's editmeta allowed priorities, catalog order kept.
        self.assertEqual([p["id"] for p in body["priorities"]], ["2", "4"])
        self.assertEqual(body["cached"], False)
        editmeta_calls = [c for c in calls if "editmeta" in c["path"]]
        self.assertEqual(len(editmeta_calls), 1)
        self.assertEqual(editmeta_calls[0]["path"], "/rest/api/3/issue/PROD-1/editmeta")
        self.assertIs(editmeta_calls[0]["context"], sentinel_context)

    def test_priority_options_route_invalid_issue_key_returns_400(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_request", side_effect=AssertionError("must not call Jira for an invalid key")):
            response = self.client.get("/api/issues/priorities/options?issueKey=PROD")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_issue_key")

    def test_priority_options_route_editmeta_404_returns_issue_not_found(self):
        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            return FakeResponse(404, {"errorMessages": ["not found detail"]})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request):
            response = self.client.get("/api/issues/priorities/options?issueKey=PROD-999")

        self.assertEqual(response.status_code, 404, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "issue_not_found")

    def test_priority_options_route_without_issue_key_skips_editmeta(self):
        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            if "editmeta" in path:
                raise AssertionError("no-issueKey path must not call editmeta")
            return FakeResponse(200, [{"id": "3", "name": "Major", "statusColor": "#ffab00", "iconUrl": ""}])

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request):
            response = self.client.get("/api/issues/priorities/options")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([p["id"] for p in response.get_json()["priorities"]], ["3"])

    def test_priority_options_with_issue_key_does_not_call_build_jira_headers(self):
        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            if "editmeta" in path:
                return FakeResponse(200, {"fields": {"priority": {"allowedValues": [{"id": "3", "name": "Major"}]}}})
            return FakeResponse(200, [{"id": "3", "name": "Major", "statusColor": "#ffab00", "iconUrl": ""}])

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request), \
             patch.object(jira_server, "build_jira_headers", side_effect=AssertionError("build_jira_headers must not be called")):
            response = self.client.get("/api/issues/priorities/options?issueKey=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([p["id"] for p in response.get_json()["priorities"]], ["3"])

    def test_priority_write_rejects_missing_x_requested_with_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_priorities", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("X-Requested-With", response.get_json()["message"])

    def test_priority_write_rejects_missing_csrf_token_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_priorities", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("CSRF", response.get_json()["message"])

    def test_priority_write_returns_missing_scope_before_jira_call_when_write_scope_absent(self):
        # DB admission must reject the missing provider scope before Jira.
        old_scope = (
            "read:me read:jira-work read:jira-user read:board-scope:jira-software "
            "read:sprint:jira-software read:project:jira offline_access"
        )
        csrf_token = self._csrf_token()
        install_oauth_session(self.client, scope=old_scope)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            with patch.object(eng_routes, "update_issue_priorities", side_effect=AssertionError("must not resolve/post priorities")), \
                 patch.object(jira_server, "current_jira_request", side_effect=AssertionError("must not call Jira")), \
                 patch.object(jira_server, "current_jira_search", side_effect=AssertionError("must not call Jira")):
                response = self.client.post(
                    "/api/issues/priorities",
                    json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
                    headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
                )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "auth_required")
        self.assertEqual(body["loginUrl"], "/login?reason=missing_scope")

    def test_priority_write_uses_oauth_context_and_clears_caches_on_success(self):
        sentinel_context = self._auth_context()
        captured = {}

        def fake_update_issue_priorities(issue_keys, target_priority_id, *, jira_request, search_request, context=None):
            captured["context"] = context
            return {
                "requested": 1,
                "succeeded": 1,
                "failed": 0,
                "targetPriority": {"id": target_priority_id, "name": "Major"},
                "results": [{"key": "PROD-1", "result": "success", "fromPriority": "High", "toPriority": "Major"}],
            }

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(eng_routes, "update_issue_priorities", side_effect=fake_update_issue_priorities), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        mock_clear.assert_called_once_with(reason="issue_priority_update")

    def test_priority_write_does_not_call_build_jira_headers(self):
        def fake_search(payload, *, context=None, timeout=30):
            return FakeResponse(200, {"issues": [
                {"key": "PROD-1", "fields": {"priority": {"id": "2", "name": "High"}}},
            ]})

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            if method == "GET":
                return FakeResponse(200, [{"id": "3", "name": "Major", "statusColor": "#ffab00", "iconUrl": ""}])
            return FakeResponse(204, {})

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request), \
             patch.object(jira_server, "build_jira_headers", side_effect=AssertionError("build_jira_headers must not be called")), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["succeeded"], 1)
        mock_clear.assert_called_once_with(reason="issue_priority_update")

    def test_priority_write_does_not_clear_caches_when_nothing_succeeded(self):
        def fake_update_issue_priorities(issue_keys, target_priority_id, *, jira_request, search_request, context=None):
            return {
                "requested": 1,
                "succeeded": 0,
                "failed": 1,
                "targetPriority": {"id": target_priority_id, "name": "Major"},
                "results": [{"key": "PROD-1", "result": "failure", "error": "priority_forbidden"}],
            }

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_priorities", side_effect=fake_update_issue_priorities), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_clear.assert_not_called()

    def test_priority_write_maps_input_error_to_400(self):
        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": [], "targetPriorityId": "3"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "issue_keys_required")

    def test_priority_write_invalid_json_body_returns_400(self):
        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/issues/priorities",
                data="not-json",
                content_type="application/json",
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_json")

    def test_priority_write_service_error_returns_sanitized_502(self):
        def fake_update_issue_priorities(issue_keys, target_priority_id, *, jira_request, search_request, context=None):
            raise IssuePriorityServiceError("issue_priority_snapshot_fetch_failed", 503)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_priorities", side_effect=fake_update_issue_priorities):
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_priority_update_failed")


class IssueProjectTrackRouteTests(DbOAuthFixture, unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._setup_db()

    def _csrf_token(self):
        # Mint the token against the actual DB browser session.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/auth/csrf", headers={"X-Requested-With": "jira-execution-planner"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["csrfToken"]

    def test_options_route_requires_oauth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "load_project_track_options_for_issue", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.get("/api/issues/project-track/options?issueKey=PRODUCT-1")

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_options_route_requires_issue_key(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_project_track_options_for_issue", side_effect=AssertionError("must not call service without issueKey")):
            response = self.client.get("/api/issues/project-track/options?issueKey=")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_issue_key")

    def test_options_route_uses_current_auth_context(self):
        sentinel_context = self._auth_context()
        captured = {}

        def fake_load_options(issue_key, *, jira_request, get_project_track_field_id, context=None):
            captured["context"] = context
            captured["field_id_getter"] = get_project_track_field_id
            return {"options": [{"value": "Flexible"}, {"value": "Committed"}], "source": "jira"}

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(eng_routes, "load_project_track_options_for_issue", side_effect=fake_load_options):
            response = self.client.get("/api/issues/project-track/options?issueKey=PRODUCT-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        self.assertIs(captured["field_id_getter"], jira_server.get_project_track_field_id)
        body = response.get_json()
        self.assertEqual(body["source"], "jira")
        self.assertEqual(body["options"], [{"value": "Flexible"}, {"value": "Committed"}])

    def test_options_route_maps_issue_not_found_to_404(self):
        def fake_load_options(issue_key, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("issue_not_found", 404)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_project_track_options_for_issue", side_effect=fake_load_options):
            response = self.client.get("/api/issues/project-track/options?issueKey=PRODUCT-1")

        self.assertEqual(response.status_code, 404, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "issue_not_found")

    def test_options_route_maps_not_editable_to_409(self):
        def fake_load_options(issue_key, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("project_track_not_editable", 409)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_project_track_options_for_issue", side_effect=fake_load_options):
            response = self.client.get("/api/issues/project-track/options?issueKey=PRODUCT-1")

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "project_track_not_editable")

    def test_options_route_service_error_returns_sanitized_502(self):
        def fake_load_options(issue_key, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("project_track_options_fetch_failed", 503)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_project_track_options_for_issue", side_effect=fake_load_options):
            response = self.client.get("/api/issues/project-track/options?issueKey=PRODUCT-1")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_project_track_options_failed")

    def test_options_route_does_not_call_build_jira_headers(self):
        def fake_load_options(issue_key, *, jira_request, get_project_track_field_id, context=None):
            return {"options": [{"value": "Flexible"}, {"value": "Committed"}], "source": "jira"}

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_project_track_options_for_issue", side_effect=fake_load_options), \
             patch.object(jira_server, "build_jira_headers", side_effect=AssertionError("build_jira_headers must not be called")):
            response = self.client.get("/api/issues/project-track/options?issueKey=PRODUCT-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["source"], "jira")

    def test_write_rejects_missing_x_requested_with_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("X-Requested-With", response.get_json()["message"])

    def test_write_rejects_missing_csrf_token_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("CSRF", response.get_json()["message"])

    def test_write_invalid_json_body_returns_400(self):
        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/issues/project-track",
                data="not-json",
                content_type="application/json",
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_json")

    def test_write_requires_oauth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
            )

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_write_returns_missing_scope_before_jira_call_when_write_scope_absent(self):
        # Same rationale as the sibling priority/status-transition tests: a
        # session/server pair that predates write:jira-work must still be
        # caught by the route's own explicit scope check, not just the
        # middleware's blanket check.
        old_scope = (
            "read:me read:jira-work read:jira-user read:board-scope:jira-software "
            "read:sprint:jira-software read:project:jira offline_access"
        )
        csrf_token = self._csrf_token()
        install_oauth_session(self.client, scope=old_scope)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            with patch.object(eng_routes, "update_issue_project_track", side_effect=AssertionError("must not resolve/post project track")), \
                 patch.object(jira_server, "current_jira_request", side_effect=AssertionError("must not call Jira")):
                response = self.client.post(
                    "/api/issues/project-track",
                    json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                    headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
                )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "auth_required")
        self.assertEqual(body["loginUrl"], "/login?reason=missing_scope")

    def test_write_maps_input_errors_to_400(self):
        cases = [
            ({"issueKey": "", "targetTrack": "Committed"}, "invalid_issue_key"),
            ({"issueKey": "PRODUCT-1", "targetTrack": "Unknown"}, "invalid_project_track"),
        ]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            for payload, expected_error in cases:
                with self.subTest(payload=payload):
                    csrf_token = self._csrf_token()
                    response = self.client.post(
                        "/api/issues/project-track",
                        json=payload,
                        headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
                    )
                    self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                    self.assertEqual(response.get_json()["error"], expected_error)

    def test_write_maps_issue_not_epic_to_409(self):
        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("issue_not_epic", 409)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "issue_not_epic")

    def test_write_maps_option_unavailable_to_409(self):
        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("project_track_option_unavailable", 409)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "project_track_option_unavailable")

    def test_write_maps_not_editable_to_409(self):
        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("project_track_not_editable", 409)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "project_track_not_editable")

    def test_write_maps_issue_not_found_to_404(self):
        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("issue_not_found", 404)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 404, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "issue_not_found")

    def test_write_service_error_returns_sanitized_502(self):
        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            raise ProjectTrackServiceError("project_track_update_failed", 503)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update):
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_project_track_update_failed")

    def test_write_uses_oauth_context_and_clears_caches_on_success(self):
        sentinel_context = self._auth_context()
        captured = {}

        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            captured["context"] = context
            captured["field_id_getter"] = get_project_track_field_id
            return {"issueKey": "PRODUCT-1", "result": "success", "fromTrack": "Flexible", "toTrack": "Committed"}

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        self.assertIs(captured["field_id_getter"], jira_server.get_project_track_field_id)
        body = response.get_json()
        self.assertEqual(body, {
            "issueKey": "PRODUCT-1",
            "result": "success",
            "fromTrack": "Flexible",
            "toTrack": "Committed",
        })
        mock_clear.assert_called_once_with(reason="issue_project_track_update")

    def test_write_does_not_clear_caches_for_already_in_track(self):
        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            return {"issueKey": "PRODUCT-1", "result": "already_in_track", "fromTrack": "Committed"}

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["result"], "already_in_track")
        mock_clear.assert_not_called()

    def test_write_does_not_call_build_jira_headers(self):
        def fake_update(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None):
            return {"issueKey": "PRODUCT-1", "result": "success", "fromTrack": "Flexible", "toTrack": "Committed"}

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "update_issue_project_track", side_effect=fake_update), \
             patch.object(jira_server, "build_jira_headers", side_effect=AssertionError("build_jira_headers must not be called")), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/project-track",
                json={"issueKey": "PRODUCT-1", "targetTrack": "Committed"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_clear.assert_called_once_with(reason="issue_project_track_update")


class IssueStatusCatalogRouteTests(DbOAuthFixture, unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._setup_db()

    def test_status_catalog_route_uses_current_auth_context(self):
        sentinel_context = self._auth_context()
        captured = {}

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            captured["context"] = context
            captured["method"] = method
            captured["path"] = path
            return FakeResponse(200, [
                {
                    "id": "10000",
                    "name": "In Progress",
                    "description": "internal jira description",
                    "iconUrl": "https://jira.example/icons/generic.png",
                    "self": "https://jira.example/rest/api/3/status/10000",
                    "statusCategory": {"key": "indeterminate", "colorName": "yellow"},
                },
            ])

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request):
            response = self.client.get("/api/issues/statuses/catalog")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        self.assertEqual(captured["method"], "GET")
        self.assertEqual(captured["path"], "/rest/api/3/status")
        self.assertEqual(response.get_json(), {
            "statuses": [{
                "id": "10000",
                "name": "In Progress",
                "statusCategoryKey": "indeterminate",
                "statusCategoryColor": "yellow",
            }],
            "source": "jira",
            "cached": False,
        })

    def test_status_catalog_route_shapes_body_without_raw_jira_fields(self):
        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            return FakeResponse(200, [
                {
                    "id": "10000",
                    "name": "In Progress",
                    "description": "internal jira description",
                    "iconUrl": "https://jira.example/icons/generic.png",
                    "self": "https://jira.example/rest/api/3/status/10000",
                    "statusCategory": {
                        "key": "indeterminate",
                        "colorName": "yellow",
                        "self": "https://jira.example/rest/api/3/statuscategory/4",
                    },
                },
            ])

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request):
            response = self.client.get("/api/issues/statuses/catalog")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body_text = response.get_data(as_text=True)
        self.assertNotIn("jira.example", body_text)
        self.assertNotIn("description", body_text)
        self.assertNotIn("iconUrl", body_text)
        status = response.get_json()["statuses"][0]
        self.assertEqual(set(status.keys()), {"id", "name", "statusCategoryKey", "statusCategoryColor"})

    def test_status_catalog_route_service_error_returns_sanitized_502(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_request", return_value=FakeResponse(503, {})):
            response = self.client.get("/api/issues/statuses/catalog")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_status_catalog_failed")


class IssueDescriptionRouteTests(DbOAuthFixture, unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._setup_db()

    def test_description_route_renders_adf_to_html(self):
        description = {
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Ships "},
                    {"type": "text", "text": "fast", "marks": [{"type": "strong"}]},
                    {"type": "text", "text": "."},
                ],
            }],
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "fields": {"description": description},
             })) as mock_get:
            response = self.client.get("/api/issues/description?key=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["key"], "PROD-1")
        self.assertEqual(body["html"], "<p>Ships <strong>fast</strong>.</p>")
        self.assertFalse(body["isEmpty"])
        mock_get.assert_called_once()
        self.assertEqual(mock_get.call_args.args[0], "/rest/api/3/issue/PROD-1")
        self.assertEqual(mock_get.call_args.kwargs.get("params"), {"fields": "description"})

    def test_description_route_renders_safe_semantic_heading_and_table(self):
        description = {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 3, "onclick": "alert(1)"},
                    "content": [{"type": "text", "text": "Scope <Stories>"}],
                },
                {
                    "type": "table",
                    "attrs": {"layout": "wide", "width": 9999, "style": "position:fixed"},
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableHeader", "attrs": {"background": "red"},
                                 "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Key"}]}]},
                                {"type": "tableHeader",
                                 "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Summary"}]}]},
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableCell", "attrs": {"colspan": 2},
                                 "content": [{"type": "paragraph", "content": [{"type": "text", "text": "SYNTH-1"}]}]},
                                {"type": "tableCell",
                                 "content": [{"type": "paragraph", "content": [
                                     {"type": "text", "text": "<script>safe text</script> ",
                                      "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
                                     {"type": "text", "text": "spec", "marks": [{"type": "link", "attrs": {
                                         "href": "https://docs.example.test/spec?mode=review&section=table"
                                     }}]},
                                 ]}]},
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableCell", "content": []},
                                {"type": "tableCell", "content": [{"type": "paragraph", "content": []}]},
                            ],
                        },
                    ],
                },
            ],
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "fields": {"description": description},
             })):
            response = self.client.get("/api/issues/description?key=SYNTH-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        html = response.get_json()["html"]
        self.assertIn("<h3>Scope &lt;Stories&gt;</h3>", html)
        self.assertIn(
            '<div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">'
            "<table><tbody>",
            html,
        )
        self.assertIn('<th scope="col"><p>Key</p></th>', html)
        self.assertIn('<th scope="col"><p>Summary</p></th>', html)
        self.assertIn('<td><p>SYNTH-1</p></td>', html)
        self.assertIn('&lt;script&gt;safe text&lt;/script&gt;', html)
        self.assertIn('<td></td><td></td>', html)
        self.assertNotIn("onclick", html)
        self.assertNotIn("layout", html)
        self.assertNotIn("width", html)
        self.assertNotIn("background", html)
        self.assertNotIn("style=", html)
        self.assertNotIn("colspan", html)
        self.assertNotIn("javascript:", html)

    def test_description_route_renders_invalid_heading_levels_as_paragraphs(self):
        description = {
            "type": "doc",
            "content": [
                {"type": "heading", "content": [{"type": "text", "text": "Missing"}]},
                {"type": "heading", "attrs": {"level": "3"},
                 "content": [{"type": "text", "text": "String"}]},
                {"type": "heading", "attrs": {"level": 0},
                 "content": [{"type": "text", "text": "Zero"}]},
                {"type": "heading", "attrs": {"level": 7},
                 "content": [{"type": "text", "text": "Seven"}]},
            ],
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "fields": {"description": description},
             })):
            response = self.client.get("/api/issues/description?key=SYNTH-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json()["html"],
            "<p>Missing</p><p>String</p><p>Zero</p><p>Seven</p>",
        )

    def test_description_route_tolerates_malformed_heading_and_table_shapes(self):
        cases = [
            (
                "heading attrs are not a mapping",
                [{
                    "type": "heading",
                    "attrs": "invalid",
                    "content": [{"type": "text", "text": "Fallback heading"}],
                }],
                "<p>Fallback heading</p>",
            ),
            (
                "heading content is not a list",
                [{"type": "heading", "attrs": {"level": 2}, "content": 7}],
                "",
            ),
            (
                "table content is not a list",
                [{"type": "table", "content": 7}],
                "",
            ),
            (
                "table content is null",
                [{"type": "table", "content": None}],
                "",
            ),
            (
                "row content is not a list",
                [{"type": "table", "content": [{"type": "tableRow", "content": 7}]}],
                "",
            ),
            (
                "cell content is not a list",
                [{
                    "type": "table",
                    "content": [{
                        "type": "tableRow",
                        "content": [{"type": "tableCell", "content": 7}],
                    }],
                }],
                (
                    '<div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">'
                    "<table><tbody><tr><td></td></tr></tbody></table></div>"
                ),
            ),
        ]

        for label, content, expected_html in cases:
            with self.subTest(label=label):
                with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
                     patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                         "fields": {"description": {"type": "doc", "content": content}},
                     })):
                    response = self.client.get("/api/issues/description?key=SYNTH-1")

                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                self.assertEqual(response.get_json()["html"], expected_html)

    def test_description_route_renders_safe_inline_and_block_smart_links(self):
        inline_url = 'https://docs.example.test/spec?mode="review"&section=quality'
        block_url = 'mailto:owner@example.test?subject=Quality & review'
        description = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "Tech design: "},
                        {"type": "inlineCard", "attrs": {"url": inline_url}},
                        {"type": "inlineCard", "attrs": {"url": "javascript:alert(1)"}},
                        {"type": "inlineCard", "attrs": {}},
                    ],
                },
                {"type": "blockCard", "attrs": {"url": block_url}},
            ],
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "fields": {"description": description},
             })):
            response = self.client.get("/api/issues/description?key=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        html = response.get_json()["html"]
        self.assertEqual(html.count("<a href"), 2, html)
        self.assertIn(
            '<a href="https://docs.example.test/spec?mode=&quot;review&quot;&amp;section=quality" '
            'target="_blank" rel="noopener noreferrer">'
            'https://docs.example.test/spec?mode=&quot;review&quot;&amp;section=quality</a>',
            html,
        )
        self.assertIn(
            '<a href="mailto:owner@example.test?subject=Quality &amp; review" '
            'target="_blank" rel="noopener noreferrer">'
            'mailto:owner@example.test?subject=Quality &amp; review</a>',
            html,
        )
        self.assertNotIn("javascript:", html)
        self.assertFalse(response.get_json()["isEmpty"])

    def test_description_route_null_description_is_empty(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "fields": {"description": None},
             })):
            response = self.client.get("/api/issues/description?key=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["html"], "")
        self.assertTrue(body["isEmpty"])

    def test_description_route_whitespace_only_description_is_empty(self):
        description = {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "   "}]}],
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "fields": {"description": description},
             })):
            response = self.client.get("/api/issues/description?key=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertTrue(body["isEmpty"], body)

    def test_description_route_xss_guard_strips_unsafe_href_but_keeps_safe_one(self):
        description = {
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "unsafe",
                        "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}],
                    },
                    {"type": "text", "text": " "},
                    {
                        "type": "text",
                        "text": "safe",
                        "marks": [{"type": "link", "attrs": {"href": "https://example.test"}}],
                    },
                ],
            }],
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "fields": {"description": description},
             })):
            response = self.client.get("/api/issues/description?key=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        html = response.get_json()["html"]
        self.assertNotIn("javascript:", html)
        # Exactly one anchor may appear: the unsafe-href link mark must render
        # with no <a> at all, so a count of 1 (not 2) proves _safe_adf_href is
        # actually gating the javascript: href rather than passing it through.
        self.assertEqual(html.count("<a href"), 1, html)
        self.assertIn('<a href="https://example.test"', html)

    def test_description_route_missing_key_returns_400(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", side_effect=AssertionError("must not call Jira without a key")):
            response = self.client.get("/api/issues/description")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_issue_key")

    def test_description_route_malformed_key_returns_400(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", side_effect=AssertionError("must not call Jira with a malformed key")):
            response = self.client.get("/api/issues/description?key=not-a-key")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_issue_key")

    def test_description_route_unknown_and_forbidden_keys_return_identical_404(self):
        # Three distinct upstream causes -- a genuinely nonexistent key, a
        # Jira 404 whose body carries content, and a Jira 403 ("cannot see
        # it") -- must all normalize to the byte-identical issue_not_found
        # body. Comparing them against each other (not just individually)
        # is what proves the 403 fold-in from Fix 3 doesn't leak.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(404, {})):
            unknown_key_response = self.client.get("/api/issues/description?key=PROD-404")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(404, {"errorMessages": ["Issue does not exist"]})):
            jira_404_response = self.client.get("/api/issues/description?key=PROD-405")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(403, {"errorMessages": ["You do not have permission to view this issue"]})):
            jira_403_response = self.client.get("/api/issues/description?key=PROD-403")

        responses = {
            "unknown_key": unknown_key_response,
            "jira_404": jira_404_response,
            "jira_403": jira_403_response,
        }
        for label, response in responses.items():
            self.assertEqual(response.status_code, 404, f"{label}: {response.get_data(as_text=True)}")
            self.assertEqual(response.get_json(), {"error": "issue_not_found"}, label)

        self.assertEqual(responses["unknown_key"].get_data(), responses["jira_404"].get_data())
        self.assertEqual(responses["jira_404"].get_data(), responses["jira_403"].get_data())

    def test_description_route_service_error_returns_upstream_message_verbatim(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(503, {})):
            response = self.client.get("/api/issues/description?key=PROD-1")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "issue_description_fetch_failed")
        self.assertEqual(body["message"], "Jira returned status 503")

    def test_description_route_uses_current_auth_context(self):
        sentinel_context = self._auth_context()
        captured = {}

        def fake_get(path, *, params=None, timeout=30, context=None):
            captured["context"] = context
            captured["path"] = path
            captured["params"] = params
            return FakeResponse(200, {"fields": {"description": None}})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(jira_server, "current_jira_get", side_effect=fake_get):
            response = self.client.get("/api/issues/description?key=prod-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        self.assertEqual(captured["path"], "/rest/api/3/issue/PROD-1")
        self.assertEqual(captured["params"], {"fields": "description"})


class MissingWriteJiraWorkScopeHelperTests(DbOAuthFixture, unittest.TestCase):
    """DB admission verifies scopes before the route's defense-in-depth helper."""

    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self._setup_db()

    def test_skips_local_store_recheck_for_db_backed_context(self):
        context = self._auth_context()
        with patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('local store recheck')):
            eng_routes.bind_server_globals(eng_routes.__dict__)
            self.assertFalse(eng_routes._missing_write_jira_work_scope(context))

    def test_db_admission_rejects_missing_write_scope(self):
        install_oauth_session(self.client, scope='read:me read:jira-work')
        with patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('Jira called')):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertEqual(response.get_json()['loginUrl'], '/login?reason=missing_scope')

    def test_provider_granted_db_context_with_write_scope_is_not_missing(self):
        context = self._auth_context()
        self.assertIn('write:jira-work', context.granted_scopes)
        eng_routes.bind_server_globals(eng_routes.__dict__)
        self.assertFalse(eng_routes._missing_write_jira_work_scope(context))


class BasicEngRouteTests(DbOAuthFixture, unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._setup_db()

    def test_transition_options_rejects_basic_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "load_transition_options", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.post(
                "/api/issues/transitions/options",
                json={"issueKeys": ["PROD-1"]},
            )

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_transitions_write_rejects_basic_mode_before_csrf(self):
        # Retired profiles fail before CSRF validation or route dispatch.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "transition_issues", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
            )

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_priority_options_route_requires_oauth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "load_priority_options", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.get("/api/issues/priorities/options")

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_priorities_write_rejects_basic_mode_before_csrf(self):
        # Retired profiles fail before CSRF validation or route dispatch.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "update_issue_priorities", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.post(
                "/api/issues/priorities",
                json={"issueKeys": ["PROD-1"], "targetPriorityId": "3"},
            )

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_status_catalog_route_requires_oauth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "load_status_catalog", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.get("/api/issues/statuses/catalog")

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_tasks_basic_profile_is_rejected_before_network(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=AssertionError("retired Basic transport called")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")

    def test_dependencies_basic_profile_is_rejected_before_route(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "collect_dependencies", side_effect=AssertionError("retired Basic route called")):
            response = self.client.post("/api/dependencies", json={"keys": ["PROD-1"]})

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "runtime_auth_unsupported")
