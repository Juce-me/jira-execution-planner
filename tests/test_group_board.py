import ast
import json
import os
import re
import tempfile
import unittest
from types import SimpleNamespace

from unittest.mock import patch

from backend.db import engine as db_engine
from backend.db import models
from backend.services import group_board
from backend.services import shared_group_config
from tests.auth_mode_test_utils import force_basic_auth_mode
from tests.fixtures import groupBoardReference as reference

import jira_server


def _column(**overrides):
    column = {
        'id': 'col-00000001',
        'name': 'To do',
        'statuses': ['To Do'],
        'colour': '#8c8c8c',
        'star': False,
        'min': None,
        'max': None,
    }
    column.update(overrides)
    return column


def _board(columns):
    return {'columns': columns}


# group_board.py's stated contract (its own module docstring) is "no import
# that can perform I/O" - not "zero imports". These stdlib modules are pure
# logic/typing helpers with no network, filesystem, clock, or randomness
# access, so importing one of them would not violate the contract; `re` in
# particular is the module `is_valid_column_id`'s hand-rolled hex matcher
# exists to avoid, and a future `import re` should not fail this guard for
# a non-reason.
_ALLOWED_PURE_IMPORTS = {'re', 'string', 'typing', 'enum', 'dataclasses'}


class GroupBoardPurityTests(unittest.TestCase):
    def test_module_has_no_forbidden_imports(self):
        with open(group_board.__file__, encoding='utf-8') as handle:
            source = handle.read()
        tree = ast.parse(source)
        import_names = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                import_names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                import_names.append(node.module or '')
        forbidden = [name for name in import_names if name not in _ALLOWED_PURE_IMPORTS]
        self.assertEqual(
            forbidden, [],
            'group_board.py must import nothing that can perform I/O (no requests, jira_server, DB, '
            'filesystem, clock, or randomness); stdlib-pure helpers such as re are allowed.',
        )


class GroupBoardAbsentFieldTests(unittest.TestCase):
    def test_group_with_no_board_normalizes_to_none_without_errors(self):
        normalized, errors, warnings = group_board.normalize_group_board(None)

        self.assertIsNone(normalized)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_board_present_with_zero_columns_is_still_an_error(self):
        # None (absent) and {'columns': []} (present, empty) must normalize
        # differently - this is what test_group_with_no_board_normalizes_to_
        # none_without_errors exercises for the absent case. If both instead
        # normalized to the same shape, a persisted "no board" group would
        # fail re-validation on its very next read (D44 - every read, not
        # only writes), since {'columns': []} on its own is invalid.
        _normalized, errors, _warnings = group_board.normalize_group_board({'columns': []})

        self.assertIn('board must have at least 1 column.', errors)

    def test_normalizing_a_group_without_board_twice_stays_valid(self):
        # Simulates storage: normalize once (as if saving), then feed
        # whatever would be persisted for `board` straight back in (as if
        # reloading) and normalize again. Must stay error-free both times.
        first_normalized, first_errors, _warnings = group_board.normalize_group_board(None)
        self.assertEqual(first_errors, [])

        second_normalized, second_errors, _warnings = group_board.normalize_group_board(first_normalized)

        self.assertEqual(second_errors, [])
        self.assertEqual(second_normalized, first_normalized)


class GroupBoardMalformedInputTests(unittest.TestCase):
    def test_board_not_an_object_is_an_error(self):
        normalized, errors, warnings = group_board.normalize_group_board('not-an-object')

        self.assertIsNone(normalized)
        self.assertEqual(errors, ['board must be an object.'])
        self.assertEqual(warnings, [])

    def test_board_columns_not_a_list_is_an_error(self):
        normalized, errors, warnings = group_board.normalize_group_board({'columns': 'not-a-list'})

        self.assertIsNone(normalized)
        self.assertEqual(errors, ['board.columns must be a list.'])
        self.assertEqual(warnings, [])

    def test_board_column_not_an_object_is_an_error(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(['not-an-object']))

        self.assertIn('board column at index 0 must be an object.', errors)


