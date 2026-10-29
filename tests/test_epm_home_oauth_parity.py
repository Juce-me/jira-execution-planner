"""Raw-boundary parity oracle for the EPM Home/Jira read path.

Task 0 of docs/plans/DONE-home-oauth-public-reads.md. It freezes TODAY's
behavior before any Home transport change, through the REAL route ->
discovery -> normalization -> exact-label -> Jira hierarchy path. Only external
I/O is stubbed: the Home GraphQL transport (`urlopen` in backend.epm.home) and
the Jira search transport (`jira_server.jira_search_request`). Every value in
tests/fixtures/epm_home_oauth_parity-example-sanitized.json is synthetic.

Runner seam for later tasks (the candidate OAuth path plugs in here):

    run_mode(mode_name, fixture=None, scenarios=None) -> ModeRun

`mode_name` selects a factory in MODE_FACTORIES. A factory returns a runner with
this small interface:

    runner.enter(stack, fixture, transports)  # isolated env/auth/config; route Home I/O to
                                              # transports.home.handle(method, url, headers, body)
    runner.install_config(config)             # save the owning user's private EPM config
    runner.get(path) -> Flask response        # real HTTP route through the Flask test client
    runner.home_email                         # identity the Home transport must be called as

`register_mode(name, factory)` adds a mode. Tasks 1-3 register the OAuth
candidate (for example "db_oauth_public_read"), then compare its ModeRun with
`compare_candidate(expected, actual, comparison)`. The Basic baseline mode uses
`compare_baseline`, which is exact. The frozen `db_user_token` expected values in the fixture are the
recorded pre-removal baseline for the candidate; that runner was removed with the API-token connection.
"""

import base64
import copy
import json
import os
import re
import socket
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from datetime import datetime as _real_datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import jira_server
from backend.auth.context import RequestAuthContext
from backend.epm import access as epm_access
from backend.epm import home as epm_home
from backend.epm import issues as epm_issues_module
from backend.epm import projects as epm_projects_module
from backend.epm import rollup as epm_rollup_module

FIXTURE_PATH = Path(__file__).resolve().parent / 'fixtures' / 'epm_home_oauth_parity-example-sanitized.json'


def load_fixture():
    with open(FIXTURE_PATH, encoding='utf-8') as handle:
        return json.load(handle)


# --------------------------------------------------------------------------
# Transport doubles (external I/O only)
# --------------------------------------------------------------------------

class UnexpectedTransportCall(AssertionError):
    """A request the synthetic fixture does not model; always recorded and fails the oracle."""


class TransportLog:
    def __init__(self):
        self.home_calls = []     # (operation, key)
        self.jira_calls = []     # dicts
        self.jira_fields = []
        self.home_emails = set()
        self.unexpected = []

    def mark(self):
        return len(self.home_calls), len(self.jira_calls)


class FakeHttpResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode('utf-8')

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return self._body


class RawHomeServer:
    """Raw Atlassian Home GraphQL replies keyed by the parsed document operation name."""

    def __init__(self, fixture, log):
        self.home = fixture['home']
        self.cloud_id = fixture['environment']['cloudId']
        self.log = log
        self.goals_by_key = {goal['key']: goal for goal in self.home['goals'].values()}
        self.generated = self.home['generated']

    # -- data helpers ------------------------------------------------------
    def _page_size(self, goal_id=None):
        for spec in self.generated.values():
            if goal_id and spec.get('goalId') == goal_id:
                return 50
        return self.home['pageSize']

    def _wide_children(self):
        spec = self.generated['wideGoal']
        for number in range(1, spec['childCount'] + 1):
            gid = f"goal-{spec['idPrefix']}{number:03d}"
            yield {
                'id': gid, 'key': f"{spec['idPrefix'].upper()}{number:03d}", 'name': f'Wide Child {number}',
                'url': f'https://example.invalid/goals/{gid}', 'isArchived': False,
                'owner': {'id': 'owner-node-acct-fixture-2', 'accountId': 'acct-fixture-2', 'name': 'Fixture Owner Two'},
            }

    def _goal_children(self, goal_id):
        spec = self.generated['wideGoal']
        if goal_id == spec['goalId']:
            return list(self._wide_children())
        return [self.home['goals'][child] for child in self.home['subGoals'].get(goal_id, [])]

    def _generated_project(self, project_id, name, state):
        return {
            'id': project_id, 'key': project_id.upper(), 'name': name,
            'url': f'https://example.invalid/projects/{project_id}',
            'state': {'label': state[1], 'value': state[0]},
            'owner': {'id': 'owner-node-acct-fixture-1', 'accountId': 'acct-fixture-1', 'name': 'Fixture Owner One'},
            'tags': {'edges': []}, 'updates': {'edges': []},
        }

    def _goal_projects(self, goal_id):
        big, wide = self.generated['bigGoal'], self.generated['wideGoal']
        if goal_id == big['goalId']:
            return [self._generated_project(f"{big['idPrefix']}{n:04d}", f'Big Project {n}', big['state'])
                    for n in range(1, big['projectCount'] + 1)]
        if goal_id == wide['goalId']:
            return [self._generated_project(f"{wide['idPrefix']}root-p", 'Wide Root Project', wide['state'])]
        if goal_id.startswith(f"goal-{wide['idPrefix']}"):
            suffix = goal_id[len(f"goal-{wide['idPrefix']}"):]
            return [self._generated_project(f"{wide['idPrefix']}{suffix}-p", f'Wide Project {suffix}', wide['state'])]
        return [self.home['projects'][pid] for pid in self.home['goalProjects'].get(goal_id, [])]

    @staticmethod
    def _page(nodes, after, size):
        offset = 0
        if after:
            match = re.fullmatch(r'cursor-(\d+)', str(after))
            if not match:
                raise UnexpectedTransportCall(f'bad cursor {after!r}')
            offset = int(match.group(1))
        window = nodes[offset:offset + size]
        end = offset + len(window)
        return {
            'pageInfo': {'hasNextPage': end < len(nodes), 'endCursor': f'cursor-{end}' if end < len(nodes) else None},
            'edges': [{'node': node} for node in window],
        }

    # -- transport entry point -------------------------------------------
    def handle(self, method, url, headers, body):
        method = str(method).upper()
        if method == 'GET' and url.endswith('/_edge/tenant_info'):
            self.log.home_calls.append(['tenant_info', ''])
            return 200, {'cloudId': self.cloud_id}
        if method == 'POST' and url == epm_home.HOME_GRAPHQL_ENDPOINT:
            self._record_identity(headers)
            return 200, self._graphql(json.loads(body))
        self.log.unexpected.append(['home', method, url])
        raise UnexpectedTransportCall(f'{method} {url}')

    def _record_identity(self, headers):
        authorization = {str(k).lower(): v for k, v in headers.items()}.get('authorization', '')
        if authorization.startswith('Basic '):
            email = base64.b64decode(authorization[6:]).decode().split(':', 1)[0]
            self.log.home_emails.add(email)

    def urlopen(self, request, timeout=None):
        """Adapter for the legacy HomeGraphQLClient / tenant_info `urlopen` calls."""
        _status, payload = self.handle(request.get_method(), request.full_url, dict(request.header_items()), request.data)
        return FakeHttpResponse(payload)

    def _graphql(self, payload):
        document = payload.get('query') or ''
        operation = payload.get('operationName')
        if not operation:
            match = re.search(r'^\s*(?:query|mutation)\s+(\w+)', document)
            operation = match.group(1) if match else ''
        variables = payload.get('variables') or {}
        if 'mutation' in document.split('{', 1)[0]:
            self.log.unexpected.append(['home', 'mutation', operation])
            raise UnexpectedTransportCall(f'mutation {operation}')
        handler = getattr(self, f'_op_{operation}', None)
        if handler is None:
            self.log.unexpected.append(['home', 'operation', operation])
            raise UnexpectedTransportCall(f'operation {operation!r}')
        return handler(variables)

    def _op_GoalsSearch(self, variables):
        self.log.home_calls.append(['GoalsSearch', variables.get('after') or ''])
        nodes = []
        for key in self.home['searchListing']:
            goal = self.goals_by_key[key]
            nodes.append({k: goal[k] for k in ('id', 'key', 'name', 'url')})
        return {'data': {'goals_search': self._page(nodes, variables.get('after'), self.home['pageSize'])}}

    def _op_GoalByKey(self, variables):
        self.log.home_calls.append(['GoalByKey', variables.get('goalKey', '')])
        goal = self.goals_by_key.get(variables.get('goalKey'))
        node = {k: goal[k] for k in ('id', 'key', 'name', 'url')} if goal else None
        return {'data': {'goals_byKey': node}}

    def _op_SubGoals(self, variables):
        goal_id = variables['goalId']
        self.log.home_calls.append(['SubGoals', f"{goal_id}@{variables.get('after') or ''}"])
        page = self._page(self._goal_children(goal_id), variables.get('after'), self._page_size(goal_id))
        return {'data': {'goals_byId': {'subGoals': page}}}

    def _op_GoalProjects(self, variables):
        goal_id = variables['goalId']
        self.log.home_calls.append(['GoalProjects', f"{goal_id}@{variables.get('after') or ''}"])
        page = self._page(self._goal_projects(goal_id), variables.get('after'), self._page_size(goal_id))
        return {'data': {'goals_byId': {'projects': page}}}


