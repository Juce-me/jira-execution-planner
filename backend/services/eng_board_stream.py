"""Strict, bounded ENG Board protocol-v1 NDJSON encoding.

This module is transport-only. It does not register routes, access Flask state,
schedule Jira work, or claim a hard execution deadline.
"""

import json
import math


ENG_BOARD_PROTOCOL_VERSION = 1
ENG_BOARD_MAX_FRAME_BYTES = 8 * 1024 * 1024
ENG_BOARD_MAX_GENERATION_BYTES = 32 * 1024 * 1024

_MAX = {
    'identity': 256,
    'name': 512,
    'summary': 4096,
    'url': 2048,
    'timestamp': 128,
    'columns': 100,
    'epics': 1000,
    'children': 10000,
    'sprint_ids': 100,
    'statuses': 500,
    'progress': 1000,
    'failed_columns': 100,
}


class EngBoardFrameError(ValueError):
    """A frame cannot be safely represented by the frozen wire contract."""


def _fail(code='invalid_frame'):
    raise EngBoardFrameError(code)


def _exact(value, required, optional=()):
    if not isinstance(value, dict):
        _fail()
    if set(value) - set(required) - set(optional):
        _fail()
    if set(required) - set(value):
        _fail()


def _string(value, limit, nullable=False, pattern=None):
    if nullable and value is None:
        return
    if not isinstance(value, str) or not value:
        _fail()
    try:
        encoded = value.encode('utf-8')
    except UnicodeEncodeError:
        _fail()
    if len(encoded) > limit:
        _fail()
    if pattern is not None and not pattern(value):
        _fail()


def _boolean(value):
    if not isinstance(value, bool):
        _fail()


def _number(value, integer=False, nullable=False, maximum=None):
    if nullable and value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        _fail()
    if integer and not isinstance(value, int):
        _fail()
    if maximum is not None and value > maximum:
        _fail()


def _one_of(value, choices):
    if value not in choices:
        _fail()


def _array(value, limit, item_validator):
    if not isinstance(value, list) or len(value) > limit:
        _fail()
    for item in value:
        item_validator(item)


def _named(value):
    _exact(value, ('id', 'name'))
    _string(value['id'], _MAX['identity'])
    _string(value['name'], _MAX['name'])


def _nullable_named(value):
    if value is not None:
        _named(value)


def _person(value):
    _exact(value, ('accountId', 'displayName', 'avatarUrl'))
    _string(value['accountId'], _MAX['identity'])
    _string(value['displayName'], _MAX['name'])
    _string(value['avatarUrl'], _MAX['url'], nullable=True)


def _nullable_person(value):
    if value is not None:
        _person(value)


def _column(value):
    _exact(value, ('id', 'name', 'color', 'statusNames', 'terminal'))
    _string(value['id'], _MAX['identity'])
    _string(value['name'], _MAX['name'])
    _string(value['color'], _MAX['name'])
    _array(value['statusNames'], _MAX['statuses'], lambda item: _string(item, _MAX['name']))
    _boolean(value['terminal'])


def _parent(value):
    if value is None:
        return
    _exact(value, ('key', 'summary', 'issueType'))
    _string(value['key'], _MAX['identity'])
    _string(value['summary'], _MAX['summary'])
    _named(value['issueType'])


def _epic(value):
    keys = (
        'key', 'summary', 'status', 'priority', 'assignee', 'deliveryOwner', 'projectTrack',
        'updated', 'parent', 'columnId',
    )
    _exact(value, keys)
    _string(value['key'], _MAX['identity'])
    _string(value['summary'], _MAX['summary'])
    _named(value['status'])
    _nullable_named(value['priority'])
    _nullable_person(value['assignee'])
    _nullable_person(value['deliveryOwner'])
    _string(value['projectTrack'], _MAX['name'], nullable=True)
    _string(value['updated'], _MAX['timestamp'], nullable=True)
    _parent(value['parent'])
    _string(value['columnId'], _MAX['identity'])


def _child(value):
    keys = (
        'key', 'epicKey', 'summary', 'status', 'priority', 'issueType', 'assignee', 'updated',
        'storyPoints', 'team', 'project', 'projectClassification', 'sprintIds',
    )
    _exact(value, keys)
    _string(value['key'], _MAX['identity'])
    _string(value['epicKey'], _MAX['identity'])
    _string(value['summary'], _MAX['summary'])
    _named(value['status'])
    _nullable_named(value['priority'])
    _named(value['issueType'])
    _nullable_person(value['assignee'])
    _string(value['updated'], _MAX['timestamp'], nullable=True)
    _number(value['storyPoints'], nullable=True)
    _nullable_named(value['team'])
    _named(value['project'])
    _one_of(value['projectClassification'], ('product', 'tech', 'other'))
    _array(value['sprintIds'], _MAX['sprint_ids'], lambda item: _number(item, integer=True))


def _diagnostics(value, expected_completeness=None):
    keys = (
        'indexMs', 'focusedCompleteMs', 'durationMs', 'jiraRequests', 'jiraPages', 'jiraRetries',
        'peakChildSearches', 'cacheState', 'completeness',
    )
    _exact(value, keys)
    _number(value['indexMs'])
    _number(value['focusedCompleteMs'], nullable=True)
    _number(value['durationMs'])
    for key in ('jiraRequests', 'jiraPages', 'jiraRetries'):
        _number(value[key], integer=True)
    _number(value['peakChildSearches'], integer=True, maximum=2)
    _one_of(value['cacheState'], ('hit', 'miss', 'mixed', 'unknown'))
    _one_of(value['completeness'], ('complete', 'partial'))
    if expected_completeness and value['completeness'] != expected_completeness:
        _fail()


