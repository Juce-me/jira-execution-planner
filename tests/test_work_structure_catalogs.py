"""Task 3A/3B: configuration Sprint sources, Team publication without a Board row, selectors."""

import unittest
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import flask

import jira_server
from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine
from backend.db import models
from backend.services import sprints as sprints_service
from backend.services import work_structure as ws
from backend.services.catalog_refresh_runtime import (
    CatalogRefreshBudget,
    CatalogRefreshRuntime,
    reset_catalog_refresh_runtime_for_tests,
)
from backend.services.workspace_catalog_cache import (
    SCOPED_SPRINT_CATALOGS,
    ScopedSprintCatalogStore,
    capture_sprint_proof,
    claim_catalog_refresh,
    publish_catalog,
)
from backend.services.workspace_catalog_config import (
    build_projection_identity,
    resolve_catalog_sources,
    resolve_configuration_catalog_config,
    team_scope_digest,
)
from tests.test_work_structure_routes import WorkStructureRouteBase, jira_response

BOARD_PATH = '/rest/agile/1.0/board/7001/sprint'
DELIVERY_SPRINT_FIELD = 'customfield_26'
DELIVERY_TEAM_FIELD = 'customfield_24'
LEGACY_TEAM_FIELD = 'customfield_30101'


def sprint_value(sprint_id, name, state='active'):
    return {'id': sprint_id, 'name': name, 'state': state,
            'startDate': '2027-01-01T00:00:00.000Z', 'endDate': '2027-03-31T00:00:00.000Z'}


def board_page(values):
    return {'values': values, 'isLast': True, 'startAt': 0, 'maxResults': 100}


def issue(**fields):
    return {'key': 'PLAN-1', 'fields': fields}


class FakeJira:
    """Routes Board GETs and enhanced searches to scripted responses; records every JQL."""

    def __init__(self, *, board_values=None, scan_pages=None, team_pages=None):
        self.board_values = board_values if board_values is not None else []
        self.scan_pages = scan_pages if scan_pages is not None else [
            {'issues': [], 'isLast': True}]
        self.team_pages = team_pages if team_pages is not None else [
            {'issues': [], 'isLast': True}]
        self.search_jql = []
        self.board_calls = 0
        self.request_contexts = []

    def get(self, path, *, params=None, timeout=30, context=None, diagnostic_transport=None):
        self.request_contexts.append(flask.has_request_context())
        if path == BOARD_PATH:
            self.board_calls += 1
            if isinstance(self.board_values, int):
                return jira_response(self.board_values, {})
            return jira_response(200, board_page(self.board_values))
        raise AssertionError(f'unexpected GET {path}')

    def search(self, payload, *, context=None, timeout=30, diagnostic_transport=None):
        self.request_contexts.append(flask.has_request_context())
        self.search_jql.append(payload['jql'])
        pages = self.team_pages if 'Team' in str(payload.get('fields')) or any(
            field == DELIVERY_TEAM_FIELD or field == LEGACY_TEAM_FIELD
            for field in payload.get('fields', [])) else self.scan_pages
        index = 1 if payload.get('nextPageToken') else 0
        page = pages[min(index, len(pages) - 1)]
        if isinstance(page, int):
            return jira_response(page, {})
        return jira_response(200, page)


class CatalogBase(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        reset_catalog_refresh_runtime_for_tests()
        SCOPED_SPRINT_CATALOGS.clear()
        self.addCleanup(reset_catalog_refresh_runtime_for_tests)
        self.addCleanup(SCOPED_SPRINT_CATALOGS.clear)
        # Promoted catalog/Team paths must never reach an ambient getter or JSON loader.
        for name in ('load_dashboard_config', 'load_dashboard_config_snapshot', 'get_board_config',
                     'get_effective_board_id', 'get_selected_projects', 'build_base_jql'):
            self.stack.enter_context(patch.object(
                jira_server, name, side_effect=AssertionError(f'ambient getter {name}')))
        self.stack.enter_context(patch.object(jira_server, 'JQL_QUERY', ''))

    def seed_sources(self, *, delivery_ready=True, legacy_ready=True):
        def mutate(bundle):
            legacy, delivery = bundle['configurations']
            if legacy_ready:
                legacy['scope'].update(projects=[{'key': 'OLD', 'type': 'product'}], boardId='7001')
                legacy['fields']['team'] = {'fieldId': LEGACY_TEAM_FIELD, 'fieldName': 'Team'}
            else:
                legacy['scope'].update(projects=[], boardId='')
            if delivery_ready:
                delivery['scope']['projects'] = [{'key': 'PLAN', 'type': 'other'}]
                delivery['hierarchy'].update(planningIssueTypeId='10002', parentIssueTypeId='10001')
                delivery['fields']['sprint'] = {'fieldId': DELIVERY_SPRINT_FIELD, 'fieldName': 'Sprint'}
                delivery['fields']['storyPoints'] = {'fieldId': 'customfield_211', 'fieldName': 'SP'}
                delivery['fields']['team'] = {'fieldId': DELIVERY_TEAM_FIELD, 'fieldName': 'Team'}
        return self.seed(mutate=mutate)

    def jira(self, fake):
        self.stack.enter_context(patch.object(jira_server, 'current_jira_get', side_effect=fake.get))
        self.stack.enter_context(patch.object(jira_server, 'current_jira_search', side_effect=fake.search))
        return fake

    def sprints(self, query=''):
        return self.client.get('/api/sprints' + query)

    def worker_context(self):
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.admin_connection)
            user = session.get(models.User, connection.user_id)
            scopes = tuple(jira_server.ATLASSIAN_SCOPES.split())
            return RequestAuthContext(
                auth_mode='atlassian_oauth', user_id=user.id, stable_subject=user.external_subject,
                atlassian_account_id=user.external_subject, workspace_id=self.workspace_id,
                auth_connection_id=connection.id, cloud_id='cloud-one',
                site_url='https://one.example.test', token_version='1', account_status='active',
                is_admin=True, granted_scopes=scopes, granted_scopes_verified=True,
            )

    def sources(self, **kwargs):
        with self.factory() as session:
            return resolve_catalog_sources(
                session, self.worker_context(),
                runtime_inputs=jira_server.catalog_runtime_inputs(), **kwargs)


