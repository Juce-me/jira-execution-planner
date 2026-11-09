"""DELIVERY classification from the Allocation field; pure, no Flask and no I/O.

Catch Up, Planning, Stats and the Board classify each Initiative once from its own Allocation
(``classify_initiative``: ``'product'`` | ``'tech'`` | ``'none'``) and stamp that class on its issues;
Epic and Objective values are ignored.
"""


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
