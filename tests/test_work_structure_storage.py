import unittest
from contextlib import ExitStack
from copy import deepcopy
from types import SimpleNamespace
from unittest import mock

from flask import g
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import jira_server
from backend.config.json_repository import JsonConfigRepository
from backend.db import models
from backend.services import work_structure as ws
from backend.services import workspace_dashboard_config as storage
from scripts import check_work_configuration_rollback as rollback
from tests.postgres_test_db import drop_database, fresh_database_url


class StorageHarness(unittest.TestCase):
    def setUp(self):
        self.database_url = fresh_database_url(self.addCleanup)
        engine = create_engine(self.database_url, future=True)
        models.Base.metadata.create_all(engine)
        self.factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)
        with self.factory() as session:
            session.add_all([
                models.User(id=f'user-{i}', external_provider='atlassian', external_subject=f's-{i}',
                            account_type='admin', status='active', created_by='test') for i in (1, 2)
            ])
            session.add_all([
                models.Workspace(id=f'workspace-{i}', environment_key='test', name=f'W{i}',
                                 jira_site_url=f'https://site-{i}.atlassian.net', created_by='test')
                for i in (1, 2)
            ])
            session.commit()
        self.engine = engine
        self.ctx = SimpleNamespace(workspace_id='workspace-1', user_id='user-1', site_url='https://site-1.atlassian.net')
        self.ctx_b = SimpleNamespace(workspace_id='workspace-1', user_id='user-2', site_url='https://site-1.atlassian.net')

    def tearDown(self):
        self.engine.dispose()

    def seed(self, payload, revision=4, **columns):
        with self.factory() as session:
            session.add(models.WorkspaceDashboardConfig(
                workspace_id='workspace-1', payload=payload, config_revision=revision, payload_version=1, **columns,
            ))
            session.commit()

    def row(self):
        with self.factory() as session:
            row = session.execute(select(models.WorkspaceDashboardConfig)).scalars().first()
            if row is None:
                return None
            return SimpleNamespace(payload=deepcopy(row.payload), revision=row.config_revision,
                                   verified_at=row.capacity_field_verified_at, site=row.capacity_jira_site_url)

    def audit_count(self):
        with self.factory() as session:
            return session.execute(select(func.count()).select_from(models.AuditEvent)).scalar()

    def envelope(self, **kwargs):
        return ws.load_editor_envelope(
            self.ctx, flag_enabled=True, user_can_edit=True, database_url=self.database_url, **kwargs,
        )

    def save(self, bundle, base, **kwargs):
        kwargs.setdefault('flag_enabled', True)
        return ws.save_work_configurations(self.ctx, bundle, base, database_url=self.database_url, **kwargs)

    def first_save(self, edits=None, mutate=None):
        envelope = self.envelope()
        bundle = deepcopy(envelope['workConfigurations'])
        if mutate:
            mutate(bundle)
        return self.save(bundle, envelope['configRevision'], legacy_edits=edits or [])

    def promoted_bundle(self):
        envelope = self.envelope()
        self.assertTrue(envelope['promoted'])
        return deepcopy(envelope['workConfigurations']), envelope['configRevision']

    def expect_error(self, code, call, status=None):
        with self.assertRaises(ws.WorkConfigError) as raised:
            call()
        self.assertEqual(raised.exception.code, code)
        if status:
            self.assertEqual(raised.exception.status, status)
        return raised.exception


FLAT = {
    'version': 1,
    'projects': {'selected': [{'key': 'OLD', 'type': 'tech'}]},
    'board': {'boardId': '7001', 'boardName': 'B'},
    'sprintField': {'fieldId': 'customfield_1', 'fieldName': 'Sprint'},
    'storyPointsField': {'fieldId': 'customfield_2', 'fieldName': 'SP'},
    'parentNameField': {'fieldId': 'customfield_3', 'fieldName': 'PN'},
    'teamField': {'fieldId': 'customfield_4', 'fieldName': 'Team'},
    'projectTrackField': {'fieldId': 'customfield_5', 'fieldName': 'PT'},
    'deliveryOwnerField': {'fieldId': 'customfield_6', 'fieldName': 'DO'},
    'issueTypes': ['Story', 'Bug'],
    'capacity': {'project': 'CAP', 'fieldId': 'customfield_7', 'fieldName': 'Cap'},
    'statsPriorityWeights': [{'priority': 'High', 'weight': 3}],
}


CATALOG = {
    '6': {'name': 'Epic', 'hierarchyLevel': 1},
    '11700': {'name': 'Initiative', 'hierarchyLevel': 2},
    '12723': {'name': 'Objective', 'hierarchyLevel': 3},
}


def map_delivery(bundle, **hierarchy):
    bundle['configurations'][1]['hierarchy'].update(hierarchy or {'planningIssueTypeId': '6', 'parentIssueTypeId': '11700'})