class SourceCatalogTests(CatalogBase):
    def test_board_and_issue_sources_merge_in_range_with_original_ids(self):
        self.seed_sources()
        fake = self.jira(FakeJira(
            board_values=[
                {**sprint_value(101, '2026Q4', 'closed'), 'originBoardId': 7001},
                # Physical Board row of the other era: never admitted through Legacy.
                {**sprint_value(102, '2027Q1', 'future'), 'originBoardId': 7001},
            ],
            scan_pages=[{'issues': [
                issue(**{DELIVERY_SPRINT_FIELD: [sprint_value(201, '2027Q1'),
                                                 sprint_value(150, '2027Q1', 'closed'),
                                                 sprint_value(7, 'Not a quarter')]}),
                issue(**{DELIVERY_SPRINT_FIELD: None}),
            ], 'isLast': True}],
        ))
        response = self.sprints()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(
            [(row['id'], row['name'], row['configurationId']) for row in body['sprints']],
            [(201, '2027Q1', 'delivery'), (101, '2026Q4', 'legacy')])
        self.assertEqual({row['sourceIdentity'] for row in body['sprints']},
                         {item['cache']['identity'] for item in body['sources']})
        self.assertEqual([item['sourceMode'] for item in body['sources']], ['board', 'scoped_issues'])
        self.assertEqual(body['cache']['state'], 'fresh')
        self.assertIsNone(body['cache']['refreshAttemptId'])
        self.assertEqual(len(fake.search_jql), 1, 'Legacy keeps Board-only discovery')
        self.assertIn('"PLAN"', fake.search_jql[0])
        self.assertIn('cf[26] is not EMPTY', fake.search_jql[0])
        with self.factory() as session:
            boards = [row.board_id for row in session.query(models.WorkspaceSprintCatalog)]
        self.assertEqual(boards, ['7001'], 'no fake Board row for the issue source')

    def test_same_name_retained_id_is_unchanged_active_closed_future_then_lowest_id(self):
        pages = [{'issues': [issue(**{DELIVERY_SPRINT_FIELD: [
            sprint_value(300, '2027Q1', 'future'), sprint_value(210, '2027Q1', 'closed'),
            sprint_value(200, '2027Q1', 'closed'), sprint_value(250, '2027Q1', 'active'),
        ]})], 'isLast': True}]
        budget = CatalogRefreshBudget.start(30)
        rows = sprints_service.fetch_scoped_issue_sprints(
            base_jql='(project in ("PLAN"))', sprint_field_id=DELIVERY_SPRINT_FIELD,
            jira_search=lambda payload: jira_response(200, pages[0]), budget=budget)
        self.assertEqual([row['id'] for row in rows], [250], 'only the retained id is queried')
        pages[0]['issues'][0]['fields'][DELIVERY_SPRINT_FIELD] = [
            sprint_value(210, '2027Q1', 'closed'), sprint_value(200, '2027Q1', 'closed')]
        rows = sprints_service.fetch_scoped_issue_sprints(
            base_jql='(project in ("PLAN"))', sprint_field_id=DELIVERY_SPRINT_FIELD,
            jira_search=lambda payload: jira_response(200, pages[0]), budget=budget)
        self.assertEqual([row['id'] for row in rows], [200])

    def test_complete_empty_scan_is_authoritative_and_unobserved_quarters_have_no_id(self):
        self.seed_sources(legacy_ready=False)
        self.jira(FakeJira(scan_pages=[{'issues': [], 'isLast': True}]))
        response = self.sprints('?configurationId=delivery')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['sprints'], [])
        self.assertEqual(body['sources'][0]['state'], 'ready')
        self.assertEqual(body['sources'][0]['sprintCount'], 0)
        self.assertEqual(body['cache']['configurationId'], 'delivery')
        for query in ('?sprint=201', '?sprint=201&quarter=2027Q1', '?sprint=201&quarter=2027Q2'):
            teams = self.client.get('/api/teams' + query)
            self.assertEqual(teams.status_code, 409, teams.get_data(as_text=True))
            self.assertEqual(teams.get_json()['error'], 'sprint_catalog_mismatch')

    def test_partial_and_error_scans_are_never_published(self):
        self.seed_sources(legacy_ready=False)
        failures = {
            'missing continuation': [{'issues': [issue()], 'isLast': False}],
            'repeated token': [{'issues': [issue()], 'isLast': False, 'nextPageToken': 'a'},
                               {'issues': [issue()], 'isLast': False, 'nextPageToken': 'a'}],
            'last page with token': [{'issues': [], 'isLast': True, 'nextPageToken': 'a'}],
            'not a list': [{'issues': {}, 'isLast': True}],
            'unstructured sprint': [{'issues': [issue(**{DELIVERY_SPRINT_FIELD: ['x']})], 'isLast': True}],
            'bad sprint id': [{'issues': [issue(**{DELIVERY_SPRINT_FIELD: [
                {'id': 'x', 'name': '2027Q1'}]})], 'isLast': True}],
            'http error': [500],
        }
        for label, pages in failures.items():
            with self.subTest(label), patch.object(jira_server, 'current_jira_search') as search:
                SCOPED_SPRINT_CATALOGS.clear()
                fake = FakeJira(scan_pages=pages)
                search.side_effect = fake.search
                response = self.sprints('?configurationId=delivery&refresh=true')
                self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'sprint_catalog_unavailable')
                self.assertIn(response.get_json()['sources'][0]['code'],
                              {'catalog_incomplete', 'jira_unavailable'})
                self.assertIsNone(SCOPED_SPRINT_CATALOGS.snapshot(
                    self.sources()[1].sprint_identity).payload)

    def test_oversized_scope_fails_closed_instead_of_publishing_partial(self):
        with self.assertRaises(sprints_service.SprintCatalogFetchError) as raised:
            sprints_service.fetch_scoped_issue_sprints(
                base_jql='project in (' + ','.join(f'"P{i}"' for i in range(1500)) + ')',
                sprint_field_id=DELIVERY_SPRINT_FIELD,
                jira_search=Mock(side_effect=AssertionError('sent an unsendable page two')),
                budget=CatalogRefreshBudget.start(30))
        self.assertEqual(raised.exception.code, 'catalog_incomplete')

    def test_scan_follows_continuation_tokens_and_is_bounded(self):
        calls = []

        def search(payload):
            calls.append(payload.get('nextPageToken'))
            if not payload.get('nextPageToken'):
                return jira_response(200, {'issues': [issue(**{DELIVERY_SPRINT_FIELD: [
                    sprint_value(1, '2027Q1')]})], 'isLast': False, 'nextPageToken': 'tok1'})
            return jira_response(200, {'issues': [issue(**{DELIVERY_SPRINT_FIELD: [
                sprint_value(2, '2027Q2')]})], 'isLast': True})

        rows = sprints_service.fetch_scoped_issue_sprints(
            base_jql='(project in ("PLAN"))', sprint_field_id=DELIVERY_SPRINT_FIELD,
            jira_search=search, budget=CatalogRefreshBudget.start(30))
        self.assertEqual(calls, [None, 'tok1'])
        self.assertEqual([row['name'] for row in rows], ['2027Q2', '2027Q1'])

    def test_failed_source_keeps_other_era_and_prior_snapshot(self):
        self.seed_sources()
        fake = self.jira(FakeJira(
            board_values=[{**sprint_value(101, '2026Q4', 'closed'), 'originBoardId': 7001}],
            scan_pages=[500]))
        merged = self.sprints()
        self.assertEqual(merged.status_code, 200, merged.get_data(as_text=True))
        body = merged.get_json()
        self.assertEqual([row['id'] for row in body['sprints']], [101])
        states = {item['configurationId']: item['state'] for item in body['sources']}
        self.assertEqual(states, {'legacy': 'ready', 'delivery': 'failed'})
        self.assertTrue(body['cache']['refreshFailed'])
        delivery = self.sources()[1]
        # A good scan, then a forced failing one: the matching prior snapshot survives.
        fake.scan_pages = [{'issues': [issue(**{DELIVERY_SPRINT_FIELD: [sprint_value(201, '2027Q1')]})],
                            'isLast': True}]
        self.assertEqual(self.sprints('?configurationId=delivery&refresh=true').status_code, 200)
        version = SCOPED_SPRINT_CATALOGS.snapshot(delivery.sprint_identity).catalog_version
        fake.scan_pages = [500]
        failed = self.sprints('?configurationId=delivery&refresh=true')
        self.assertEqual(failed.status_code, 200, 'last good payload still serves')
        self.assertEqual(failed.get_json()['cache']['catalogVersion'], version)
        self.assertEqual(failed.get_json()['cache']['failureCode'], 'jira_unavailable')
        self.assertEqual(failed.get_json()['sprints'][0]['id'], 201)

    def test_blank_source_is_setup_required_and_does_not_lock_the_other_era(self):
        self.seed_sources(delivery_ready=False)
        self.jira(FakeJira(board_values=[{**sprint_value(101, '2026Q4', 'closed'), 'originBoardId': 7001}]))
        body = self.sprints().get_json()
        delivery = next(item for item in body['sources'] if item['configurationId'] == 'delivery')
        self.assertEqual(delivery['state'], 'setup_required')
        self.assertIn('scope.projects', delivery['missingFields'])
        self.assertEqual([row['id'] for row in body['sprints']], [101])
        self.seed_blank_row()
        response = self.sprints()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['error'], 'configuration_incomplete')

    def seed_blank_row(self):
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            legacy = payload['workConfigurations']['configurations'][0]
            legacy['scope'].update(projects=[], boardId='')
            row.payload = payload
            session.commit()

    def test_global_jql_override_precedes_project_chips_in_both_modes(self):
        self.seed_sources()
        for override, expected in (('', 'project in ("PLAN")'),
                                   ('project = OVERRIDE AND status != Done ORDER BY rank',
                                    'project = OVERRIDE')):
            with self.subTest(override=override):
                SCOPED_SPRINT_CATALOGS.clear()
                fake = self.jira(FakeJira(scan_pages=[{'issues': [], 'isLast': True}]))
                with patch.object(jira_server, 'JQL_QUERY', override):
                    sources = self.sources()
                    self.assertIn(expected, sources[1].base_jql)
                    self.assertIn(expected.split(' ')[0] + ' ' + expected.split(' ')[1], sources[0].base_jql)
                    self.assertEqual(sources[0].projects, ('OLD',))
                    self.assertNotIn('ORDER BY', sources[1].base_jql.upper())
                    self.sprints('?configurationId=delivery&refresh=true')
                self.assertIn(expected, fake.search_jql[-1])

    def test_override_with_only_team_or_sprint_clauses_is_unsupported_not_unscoped(self):
        self.seed_sources(legacy_ready=False)
        with patch.object(jira_server, 'JQL_QUERY', 'Sprint = 5'):
            delivery = self.sources()[1]
            self.assertEqual(delivery.scope_error, 'team_scope_unsupported')
            self.assertIsNone(delivery.sprint_identity)
            response = self.sprints('?configurationId=delivery')
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.get_json()['sources'][0]['code'], 'team_scope_unsupported')

    def test_identity_changes_with_mapping_scope_and_partition_but_not_name(self):
        self.seed_sources()
        before = self.sources()
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            legacy, delivery = payload['workConfigurations']['configurations']
            legacy['fields']['sprint']['fieldId'] = 'customfield_999'   # same Board, new mapping
            delivery['name'] = 'Renamed'
            row.payload = payload
            session.commit()
        after = self.sources()
        self.assertEqual(before[0].sprint_identity, after[0].sprint_identity, 'Board row identity is stable')
        self.assertNotEqual(before[0].source_digest, after[0].source_digest)
        self.assertNotEqual(build_projection_identity(before[0]), build_projection_identity(after[0]))
        self.assertNotEqual(before[0].config_digest, after[0].config_digest)
        self.assertEqual(before[1].sprint_identity, after[1].sprint_identity, 'rename keeps the scan')
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            payload['workConfigurations']['configurations'][1]['fields']['sprint']['fieldId'] = 'customfield_27'
            row.payload = payload
            session.commit()
        self.assertNotEqual(before[1].sprint_identity, self.sources()[1].sprint_identity)
        other_actor = self.worker_context().__class__(**{
            **self.worker_context().__dict__, 'auth_connection_id': 'someone-else'})
        with self.factory() as session:
            partitioned = resolve_catalog_sources(
                session, other_actor, runtime_inputs=jira_server.catalog_runtime_inputs())
        self.assertNotEqual(self.sources()[1].sprint_identity, partitioned[1].sprint_identity)

    def test_changed_board_mapping_retires_the_in_flight_publication(self):
        self.seed_sources(delivery_ready=False)
        context = self.worker_context()
        budget = CatalogRefreshBudget.start(30)
        legacy = self.sources()[0]
        claim = claim_catalog_refresh(
            context, kind='sprints', expected_config=legacy, owner=str(uuid.uuid4()), budget=budget,
            resolve_config=jira_server.catalog_configuration_resolver('legacy'),
            database_url=self.database_url)
        self.assertIsNotNone(claim)
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            payload['workConfigurations']['configurations'][0]['fields']['sprint']['fieldId'] = 'customfield_999'
            row.payload = payload
            session.commit()
        published = publish_catalog(
            context, claim=claim, payload=[{'id': 101, 'name': '2026Q4'}], budget=budget,
            resolve_config=jira_server.catalog_configuration_resolver('legacy'),
            database_url=self.database_url)
        self.assertFalse(published)

    def test_json_loaders_never_run_and_flag_off_blocks_promoted_catalogs(self):
        self.seed_sources()
        self.jira(FakeJira(board_values=[], scan_pages=[{'issues': [], 'isLast': True}]))
        self.assertEqual(self.sprints().status_code, 200)
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()
        with patch.dict('os.environ', {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            for path in ('/api/sprints', '/api/teams?sprint=1', '/api/teams/all?quarter=2027Q1'):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 409, path)
                self.assertEqual(response.get_json()['error'], 'configuration_feature_disabled')


class UnpromotedByteIdenticalTests(CatalogBase):
    def test_unpromoted_selectors_are_unsupported(self):
        self.seed(promoted=False)
        for path in ('/api/sprints?configurationId=legacy', '/api/sprints?quarter=2027Q1'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 400, path)
            self.assertEqual(response.get_json(), {'error': 'unsupported_catalog_parameter'})
        for path in ('/api/teams?sprint=1&configurationId=legacy', '/api/teams?sprint=1&quarter=2027Q1'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 400, path)
            self.assertEqual(response.get_json(), {'error': 'unsupported_catalog_parameter'})


class SelectorTests(CatalogBase):
    def setUp(self):
        super().setUp()
        self.seed_sources()
        self.fake = self.jira(FakeJira(
            board_values=[{**sprint_value(101, '2026Q4', 'closed'), 'originBoardId': 7001}],
            scan_pages=[{'issues': [issue(**{DELIVERY_SPRINT_FIELD: [sprint_value(201, '2027Q1')]})],
                         'isLast': True}],
            team_pages=[{'issues': [issue(**{DELIVERY_TEAM_FIELD: {'id': 't-1', 'name': 'Alpha'}})],
                         'isLast': True}]))
        self.assertEqual(self.sprints().status_code, 200)

    def test_sprints_selector_codes(self):
        for query, status, code in (
            ('?configurationId=bad%20id', 400, 'invalid_configuration_id'),
            ('?configurationId=a&configurationId=b', 400, 'invalid_configuration_id'),
            ('?configurationId=nope', 409, 'sprint_catalog_mismatch'),
            (f'?configurationId=legacy&completionAttemptId={uuid.uuid4()}', 400, 'invalid_catalog_completion'),
            (f'?completionAttemptId={uuid.uuid4()}&catalogIdentity=x', 400, 'invalid_catalog_completion'),
            ('?unknown=1', 400, 'unsupported_catalog_parameter'),
        ):
            with self.subTest(query):
                response = self.sprints(query)
                self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], code)

    def test_teams_selector_codes_and_required_numeric_sprint(self):
        for query, status, code in (
            ('', 400, 'sprint_required'),
            ('?sprint=abc', 400, 'invalid_sprint'),
            ('?sprint=201&quarter=2027q1', 400, 'invalid_quarter'),
            ('?sprint=201&quarter=2027Q1&quarter=2027Q2', 400, 'invalid_quarter'),
            ('?sprint=201&configurationId=bad%20id', 400, 'invalid_configuration_id'),
            ('?sprint=201&configurationId=nope', 409, 'sprint_catalog_mismatch'),
            ('?sprint=201&configurationId=legacy', 409, 'sprint_catalog_mismatch'),
            ('?sprint=101&configurationId=delivery', 409, 'sprint_catalog_mismatch'),
            ('?sprint=201&quarter=2026Q4', 409, 'sprint_catalog_mismatch'),
            ('?sprint=201&quarter=2027Q2', 409, 'sprint_catalog_mismatch'),
            ('?sprint=102', 409, 'sprint_catalog_mismatch'),
            ('?sprintName=2027Q1', 400, 'unsupported_catalog_parameter'),
        ):
            with self.subTest(query):
                response = self.client.get('/api/teams' + query)
                self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], code)

    def test_requested_quarter_is_never_replaced_by_another_era(self):
        # The delivery Sprint id is unavailable to a Legacy-quarter request, and vice versa.
        legacy = self.client.get('/api/teams?sprint=201&quarter=2026Q4')
        delivery = self.client.get('/api/teams?sprint=101&quarter=2027Q1')
        self.assertEqual((legacy.status_code, delivery.status_code), (409, 409))
        ok = self.client.get('/api/teams?sprint=201&quarter=2027Q1&configurationId=delivery')
        self.assertEqual(ok.status_code, 200, ok.get_data(as_text=True))
        self.assertEqual(ok.get_json()['configurationId'], 'delivery')
        self.assertEqual(ok.get_json()['quarter'], '2027Q1')

    def test_pending_catalog_keeps_the_existing_pending_contract(self):
        SCOPED_SPRINT_CATALOGS.clear()
        response = self.client.get('/api/teams?sprint=201&configurationId=delivery')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {'error': 'sprint_catalog_pending'})

    def test_teams_all_requires_context_then_uses_the_admitted_scope_only(self):
        missing = self.client.get('/api/teams/all')
        self.assertEqual(missing.status_code, 409, missing.get_data(as_text=True))
        self.assertEqual(missing.get_json()['error'], 'configuration_required')
        for query, status, code in (
            ('?quarter=bad', 400, 'invalid_quarter'),
            ('?configurationId=bad%20id', 400, 'invalid_configuration_id'),
            ('?sprint=999', 409, 'sprint_catalog_mismatch'),
            ('?sprint=201&configurationId=legacy', 409, 'sprint_catalog_mismatch'),
        ):
            with self.subTest(query):
                response = self.client.get('/api/teams/all' + query)
                self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], code)
        with patch.object(jira_server, 'jira_search_request') as search:
            search.side_effect = lambda payload, **kwargs: self.fake.search(payload)
            quarter = self.client.get('/api/teams/all?quarter=2027Q1')
            sprint = self.client.get('/api/teams/all?sprint=201')
        self.assertEqual(quarter.status_code, 200, quarter.get_data(as_text=True))
        self.assertEqual(quarter.get_json()['teams'], [{'id': 't-1', 'name': 'Alpha'}])
        self.assertEqual(sprint.status_code, 200, sprint.get_data(as_text=True))
        self.assertIn('"PLAN"', self.fake.search_jql[-2])
        self.assertIn('cf[26] = 201', self.fake.search_jql[-1])
        self.assertNotIn('Sprint', self.fake.search_jql[-2])


