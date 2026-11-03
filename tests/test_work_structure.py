import dataclasses
import unittest
from copy import deepcopy

from backend.config.view_validation import _collect_forbidden_paths
from backend.services import work_structure as ws
from backend.services.workspace_dashboard_config import WorkspaceConfigSnapshot


def virtual(payload=None, board=''):
    return ws.capture_virtual_bundle(payload or {}, env_board_id=board)


def promoted_snapshot(bundle=None, revision=3):
    bundle = deepcopy(bundle or virtual())
    for entry in bundle['configurations']:
        entry['revision'] = 1
    bundle['promotionRevision'] = revision
    return WorkspaceConfigSnapshot({'workConfigurations': bundle}, revision, 'workspace_db')


def invalid(testcase, bundle, path_fragment=None):
    with testcase.assertRaises(ws.WorkConfigError) as raised:
        ws.normalize_work_configurations(bundle)
    testcase.assertEqual(raised.exception.code, 'invalid_work_configurations')
    if path_fragment:
        testcase.assertTrue(any(path_fragment in p for p in raised.exception.paths), raised.exception.paths)
    return raised.exception


class QuarterGrammarTests(unittest.TestCase):
    def test_accepts_strict_quarters(self):
        for value in ('0001Q1', '2026Q4', '9999Q4'):
            self.assertEqual(ws.parse_quarter(value), (int(value[:4]), int(value[5])))

    def test_rejects_everything_else_without_normalizing(self):
        for value in ('2026q4', ' 2026Q4', '2026Q4 ', '0000Q1', '12026Q1', '026Q1', '2026Q5', '2026Q0',
                      '２０２６Q1', '2026Q4\n', '2026-Q4', None, 2026, ''):
            with self.assertRaises(ws.WorkConfigError, msg=repr(value)) as raised:
                ws.parse_quarter(value)
            self.assertEqual(raised.exception.code, 'invalid_quarter')

    def test_next_quarter_rolls_over_and_stops_at_9999(self):
        self.assertEqual(ws.next_quarter('2026Q4'), '2027Q1')
        self.assertEqual(ws.next_quarter('2026Q1'), '2026Q2')
        with self.assertRaises(ws.WorkConfigError):
            ws.next_quarter('9999Q4')


class CaptureTests(unittest.TestCase):
    def legacy(self, bundle):
        return bundle['configurations'][0]

    def test_empty_db_state_uses_effective_defaults_and_blank_delivery(self):
        bundle = virtual(board='7001')
        legacy, delivery = bundle['configurations']
        self.assertEqual(legacy['scope'], {'projects': [], 'boardId': '7001'})
        self.assertEqual(legacy['legacyIssueTypeNames'], ['Story'])
        self.assertEqual(legacy['fields']['sprint']['fieldId'], 'customfield_10101')
        self.assertEqual(legacy['fields']['storyPoints']['fieldId'], 'customfield_10004')
        self.assertEqual(legacy['fields']['team']['fieldId'], 'customfield_30101')
        self.assertEqual(legacy['fields']['projectTrack']['fieldId'], 'customfield_35024')
        self.assertEqual(legacy['fields']['parentName']['fieldId'], '')
        self.assertEqual(legacy['fields']['deliveryOwner']['fieldId'], '')
        self.assertEqual(legacy['legacyHierarchyModes'], {'parent': 'compatibility', 'ancestor': 'compatibility'})
        self.assertEqual(legacy['legacyDisplayTypes'], {'parent': None, 'ancestor': None})
        self.assertEqual((legacy['revision'], delivery['revision']), (0, 0))
        self.assertEqual(delivery['scope'], {'projects': [], 'boardId': ''})
        self.assertTrue(all(v is None for v in delivery['hierarchy'].values()))
        self.assertTrue(all(v == ({'fieldId': '', 'fieldName': '', 'mode': 'shared'} if k in ws.SHARED_FIELD_NAMES
                                  else {'fieldId': '', 'fieldName': ''}) for k, v in delivery['fields'].items()))
        self.assertIsNone(bundle['promotionRevision'])

    def test_present_keys_win_over_defaults_even_when_blank(self):
        payload = {
            'board': {'boardId': '', 'boardName': 'x'},
            'sprintField': {'fieldId': '', 'fieldName': ''},
            'teamField': {'fieldId': 'customfield_9', 'fieldName': 'T'},
            'issueTypes': [],
        }
        legacy = self.legacy(virtual(payload, board='555'))
        self.assertEqual(legacy['scope']['boardId'], '')
        self.assertEqual(legacy['fields']['sprint']['fieldId'], '')
        self.assertEqual(legacy['fields']['team'], {'fieldId': 'customfield_9', 'fieldName': 'T'})
        self.assertEqual(legacy['legacyIssueTypeNames'], [])
        self.assertEqual(legacy['fields']['storyPoints']['fieldId'], 'customfield_10004')

    def test_null_issue_types_become_story_and_oversized_scope_is_preserved(self):
        selected = [{'key': f'P{i}', 'type': 'tech' if i % 2 else 'product'} for i in range(300)]
        legacy = self.legacy(virtual({'issueTypes': None, 'projects': {'selected': selected + ['OLD']}}))
        self.assertEqual(legacy['legacyIssueTypeNames'], ['Story'])
        self.assertEqual(len(legacy['scope']['projects']), 301)
        self.assertEqual(legacy['scope']['projects'][-1], {'key': 'OLD', 'type': 'product'})

    def test_capture_rejects_json_backed_snapshots(self):
        with self.assertRaises(ValueError):
            ws.capture_from_snapshot(WorkspaceConfigSnapshot({}, 0, 'legacy_json'))

    def test_bundle_contains_no_forbidden_paths(self):
        self.assertEqual(_collect_forbidden_paths(virtual()), [])


