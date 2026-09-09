import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from flask import Flask

from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AUTH_MODE_BASIC, AuthConfig
from backend.routes import eng_board_routes
from backend.services import eng_board


BOARD_PATH = '/api/eng/board'


class _Response:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def json(self):
        return self.payload


def _query(**overrides):
    value = {
        'departmentId': 'department-a',
        'scope': 'all_work',
        'refresh': '0',
    }
    value.update(overrides)
    return value


def _line(sequence, frame_type, **fields):
    return (json.dumps({
        'protocolVersion': 1,
        'generationId': 'generation-basic',
        'sequence': sequence,
        'type': frame_type,
        **fields,
    }, separators=(',', ':')) + '\n').encode('utf-8')


class _BasicServer:
    JIRA_AUTH_MODE = AUTH_MODE_BASIC
    ATLASSIAN_SCOPES = ''

    def __init__(self, *, board=None):
        self.dashboard = {
            'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
            'issueTypes': ['Story', 'Bug', 'Task'],
        }
        self.groups = {
            'version': 1,
            'groups': [{
                'id': 'department-a',
                'name': 'Department A',
                'teamIds': ['team-a'],
                'missingInfoComponents': ['Component A'],
                **({} if board is None else {'board': board}),
            }],
            'defaultGroupId': 'department-a',
        }
        self.current_auth_config = Mock(return_value=AuthConfig(
            auth_mode=AUTH_MODE_BASIC,
            jira_url='https://jira.invalid',
            jira_email='basic@example.invalid',
            jira_token='synthetic-token',
        ))
        self.current_jira_search = Mock()
        self.current_jira_get = Mock(side_effect=lambda path, **_kwargs: _Response(
            {'values': [{'key': 'PROD'}], 'isLast': True}
            if path == '/rest/api/3/project/search'
            else [
                {'id': '10001', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False},
                {'id': '10002', 'name': 'Bug', 'hierarchyLevel': 0, 'subtask': False},
                {'id': '10003', 'name': 'Task', 'hierarchyLevel': 0, 'subtask': False},
            ] if path == '/rest/api/3/issuetype'
            else []
        ))
        self.load_dashboard_config_snapshot = Mock(return_value=SimpleNamespace(
            payload=self.dashboard, config_revision=0, source='legacy_json'))
        self.load_groups_config_file = Mock(return_value=self.groups)
        self.parse_groups_config_env = Mock(side_effect=AssertionError('file config must win'))
        self.build_default_groups_config = Mock(side_effect=AssertionError('file config must win'))
        self.resolve_groups_config_path = Mock(return_value='/synthetic/groups-config.json')
        self.validate_groups_config = Mock(side_effect=lambda payload, allow_empty=False: (payload, [], []))
        self.db_oauth_session_data_for_auth_context = Mock(
            side_effect=AssertionError('Basic mode entered DB/OAuth token resolution'))


class EngBoardBasicCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'
        self.app.config['TESTING'] = True
        self.app.register_blueprint(eng_board_routes.bp)
        self.client = self.app.test_client()

    def _success_stream(self, _server, snapshot, _transport):
        focused = snapshot.query.focused_column_id or 'todo'
        yield _line(0, 'start', scope=snapshot.query.scope,
                    scopeVersion='scope-basic', scopeCohortDigest='cohort-basic',
                    columns=[{'id': 'todo'}, {'id': 'done'}])
        yield _line(1, 'column', columnId=focused, epics=[], children=[], authoritative=True)
        yield _line(2, 'complete', outcome='success', authoritative=True,
                    epicCount=0, childCount=0, diagnostics={'completeness': 'complete'})

    def test_basic_json_adapter_supports_strict_selected_sprint_and_all_work(self):
        server = _BasicServer(board={'columns': [
            {'id': 'col-11111111', 'name': 'Todo', 'statuses': ['To Do'], 'star': True},
            {'id': 'col-22222222', 'name': 'Done', 'statuses': ['Done']},
        ]})
        seen = []

        transport = Mock()
        transport.budget.jira_timeout.return_value = 1
        for query in (
            eng_board_routes.BoardQuery('department-a', 'sprint', 17, None, False),
            eng_board_routes.BoardQuery('department-a', 'all_work', None, None, False),
        ):
            snapshot = eng_board_routes._capture_basic_snapshot(server, query, transport, b'test-secret')
            seen.append((snapshot.query.scope, snapshot.query.sprint_id))
        self.assertEqual([('sprint', 17), ('all_work', None)], seen)

    def test_basic_json_adapter_reuses_strict_capture_and_stream(self):
        server = _BasicServer(board={'columns': [
            {'id': 'col-11111111', 'name': 'Todo', 'statuses': ['To Do'], 'star': True},
            {'id': 'col-22222222', 'name': 'Done', 'statuses': ['Done']},
        ]})
        server.current_jira_search.return_value = _Response({'issues': [], 'isLast': True})

        transport = eng_board_routes.EngBoardRequestTransport()
        query = eng_board_routes.BoardQuery('department-a', 'all_work', None, None, False)
        snapshot = eng_board_routes._capture_basic_snapshot(server, query, transport, b'test-secret')
        frames = [json.loads(line) for line in eng_board_routes._frame_stream(server, snapshot, transport)]

        self.assertEqual(['start', 'index', 'column', 'column', 'column', 'complete'], [
            frame['type'] for frame in frames
        ])
        self.assertEqual('success', frames[-1]['outcome'])
        self.assertTrue(frames[-1]['authoritative'])
        self.assertGreaterEqual(server.current_jira_search.call_count, 1)
        self.assertTrue(all(
            call.kwargs.get('context') is None
            for call in server.current_jira_search.call_args_list
        ))

    def test_basic_route_fails_closed_until_profile_speed_gate_passes(self):
        server = _BasicServer(board={'columns': [
            {'id': 'col-11111111', 'name': 'Todo', 'statuses': ['To Do']},
        ]})
        with patch.object(eng_board_routes, 'get_jira_server', return_value=server), \
             patch.object(eng_board_routes, 'database_storage_enabled',
                          side_effect=AssertionError('Basic capability must not inspect DB storage')):
            response = self.client.get(BOARD_PATH, query_string=_query())

        self.assertEqual(409, response.status_code)
        self.assertEqual('board_unavailable', response.get_json()['error'])
        server.current_auth_config.assert_not_called()

    def test_absent_board_allows_sprint_but_rejects_all_work(self):
        server = _BasicServer(board=None)
        compat = getattr(eng_board_routes, '_capture_basic_snapshot')
        transport = Mock()
        transport.budget.jira_timeout.return_value = 1

        sprint = eng_board_routes.BoardQuery('department-a', 'sprint', 17, None, False)
        snapshot = compat(server, sprint, transport, b'test-secret')
        self.assertEqual('board-unconfigured', snapshot.board['columns'][0]['id'])

        all_work = eng_board_routes.BoardQuery('department-a', 'all_work', None, None, False)
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_config_invalid'):
            compat(server, all_work, transport, b'test-secret')

    def test_initial_focus_is_frozen_in_the_basic_snapshot(self):
        server = _BasicServer(board={'columns': [
            {'id': 'col-11111111', 'name': 'Todo', 'statuses': ['To Do'], 'star': True},
            {'id': 'col-22222222', 'name': 'Done', 'statuses': ['Done']},
        ]})
        compat = getattr(eng_board_routes, '_capture_basic_snapshot')
        query = eng_board_routes.BoardQuery('department-a', 'all_work', None, 'col-22222222', False)
        snapshot = compat(server, query, Mock(), b'test-secret')

        server.groups['groups'][0]['board']['columns'][0]['star'] = False
        server.groups['groups'][0]['board']['columns'][1]['star'] = True
        self.assertEqual('col-22222222', snapshot.query.focused_column_id)
        self.assertEqual('col-22222222', snapshot.focused_column_id)

    def test_malformed_or_ambiguous_query_is_rejected_before_basic_io(self):
        server = _BasicServer()
        malformed = (
            f'{BOARD_PATH}?departmentId=department-a&scope=sprint&sprintId=017&refresh=0',
            f'{BOARD_PATH}?departmentId=department-a&departmentId=department-b&scope=all_work&refresh=0',
            f'{BOARD_PATH}?departmentId=department-a&scope=all_work&sprintId=17&refresh=0',
            f'{BOARD_PATH}?departmentId=department-a&scope=all_work&refresh=0&project=PROD',
        )
        with patch.object(eng_board_routes, 'get_jira_server', return_value=server):
            responses = [self.client.get(path) for path in malformed]

        self.assertTrue(all(response.status_code == 400 for response in responses))
        server.current_auth_config.assert_not_called()
        server.current_jira_search.assert_not_called()
        server.load_dashboard_config_snapshot.assert_not_called()

    def test_basic_snapshot_uses_only_legacy_json_and_basic_credentials(self):
        server = _BasicServer(board={'columns': [
            {'id': 'col-11111111', 'name': 'Todo', 'statuses': ['To Do']},
        ]})
        compat = getattr(eng_board_routes, '_capture_basic_snapshot')
        query = eng_board_routes.BoardQuery('department-a', 'all_work', None, None, False)

        with patch('backend.db.engine.session_scope',
                   side_effect=AssertionError('Basic mode opened a database session')), \
             patch('backend.config.repository.db_repository',
                   side_effect=AssertionError('Basic mode resolved the DB repository')):
            snapshot = compat(server, query, Mock(), b'test-secret')

        server.current_auth_config.assert_called()
        self.assertEqual(AUTH_MODE_BASIC, server.current_auth_config.return_value.auth_mode)
        server.load_dashboard_config_snapshot.assert_called_with(source='jsonfile')
        self.assertGreaterEqual(server.load_groups_config_file.call_count, 2)
        self.assertTrue(all(
            call.args == ('/synthetic/groups-config.json',)
            for call in server.load_groups_config_file.call_args_list
        ))
        server.db_oauth_session_data_for_auth_context.assert_not_called()

    def test_db_oauth_dispatch_never_falls_back_to_basic_or_json(self):
        server = SimpleNamespace(
            JIRA_AUTH_MODE=AUTH_MODE_ATLASSIAN_OAUTH,
            ATLASSIAN_SCOPES='read:jira-work',
            build_jira_headers=Mock(side_effect=AssertionError('OAuth route resolved Basic credentials')),
            _load_dashboard_config_json=Mock(side_effect=AssertionError('OAuth route used JSON dashboard')),
            load_groups_config_file=Mock(side_effect=AssertionError('OAuth route used JSON groups')),
            parse_groups_config_env=Mock(side_effect=AssertionError('OAuth route used group env fallback')),
        )
        sentinel = SimpleNamespace(query=eng_board_routes.BoardQuery(
            'department-a', 'all_work', None, None, False))
        with patch.object(eng_board_routes, 'get_jira_server', return_value=server), \
             patch.object(eng_board_routes, 'database_storage_enabled', return_value=True), \
             patch.object(eng_board_routes, '_capture_snapshot', return_value=sentinel), \
             patch.object(eng_board_routes, '_frame_stream', side_effect=self._success_stream):
            response = self.client.get(BOARD_PATH, query_string=_query())

        self.assertEqual(200, response.status_code, response.get_data(as_text=True))
        server.build_jira_headers.assert_not_called()
        server._load_dashboard_config_json.assert_not_called()
        server.load_groups_config_file.assert_not_called()
        server.parse_groups_config_env.assert_not_called()

    def test_config_reload_invalidates_old_basic_snapshot_at_checkpoints(self):
        server = _BasicServer(board={'columns': [
            {'id': 'col-11111111', 'name': 'Todo', 'statuses': ['To Do']},
        ]})
        compat = getattr(eng_board_routes, '_capture_basic_snapshot')
        assert_current = getattr(eng_board_routes, '_assert_basic_snapshot_current')
        query = eng_board_routes.BoardQuery('department-a', 'all_work', None, None, False)
        snapshot = compat(server, query, Mock(), b'test-secret')

        server.groups['groups'][0]['teamIds'] = ['team-b']
        with self.assertRaises(eng_board_routes.BoardScopeChanged):
            assert_current(server, snapshot, checkpoint='before_column_publication')
        with self.assertRaises(eng_board_routes.BoardScopeChanged):
            assert_current(server, snapshot, checkpoint='before_terminal_completion')

    def test_basic_credential_rotation_invalidates_without_oauth_fallback(self):
        server = _BasicServer(board={'columns': [
            {'id': 'col-11111111', 'name': 'Todo', 'statuses': ['To Do']},
        ]})
        query = eng_board_routes.BoardQuery('department-a', 'all_work', None, None, False)
        snapshot = eng_board_routes._capture_basic_snapshot(server, query, Mock(), b'test-secret')

        server.current_auth_config.return_value.jira_token = 'rotated-synthetic-token'
        with self.assertRaises(eng_board_routes.BoardScopeChanged):
            eng_board_routes._assert_basic_snapshot_current(
                server, snapshot, checkpoint='before_terminal_completion',
            )
        server.db_oauth_session_data_for_auth_context.assert_not_called()

    def test_basic_adapter_source_has_no_database_or_oauth_token_store_dependency(self):
        source = (Path(__file__).parents[1] / 'backend/services/eng_board_basic.py').read_text(
            encoding='utf-8',
        )
        for forbidden in (
            'backend.db', 'session_scope', 'db_repository',
            'oauth_session_data', 'auth_tokens', 'DATABASE_URL',
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_abort_or_replacement_stops_basic_work_at_cooperative_checkpoint(self):
        server = _BasicServer()
        checkpoint = getattr(eng_board_routes, '_basic_request_checkpoint')
        budget = Mock()
        budget.cancelled.is_set.return_value = True
        snapshot = SimpleNamespace(scope_version='old-scope')

        with self.assertRaises(eng_board_routes.EngBoardRequestDeadline):
            checkpoint(server, snapshot, budget, phase='child_page')
        budget.check.assert_not_called()
        server.current_jira_search.assert_not_called()


if __name__ == '__main__':
    unittest.main()