DELIVERY_BOARD_PATH = '/rest/agile/1.0/board/19095/sprint'


class ObservedOnBoardConfigurationTests(CatalogBase):
    """A Board-mode quarterly configuration also admits Sprints its scoped Epics carry."""

    def setUp(self):
        super().setUp()
        self.seed_sources()
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            legacy, delivery = payload['workConfigurations']['configurations']
            legacy['throughQuarter'], delivery['fromQuarter'] = '2026Q3', '2026Q4'
            delivery['scope']['boardId'] = '19095'
            row.payload = payload
            session.commit()
        self.epic_scan = [{'issues': [
            {'key': 'PLAN-7', 'fields': {DELIVERY_SPRINT_FIELD: [sprint_value(45459, '2027Q1', 'future')]}},
        ], 'isLast': True}]

    def jira_with_delivery_board(self, delivery_values, **kwargs):
        fake = FakeJira(board_values=[{**sprint_value(101, '2026Q3', 'closed'), 'originBoardId': 7001}], **kwargs)
        plain_get = fake.get

        def get(path, **options):
            if path == DELIVERY_BOARD_PATH:
                fake.board_calls += 1
                return jira_response(200, board_page(delivery_values))
            return plain_get(path, **options)
        fake.get = get
        return self.jira(fake)

    def test_sprint_on_epics_but_not_on_the_board_is_admitted(self):
        fake = self.jira_with_delivery_board(
            [{**sprint_value(99, '2026Q4', 'closed'), 'originBoardId': 19095}], scan_pages=self.epic_scan)
        response = self.sprints('?configurationId=delivery')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual([(row['id'], row['name']) for row in body['sprints']],
                         [(45459, '2027Q1'), (99, '2026Q4')])
        self.assertEqual(body['sources'][0]['sourceMode'], 'board')
        self.assertEqual({row['sourceIdentity'] for row in body['sprints']}, {body['cache']['identity']})
        self.assertEqual(len([jql for jql in fake.search_jql if 'cf[26] is not EMPTY' in jql]), 1)
        teams = self.client.get('/api/teams?sprint=45459&quarter=2027Q1&configurationId=delivery')
        self.assertEqual(teams.status_code, 200, teams.get_data(as_text=True))
        self.assertEqual(teams.get_json()['quarter'], '2027Q1')
        self.assertEqual(self.sprints().status_code, 200)
        self.assertEqual(self.client.get('/api/teams?sprint=45459&configurationId=legacy').status_code, 409)
        with self.factory() as session:
            boards = sorted(row.board_id for row in session.query(models.WorkspaceSprintCatalog))
        self.assertEqual(boards, ['19095', '7001'], 'the scan never becomes a Board row')

    def test_board_row_wins_a_same_name_tie_and_ids_are_never_invented(self):
        self.jira_with_delivery_board(
            [{**sprint_value(7, '2027Q1', 'future'), 'originBoardId': 19095}], scan_pages=self.epic_scan)
        rows = self.sprints('?configurationId=delivery').get_json()['sprints']
        self.assertEqual([(row['id'], row['name']) for row in rows], [(7, '2027Q1')])
        self.assertEqual(self.client.get('/api/teams?sprint=45459&configurationId=delivery').status_code, 409)
        self.assertEqual(self.client.get('/api/teams?sprint=2027&configurationId=delivery').status_code, 409)

    def test_failed_or_empty_scan_keeps_the_board_rows(self):
        for scan in ([500], [{'issues': [], 'isLast': True}]):
            with self.subTest(scan=scan):
                SCOPED_SPRINT_CATALOGS.clear()
                self.jira_with_delivery_board(
                    [{**sprint_value(99, '2026Q4', 'closed'), 'originBoardId': 19095}], scan_pages=scan)
                response = self.sprints('?configurationId=delivery&refresh=true')
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                self.assertEqual([row['id'] for row in response.get_json()['sprints']], [99])

    def test_board_failure_is_covered_by_a_complete_scan(self):
        self.jira_with_delivery_board([], scan_pages=self.epic_scan)
        fake = self.jira(FakeJira(board_values=500, scan_pages=self.epic_scan))
        plain = fake.get
        fake.get = lambda path, **options: jira_response(500, {}) if path == DELIVERY_BOARD_PATH else plain(path, **options)
        response = self.sprints('?configurationId=delivery&refresh=true')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([row['id'] for row in response.get_json()['sprints']], [45459])

    def test_range_still_bounds_scanned_rows_and_legacy_never_scans(self):
        scan = [{'issues': [{'key': 'PLAN-8', 'fields': {DELIVERY_SPRINT_FIELD: [
            sprint_value(5, '2026Q3', 'closed'), sprint_value(45459, '2027Q1', 'future')]}}], 'isLast': True}]
        fake = self.jira_with_delivery_board([], scan_pages=scan)
        body = self.sprints().get_json()
        self.assertEqual([(row['id'], row['configurationId']) for row in body['sprints']],
                         [(45459, 'delivery'), (101, 'legacy')], 'scanned 2026Q3 is outside DELIVERY')
        self.assertTrue(all('"OLD"' not in jql for jql in fake.search_jql))



