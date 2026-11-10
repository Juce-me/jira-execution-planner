"""Planning data/provider/control extension for the owned DB/OAuth launcher.

Imported only inside its guarded synthetic child. This module never starts an
application, creates auth identities, or supplies application HTTP responses.
"""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import os
import re
import threading
from urllib.parse import urlsplit
from unittest.mock import patch
import uuid


GROUP_ID = 'planning-synthetic'
TEAM_A = '11111111-1111-4111-8111-111111111111'
TEAM_B = '22222222-2222-4222-8222-222222222222'
SPRINT_FIELD = 'customfield_10020'
TEAM_FIELD = 'customfield_10021'
POINTS_FIELD = 'customfield_10022'
EPIC_FIELD = 'customfield_10023'
CAPACITY_PROJECT = 'SYNCAP'
CAPACITY_FIELD = 'customfield_10030'
CAPACITY_SITE_URL = 'https://example.atlassian.net'
CAPACITY_CLOUD_ID = 'synthetic-cloud'
SPRINTS = [
    {'id': 101, 'name': '2027Q1', 'state': 'active', 'originBoardId': 701,
     'startDate': '2027-01-01T00:00:00.000Z', 'endDate': '2027-03-31T00:00:00.000Z'},
    {'id': 102, 'name': '2027Q2', 'state': 'future', 'originBoardId': 701,
     'startDate': '2027-04-01T00:00:00.000Z', 'endDate': '2027-06-30T00:00:00.000Z'},
]
ISSUE_TYPES = [
    {'id': '10000', 'name': 'Epic', 'hierarchyLevel': 1, 'subtask': False},
    {'id': '10001', 'name': 'Initiative', 'hierarchyLevel': 2, 'subtask': False},
    {'id': '10002', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False},
    {'id': '10003', 'name': 'Sub-task', 'hierarchyLevel': -1, 'subtask': True},
]


def _issue(identity, kind, team, points=0, parent=None, sprints=(101,)):
    key = 'SYN-' + identity
    fields = {
        'summary': 'Synthetic ' + kind + ' ' + identity,
        'issuetype': deepcopy(next(row for row in ISSUE_TYPES if row['name'] == kind)),
        'project': {'id': '700', 'key': 'SYN', 'name': 'Synthetic planning'},
        'status': {'id': '1', 'name': 'To Do', 'statusCategory': {'key': 'new', 'name': 'To Do'}},
        'priority': {'id': '3', 'name': 'Medium'}, 'components': [],
        'labels': ['synthetic-a' if team == TEAM_A else 'synthetic-b'],
        'assignee': {'accountId': 'synthetic-assignee', 'displayName': 'Synthetic assignee'},
        'reporter': {'accountId': 'synthetic-reporter', 'displayName': 'Synthetic reporter'},
        SPRINT_FIELD: [deepcopy(row) for row in SPRINTS if row['id'] in sprints],
        TEAM_FIELD: {'id': team, 'name': 'Synthetic Team ' + ('A' if team == TEAM_A else 'B')},
        POINTS_FIELD: points, 'issuelinks': [], 'subtasks': [],
        'updated': '2027-01-02T00:00:00.000+0000',
    }
    if parent:
        fields['parent'] = {'id': parent, 'key': 'SYN-' + parent}
        fields[EPIC_FIELD] = 'SYN-' + parent
    return {'id': identity, 'key': key, 'fields': fields}


def _capacity_issue(identity, sprint_name, team_name, capacity):
    """A synthetic "Team info" ticket; searched only through its own `summary ~` pool."""
    issue = _issue(identity, 'Story', TEAM_A, sprints=())
    issue['key'] = CAPACITY_PROJECT + '-' + identity
    issue['fields'].update({
        'summary': 'Team info ' + sprint_name + ' - ' + team_name,
        'project': {'id': '790', 'key': CAPACITY_PROJECT, 'name': 'Synthetic capacity'},
        'labels': [], CAPACITY_FIELD: capacity,
    })
    return issue


