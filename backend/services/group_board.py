"""Group Board (kanban) configuration normalization and validation.

Pure by contract: this module must import nothing that can perform I/O (no
`requests`, no `jira_server`, no DB, no filesystem, no clock, no randomness)
because `normalize_group_board` runs on every group-config read, not only on
writes, including inside a DB session (see backend/services/group_config.py
and backend/services/shared_group_config.py). A network call here would turn
every config load into a Jira round trip.

Live status-existence checking (whether a stored status still exists on the
Jira board) is advisory-only and happens elsewhere, in the composer, against
`GET /api/board-config/statuses`. This module has no source for "live"
statuses and must not invent one: a stored status is accepted as long as it
is a non-blank string, and duplicates across columns are the only status
error this module can detect.
"""

MIN_COLUMNS = 1
MAX_COLUMNS = 12
MAX_COLUMN_NAME_LENGTH = 40
MIN_COLUMN_BOUND = 0
MAX_COLUMN_BOUND = 9999

# The closed colour enum (D46). The default (grey) must stay first: it is
# the value new/invalid colours coerce to.
BOARD_COLUMN_COLOURS = [
    '#8c8c8c',  # grey - the default for a new column
    '#b37feb',  # violet
    '#597ef7',  # blue
    '#13c2c2',  # teal
    '#52c41a',  # green
    '#e8a11d',  # amber
    '#ff4d4f',  # red
]

DEFAULT_COLUMN_COLOUR = BOARD_COLUMN_COLOURS[0]

# Column ids are opaque hex, generated once by the composer and never
# reused, so per-user focus/star state keyed off `id` cannot silently
# rebind to a different column after a rename. This module owns the format
# contract; it does not generate ids (that needs randomness, which this
# pure module must not have).
_COLUMN_ID_PREFIX = 'col-'
_COLUMN_ID_HEX_LENGTH = 8
_HEX_DIGITS = set('0123456789abcdef')


def is_valid_column_id(value):
    """True if `value` matches ^col-[0-9a-f]{8}$."""
    if not isinstance(value, str) or not value.startswith(_COLUMN_ID_PREFIX):
        return False
    suffix = value[len(_COLUMN_ID_PREFIX):]
    return len(suffix) == _COLUMN_ID_HEX_LENGTH and all(ch in _HEX_DIGITS for ch in suffix)


def _column_label(name, column_id, idx):
    if name:
        return f'"{name}"'
    if column_id:
        return f'"{column_id}"'
    return f'at index {idx}'


def _coerce_bound(raw):
    """Coerce a min/max value to an int in [0, 9999] or None.

    `None` and `""` (after trim) mean "no threshold". Anything that is not
    an integer in range - malformed strings, out-of-range integers - also
    coerces to None rather than erroring; §5.6 enforces min/max individually
    by coercion, not by error. The composer is expected to reject malformed
    input before it ever reaches this validator (D46); this is a defensive
    fallback for whatever still gets here.
    """
    if isinstance(raw, bool):
        return None
    if raw is None:
        return None
    if isinstance(raw, str):
        stripped = raw.strip()
        if stripped == '':
            return None
        try:
            value = int(stripped)
        except ValueError:
            return None
    elif isinstance(raw, float):
        if not raw.is_integer():
            return None
        value = int(raw)
    elif isinstance(raw, int):
        value = raw
    else:
        return None
    if MIN_COLUMN_BOUND <= value <= MAX_COLUMN_BOUND:
        return value
    return None