class TeamPublicationTests(CatalogBase):
    def setUp(self):
        super().setUp()
        self.seed_sources(legacy_ready=False)
        self.fake = self.jira(FakeJira(
            scan_pages=[{'issues': [issue(**{DELIVERY_SPRINT_FIELD: [sprint_value(201, '2027Q1')]})],
                         'isLast': True}],
            team_pages=[{'issues': [
                issue(**{DELIVERY_TEAM_FIELD: {'id': 't-1', 'name': 'Alpha'}}),
                issue(**{DELIVERY_TEAM_FIELD: {'id': 't-2', 'name': 'Beta'}})], 'isLast': True}]))
        self.assertEqual(self.sprints().status_code, 200)

    def team_rows(self):
        with self.factory() as session:
            return [(row.sprint_id, row.sprint_name, [t['id'] for t in row.teams], row.scope_digest)
                    for row in session.query(models.WorkspaceSprintTeamCatalog)]

    def test_publication_succeeds_without_a_board_row(self):
        response = self.client.get('/api/teams?sprint=201&quarter=2027Q1')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([team['id'] for team in response.get_json()['teams']], ['t-1', 't-2'])
        delivery = self.sources()[1]
        self.assertEqual(self.team_rows(), [('201', '2027Q1', ['t-1', 't-2'], team_scope_digest(delivery))])
        with self.factory() as session:
            self.assertEqual(session.query(models.WorkspaceSprintCatalog).count(), 0)
        self.assertIn('cf[26] = 201', self.fake.search_jql[-1])

    def claim(self, source):
        resolve = jira_server.catalog_configuration_resolver('delivery')
        budget = CatalogRefreshBudget.start(30)
        claim = claim_catalog_refresh(
            self.worker_context(), kind='teams', sprint_id='201', expected_config=source,
            owner=str(uuid.uuid4()), budget=budget, resolve_config=resolve,
            database_url=self.database_url)
        self.assertIsNotNone(claim)
        return claim, budget, resolve

    def publish(self, claim, budget, resolve, proof, teams=('t-9',)):
        return publish_catalog(
            self.worker_context(), claim=claim, payload=[{'id': t, 'name': t} for t in teams],
            budget=budget, resolve_config=resolve, database_url=self.database_url,
            sprint_proof=proof)

    def test_rejections_after_source_config_and_actor_invalidation_keep_prior_snapshot(self):
        self.assertEqual(self.client.get('/api/teams?sprint=201').status_code, 200)
        prior = self.team_rows()
        source = self.sources()[1]
        proof = capture_sprint_proof(source, 201)
        self.assertEqual((proof.sprint_id, proof.sprint_name), ('201', '2027Q1'))

        # Without server evidence nothing publishes (browser proof does not exist).
        claim, budget, resolve = self.claim(source)
        self.assertFalse(self.publish(claim, budget, resolve, None))
        self.assertEqual(self.team_rows(), prior)

        # Source evidence changed: a newer complete scan replaced the catalog version.
        claim, budget, resolve = self.claim(source)
        self.assertEqual(self.sprints('?configurationId=delivery&refresh=true').status_code, 200)
        self.assertFalse(self.publish(claim, budget, resolve, proof))
        self.assertEqual(self.team_rows(), prior)

        # Source evidence withdrawn: the Sprint is no longer in the complete catalog.
        fresh_proof = capture_sprint_proof(source, 201)
        claim, budget, resolve = self.claim(source)
        self.fake.scan_pages = [{'issues': [], 'isLast': True}]
        self.assertEqual(self.sprints('?configurationId=delivery&refresh=true').status_code, 200)
        self.assertFalse(self.publish(claim, budget, resolve, fresh_proof))
        self.assertEqual(self.team_rows(), prior)

        # Restore the evidence, then change the configuration under the claim.
        self.fake.scan_pages = [{'issues': [issue(**{DELIVERY_SPRINT_FIELD: [sprint_value(201, '2027Q1')]})],
                                 'isLast': True}]
        self.assertEqual(self.sprints('?configurationId=delivery&refresh=true').status_code, 200)
        source = self.sources()[1]
        proof = capture_sprint_proof(source, 201)
        claim, budget, resolve = self.claim(source)
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            payload['workConfigurations']['configurations'][1]['fields']['team']['fieldId'] = 'customfield_88'
            row.payload = payload
            session.commit()
        self.assertFalse(self.publish(claim, budget, resolve, proof))
        self.assertEqual([(r[0], r[1], r[2]) for r in self.team_rows()],
                         [(r[0], r[1], r[2]) for r in prior])

    def test_actor_invalidation_raises_auth_error_and_publishes_nothing(self):
        self.assertEqual(self.client.get('/api/teams?sprint=201').status_code, 200)
        prior = self.team_rows()
        source = self.sources()[1]
        proof = capture_sprint_proof(source, 201)
        claim, budget, resolve = self.claim(source)
        with self.factory() as session:
            session.get(models.AuthConnection, self.admin_connection).status = 'revoked'
            session.commit()
        with self.assertRaises(AuthError):
            self.publish(claim, budget, resolve, proof)
        self.assertEqual(self.team_rows(), prior)

    def test_expired_claim_deadline_rejects_publication(self):
        source = self.sources()[1]
        proof = capture_sprint_proof(source, 201)
        claim, budget, resolve = self.claim(source)
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintTeamCatalog).one()
            row.attempt_deadline_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            session.commit()
        self.assertFalse(self.publish(claim, budget, resolve, proof))
        self.assertEqual(self.team_rows()[0][2], [])

    def test_proof_for_another_sprint_or_identity_is_rejected(self):
        source = self.sources()[1]
        proof = capture_sprint_proof(source, 201)
        for bad in (
            type(proof)(proof.source_identity, proof.source_digest, proof.catalog_version, '999', '2027Q1'),
            type(proof)('si1:other', proof.source_digest, proof.catalog_version, '201', '2027Q1'),
            type(proof)(proof.source_identity, 'digest', proof.catalog_version, '201', '2027Q1'),
        ):
            claim, budget, resolve = self.claim(source)
            self.assertFalse(self.publish(claim, budget, resolve, bad))

    def test_worker_without_request_context_uses_the_explicit_context(self):
        source = self.sources()[1]
        seen = {}

        def fetch_teams(*, sprint_id, config, context, diagnostic_transport, budget):
            seen.update(request=flask.has_request_context(), user=context.user_id,
                        config=config.configuration_id)
            return [{'id': 't-7', 'name': 'Gamma'}]

        runtime = CatalogRefreshRuntime(
            fetch_sprints=Mock(side_effect=AssertionError('Sprint fetch')), fetch_teams=fetch_teams,
            database_url=self.database_url)
        self.addCleanup(runtime.shutdown, wait=True)
        context = self.worker_context()
        claim = runtime.refresh(
            context, kind='teams', sprint_id='201', config=source, background=True,
            resolve_config=jira_server.catalog_configuration_resolver('delivery'))
        self.assertIsNotNone(claim)
        runtime._executor.shutdown(wait=True)
        self.assertEqual(seen, {'request': False, 'user': context.user_id, 'config': 'delivery'})
        self.assertEqual([(r[0], r[1], r[2]) for r in self.team_rows()], [('201', '2027Q1', ['t-7'])])

    def test_worker_without_evidence_fails_with_identity_changed(self):
        SCOPED_SPRINT_CATALOGS.clear()
        source = self.sources()[1]
        runtime = CatalogRefreshRuntime(
            fetch_sprints=Mock(), fetch_teams=Mock(side_effect=AssertionError('fetched without evidence')),
            database_url=self.database_url)
        self.addCleanup(runtime.shutdown, wait=True)
        runtime.refresh(
            self.worker_context(), kind='teams', sprint_id='201', config=source, background=False,
            resolve_config=jira_server.catalog_configuration_resolver('delivery'))
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintTeamCatalog).one()
            self.assertEqual((row.refresh_status, row.failure_code), ('failed', 'catalog_identity_changed'))