class NoAmbientReadTests(StorageHarness):
    """Capture and first save read the DB row only (validation corrections 6 and 7)."""

    def guards(self, stack):
        loader = stack.enter_context(mock.patch.object(
            JsonConfigRepository, 'load_dashboard_config', side_effect=AssertionError('JSON repository read')))
        server_loader = stack.enter_context(mock.patch.object(
            jira_server, '_load_dashboard_config_json', side_effect=AssertionError('server JSON read')))
        for name in ('load_dashboard_config', 'load_dashboard_config_snapshot', 'get_board_config',
                     'get_effective_board_id', 'get_selected_projects', 'get_selected_projects_typed',
                     'get_sprint_field_config', 'get_story_points_field_config', 'get_parent_name_field_config',
                     'get_team_field_config', 'get_project_track_field_config', 'get_delivery_owner_field_config',
                     'get_configured_issue_types'):
            stack.enter_context(mock.patch.object(jira_server, name, side_effect=AssertionError(name)))
        fallback = stack.enter_context(mock.patch.object(
            storage, '_fallback_snapshot', wraps=storage._fallback_snapshot))
        return loader, server_loader, fallback

    def poisoned_request_cache(self, stack):
        stack.enter_context(jira_server.app.test_request_context('/'))
        g._workspace_dashboard_config_snapshot = storage.WorkspaceConfigSnapshot(
            {'projects': {'selected': ['JSONCACHE']}, 'board': {'boardId': '999'}}, 0, 'legacy_json')

    def test_missing_row_virtual_get_never_reads_json_getters_or_request_cache(self):
        with ExitStack() as stack:
            loader, server_loader, fallback = self.guards(stack)
            self.poisoned_request_cache(stack)
            envelope = self.envelope()
        self.assertEqual((loader.call_count, server_loader.call_count), (0, 0))
        self.assertTrue(fallback.called)
        for call in fallback.call_args_list:
            self.assertIsNone(call.args[1])  # fallback_loader is None
        legacy = envelope['workConfigurations']['configurations'][0]
        self.assertEqual(legacy['scope'], {'projects': [], 'boardId': ''})
        self.assertEqual((envelope['configRevision'], envelope['promoted']), (0, False))
        self.assertIsNone(envelope['workConfigurations']['promotionRevision'])
        self.assertEqual([e['revision'] for e in envelope['workConfigurations']['configurations']], [0, 0])
        self.assertIsNone(self.row())  # GET wrote nothing

    def test_first_save_on_missing_row_never_reads_json_getters_or_request_cache(self):
        with ExitStack() as stack:
            loader, server_loader, fallback = self.guards(stack)
            self.poisoned_request_cache(stack)
            result = self.first_save()
        self.assertEqual((loader.call_count, server_loader.call_count), (0, 0))
        self.assertTrue(fallback.called and all(c.args[1] is None for c in fallback.call_args_list))
        self.assertEqual(result['configRevision'], 1)
        self.assertEqual(self.row().payload['workConfigurations']['promotionRevision'], 1)
        self.assertNotIn('JSONCACHE', str(self.row().payload))

    def test_existing_row_capture_ignores_json_and_cache(self):
        self.seed(FLAT)
        with ExitStack() as stack:
            self.guards(stack)
            self.poisoned_request_cache(stack)
            envelope = self.envelope()
        self.assertEqual(envelope['workConfigurations']['configurations'][0]['scope']['projects'],
                         [{'key': 'OLD', 'type': 'tech'}])
        self.assertEqual(envelope['configRevision'], 4)

    def test_seeded_unpromoted_bundle_is_ignored(self):
        seeded = {**FLAT, 'workConfigurations': ws.capture_virtual_bundle({'projects': {'selected': ['SEED']}})}
        self.seed(seeded)
        envelope = self.envelope()
        self.assertFalse(envelope['promoted'])
        self.assertEqual(envelope['workConfigurations']['configurations'][0]['scope']['projects'],
                         [{'key': 'OLD', 'type': 'tech'}])