class GroupBoardColumnsCountTests(unittest.TestCase):
    def test_zero_columns_is_an_error(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(_board([]))
        self.assertIn('board must have at least 1 column.', errors)

    def test_one_column_is_valid(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(_board([_column()]))
        self.assertEqual(errors, [])

    def test_twelve_columns_is_valid(self):
        columns = [
            _column(id=f'col-{idx:08x}', name=f'Column {idx}', statuses=[f'Status {idx}'])
            for idx in range(12)
        ]
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(columns))
        self.assertEqual(errors, [])

    def test_thirteen_columns_is_an_error(self):
        columns = [
            _column(id=f'col-{idx:08x}', name=f'Column {idx}', statuses=[f'Status {idx}'])
            for idx in range(13)
        ]
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(columns))
        self.assertIn('board must have at most 12 columns.', errors)


class GroupBoardIdTests(unittest.TestCase):
    def test_invalid_id_format_is_an_error(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(id='in-progress')])
        )
        self.assertIn('board column at index 0 has an invalid id "in-progress".', errors)

    def test_duplicate_id_is_an_error(self):
        columns = [
            _column(id='col-00000001', name='First', statuses=['Status A']),
            _column(id='col-00000001', name='Second', statuses=['Status B']),
        ]
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(columns))
        self.assertIn('board column "col-00000001" has a duplicate id.', errors)


class GroupBoardNameTests(unittest.TestCase):
    def test_blank_name_after_trim_is_an_error(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(name='   ')])
        )
        self.assertIn('board column "col-00000001" is missing a name.', errors)

    def test_name_of_40_chars_is_valid(self):
        name = 'A' * 40
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(name=name)])
        )
        self.assertEqual(errors, [])

    def test_name_of_41_chars_is_an_error(self):
        name = 'A' * 41
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(name=name)])
        )
        self.assertIn(f'board column "{name}" name exceeds 40 characters.', errors)

    def test_name_differing_only_by_case_is_a_duplicate_error(self):
        columns = [
            _column(id='col-00000001', name='In Progress', statuses=['Status A']),
            _column(id='col-00000002', name='in progress', statuses=['Status B']),
        ]
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(columns))
        self.assertIn('board column "in progress" has a duplicate name.', errors)


class GroupBoardColourTests(unittest.TestCase):
    def test_known_colour_is_kept_as_is(self):
        normalized, errors, warnings = group_board.normalize_group_board(
            _board([_column(colour='#597ef7')])
        )
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertEqual(normalized['columns'][0]['colour'], '#597ef7')

    def test_unknown_colour_is_coerced_to_default_with_warning(self):
        normalized, errors, warnings = group_board.normalize_group_board(
            _board([_column(colour='#123456')])
        )
        self.assertEqual(errors, [])
        self.assertEqual(normalized['columns'][0]['colour'], group_board.DEFAULT_COLUMN_COLOUR)
        self.assertIn(
            'board column "To do" has an unknown colour; using the default colour instead.',
            warnings,
        )


class GroupBoardStarTests(unittest.TestCase):
    def test_zero_starred_columns_is_legal(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(star=False)])
        )
        self.assertEqual(errors, [])

    def test_one_starred_column_is_legal(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(star=True)])
        )
        self.assertEqual(errors, [])

    def test_two_starred_columns_is_an_error(self):
        columns = [
            _column(id='col-00000001', name='First', statuses=['Status A'], star=True),
            _column(id='col-00000002', name='Second', statuses=['Status B'], star=True),
        ]
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(columns))
        self.assertIn('board has more than one starred column.', errors)


