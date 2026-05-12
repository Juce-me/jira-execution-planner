import unittest
from unittest.mock import patch

from backend.auth.context import ProjectAccessSnapshot, RequestAuthContext
from backend.auth.project_access import project_access_denied_response, upsert_project_access_snapshot
from backend.db import models
import jira_server


def auth_context(*, project_access):
    return RequestAuthContext(
        auth_mode='atlassian_oauth',
        user_id='user-1',
        stable_subject='account-1',
        atlassian_account_id='account-1',
        workspace_id='workspace-1',
        auth_connection_id='connection-1',
        cloud_id='cloud-1',
        site_url='https://example.atlassian.net',
        token_version='1',
        account_status='active',
        is_admin=False,
        project_access=tuple(project_access),
    )


class TestProjectAccess(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        self.client = jira_server.app.test_client()

    def _allowed_response(self, project_type):
        other_type = 'tech' if project_type == 'product' else 'product'
        context = auth_context(project_access=[
            ProjectAccessSnapshot(project_key=project_type.upper(), project_type=project_type, status='accessible'),
            ProjectAccessSnapshot(project_key=other_type.upper(), project_type=other_type, status='inaccessible'),
        ])
        calls = []

        def jira_search(payload):
            calls.append(payload)
            return jira_server.SyntheticJiraResponse(200, {
                'issues': [],
                'isLast': True,
                'names': {},
            })

        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'resolve_team_field_id', return_value=None), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value=None), \
             patch.object(jira_server, 'get_sprint_field_id', return_value=None), \
             patch.object(jira_server, 'jira_search_request', side_effect=jira_search):
            response = self.client.get(f'/api/tasks?project={project_type}')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertGreaterEqual(len(calls), 1)
        self.assertNotIn('missing_project_access', response.get_data(as_text=True))

    def test_product_only_user_renders_product_views(self):
        self._allowed_response('product')

    def test_tech_only_user_renders_tech_views(self):
        self._allowed_response('tech')

    def test_new_user_without_project_access_snapshot_can_probe_live_project_view(self):
        context = auth_context(project_access=[])
        calls = []

        def jira_search(payload):
            calls.append(payload)
            return jira_server.SyntheticJiraResponse(200, {
                'issues': [],
                'isLast': True,
                'names': {},
            })

        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'resolve_team_field_id', return_value=None), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value=None), \
             patch.object(jira_server, 'get_sprint_field_id', return_value=None), \
             patch.object(jira_server, 'jira_search_request', side_effect=jira_search):
            response = self.client.get('/api/tasks?project=product')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertGreaterEqual(len(calls), 1)

    def test_user_with_no_project_access_blocked_with_clear_state(self):
        context = auth_context(project_access=[
            ProjectAccessSnapshot(project_key='PROD', project_type='product', status='inaccessible'),
        ])

        with jira_server.app.test_request_context('/api/tasks?project=product'):
            payload, status = project_access_denied_response(context, 'product')

        self.assertEqual(status, 403)
        self.assertEqual(payload.get_json()['error'], 'missing_project_access')
        self.assertEqual(payload.get_json()['recoveryUrl'], '/auth/missing-project-access')

    def test_unknown_access_avoids_startup_retry_storm(self):
        context = auth_context(project_access=[
            ProjectAccessSnapshot(project_key='PROD', project_type='product', status='unknown'),
        ])
        jira_calls = []

        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'jira_search_request', side_effect=lambda payload: jira_calls.append(payload)):
            response = self.client.get('/api/tasks?project=product')

        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'missing_project_access')
        self.assertEqual(body['projectAccessStatus'], 'unknown')
        self.assertEqual(jira_calls, [])

    def test_project_access_snapshot_upsert_records_configured_project_status(self):
        with jira_server.app.test_request_context('/'):
            pass
        class Session:
            def __init__(self):
                self.rows = []
                self.flushed = False

            def query(self, model):
                self.model = model
                return self

            def filter_by(self, **filters):
                self.filters = filters
                return self

            def first(self):
                return self.rows[0] if self.rows else None

            def add(self, row):
                self.rows.append(row)

            def flush(self):
                self.flushed = True

        session = Session()

        row = upsert_project_access_snapshot(
            session,
            connection_id='connection-1',
            workspace_id='workspace-1',
            project_key='PROD',
            project_type='product',
            status='accessible',
        )

        self.assertIsInstance(row, models.JiraProjectAccess)
        self.assertEqual(row.project_key, 'PROD')
        self.assertEqual(row.status, 'accessible')
        self.assertTrue(session.flushed)


if __name__ == '__main__':
    unittest.main()