class DepartmentAllocationOwnershipTests(StorageHarness):
    def test_first_promotion_rejects_admin_mapping_edits(self):
        self.seed(FLAT)
        before = self.envelope()
        draft = deepcopy(before['workConfigurations'])
        draft['configurations'][1]['allocationTypes'] = [{'value': 'Growth', 'type': 'product'}]
        error = self.expect_error('allocation_mapping_department_owned',
                                  lambda: self.save(draft, before['configRevision'], legacy_edits=[]), 400)
        self.assertEqual(error.response()[0], {
            'error': 'allocation_mapping_department_owned', 'status': 'error',
            'message': 'Configure Allocation values in Department settings.'})
        self.assertEqual(self.envelope(), before)

    def test_first_promotion_preserves_omitted_history_and_rejects_explicit_clear(self):
        history = [{'value': 'Growth', 'type': 'product'}]
        seed = ws.capture_virtual_bundle(FLAT)
        seed['configurations'][1]['allocationTypes'] = history
        self.seed({**deepcopy(FLAT), 'workConfigurations': seed})
        before = self.envelope()
        draft = deepcopy(before['workConfigurations'])
        self.expect_error('allocation_mapping_department_owned',
                          lambda: self.save(draft, before['configRevision'], legacy_edits=[]), 400)
        self.assertEqual(self.envelope(), before)
        del draft['configurations'][1]['allocationTypes']
        saved = self.save(draft, before['configRevision'], legacy_edits=[])
        self.assertEqual(saved['workConfigurations']['configurations'][1]['allocationTypes'], history)

    def test_old_global_map_is_preserved_on_echo_and_omission_but_not_edit_or_clear(self):
        history = [{'value': 'Growth', 'type': 'product'}]
        seed = ws.capture_virtual_bundle(FLAT)
        seed['configurations'][1]['allocationTypes'] = history
        self.seed({**deepcopy(FLAT), 'workConfigurations': seed})
        for promoted in (False, True):
            before = self.envelope()
            draft = deepcopy(before['workConfigurations'])
            draft['configurations'][1]['allocationTypes'] = history
            saved = self.save(draft, before['configRevision'], **({} if promoted else {'legacy_edits': []}))
            self.assertEqual(saved['workConfigurations']['configurations'][1]['allocationTypes'], history)
            draft = deepcopy(saved['workConfigurations'])
            del draft['configurations'][1]['allocationTypes']
            saved = self.save(draft, saved['configRevision'])
            self.assertEqual(saved['workConfigurations']['configurations'][1]['allocationTypes'], history)
            for mapping in ([], [{'value': 'Growth', 'type': 'tech'}]):
                draft = deepcopy(saved['workConfigurations'])
                draft['configurations'][1]['allocationTypes'] = mapping
                self.expect_error('allocation_mapping_department_owned',
                                  lambda: self.save(draft, saved['configRevision']), 400)
            self.assertEqual(self.envelope()['workConfigurations']['configurations'][1]['allocationTypes'], history)