class GroupBoardMinMaxTests(unittest.TestCase):
    def test_min_empty_string_coerces_to_null(self):
        normalized, errors, warnings = group_board.normalize_group_board(
            _board([_column(min='')])
        )
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertIsNone(normalized['columns'][0]['min'])

    def test_min_of_zero_is_valid(self):
        normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(min=0)])
        )
        self.assertEqual(errors, [])
        self.assertEqual(normalized['columns'][0]['min'], 0)

    def test_min_of_9999_is_valid(self):
        normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(min=9999)])
        )
        self.assertEqual(errors, [])
        self.assertEqual(normalized['columns'][0]['min'], 9999)

    def test_min_of_10000_is_coerced_to_null_without_error(self):
        normalized, errors, warnings = group_board.normalize_group_board(
            _board([_column(min=10000)])
        )
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertIsNone(normalized['columns'][0]['min'])

    def test_min_equal_to_max_is_legal(self):
        normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(min=5, max=5)])
        )
        self.assertEqual(errors, [])
        self.assertEqual(normalized['columns'][0]['min'], 5)
        self.assertEqual(normalized['columns'][0]['max'], 5)

    def test_min_greater_than_max_is_an_error(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(min=10, max=5)])
        )
        self.assertIn('board column "To do" has a min greater than its max.', errors)


class GroupBoardStatusTests(unittest.TestCase):
    def test_duplicate_status_across_columns_is_an_error(self):
        columns = [
            _column(id='col-00000001', name='First', statuses=['In Progress']),
            _column(id='col-00000002', name='Second', statuses=['In Progress']),
        ]
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(columns))
        self.assertIn(
            'board column "Second" has status "In Progress" already assigned to another column.',
            errors,
        )

    def test_empty_status_list_is_an_error(self):
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(statuses=[])])
        )
        self.assertIn('board column "To do" has no statuses.', errors)

    def test_duplicate_status_across_columns_does_not_also_report_no_statuses(self):
        # A column whose only status duplicates another column's must get
        # exactly the "already assigned to another column" error, not also
        # "has no statuses" - the raw list did contribute a status; it was
        # just rejected as a duplicate, so telling the user to add a status
        # they already added would be wrong.
        columns = [
            _column(id='col-00000001', name='First', statuses=['In Progress']),
            _column(id='col-00000002', name='Second', statuses=['In Progress']),
        ]
        _normalized, errors, _warnings = group_board.normalize_group_board(_board(columns))
        self.assertEqual(
            errors,
            ['board column "Second" has status "In Progress" already assigned to another column.'],
        )

    def test_duplicate_status_within_same_column_reports_accurate_message(self):
        # A duplicate within the same column is not "assigned to another
        # column" - it never left this column. It must get its own,
        # accurate message, and (since one instance of the status was
        # accepted) must not also report "has no statuses".
        _normalized, errors, _warnings = group_board.normalize_group_board(
            _board([_column(statuses=['In Progress', 'In Progress'])])
        )
        self.assertEqual(errors, ['board column "To do" has a duplicate status "In Progress".'])

    def test_stale_status_passes_through_without_error_or_warning(self):
        # This validator has no live status list to check against (see
        # module docstring). A status that no longer exists on the live
        # Jira board - "stale" - is retained verbatim and is neither an
        # error nor a warning here; only the composer checks liveness.
        normalized, errors, warnings = group_board.normalize_group_board(
            _board([_column(statuses=['No Longer A Real Status'])])
        )
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertEqual(normalized['columns'][0]['statuses'], ['No Longer A Real Status'])


# ── The §5.5 reference fixture, and proving its two halves are one fixture ────
#
# §13 asks for `tests/fixtures/groupBoardReference.*` "shared by the Python and
# Playwright suites". The JavaScript half (`.mjs`) is read by the Node unit
# tests, the Playwright specs and the composer harness; the Python half (`.py`)
# is read here. Two files can drift, so instead of copying carefully we parse
# the `.mjs` and assert the two are the same data.

_MJS_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'groupBoardReference.mjs')

