"""Synthetic atomic v2 contract checks using the real review transaction."""
from dataclasses import replace
from datetime import datetime, timezone
from unittest.mock import patch
import unittest
import uuid

from sqlalchemy import select
from backend.db import engine as db_engine, models
from backend.services import sprint_review as review
from tests.test_sprint_review import ReviewFixture


def operation_id():
    milliseconds = int(datetime.now(timezone.utc).timestamp() * 1000)
    return str(uuid.UUID(int=(milliseconds << 80) | (7 << 76) | (2 << 62) | (uuid.uuid4().int & ((1 << 62) - 1))))


class PlanningAtomicTests(ReviewFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        # PostgreSQL enforces the save receipt's actor foreign key, so the actor is a real synthetic user.
        with db_engine.session_scope(self.url) as session:
            actor = models.User(external_provider='atlassian', external_subject='synthetic-account')
            session.add(actor)
            session.flush()
            actor_id = actor.id
        self.context = replace(self.context, user_id=actor_id)

    def payload(self, **updates):
        return {**dict(version=2, groupId=self.group_id, operationId=operation_id(), initializePlan=True,
                    basePlanRevision=0, baseScopeProof='synthetic-proof', baseSchemaRevision=0,
                    inclusionChanges=[{'issueId': '101', 'included': True, 'baseRevision': 0}]), **updates}

    def admission(self):
        return review.PlanningAdmission(scope_proof='synthetic-proof', candidate_jql='Sprint = 17',
            child_kind='story', configuration_id=None, quarter_ordinal=None, type_map=None,
            group_revision=1, group_payload={'version': 1, 'groups': [{'id': 'group-x', 'name': 'Platform'},
                {'id': 'group-y', 'name': 'Payments'}], 'defaultGroupId': 'group-x'},
            revalidate=lambda session: None)

    def save_v2(self, payload, **kwargs):
        return review.save_review(self.context, '17', payload, self.url, self.search,
                                  planning_admission=self.admission, **kwargs)

    def test_initial_inclusion_and_exact_replay_are_one_commit(self):
        payload = self.payload()
        first = self.save_v2(payload)
        self.assertEqual(first['plan'], {'exists': True, 'revision': 1})
        self.assertEqual(first['inclusionChanges'], [{'issueId': '101', 'included': True, 'revision': 1}])
        with patch.object(self, 'admission', side_effect=AssertionError('Replay must precede admission')):
            replay = self.save_v2(payload)
        self.assertEqual(replay['status'], 'committed')
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(len(session.scalars(select(models.GroupSprintPlan)).all()), 1)
            self.assertEqual(len(session.scalars(select(models.PlanningSaveOperation)).all()), 1)

    def test_acknowledgement_failure_rolls_back_all_stores(self):
        payload = self.payload(schemaChanges=[{'action': 'add', 'column': self.column}],
                               cellChanges=[self.cell()])
        def fail(_value):
            raise review.ReviewError('review_response_limit', 413)
        self.assert_error('review_response_limit', 413, self.save_v2, payload, prepare_response=fail)
        with db_engine.session_scope(self.url) as session:
            for model in (models.GroupSprintPlan, models.GroupSprintPlanEntry, models.PlanningSaveOperation,
                          models.GroupReviewCell, models.WorkspaceGroupReviewSchema):
                self.assertEqual(session.query(model).count(), 0)

    def test_moved_type_changed_removal_and_disjoint_stale_revision(self):
        first = self.save_v2(self.payload())
        self.epics.add('101')
        removed = self.save_v2(self.payload(inclusionChanges=[{'issueId': '101', 'included': False, 'baseRevision': 1}]))
        self.assertEqual(removed['inclusionChanges'][0], {'issueId': '101', 'included': False, 'revision': 2})
        other = self.save_v2(self.payload(inclusionChanges=[{'issueId': '102', 'included': True, 'baseRevision': 0}]))
        self.assertEqual(other['plan']['revision'], 3)
        self.assert_error('review_conflict', 409, self.save_v2,
            self.payload(inclusionChanges=[{'issueId': '101', 'included': True, 'baseRevision': 0}]))

    def test_group_drift_after_authorization_rolls_back_schema_initialization(self):
        real_search = self._search
        changed = False
        def search(payload, **kwargs):
            nonlocal changed
            result = real_search(payload, **kwargs)
            if not changed:
                changed = True
                with db_engine.session_scope(self.url) as session:
                    group = session.scalar(select(models.WorkspaceGroupConfig).where(models.WorkspaceGroupConfig.workspace_id == self.workspace))
                    group.config_revision += 1
            return result
        self.search.side_effect = search
        self.assert_error('configuration_scope_changed', 409, self.save_v2, self.payload())
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintPlan).count(), 0)
            self.assertEqual(session.query(models.WorkspaceGroupReviewSchema).count(), 0)

    def test_expired_missing_operation_never_runs_admission(self):
        old = str(uuid.UUID(int=((int(datetime.now(timezone.utc).timestamp() * 1000) - 25*3600*1000) << 80) | (7 << 76) | (2 << 62)))
        payload = self.payload()
        payload['operationId'] = old
        with patch.object(self, 'admission', side_effect=AssertionError('Expired operation cannot execute')):
            self.assert_error('operation_expired', 410, self.save_v2, payload)

    def test_replay_revoked_visibility_discloses_metadata_only(self):
        payload = self.payload()
        self.save_v2(payload)
        self.search.side_effect = lambda *_a, **_k: type('Response', (), {'status_code': 200, 'json': lambda _s: {'issues': [], 'isLast': True}})()
        with patch.object(self, 'admission', side_effect=AssertionError('Replay must precede admission')):
            replay = self.save_v2(payload)
        self.assertTrue(replay['reloadRequired'])
        self.assertNotIn('inclusionChanges', replay)
        self.assertNotIn('cells', replay)

    def test_aggregate_deadline_rolls_back_after_staging(self):
        ticks = [0]
        deadline = review.PlanningDeadline(clock=lambda: ticks[0])
        def encode(_result):
            ticks[0] = 31
            return b'prepared'
        self.assert_error('planning_deadline_exceeded', 503, self.save_v2, self.payload(), deadline=deadline, prepare_response=encode)
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintPlan).count(), 0)
            self.assertEqual(session.query(models.PlanningSaveOperation).count(), 0)

    def test_receipt_limit_rejects_before_mutating_entries(self):
        from backend.services import planning_inclusion
        self.save_v2(self.payload())
        with patch.object(planning_inclusion, 'MAX_UNEXPIRED_OPERATIONS', 1):
            self.assert_error('planning_operation_limit', 429, self.save_v2,
                self.payload(inclusionChanges=[{'issueId': '102', 'included': True, 'baseRevision': 0}]))
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintPlanEntry).count(), 1)
            self.assertEqual(session.query(models.PlanningSaveOperation).count(), 1)

    def test_union_limit_fails_before_jira(self):
        payload = self.payload(inclusionChanges=[{'issueId': str(i), 'included': True, 'baseRevision': 0} for i in range(1000, 1500)],
            cellChanges=[self.cell(issue='101')])
        self.assert_error('invalid_review_request', 400, self.save_v2, payload)
        self.search.assert_not_called()

    def test_expiry_crossing_under_schema_fence_cannot_initialize(self):
        from datetime import timedelta
        actual = datetime.now(timezone.utc)
        payload = self.payload()
        locked = review._locked_schema
        with patch.object(review, 'datetime') as controlled:
            controlled.now.return_value = actual
            def crossed(*args, **kwargs):
                row = locked(*args, **kwargs)
                controlled.now.return_value = actual + timedelta(hours=25)
                return row
            with patch.object(review, '_locked_schema', side_effect=crossed):
                self.assert_error('operation_expired', 410, self.save_v2, payload)
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintPlan).count(), 0)
            self.assertEqual(session.query(models.PlanningSaveOperation).count(), 0)

    def test_invalid_candidate_query_fails_closed_before_candidate_search(self):
        from dataclasses import replace
        admitted = replace(self.admission(), candidate_jql='Sprint = 17 order by created AND Team = 1')
        with patch.object(self, 'admission', return_value=admitted):
            self.assert_error('planning_scope_unavailable', 503, self.save_v2, self.payload())
        self.assertEqual(self.search.call_count, 1)

    def test_postgresql_execution_limits_follow_remaining_budget(self):
        from contextlib import ExitStack
        from sqlalchemy import event, text
        ticks, executed = [0], []
        deadline = review.PlanningDeadline(clock=lambda: ticks[0])
        limits = text("SELECT current_setting('lock_timeout'), current_setting('statement_timeout')")
        with ExitStack() as stack, db_engine.session_scope(self.url) as session:
            connection = session.connection()
            def record(_conn, _cursor, statement, *_args):
                executed.append(statement)
            event.listen(connection, 'after_cursor_execute', record)
            stack.callback(event.remove, connection, 'after_cursor_execute', record)
            deadline.bind(session, stack)
            ticks[0] = 20
            self.assertEqual(tuple(session.execute(limits).one()), ('5s', '10s'))
            ticks[0] = 29.5
            self.assertEqual(tuple(session.execute(limits).one()), ('500ms', '500ms'))
            ticks[0] = 29.8
            self.assertIn(tuple(session.execute(limits).one()), {('199ms', '199ms'), ('200ms', '200ms')})
            ticks[0] = 31
            self.assert_error('planning_deadline_exceeded', 503, session.execute, text('SELECT 3'))
            self.assertNotIn('SELECT 3', executed)

    def test_empty_first_save_requires_explicit_initialization(self):
        self.assert_error('plan_initialization_required', 400, self.save_v2,
            self.payload(inclusionChanges=[], initializePlan=False))
        saved = self.save_v2(self.payload(inclusionChanges=[]))
        self.assertEqual(saved['plan'], {'exists': True, 'revision': 1})
        again = self.save_v2(self.payload(inclusionChanges=[], basePlanRevision=1))
        self.assertEqual(again['plan'], {'exists': True, 'revision': 1})
        self.search.assert_not_called()

    def test_review_only_v2_initializes_once_and_preserves_existing_cell_cas(self):
        saved = self.save_v2(self.payload(inclusionChanges=[], schemaChanges=[{'action': 'add', 'column': self.column}], cellChanges=[self.cell()]))
        self.assertEqual(saved['plan']['revision'], 1)
        self.assertEqual(saved['cells'][0]['revision'], 1)
        stale = self.payload(inclusionChanges=[], baseSchemaRevision=1, cellChanges=[self.cell('2.0')])
        error = self.assert_error('review_conflict', 409, self.save_v2, stale)
        self.assertEqual(error.details['cellConflicts'][0]['revision'], 1)
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.PlanningSaveOperation).count(), 1)

    def test_process_proof_guard_outlives_commit(self):
        from contextlib import contextmanager
        from dataclasses import replace
        from backend.services.workspace_catalog_cache import SCOPED_SPRINT_CATALOGS
        released = []
        @contextmanager
        def guard(_proof, **_kwargs):
            yield True
            with db_engine.session_scope(self.url) as session:
                released.append(session.query(models.PlanningSaveOperation).count())
        admitted = replace(self.admission(), source_proof=object())
        with patch.object(self, 'admission', return_value=admitted), patch.object(SCOPED_SPRINT_CATALOGS, 'proof_guard', side_effect=guard):
            self.save_v2(self.payload())
        self.assertEqual(released, [1], 'The store publication lock must remain held through receipt commit.')

    def test_process_proof_mismatch_rolls_back_new_plan_and_schema(self):
        from contextlib import contextmanager
        from dataclasses import replace
        from backend.services.workspace_catalog_cache import SCOPED_SPRINT_CATALOGS
        @contextmanager
        def guard(_proof, **_kwargs):
            yield False
        admitted = replace(self.admission(), source_proof=object())
        with patch.object(self, 'admission', return_value=admitted), patch.object(SCOPED_SPRINT_CATALOGS, 'proof_guard', side_effect=guard):
            self.assert_error('configuration_scope_changed', 409, self.save_v2, self.payload())
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintPlan).count(), 0)
            self.assertEqual(session.query(models.WorkspaceGroupReviewSchema).count(), 0)

    def test_real_encoder_failure_rolls_back_layout_cells_entries_and_receipt(self):
        original = review._base
        def unencodable(*args, **kwargs):
            return {**original(*args, **kwargs), 'synthetic': object()}
        payload = self.payload(schemaChanges=[{'action': 'add', 'column': self.column}, self.layout()], cellChanges=[self.cell()])
        with patch.object(review, '_base', side_effect=unencodable):
            self.assert_error('review_response_unavailable', 503, self.save_v2, payload)
        with db_engine.session_scope(self.url) as session:
            for model in (models.GroupSprintPlan, models.GroupSprintPlanEntry, models.PlanningSaveOperation,
                          models.GroupReviewCell, models.GroupSprintReviewView, models.WorkspaceGroupReviewSchema):
                self.assertEqual(session.query(model).count(), 0)

    def test_real_encoder_size_failure_rolls_back_every_store(self):
        payload = self.payload(schemaChanges=[{'action': 'add', 'column': self.column}, self.layout()], cellChanges=[self.cell()])
        with patch.object(review, 'MAX_RESPONSE_BYTES', 100):
            self.assert_error('review_response_limit', 413, self.save_v2, payload)
        with db_engine.session_scope(self.url) as session:
            for model in (models.GroupSprintPlan, models.GroupSprintPlanEntry, models.PlanningSaveOperation,
                          models.GroupReviewCell, models.GroupSprintReviewView, models.WorkspaceGroupReviewSchema):
                self.assertEqual(session.query(model).count(), 0)


