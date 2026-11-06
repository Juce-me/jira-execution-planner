import unittest
from unittest.mock import patch

from copy import deepcopy

from backend.db import engine as db_engine, models
from tests.auth_mode_test_utils import force_db_oauth_mode
from tests.test_work_structure_routes import WorkStructureRouteBase, jira_response

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover - depends on local test env deps
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestBoardConfigApi(unittest.TestCase):
    def setUp(self):
        force_db_oauth_mode(self, jira_server)

    def test_get_effective_board_id_prefers_workspace_config_over_env(self):
        with db_engine.session_scope() as db:
            row = db.query(models.WorkspaceDashboardConfig).filter_by(
                workspace_id=self.db_actor.workspace_id).one()
            row.payload = {**row.payload, 'board': {'boardId': '999', 'boardName': 'Ops Board'}}
        with patch.object(jira_server, 'JIRA_BOARD_ID', '5715'):
            self.assertEqual(jira_server.get_effective_board_id(), '999')
            board_cfg = jira_server.get_board_config()
            self.assertEqual(board_cfg['source'], 'config')
            self.assertEqual(board_cfg['boardName'], 'Ops Board')

    def test_board_config_api_saves_and_invalidates_process_caches(self):
        client = jira_server.app.test_client()
        before = client.get('/api/board-config').get_json()
        with patch.object(jira_server, 'TASKS_CACHE', {'dummy': {'value': 1}}), \
             patch.object(jira_server, 'SPRINTS_PROCESS_CACHE', {'dummy': {'value': 1}}):
            response = client.post('/api/board-config', json={
                'boardId': '5715', 'boardName': 'Planning Board', 'baseRevision': before['configRevision'],
            })
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            payload = response.get_json()
            self.assertEqual(payload['boardId'], '5715')
            self.assertEqual(payload['boardName'], 'Planning Board')
            self.assertEqual(payload['configRevision'], before['configRevision'] + 1)
            self.assertEqual(jira_server.TASKS_CACHE, {})
            self.assertEqual(jira_server.SPRINTS_PROCESS_CACHE, {})
            get_response = client.get('/api/board-config')
            self.assertEqual(get_response.status_code, 200)
            self.assertEqual(get_response.get_json(), payload)
        with db_engine.session_scope() as db:
            row = db.query(models.WorkspaceDashboardConfig).one()
            self.assertEqual(row.payload['board'], {'boardId': '5715', 'boardName': 'Planning Board'})
            self.assertEqual(row.config_revision, payload['configRevision'])

    def test_stale_board_write_preserves_the_saved_workspace_config(self):
        client = jira_server.app.test_client()
        before = client.get('/api/board-config').get_json()
        saved = client.post('/api/board-config', json={
            'boardId': '5715', 'boardName': 'Planning Board', 'baseRevision': before['configRevision'],
        })
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        stale = client.post('/api/board-config', json={
            'boardId': '999', 'boardName': 'Stale Board', 'baseRevision': before['configRevision'],
        })
        self.assertEqual(stale.status_code, 409, stale.get_data(as_text=True))
        self.assertEqual(client.get('/api/board-config').get_json(), saved.get_json())


PROJECT_STATUSES = [
    {'id': '10001', 'name': 'Initiative', 'statuses': [{'id': '11', 'name': 'Discovery'}]},
    {'id': '10000', 'name': 'Epic', 'statuses': [{'id': '12', 'name': 'To Do'}]},
]


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestPromotedBoardStatusesApi(WorkStructureRouteBase):
    def statuses(self, entry_id, revision):
        with patch.object(jira_server, 'current_jira_get', return_value=jira_response(200, PROJECT_STATUSES)) as getter:
            response = self.client.get('/api/board-config/statuses', query_string={
                'configurationId': entry_id, 'configurationRevision': str(revision)})
        return response, getter

    def test_promoted_statuses_need_projects_but_no_board(self):
        def mutate(bundle):
            delivery = bundle['configurations'][1]
            delivery['scope'] = {'projects': [{'key': 'PLAN', 'type': 'other'}], 'boardId': ''}
            delivery['hierarchy']['parentIssueTypeId'] = '10001'
        self.seed(mutate=mutate)
        response, getter = self.statuses('delivery', 1)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertIsNone(body['boardId'])
        self.assertEqual(body['statuses'], [{'id': '11', 'name': 'Discovery'}])
        self.assertEqual(getter.call_count, 1, 'no board location fallback request')
        self.assertEqual(getter.call_args.args[0], '/rest/api/3/project/PLAN/statuses')

    def test_same_board_and_projects_with_different_parent_mapping_is_a_different_identity(self):
        def mutate(bundle):
            legacy = bundle['configurations'][0]
            legacy['scope'] = {'projects': [{'key': 'OLD', 'type': 'product'}], 'boardId': '7001'}
        self.seed(mutate=mutate)
        compat, _ = self.statuses('legacy', 1)
        self.assertEqual(compat.get_json()['statuses'], [{'id': '12', 'name': 'To Do'}])
        with self.factory() as session:
            from backend.db import models
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            legacy = payload['workConfigurations']['configurations'][0]
            legacy['legacyHierarchyModes']['parent'] = 'mapped'
            legacy['hierarchy']['parentIssueTypeId'] = '10001'
            legacy['revision'] = 2
            row.payload = payload
            session.commit()
        mapped, _ = self.statuses('legacy', 2)
        self.assertEqual(mapped.get_json()['statuses'], [{'id': '11', 'name': 'Discovery'}])
        self.assertEqual((compat.get_json()['boardId'], compat.get_json()['projectKeys']),
                         (mapped.get_json()['boardId'], mapped.get_json()['projectKeys']))
        self.assertNotEqual(compat.get_json()['configurationDigest'], mapped.get_json()['configurationDigest'])
        stale, _ = self.statuses('legacy', 1)
        self.assertEqual((stale.status_code, stale.get_json()['error']), (409, 'configuration_scope_changed'))


if __name__ == '__main__':
    unittest.main()