class FirstSaveTests(StorageHarness):
    def test_promotes_atomically_and_removes_only_moved_keys(self):
        self.seed({**FLAT}, capacity_jira_site_url='https://site-1.atlassian.net', capacity_field_schema_type='number')
        before_audits = self.audit_count()
        result = self.first_save()
        self.assertEqual((result['configRevision'], result['promoted']), (5, True))
        self.assertEqual(result['changedConfigurationIds'], ['legacy', 'delivery'])
        saved = self.row()
        self.assertEqual(saved.revision, 5)
        bundle = saved.payload['workConfigurations']
        self.assertEqual(bundle['promotionRevision'], 5)
        self.assertEqual([e['revision'] for e in bundle['configurations']], [1, 1])
        for key in ws.MOVED_STRUCTURAL_KEYS:
            self.assertNotIn(key, saved.payload)
        self.assertEqual(saved.payload['capacity'], FLAT['capacity'])
        self.assertEqual(saved.payload['statsPriorityWeights'], FLAT['statsPriorityWeights'])
        self.assertEqual(saved.site, 'https://site-1.atlassian.net')
        legacy = bundle['configurations'][0]
        self.assertEqual(legacy['scope'], {'projects': [{'key': 'OLD', 'type': 'tech'}], 'boardId': '7001'})
        self.assertEqual(legacy['legacyIssueTypeNames'], ['Story', 'Bug'])
        self.assertEqual(legacy['fields']['deliveryOwner']['fieldId'], 'customfield_6')
        self.assertEqual(self.audit_count(), before_audits + 1)

    def test_delivery_edits_apply_and_delivery_is_server_owned(self):
        def edit(bundle):
            delivery = bundle['configurations'][1]
            delivery['scope']['projects'] = [{'key': 'PLAN'}]
            delivery['hierarchy']['planningIssueTypeId'] = '10'
            delivery['fields']['sprint'] = {'fieldId': 'customfield_9', 'fieldName': 'S'}
        self.seed(FLAT)
        self.first_save(mutate=edit)
        delivery = self.row().payload['workConfigurations']['configurations'][1]
        self.assertEqual(delivery['scope']['projects'], [{'key': 'PLAN', 'type': 'other'}])
        self.assertEqual(delivery['hierarchy']['planningIssueTypeId'], '10')

    def test_forged_ids_and_models_rejected_before_mutation(self):
        self.seed(FLAT)
        envelope = self.envelope()
        for mutate in (lambda b: b['configurations'][1].update(id='other'),
                       lambda b: b['configurations'][0].update(id='other'),
                       lambda b: b['configurations'][1].update(model='legacy')):
            bundle = deepcopy(envelope['workConfigurations'])
            mutate(bundle)
            self.expect_error('invalid_work_configurations', lambda: self.save(bundle, 4, legacy_edits=[]))
        self.assertEqual(self.row().revision, 4)
        self.assertIn('projects', self.row().payload)

    def test_echoed_blank_defaults_never_delete_but_explicit_clear_does(self):
        self.seed(FLAT)
        def blank_legacy(bundle):
            legacy = bundle['configurations'][0]
            legacy['scope'] = {'projects': [], 'boardId': ''}
            legacy['fields']['team'] = {'fieldId': '', 'fieldName': ''}
        self.first_save(mutate=blank_legacy)  # no legacyEdits: echo is not authority
        legacy = self.row().payload['workConfigurations']['configurations'][0]
        self.assertEqual(legacy['scope']['projects'], [{'key': 'OLD', 'type': 'tech'}])
        self.assertEqual(legacy['fields']['team']['fieldId'], 'customfield_4')

    def test_explicit_clear_requires_clear_flag(self):
        self.seed(FLAT)
        self.expect_error('invalid_work_configurations', lambda: self.first_save(
            edits=[{'path': 'scope.projects', 'value': []}]))
        self.first_save(edits=[{'path': 'scope.projects', 'clear': True},
                               {'path': 'fields.team.fieldId', 'clear': True}])
        legacy = self.row().payload['workConfigurations']['configurations'][0]
        self.assertEqual(legacy['scope']['projects'], [])
        self.assertEqual(legacy['fields']['team']['fieldId'], '')
        self.assertEqual(legacy['scope']['boardId'], '7001')

    def test_edit_protocol_validation(self):
        self.seed(FLAT)
        bad_edits = [
            [{'path': 'model', 'value': 'rnd_2027'}],
            [{'path': 'id', 'value': 'x'}],
            [{'path': 'revision', 'value': 9}],
            [{'path': 'legacyIssueTypeNames', 'clear': True}],
            [{'path': 'legacyHierarchyModes.parent', 'value': 'mapped'}],
            [{'path': 'fields.allocation.fieldId', 'value': 'customfield_1'}],
            [{'path': 'name', 'value': 'A'}, {'path': 'name', 'value': 'B'}],
            [{'path': 'name', 'value': 'A', 'clear': True}],
            [{'path': 'name'}],
            [{'path': 'name', 'value': 'A', 'extra': 1}],
            [{'path': 'hierarchy.parentIssueTypeId', 'value': 'Epic'}],
        ]
        for edits in bad_edits:
            self.expect_error('invalid_work_configurations', lambda: self.first_save(edits=edits))
        self.assertEqual(self.row().revision, 4)

    def test_edits_apply_name_range_board_and_derive_modes(self):
        self.seed(FLAT)
        def move_boundary(bundle):
            bundle['configurations'][0]['throughQuarter'] = '2027Q2'
            bundle['configurations'][1]['fromQuarter'] = '2027Q3'
        self.first_save(edits=[
            {'path': 'name', 'value': 'Classic'}, {'path': 'throughQuarter', 'value': '2027Q2'},
            {'path': 'scope.boardId', 'value': '8002'},
            {'path': 'hierarchy.parentIssueTypeId', 'value': '10'},
            {'path': 'hierarchy.planningIssueTypeId', 'value': '11'},
        ], mutate=move_boundary)
        legacy = self.row().payload['workConfigurations']['configurations'][0]
        self.assertEqual((legacy['name'], legacy['throughQuarter'], legacy['scope']['boardId']),
                         ('Classic', '2027Q2', '8002'))
        self.assertEqual(legacy['hierarchy']['parentIssueTypeId'], '10')
        self.assertEqual(legacy['legacyHierarchyModes'], {'parent': 'mapped', 'ancestor': 'compatibility'})
        self.assertIsNone(legacy['legacyIssueTypeNames'])  # planning choice retires the name filter
        self.assertEqual(legacy['hierarchy']['planningIssueTypeId'], '11')

    def test_same_display_id_planning_replacement_still_retires_filter(self):
        self.seed(FLAT)
        self.first_save(edits=[{'path': 'hierarchy.planningIssueTypeId', 'value': '10'}])
        legacy = self.row().payload['workConfigurations']['configurations'][0]
        self.assertIsNone(legacy['legacyIssueTypeNames'])
        self.assertEqual(legacy['hierarchy']['planningIssueTypeId'], '10')

    def test_unrelated_first_save_preserves_planning_filter_and_modes(self):
        self.seed(FLAT)
        self.first_save(edits=[{'path': 'scope.boardId', 'value': '1'}])
        legacy = self.row().payload['workConfigurations']['configurations'][0]
        self.assertEqual(legacy['legacyIssueTypeNames'], ['Story', 'Bug'])
        self.assertEqual(legacy['legacyHierarchyModes'], {'parent': 'compatibility', 'ancestor': 'compatibility'})

    def test_prefetched_display_types_are_stored_and_clear_ids_rejected_on_first_save(self):
        self.seed(FLAT)
        envelope = self.envelope()
        display = {'parent': {'id': '10', 'name': 'Epic'}, 'ancestor': None}
        self.expect_error('invalid_work_configurations', lambda: self.save(
            envelope['workConfigurations'], 4, legacy_edits=[], clear_projects_for_configuration_ids=['legacy']))
        self.save(envelope['workConfigurations'], 4, legacy_edits=[], legacy_display_types=display)
        legacy = self.row().payload['workConfigurations']['configurations'][0]
        self.assertEqual(legacy['legacyDisplayTypes'], display)

    def test_first_save_captures_type_names(self):
        self.seed(FLAT)
        envelope = self.envelope()
        bundle = deepcopy(envelope['workConfigurations'])
        map_delivery(bundle)
        result = self.save(bundle, 4, legacy_edits=[], issue_type_catalog=CATALOG)
        names = self.row().payload['workConfigurationTypeNames']
        self.assertEqual(names['delivery'], {
            'planning': {'id': '6', 'name': 'Epic', 'hierarchyLevel': 1},
            'parent': {'id': '11700', 'name': 'Initiative', 'hierarchyLevel': 2},
            'ancestor': None, 'optionalAncestor': None,
        })
        self.assertEqual(set(names), {'legacy', 'delivery'})
        # Outside the bundle: the saved bundle and the editor envelope never carry the names.
        self.assertNotIn('workConfigurationTypeNames', result['workConfigurations'])
        self.assertNotIn('workConfigurationTypeNames', self.envelope())
        self.assertNotIn('workConfigurationTypeNames', self.envelope()['workConfigurations'])

    def test_flag_off_blocks_save_without_mutation(self):
        self.seed(FLAT)
        envelope = self.envelope()
        self.expect_error('configuration_feature_disabled',
                          lambda: self.save(envelope['workConfigurations'], 4, legacy_edits=[], flag_enabled=False),
                          status=409)
        self.assertEqual(self.row().revision, 4)
        self.assertNotIn('workConfigurations', self.row().payload)

    def test_recheck_runs_inside_the_fence(self):
        self.seed(FLAT)
        calls = []
        def recheck(payload, revision):
            calls.append((sorted(payload)[0], revision))
            raise ws.WorkConfigError('admin_required')
        envelope = self.envelope()
        self.expect_error('admin_required', lambda: self.save(
            envelope['workConfigurations'], 4, legacy_edits=[], recheck=recheck))
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.row().revision, 4)