class ScopedStoreTests(unittest.TestCase):
    def test_one_live_attempt_failure_backoff_and_force(self):
        now = [datetime(2027, 1, 1, tzinfo=timezone.utc)]
        store = ScopedSprintCatalogStore(now_fn=lambda: now[0])
        self.assertTrue(store.begin('si1:a', 'a1', workspace_id='w', config_digest='d'))
        self.assertFalse(store.begin('si1:a', 'a2', workspace_id='w', config_digest='d'))
        self.assertTrue(store.fail('si1:a', 'a1', 'jira_unavailable'))
        self.assertFalse(store.begin('si1:a', 'a3', workspace_id='w', config_digest='d'))
        self.assertTrue(store.begin('si1:a', 'a3', workspace_id='w', config_digest='d', force=True))
        self.assertFalse(store.publish('si1:a', 'stale-attempt', [], workspace_id='w', source_digest='s'))
        self.assertTrue(store.publish('si1:a', 'a3', [{'id': 1, 'name': '2027Q1'}], workspace_id='w',
                                      source_digest='s'))
        self.assertEqual(store.snapshot('si1:a').payload, [{'id': 1, 'name': '2027Q1'}])
        now[0] += timedelta(seconds=400)
        self.assertTrue(store.begin('si1:a', 'a4', workspace_id='w', config_digest='d'))
        store.retire_workspace('w')
        self.assertIsNone(store.snapshot('si1:a').payload)


if __name__ == '__main__':
    unittest.main()
