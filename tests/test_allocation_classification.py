"""DELIVERY Allocation classes (pure module): Catch Up, Planning and Stats read the Initiative only."""
import unittest

from backend.services import allocation_classification as ac
from backend.services import planning_work as pw

FIELD = 'customfield_40001'
TYPES = [{'value': 'Platform', 'type': 'tech'}, {'value': 'Growth', 'type': 'product'}]


def epic(key, parent=None, allocation=None):
    fields = {'summary': key}
    if parent:
        fields['parent'] = {'key': parent}
        fields['epicKey'] = parent
    if allocation is not None:
        fields[FIELD] = allocation
    return {'key': key, 'fields': fields}


class PureValueTests(unittest.TestCase):
    def test_option_objects_and_strings_normalize_to_their_trimmed_value(self):
        self.assertEqual(ac.allocation_value({'value': 'X', 'id': '7'}), 'X')
        self.assertEqual(ac.allocation_value('  X '), 'X')
        self.assertEqual(ac.allocation_value([{'value': 'X'}]), 'X')
        for blank in (None, '', '  ', [], {}, {'value': ''}):
            self.assertIsNone(ac.allocation_value(blank))

    def test_mapped_values_decide_and_everything_else_is_product(self):
        self.assertEqual(ac.classify_allocation('value', {'value': 'Platform'}, TYPES), 'tech')
        self.assertEqual(ac.classify_allocation('value', 'Growth', TYPES), 'product')
        self.assertEqual(ac.classify_allocation('value', 'Unmapped', TYPES), 'product')
        self.assertEqual(ac.classify_allocation('value', 'platform', TYPES), 'product')  # exact, not casefolded
        self.assertEqual(ac.classify_allocation('none', None, TYPES), 'product')
        self.assertEqual(ac.classify_allocation('unavailable', None, TYPES), 'product')


class InitiativeClassTests(unittest.TestCase):
    """Each Initiative is classified once; its issues take that class and nothing else."""

    def test_initiative_value_decides(self):
        self.assertEqual(ac.classify_initiative({'value': 'Platform', 'id': '7'}, TYPES), 'tech')
        self.assertEqual(ac.classify_initiative('Growth', TYPES), 'product')
        details = {'P-I1': {'allocation': 'Platform'}, 'p-i2': {'allocation': 'Growth'}}
        self.assertEqual(ac.initiative_classes(details, FIELD, TYPES), {'P-I1': 'tech', 'P-I2': 'product'})

    def test_blank_or_unmapped_is_none(self):
        for raw in (None, '', '  ', [], {'value': ''}, 'Unmapped', 'platform'):
            self.assertEqual(ac.classify_initiative(raw, TYPES), 'none', raw)
        self.assertEqual(ac.classify_initiative('Platform', []), 'none')
        details = {'P-I1': {'allocation': None}, 'P-I2': {'allocation': 'Unmapped'}, 'P-I3': {}}
        self.assertEqual(ac.initiative_classes(details, FIELD, TYPES), {'P-I1': 'none', 'P-I2': 'none', 'P-I3': 'none'})
        # No Allocation field configured: every Initiative is No Allocation.
        self.assertEqual(ac.initiative_classes({'P-I1': {'allocation': 'Platform'}}, '', TYPES), {'P-I1': 'none'})

    def test_epic_and_objective_values_are_ignored(self):
        details = {'P-I1': {'allocation': 'Growth', 'initiative': {'key': 'P-O1'}},
                   'P-I2': {'allocation': None, 'initiative': {'key': 'P-O1'}}}
        classes = ac.initiative_classes(details, FIELD, TYPES)
        stamps = ac.stamp_issues([epic('P-1', 'P-I1', {'value': 'Platform'}), epic('P-2', 'P-I2', 'Platform'),
                                  epic('P-3', 'P-I9', 'Platform'), epic('P-4', None, 'Platform')], classes)
        self.assertEqual(stamps, {'P-1': 'product', 'P-2': 'none', 'P-3': 'none', 'P-4': 'none'})


class BoardPrecedenceTests(unittest.TestCase):
    """The Board's own Epic, Initiative, Objective precedence (``stamp_epics``), kept until the Board task
    replaces it; each scenario also runs through ``resolve_allocation``."""

    def scenario(self, leaf, initiatives, objectives):
        details = {key: {'allocation': ac.allocation_value(value), **({'initiative': {'key': obj}} if obj else {})}
                   for key, (value, obj) in initiatives.items()}
        stamps = ac.stamp_epics([leaf], details, objectives, FIELD, TYPES)
        work = pw.PlanningWork()
        parent = (leaf['fields'].get('parent') or {}).get('key')
        work.parents = {key: {'key': key, 'fields': {FIELD: value, **({'parent': {'key': obj}} if obj else {})}}
                        for key, (value, obj) in initiatives.items()}
        work.parent_state = {leaf['key']: 'readable' if parent in initiatives else 'unavailable'}
        work.ancestors = {key: {'key': key, 'fields': {FIELD: value}} for key, value in objectives.items()}
        oracle = ac.classify_allocation(*pw.resolve_allocation(work, leaf, FIELD), TYPES)
        self.assertEqual(stamps[leaf['key']], oracle)
        return stamps[leaf['key']]

    def test_epic_value_wins(self):
        self.assertEqual(self.scenario(epic('P-1', 'P-I1', {'value': 'Platform'}), {'P-I1': ('Growth', None)}, {}), 'tech')
        self.assertEqual(self.scenario(epic('P-1', 'P-I1', 'Growth'), {'P-I1': ('Platform', None)}, {}), 'product')

    def test_blank_epic_reads_the_initiative(self):
        self.assertEqual(self.scenario(epic('P-1', 'P-I1'), {'P-I1': ({'value': 'Platform'}, None)}, {}), 'tech')

    def test_blank_epic_and_initiative_read_the_objective(self):
        self.assertEqual(self.scenario(epic('P-1', 'P-I1'), {'P-I1': (None, 'P-O1')}, {'P-O1': 'Platform'}), 'tech')
        self.assertEqual(self.scenario(epic('P-1', 'P-I1'), {'P-I1': (None, 'P-O1')}, {'P-O1': None}), 'product')

    def test_unreadable_initiative_or_objective_is_product(self):
        self.assertEqual(self.scenario(epic('P-1', 'P-I1'), {}, {}), 'product')
        self.assertEqual(self.scenario(epic('P-1', 'P-I1'), {'P-I1': (None, 'P-O1')}, {}), 'product')

    def test_no_parent_and_unmapped_are_product(self):
        self.assertEqual(self.scenario(epic('P-1'), {}, {}), 'product')
        self.assertEqual(self.scenario(epic('P-1', 'P-I1', 'Other'), {'P-I1': ('Platform', None)}, {}), 'product')

    def test_objective_keys_are_only_those_a_blank_chain_needs(self):
        issues = [epic('P-1', 'P-I1'), epic('P-2', 'P-I2'), epic('P-3', 'P-I3', 'Growth'), epic('P-4', 'P-I9')]
        details = {'P-I1': {'allocation': None, 'initiative': {'key': 'P-O1'}},
                   'P-I2': {'allocation': 'Platform', 'initiative': {'key': 'P-O2'}},
                   'P-I3': {'allocation': None, 'initiative': {'key': 'P-O3'}}}
        self.assertEqual(ac.objective_keys_to_read(issues, details, FIELD), ['P-O1'])
        details['P-I1']['allocation'] = 'Growth'
        self.assertEqual(ac.objective_keys_to_read(issues, details, FIELD), [])