_JS_EXPORT_RE = re.compile(r'^export const ([A-Za-z_$][A-Za-z0-9_$]*) = ', re.MULTILINE)
_JS_IDENT_RE = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')


def _js_scan_to_semicolon(source, start):
    """Return the text from `start` up to the statement's terminating `;`."""
    depth = 0
    index = start
    length = len(source)
    while index < length:
        char = source[index]
        if char in '"\'':
            quote = char
            index += 1
            while index < length:
                if source[index] == '\\':
                    index += 2
                    continue
                if source[index] == quote:
                    break
                index += 1
            index += 1
            continue
        if char in '[{(':
            depth += 1
        elif char in ']})':
            depth -= 1
        elif char == ';' and depth == 0:
            return source[start:index]
        index += 1
    raise AssertionError('unterminated export statement in groupBoardReference.mjs')


def _js_literal_to_python(text):
    """Rewrite a JS object/array literal as an equivalent Python literal.

    Raises ValueError when the text is an expression rather than a literal
    (a bare identifier anywhere but an object key), which is how derived
    exports such as `REFERENCE_STATUSES.map(...)` are recognised and skipped.
    """
    out = []
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if char in '"\'':
            quote = char
            end = index + 1
            while end < length:
                if text[end] == '\\':
                    end += 2
                    continue
                if text[end] == quote:
                    break
                end += 1
            if end >= length:
                raise ValueError('unterminated string literal')
            out.append(text[index:end + 1])
            index = end + 1
            continue
        if text.startswith('//', index):
            newline = text.find('\n', index)
            index = length if newline == -1 else newline
            continue
        if text.startswith('/*', index):
            close = text.find('*/', index)
            if close == -1:
                raise ValueError('unterminated block comment')
            index = close + 2
            continue
        match = _JS_IDENT_RE.match(text, index)
        if match:
            word = match.group(0)
            if word == 'true':
                out.append('True')
            elif word == 'false':
                out.append('False')
            elif word in ('null', 'undefined'):
                out.append('None')
            elif text[match.end():].lstrip().startswith(':'):
                out.append(f"'{word}'")  # an unquoted object key
            else:
                raise ValueError(f'not a literal: bare identifier {word!r}')
            index = match.end()
            continue
        out.append(char)
        index += 1
    return ''.join(out)


def _js_literal_exports(source):
    exports = {}
    for match in _JS_EXPORT_RE.finditer(source):
        body = _js_scan_to_semicolon(source, match.end())
        try:
            exports[match.group(1)] = ast.literal_eval(_js_literal_to_python(body))
        except (ValueError, SyntaxError):
            continue  # a derived export (an expression), not fixture data
    return exports


class GroupBoardReferenceFixtureParityTests(unittest.TestCase):
    """§13: the Python and JavaScript halves of the §5.5 fixture are one fixture.

    A drift in either direction fails here: a changed value fails the equality
    loop, and an export added to one side without the other fails the name-set
    assertion (which is also what would catch the literal parser silently
    skipping a real export it could not read).
    """

    # Literal exports only. `REFERENCE_STATUS_NAMES`, `REFERENCE_BOARD`,
    # `referenceBoard()` and `referenceStatusesResponse()` are derived from
    # these on both sides.
    LITERAL_EXPORTS = {
        'REFERENCE_BOARD_ID',
        'REFERENCE_STATUSES',
        'REFERENCE_STATUS_WORK_ITEMS',
        'REFERENCE_EPICS_BY_STATUS',
        'REFERENCE_COLUMNS',
        'REFERENCE_DEFAULT_COLUMNS',
    }

    def setUp(self):
        with open(_MJS_PATH, encoding='utf-8') as handle:
            self.js = _js_literal_exports(handle.read())

    def test_the_two_halves_export_the_same_literals(self):
        self.assertEqual(set(self.js), self.LITERAL_EXPORTS)
        for name in sorted(self.LITERAL_EXPORTS):
            self.assertEqual(self.js[name], getattr(reference, name), f'{name} differs between the two halves')

    def test_the_derived_exports_agree_too(self):
        self.assertEqual(
            [status['name'] for status in self.js['REFERENCE_STATUSES']],
            reference.REFERENCE_STATUS_NAMES,
        )
        self.assertEqual(reference.reference_board(), {'columns': self.js['REFERENCE_COLUMNS']})