class NormalizationTests(unittest.TestCase):
    def test_virtual_bundle_round_trips(self):
        bundle = virtual()
        self.assertEqual(ws.normalize_work_configurations(deepcopy(bundle)), bundle)

    def test_exactly_two_ordered_configurations(self):
        bundle = virtual()
        invalid(self, {**bundle, 'configurations': bundle['configurations'][:1]})
        invalid(self, {**bundle, 'configurations': bundle['configurations'] * 2})
        swapped = deepcopy(bundle)
        swapped['configurations'].reverse()
        invalid(self, swapped)

    def test_ranges_must_be_contiguous_open_ended_and_strict(self):
        for through, from_ in (('2026Q3', '2027Q1'), ('2026Q4', '2026Q4'), ('2026Q4', '2027Q2')):
            bundle = virtual()
            bundle['configurations'][0]['throughQuarter'] = through
            bundle['configurations'][1]['fromQuarter'] = from_
            invalid(self, bundle)
        for index, key, value in ((0, 'fromQuarter', '2020Q1'), (1, 'throughQuarter', '2030Q4'),
                                  (0, 'throughQuarter', None), (1, 'fromQuarter', None),
                                  (0, 'throughQuarter', '2026q4')):
            bundle = virtual()
            bundle['configurations'][index][key] = value
            invalid(self, bundle)
        moved = virtual()
        moved['configurations'][0]['throughQuarter'] = '2027Q2'
        moved['configurations'][1]['fromQuarter'] = '2027Q3'
        self.assertEqual(ws.normalize_work_configurations(moved)['configurations'][1]['fromQuarter'], '2027Q3')

    def test_duplicate_ids_and_names_rejected(self):
        bundle = virtual()
        bundle['configurations'][1]['id'] = 'legacy'
        invalid(self, bundle, 'id')
        bundle = virtual()
        bundle['configurations'][1]['name'] = ' legacy '
        invalid(self, bundle, 'name')

    def test_delivery_projects_zero_saveable_more_than_one_rejected_type_defaults_other(self):
        bundle = virtual()
        self.assertEqual(ws.normalize_work_configurations(bundle)['configurations'][1]['scope']['projects'], [])
        bundle['configurations'][1]['scope']['projects'] = [{'key': 'PLAN'}]
        saved = ws.normalize_work_configurations(bundle)['configurations'][1]['scope']['projects']
        self.assertEqual(saved, [{'key': 'PLAN', 'type': 'other'}])
        bundle['configurations'][1]['scope']['projects'] = ['PLAN', 'TWO']
        invalid(self, bundle, 'scope.projects')
        legacy_multi = virtual()
        legacy_multi['configurations'][0]['scope']['projects'] = ['A', {'key': 'B', 'type': 'tech'}]
        projects = ws.normalize_work_configurations(legacy_multi)['configurations'][0]['scope']['projects']
        self.assertEqual(projects, [{'key': 'A', 'type': 'product'}, {'key': 'B', 'type': 'tech'}])

    def test_unknown_properties_rejected_at_every_level(self):
        mutations = (
            lambda b: b.update(extra=1),
            lambda b: b['configurations'][0].update(jql='x'),
            lambda b: b['configurations'][0]['scope'].update(jql='x'),
            lambda b: b['configurations'][0]['hierarchy'].update(extra=None),
            lambda b: b['configurations'][1]['fields'].update(extra={'fieldId': '', 'fieldName': ''}),
            lambda b: b['configurations'][1]['fields']['team'].update(extra=1),
            lambda b: b['configurations'][0]['fields'].update(allocation={'fieldId': '', 'fieldName': ''}),
        )
        for mutate in mutations:
            bundle = virtual()
            mutate(bundle)
            invalid(self, bundle)

    def test_legacy_only_fields_rejected_on_new_model(self):
        for key, value in (('legacyIssueTypeNames', ['Story']), ('legacyDisplayTypes', {'parent': None, 'ancestor': None}),
                           ('legacyHierarchyModes', {'parent': 'mapped', 'ancestor': 'mapped'})):
            bundle = virtual()
            bundle['configurations'][1][key] = value
            invalid(self, bundle, key)

    def test_unresolved_but_syntactically_valid_ids_are_retained(self):
        bundle = virtual()
        delivery = bundle['configurations'][1]
        delivery['hierarchy']['planningIssueTypeId'] = '99999'
        delivery['fields']['storyPoints'] = {'fieldId': 'customfield_88888', 'fieldName': 'Gone'}
        saved = ws.normalize_work_configurations(bundle)['configurations'][1]
        self.assertEqual(saved['hierarchy']['planningIssueTypeId'], '99999')
        self.assertEqual(saved['fields']['storyPoints']['fieldId'], 'customfield_88888')

    def test_malformed_identifier_syntax_rejected(self):
        for mutate in (
            lambda d: d['hierarchy'].update(planningIssueTypeId='Epic'),
            lambda d: d['fields']['team'].update(fieldId='custom field'),
            lambda d: d['scope'].update(boardId='12a'),
            lambda d: d.update(id='Bad Id'),
        ):
            bundle = virtual()
            mutate(bundle['configurations'][1])
            invalid(self, bundle)

    def test_legacy_slot_authority_rules(self):
        bundle = virtual()
        legacy = bundle['configurations'][0]
        legacy['hierarchy']['parentIssueTypeId'] = '10'
        invalid(self, bundle, 'parentIssueTypeId')  # compatibility keeps a null id
        legacy['legacyHierarchyModes']['parent'] = 'mapped'
        ws.normalize_work_configurations(bundle)
        legacy['hierarchy']['parentIssueTypeId'] = None  # mapped null is an explicit clear
        ws.normalize_work_configurations(bundle)
        legacy['legacyHierarchyModes']['parent'] = 'bogus'
        invalid(self, bundle, 'legacyHierarchyModes')

    def test_planning_name_filter_and_planning_id_are_mutually_exclusive(self):
        bundle = virtual()
        bundle['configurations'][0]['hierarchy']['planningIssueTypeId'] = '10'
        invalid(self, bundle, 'planningIssueTypeId')
        bundle['configurations'][0]['legacyIssueTypeNames'] = None
        ws.normalize_work_configurations(bundle)

    def test_promotion_revision_is_validated_metadata(self):
        bundle = virtual()
        bundle['promotionRevision'] = 0
        invalid(self, bundle, 'promotionRevision')
        bundle['promotionRevision'] = True
        invalid(self, bundle, 'promotionRevision')
        bundle['promotionRevision'] = 4
        self.assertEqual(ws.normalize_work_configurations(bundle)['promotionRevision'], 4)