class RaceAndAtomicityTests(StorageHarness):
    def test_first_save_race_has_one_winner_and_loser_gets_current_bundle(self):
        self.seed(FLAT)
        a = self.envelope()
        winner = deepcopy(a['workConfigurations'])
        winner['configurations'][1]['scope']['projects'] = [{'key': 'WIN'}]
        self.save(winner, 4, legacy_edits=[])
        loser = deepcopy(a['workConfigurations'])
        loser['configurations'][1]['scope']['projects'] = [{'key': 'LOSE'}]
        with self.assertRaises(storage.WorkspaceConfigConflict) as raised:
            self.save(loser, 4, legacy_edits=[{'path': 'scope.boardId', 'value': '9'}])
        body = ws.conflict_envelope(raised.exception)
        self.assertEqual(body['error'], 'workspace_config_conflict')
        self.assertEqual(body['configRevision'], 5)
        self.assertEqual(body['workConfigurations']['promotionRevision'], 5)
        self.assertEqual(body['workConfigurations']['configurations'][1]['scope']['projects'][0]['key'], 'WIN')
        saved = self.row()
        self.assertEqual(saved.revision, 5)
        self.assertEqual(saved.payload['workConfigurations']['configurations'][0]['scope']['boardId'], '7001')

    def test_missing_row_first_save_race_single_winner(self):
        a = self.envelope()
        self.save(deepcopy(a['workConfigurations']), 0, legacy_edits=[])
        with self.assertRaises(storage.WorkspaceConfigConflict) as raised:
            self.save(deepcopy(a['workConfigurations']), 0, legacy_edits=[])
        self.assertEqual(raised.exception.current.config_revision, 1)
        self.assertTrue(ws.is_promoted(raised.exception.current.payload))
        self.assertEqual(self.row().revision, 1)

    def test_stale_protocol_after_competing_promotion_is_rejected_without_mutation(self):
        self.seed(FLAT)
        self.first_save()
        bundle, revision = self.promoted_bundle()
        self.expect_error('invalid_work_configurations',
                          lambda: self.save(bundle, revision, legacy_edits=[{'path': 'scope.boardId', 'value': '1'}]))
        self.assertEqual(self.row().revision, revision)

    def test_multikey_write_is_atomic_when_audit_fails(self):
        self.seed(FLAT)
        before = self.row()
        with mock.patch.object(models, 'audit_event', side_effect=RuntimeError('audit down')):
            with self.assertRaises(RuntimeError):
                self.first_save()
        after = self.row()
        self.assertEqual((after.revision, after.payload), (before.revision, before.payload))

    def test_stale_base_revision_conflicts_without_partial_key_removal(self):
        self.seed(FLAT)
        self.first_save()
        bundle, revision = self.promoted_bundle()
        bundle['configurations'][1]['name'] = 'RENAMED'
        self.save(bundle, revision)
        stale = deepcopy(bundle)
        stale['configurations'][1]['name'] = 'STALE'
        with self.assertRaises(storage.WorkspaceConfigConflict):
            self.save(stale, revision)
        self.assertEqual(self.row().payload['workConfigurations']['configurations'][1]['name'], 'RENAMED')