class GroupBoardReferenceConfigurationTests(unittest.TestCase):
    """§12.1: the shipped validator's answer for the §5.5 configuration."""

    def test_the_reference_board_normalizes_unchanged(self):
        normalized, errors, warnings = group_board.normalize_group_board(reference.reference_board())
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        # Byte-identical, not merely valid: a colour outside the enum, an id
        # outside the grammar or an out-of-range bound would all show up here
        # as a coerced value rather than as an error.
        self.assertEqual(normalized, reference.reference_board())

    def test_every_board_status_is_mapped_exactly_once(self):
        mapped = [status for column in reference.REFERENCE_COLUMNS for status in column['statuses']]
        self.assertEqual(len(mapped), 12)
        self.assertEqual(len(set(mapped)), 12)
        self.assertEqual(set(mapped), set(reference.REFERENCE_STATUS_NAMES))

    def test_column_order_names_and_colours_are_the_5_5_table(self):
        self.assertEqual(
            [column['name'] for column in reference.REFERENCE_COLUMNS],
            ['To do', 'Analysis', 'Ready to start', 'Accepted in Q', 'External block', 'In progress', 'Done'],
        )
        self.assertEqual(
            [column['colour'] for column in reference.REFERENCE_COLUMNS],
            ['#8c8c8c', '#b37feb', '#597ef7', '#13c2c2', '#ff4d4f', '#597ef7', '#52c41a'],
        )
        # Every one of them is in the closed enum. This is the assertion that
        # would have caught the asset's `#2f80ed` (§5.5's colour correction).
        for column in reference.REFERENCE_COLUMNS:
            self.assertIn(column['colour'], group_board.BOARD_COLUMN_COLOURS, column['name'])
            self.assertTrue(group_board.is_valid_column_id(column['id']), column['id'])

    def test_exactly_one_column_is_starred_and_it_is_in_progress(self):
        starred = [column for column in reference.REFERENCE_COLUMNS if column['star']]
        self.assertEqual([column['name'] for column in starred], ['In progress'])

    def test_the_two_breaches_run_in_opposite_directions(self):
        by_name = {column['name']: column for column in reference.REFERENCE_COLUMNS}
        analysis, in_progress = by_name['Analysis'], by_name['In progress']
        self.assertEqual((analysis['min'], analysis['max']), (15, None))
        self.assertEqual((in_progress['min'], in_progress['max']), (None, 20))
        epics = reference.REFERENCE_EPICS_BY_STATUS
        self.assertEqual(analysis['min'] - sum(epics[name] for name in analysis['statuses']), 4)
        self.assertEqual(sum(epics[name] for name in in_progress['statuses']) - in_progress['max'], 6)

    def test_epic_counts_per_column_total_87_with_a_bar_scale_of_26(self):
        epics = reference.REFERENCE_EPICS_BY_STATUS
        counts = [
            sum(epics[status] for status in column['statuses'])
            for column in reference.REFERENCE_COLUMNS
        ]
        self.assertEqual(counts, [18, 11, 9, 7, 2, 26, 14])
        self.assertEqual(sum(counts), 87)
        self.assertEqual(max(counts), 26)

    def test_the_two_fixtures_are_interchangeable(self):
        """§5.5: same twelve statuses, different grouping."""
        composed = [status for column in reference.REFERENCE_COLUMNS for status in column['statuses']]
        derived = [status for column in reference.REFERENCE_DEFAULT_COLUMNS for status in column['statuses']]
        self.assertEqual(len(derived), 12)
        self.assertEqual(sorted(derived), sorted(reference.REFERENCE_STATUS_NAMES))
        self.assertEqual(sorted(derived), sorted(composed))
        self.assertNotEqual(
            [column['statuses'] for column in reference.REFERENCE_DEFAULT_COLUMNS],
            [column['statuses'] for column in reference.REFERENCE_COLUMNS],
        )
        self.assertEqual(
            [column['name'] for column in reference.REFERENCE_DEFAULT_COLUMNS],
            ['To Do', 'In Progress', 'Done'],
        )