from tests.test_sprint_review_routes import SprintReviewRouteTests
from backend.routes import sprint_review_routes as routes
import jira_server


class PlanningHttpTests(SprintReviewRouteTests):
    payload = PlanningAtomicTests.payload
    admission = PlanningAtomicTests.admission

    def test_v2_http_csrf_metadata_projection_and_operation_query(self):
        self._install_actor()
        body = self.payload()
        with patch.object(routes, '_planning_admission', side_effect=lambda *_a, **_k: self.admission()), \
             patch.object(jira_server, 'current_jira_search', self.search):
            self.assertEqual(self.client.patch(self.path, json=body).status_code, 403)
            response = self.client.patch(self.path, json=body, headers=self.headers())
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['plan'], {'exists': True, 'revision': 1})
            meta = self.client.get(self.path + '?groupId=group-x')
            self.assertEqual(meta.get_json()['scopeProof'], 'synthetic-proof')
            self.assertNotIn('planEntries', meta.get_json())
            projected = self.client.post(self.path + '/values/read', json={
                'groupId': 'group-x', 'issueIds': ['101'], 'rowKind': 'story', 'includePlan': True,
                'expectedPlanRevision': 1, 'expectedScopeProof': 'synthetic-proof'}, headers=self.headers())
            self.assertEqual(projected.status_code, 200, projected.get_data(as_text=True))
            self.assertEqual(projected.get_json()['planEntries'], [{'issueId': '101', 'included': True, 'revision': 1}])
        operation = self.path + '/operations/' + body['operationId']
        receipt = self.client.get(operation + '?groupId=group-x')
        self.assertEqual(receipt.status_code, 200)
        self.assertEqual(receipt.get_json()['status'], 'committed')
        self.assertNotIn('inclusionChanges', receipt.get_json())
        self.assertEqual(self.client.get(operation + '?groupId=group-x&configurationDigest=x').status_code, 400)
        self.assertEqual(self.client.get(operation + '?groupId=group-x&groupId=group-x').status_code, 400)
        self.assertEqual(self.client.get(operation + '?groupId=group-y').status_code, 409)

    def test_v2_response_encoding_failure_rolls_back_real_http_write(self):
        self._install_actor()
        with patch.object(routes, '_planning_admission', side_effect=lambda *_a, **_k: self.admission()), \
             patch.object(jira_server, 'current_jira_search', self.search), \
             patch.object(routes, '_prepare_planning_response', side_effect=review.ReviewError('review_response_limit', 413)):
            response = self.client.patch(self.path, json=self.payload(schemaChanges=[{'action': 'add', 'column': self.column}],
                cellChanges=[self.cell()]), headers=self.headers())
            self.assertEqual(response.status_code, 413)
        with db_engine.session_scope(self.url) as session:
            for model in (models.GroupSprintPlan, models.GroupSprintPlanEntry, models.PlanningSaveOperation,
                          models.GroupReviewCell, models.WorkspaceGroupReviewSchema):
                self.assertEqual(session.query(model).count(), 0)

    def test_admission_missing_source_is_a_typed_failure(self):
        self._install_actor()
        with jira_server.app.test_request_context('/'), self.assertRaises(routes.work_routes.WorkConfigError) as raised:
            routes._planning_admission(self.context, '17', {'groupId': 'group-x'})
        self.assertEqual(raised.exception.code, 'sprint_catalog_mismatch')
        result = self.client.get(self.path + '?groupId=group-x')
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.get_json()['planCapabilities']['canSave'])


    def test_auth_sql_consumes_the_same_deadline_before_admission(self):
        from backend.auth import db_context
        from backend.security import guards
        self._install_actor()
        headers = self.headers()
        ticks = [0]
        budget = review.PlanningDeadline(clock=lambda: ticks[0])
        real_browser = db_context.resolve_browser_session
        def elapsed(*args, **kwargs):
            result = real_browser(*args, **kwargs)
            ticks[0] = 31
            return result
        with patch.object(guards, 'PlanningDeadline', return_value=budget), \
             patch.object(db_context, 'resolve_browser_session', side_effect=elapsed), \
             patch.object(routes, '_planning_admission', side_effect=AssertionError('Expired auth cannot reach admission')):
            response = self.client.patch(self.path, json=self.payload(), headers=headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {'error': 'planning_deadline_exceeded', 'noCommit': True})
        with db_engine.session_scope(self.url) as session:
            self.assertEqual(session.query(models.GroupSprintPlan).count(), 0)

    def test_observed_admission_rechecks_the_consulted_board_publication(self):
        from types import SimpleNamespace
        from backend.services import workspace_catalog_cache as cache
        self._install_actor()
        with db_engine.session_scope(self.url) as session:
            snapshot = routes.workspace_dashboard_config.load_workspace_config_in_session(session, self.context)
            version = str(uuid.uuid4())
            session.add(models.WorkspaceSprintCatalog(workspace_id=self.workspace, board_id='17',
                sprints=[], validated_at=datetime.now(timezone.utc), catalog_version=version))
        observed = SimpleNamespace(sprint_identity='synthetic-observed', source_digest='observed-digest',
            source_mode=routes.work_routes.work_structure_service.SOURCE_MODE_SCOPED_ISSUES,
            config_revision=snapshot.config_revision, configuration_id=None, from_quarter=None, through_quarter=None)
        board = SimpleNamespace(sprint_identity='synthetic-board-identity', board_id='17',
            source_mode=routes.work_routes.work_structure_service.SOURCE_MODE_BOARD,
            observed_source=observed, configuration_id=None, from_quarter=None, through_quarter=None)
        board_snapshot = SimpleNamespace(payload=[], catalog_version=version)
        observed_snapshot = SimpleNamespace(payload=[{'id': '17', 'name': '2027Q1'}], catalog_version=str(uuid.uuid4()))
        with jira_server.app.test_request_context('/'), \
             patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[board]), \
             patch.object(cache, 'load_sprint_catalog', return_value=board_snapshot), \
             patch.object(cache, 'load_scoped_sprint_catalog', return_value=observed_snapshot), \
             patch.object(routes.planning_scope, 'compile_planning_inclusion_scope', return_value={
                 'candidate_jql': 'Sprint = 17', 'child_kind': 'story', 'scope_digest': 'synthetic'}):
            admission = routes._planning_admission(self.context, '17', {'groupId': 'group-x'})
        self.assertEqual(admission.source_proof.source_identity, observed.sprint_identity)
        with db_engine.session_scope(self.url) as session:
            admission.revalidate(session)
        # Publishing a Board Sprint of the same name shadows this observed Sprint.
        with db_engine.session_scope(self.url) as session:
            row = session.scalar(select(models.WorkspaceSprintCatalog).where(
                models.WorkspaceSprintCatalog.workspace_id == self.workspace))
            row.sprints = [{'id': '18', 'name': '2027Q1'}]
            row.catalog_version = str(uuid.uuid4())
        with db_engine.session_scope(self.url) as session, self.assertRaises(review.ReviewError) as raised:
            admission.revalidate(session)
        self.assertEqual(raised.exception.code, 'configuration_scope_changed')

    def test_capability_rejection_never_parses_body_in_error_handler(self):
        self._install_actor()
        with jira_server.app.test_request_context(self.path, method='PATCH', json=self.payload()), \
             patch.object(jira_server, 'current_request_auth_context', return_value=self.context), \
             patch.object(review, 'require_review_context', side_effect=review.ReviewError('review_storage_unavailable', 503)), \
             patch.object(routes.request, 'get_json', side_effect=AssertionError('Rejected capability must not parse body')):
            response = routes._run(lambda _context: self.fail('operation must not run'), require_capability=True)
        self.assertEqual(response.status_code, 503)