def _progress(value):
    _exact(value, ('epicKey', 'loadedChildren', 'statusCounts'))
    _string(value['epicKey'], _MAX['identity'])
    _number(value['loadedChildren'], integer=True)
    if not isinstance(value['statusCounts'], dict) or len(value['statusCounts']) > _MAX['statuses']:
        _fail()
    for key, count in value['statusCounts'].items():
        _string(key, _MAX['name'])
        _number(count, integer=True)


def _validate_body(frame):
    base = ('protocolVersion', 'generationId', 'sequence', 'type')
    frame_type = frame['type']
    if frame_type == 'start':
        _exact(frame, base + ('scope', 'scopeVersion', 'scopeCohortDigest', 'columns'))
        _one_of(frame['scope'], ('all_work', 'sprint'))
        _string(frame['scopeVersion'], _MAX['identity'])
        _string(frame['scopeCohortDigest'], 64,
                pattern=lambda value: len(value) == 64 and all(char in '0123456789abcdef' for char in value))
        _array(frame['columns'], _MAX['columns'], _column)
        return False
    if frame_type == 'index':
        _exact(frame, base + ('epics', 'membership'))
        _array(frame['epics'], _MAX['epics'], _epic)
        _one_of(frame['membership'], ('candidate', 'authoritative'))
        return False
    if frame_type == 'progress':
        _exact(frame, base + ('columnId', 'loadedChildren', 'byEpic'))
        _string(frame['columnId'], _MAX['identity'])
        _number(frame['loadedChildren'], integer=True)
        _array(frame['byEpic'], _MAX['progress'], _progress)
        return False
    if frame_type == 'column':
        _exact(frame, base + ('columnId', 'epics', 'children', 'authoritative'))
        _string(frame['columnId'], _MAX['identity'])
        _array(frame['epics'], _MAX['epics'], _epic)
        _array(frame['children'], _MAX['children'], _child)
        if frame['authoritative'] is not True:
            _fail()
        return False
    if frame_type == 'column_error':
        _exact(frame, base + ('columnId', 'code', 'retryable'))
        _string(frame['columnId'], _MAX['identity'])
        if frame['code'] != 'jira_unavailable' or frame['retryable'] is not True:
            _fail()
        return False
    if frame_type == 'complete':
        if frame.get('outcome') == 'success':
            _exact(frame, base + ('outcome', 'authoritative', 'epicCount', 'childCount', 'diagnostics'))
            if frame['authoritative'] is not True:
                _fail()
            _number(frame['epicCount'], integer=True)
            _number(frame['childCount'], integer=True)
            _diagnostics(frame['diagnostics'], 'complete')
        elif frame.get('outcome') == 'partial_error':
            _exact(frame, base + ('outcome', 'authoritative', 'failedColumnIds', 'diagnostics'))
            if frame['authoritative'] is not False:
                _fail()
            _array(frame['failedColumnIds'], _MAX['failed_columns'],
                   lambda item: _string(item, _MAX['identity']))
            _diagnostics(frame['diagnostics'], 'partial')
        else:
            _fail()
        return True
    if frame_type == 'error':
        _exact(frame, base + ('code',), ('diagnostics',))
        _one_of(frame['code'], (
            'auth_required', 'scope_changed', 'scope_too_large', 'deadline_exceeded',
            'invalid_page', 'storage_unavailable', 'jira_unavailable',
        ))
        if frame['code'] == 'auth_required' and 'diagnostics' in frame:
            _fail()
        if 'diagnostics' in frame:
            _diagnostics(frame['diagnostics'], 'partial')
        return True
    _fail()


class EngBoardStreamWriter:
    """Validate and encode one generation while enforcing byte and order bounds."""

    def __init__(self, max_frame_bytes=ENG_BOARD_MAX_FRAME_BYTES,
                 max_generation_bytes=ENG_BOARD_MAX_GENERATION_BYTES):
        if not isinstance(max_frame_bytes, int) or max_frame_bytes <= 0:
            raise ValueError('max_frame_bytes must be a positive integer')
        if not isinstance(max_generation_bytes, int) or max_generation_bytes <= 0:
            raise ValueError('max_generation_bytes must be a positive integer')
        self.max_frame_bytes = max_frame_bytes
        self.max_generation_bytes = max_generation_bytes
        self.generation_id = None
        self.sequence = None
        self.total_bytes = 0
        self.complete = False

    def write(self, frame):
        if self.complete:
            _fail('stream_complete')
        if not isinstance(frame, dict):
            _fail()
        if frame.get('protocolVersion') != ENG_BOARD_PROTOCOL_VERSION:
            _fail()
        _string(frame.get('generationId'), _MAX['identity'])
        _number(frame.get('sequence'), integer=True)
        _string(frame.get('type'), _MAX['name'])
        if self.sequence is None:
            if frame['sequence'] != 0 or frame['type'] != 'start':
                _fail('invalid_sequence')
            self.generation_id = frame['generationId']
        elif frame['sequence'] != self.sequence + 1:
            _fail('invalid_sequence')
        if frame['generationId'] != self.generation_id:
            _fail('invalid_generation')
        terminal = _validate_body(frame)
        try:
            encoded_frame = json.dumps(
                frame, ensure_ascii=False, allow_nan=False, separators=(',', ':'),
            ).encode('utf-8')
        except (TypeError, ValueError, UnicodeError) as error:
            raise EngBoardFrameError('invalid_frame') from error
        if len(encoded_frame) > self.max_frame_bytes:
            _fail('frame_too_large')
        encoded_line = encoded_frame + b'\n'
        if self.total_bytes + len(encoded_line) > self.max_generation_bytes:
            _fail('generation_too_large')
        self.sequence = frame['sequence']
        self.total_bytes += len(encoded_line)
        self.complete = terminal
        return encoded_line