def _split(expression, keyword):
    """Split only unquoted top-level operators; unsupported predicates fail closed."""
    parts, start, depth, quote = [], 0, 0, None
    for index, char in enumerate(expression):
        if quote:
            if char == quote and (index == 0 or expression[index - 1] != '\\'):
                quote = None
        elif char in "\"'":
            quote = char
        elif char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif depth == 0 and expression[index:index + len(keyword)].upper() == keyword:
            if (index == 0 or expression[index - 1].isspace()) and (
                    index + len(keyword) == len(expression) or expression[index + len(keyword)].isspace()):
                parts.append(expression[start:index].strip())
                start = index + len(keyword)
    parts.append(expression[start:].strip())
    return parts


def _outer(expression):
    while expression.startswith('(') and expression.endswith(')'):
        depth, quote, encloses = 0, None, True
        for index, char in enumerate(expression):
            if quote:
                if char == quote:
                    quote = None
            elif char in "\"'":
                quote = char
            elif char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
                if depth == 0 and index < len(expression) - 1:
                    encloses = False
                    break
        if not encloses:
            break
        expression = expression[1:-1].strip()
    return expression


def matches_jql(issue, expression):
    expression = _outer(expression.strip())
    for keyword, combine in (('OR', any), ('AND', all)):
        parts = _split(expression, keyword)
        if len(parts) > 1:
            # Evaluate every predicate even if another predicate determines the result.
            return combine([matches_jql(issue, part) for part in parts])
    found = re.fullmatch(r'(.+?)\s+(NOT IN|IN|IS NOT|IS|!=|=|~)\s*(.+)', expression, re.I)
    if not found:
        raise AssertionError('Unsupported synthetic JQL predicate.')
    name, operator, raw = found.groups()
    name = name.strip().strip('"').casefold()
    operator = operator.upper()
    fields = issue['fields']
    aliases = {
        'id': [issue['id']], 'key': [issue['key']], 'issuekey': [issue['key']],
        'project': [fields['project']['key'], fields['project']['id']],
        'issuetype': [fields['issuetype']['id'], fields['issuetype']['name']],
        'type': [fields['issuetype']['id'], fields['issuetype']['name']],
        'sprint': [str(row['id']) for row in fields[SPRINT_FIELD]],
        SPRINT_FIELD.casefold(): [str(row['id']) for row in fields[SPRINT_FIELD]],
        'cf[10020]': [str(row['id']) for row in fields[SPRINT_FIELD]],
        'team[team]': [fields[TEAM_FIELD]['id']], 'team': [fields[TEAM_FIELD]['id']],
        TEAM_FIELD.casefold(): [fields[TEAM_FIELD]['id']], 'cf[10021]': [fields[TEAM_FIELD]['id']],
        'labels': fields['labels'], 'component': [row['name'] for row in fields['components']],
        'parent': [fields.get('parent', {}).get('key', ''), fields.get('parent', {}).get('id', '')],
        'epic link': [fields.get(EPIC_FIELD, '')], EPIC_FIELD.casefold(): [fields.get(EPIC_FIELD, '')],
        'status': [fields['status']['name'], fields['status']['id']],
        'statuscategory': [fields['status']['statusCategory']['name'], fields['status']['statusCategory']['key']],
        'summary': [fields['summary']],
    }
    if name not in aliases:
        raise AssertionError('Unsupported synthetic JQL field.')
    if operator == '~':
        # Jira text search on a quoted phrase: `summary ~ "\"Team info <Sprint> - <Team>\""`.
        if name != 'summary' or not re.fullmatch(r'"\\".*\\""', raw.strip()):
            raise AssertionError('Unsupported synthetic JQL text predicate.')
        phrase = raw.strip()[3:-3].replace('\\"', '"').casefold()
        return phrase in fields['summary'].casefold()
    values = [value.casefold() for value in aliases[name] if value]
    if operator in {'IS', 'IS NOT'}:
        if raw.upper() != 'EMPTY':
            raise AssertionError('Unsupported synthetic JQL empty predicate.')
        result = not values
    else:
        if re.fullmatch(r'(futureSprints|openSprints|closedSprints)\(\)', raw, re.I):
            if name not in {'sprint', SPRINT_FIELD.casefold(), 'cf[10020]'}:
                raise AssertionError('Synthetic Sprint function requires a Sprint field.')
            state = {'futuresprints()': 'future', 'opensprints()': 'active', 'closedsprints()': 'closed'}[raw.casefold()]
            candidates = [str(row['id']) for row in SPRINTS if row['state'] == state]
        else:
            if '(' in raw.strip('()') or ')' in raw.strip('()'):
                raise AssertionError('Unsupported synthetic JQL function.')
            candidates = [value.strip().strip('"\'').casefold() for value in raw.strip('()').split(',')]
        result = bool(set(values) & set(candidates))
    return not result if operator in {'NOT IN', '!=', 'IS NOT'} else result