class LaterSaveTests(StorageHarness):
    def setUp(self):
        super().setUp()
        self.seed(FLAT)
        self.first_save()

    def test_noop_save_does_not_advance_any_revision(self):
        bundle, revision = self.promoted_bundle()
        audits = self.audit_count()
        result = self.save(bundle, revision)
        self.assertEqual((result['changedConfigurationIds'], result['configRevision']), ([], revision))
        self.assertEqual(self.row().revision, revision)
        self.assertEqual([e['revision'] for e in self.row().payload['workConfigurations']['configurations']], [1, 1])
        self.assertEqual(self.audit_count(), audits)

    def names(self):
        return self.row().payload.get('workConfigurationTypeNames')

    def test_save_after_promotion_refreshes_type_names(self):
        bundle, revision = self.promoted_bundle()
        map_delivery(bundle)
        result = self.save(bundle, revision, issue_type_catalog=CATALOG)
        self.assertEqual(result['changedConfigurationIds'], ['delivery'])
        self.assertEqual(self.names()['delivery']['planning'], {'id': '6', 'name': 'Epic', 'hierarchyLevel': 1})
        # Remapping with a failed prefetch keeps the unchanged slot and nulls the changed one.
        bundle['configurations'][1]['hierarchy']['parentIssueTypeId'] = '12723'
        self.save(bundle, result['configRevision'], issue_type_catalog=None)
        self.assertEqual(self.names()['delivery']['planning']['name'], 'Epic')
        self.assertIsNone(self.names()['delivery']['parent'])

    def test_names_only_change_keeps_entry_revisions(self):
        bundle, revision = self.promoted_bundle()
        map_delivery(bundle)
        revision = self.save(bundle, revision, issue_type_catalog=CATALOG)['configRevision']
        entry_revisions = [e['revision'] for e in self.row().payload['workConfigurations']['configurations']]
        audits = self.audit_count()
        renamed = {**CATALOG, '6': {'name': 'Capability', 'hierarchyLevel': 1}}
        result = self.save(bundle, revision, issue_type_catalog=renamed)
        self.assertEqual(result['changedConfigurationIds'], [])
        self.assertEqual(result['configRevision'], revision + 1)
        self.assertEqual(self.audit_count(), audits + 1)
        self.assertEqual([e['revision'] for e in self.row().payload['workConfigurations']['configurations']],
                         entry_revisions)
        self.assertEqual([e['revision'] for e in result['workConfigurations']['configurations']], entry_revisions)
        self.assertEqual(self.names()['delivery']['planning']['name'], 'Capability')

    def test_unchanged_names_and_bundle_is_a_no_op(self):
        bundle, revision = self.promoted_bundle()
        map_delivery(bundle)
        revision = self.save(bundle, revision, issue_type_catalog=CATALOG)['configRevision']
        audits = self.audit_count()
        for catalog in (CATALOG, None):
            with self.subTest(catalog=catalog is not None):
                result = self.save(bundle, revision, issue_type_catalog=catalog)
                self.assertEqual((result['changedConfigurationIds'], result['configRevision']), ([], revision))
                self.assertEqual(self.row().revision, revision)
                self.assertEqual(self.audit_count(), audits)

    def test_other_dashboard_config_writes_preserve_type_names(self):
        bundle, revision = self.promoted_bundle()
        map_delivery(bundle)
        revision = self.save(bundle, revision, issue_type_catalog=CATALOG)['configRevision']
        before = self.names()
        storage.update_workspace_config_section(
            self.ctx, 'statsPriorityWeights', [{'priority': 'Low', 'weight': 1}], revision,
            database_url=self.database_url)
        self.assertEqual(self.names(), before)

    def test_rename_only_advances_that_entry_and_global_once(self):
        bundle, revision = self.promoted_bundle()
        bundle['configurations'][1]['name'] = 'Planning'
        result = self.save(bundle, revision)
        self.assertEqual(result['changedConfigurationIds'], ['delivery'])
        self.assertEqual(result['configRevision'], revision + 1)
        saved = self.row().payload['workConfigurations']
        self.assertEqual([e['revision'] for e in saved['configurations']], [1, 2])
        self.assertEqual(saved['promotionRevision'], revision)  # first-save revision never moves

    def test_unrelated_global_revision_changes_do_not_move_promotion(self):
        storage.update_workspace_config_section(
            self.ctx, 'statsPriorityWeights', [{'priority': 'Low', 'weight': 1}], self.row().revision,
            database_url=self.database_url)
        self.assertTrue(ws.is_promoted(self.row().payload))
        self.assertEqual(self.row().payload['workConfigurations']['promotionRevision'], 5)

    def test_project_clear_requires_explicit_acknowledgement(self):
        bundle, revision = self.promoted_bundle()
        bundle['configurations'][1]['scope']['projects'] = [{'key': 'PLAN'}]
        revision = self.save(bundle, revision)['configRevision']
        cleared = deepcopy(bundle)
        cleared['configurations'][1]['scope']['projects'] = []
        error = self.expect_error('invalid_work_configurations', lambda: self.save(cleared, revision))
        self.assertEqual(error.configuration_id, 'delivery')
        self.expect_error('invalid_configuration_id', lambda: self.save(
            cleared, revision, clear_projects_for_configuration_ids=['nope']))
        self.save(cleared, revision, clear_projects_for_configuration_ids=['delivery'])
        self.assertEqual(self.row().payload['workConfigurations']['configurations'][1]['scope']['projects'], [])

    def test_omitting_clear_never_clears_legacy_projects_after_promotion(self):
        bundle, revision = self.promoted_bundle()
        bundle['configurations'][0]['scope']['projects'] = []
        self.expect_error('invalid_work_configurations', lambda: self.save(bundle, revision))
        self.assertEqual(len(self.row().payload['workConfigurations']['configurations'][0]['scope']['projects']), 1)

    def test_server_owned_values_cannot_be_changed(self):
        bundle, revision = self.promoted_bundle()
        for mutate in (lambda b: b['configurations'][0].update(id='x'),
                       lambda b: b.update(promotionRevision=99),
                       lambda b: b['configurations'][0]['legacyDisplayTypes'].update(parent={'id': '1', 'name': 'E'})):
            forged = deepcopy(bundle)
            mutate(forged)
            self.expect_error('invalid_work_configurations', lambda: self.save(forged, revision))
        echoed = deepcopy(bundle)
        echoed['configurations'][1]['revision'] = 77  # entry revisions are server-owned and ignored
        self.assertEqual(self.save(echoed, revision)['changedConfigurationIds'], [])

    def test_legacy_edits_rejected_after_promotion(self):
        bundle, revision = self.promoted_bundle()
        self.expect_error('invalid_work_configurations',
                          lambda: self.save(bundle, revision, legacy_edits=[{'path': 'name', 'value': 'X'}]))

    def test_flag_off_blocks_later_save(self):
        bundle, revision = self.promoted_bundle()
        self.expect_error('configuration_feature_disabled', lambda: self.save(bundle, revision, flag_enabled=False))

    def test_old_structural_writers_reject_after_promotion_but_other_sections_pass(self):
        revision = self.row().revision
        for section, value in (('board', {'boardId': '1'}), ('projects', {'selected': ['X']}),
                               ('issueTypes', ['Epic']), ('teamField', {'fieldId': 'customfield_1'})):
            error = self.expect_error('configuration_bundle_required', lambda: storage.update_workspace_config_section(
                self.ctx, section, value, revision, database_url=self.database_url), status=409)
            self.assertEqual(error.response()[1], 409)
        self.assertEqual(self.row().revision, revision)
        for key in ws.MOVED_STRUCTURAL_KEYS:
            self.assertNotIn(key, self.row().payload)
        storage.update_workspace_config_section(
            self.ctx, 'statsPriorityWeights', [{'priority': 'Low', 'weight': 1}], revision,
            database_url=self.database_url)
        self.assertTrue(ws.is_promoted(self.row().payload))