class FakeJiraResponse:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class RawJiraServer:
    """Raw Jira search replies. Dispatch is by exact asserted JQL (q1/q2/q3/issues), then by page token."""

    def __init__(self, fixture, log):
        self.issues = fixture['jira']['issues']
        self.log = log
        self.by_jql = {entry['jql']: entry for entry in fixture['jira']['replies']}
        self.generated = {entry['jql']: entry for entry in fixture['jira']['generatedReplies']}

    def search(self, payload, *, context=None, timeout=None):
        jql = payload.get('jql')
        token = payload.get('nextPageToken')
        entry = self.by_jql.get(jql) or self.generated.get(jql)
        if entry is None:
            self.log.unexpected.append(['jira', jql])
            raise UnexpectedTransportCall(f'unmodelled JQL: {jql}')
        self.log.jira_fields.append(list(payload.get('fields') or []))
        self.log.jira_calls.append({
            'reply': entry['name'], 'jql': jql,
            'maxResults': payload.get('maxResults'), 'nextPageToken': token,
        })
        if 'generated' in entry:
            return FakeJiraResponse(self._generated_page(entry['generated'], token, int(payload['maxResults'])))
        pages = entry['pages']
        if token is None:
            index = 0
        else:
            index = next((i + 1 for i, page in enumerate(pages) if page.get('nextPageToken') == token), None)
            if index is None:
                self.log.unexpected.append(['jira', 'token', token])
                raise UnexpectedTransportCall(f'unmodelled token {token!r}')
        page = pages[index]
        body = {'issues': [copy.deepcopy(self.issues[key]) for key in page['issueKeys']], 'isLast': page['isLast']}
        if page.get('nextPageToken'):
            body['nextPageToken'] = page['nextPageToken']
        return FakeJiraResponse(body)

    @staticmethod
    def _generated_page(spec, token, size):
        offset = int(token.split('-', 1)[1]) if token else 0
        end = min(offset + size, spec['count'])
        issues = []
        for number in range(offset, end):
            key = f"{spec['keyPrefix']}{number:0{spec['padWidth']}d}"
            issues.append({'id': f'8{number}', 'key': key, 'fields': {
                'summary': f'Generated story {number}', 'status': {'name': spec['status']},
                'assignee': None, 'priority': {'name': 'Medium'}, 'issuetype': {'name': spec['issueType']},
                'labels': ['trunc_label'], 'created': '2026-05-01T08:00:00.000+0000',
                'updated': '2026-06-20T08:00:00.000+0000', 'customfield_sp': 1, 'customfield_sprint': [],
                'customfield_epic': None, 'customfield_team': None,
            }})
        body = {'issues': issues, 'isLast': end >= spec['count']}
        if end < spec['count']:
            body['nextPageToken'] = f'gen-{end}'
        return body


# --------------------------------------------------------------------------
# Frozen time and cache isolation
# --------------------------------------------------------------------------

class FrozenClock:
    def __init__(self, start):
        self.value = float(start)

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


@contextmanager
def frozen_epm_time(frozen):
    """Freeze utc_now_iso, backend.epm.projects.datetime (aggregate calls filter with now=None) and TTL time."""
    clock = FrozenClock(frozen['ttlStartSeconds'])
    now_value = _real_datetime.fromisoformat(frozen['nowIso'].replace('Z', '+00:00'))

    class FrozenDatetime(_real_datetime):
        @classmethod
        def now(cls, tz=None):
            return now_value.astimezone(tz) if tz else now_value.replace(tzinfo=None)

    import time as _time
    with ExitStack() as stack:
        stack.enter_context(patch.object(jira_server, 'utc_now_iso', lambda timespec=None: frozen['nowIso']))
        stack.enter_context(patch.object(epm_projects_module, 'datetime', FrozenDatetime))
        replaced = 0
        for cls in (epm_projects_module.EpmProjectsDependencies, epm_rollup_module.EpmRollupDependencies,
                    epm_issues_module.EpmIssuesDependencies):
            init = cls.__init__
            defaults = tuple(clock if value is _time.time else value for value in init.__defaults__)
            replaced += sum(1 for value in defaults if value is clock)
            stack.enter_context(patch.object(init, '__defaults__', defaults))
        if replaced != 3:
            raise AssertionError('TTL time.time default was not found on all three EPM dependency classes')
        yield clock