class PlanningFixture:
    def __init__(self, *, factory, actors, server, response_class):
        class ProviderResponse(response_class):
            def iter_content(self, chunk_size=65536):
                for offset in range(0, len(self.content), chunk_size):
                    yield self.content[offset:offset + chunk_size]

            def close(self):
                pass

        self.factory, self.actors, self.server, self.Response = factory, actors, server, ProviderResponse
        self.calls, self.failures, self.mutations = [], [], []
        self.promoted = False
        self.pause = threading.Event()
        self.pause.set()
        self.pause_entered = threading.Event()
        self.drop_ack = False
        self.pause_armed = False
        self.patches = []
        self.issues = []
        # Jira capacity PUTs are refused (and recorded as mutations) unless a test opts in.
        self.capacity_put_allowed = False
        self.capacity_puts = []
        self.capacity_issues = []
        self.prepare(reset=False)

    def prepare(self, promoted=False, *, reset=True):
        from backend.db import models
        from backend.auth.db_context import resolve_db_request_auth_context
        from backend.services import work_structure
        from backend.services.workspace_catalog_config import team_scope_digest
        workspace_id = self.actors['actor-a'].workspace_id
        with self.factory() as db:
            saved = db.query(models.WorkspaceDashboardConfig).filter_by(workspace_id=workspace_id).one_or_none()
            restore = not reset and saved is not None
            if restore:
                promoted = bool((saved.payload.get('workConfigurations') or {}).get('promotionRevision'))
        self.promoted = bool(promoted)
        os.environ['WORK_CONFIGURATIONS_ENABLED'] = 'true' if promoted else 'false'
        self.issues = [
            _issue('8001', 'Initiative' if promoted else 'Epic', TEAM_A),
            _issue('8002', 'Initiative' if promoted else 'Epic', TEAM_B),
            _issue('8101', 'Epic' if promoted else 'Story', TEAM_A, 3, '8001', (101, 102)),
            _issue('8102', 'Epic' if promoted else 'Story', TEAM_B, 5, '8002'),
            _issue('8103', 'Epic' if promoted else 'Story', TEAM_B, 8, '8002', (102,)),
            _issue('8201', 'Sub-task', TEAM_A, 0, '8101'),
            _issue('8999', 'Story', TEAM_A, 13, '8001'),
        ]
        self.issues[2]['fields']['issuelinks'] = [{
            'id': 'synthetic-link', 'type': {'name': 'Blocks', 'inward': 'is blocked by', 'outward': 'blocks'},
            'outwardIssue': {key: deepcopy(self.issues[3][key]) for key in ('id', 'key', 'fields')},
        }]
        self.issues[2]['fields']['subtasks'] = [deepcopy(self.issues[5])]
        # 2027Q1: Team A has a "Team info" ticket; Team B has none (the no-ticket path). 2027Q2 has no tickets.
        self.capacity_issues = [_capacity_issue('9001', SPRINTS[0]['name'], 'Synthetic Team A', 20)]
        self.capacity_put_allowed = False
        self.capacity_puts = []
        if restore:
            # Restart restores only provider data. Config/catalog revisions,
            # private views and encrypted auth rows are already durable.
            return
        # The legacy dashboard reads product/tech lanes independently. Give
        # each lane an explicit project: an absent typed scope otherwise retains
        # the base project and would duplicate these synthetic rows in the UI.
        flat = {'version': 1, 'projects': {'selected': [
                    {'key': 'SYN', 'type': 'product'}, {'key': 'AUX', 'type': 'tech'}]},
                'board': {'boardId': '701', 'boardName': 'Synthetic board'}, 'issueTypes': ['Story'],
                'sprintField': {'fieldId': SPRINT_FIELD, 'fieldName': 'Sprint'},
                'storyPointsField': {'fieldId': POINTS_FIELD, 'fieldName': 'Story Points'},
                'teamField': {'fieldId': TEAM_FIELD, 'fieldName': 'Team'},
                'parentNameField': {'fieldId': EPIC_FIELD, 'fieldName': 'Epic Link'}}
        payload = deepcopy(flat)
        if promoted:
            bundle = work_structure.capture_virtual_bundle(flat)
            legacy, delivery = bundle['configurations']
            bundle['promotionRevision'] = 1
            for entry in bundle['configurations']:
                entry['revision'] = 1
            delivery['scope'] = {'projects': [{'key': 'SYN', 'type': 'other'}], 'boardId': '701'}
            delivery['hierarchy'].update(planningIssueTypeId='10000', parentIssueTypeId='10001')
            for name, identity in (('sprint', SPRINT_FIELD), ('storyPoints', POINTS_FIELD)):
                delivery['fields'][name] = {'fieldId': identity, 'fieldName': name}
            payload = {'version': 1, 'workConfigurations': work_structure.normalize_work_configurations(bundle)}
        payload['capacity'] = {'project': CAPACITY_PROJECT, 'fieldId': CAPACITY_FIELD, 'fieldName': 'Team capacity'}
        now = datetime.now(timezone.utc)
        with self.factory() as db:
            row = db.query(models.WorkspaceDashboardConfig).filter_by(workspace_id=workspace_id).one_or_none()
            if row is None:
                row = models.WorkspaceDashboardConfig(workspace_id=workspace_id)
                db.add(row)
            row.payload, row.config_revision = payload, 1
            # A verified numeric capacity field for this synthetic site, so mutation is enabled.
            row.capacity_jira_site_url, row.capacity_jira_cloud_id = CAPACITY_SITE_URL, CAPACITY_CLOUD_ID
            row.capacity_field_schema_type, row.capacity_field_verified_at = 'number', now
            group = db.query(models.WorkspaceGroupConfig).filter_by(workspace_id=workspace_id).one_or_none()
            if group is None:
                group = models.WorkspaceGroupConfig(workspace_id=workspace_id)
                db.add(group)
            group.payload_version, group.config_revision = 2, 1
            group.payload = {'version': 2, 'groups': [{'id': GROUP_ID, 'name': 'Synthetic Department',
                'teamIds': [TEAM_A, TEAM_B],
                'teamLabels': {TEAM_A: ['synthetic-a'], TEAM_B: ['synthetic-b']}}], 'defaultGroupId': GROUP_ID}
            directory = db.query(models.WorkspaceTeamCatalog).filter_by(workspace_id=workspace_id).one_or_none()
            if directory is None:
                directory = models.WorkspaceTeamCatalog(workspace_id=workspace_id)
                db.add(directory)
            directory.payload = {'catalog': {TEAM_A: {'id': TEAM_A, 'name': 'Synthetic Team A'},
                TEAM_B: {'id': TEAM_B, 'name': 'Synthetic Team B'}}, 'meta': {}}
            for actor in self.actors.values():
                user = db.get(models.User, actor.user_id)
                if user.account_type != 'user':
                    raise AssertionError('Planning actors must be non-admin members.')
                preference = db.query(models.UserGroupPreference).filter_by(user_id=actor.user_id,
                    workspace_id=workspace_id).one_or_none()
                if preference is None:
                    from backend.services.shared_group_config import ONBOARDING_MODULE_IDS
                    db.add(models.UserGroupPreference(user_id=actor.user_id, workspace_id=workspace_id,
                        visible_group_ids=[GROUP_ID], active_group_id=GROUP_ID, customized=True,
                        onboarding_done=True, onboarding_completed_modules=list(ONBOARDING_MODULE_IDS)))
                for project, project_type in (('SYN', 'product'), ('AUX', 'tech')):
                    access = db.query(models.JiraProjectAccess).filter_by(connection_id=actor.connection_id,
                        workspace_id=workspace_id, project_key=project, project_type=project_type).one_or_none()
                    if access is None:
                        db.add(models.JiraProjectAccess(connection_id=actor.connection_id, workspace_id=workspace_id,
                            project_key=project, project_type=project_type, status='accessible', checked_at=now))
                private = db.query(models.ViewConfig).filter_by(owner_user_id=actor.user_id,
                    workspace_id=workspace_id, is_default=True).one_or_none()
                if private is None:
                    db.add(models.ViewConfig(owner_user_id=actor.user_id, workspace_id=workspace_id,
                        name='Synthetic private view', view_type='eng', is_default=True,
                        payload={'version': 1, 'view': {'mode': 'planning', 'selectedSprint': 101}}))
            catalog = db.query(models.WorkspaceSprintCatalog).filter_by(workspace_id=workspace_id, board_id='701').one_or_none()
            if catalog is None:
                catalog = models.WorkspaceSprintCatalog(workspace_id=workspace_id, board_id='701')
                db.add(catalog)
            catalog.sprints, catalog.validated_at = deepcopy(SPRINTS), now
            catalog.catalog_version, catalog.next_refresh_at = str(uuid.uuid4()), now + timedelta(hours=24)
            db.commit()

        context = resolve_db_request_auth_context(self.actors['actor-a'].session_payload)
        with self.factory() as db:
            sources = self.server.resolve_request_catalog_sources(db, context)
            configs = sources if sources is not None else [self.server.resolve_request_effective_catalog_config(db, context)]
            config = next(item for item in configs if not promoted or item.configuration_id == 'delivery')
            for sprint in SPRINTS:
                row = db.query(models.WorkspaceSprintTeamCatalog).filter_by(workspace_id=workspace_id,
                    sprint_id=str(sprint['id'])).one_or_none()
                if row is None:
                    row = models.WorkspaceSprintTeamCatalog(workspace_id=workspace_id,
                        sprint_id=str(sprint['id']), sprint_name=sprint['name'])
                    db.add(row)
                row.scope_digest = team_scope_digest(config)
                row.teams = [{'id': TEAM_A, 'name': 'Synthetic Team A'}, {'id': TEAM_B, 'name': 'Synthetic Team B'}]
                row.validated_at, row.catalog_version = now, str(uuid.uuid4())
            db.commit()

    def install_save_controls(self):
        """Pause the real lock owner; lose delivery only after a real receipt commit.

        These wrappers do nothing to legacy calls. Before v2 exists, its strict
        payload validation still rejects the request; no outcome is fabricated.
        """
        from flask import has_request_context, request
        from backend.services import sprint_review
        from backend.routes import sprint_review_routes

        locked_schema = sprint_review._locked_schema
        response = sprint_review_routes._response

        def v2_request():
            if not has_request_context() or request.method != 'PATCH':
                return None
            body = request.get_json(silent=True)
            return body if isinstance(body, dict) and body.get('version') == 2 else None

        def lock_and_pause(*args, **kwargs):
            row = locked_schema(*args, **kwargs)
            if self.pause_armed and v2_request() is not None:
                self.pause_armed = False
                self.pause_entered.set()
                if not self.pause.wait(timeout=20):
                    raise AssertionError('Owned Planning save pause timed out.')
            return row

        def response_after_commit(payload, status=200, *args, **kwargs):
            actual = response(payload, status, *args, **kwargs)
            body = v2_request()
            if self.drop_ack and body and status == 200:
                context = self.server.current_request_auth_context()
                actor = next(name for name, item in self.actors.items() if item.user_id == context.user_id)
                receipt = self.read_operation(body.get('operationId'), actor)
                if receipt['state'] != 'committed':
                    raise AssertionError('Delivery loss requires a persisted operation receipt.')
                self.drop_ack = False

                def lost_delivery():
                    raise ConnectionResetError('Synthetic acknowledgement delivery loss after commit.')
                    yield b''

                return self.server.app.response_class(lost_delivery(), status=200, mimetype='application/json')
            return actual

        self.patches = [patch.object(sprint_review, '_locked_schema', side_effect=lock_and_pause),
                        patch.object(sprint_review_routes, '_response', side_effect=response_after_commit)]
        for item in self.patches:
            item.start()

    def actor(self, options):
        authorization = (options.get('headers') or {}).get('Authorization', '')
        prefix = 'Bearer synthetic-access-'
        actor = authorization.removeprefix(prefix)
        if not authorization.startswith(prefix) or actor not in self.actors:
            raise AssertionError('Provider requires a real synthetic actor bearer token.')
        return actor

    def provider(self, method, url, **options):
        try:
            return self._provider(method, url, **options)
        except Exception:
            self.failures.append('unexpected_provider_request')
            raise

    def _provider(self, method, url, **options):
        actor = self.actor(options)
        parsed = urlsplit(url)
        if parsed.hostname not in {'api.atlassian.com', 'example.atlassian.net'}:
            raise AssertionError('Unregistered Planning provider host.')
        path = re.sub(r'^/ex/jira/synthetic-cloud', '', parsed.path)
        params = options.get('params') or options.get('json') or {}
        call = {'actor': actor, 'method': method, 'path': path}
        self.calls.append(call)
        capacity = next((issue for issue in self.capacity_issues if path == '/rest/api/3/issue/' + issue['key']), None)
        if method == 'PUT' and capacity is not None and self.capacity_put_allowed:
            body = options.get('json') or {}
            value = (body.get('fields') or {}).get(CAPACITY_FIELD) if set(body) == {'fields'} else None
            if set(body.get('fields') or {}) != {CAPACITY_FIELD} or isinstance(value, bool) \
                    or not isinstance(value, (int, float)):
                raise AssertionError('A capacity PUT writes only the numeric capacity field.')
            self.capacity_puts.append({'actor': actor, 'key': capacity['key'], 'fields': deepcopy(body['fields'])})
            capacity['fields'][CAPACITY_FIELD] = value
            return self.Response({}, 204)
        if method not in {'GET', 'POST'} or (method == 'POST' and path != '/rest/api/3/search/jql'):
            self.mutations.append({'actor': actor, 'method': method, 'path': path})
            raise AssertionError('Planning must never mutate Jira or Home.')
        if method == 'GET' and capacity is not None:
            requested = str(params.get('fields') or '').split(',')
            return self.Response({'id': capacity['id'], 'key': capacity['key'], 'fields': {
                key: deepcopy(value) for key, value in capacity['fields'].items() if key in requested}})
        if path == '/rest/api/3/myself':
            return self.Response({'accountId': actor, 'displayName': 'Synthetic ' + actor})
        if path == '/rest/api/3/issuetype':
            return self.Response(deepcopy(ISSUE_TYPES))
        if path == '/rest/api/3/field':
            return self.Response([
                {'id': SPRINT_FIELD, 'name': 'Sprint', 'schema': {'type': 'array', 'items': 'json', 'custom': 'com.pyxis.greenhopper.jira:gh-sprint'}},
                {'id': TEAM_FIELD, 'name': 'Team', 'schema': {'type': 'team'}},
                {'id': POINTS_FIELD, 'name': 'Story Points', 'schema': {'type': 'number'}},
                {'id': EPIC_FIELD, 'name': 'Epic Link', 'schema': {'type': 'any', 'custom': 'com.pyxis.greenhopper.jira:gh-epic-link'}},
            ])
        if path in {'/rest/api/3/project/SYN', '/rest/api/3/project/AUX'}:
            key = path.rsplit('/', 1)[1]
            return self.Response({'id': '700' if key == 'SYN' else '701', 'key': key, 'name': 'Synthetic ' + key})
        if path == '/rest/api/3/project/search':
            return self.Response({'values': [{'id': '700', 'key': 'SYN', 'name': 'Synthetic planning'},
                {'id': '701', 'key': 'AUX', 'name': 'Synthetic auxiliary'}],
                'startAt': 0, 'maxResults': 50, 'isLast': True, 'total': 2})
        if path == '/rest/agile/1.0/board/701/sprint':
            start = int(params.get('startAt', 0))
            rows = deepcopy(SPRINTS[start:start + 1])
            return self.Response({'values': rows, 'startAt': start, 'maxResults': 1, 'isLast': start + len(rows) >= len(SPRINTS)})
        if path == '/rest/api/3/search/jql':
            jql = str(params.get('jql', ''))
            call['jql'] = jql
            predicate = re.split(r'\s+ORDER BY\s+', jql, flags=re.I)[0]
            pool = self.capacity_issues if re.search(r'\bsummary\s*~', predicate, re.I) else self.issues
            rows = [deepcopy(issue) for issue in pool
                    if (issue['id'] != '8999' or actor == 'actor-b') and matches_jql(issue, predicate)]
            requested = params.get('fields') or []
            requested = requested.split(',') if isinstance(requested, str) else requested
            if requested and '*all' not in requested:
                for issue in rows:
                    issue['fields'] = {key: value for key, value in issue['fields'].items() if key in requested}
            digest = hashlib.sha256((actor + '\n' + jql).encode()).hexdigest()[:16]
            token = params.get('nextPageToken')
            start = 0
            if token:
                match = re.fullmatch(r'synthetic-' + digest + r'-(\d+)', token)
                if not match:
                    raise AssertionError('Invalid synthetic search page token.')
                start = int(match.group(1))
            count = min(2, int(params.get('maxResults', 100)))
            end = start + count
            body = {'issues': rows[start:end], 'isLast': end >= len(rows)}
            if not body['isLast']:
                body['nextPageToken'] = f'synthetic-{digest}-{end}'
            return self.Response(body)
        raise AssertionError('Unregistered Planning Jira endpoint.')

    def control(self, message):
        operation = message['command']
        if operation == 'planningPrepare':
            self.prepare(promoted=message.get('promoted', False))
        elif operation == 'planningInspect':
            from backend.db import models
            with self.factory() as db:
                actors = {name: {'userId': actor.user_id, 'connectionId': actor.connection_id,
                    'role': db.get(models.User, actor.user_id).account_type} for name, actor in self.actors.items()}
                return {'actors': actors, 'calls': deepcopy(self.calls), 'failures': list(self.failures),
                        'mutations': deepcopy(self.mutations), 'groupId': GROUP_ID,
                        'capacityPuts': deepcopy(self.capacity_puts),
                        'capacityTickets': {issue['key']: issue['fields'][CAPACITY_FIELD] for issue in self.capacity_issues},
                        'sourceProof': {
                            'configRevision': db.query(models.WorkspaceDashboardConfig).one().config_revision,
                            'boardCatalogVersion': db.query(models.WorkspaceSprintCatalog).one().catalog_version,
                            'teamCatalogVersions': sorted(row.catalog_version for row in db.query(models.WorkspaceSprintTeamCatalog).all()),
                            'privateViewIds': sorted(row.id for row in db.query(models.ViewConfig).all()),
                        },
                        'reviewCells': db.query(models.GroupReviewCell).count()}
        elif operation == 'planningReadOperation':
            return self.read_operation(message.get('operationId'), message.get('actor', 'actor-a'))
        elif operation == 'planningPauseSave':
            self.pause.clear()
            self.pause_entered.clear()
            self.pause_armed = True
        elif operation == 'planningReleaseSave':
            self.pause.set()
            self.pause_armed = False
        elif operation == 'planningStoryPoints':
            # Provider data only: a Story's points, so a Team can be unpointed in a Sprint. `prepare` restores them.
            issue = next((row for row in self.issues if row['id'] == str(message.get('issueId'))), None)
            points = message.get('points')
            if issue is None or isinstance(points, bool) or not isinstance(points, (int, float)):
                raise ValueError('Synthetic Story Points must be a number.')
            issue['fields'][POINTS_FIELD] = points
        elif operation == 'planningCapacityPut':
            self.capacity_put_allowed = message.get('enabled', True) is True
        elif operation == 'planningDropAck':
            self.drop_ack = True
        elif operation == 'planningSaveState':
            return {'paused': self.pause_entered.is_set() and not self.pause.is_set(),
                    'armed': self.pause_armed, 'dropAckArmed': self.drop_ack}
        else:
            raise ValueError('Unknown Planning fixture command.')
        return {'prepared': True, 'promoted': self.promoted}

    def read_operation(self, operation_id, actor):
        from backend.db import models
        model = getattr(models, 'PlanningSaveOperation', None)
        if model is None:
            return {'state': 'unsupported'}
        with self.factory() as db:
            row = db.query(model).filter_by(operation_id=operation_id,
                workspace_id=self.actors[actor].workspace_id, actor_user_id=self.actors[actor].user_id).one_or_none()
            return {'state': 'committed', 'operationId': row.operation_id} if row else {'state': 'unknown'}

    def close(self):
        self.pause.set()
        for item in reversed(self.patches):
            item.stop()
