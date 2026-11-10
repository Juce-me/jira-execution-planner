"""Shared plan persistence contracts against synthetic, isolated PostgreSQL databases."""
from datetime import datetime, timedelta, timezone
import unittest
import uuid

from sqlalchemy import create_engine, event, func, inspect, select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, ProgrammingError
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from backend.db import models
from backend.services import planning_inclusion as inclusion
from backend.services.sprint_review import ReviewError
from tests.postgres_test_db import fresh_database_url


NOW = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)


def operation_id(at=NOW, nonce=1):
    return str(uuid.UUID(int=(int(at.timestamp() * 1000) << 80) | (7 << 76) | (2 << 62) | nonce))


def change(issue='8101', included=True, base=0):
    return {'issueId': issue, 'included': included, 'baseRevision': base}


class InclusionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(fresh_database_url(self.addCleanup))
        models.Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        workspace = models.Workspace(environment_key='synthetic-plan', name='Synthetic')
        actor = models.User(external_provider='atlassian', external_subject='synthetic-plan-actor', created_by='test')
        self.session.add_all([workspace, actor])
        self.session.flush()
        self.workspace, self.actor = workspace.id, actor.id
        schemas = [models.WorkspaceGroupReviewSchema(workspace_id=self.workspace, group_id='group-x', configuration_id=c)
                   for c in (None, 'configuration-x')]
        self.session.add_all(schemas)
        self.session.flush()
        self.schema, self.other_schema = [s.id for s in schemas]
        self.scope = {'workspaceId': self.workspace, 'groupId': 'group-x', 'configurationId': None, 'sprintId': '101'}
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def plan(self, schema=None, sprint='101'):
        return inclusion.initialize_plan(self.session, schema or self.schema, sprint, True)

    def error(self, code, call, status=None):
        with self.assertRaises(ReviewError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)
        if status:
            self.assertEqual(caught.exception.status, status)
        return caught.exception

    def test_read_absent_and_explicit_saved_empty_are_distinct(self):
        absent = inclusion.load_inclusion_projection(self.session, self.schema, '101', ['8101'], 0)
        self.assertEqual(absent, {'plan': {'exists': False, 'revision': 0}, 'planEntries': [dict(issueId='8101', included=False, revision=0)]})
        self.assertEqual(self.session.scalar(select(func.count()).select_from(models.GroupSprintPlan)), 0)
        self.error('plan_initialization_required', lambda: inclusion.initialize_plan(self.session, self.schema, '101', False), 400)
        plan, created = self.plan()
        self.assertTrue(created)
        self.session.flush()
        self.assertEqual(inclusion.load_inclusion_projection(self.session, self.schema, '101', [], 1)['plan'], {'exists': True, 'revision': 1})
        again, created = inclusion.initialize_plan(self.session, self.schema, '101', True)
        self.assertFalse(created)
        self.assertEqual((again.id, again.revision), (plan.id, 1))

    def test_first_nonempty_save_revision_one_even_after_flush(self):
        plan, created = self.plan()
        self.session.flush()
        result = inclusion.apply_inclusion_changes(self.session, plan, [change(), change('8102')], newly_initialized=created)
        self.assertEqual(plan.revision, 1)
        self.assertEqual([e['revision'] for e in result], [1, 1])
        self.session.commit()
        self.assertEqual(self.session.get(models.GroupSprintPlan, plan.id).revision, 1)

    def test_convergence_tombstone_aba_and_disjoint_changes(self):
        plan, created = self.plan()
        inclusion.apply_inclusion_changes(self.session, plan, [change()], newly_initialized=created)
        self.assertEqual(inclusion.apply_inclusion_changes(self.session, plan, [change()]), [dict(issueId='8101', included=True, revision=1)])
        self.assertEqual(plan.revision, 1)
        inclusion.apply_inclusion_changes(self.session, plan, [change('8102')])
        self.assertEqual(plan.revision, 2)
        inclusion.apply_inclusion_changes(self.session, plan, [change(included=False, base=1)])
        self.assertEqual(plan.revision, 3)
        error = self.error('review_conflict', lambda: inclusion.apply_inclusion_changes(self.session, plan, [change()]), 409)
        self.assertEqual(error.details['inclusionConflicts'], [dict(issueId='8101', included=False, revision=2)])
        self.assertEqual(self.session.scalar(select(func.count()).select_from(models.GroupSprintPlanEntry)), 2)
        self.assertEqual(plan.revision, 3)

    def test_conflict_validates_entire_batch_before_mutation(self):
        plan, created = self.plan()
        inclusion.apply_inclusion_changes(self.session, plan, [change()], newly_initialized=created)
        self.error('review_conflict', lambda: inclusion.apply_inclusion_changes(self.session, plan, [change('8102'), change(included=False)]))
        self.session.flush()
        self.assertEqual(self.session.scalar(select(func.count()).select_from(models.GroupSprintPlanEntry)), 1)
        self.assertEqual(plan.revision, 1)

    def test_projection_only_authorized_ids_at_one_snapshot_and_revision(self):
        plan, created = self.plan()
        inclusion.apply_inclusion_changes(self.session, plan, [change(), change('8102')], newly_initialized=created)
        self.session.flush()
        statements = []
        def capture(_conn, _cursor, statement, *_):
            if statement.lstrip().upper().startswith('SELECT'):
                statements.append(statement)
        event.listen(self.engine, 'before_cursor_execute', capture)
        try:
            result = inclusion.load_inclusion_projection(self.session, self.schema, '101', ['8101', '8103'], 1)
        finally:
            event.remove(self.engine, 'before_cursor_execute', capture)
        self.assertEqual(len(statements), 1)
        self.assertEqual(result['planEntries'], [dict(issueId='8101', included=True, revision=1), dict(issueId='8103', included=False, revision=0)])
        self.error('plan_projection_changed', lambda: inclusion.load_inclusion_projection(self.session, self.schema, '101', ['8101'], 0), 409)
        other, created = self.plan(self.other_schema)
        self.assertNotEqual(plan.id, other.id)
        self.assertEqual(inclusion.load_inclusion_projection(self.session, self.other_schema, '101', ['8101'], 1)['planEntries'][0]['included'], False)
        self.assertFalse(inclusion.load_inclusion_projection(self.session, self.schema, '102', [], 0)['plan']['exists'])

    def test_strict_changes_and_entry_cap_count_tombstones(self):
        plan, _ = self.plan()
        for invalid in ([change(), change()], [change(included=1)], [change(base=True)], [dict(change(), extra=True)]):
            self.error('invalid_review_request', lambda: inclusion.apply_inclusion_changes(self.session, plan, invalid), 400)
        from unittest.mock import patch
        with patch.object(inclusion, 'MAX_PLAN_ENTRIES', 1):
            inclusion.apply_inclusion_changes(self.session, plan, [change()])
            inclusion.apply_inclusion_changes(self.session, plan, [change(included=False, base=1)])
            self.error('plan_entry_limit', lambda: inclusion.apply_inclusion_changes(self.session, plan, [change('8102')]), 413)
            self.assertEqual(plan.revision, 3)

    def test_caller_rollback_removes_all_staged_state(self):
        plan, created = self.plan()
        inclusion.apply_inclusion_changes(self.session, plan, [change()], newly_initialized=created)
        inclusion.record_operation(self.session, plan, self.workspace, self.actor, inclusion.operation_identity(operation_id(), NOW), 'a' * 64,
                                   {'operationId': operation_id(), 'plan': {'exists': True, 'revision': 1}}, NOW)
        self.session.flush()
        self.session.rollback()
        for model in (models.GroupSprintPlan, models.GroupSprintPlanEntry, models.PlanningSaveOperation):
            self.assertEqual(self.session.scalar(select(func.count()).select_from(model)), 0)

    def test_operation_identity_expiry_and_malformed_ids(self):
        identity = inclusion.operation_identity(operation_id(), NOW)
        self.assertEqual(identity.expires_at, NOW + timedelta(hours=24))
        self.assertEqual(inclusion.operation_identity(operation_id(NOW - timedelta(days=2)), NOW).expires_at, NOW - timedelta(days=1))
        self.error('operation_expired', lambda: inclusion.require_unexpired_operation(identity, NOW + timedelta(hours=24)), 410)
        for invalid in (str(uuid.uuid4()), operation_id(nonce=0xabcdef).upper(), 'bad', None, operation_id(NOW + timedelta(minutes=6))):
            self.error('invalid_operation_id', lambda: inclusion.operation_identity(invalid, NOW), 400)

    def test_canonical_hash_includes_scope_and_all_payload_content(self):
        payload = {'version': 2, 'groupId': 'group-x', 'operationId': operation_id(), 'initializePlan': True,
                   'basePlanRevision': 0, 'baseScopeProof': 'proof', 'baseSchemaRevision': 0,
                   'inclusionChanges': [change('8102'), change()], 'cellChanges': [], 'schemaChanges': []}
        digest = inclusion.canonical_request_hash(payload, self.scope)
        self.assertEqual(len(digest), 64)
        self.assertEqual(digest, inclusion.canonical_request_hash(dict(payload, inclusionChanges=list(reversed(payload['inclusionChanges']))), self.scope))
        self.assertNotEqual(digest, inclusion.canonical_request_hash(dict(payload, baseScopeProof='other'), self.scope))
        self.assertNotEqual(digest, inclusion.canonical_request_hash(payload, dict(self.scope, configurationId='configuration-x')))
        self.error('invalid_review_request', lambda: inclusion.canonical_request_hash(dict(payload, actorUserId='spoof'), self.scope))
        self.error('invalid_review_request', lambda: inclusion.canonical_request_hash(dict(payload, baseScopeProof='\ud800'), self.scope))
        self.assertNotEqual(digest, inclusion.canonical_request_hash(dict(payload, operationId=operation_id(nonce=2)), self.scope))

    def test_receipt_identity_scope_expiry_pruning_and_cap(self):
        from unittest.mock import patch
        plan, _ = self.plan()
        identity = inclusion.operation_identity(operation_id(), NOW)
        ack = {'operationId': identity.operation_id, 'plan': {'exists': True, 'revision': 1}, 'inclusionChanges': [dict(issueId='8101', included=True, revision=1)]}
        receipt = inclusion.record_operation(self.session, plan, self.workspace, self.actor, identity, 'a' * 64, ack, NOW)
        self.session.flush()
        self.assertEqual(inclusion.find_operation(self.session, self.workspace, self.actor, identity.operation_id, scope=self.scope, request_hash='a' * 64).id, receipt.id)
        self.assertIsNone(inclusion.find_operation(self.session, self.workspace, str(uuid.uuid4()), identity.operation_id))
        self.error('operation_id_reused', lambda: inclusion.find_operation(self.session, self.workspace, self.actor, identity.operation_id, scope=dict(self.scope, sprintId='102')), 409)
        self.error('operation_id_reused', lambda: inclusion.find_operation(self.session, self.workspace, self.actor, identity.operation_id, request_hash='b' * 64), 409)
        metadata = inclusion.operation_metadata(receipt)
        self.assertNotIn('inclusionChanges', metadata)
        self.assertNotIn('8101', str(metadata))
        with patch.object(inclusion, 'MAX_UNEXPIRED_OPERATIONS', 1):
            self.error('planning_operation_limit', lambda: inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                       inclusion.operation_identity(operation_id(nonce=2), NOW), 'b' * 64, ack, NOW), 429)
        self.assertIsNotNone(inclusion.find_operation(self.session, self.workspace, self.actor, identity.operation_id))
        self.error('operation_expired', lambda: inclusion.record_operation(self.session, plan, self.workspace, self.actor, identity, 'a' * 64, ack, NOW + timedelta(days=1)), 410)
        inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                                   inclusion.operation_identity(operation_id(NOW + timedelta(days=1), 3), NOW + timedelta(days=1)), 'c' * 64,
                                   {'plan': {'exists': True, 'revision': 1}}, NOW + timedelta(days=1))
        self.session.flush()
        self.assertIsNone(inclusion.find_operation(self.session, self.workspace, self.actor, identity.operation_id))


    def test_database_identity_constraints_and_schema_cascade(self):
        plan, created = self.plan()
        inclusion.apply_inclusion_changes(self.session, plan, [change()], newly_initialized=created)
        inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                                   inclusion.operation_identity(operation_id(), NOW), 'a' * 64,
                                   {'plan': {'exists': True, 'revision': 1}}, NOW)
        self.session.flush()
        for row in (models.GroupSprintPlan(schema_id=self.schema, sprint_id='101', revision=1),
                    models.GroupSprintPlanEntry(plan_id=plan.id, issue_id='8101', included=False, revision=1),
                    models.GroupSprintPlanEntry(plan_id=plan.id, issue_id='8102', included=True, revision=0),
                    models.GroupSprintPlan(schema_id=str(uuid.uuid4()), sprint_id='102', revision=1),
                    models.PlanningSaveOperation(workspace_id=self.workspace, actor_user_id=self.actor,
                        operation_id=operation_id(), plan_id=plan.id, request_hash='b' * 64,
                        acknowledgement={}, expires_at=NOW + timedelta(days=1))):
            with self.assertRaises(IntegrityError), self.session.begin_nested():
                self.session.add(row)
                self.session.flush()
        self.session.delete(self.session.get(models.WorkspaceGroupReviewSchema, self.schema))
        self.session.flush()
        for model in (models.GroupSprintPlan, models.GroupSprintPlanEntry, models.PlanningSaveOperation):
            self.assertEqual(self.session.scalar(select(func.count()).select_from(model)), 0)

    def test_absent_false_noop_never_creates_tombstone(self):
        plan, _ = self.plan()
        self.assertEqual(inclusion.apply_inclusion_changes(self.session, plan, [change(included=False)]),
                         [dict(issueId='8101', included=False, revision=0)])
        self.assertEqual(plan.revision, 1)
        self.assertEqual(self.session.scalar(select(func.count()).select_from(models.GroupSprintPlanEntry)), 0)

    def test_expiry_cannot_be_extended_by_forged_identity(self):
        from dataclasses import replace
        plan, _ = self.plan()
        identity = inclusion.operation_identity(operation_id(), NOW)
        forged = replace(identity, expires_at=NOW + timedelta(days=2))
        self.error('invalid_operation_id', lambda: inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                   forged, 'a' * 64, {'plan': {'exists': True, 'revision': 1}}, NOW))

    def test_receipt_response_limit_and_serialization_fail_before_insertion(self):
        from unittest.mock import patch
        plan, _ = self.plan()
        identity = inclusion.operation_identity(operation_id(), NOW)
        with patch.object(inclusion, 'MAX_ACKNOWLEDGEMENT_BYTES', 100):
            self.error('review_response_limit', lambda: inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                       identity, 'a' * 64, {'plan': {'exists': True, 'revision': 1}, 'text': 'x' * 101}, NOW), 413)
        self.error('invalid_review_request', lambda: inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                   identity, 'a' * 64, {'plan': {'exists': True, 'revision': 1}, 'bad': object()}, NOW))
        self.assertEqual(self.session.scalar(select(func.count()).select_from(models.PlanningSaveOperation)), 0)

    def test_real_receipt_cap_and_replay_survive_cap_and_expiry(self):
        plan, _ = self.plan()
        for nonce in range(1, 257):
            inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                                       inclusion.operation_identity(operation_id(nonce=nonce), NOW), 'a' * 64,
                                       {'plan': {'exists': True, 'revision': 1}}, NOW)
        self.session.flush()
        self.assertEqual(self.session.scalar(select(func.count()).select_from(models.PlanningSaveOperation)), 256)
        self.error('planning_operation_limit', lambda: inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                   inclusion.operation_identity(operation_id(nonce=257), NOW), 'a' * 64,
                   {'plan': {'exists': True, 'revision': 1}}, NOW), 429)
        receipt = inclusion.find_operation(self.session, self.workspace, self.actor, operation_id(), scope=self.scope, request_hash='a' * 64)
        self.assertEqual(inclusion.operation_metadata(receipt)['status'], 'committed')
        self.assertIsNotNone(inclusion.find_operation(self.session, self.workspace, self.actor, operation_id()))

    def test_expired_pruning_leaves_other_plan_receipts(self):
        plan, _ = self.plan()
        other, _ = self.plan(sprint='102')
        for selected, nonce in ((plan, 1), (other, 2)):
            inclusion.record_operation(self.session, selected, self.workspace, self.actor,
                                       inclusion.operation_identity(operation_id(nonce=nonce), NOW), 'a' * 64,
                                       {'plan': {'exists': True, 'revision': 1}}, NOW)
        later = NOW + timedelta(days=1)
        inclusion.record_operation(self.session, plan, self.workspace, self.actor,
                                   inclusion.operation_identity(operation_id(later, 3), later), 'a' * 64,
                                   {'plan': {'exists': True, 'revision': 1}}, later)
        self.session.flush()
        self.assertIsNone(inclusion.find_operation(self.session, self.workspace, self.actor, operation_id()))
        self.assertIsNotNone(inclusion.find_operation(self.session, self.workspace, self.actor, operation_id(nonce=2)))

    def test_projection_missing_table_fails_closed(self):
        self.session.execute(text('DROP TABLE group_sprint_plan_entries'))
        with self.assertRaises(ProgrammingError):
            inclusion.load_inclusion_projection(self.session, self.schema, '101', ['8101'], 0)