class DurableSlotAuthorityTests(StorageHarness):
    SLOTS = (('parent', 'parentIssueTypeId'), ('ancestor', 'ancestorIssueTypeId'))

    def test_clear_survives_reload_and_unrelated_save_for_each_slot_independently(self):
        for slot, key in self.SLOTS:
            with self.subTest(slot=slot):
                self.tearDown()
                self.setUp()
                self.seed(FLAT)
                self.first_save(edits=[{'path': f'hierarchy.{key}', 'clear': True}])
                other = 'ancestor' if slot == 'parent' else 'parent'
                bundle, revision = self.promoted_bundle()  # reload
                legacy = bundle['configurations'][0]
                self.assertEqual(legacy['legacyHierarchyModes'][slot], 'mapped')
                self.assertIsNone(legacy['hierarchy'][key])
                self.assertEqual(legacy['legacyHierarchyModes'][other], 'compatibility')
                bundle['configurations'][1]['name'] = 'Planning'  # unrelated save
                self.save(bundle, revision)
                saved = self.row().payload['workConfigurations']['configurations'][0]
                self.assertEqual(saved['legacyHierarchyModes'][slot], 'mapped')
                self.assertIsNone(saved['hierarchy'][key])
                self.assertEqual(saved['legacyHierarchyModes'][other], 'compatibility')
                final, _ = self.promoted_bundle()
                self.assertEqual(final['configurations'][0]['legacyHierarchyModes'][slot], 'mapped')

    def test_restoring_compatibility_after_mapping_is_rejected_without_mutation(self):
        self.seed(FLAT)
        self.first_save(edits=[{'path': 'hierarchy.parentIssueTypeId', 'clear': True}])
        bundle, revision = self.promoted_bundle()
        bundle['configurations'][0]['legacyHierarchyModes']['parent'] = 'compatibility'
        error = self.expect_error('invalid_work_configurations', lambda: self.save(bundle, revision))
        self.assertEqual((error.configuration_id, error.slot), ('legacy', 'parentIssueTypeId'))
        self.assertEqual(self.row().revision, revision)

    def test_competing_editor_retires_slot_while_local_draft_keeps_compatibility(self):
        for slot, key in self.SLOTS:
            with self.subTest(slot=slot):
                self.tearDown()
                self.setUp()
                self.seed(FLAT)
                self.first_save()
                local, revision = self.promoted_bundle()  # editor A draft keeps compatibility
                local['configurations'][1]['name'] = 'Local rename'
                theirs, _ = self.promoted_bundle()  # editor B maps the slot
                theirs['configurations'][0]['hierarchy'][key] = '10'
                theirs['configurations'][0]['legacyHierarchyModes'][slot] = 'mapped'
                latest = self.save(theirs, revision)['configRevision']
                before = self.row()
                error = self.expect_error('invalid_work_configurations', lambda: self.save(local, latest))
                self.assertEqual((error.configuration_id, error.slot), ('legacy', key))
                body, status = error.response()
                self.assertEqual((status, body['configurationId'], body['slot']), (400, 'legacy', key))
                after = self.row()
                self.assertEqual((after.revision, after.payload), (before.revision, before.payload))
                # explicit mapping repair then succeeds
                local['configurations'][0]['hierarchy'][key] = '10'
                local['configurations'][0]['legacyHierarchyModes'][slot] = 'mapped'
                self.assertEqual(self.save(local, latest)['changedConfigurationIds'], ['delivery'])

    def test_competing_editor_retires_planning_filter_while_local_draft_keeps_it(self):
        self.seed(FLAT)
        self.first_save()
        local, revision = self.promoted_bundle()
        local['configurations'][1]['name'] = 'Local rename'
        theirs, _ = self.promoted_bundle()
        theirs['configurations'][0]['legacyIssueTypeNames'] = None
        theirs['configurations'][0]['hierarchy']['planningIssueTypeId'] = '10'
        latest = self.save(theirs, revision)['configRevision']
        before = self.row()
        error = self.expect_error('invalid_work_configurations', lambda: self.save(local, latest))
        self.assertEqual((error.configuration_id, error.slot), ('legacy', 'planningIssueTypeId'))
        self.assertEqual(self.row().payload, before.payload)
        self.assertEqual(self.row().revision, before.revision)

    def test_captured_planning_filter_cannot_be_rewritten_by_browser(self):
        self.seed(FLAT)
        self.first_save()
        bundle, revision = self.promoted_bundle()
        bundle['configurations'][0]['legacyIssueTypeNames'] = ['Task']
        self.expect_error('invalid_work_configurations', lambda: self.save(bundle, revision))

    def test_mapped_null_clear_is_a_real_revisioned_edit(self):
        self.seed(FLAT)
        self.first_save()
        bundle, revision = self.promoted_bundle()
        bundle['configurations'][0]['legacyHierarchyModes']['ancestor'] = 'mapped'  # null -> null, mode changed
        result = self.save(bundle, revision)
        self.assertEqual(result['changedConfigurationIds'], ['legacy'])
        self.assertEqual(result['configRevision'], revision + 1)
        self.assertEqual(self.row().payload['workConfigurations']['configurations'][0]['revision'], 2)