KNOWN_EPM_CACHES = {
    ('jira_server', 'EPM_PROJECTS_CACHE'), ('jira_server', 'EPM_ISSUES_CACHE'), ('jira_server', 'EPM_ROLLUP_CACHE'),
    ('backend.epm.home', '_CLOUD_ID_CACHE'), ('backend.epm.home', '_GOAL_BY_KEY_CACHE'),
    ('backend.epm.home', '_STRICT_GOAL_LOOKUP_CACHE'), ('backend.epm.access', '_ACCESS_CACHE'),
}


def reset_epm_caches():
    jira_server.EPM_PROJECTS_CACHE.clear()
    jira_server.EPM_ISSUES_CACHE.clear()
    jira_server.EPM_ROLLUP_CACHE.clear()
    epm_home._CLOUD_ID_CACHE.clear()
    epm_home._GOAL_BY_KEY_CACHE.clear()
    epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
    epm_access._ACCESS_CACHE.clear()


# --------------------------------------------------------------------------
# Mode runners
# --------------------------------------------------------------------------

class BasicModeRunner:
    """Today's Basic/JSON path: dashboard-config.json EPM config, ATLASSIAN_EMAIL/TOKEN Home credentials."""
    name = 'basic_json'

    def enter(self, stack, fixture, transports):
        env = fixture['environment']
        self.home_email = env['basicHomeEmail']
        tmpdir = stack.enter_context(tempfile.TemporaryDirectory())
        self.config_path = os.path.join(tmpdir, 'dashboard-config.json')
        stack.enter_context(patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'jsonfile', 'JIRA_AUTH_MODE': 'basic', 'JIRA_URL': env['jiraUrl'],
            'ATLASSIAN_EMAIL': self.home_email, 'ATLASSIAN_API_TOKEN': 'basic-token-fixture',
        }, clear=False))
        stack.enter_context(patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'))
        stack.enter_context(patch.object(jira_server, 'JIRA_URL', env['jiraUrl']))
        stack.enter_context(patch.object(jira_server, 'DASHBOARD_CONFIG_PATH', self.config_path))
        stack.enter_context(patch.object(epm_home, 'urlopen', transports.home.urlopen))
        self.client = jira_server.app.test_client()

    def install_config(self, config):
        with open(self.config_path, 'w', encoding='utf-8') as handle:
            json.dump({'epm': config}, handle)

    def get(self, path):
        return self.client.get(path)


HOME_READ_SCOPES = ('read:goal:goals', 'read:access:goals', 'read:project:projects', 'read:access:projects')


class FakeOAuthHttpResponse(FakeHttpResponse):
    status = 200


def _strip_identity_fields(value):
    """Emulate the public documents' projection: they never select owner or creator."""
    if isinstance(value, dict):
        return {k: _strip_identity_fields(v) for k, v in value.items() if k not in ('owner', 'creator')}
    if isinstance(value, list):
        return [_strip_identity_fields(v) for v in value]
    return value


class DbOAuthPublicReadRunner:
    """Candidate: DB OAuth browser session whose provider grant has the four Home read scopes, NO Home API token.

    Home I/O goes to the fixed OAuth endpoint with a Bearer token; the raw Home server answers by operation name
    and the adapter drops owner/creator like the real public documents. A request to any other Home endpoint,
    or with Basic credentials, is recorded as unexpected.
    """
    name = 'db_oauth_public_read'

    def enter(self, stack, fixture, transports):
        from tests import test_db_oauth_cutover as cutover
        from backend.db import models

        self.home_email = ''
        helper = cutover.DbOauthCutoverTests('test_callback_writes_encrypted_db_tokens_and_returns_session_metadata')
        helper.setUp()
        stack.callback(helper.tearDown)
        self.helper = helper
        callback = helper._store_callback_through_route(client=helper.client)
        stack.enter_context(helper._db_route_mode())
        with helper.factory() as session:
            connection = session.get(models.AuthConnection, callback.connection_id)
            connection.scopes = sorted(set(connection.scopes or []) | set(HOME_READ_SCOPES))
            connection.scope_provenance = 'provider'
            session.commit()
            self.context = RequestAuthContext(
                auth_mode='atlassian_oauth', user_id=connection.user_id,
                stable_subject='account-123', atlassian_account_id='account-123',
                workspace_id=connection.workspace_id, auth_connection_id=connection.id,
                cloud_id=connection.cloud_id, site_url='https://example.atlassian.net',
                token_version=str(connection.token_version), account_status='active', is_admin=False,
            )
        self.transports = transports
        from backend.services.user_view_config import set_user_epm_view_enabled
        set_user_epm_view_enabled(self.context, True, database_url=helper.database_url)

        def urlopen(request, timeout=None):
            headers = {str(k).lower(): v for k, v in request.header_items()}
            url, method = request.full_url, request.get_method()
            if url != epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT or not headers.get('authorization', '').startswith('Bearer '):
                transports.log.unexpected.append(['home', method, url])
                raise UnexpectedTransportCall(f'{method} {url}')
            _status, payload = transports.home.handle(method, epm_home.HOME_GRAPHQL_ENDPOINT, {}, request.data)
            return FakeOAuthHttpResponse(_strip_identity_fields(payload))

        stack.enter_context(patch.object(epm_home, 'urlopen', urlopen))
        self.client = helper.client

    def install_config(self, config):
        from backend.services.user_view_config import save_user_epm_config
        save_user_epm_config(self.context, config)

    def get(self, path):
        return self.client.get(path)


MODE_FACTORIES = {
    BasicModeRunner.name: BasicModeRunner,
    DbOAuthPublicReadRunner.name: DbOAuthPublicReadRunner,
}


def register_mode(name, factory):
    """Tasks 1-3 register the OAuth candidate runner here."""
    MODE_FACTORIES[name] = factory


# --------------------------------------------------------------------------
# Scenario execution
# --------------------------------------------------------------------------

def summarize_body(body):
    """Compact, order-preserving digest for deliberately large replies (caps / truncation)."""
    def ident(item):
        return (item.get('id') or item.get('key')) if isinstance(item, dict) else item

    summary = {}
    for key, value in body.items():
        if isinstance(value, list):
            summary[key] = {'len': len(value), 'first': ident(value[0]) if value else None,
                            'last': ident(value[-1]) if value else None}
        elif isinstance(value, dict) and key == 'project':
            summary[key] = {'id': value.get('id'), 'label': value.get('label')}
        elif isinstance(value, dict):
            summary[key] = {'keys': len(value)}
        else:
            summary[key] = value
    return summary


class ModeRun:
    def __init__(self, mode, results, home_emails):
        self.mode = mode
        self.results = results          # scenario name -> result dict
        self.home_emails = home_emails  # identities the Home transport was called as


def _step_result(runner, scenario, step, log, comparison, clock):
    if not scenario.get('sharedCache'):
        reset_epm_caches()
    if step.get('advanceClock'):
        clock.advance(step['advanceClock'])
    home_before, jira_before = log.mark()
    try:
        response = runner.get(step['get'])
        status, body = response.status_code, response.get_json(silent=True)
    except Exception as exc:  # noqa: BLE001 - recorded as part of the oracle
        status, body = 'exception', {'exception': type(exc).__name__}
    if isinstance(body, dict):
        # Per-project server timings are volatile diagnostics (like the Server-Timing header, which the oracle never
        # records); the oracle freezes the data contract only.
        body = {key: value for key, value in body.items() if key != 'projectTimings'}
    if scenario.get('summarize') and isinstance(body, dict):
        body = summarize_body(body)
    home_calls = [list(call) for call in log.home_calls[home_before:]]
    jira_calls = [dict(call) for call in log.jira_calls[jira_before:]]
    if 'rollup/all' in step['get']:
        jira_calls.sort(key=lambda call: (call['jql'], call['nextPageToken'] or ''))
    kinds = {}
    for operation, _key in home_calls:
        kind = comparison['homeOperationKinds'][operation]
        kinds[kind] = kinds.get(kind, 0) + 1
    fields = []
    for entry in log.jira_fields[jira_before:]:
        if entry not in fields:
            fields.append(entry)
    return {
        'path': step['get'], 'status': status, 'body': body,
        'home': {'kinds': dict(sorted(kinds.items())), 'calls': home_calls if not scenario.get('summarize') else []},
        'jira': {'calls': jira_calls, 'fields': sorted(fields)},
    }


def settle_epm_workers(timeout=10):
    """A failed aggregate returns without waiting for already-running workers; let them finish before teardown."""
    import threading
    for thread in list(threading.enumerate()):
        if thread.name.startswith('ThreadPoolExecutor') and thread is not threading.current_thread():
            thread.join(timeout)


def run_mode(mode_name, fixture=None, scenarios=None):
    fixture = fixture if fixture is not None else load_fixture()
    wanted = set(scenarios) if scenarios else None
    comparison = fixture['comparison']
    env = fixture['environment']
    log = TransportLog()
    transports = SimpleNamespace(home=RawHomeServer(fixture, log), jira=RawJiraServer(fixture, log), log=log)
    results = {}

    def no_network(*_args, **_kwargs):
        raise AssertionError('real socket use is forbidden in the parity oracle')

    with ExitStack() as stack:
        stack.enter_context(patch.object(socket.socket, 'connect', no_network))
        clock = stack.enter_context(frozen_epm_time(fixture['frozen']))
        ids = env['fieldIds']
        stack.enter_context(patch.object(jira_server, 'JQL_QUERY', env['baseJql']))
        stack.enter_context(patch.object(jira_server, 'get_sprint_field_id', lambda: ids['sprint']))
        stack.enter_context(patch.object(jira_server, 'get_story_points_field_id', lambda: ids['storyPoints']))
        stack.enter_context(patch.object(jira_server, 'get_team_field_id', lambda: ids['team']))
        stack.enter_context(patch.object(
            jira_server, 'resolve_epic_link_field_id', lambda headers, names_map=None, context=None, **_strict: ids['epicLink']))
        stack.enter_context(patch.object(jira_server, 'jira_search_request', transports.jira.search))
        reset_epm_caches()
        stack.callback(reset_epm_caches)
        runner = MODE_FACTORIES[mode_name]()
        runner.enter(stack, fixture, transports)
        stack.callback(settle_epm_workers)  # runs before the runner's teardown (LIFO)
        for scenario in fixture['scenarios']:
            if wanted is not None and scenario['name'] not in wanted:
                continue
            reset_epm_caches()
            del log.home_calls[:], log.jira_calls[:], log.jira_fields[:], log.unexpected[:]
            runner.install_config(fixture['configs'][scenario['config']])
            steps = [_step_result(runner, scenario, step, log, comparison, clock) for step in scenario['steps']]
            results[scenario['name']] = {'steps': steps, 'unexpected': [list(item) for item in log.unexpected]}
        return ModeRun(mode_name, results, set(log.home_emails))


# --------------------------------------------------------------------------
# Comparison
# --------------------------------------------------------------------------

def diff_values(expected, actual, path='$', rules=None, in_goals=False):
    """Exact structural diff. `rules` (candidate comparison only) names the sole allowed omissions."""
    rules = rules or {}
    mismatches = []
    if isinstance(expected, dict) and isinstance(actual, dict):
        is_project = 'homeProjectId' in expected
        for key in sorted(set(expected) | set(actual)):
            if key not in actual:
                if (is_project and key in rules.get('projectIdentityKeys', ())) or \
                        (in_goals and key in rules.get('goalNodeOptionalKeys', ())):
                    continue
                mismatches.append(f'{path}.{key}: missing in actual')
            elif key not in expected:
                mismatches.append(f'{path}.{key}: unexpected key in actual')
            else:
                if is_project and key in rules.get('projectIdentityKeys', ()) and actual[key] in ('', None):
                    continue
                mismatches.extend(diff_values(expected[key], actual[key], f'{path}.{key}', rules, in_goals))
        return mismatches
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return [f'{path}: length {len(expected)} != {len(actual)}']
        for index, (left, right) in enumerate(zip(expected, actual)):
            mismatches.extend(diff_values(left, right, f'{path}[{index}]', rules, in_goals))
        return mismatches
    if type(expected) is not type(actual) or expected != actual:
        return [f'{path}: {expected!r} != {actual!r}']
    return []


def compare_baseline(expected, actual):
    """Exact comparison for the modes that exist today. Returns mismatch strings; empty means identical."""
    return diff_values(expected, actual)


def compare_candidate(expected, actual, comparison):
    """Candidate comparison with only the enumerated allowances; returns mismatch strings.

    Allowed: the four project identity keys and goal-node `owner` may be omitted/empty; the fixture's
    transportBodyFields/enablementFields may differ or be added at the top level of a body; Home call kinds in
    exemptHomeCallKinds may differ and the ordered Home operation list is not compared. Everything else
    (Jira people, entities, labels, order, status, links, update content/date, totals, Jira JQL/pages) is exact.
    """
    rules = {
        'projectIdentityKeys': set(comparison['projectIdentityKeys']),
        'goalNodeOptionalKeys': set(comparison['goalNodeOptionalKeys']),
    }
    transport = set(comparison['transportBodyFields']) | set(comparison['enablementFields'])
    exempt = set(comparison['exemptHomeCallKinds'])
    mismatches = []
    if len(expected['steps']) != len(actual['steps']):
        return [f'steps: {len(expected["steps"])} != {len(actual["steps"])}']
    mismatches.extend(diff_values(expected['unexpected'], actual['unexpected'], '$.unexpected'))
    for index, (left, right) in enumerate(zip(expected['steps'], actual['steps'])):
        prefix = f'$.steps[{index}]'
        mismatches.extend(diff_values(left['status'], right['status'], f'{prefix}.status'))
        body_left, body_right = left['body'], right['body']
        if isinstance(body_left, dict) and isinstance(body_right, dict):
            body_left = {k: v for k, v in body_left.items() if k not in transport}
            body_right = {k: v for k, v in body_right.items() if k not in transport}
        goals_body = isinstance(body_left, dict) and 'goals' in body_left
        for key in sorted(set(body_left or {}) | set(body_right or {})) if isinstance(body_left, dict) and isinstance(body_right, dict) else []:
            if key not in body_left or key not in body_right:
                mismatches.append(f'{prefix}.body.{key}: present on one side only')
                continue
            mismatches.extend(diff_values(
                body_left[key], body_right[key], f'{prefix}.body.{key}', rules, in_goals=goals_body and key == 'goals'))
        if not (isinstance(body_left, dict) and isinstance(body_right, dict)):
            mismatches.extend(diff_values(body_left, body_right, f'{prefix}.body'))
        kinds_left = {k: v for k, v in left['home']['kinds'].items() if k not in exempt}
        kinds_right = {k: v for k, v in right['home']['kinds'].items() if k not in exempt}
        mismatches.extend(diff_values(kinds_left, kinds_right, f'{prefix}.home.kinds'))
        mismatches.extend(diff_values(left['jira'], right['jira'], f'{prefix}.jira'))
    return mismatches


def split_home(results):
    """Split a ModeRun's results into the mode-independent core and the per-mode Home call logs."""
    core, home = {}, {}
    for name, result in results.items():
        core[name] = {**result, 'steps': [{k: v for k, v in step.items() if k != 'home'} for step in result['steps']]}
        home[name] = [step['home'] for step in result['steps']]
    return core, home


def assemble_expected(fixture, mode_name):
    """Expected results for one mode: the shared core (status/body/Jira) plus that mode's Home call log."""
    expected = {}
    for name, result in fixture['expected'].items():
        homes = fixture['expectedHome'][mode_name][name]
        expected[name] = {**result, 'steps': [{**step, 'home': home} for step, home in zip(result['steps'], homes)]}
    return expected


def compare_run(expected_by_scenario, run, comparison, comparer):
    """Return {scenario: [mismatches]} for every scenario in `run`; scenarios missing from expected are failures."""
    outcome = {}
    for name, actual in run.results.items():
        if name not in expected_by_scenario:
            outcome[name] = ['no expected entry in the fixture']
        elif comparer is compare_candidate:
            outcome[name] = comparer(expected_by_scenario[name], actual, comparison)
        else:
            outcome[name] = comparer(expected_by_scenario[name], actual)
    return outcome


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------

def _count_hierarchy_issues(body):
    keys = set()
    for initiative in (body.get('initiatives') or {}).values():
        keys.add(initiative['issue']['key'])
        for epic in initiative['epics'].values():
            keys.add(epic['issue']['key'])
            keys.update(story['key'] for story in epic['stories'])
        keys.update(story['key'] for story in initiative['looseStories'])
    for epic in (body.get('rootEpics') or {}).values():
        keys.add(epic['issue']['key'])
        keys.update(story['key'] for story in epic['stories'])
    keys.update(story['key'] for story in body.get('orphanStories') or [])
    return keys


class FixtureIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = load_fixture()

    def test_expected_covers_every_scenario_and_is_non_empty(self):
        names = [scenario['name'] for scenario in self.fixture['scenarios']]
        self.assertEqual(sorted(names), sorted(self.fixture['expected']))
        for mode_name in ('basic_json', 'db_user_token'):
            self.assertEqual(sorted(names), sorted(self.fixture['expectedHome'][mode_name]))
        expected = self.fixture['expected']
        alpha = expected['rollup_alpha_s101']['steps'][0]['body']
        self.assertGreaterEqual(len(_count_hierarchy_issues(alpha)), 8)
        self.assertTrue(expected['projects_active']['steps'][0]['body']['projects'])
        self.assertTrue(expected['goals_catalog']['steps'][0]['body']['goals'])

    def test_fixture_is_synthetic(self):
        text = json.dumps(self.fixture)
        self.assertNotRegex(text, r'[A-Za-z0-9._%+-]+@(?!example\.invalid)[A-Za-z0-9.-]+\.[a-z]{2,}')
        for host in set(re.findall(r'https?://([^/"\s]+)', text)):
            self.assertIn(host, {'example.invalid', 'example.atlassian.net'})
        env = self.fixture['environment']
        self.assertTrue(env['basicHomeEmail'].endswith('@example.invalid'))
        self.assertTrue(env['dbHomeEmail'].endswith('@example.invalid'))

    def test_jira_replies_assert_q1_q2_q3_predicates(self):
        base = self.fixture['environment']['baseJql']
        self.assertEqual(base, 'project = SYNTH ORDER BY created DESC')
        prefix, suffix = 'project = SYNTH AND ', ' ORDER BY created DESC'
        for entry in self.fixture['jira']['replies'] + self.fixture['jira']['generatedReplies']:
            jql, name = entry['jql'], entry['name']
            self.assertTrue(jql.startswith(prefix) and jql.endswith(suffix), name)
            clause = jql[len(prefix):-len(suffix)]
            if '-q1' in name:
                self.assertRegex(clause, r'^labels = "[a-z_]+"$', name)
            elif '-q2' in name or '-q3' in name:
                match = re.fullmatch(r'\("Epic Link" in \(([^)]*)\) OR parent in \(([^)]*)\)\)( AND Sprint = (\d+))?', clause)
                self.assertIsNotNone(match, name)
                self.assertEqual(match.group(1), match.group(2), name)
                if '-q3' in name:
                    self.assertIsNotNone(match.group(4), f'{name}: q3 always carries the sprint clause')
                if '-backlog' in name or '-archived' in name:
                    self.assertIsNone(match.group(4), name)
            elif name.startswith('issues-'):
                self.assertRegex(clause, r'^\(labels in \("[a-z_]+"\)\)( AND Sprint = \d+)?$', name)
            for issue_key in [k for page in entry.get('pages', []) for k in page['issueKeys']]:
                self.assertIn(issue_key, self.fixture['jira']['issues'], name)
        self.assertEqual(len({e['jql'] for e in self.fixture['jira']['replies']}), len(self.fixture['jira']['replies']))

    def test_every_epm_cache_is_reset_between_runs(self):
        import importlib
        import pkgutil
        import backend.epm as epm_package
        found = set()
        modules = [jira_server] + [importlib.import_module(f'backend.epm.{m.name}') for m in pkgutil.iter_modules(epm_package.__path__)]
        for module in modules:
            for name, value in vars(module).items():
                if 'CACHE' in name.upper() and isinstance(value, dict) and (
                        module.__name__ != 'jira_server' or name.startswith('EPM_')):
                    found.add((module.__name__, name))
        self.assertEqual(found, KNOWN_EPM_CACHES)

    def test_frozen_ttl_clock_replaces_all_three_dependency_defaults(self):
        with frozen_epm_time(self.fixture['frozen']) as clock:
            self.assertEqual(epm_projects_module.EpmProjectsDependencies.__init__.__defaults__[-1], clock)
            self.assertEqual(epm_rollup_module.EpmRollupDependencies.__init__.__defaults__[-1], clock)
            self.assertIn(clock, epm_issues_module.EpmIssuesDependencies.__init__.__defaults__)
            self.assertEqual(clock(), self.fixture['frozen']['ttlStartSeconds'])
            self.assertEqual(epm_projects_module.datetime.now(epm_projects_module.timezone.utc).date().isoformat(),
                             self.fixture['frozen']['nowIso'][:10])
        self.assertNotEqual(epm_projects_module.EpmProjectsDependencies.__init__.__defaults__[-1], clock)


class _ModeOracleMixin:
    mode_name = None
    mode_run = None

    @classmethod
    def setUpClass(cls):
        cls.fixture = load_fixture()
        cls.mode_run = run_mode(cls.mode_name, cls.fixture)

    def test_home_transport_used_the_modes_identity(self):
        runner_email = self.fixture['environment'][self.home_email_key]
        self.assertEqual(self.mode_run.home_emails, {runner_email})

    def test_scenarios_match_frozen_expected_exactly(self):
        outcome = compare_run(assemble_expected(self.fixture, self.mode_name), self.mode_run,
                              self.fixture['comparison'], compare_baseline)
        self.assertEqual(set(outcome), {s['name'] for s in self.fixture['scenarios']})
        for name, mismatches in outcome.items():
            with self.subTest(scenario=name):
                self.assertEqual(mismatches[:8], [])

    def test_no_unmodelled_transport_calls_anywhere(self):
        for name, result in self.mode_run.results.items():
            with self.subTest(scenario=name):
                self.assertEqual(result['unexpected'], [])
                for step in result['steps']:
                    self.assertNotEqual(step['status'], 'exception', step['body'])

    def test_scenario_call_contracts(self):
        by_name = {s['name']: s for s in self.fixture['scenarios']}
        for name, result in self.mode_run.results.items():
            scenario = by_name[name]
            if scenario.get('expectZeroHomeCalls'):
                with self.subTest(scenario=name, contract='zero Home calls'):
                    self.assertEqual([c for step in result['steps'] for c in step['home']['calls']], [])
            if scenario.get('expectZeroJiraCalls'):
                with self.subTest(scenario=name, contract='zero Jira calls'):
                    self.assertEqual([c for step in result['steps'] for c in step['jira']['calls']], [])

    def test_aggregate_archived_and_metadata_only_make_zero_jira_calls_but_direct_archived_queries(self):
        aggregate = self.mode_run.results['rollup_all_archived_zero_jira']['steps'][0]
        self.assertEqual(aggregate['jira']['calls'], [])
        archived_ids = [entry['project']['id'] for entry in aggregate['body']['projects']]
        # Home traversal order: SUB-1's descendants first (008, 009, 013, 014), then SUB-2's own projects (006, 007).
        self.assertEqual(archived_ids, ['proj-008', 'proj-009', 'proj-013', 'proj-014', 'proj-006', 'proj-007'])
        self.assertTrue(all(entry['rollup']['metadataOnly'] for entry in aggregate['body']['projects']))
        direct = self.mode_run.results['rollup_eta_archived_direct']['steps'][0]
        self.assertEqual([c['reply'] for c in direct['jira']['calls']], ['eta-q1', 'eta-q2-archived'])
        self.assertEqual(self.mode_run.results['issues_eta_archived_direct']['steps'][0]['jira']['calls'][0]['reply'],
                         'issues-eta-archived')
        active = self.mode_run.results['rollup_all_active_s101']['steps'][0]
        by_id = {entry['project']['id']: entry for entry in active['body']['projects']}
        for project_id in ('proj-010', 'proj-011', 'custom-blank', 'proj-gone'):
            self.assertTrue(by_id[project_id]['rollup']['metadataOnly'], project_id)

    def test_sprint_filters_leaf_stories_only_and_parent_discovery_is_sprint_independent(self):
        s101 = self.mode_run.results['rollup_alpha_s101']['steps'][0]['body']
        s102 = self.mode_run.results['rollup_alpha_s102_leaf_filter']['steps'][0]['body']
        parents = lambda body: (sorted(body['initiatives']), sorted(body['initiatives']['TEST-1']['epics']), sorted(body['rootEpics']))
        self.assertEqual(parents(s101), parents(s102))
        self.assertEqual({s['key'] for s in s101['orphanStories']}, {'TEST-9'})
        self.assertEqual({s['key'] for s in s102['orphanStories']}, {'TEST-10'})
        s102_calls = self.mode_run.results['rollup_alpha_s102_leaf_filter']['steps'][0]['jira']['calls']
        self.assertEqual([c['reply'] for c in s102_calls], ['alpha-q1', 'alpha-q1', 'alpha-q2', 'alpha-q3-s102'])
        self.assertEqual([c['nextPageToken'] for c in s102_calls][:2], [None, 'tok-alpha-q1-p2'])

    def test_exact_labels_manual_precedence_and_no_wildcard_label_queries(self):
        used = {c['jql'] for result in self.mode_run.results.values() for step in result['steps'] for c in step['jira']['calls']}
        self.assertFalse([jql for jql in used if '*' in jql or 'rnd_project_delta' in jql or 'rnd_project_l1' in jql])
        self.assertIn('project = SYNTH AND labels = "manual_delta" ORDER BY created DESC', used)
        self.assertIn('project = SYNTH AND labels = "custom_exact_label" ORDER BY created DESC', used)

    def test_home_relay_caps_order_and_truncation(self):
        projects = self.mode_run.results['caps_home_500_projects']['steps'][0]
        self.assertEqual(projects['body']['homeProjectCount'], epm_home.HOME_MAX_PROJECTS_PER_GOAL)
        self.assertTrue(projects['body']['possiblyTruncated'])
        self.assertEqual(projects['body']['projects']['first'], 'big-0001')
        self.assertEqual(projects['body']['projects']['last'], 'big-0500')
        self.assertEqual(projects['home']['kinds']['project_page'], 10)
        goals = self.mode_run.results['caps_home_100_goals']['steps'][0]
        self.assertEqual(goals['home']['kinds']['project_page'], epm_home.HOME_MAX_PROJECT_GOALS_PER_SCOPE)
        self.assertEqual(goals['body']['homeProjectCount'], epm_home.HOME_MAX_PROJECT_GOALS_PER_SCOPE)
        truncation = self.mode_run.results['jira_2000_truncation_pagination']['steps'][0]
        self.assertTrue(truncation['body']['truncated'])
        self.assertEqual(truncation['body']['truncatedQueries'], {'len': 1, 'first': 'q1', 'last': 'q1'})
        self.assertEqual(truncation['body']['orphanStories']['len'], 2000)
        self.assertEqual(len(truncation['jira']['calls']), 21)
        self.assertEqual([c['maxResults'] for c in truncation['jira']['calls']][-2:], [100, 1])


class BasicModeOracleTests(_ModeOracleMixin, unittest.TestCase):
    mode_name = 'basic_json'
    home_email_key = 'basicHomeEmail'


class OracleCanFailTests(unittest.TestCase):
    """Meta-tests: the oracle must reject empty hierarchies, wrong labels and broad normalization."""

    @classmethod
    def setUpClass(cls):
        cls.fixture = load_fixture()
        cls.comparison = cls.fixture['comparison']
        cls.expected = assemble_expected(cls.fixture, 'basic_json')

    def _run_basic(self, fixture, names):
        return run_mode('basic_json', fixture, names)

    def test_empty_jira_hierarchy_fails_the_oracle(self):
        mutated = copy.deepcopy(self.fixture)
        for entry in mutated['jira']['replies']:
            for page in entry['pages']:
                page['issueKeys'] = []
        names = ['rollup_alpha_s101', 'rollup_all_active_s101', 'issues_alpha_s101']
        outcome = compare_run(self.expected, self._run_basic(mutated, names), self.comparison, compare_baseline)
        for name in names:
            self.assertTrue(outcome[name], f'{name}: an empty Jira hierarchy must not pass')
        self.assertTrue(any('emptyRollup' in m or 'length' in m for m in outcome['rollup_alpha_s101']))
        candidate = compare_run(self.expected, self._run_basic(mutated, names), self.comparison, compare_candidate)
        for name in names:
            self.assertTrue(candidate[name], f'{name}: the candidate comparison must also fail')

    def test_changed_exact_label_fails_the_oracle(self):
        mutated = copy.deepcopy(self.fixture)
        tags = mutated['home']['projects']['proj-001']['tags']['edges']
        tags[0]['node']['name'] = 'rnd_project_alphb'
        names = ['rollup_alpha_s101', 'projects_active']
        run = self._run_basic(mutated, names)
        self.assertTrue(run.results['rollup_alpha_s101']['unexpected'], 'wrong label must reach an unmodelled JQL')
        outcome = compare_run(self.expected, run, self.comparison, compare_baseline)
        self.assertTrue(outcome['rollup_alpha_s101'])
        self.assertTrue(outcome['projects_active'])
        self.assertTrue(compare_run(self.expected, run, self.comparison, compare_candidate)['rollup_alpha_s101'])

    def test_wrong_manual_label_row_fails_the_oracle(self):
        mutated = copy.deepcopy(self.fixture)
        mutated['configs']['main']['projects']['custom-1']['label'] = 'custom_exact_labeL'
        run = self._run_basic(mutated, ['rollup_custom_row_zero_home'])
        self.assertTrue(run.results['rollup_custom_row_zero_home']['unexpected'])
        self.assertTrue(compare_run(self.expected, run, self.comparison, compare_baseline)['rollup_custom_row_zero_home'])

    def _scenario(self, name='rollup_all_active_s101'):
        return copy.deepcopy(self.expected[name])

    def test_candidate_comparison_accepts_the_baseline_and_only_the_enumerated_omissions(self):
        baseline = self._scenario()
        self.assertEqual(compare_candidate(baseline, copy.deepcopy(baseline), self.comparison), [])
        candidate = copy.deepcopy(baseline)
        for entry in candidate['steps'][0]['body']['projects']:
            for key in self.comparison['projectIdentityKeys']:
                entry['project'].pop(key, None)
        self.assertEqual(compare_candidate(baseline, candidate, self.comparison), [])
        emptied = copy.deepcopy(baseline)
        for entry in emptied['steps'][0]['body']['projects']:
            for key in self.comparison['projectIdentityKeys']:
                entry['project'][key] = ''
        self.assertEqual(compare_candidate(baseline, emptied, self.comparison), [])
        self.assertTrue(compare_baseline(baseline, candidate), 'the baseline comparison must stay exact')

    def test_candidate_comparison_accepts_goal_owner_omission_and_transport_fields_only(self):
        goals = self._scenario('goals_root_subgoals')
        stripped = copy.deepcopy(goals)
        for node in stripped['steps'][0]['body']['goals']:
            node.pop('owner')
        self.assertEqual(compare_candidate(goals, stripped, self.comparison), [])
        projects = self._scenario('projects_active')
        changed = copy.deepcopy(projects)
        changed['steps'][0]['body']['cacheHit'] = True
        changed['steps'][0]['body']['epmHomeReadAvailable'] = True
        self.assertEqual(compare_candidate(projects, changed, self.comparison), [])

    def test_candidate_comparison_never_normalizes_anything_else(self):
        def mutate_rollup(fn, name='rollup_alpha_s101'):
            baseline = self._scenario(name)
            candidate = copy.deepcopy(baseline)
            fn(candidate['steps'][0]['body'])
            return compare_candidate(baseline, candidate, self.comparison)

        def story(body):
            return body['initiatives']['TEST-1']['epics']['TEST-2']['stories']

        cases = {
            'jira assignee': lambda b: story(b)[0].__setitem__('assignee', 'Someone Else'),
            'story points': lambda b: story(b)[0].__setitem__('storyPoints', 99),
            'null story points to zero': lambda b: b['rootEpics']['TEST-5']['stories'][0].__setitem__('storyPoints', 0),
            'status': lambda b: story(b)[0].__setitem__('status', 'Done'),
            'story order': lambda b: story(b).reverse(),
            'story removed': lambda b: story(b).pop(),
            'orphan removed': lambda b: b['orphanStories'].clear(),
            'label': lambda b: b['project'].__setitem__('label', 'rnd_project_alphb'),
            'project name': lambda b: b['project'].__setitem__('name', 'Other'),
            'update date': lambda b: b['project'].__setitem__('latestUpdateDate', '2026-06-24'),
            'update snippet': lambda b: b['project'].__setitem__('latestUpdateSnippet', 'changed'),
            'update html': lambda b: b['project'].__setitem__('latestUpdateHtml', '<p>changed</p>'),
            'update url': lambda b: b['project'].__setitem__('latestUpdateUrl', 'https://example.invalid/x'),
            'home url': lambda b: b['project'].__setitem__('homeUrl', 'https://example.invalid/x'),
            'tags': lambda b: b['project'].__setitem__('homeTags', []),
            'owner changed to a different non-empty value': lambda b: b['project'].__setitem__('ownerName', 'Not The Owner'),
            'truncated flag': lambda b: b.__setitem__('truncated', True),
            'sprint list': lambda b: story(b)[0].__setitem__('sprint', []),
        }
        for label, mutate in cases.items():
            with self.subTest(change=label):
                self.assertTrue(mutate_rollup(mutate), f'{label} must not be normalized away')

        projects = self._scenario('projects_active')
        reordered = copy.deepcopy(projects)
        reordered['steps'][0]['body']['projects'].reverse()
        self.assertTrue(compare_candidate(projects, reordered, self.comparison), 'project order is never normalized')
        dropped = copy.deepcopy(projects)
        dropped['steps'][0]['body']['projects'][0].pop('name')
        self.assertTrue(compare_candidate(projects, dropped, self.comparison), 'non-identity project keys stay required')
        memberships = copy.deepcopy(projects)
        memberships['steps'][0]['body']['projects'][1]['subGoalKeys'] = ['SUB-1']
        self.assertTrue(compare_candidate(projects, memberships, self.comparison), 'goal memberships stay exact')
        goals = self._scenario('goals_root_subgoals')
        renamed = copy.deepcopy(goals)
        renamed['steps'][0]['body']['goals'][0]['name'] = 'Renamed'
        self.assertTrue(compare_candidate(goals, renamed, self.comparison))
        goal_removed = copy.deepcopy(goals)
        goal_removed['steps'][0]['body']['goals'].pop()
        self.assertTrue(compare_candidate(goals, goal_removed, self.comparison))

    def test_candidate_comparison_checks_jira_calls_zero_call_contracts_and_enrichment_calls(self):
        baseline = self._scenario('rollup_all_archived_zero_jira')
        extra_jira = copy.deepcopy(baseline)
        extra_jira['steps'][0]['jira']['calls'].append({'reply': 'x', 'jql': 'x', 'maxResults': 1, 'nextPageToken': None})
        self.assertTrue(compare_candidate(baseline, extra_jira, self.comparison))
        projects = self._scenario('projects_active')
        enrichment = copy.deepcopy(projects)
        enrichment['steps'][0]['home']['kinds']['per_project_enrichment'] = 1
        self.assertTrue(compare_candidate(projects, enrichment, self.comparison))
        site = copy.deepcopy(projects)
        site['steps'][0]['home']['kinds']['site_detection'] = 0
        self.assertEqual(compare_candidate(projects, site, self.comparison), [])
        pages = copy.deepcopy(projects)
        pages['steps'][0]['home']['kinds']['project_page'] += 1
        self.assertTrue(compare_candidate(projects, pages, self.comparison))


class DbOAuthPublicReadCandidateTests(unittest.TestCase):
    """Task 2 candidate: the DB OAuth public-read-v1 path through compare_candidate, all 35 scenarios.

    Expected Home call logs come from the DB user-token baseline; only the enumerated normalization applies
    (four identity keys, goal-node owner, transport and enablement fields, site detection kind).
    """

    @classmethod
    def setUpClass(cls):
        cls.fixture = load_fixture()
        cls.mode_run = run_mode('db_oauth_public_read', cls.fixture)

    def test_every_scenario_matches_the_frozen_expected_through_the_candidate_comparer(self):
        outcome = compare_run(assemble_expected(self.fixture, 'db_user_token'), self.mode_run,
                              self.fixture['comparison'], compare_candidate)
        self.assertEqual(set(outcome), {s['name'] for s in self.fixture['scenarios']})
        for name, mismatches in outcome.items():
            with self.subTest(scenario=name):
                self.assertEqual(mismatches[:8], [])

    def test_no_unmodelled_calls_exceptions_tenant_detection_or_basic_identity(self):
        for name, result in self.mode_run.results.items():
            with self.subTest(scenario=name):
                self.assertEqual(result['unexpected'], [])
                for step in result['steps']:
                    self.assertNotEqual(step['status'], 'exception', step['body'])
                    self.assertEqual(step['home']['kinds'].get('site_detection', 0), 0)
        self.assertEqual(self.mode_run.home_emails, set())

    def test_the_candidate_is_not_vacuous(self):
        calls = [c for r in self.mode_run.results.values() for s in r['steps'] for c in s['home']['calls']]
        self.assertTrue(calls)
        body = self.mode_run.results['rollup_all_active_s101']['steps'][0]['body']
        self.assertTrue(_count_hierarchy_issues(body['projects'][0]['rollup']))


class CandidateSeamTests(unittest.TestCase):
    def test_registered_modes_expose_the_runner_interface(self):
        self.assertEqual(sorted(MODE_FACTORIES), ['basic_json', 'db_oauth_public_read'])
        for factory in MODE_FACTORIES.values():
            for attribute in ('enter', 'install_config', 'get'):
                self.assertTrue(callable(getattr(factory, attribute)))


if __name__ == '__main__':
    unittest.main()
