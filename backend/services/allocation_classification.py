"""DELIVERY classification from the Allocation field; pure, no Flask and no I/O.

Catch Up, Planning, Stats and the Board classify each Initiative once from its own Allocation
(``classify_initiative``: ``'product'`` | ``'tech'`` | ``'none'``) and stamp that class on its issues;
Epic and Objective values are ignored.
"""


import hashlib
import json


ALLOCATION_TYPES = ('product', 'tech')
ALLOCATION_TYPES_MAX = 200


def normalize_allocation_types(values):
    """Strict shared Department mapping grammar; no stored global-map fallback."""
    if not isinstance(values, list):
        raise ValueError('must be an array.')
    if len(values) > ALLOCATION_TYPES_MAX:
        raise ValueError(f'must contain at most {ALLOCATION_TYPES_MAX} values.')
    result, seen = [], set()
    for index, item in enumerate(values):
        prefix = f'[{index}]'
        if not isinstance(item, dict) or set(item) != {'value', 'type'}:
            raise ValueError(f'{prefix} must contain exactly value and type.')
        value = item['value']
        if (not isinstance(value, str) or not value.strip() or len(value.strip()) > 255
                or any(ord(char) < 32 or ord(char) == 127 for char in value.strip())):
            raise ValueError(f'{prefix}.value must be a nonempty string of at most 255 characters.')
        if item['type'] not in ALLOCATION_TYPES:
            raise ValueError(f'{prefix}.type must be product or tech.')
        value = value.strip()
        if value not in seen:
            result.append({'value': value, 'type': item['type']})
            seen.add(value)
    return result


def department_allocation_types(group):
    """Read only the saved Department mapping; pre-field Departments are explicitly empty."""
    return normalize_allocation_types((group or {}).get('allocationTypes', []))


def department_allocation_digest(group):
    """Partition classification snapshots by Department identity and effective mapping."""
    mapping = sorted(department_allocation_types(group), key=lambda item: item['value'])
    material = {'groupId': str((group or {}).get('id') or ''), 'allocationTypes': mapping}
    canonical = json.dumps(material, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def allocation_value(raw):
    """A Jira option object, string or single-item list as its trimmed ``value`` string, or None."""
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if isinstance(raw, dict):
        raw = raw.get('value')
    text = raw.strip() if isinstance(raw, str) else ''
    return text or None


def classify_initiative(raw_value, allocation_types):
    """An Initiative's class: its value mapped to ``'product'`` or ``'tech'``; blank or unmapped is ``'none'``."""
    text = allocation_value(raw_value)
    for item in allocation_types or ():
        if text and item['value'] == text and item['type'] in ('product', 'tech'):
            return item['type']
    return 'none'


def initiative_classes(epic_details, field_id, allocation_types):
    """``{Initiative key: class}`` for the ``fetch_epic_details_bulk``-shaped records (``'allocation'`` value);
    with no Allocation field configured every Initiative is ``'none'``."""
    return {str(key).strip().upper(): classify_initiative((details or {}).get('allocation') if field_id else None,
                                                          allocation_types)
            for key, details in (epic_details or {}).items()}


def stamp_issues(issues, classes):
    """``{issue key: its Initiative's class}``; ``'none'`` without an Initiative or for one ``classes`` lacks."""
    return {issue.get('key'): classes.get(_initiative_key(issue) or None, 'none') for issue in issues or ()}


def _initiative_key(issue):
    fields = issue.get('fields') or {}
    key = fields.get('epicKey') or (fields.get('parent') or {}).get('key')
    return str(key or '').strip().upper()