class PlanMigrationTests(unittest.TestCase):
    def test_additive_upgrade_model_parity_preservation_and_refused_downgrade(self):
        url = fresh_database_url(self.addCleanup)
        config = Config('backend/db/alembic.ini')
        config.set_main_option('sqlalchemy.url', url)
        self.assertEqual(ScriptDirectory.from_config(config).get_heads(), ['20261106_0024'])
        command.upgrade(config, '20261030_0022')
        engine = create_engine(url)
        try:
            with engine.begin() as connection:
                connection.execute(text("INSERT INTO workspaces (id,environment_key,name,created_by,created_at,updated_at) VALUES (:id,'synthetic-migration','Synthetic','test',:now,:now)"), {'id': 'synthetic-workspace', 'now': NOW})
            with engine.connect() as connection:
                before = connection.execute(text('SELECT * FROM workspaces')).all()
            with Session(engine) as session:
                schema = models.WorkspaceGroupReviewSchema(workspace_id='synthetic-workspace', group_id='group-existing', schema_revision=4, columns=[])
                session.add(schema)
                session.flush()
                session.add(models.GroupReviewCell(schema_id=schema.id, issue_id='8101', row_kind='story', column_id='synthetic-column', value='preserved', revision=3))
                session.commit()
            with engine.connect() as connection:
                prior_review = {name: connection.execute(text(f'SELECT * FROM {name}')).all()
                                for name in ('workspace_group_review_schemas', 'group_review_cells')}
            command.upgrade(config, 'head')
            names = ('group_sprint_plans', 'group_sprint_plan_entries', 'planning_save_operations')
            for name in names:
                self.assertEqual(set(c['name'] for c in inspect(engine).get_columns(name)), set(models.Base.metadata.tables[name].columns.keys()))
            with engine.connect() as connection:
                self.assertEqual(connection.execute(text('SELECT * FROM workspaces')).all(), before)
                for name, values in prior_review.items():
                    self.assertEqual(connection.execute(text(f'SELECT * FROM {name}')).all(), values)
            with Session(engine) as session:
                schema = models.WorkspaceGroupReviewSchema(workspace_id='synthetic-workspace', group_id='group-x')
                session.add(schema)
                session.flush()
                plan, _ = inclusion.initialize_plan(session, schema.id, '101', True)
                session.commit()
            with self.assertRaisesRegex(RuntimeError, 'Refusing to downgrade'):
                command.downgrade(config, '20261030_0022')
            self.assertTrue(set(names) <= set(inspect(engine).get_table_names()))
            with engine.begin() as connection:
                self.assertEqual(connection.execute(text('SELECT revision FROM group_sprint_plans')).scalar_one(), 1)
                connection.execute(text('DELETE FROM group_sprint_plans'))
            command.downgrade(config, '20261030_0022')
            self.assertFalse(set(names) & set(inspect(engine).get_table_names()))
            command.upgrade(config, 'head')
        finally:
            engine.dispose()
