"""The §5.5 reference configuration - Northwind over board 1042, Python half.

The Playwright and Node suites read `groupBoardReference.mjs`; the Python suite
reads this module. §13 asks for one fixture shared by both, so the two files are
not allowed to drift: `GroupBoardReferenceFixtureParityTests` in
`tests/test_group_board.py` parses the `.mjs` literals and asserts every export
here is byte-equal to its JavaScript twin, and that neither side carries a
literal export the other lacks. Edit one, and the parity test tells you to edit
the other.

Names, ordering and values mirror the `.mjs` exports exactly - including the
correction the plan already made: "In progress" is `#597ef7`, not the `#2f80ed`
the HTML asset still renders, which is not in BOARD_COLUMN_COLOURS and would
have produced a coercion warning on every save.
"""

REFERENCE_BOARD_ID = '1042'

# The board's own status catalog, in the order GET /api/board-config/statuses
# returns it.
REFERENCE_STATUSES = [
    {'id': '10000', 'name': 'To Do'},
    {'id': '10001', 'name': 'Analysis'},
    {'id': '10002', 'name': 'Awaiting Validation'},
    {'id': '10003', 'name': 'Postponed'},
    {'id': '10004', 'name': 'Pending'},
    {'id': '10005', 'name': 'Accepted'},
    {'id': '10006', 'name': 'Blocked'},
    {'id': '10007', 'name': 'In Progress'},
    {'id': '10008', 'name': 'Release'},
    {'id': '10009', 'name': 'Done'},
    {'id': '10010', 'name': 'Killed'},
    {'id': '10011', 'name': 'Incomplete'},
]

REFERENCE_STATUS_NAMES = [status['name'] for status in REFERENCE_STATUSES]

# Work items per status on the board, §5.5's parenthesised counts. `Pending` is
# 0 on purpose: a real status with no work is not the same as an unmapped
# status, and it must still render.
REFERENCE_STATUS_WORK_ITEMS = {
    'To Do': 36,
    'Analysis': 22,
    'Awaiting Validation': 13,
    'Postponed': 6,
    'Pending': 0,
    'Accepted': 9,
    'Blocked': 2,
    'In Progress': 48,
    'Release': 1,
    'Done': 260,
    'Killed': 83,
    'Incomplete': 4,
}

# Sprint-scoped epics per status. The column totals are §5.5's:
# 18, 11, 9, 7, 2, 26, 14 -> 87, bar scale max 26.
REFERENCE_EPICS_BY_STATUS = {
    'To Do': 18,
    'Analysis': 11,
    'Awaiting Validation': 6,
    'Postponed': 3,
    'Pending': 0,
    'Accepted': 7,
    'Blocked': 2,
    'In Progress': 25,
    'Release': 1,
    'Done': 10,
    'Killed': 3,
    'Incomplete': 1,
}

REFERENCE_COLUMNS = [
    {
        'id': 'col-1a2b3c4d',
        'name': 'To do',
        'colour': '#8c8c8c',
        'star': False,
        'min': None,
        'max': None,
        'statuses': ['To Do'],
    },
    {
        'id': 'col-2b3c4d5e',
        'name': 'Analysis',
        'colour': '#b37feb',
        'star': False,
        'min': 15,
        'max': None,
        'statuses': ['Analysis'],
    },
    {
        'id': 'col-3c4d5e6f',
        'name': 'Ready to start',
        'colour': '#597ef7',
        'star': False,
        'min': None,
        'max': None,
        'statuses': ['Awaiting Validation', 'Postponed', 'Pending'],
    },
    {
        'id': 'col-4d5e6f70',
        'name': 'Accepted in Q',
        'colour': '#13c2c2',
        'star': False,
        'min': None,
        'max': 12,
        'statuses': ['Accepted'],
    },
    {
        'id': 'col-5e6f7081',
        'name': 'External block',
        'colour': '#ff4d4f',
        'star': False,
        'min': None,
        'max': 5,
        'statuses': ['Blocked'],
    },
    {
        'id': 'col-6f708192',
        'name': 'In progress',
        'colour': '#597ef7',
        'star': True,
        'min': None,
        'max': 20,
        'statuses': ['In Progress', 'Release'],
    },
    {
        'id': 'col-708192a3',
        'name': 'Done',
        'colour': '#52c41a',
        'star': False,
        'min': None,
        'max': None,
        'statuses': ['Done', 'Killed', 'Incomplete'],
    },
]

# §5.5's SECOND fixture: the default composition when a group has no `board`
# config, derived from stable status names and produced by the composer's
# *Reset to default columns*. Same twelve statuses, grouped by the stable
# default status-name rules.
#
# Statuses are listed in *catalog* order, which is what the derivation
# preserves. The resulting epic counts are 48 / 25 / 14, totalling the same 87
# epics as fixture 1.
REFERENCE_DEFAULT_COLUMNS = [
    {
        'name': 'To Do',
        'colour': '#8c8c8c',
        'star': False,
        'min': None,
        'max': None,
        'statuses': ['To Do', 'Analysis', 'Awaiting Validation', 'Postponed', 'Pending', 'Accepted', 'Blocked', 'Release'],
    },
    {
        'name': 'In Progress',
        'colour': '#597ef7',
        'star': True,
        'min': None,
        'max': None,
        'statuses': ['In Progress'],
    },
    {
        'name': 'Done',
        'colour': '#52c41a',
        'star': False,
        'min': None,
        'max': None,
        'statuses': ['Done', 'Killed', 'Incomplete'],
    },
]


def reference_board():
    """A fresh, mutable copy of the 7-column board, shaped for the `board` field."""
    return {
        'columns': [
            dict(column, statuses=list(column['statuses']))
            for column in REFERENCE_COLUMNS
        ],
    }
