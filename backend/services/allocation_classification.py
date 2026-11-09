"""DELIVERY Product/Tech classification from the Allocation field; pure, no Flask and no I/O.

Precedence matches ``planning_work.resolve_allocation``: the Epic's own value, else its
Initiative's, else the Objective's.  An unreadable Initiative or Objective is ``unavailable``.
Only a value the configuration maps to Tech is Tech; unmapped, blank and unavailable are Product.
"""


def allocation_value(raw):
    """A Jira option object, string or single-item list as its trimmed ``value`` string, or None."""
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if isinstance(raw, dict):
        raw = raw.get('value')
    text = raw.strip() if isinstance(raw, str) else ''
    return text or None


def classify_allocation(state, value, allocation_types):
    """``'tech'`` only for a value mapped to Tech; everything else is ``'product'``."""
    if state != 'value':
        return 'product'
    text = allocation_value(value)
    for item in allocation_types or ():
        if item['value'] == text:
            return 'tech' if item['type'] == 'tech' else 'product'
    return 'product'


def _initiative_key(issue):
    fields = issue.get('fields') or {}
    key = fields.get('epicKey') or (fields.get('parent') or {}).get('key')
    return str(key or '').strip().upper()


def _objective_key(details):
    return str(((details or {}).get('initiative') or {}).get('key') or '').strip().upper()


def _resolve(issue, field_id, initiatives, objectives):
    own = allocation_value((issue.get('fields') or {}).get(field_id))
    if own:
        return 'value', own
    initiative_key = _initiative_key(issue)
    if not initiative_key:
        return 'none', None
    if initiative_key not in initiatives:
        return 'unavailable', None
    details = initiatives[initiative_key]
    if allocation_value(details.get('allocation')):
        return 'value', details['allocation']
    objective_key = _objective_key(details)
    if not objective_key:
        return 'none', None
    if objective_key not in objectives:
        return 'unavailable', None
    value = allocation_value(objectives[objective_key])
    return ('value', value) if value else ('none', None)


def _upper_keys(mapping):
    return {str(key).strip().upper(): value for key, value in (mapping or {}).items()}


def objective_keys_to_read(issues, initiatives, field_id):
    """Distinct Objective keys needed: only for blank Epics whose readable Initiative is blank too."""
    initiatives = _upper_keys(initiatives)
    keys = []
    for issue in issues or ():
        if allocation_value((issue.get('fields') or {}).get(field_id)):
            continue
        details = initiatives.get(_initiative_key(issue))
        if details is None or allocation_value(details.get('allocation')):
            continue
        objective_key = _objective_key(details)
        if objective_key and objective_key not in keys:
            keys.append(objective_key)
    return sorted(keys)


def stamp_epics(issues, initiatives, objectives, field_id, allocation_types):
    """``{issue key: 'product'|'tech'}`` for DELIVERY Epics.

    ``initiatives`` maps Initiative key -> ``{'allocation': value, 'initiative': {'key': objective}}``
    (the ``fetch_epic_details_bulk`` shape); ``objectives`` maps Objective key -> its raw value.
    A key missing from either map was not readable.
    """
    initiatives, objectives = _upper_keys(initiatives), _upper_keys(objectives)
    return {issue.get('key'): classify_allocation(*_resolve(issue, field_id, initiatives, objectives), allocation_types)
            for issue in issues or ()}