class ResolutionTests(unittest.TestCase):
    def test_resolves_by_quarter_inclusive_boundaries(self):
        snapshot = promoted_snapshot()
        cases = {'0001Q1': 'legacy', '2026Q4': 'legacy', '2027Q1': 'delivery', '9999Q4': 'delivery'}
        for quarter, expected in cases.items():
            context = ws.resolve_work_configuration(snapshot, quarter=quarter, flag_enabled=True)
            self.assertEqual((context.configuration_id, context.quarter), (expected, quarter))

    def test_blank_board_inherits_from_other_configuration_without_changing_digest(self):
        bundle = virtual(board='5494')
        snapshot = promoted_snapshot(bundle)
        stored = ws.stored_bundle(snapshot.payload)['configurations']
        self.assertEqual(stored[1]['scope']['boardId'], '')
        context = ws.resolve_work_configuration(snapshot, quarter='2027Q1', flag_enabled=True)
        self.assertEqual(dict(context.scope)['boardId'], '5494')
        self.assertEqual(context.digest, ws.effective_digest(stored, stored[1]))
        self.assertEqual([e['scope']['boardId'] for e in ws.catalog_entries(snapshot, flag_enabled=True)], ['5494', '5494'])

    def test_explicit_board_is_not_overridden_by_inheritance(self):
        bundle = virtual(board='5494')
        bundle['configurations'][1]['scope']['boardId'] = '19095'
        entries = ws.catalog_entries(promoted_snapshot(bundle), flag_enabled=True)
        self.assertEqual([e['scope']['boardId'] for e in entries], ['5494', '19095'])

    def test_shared_fields_read_legacy_mapping_and_enter_the_digest(self):
        legacy_fields = {'sprint': ('customfield_1', 'Sprint'), 'storyPoints': ('customfield_2', 'Story Points'), 'team': ('customfield_3', 'Team')}
        bundle = virtual(board='5494')
        for name, (field_id, field_name) in legacy_fields.items():
            bundle['configurations'][0]['fields'][name] = {'fieldId': field_id, 'fieldName': field_name}
        snapshot = promoted_snapshot(bundle)
        stored = ws.stored_bundle(snapshot.payload)['configurations']
        self.assertEqual({name: stored[1]['fields'][name] for name in ws.SHARED_FIELD_NAMES},
                         {name: {'fieldId': '', 'fieldName': '', 'mode': 'shared'} for name in ws.SHARED_FIELD_NAMES})
        context = ws.resolve_work_configuration(snapshot, quarter='2027Q1', flag_enabled=True)
        fields = dict(context.fields)
        self.assertEqual({name: dict(fields[name])['fieldId'] for name in ws.SHARED_FIELD_NAMES},
                         {name: value[0] for name, value in legacy_fields.items()})
        self.assertEqual(ws.entry_missing_fields(ws.effective_entry(stored, stored[1])),
                         ['scope.projects', 'hierarchy.planningIssueTypeId', 'hierarchy.parentIssueTypeId'])
        # A Legacy mapping change changes what DELIVERY reads, so its digest moves although its own entry did not.
        changed = deepcopy(bundle)
        changed['configurations'][0]['fields']['team'] = {'fieldId': 'customfield_9', 'fieldName': 'Team'}
        later = ws.resolve_work_configuration(promoted_snapshot(changed), quarter='2027Q1', flag_enabled=True)
        self.assertNotEqual(later.digest, context.digest)
        self.assertEqual(ws.entry_summary(stored[1], stored)['digest'], context.digest)

    def test_own_field_overrides_and_an_own_blank_is_a_deliberate_clear(self):
        bundle = virtual(board='5494')
        bundle['configurations'][0]['fields']['storyPoints'] = {'fieldId': 'customfield_2', 'fieldName': 'Story Points'}
        bundle['configurations'][1]['fields']['storyPoints'] = {'fieldId': 'customfield_8', 'fieldName': 'Epic Points', 'mode': 'own'}
        context = ws.resolve_work_configuration(promoted_snapshot(bundle), quarter='2027Q1', flag_enabled=True)
        self.assertEqual(dict(dict(context.fields)['storyPoints'])['fieldId'], 'customfield_8')
        bundle['configurations'][1]['fields']['storyPoints'] = {'fieldId': '', 'fieldName': '', 'mode': 'own'}
        stored = ws.stored_bundle(promoted_snapshot(bundle).payload)['configurations']
        self.assertIn('fields.storyPoints.fieldId', ws.entry_missing_fields(ws.effective_entry(stored, stored[1])))

    def test_team_is_one_field_for_every_configuration(self):
        bundle = virtual(board='5494')
        bundle['configurations'][0]['fields']['team'] = {'fieldId': 'customfield_3', 'fieldName': 'Team'}
        # An own DELIVERY Team (mapped before this rule, or sent by an older client) is read as Legacy's.
        bundle['configurations'][1]['fields']['team'] = {'fieldId': 'customfield_8', 'fieldName': 'Delivery Team', 'mode': 'own'}
        normalized = ws.normalize_work_configurations(bundle)['configurations'][1]['fields']['team']
        self.assertEqual(normalized, {'fieldId': '', 'fieldName': '', 'mode': 'shared'})
        context = ws.resolve_work_configuration(promoted_snapshot(bundle), quarter='2027Q1', flag_enabled=True)
        self.assertEqual(dict(dict(context.fields)['team'])['fieldId'], 'customfield_3')

    def test_field_modes_are_validated_and_legacy_takes_none(self):
        bundle = virtual()
        bundle['configurations'][1]['fields']['sprint'] = {'fieldId': 'customfield_8', 'fieldName': 'Sprint', 'mode': 'shared'}
        invalid(self, bundle, 'fields.sprint')
        bundle = virtual()
        bundle['configurations'][1]['fields']['team'] = {'fieldId': '', 'fieldName': '', 'mode': 'later'}
        invalid(self, bundle, 'fields.team.mode')
        bundle = virtual()
        bundle['configurations'][0]['fields']['team'] = {'fieldId': '', 'fieldName': '', 'mode': 'shared'}
        invalid(self, bundle, 'fields.team')
        # Saved before modes existed: a blank DELIVERY mapping shares Legacy's, a set one stays its own.
        old = virtual()
        old['configurations'][1]['fields']['sprint'] = {'fieldId': 'customfield_7', 'fieldName': 'Sprint'}
        old['configurations'][1]['fields']['storyPoints'] = {'fieldId': '', 'fieldName': ''}
        fields = ws.normalize_work_configurations(old)['configurations'][1]['fields']
        self.assertEqual((fields['sprint']['mode'], fields['storyPoints']['mode']), ('own', 'shared'))

    def test_board_is_required_and_an_inherited_board_counts(self):
        bundle = virtual()
        stored = ws.normalize_work_configurations(bundle)['configurations']
        self.assertIn('scope.boardId', ws.entry_missing_fields(ws.effective_entry(stored, stored[1])))
        stored[0]['scope']['boardId'] = '5494'
        self.assertNotIn('scope.boardId', ws.entry_missing_fields(ws.effective_entry(stored, stored[1])))
        self.assertNotIn('scope.boardId', ws.entry_missing_fields(ws.effective_entry(stored, stored[0])))

    def test_id_must_agree_with_quarter(self):
        snapshot = promoted_snapshot()
        ok = ws.resolve_work_configuration(snapshot, quarter='2027Q2', configuration_id='delivery', flag_enabled=True)
        self.assertEqual(ok.model, ws.MODEL_RND_2027)
        for quarter, config_id, code in (('2026Q4', 'delivery', 'configuration_scope_changed'),
                                         ('2027Q1', 'nope', 'invalid_configuration_id'),
                                         ('bad', None, 'invalid_quarter'),
                                         (None, None, 'configuration_required'),
                                         (None, 'delivery', 'configuration_required')):
            with self.assertRaises(ws.WorkConfigError) as raised:
                ws.resolve_work_configuration(
                    snapshot, quarter=quarter, configuration_id=config_id, flag_enabled=True,
                )
            self.assertEqual(raised.exception.code, code)

    def test_unpromoted_and_flag_off_do_not_resolve(self):
        unpromoted = WorkspaceConfigSnapshot({'workConfigurations': virtual()}, 2, 'workspace_db')
        with self.assertRaises(ws.WorkConfigError) as raised:
            ws.resolve_work_configuration(unpromoted, quarter='2026Q1', flag_enabled=True)
        self.assertEqual(raised.exception.code, 'configuration_required')
        with self.assertRaises(ws.WorkConfigError) as raised:
            ws.resolve_work_configuration(promoted_snapshot(), quarter='2026Q1', flag_enabled=False)
        self.assertEqual(raised.exception.code, 'configuration_feature_disabled')

    def test_context_is_immutable_and_has_no_capacity(self):
        context = ws.resolve_work_configuration(promoted_snapshot(), quarter='2026Q1', flag_enabled=True)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            context.revision = 9
        with self.assertRaises(TypeError):
            context.scope['boardId'] = '1'
        with self.assertRaises(TypeError):
            context.fields['sprint']['fieldId'] = 'x'
        self.assertFalse(any('capacity' in name for name in context.to_dict()))
        self.assertEqual(context.revision, 1)

    def test_digest_tracks_mapping_not_display_name(self):
        base = promoted_snapshot()
        renamed = promoted_snapshot()
        renamed.payload['workConfigurations']['configurations'][1]['name'] = 'Other'
        remapped = promoted_snapshot()
        remapped.payload['workConfigurations']['configurations'][1]['hierarchy']['planningIssueTypeId'] = '10'
        digest = lambda snap: ws.resolve_work_configuration(snap, quarter='2027Q1', flag_enabled=True).digest
        self.assertEqual(digest(base), digest(renamed))
        self.assertNotEqual(digest(base), digest(remapped))

    def test_stored_entry_lookup_by_id_is_not_a_work_resolution(self):
        entry = ws.get_stored_configuration(promoted_snapshot(), 'delivery')
        self.assertEqual(entry['model'], ws.MODEL_RND_2027)
        with self.assertRaises(ws.WorkConfigError):
            ws.get_stored_configuration(promoted_snapshot(), 'missing')

    def test_project_legacy_admin_settings(self):
        payload = {'projects': {'selected': [{'key': 'OLD', 'type': 'tech'}]}, 'board': {'boardId': '7'},
                   'issueTypes': ['Story', 'Bug']}
        context = ws.resolve_work_configuration(promoted_snapshot(virtual(payload)), quarter='2026Q1', flag_enabled=True)
        flat = ws.project_legacy_admin_settings(context)
        self.assertEqual(flat['projects'], {'selected': [{'key': 'OLD', 'type': 'tech'}]})
        self.assertEqual(flat['board']['boardId'], '7')
        self.assertEqual(flat['issueTypes'], ['Story', 'Bug'])
        self.assertEqual(flat['sprintField']['fieldId'], 'customfield_10101')
        delivery = ws.resolve_work_configuration(promoted_snapshot(), quarter='2027Q1', flag_enabled=True)
        self.assertNotIn('issueTypes', ws.project_legacy_admin_settings(delivery))


