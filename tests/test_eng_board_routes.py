import base64
import json
import os
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

import jira_server
from backend.auth.context import RequestAuthContext
from backend.auth.db_tokens import store_oauth_callback_tokens
from backend.auth.key_provider import key_provider_from_env
from backend.db import engine as db_engine, models
from backend.services import eng_board
from backend.services.eng_board import build_scope_version
from backend.services.eng_board_stream import EngBoardRequestTransport
from backend.services.shared_group_config import ExistingSharedGroupsSnapshot
from backend.services.workspace_dashboard_config import WorkspaceConfigSnapshot
from backend.routes import eng_board_routes
from tests.oauth_test_helpers import install_oauth_session


BOARD_PATH = '/api/eng/board'
VALID_QUERY = {
    'departmentId': 'department-a',
    'scope': 'all_work',
    'refresh': '0',
}


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def json(self):
        return self.payload


def db_context(*, token_version='1', browser_session_id='browser-1', user_id='user-1',
               workspace_id='workspace-1', account_status='active'):
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id=user_id, stable_subject='subject-1',
        atlassian_account_id='account-1', workspace_id=workspace_id,
        auth_connection_id='connection-1', cloud_id='cloud-1',
        site_url='https://example.atlassian.net', token_version=token_version,
        account_status=account_status, is_admin=False,
        browser_session_id=browser_session_id,
        granted_scopes=('read:jira-work',), granted_scopes_verified=True,
    )


def board_query(**overrides):
    values = {
        'department_id': 'department-a', 'scope': 'all_work', 'sprint_id': None,
        'focused_column_id': 'todo', 'refresh': False,
    }
    values.update(overrides)
    return eng_board_routes.BoardQuery(**values)


def board_snapshot(**overrides):
    context = overrides.pop('context', db_context())
    values = {
        'query': board_query(), 'context': context,
        'browser_session_id': context.browser_session_id,
        'required_scopes': 'read:jira-work', 'authority_payload': {'revision': 1},
        'dashboard_payload': {}, 'group': {'id': 'department-a'},
        'raw_group': {'id': 'department-a'},
        'board': {
            'configured': True,
            'columns': (
                {'id': 'todo', 'name': 'To do', 'statuses': ('To Do',), 'colour': '#111111'},
                {'id': 'done', 'name': 'Done', 'statuses': ('Done',), 'colour': '#222222'},
            ),
            'doneEpicRetentionDays': 28,
        },
        'projects': (('ABC', 'product'),), 'components': ('Component A',), 'teams': (),
        'issue_type_ids': ('10001',), 'epic_link_field_id': None,
        'sprint_field_id': 'customfield_10101',
        'story_points_field_id': 'customfield_10004',
        'team_field_id': 'customfield_30101',
        'project_track_field_id': 'customfield_35024',
        'delivery_owner_field_id': None, 'scope_version': 'scope-version',
        'scope_cohort_digest': 'a' * 64, 'secret_key': b'test-secret',
    }
    values.update(overrides)
    return eng_board_routes.BoardSnapshot(**values)


def epic(key, status):
    return {
        'key': key,
        'fields': {
            'summary': f'{key} summary', 'status': {'id': f'status-{status}', 'name': status}, 'priority': None,
            'assignee': None, 'updated': None, 'parent': None,
            'project': {'id': 'project-1', 'key': 'ABC', 'name': 'ABC'}, 'customfield_35024': None,
        },
    }


def child(key, epic_key, status='In Progress'):
    return {
        'key': key,
        'fields': {
            'summary': f'{key} summary', 'status': {'id': 'status-child', 'name': status}, 'priority': None,
            'issuetype': {'id': '10001', 'name': 'Story'}, 'assignee': None, 'updated': None,
            'parent': {'key': epic_key}, 'project': {'id': 'project-1', 'key': 'ABC', 'name': 'ABC'},
            'customfield_10004': 3, 'customfield_30101': None,
            'customfield_10101': [], 'customfield_35024': None,
        },
    }


class EngBoardRouteContractTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_board_route_registers_exactly_one_get_and_no_control_route(self):
        rules = [
            rule for rule in jira_server.app.url_map.iter_rules()
            if rule.rule == BOARD_PATH
        ]

        self.assertEqual(1, len(rules))
        self.assertEqual({'GET'}, set(rules[0].methods) - {'HEAD', 'OPTIONS'})
        self.assertFalse(any(
            rule.rule.startswith(f'{BOARD_PATH}/')
            for rule in jira_server.app.url_map.iter_rules()
        ))

    def test_board_get_has_one_authenticated_read_policy(self):
        from backend.security.policy import matching_policies

        policies = matching_policies(
            BOARD_PATH,
            ['GET'],
            'eng_board_routes.get_eng_board',
        )

        self.assertEqual(['eng-board-read'], [policy.name for policy in policies])
        self.assertEqual('authenticated_read', policies[0].policy_class)

    def test_anonymous_oauth_is_rejected_before_board_route_code(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get(BOARD_PATH, query_string=VALID_QUERY)

        self.assertEqual(401, response.status_code, response.get_data(as_text=True))
        self.assertEqual('auth_required', response.get_json()['error'])

    def test_authenticated_get_requires_neither_csrf_nor_requested_with(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.dict(
            os.environ,
            {'CONFIG_STORAGE_BACKEND': 'jsonfile', 'DATABASE_URL': '', 'TEST_DATABASE_URL': ''},
            clear=False,
        ):
            response = self.client.get(BOARD_PATH, query_string=VALID_QUERY)

        self.assertEqual(409, response.status_code, response.get_data(as_text=True))
        self.assertEqual('board_unavailable', response.get_json()['error'])

    def test_success_uses_ndjson_and_no_store(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
            eng_board_routes, 'database_storage_enabled', return_value=True,
        ), patch.object(
            eng_board_routes, '_capture_snapshot', return_value=board_snapshot(),
        ), patch.object(
            eng_board_routes, '_frame_stream', return_value=iter((b'{"type":"start"}\n',)),
        ):
            response = self.client.get(BOARD_PATH, query_string=VALID_QUERY)

        self.assertEqual(200, response.status_code, response.get_data(as_text=True))
        self.assertEqual('application/x-ndjson', response.mimetype)
        self.assertEqual('no-store', response.headers['Cache-Control'])

    def test_basic_mode_cannot_enter_db_oauth_candidate(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), patch.dict(
            os.environ,
            {'CONFIG_STORAGE_BACKEND': 'jsonfile', 'DATABASE_URL': '', 'TEST_DATABASE_URL': ''},
            clear=False,
        ):
            response = self.client.get(BOARD_PATH, query_string=VALID_QUERY)

        self.assertEqual(409, response.status_code, response.get_data(as_text=True))
        self.assertEqual('board_unavailable', response.get_json()['error'])

    def test_scope_version_is_keyed_and_rotates_with_authority(self):
        captured = {'workspace': 'workspace-a', 'configRevision': 7}

        first = build_scope_version(b'server-key', captured, token_version='1')

        self.assertRegex(first, r'^[0-9a-f]{64}$')
        self.assertEqual(first, build_scope_version(b'server-key', captured, token_version='1'))
        self.assertNotEqual(first, build_scope_version(b'server-key', captured, token_version='2'))
        self.assertNotEqual(first, build_scope_version(b'other-key', captured, token_version='1'))

    def test_malformed_or_duplicated_query_is_rejected_before_snapshot_capture(self):
        install_oauth_session(self.client)
        cases = (
            {**VALID_QUERY, 'projectKey': 'FOREIGN'},
            [('departmentId', 'department-a'), ('departmentId', 'department-b'),
             ('scope', 'all_work')],
            {'departmentId': 'department-a', 'scope': 'sprint', 'sprintId': '01'},
            {'departmentId': 'department-a', 'scope': 'all_work', 'sprintId': '42'},
            {'departmentId': 'department-a', 'scope': 'component', 'sprintId': '42'},
            {'departmentId': 'department-a', 'scope': 'all_work', 'refresh': 'true'},
        )
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
            eng_board_routes, 'database_storage_enabled', return_value=True,
        ), patch.object(eng_board_routes, '_capture_snapshot') as capture:
            for query in cases:
                with self.subTest(query=query):
                    response = self.client.get(BOARD_PATH, query_string=query)
                    self.assertEqual(400, response.status_code, response.get_data(as_text=True))
            capture.assert_not_called()

    def test_component_scope_is_accepted_without_sprint_id(self):
        install_oauth_session(self.client)
        snapshot = board_snapshot(query=board_query(scope='component'))
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
            eng_board_routes, 'database_storage_enabled', return_value=True,
        ), patch.object(
            eng_board_routes, '_capture_snapshot', return_value=snapshot,
        ) as capture, patch.object(
            eng_board_routes, '_frame_stream', return_value=iter((b'{"type":"start"}\n',)),
        ):
            response = self.client.get(BOARD_PATH, query_string={
                'departmentId': 'department-a', 'scope': 'component', 'refresh': '0',
            })

        self.assertEqual(200, response.status_code, response.get_data(as_text=True))
        query = capture.call_args.args[1]
        self.assertEqual('component', query.scope)
        self.assertIsNone(query.sprint_id)

    def test_hidden_current_user_group_is_denied(self):
        context = db_context()
        dashboard = WorkspaceConfigSnapshot({}, 3, 'workspace_db')
        group = {'id': 'department-a', 'name': 'A', 'teamIds': []}
        groups = ExistingSharedGroupsSnapshot(
            {'groups': [group]}, {'groups': [group]}, 'row-1', 1, 4,
        )
        with patch.object(
            eng_board_routes.workspace_dashboard_config, 'load_workspace_config', return_value=dashboard,
        ), patch.object(
            eng_board_routes.shared_group_config, 'require_existing_shared_groups_snapshot',
            return_value=groups,
        ), patch.object(
            eng_board_routes.shared_group_config, 'load_group_preferences',
            return_value={'effectiveVisibleGroupIds': [], 'onboardingRequired': False},
        ), patch.object(
            eng_board_routes, 'get_jira_server', return_value=SimpleNamespace(validate_groups_config=lambda value: value),
        ):
            with self.assertRaises(eng_board_routes.BoardRouteError) as raised:
                eng_board_routes._load_authority(context, board_query())

        self.assertEqual('board_permission_denied', raised.exception.code)
        self.assertEqual(403, raised.exception.status)

    def test_accessible_project_catalog_uses_offset_paging_and_rejects_repeated_page(self):
        context = db_context()
        transport = EngBoardRequestTransport()
        server = SimpleNamespace(current_jira_get=Mock(side_effect=(
            FakeResponse({'values': [{'key': 'ABC'}], 'isLast': False, 'startAt': 0, 'maxResults': 1, 'total': 2}),
            FakeResponse({'values': [{'key': 'XYZ'}], 'isLast': True, 'startAt': 1, 'maxResults': 1, 'total': 2}),
        )))

        keys = eng_board_routes._accessible_project_catalog(server, context, transport)

        self.assertEqual({'ABC', 'XYZ'}, keys)
        self.assertNotIn('nextPageToken', server.current_jira_get.call_args_list[0].kwargs['params'])
        self.assertEqual(1, server.current_jira_get.call_args_list[1].kwargs['params']['startAt'])
        repeated = SimpleNamespace(current_jira_get=Mock(side_effect=(
            FakeResponse({'values': [{'key': 'ABC'}], 'isLast': False, 'startAt': 0}),
            FakeResponse({'values': [{'key': 'ABC'}], 'isLast': False, 'startAt': 0}),
        )))
        with self.assertRaises(eng_board_routes.BoardRouteError) as raised:
            eng_board_routes._accessible_project_catalog(repeated, context, EngBoardRequestTransport())
        self.assertEqual('board_config_invalid', raised.exception.code)

    def test_project_scope_is_server_selected_and_checked_against_live_catalog(self):
        context = db_context()
        server = SimpleNamespace(current_jira_get=Mock(return_value=FakeResponse({
            'values': [{'key': 'ABC'}], 'isLast': True,
        })))
        dashboard = {'projects': {'selected': [{'key': 'FOREIGN', 'type': 'product'}]}}

        with self.assertRaises(eng_board_routes.BoardRouteError) as raised:
            eng_board_routes._resolve_projects(
                server, dashboard, context, EngBoardRequestTransport(),
            )

        self.assertEqual('board_permission_denied', raised.exception.code)
        self.assertEqual(403, raised.exception.status)

    def test_metadata_pagination_reaches_complete_board_for_both_scopes(self):
        install_oauth_session(self.client)
        context = db_context()
        dashboard = {'projects': {'selected': [{'key': 'ABC', 'type': 'product'}]}}
        group = {'id': 'department-a', 'missingInfoComponents': ['Component A'], 'board': {
            'columns': [
                {'id': 'col-11111111', 'name': 'To do', 'statuses': ['To Do'], 'colour': '#597ef7'},
                {'id': 'col-22222222', 'name': 'Done', 'statuses': ['Done'], 'colour': '#52c41a'},
            ], 'doneEpicRetentionDays': 28,
        }}

        def metadata(path, **kwargs):
            if path == '/rest/api/3/project/search':
                offset = kwargs['params']['startAt']
                return FakeResponse({'values': [{'key': 'XYZ' if offset == 0 else 'ABC'}],
                                     'startAt': offset, 'maxResults': 1, 'total': 2, 'isLast': offset == 1})
            if path == '/rest/api/3/issuetype':
                return FakeResponse([{'id': '10001', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False}])
            self.assertEqual('/rest/api/3/field', path)
            return FakeResponse([])

        def search(payload, **kwargs):
            self.assertIsInstance(kwargs['timeout'], (int, float))
            rows = [epic('ABC-1', 'To Do')] if 'issuetype = Epic' in payload['jql'] else [child('ABC-11', 'ABC-1')]
            return FakeResponse({'issues': rows, 'isLast': True})

        with patch.object(jira_server, 'ATLASSIAN_SCOPES', 'read:jira-work'), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
            eng_board_routes, 'database_storage_enabled', return_value=True,
        ), patch.object(jira_server, 'current_request_auth_context', return_value=context), patch.object(
            jira_server, 'current_jira_session_data', return_value={},
        ), patch.object(eng_board_routes, '_load_authority', return_value=({}, dashboard, group, group, 1, 1)), patch.object(
            eng_board_routes, '_context_from_browser_session', return_value=context,
        ), patch.object(jira_server, 'current_jira_get', side_effect=metadata), patch.object(
            jira_server, 'current_jira_search', side_effect=search,
        ) as jira_search:
            for scope in ('sprint', 'all_work', 'component'):
                with self.subTest(scope=scope):
                    query = {**VALID_QUERY, 'scope': scope}
                    if scope == 'sprint':
                        query['sprintId'] = '123'
                    response = self.client.get(BOARD_PATH, query_string=query)
                    self.assertEqual(200, response.status_code, response.get_data(as_text=True))
                    frames = [json.loads(line) for line in response.get_data(as_text=True).splitlines()]
                    self.assertEqual('success', frames[-1].get('outcome'), frames)
                    self.assertEqual(1, frames[-1]['epicCount'])
                    self.assertEqual(1, frames[-1]['childCount'])
                    self.assertTrue(frames[-1]['authoritative'])
                    self.assertEqual(scope == 'sprint', 'cf[10101]' in jira_search.call_args.args[0]['jql'])

    def test_component_stream_does_not_run_team_parent_discovery(self):
        calls = []

        def search(payload, **_kwargs):
            calls.append(payload['jql'])
            rows = ([epic('ABC-1', 'To Do')] if 'issuetype = Epic' in payload['jql']
                    else [child('ABC-11', 'ABC-1')])
            return FakeResponse({'issues': rows, 'isLast': True})

        snapshot = board_snapshot(
            query=board_query(scope='component'), teams=('team-a',),
        )
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), snapshot, EngBoardRequestTransport(),
            )]

        self.assertEqual('authoritative', next(
            frame for frame in frames if frame['type'] == 'index'
        )['membership'])
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(1, frames[-1]['epicCount'])
        self.assertEqual(1, frames[-1]['childCount'])
        self.assertEqual(2, len(calls))
        self.assertIn('component in ("Component A")', calls[0])
        self.assertNotIn('cf[30101]', '\n'.join(calls))
        self.assertNotIn('cf[10101]', '\n'.join(calls))

    def test_preheader_failures_are_sanitized_and_keep_status_contract(self):
        install_oauth_session(self.client)
        cases = (
            (eng_board_routes.BoardRouteError('board_group_not_found', 404), 404, 'board_group_not_found'),
            (eng_board_routes.BoardRouteError('board_config_invalid', 409), 409, 'board_config_invalid'),
            (eng_board.EngBoardError('board_scope_too_large'), 422, 'scope_too_large'),
            (eng_board.EngBoardError('board_projection_invalid', phase='page'), 409, 'invalid_page'),
            (eng_board.EngBoardError('board_projection_invalid', phase='index'), 409, 'board_data_invalid'),
            (eng_board.EngBoardError('board_config_invalid', phase='config'), 409, 'board_config_invalid'),
            (eng_board_routes.BoardJiraUnavailable('raw Jira response with secret'), 503, 'jira_unavailable'),
        )
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
            eng_board_routes, 'database_storage_enabled', return_value=True,
        ):
            for error, status, code in cases:
                with self.subTest(code=code), patch.object(
                    eng_board_routes, '_capture_snapshot', side_effect=error,
                ):
                    response = self.client.get(BOARD_PATH, query_string=VALID_QUERY)
                    self.assertEqual(status, response.status_code, response.get_data(as_text=True))
                    self.assertEqual(code, response.get_json()['error'])
                    self.assertNotIn('secret', response.get_data(as_text=True))

    def test_worker_checkpoint_rejects_auth_partition_and_config_mismatches(self):
        snapshot = board_snapshot()
        changed_contexts = (
            db_context(user_id='user-2'),
            db_context(workspace_id='workspace-2'),
            db_context(token_version='2'),
            db_context(browser_session_id='browser-2'),
        )
        for changed in changed_contexts:
            with self.subTest(context=changed), patch.object(
                eng_board_routes, '_context_from_browser_session', return_value=changed,
            ), patch.object(eng_board_routes, '_load_authority') as load_authority:
                with self.assertRaises(eng_board_routes.BoardScopeChanged):
                    eng_board_routes._assert_current(snapshot)
                load_authority.assert_not_called()

        with patch.object(
            eng_board_routes, '_context_from_browser_session', return_value=snapshot.context,
        ), patch.object(
            eng_board_routes, '_load_authority', return_value=({'revision': 2}, None),
        ):
            with self.assertRaises(eng_board_routes.BoardScopeChanged):
                eng_board_routes._assert_current(snapshot)

    def test_snapshot_refreshes_then_uses_fresh_context_and_detects_catalog_rotation(self):
        first = db_context(token_version='1')
        refreshed = db_context(token_version='2')
        authority = {'revision': 1}
        query = board_query(focused_column_id=None)
        dashboard = {'issueTypes': ['Story']}
        group = {'id': 'department-a', 'missingInfoComponents': ['Component A']}
        raw_group = {
            **group,
            'board': {
                'columns': [
                    {'id': 'col-11111111', 'name': 'To do', 'statuses': ['To Do'], 'colour': '#597ef7'},
                    {'id': 'col-22222222', 'name': 'Done', 'statuses': ['Done'], 'colour': '#52c41a'},
                ],
                'doneEpicRetentionDays': 28,
            },
        }
        server = SimpleNamespace(
            ATLASSIAN_SCOPES='read:jira-work',
            current_request_auth_context=Mock(side_effect=(first, refreshed, refreshed)),
            current_jira_session_data=Mock(return_value={'access_token': 'refreshed'}),
        )
        load_result = (authority, dashboard, group, raw_group, 4, 3)
        with patch.object(eng_board_routes, '_load_authority', return_value=load_result), patch.object(
            eng_board_routes, '_resolve_projects', return_value=(('ABC', 'product'),),
        ), patch.object(
            eng_board_routes, '_jira_json', side_effect=(
                [{'id': '10001', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False}],
                [],
            ),
        ):
            snapshot = eng_board_routes._capture_snapshot(
                server, query, EngBoardRequestTransport(), b'test-secret',
            )

        server.current_jira_session_data.assert_called_once_with(
            first, diagnostic_transport=unittest.mock.ANY,
        )
        self.assertIs(refreshed, snapshot.context)
        self.assertEqual('2', snapshot.context.token_version)

        rotated = db_context(token_version='3')
        server.current_request_auth_context = Mock(side_effect=(first, refreshed, rotated))
        server.current_jira_session_data.reset_mock()
        with patch.object(eng_board_routes, '_load_authority', return_value=load_result), patch.object(
            eng_board_routes, '_resolve_projects', return_value=(('ABC', 'product'),),
        ), patch.object(
            eng_board_routes, '_jira_json', side_effect=(
                [{'id': '10001', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False}],
                [],
            ),
        ):
            with self.assertRaises(eng_board_routes.BoardRouteError) as raised:
                eng_board_routes._capture_snapshot(
                    server, query, EngBoardRequestTransport(), b'test-secret',
                )
        self.assertEqual('scope_changed', raised.exception.code)
        self.assertEqual(409, raised.exception.status)

    def test_all_work_stream_includes_other_team_parent_and_team_only_scope(self):
        for components in (('Component A',), ()):
            calls = []
            def search(payload, **kwargs):
                jql = payload['jql']
                calls.append(jql)
                if 'issuetype = Epic' in jql:
                    row = epic('ABC-2', 'Done') if 'key in' in jql else epic('ABC-1', 'To Do')
                    row['fields']['parent'] = {'key': 'ABC-0'}
                    rows = [row]
                elif 'cf[30101]' in jql:
                    rows = [child('ABC-21', 'ABC-2')]
                else:
                    rows = [child('ABC-21', 'ABC-2')] if 'ABC-2' in jql else [child('ABC-11', 'ABC-1')]
                return FakeResponse({'issues': rows, 'isLast': True})
            with self.subTest(components=components), patch.object(
                eng_board_routes, '_assert_current', return_value=db_context(),
            ):
                frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                    SimpleNamespace(current_jira_search=search),
                    board_snapshot(components=components, teams=('team-a',)), EngBoardRequestTransport(),
                )]
            self.assertEqual('success', frames[-1].get('outcome'), frames)
            self.assertEqual(2 if components else 1, frames[-1]['epicCount'])
            done = next(frame for frame in frames if frame['type'] == 'column' and frame['columnId'] == 'done')
            self.assertEqual(['ABC-2'], [row['key'] for row in done['epics']])
            self.assertFalse(any('cf[10101]' in jql for jql in calls))
            if not components:
                self.assertTrue(all('key in' in jql for jql in calls if 'issuetype = Epic' in jql))

    def test_focused_column_frame_arrives_while_later_search_is_held(self):
        release_later = threading.Event()
        both_started = threading.Barrier(2)
        child_calls = []
        search_timeouts = []

        def search(payload, **kwargs):
            search_timeouts.append(kwargs.get('timeout'))
            jql = payload['jql']
            if 'issuetype = Epic' in jql:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do'), epic('ABC-2', 'Done')], 'isLast': True})
            child_calls.append(jql)
            both_started.wait(5)
            if 'ABC-2' in jql:
                release_later.wait(5)
            issue = child('ABC-11', 'ABC-1') if 'ABC-1' in jql else child('ABC-21', 'ABC-2')
            return FakeResponse({'issues': [issue], 'isLast': True})

        server = SimpleNamespace(current_jira_search=search)
        frames = eng_board_routes._frame_stream(server, board_snapshot(), EngBoardRequestTransport())
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            start = json.loads(next(frames))
            index = json.loads(next(frames))
            focused = json.loads(next(frames))
            self.assertEqual(('start', 'index', 'column'), (start['type'], index['type'], focused['type']))
            self.assertEqual('todo', focused['columnId'])
            self.assertFalse(release_later.is_set())
            release_later.set()
            remaining = [json.loads(line) for line in frames]

        self.assertEqual('done', remaining[0]['columnId'])
        self.assertEqual('complete', remaining[-1]['type'])
        self.assertEqual(2, len(child_calls))
        self.assertTrue(all(isinstance(timeout, (int, float)) for timeout in search_timeouts))
        self.assertEqual(2, remaining[-1]['diagnostics']['peakChildSearches'])

    def test_rotation_between_pages_emits_only_sanitized_terminal_scope_changed(self):
        server = SimpleNamespace(current_jira_search=Mock(return_value=FakeResponse({
            'issues': [epic('ABC-1', 'To Do')], 'isLast': False, 'nextPageToken': 'next',
        })))
        checks = 0

        def assert_current(_snapshot):
            nonlocal checks
            checks += 1
            if checks >= 2:
                raise eng_board_routes.BoardScopeChanged('sensitive upstream detail')
            return db_context()

        with patch.object(eng_board_routes, '_assert_current', side_effect=assert_current):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                server, board_snapshot(), EngBoardRequestTransport(),
            )]

        self.assertEqual(['start', 'error'], [frame['type'] for frame in frames])
        self.assertEqual('scope_changed', frames[-1]['code'])
        self.assertNotIn('sensitive', json.dumps(frames))
        self.assertEqual(1, server.current_jira_search.call_count)

    def test_stream_distinguishes_page_data_and_configuration_failures(self):
        malformed_epic = epic('ABC-1', 'To Do')
        del malformed_epic['fields']['summary']
        cases = (
            ({'issues': []}, None, 'invalid_page'),
            ({'issues': [None], 'isLast': True}, None, 'invalid_page'),
            ({'issues': [{'fields': {}}], 'isLast': True}, None, 'invalid_page'),
            ({'issues': [], 'isLast': True, 'nextPageToken': 'unexpected'}, None, 'invalid_page'),
            ({'issues': [], 'isLast': False}, None, 'invalid_page'),
            ({'issues': [malformed_epic], 'isLast': True}, None, 'board_data_invalid'),
            ({'issues': [], 'isLast': True}, eng_board.EngBoardError('board_config_invalid'), 'board_config_invalid'),
        )
        for payload, build_error, expected in cases:
            with self.subTest(expected=expected), patch.object(
                eng_board_routes, '_assert_current', return_value=db_context(),
            ), patch.object(
                eng_board, 'build_epic_index_jql', side_effect=build_error,
            ) if build_error else patch.object(eng_board, 'build_epic_index_jql', wraps=eng_board.build_epic_index_jql):
                server = SimpleNamespace(current_jira_search=Mock(return_value=FakeResponse(payload)))
                frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                    server, board_snapshot(teams=()), EngBoardRequestTransport(),
                )]
            self.assertEqual(['start', 'error'], [frame['type'] for frame in frames])
            self.assertEqual(expected, frames[-1]['code'])

    def test_revoked_or_disabled_context_emits_auth_required_without_diagnostics(self):
        server = SimpleNamespace(current_jira_search=Mock())
        with patch.object(
            eng_board_routes, '_assert_current', side_effect=eng_board_routes.AuthError(
                'auth_connection_revoked', 'secret database detail',
            ),
        ):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                server, board_snapshot(), EngBoardRequestTransport(),
            )]

        self.assertEqual(['start', 'error'], [frame['type'] for frame in frames])
        self.assertEqual({'protocolVersion', 'generationId', 'sequence', 'type', 'code'}, set(frames[-1]))
        self.assertEqual('auth_required', frames[-1]['code'])

    def test_real_current_jira_get_accepts_explicit_db_context_outside_flask_request(self):
        context = db_context()
        transport = EngBoardRequestTransport()
        upstream = FakeResponse({'values': [], 'isLast': True})
        config = SimpleNamespace(auth_mode='atlassian_oauth', jira_url='https://example.atlassian.net')
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
            jira_server, 'has_request_context', return_value=False,
        ), patch.object(
            jira_server, 'current_jira_session_data', return_value={'access_token': 'token'},
        ) as session_data, patch.object(
            jira_server, 'current_oauth_session_callbacks', return_value={},
        ), patch.object(
            jira_server, 'current_auth_config', return_value=config,
        ), patch.object(
            jira_server, 'jira_get', return_value=upstream,
        ) as jira_get:
            response = jira_server.current_jira_get(
                '/rest/api/3/project/search', context=context, diagnostic_transport=transport,
            )

        self.assertIs(upstream, response)
        session_data.assert_called_once_with(context, diagnostic_transport=transport)
        self.assertIs(context, jira_get.call_args.args[1])

    def test_project_catalog_passes_scalar_timeout_to_shared_jira_retry_boundary(self):
        context = db_context()
        transport = EngBoardRequestTransport()
        upstream = FakeResponse({'values': [{'key': 'ABC'}], 'isLast': True})
        config = SimpleNamespace(auth_mode='atlassian_oauth', jira_url='https://example.atlassian.net')
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
            jira_server, 'current_jira_session_data', return_value={
                'access_token': 'token', 'expires_at': 4_102_444_800,
            },
        ), patch.object(
            jira_server, 'current_oauth_session_callbacks', return_value={},
        ), patch.object(
            jira_server, 'current_auth_config', return_value=config,
        ), patch.object(
            jira_server._jira_client, 'resilient_jira_get', return_value=upstream,
        ) as resilient_get:
            projects = eng_board_routes._accessible_project_catalog(
                jira_server, context, transport,
            )

        self.assertEqual({'ABC'}, projects)
        self.assertIsInstance(resilient_get.call_args.kwargs['timeout'], (int, float))

    def test_real_current_jira_get_refreshes_db_token_outside_flask_request(self):
        with tempfile.TemporaryDirectory() as directory:
            database_url = f"sqlite+pysqlite:///{os.path.join(directory, 'board-refresh.db')}"
            env = {
                'CONFIG_STORAGE_BACKEND': 'database', 'DATABASE_URL': database_url,
                'TEST_DATABASE_URL': '', 'APP_ENVIRONMENT_KEY': 'local',
                'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([17]) * 32).decode('ascii'),
                'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
            }
            with patch.dict(os.environ, env, clear=False):
                engine = db_engine.get_engine(database_url)
                models.Base.metadata.create_all(engine)
                provider = key_provider_from_env()
                with db_engine.session_scope(database_url) as session:
                    stored = store_oauth_callback_tokens(
                        session,
                        token_data={
                            'access_token': 'expired-access', 'refresh_token': 'refresh-token',
                            'expires_in': 1, 'scope': 'read:jira-work offline_access',
                        },
                        resource={
                            'id': 'cloud-1', 'url': 'https://example.atlassian.net', 'name': 'Example',
                        },
                        user_profile={'account_id': 'account-1', 'account_status': 'active'},
                        environment_key='local', configured_jira_url='https://example.atlassian.net',
                        key_provider=provider,
                    )
                context = RequestAuthContext(
                    auth_mode='atlassian_oauth', user_id=stored.user_id,
                    stable_subject='account-1', atlassian_account_id='account-1',
                    workspace_id=stored.workspace_id, auth_connection_id=stored.connection_id,
                    cloud_id='cloud-1', site_url='https://example.atlassian.net',
                    token_version='1', account_status='active', is_admin=False,
                )
                refresh_response = FakeResponse({
                    'access_token': 'fresh-access', 'refresh_token': 'fresh-refresh',
                    'expires_in': 3600, 'scope': 'read:jira-work offline_access',
                })
                refresh_response.status_code = 200
                jira_response = FakeResponse({'values': [], 'isLast': True})
                jira_response.status_code = 200
                with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), patch.object(
                    jira_server, 'JIRA_URL', 'https://example.atlassian.net',
                ), patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-id'), patch.object(
                    jira_server, 'ATLASSIAN_CLIENT_SECRET', 'client-secret',
                ), patch.object(jira_server.HTTP_SESSION, 'post', return_value=refresh_response), patch.object(
                    jira_server, 'resilient_jira_get', return_value=jira_response,
                ) as jira_get:
                    response = jira_server.current_jira_get(
                        '/rest/api/3/project/search', context=context,
                    )

                self.assertIs(jira_response, response)
                self.assertEqual('Bearer fresh-access', jira_get.call_args.kwargs['headers']['Authorization'])
                with db_engine.session_scope(database_url) as session:
                    connection = session.get(models.AuthConnection, stored.connection_id)
                    self.assertEqual(2, connection.token_version)
            db_engine.dispose_engines()

    def test_route_source_has_no_control_state_migration_or_process_cache(self):
        with open(eng_board_routes.__file__, encoding='utf-8') as source_file:
            source = source_file.read()

        self.assertNotIn("@bp.route('/api/eng/board/", source)
        self.assertNotIn('db.models', source)
        self.assertNotIn('migration', source.casefold())
        self.assertNotIn('BoardGeneration', source)


if __name__ == '__main__':
    unittest.main()