def normalize_group_board(raw):
    """Normalize and validate a group's `board` field.

    Pure: no I/O, no clock, no randomness. Safe to call on every config read.

    Returns (normalized, errors, warnings):
      - normalized: `None` when the group has no `board` configured at all
        (`raw is None`) - with no errors and no warnings, so an unconfigured
        group stays valid - otherwise `{'columns': [...]}`. `None` (an
        omitted `board` key), not `{'columns': []}`, is deliberate: this
        validator also runs on every subsequent read of whatever it just
        normalized (D44), and `{'columns': []}` is itself invalid (zero
        columns, see below) - if "unconfigured" and "configured with zero
        columns" normalized to the same shape, a persisted "unconfigured"
        group would fail the very next read.
      - errors: list[str]. Non-empty means the board is unsavable. Messages
        do not name the owning group - callers (group_config.py) prefix
        `Group "{name}" ...` the way the rest of that module's messages do.
      - warnings: list[str]. Same naming convention; never blocks a save.
    """
    errors = []
    warnings = []

    if raw is None:
        return None, errors, warnings
    if not isinstance(raw, dict):
        errors.append('board must be an object.')
        return None, errors, warnings

    raw_columns = raw.get('columns')
    if raw_columns is None:
        raw_columns = []
    if not isinstance(raw_columns, list):
        errors.append('board.columns must be a list.')
        return None, errors, warnings

    if len(raw_columns) < MIN_COLUMNS:
        errors.append('board must have at least 1 column.')
    if len(raw_columns) > MAX_COLUMNS:
        errors.append(f'board must have at most {MAX_COLUMNS} columns.')

    normalized_columns = []
    seen_ids = set()
    seen_names = set()
    seen_statuses = set()
    star_count = 0

    for idx, raw_column in enumerate(raw_columns):
        if not isinstance(raw_column, dict):
            errors.append(f'board column at index {idx} must be an object.')
            continue

        column_id = str(raw_column.get('id') or '').strip()
        if not is_valid_column_id(column_id):
            errors.append(f'board column at index {idx} has an invalid id "{column_id}".')
        elif column_id in seen_ids:
            errors.append(f'board column "{column_id}" has a duplicate id.')
        else:
            seen_ids.add(column_id)

        raw_name = raw_column.get('name')
        name = str(raw_name if raw_name is not None else '').strip()
        label = _column_label(name, column_id, idx)
        if not name:
            errors.append(f'board column {label} is missing a name.')
        elif len(name) > MAX_COLUMN_NAME_LENGTH:
            errors.append(f'board column {label} name exceeds {MAX_COLUMN_NAME_LENGTH} characters.')
        elif name.lower() in seen_names:
            errors.append(f'board column {label} has a duplicate name.')
        else:
            seen_names.add(name.lower())

        raw_colour = raw_column.get('colour')
        if raw_colour in BOARD_COLUMN_COLOURS:
            colour = raw_colour
        else:
            colour = DEFAULT_COLUMN_COLOUR
            warnings.append(f'board column {label} has an unknown colour; using the default colour instead.')

        star = bool(raw_column.get('star'))
        if star:
            star_count += 1

        min_value = _coerce_bound(raw_column.get('min'))
        max_value = _coerce_bound(raw_column.get('max'))
        if min_value is not None and max_value is not None and min_value > max_value:
            errors.append(f'board column {label} has a min greater than its max.')

        raw_statuses = raw_column.get('statuses')
        statuses = []
        had_any_status = False
        column_statuses = set()
        if isinstance(raw_statuses, list):
            for raw_status in raw_statuses:
                status = str(raw_status or '').strip()
                if not status:
                    continue
                had_any_status = True
                if status in column_statuses:
                    errors.append(f'board column {label} has a duplicate status "{status}".')
                    continue
                if status in seen_statuses:
                    errors.append(f'board column {label} has status "{status}" already assigned to another column.')
                    continue
                column_statuses.add(status)
                seen_statuses.add(status)
                statuses.append(status)
        # "has no statuses" only fires when the raw list contributed nothing
        # at all (had_any_status stays False) - not when every entry it did
        # contribute was rejected as a duplicate. Otherwise a column whose
        # only status duplicates another column's would get both the
        # duplicate error and this one, telling the user to add statuses
        # they already added.
        if not had_any_status:
            errors.append(f'board column {label} has no statuses.')

        normalized_columns.append({
            'id': column_id,
            'name': name,
            'statuses': statuses,
            'colour': colour,
            'star': star,
            'min': min_value,
            'max': max_value,
        })

    if star_count > 1:
        errors.append('board has more than one starred column.')

    return {'columns': normalized_columns}, errors, warnings