class StateMatrixTests(unittest.TestCase):
    def test_matrix(self):
        seeded = {'workConfigurations': virtual()}  # no marker: unpromoted
        promoted = promoted_snapshot().payload
        cases = [
            (seeded, False, 'unpromoted_off', 'flat', 'flat', False, True),
            ({}, True, 'unpromoted_on', 'virtual', 'flat', True, True),
            (seeded, True, 'unpromoted_on', 'virtual', 'flat', True, True),
            (promoted, True, 'promoted_on', 'bundle', 'bundle', True, False),
            (promoted, False, 'promoted_off', 'unavailable', 'blocked', False, False),
        ]
        for payload, flag, state, editor, reads, writes, flat in cases:
            result = ws.work_configuration_state(payload, flag_enabled=flag)
            self.assertEqual(
                (result.state, result.editor, result.structural_reads, result.bundle_writes_allowed,
                 result.flat_structural_writes_allowed),
                (state, editor, reads, writes, flat),
            )
        self.assertEqual(ws.work_configuration_state(promoted, flag_enabled=False).error_code,
                         'configuration_feature_disabled')

    def test_flag_defaults_off(self):
        self.assertFalse(ws.work_configurations_enabled({}))
        self.assertFalse(ws.work_configurations_enabled({'WORK_CONFIGURATIONS_ENABLED': '0'}))
        self.assertTrue(ws.work_configurations_enabled({'WORK_CONFIGURATIONS_ENABLED': 'true'}))

    def test_flat_writer_guard(self):
        promoted = promoted_snapshot().payload
        with self.assertRaises(ws.WorkConfigError) as raised:
            ws.ensure_flat_structural_write_allowed(promoted, 'board')
        self.assertEqual(raised.exception.response()[1], 409)
        self.assertEqual(raised.exception.code, 'configuration_bundle_required')
        ws.ensure_flat_structural_write_allowed(promoted, 'statsPriorityWeights')
        ws.ensure_flat_structural_write_allowed(promoted, 'capacity')
        ws.ensure_flat_structural_write_allowed({}, 'board')


class ErrorEnvelopeTests(unittest.TestCase):
    def test_status_codes_and_safe_body(self):
        expected = {
            'invalid_work_configurations': 400, 'invalid_quarter': 400, 'invalid_configuration_id': 400,
            'ambiguous_configuration_scope': 400, 'admin_required': 403, 'csrf_required': 403,
            'configuration_incomplete': 409, 'configuration_scope_changed': 409, 'sprint_catalog_mismatch': 409,
            'configuration_bundle_required': 409, 'configuration_required': 409,
            'configuration_feature_disabled': 409, 'work_configuration_setup_required': 409,
            'config_storage_unavailable': 503, 'catalog_storage_unavailable': 503,
        }
        for code, status in expected.items():
            body, got = ws.WorkConfigError(code).response()
            self.assertEqual((body['error'], got), (code, status))
            self.assertEqual(set(body), {'error', 'status', 'message'})

    def test_invalid_names_configuration_and_slot(self):
        error = invalid(self, {**virtual(), 'version': 2})
        body, status = error.response()
        self.assertEqual(status, 400)
        self.assertEqual(body['paths'], ['version'])


if __name__ == '__main__':
    unittest.main()