def _round_trip_board():
    return {
        'columns': [
            {
                'id': 'col-00000001',
                'name': 'To do',
                'statuses': ['To Do'],
                'colour': '#8c8c8c',
                'star': False,
                'min': None,
                'max': None,
            },
            {
                'id': 'col-00000002',
                'name': 'In progress',
                'statuses': ['In Progress', 'Release'],
                'colour': '#597ef7',
                'star': True,
                'min': 0,
                'max': 20,
            },
        ],
    }


def _round_trip_groups_payload(board):
    return {
        'version': 1,
        'groups': [{
            'id': 'default',
            'name': 'Default',
            'teamIds': [],
            'board': board,
        }],
        'defaultGroupId': 'default',
    }


class GroupBoardJsonRoundTripTests(unittest.TestCase):
    """§12.1: board survives save -> reload in JSON config mode.

    This is the test that catches the silent-drop failure mode - if `board`
    is ever removed from the whitelist dict in group_config.py, or from the
    wiring in jira_server.py, this fails while the grammar-row tests above
    (which call normalize_group_board directly) keep passing.
    """

    def test_board_survives_save_and_reload(self):
        force_basic_auth_mode(self, jira_server)
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        board = _round_trip_board()
        with tempfile.TemporaryDirectory() as tmpdir:
            dashboard_path = os.path.join(tmpdir, 'dashboard-config.json')
            with open(dashboard_path, 'w', encoding='utf-8') as handle:
                json.dump({'version': 1, 'projects': {'selected': []}}, handle)
            with patch.object(jira_server, 'resolve_dashboard_config_path', return_value=dashboard_path):
                response = client.post(
                    '/api/groups-config',
                    json=_round_trip_groups_payload(board),
                )
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['groups'][0]['board'], board)

                reloaded = client.get('/api/groups-config').get_json()

        self.assertEqual(reloaded['groups'][0]['board'], board)

    def test_the_reference_configuration_survives_save_and_reload(self):
        """§12.1's round-trip row names the 7-column §5.5 fixture, not a toy board.

        The two-column board above is enough to catch a dropped `board` key; only
        the reference fixture exercises every colour, both bounds, the star and
        the multi-status columns in one payload.
        """
        force_basic_auth_mode(self, jira_server)
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        board = reference.reference_board()
        with tempfile.TemporaryDirectory() as tmpdir:
            dashboard_path = os.path.join(tmpdir, 'dashboard-config.json')
            with open(dashboard_path, 'w', encoding='utf-8') as handle:
                json.dump({'version': 1, 'projects': {'selected': []}}, handle)
            with patch.object(jira_server, 'resolve_dashboard_config_path', return_value=dashboard_path):
                response = client.post('/api/groups-config', json=_round_trip_groups_payload(board))
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['groups'][0]['board'], board)

                reloaded = client.get('/api/groups-config').get_json()

        self.assertEqual(reloaded['groups'][0]['board'], reference.reference_board())


