"""DELIVERY Allocation classes (pure module): Catch Up, Planning and Stats read the Initiative only."""
import unittest

from backend.services import allocation_classification as ac

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

    def test_no_epic_initiative_objective_precedence_remains(self):
        for name in ('classify_allocation', 'stamp_epics', 'objective_keys_to_read', '_resolve'):
            self.assertFalse(hasattr(ac, name), name)