class RollbackCheckerTests(StorageHarness):
    def run_checker(self):
        return rollback.main(['--workspace-id', 'workspace-1'], database_url=self.database_url)

    def test_refuses_any_promoted_bundle_and_never_mutates(self):
        self.seed(FLAT)
        self.first_save()
        before = self.row()
        with mock.patch('builtins.print') as printed:
            self.assertEqual(self.run_checker(), 1)
        self.assertIn('refused', printed.call_args[0][0])
        after = self.row()
        self.assertEqual((after.revision, after.payload), (before.revision, before.payload))

    def test_unpromoted_seed_and_missing_row_pass(self):
        self.assertEqual(self.run_checker(), 0)
        self.assertIsNone(self.row())
        self.seed({**FLAT, 'workConfigurations': ws.capture_virtual_bundle({})})
        self.assertEqual(self.run_checker(), 0)

    def test_workspace_selection_is_explicit(self):
        with self.assertRaises(SystemExit):
            rollback.main([], database_url=self.database_url)
        self.seed(FLAT)
        self.first_save()
        self.assertEqual(rollback.main(['--workspace-id', 'workspace-2'], database_url=self.database_url), 0)

    def test_unavailable_database_reports_two_without_details(self):
        missing = fresh_database_url()
        drop_database(missing)
        with mock.patch('sys.stderr'):
            self.assertEqual(rollback.main(['--workspace-id', 'w'], database_url=missing), 2)


class PrivateViewOwnershipTests(unittest.TestCase):
    def test_private_view_cannot_carry_the_bundle(self):
        from backend.config.shared_config import strip_shared_sections_from_private_view
        stripped = strip_shared_sections_from_private_view({'workConfigurations': {}, 'filters': {}})
        self.assertNotIn('workConfigurations', stripped)


if __name__ == '__main__':
    unittest.main()