class GroupBoardDbRoundTripTests(unittest.TestCase):
    """§12.1: board survives save -> reload in DB (workspace-shared) config mode."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'group-board.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject='account-1',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, user])
            session.commit()
            self.workspace_id = workspace.id
            self.user_id = user.id
        self.context = SimpleNamespace(
            workspace_id=self.workspace_id,
            user_id=self.user_id,
            auth_connection_id=f'connection-{self.user_id}',
        )

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def test_board_survives_save_and_reload(self):
        board = _round_trip_board()
        loaded = shared_group_config.load_shared_groups(
            self.context,
            fallback_loader=lambda: None,
            validate_groups_config_fn=jira_server.validate_groups_config,
            database_url=self.database_url,
        )

        saved = shared_group_config.save_shared_groups(
            self.context,
            _round_trip_groups_payload(board),
            base_revision=loaded['configRevision'],
            validate_groups_config_fn=jira_server.validate_groups_config,
            database_url=self.database_url,
        )
        self.assertEqual(saved['groups'][0]['board'], board)

        reloaded = shared_group_config.load_shared_groups(
            self.context,
            fallback_loader=lambda: None,
            validate_groups_config_fn=jira_server.validate_groups_config,
            database_url=self.database_url,
        )
        self.assertEqual(reloaded['groups'][0]['board'], board)

    def test_the_reference_configuration_survives_save_and_reload(self):
        """§12.1's round-trip row, in DB mode, with the 7-column §5.5 fixture."""
        board = reference.reference_board()
        loaded = shared_group_config.load_shared_groups(
            self.context,
            fallback_loader=lambda: None,
            validate_groups_config_fn=jira_server.validate_groups_config,
            database_url=self.database_url,
        )

        saved = shared_group_config.save_shared_groups(
            self.context,
            _round_trip_groups_payload(board),
            base_revision=loaded['configRevision'],
            validate_groups_config_fn=jira_server.validate_groups_config,
            database_url=self.database_url,
        )
        self.assertEqual(saved['groups'][0]['board'], board)

        reloaded = shared_group_config.load_shared_groups(
            self.context,
            fallback_loader=lambda: None,
            validate_groups_config_fn=jira_server.validate_groups_config,
            database_url=self.database_url,
        )
        self.assertEqual(reloaded['groups'][0]['board'], reference.reference_board())


class GroupBoardValidationRouteTests(unittest.TestCase):
    """Proves an invalid board is rejected end to end through
    POST /api/groups-config, not only through normalize_group_board called
    directly. The grammar-row tests above call normalize_group_board
    directly and would keep passing even if group_config.py's board-error
    propagation loop (the wiring that prefixes each board error/warning with
    `Group "{name}" ...` and appends it to the caller's errors/warnings) were
    removed or mis-prefixed into warnings; only a test that goes through
    validate_groups_config/the route catches that.
    """

    def test_invalid_board_is_rejected_with_prefixed_error_and_not_persisted(self):
        force_basic_auth_mode(self, jira_server)
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        with tempfile.TemporaryDirectory() as tmpdir:
            dashboard_path = os.path.join(tmpdir, 'dashboard-config.json')
            with open(dashboard_path, 'w', encoding='utf-8') as handle:
                json.dump({
                    'version': 1,
                    'teamGroups': {
                        'version': 1,
                        'groups': [{
                            'id': 'default',
                            'name': 'Default',
                            'teamIds': ['team-1'],
                        }],
                        'defaultGroupId': 'default',
                    },
                }, handle)
            with patch.object(jira_server, 'resolve_dashboard_config_path', return_value=dashboard_path):
                before = client.get('/api/groups-config').get_json()
                invalid_board = _board([
                    _column(id='col-00000001', name='First', statuses=['Status A'], star=True),
                    _column(id='col-00000002', name='Second', statuses=['Status B'], star=True),
                ])
                response = client.post('/api/groups-config', json={
                    'version': 1,
                    'groups': [{
                        'id': 'default',
                        'name': 'Default',
                        'teamIds': ['team-1'],
                        'board': invalid_board,
                    }],
                    'defaultGroupId': 'default',
                })
                after = client.get('/api/groups-config').get_json()

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json().get('errors'),
            ['Group "Default" board has more than one starred column.'],
        )
        self.assertEqual(after['groups'], before['groups'])


if __name__ == '__main__':
    unittest.main()
