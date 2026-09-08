#!/usr/bin/env python3
"""Gather sanitized ENG Board counts from existing authenticated app endpoints."""

from __future__ import annotations

import argparse
from http.cookiejar import MozillaCookieJar
import json
import os
from pathlib import Path
import stat
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, HTTPCookieProcessor, Request, build_opener


SCHEMA_VERSION = 1
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
PROJECTS = ('product', 'tech')


class CollectorError(RuntimeError):
    """Closed, sanitized collector failure."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_base_url(raw_url):
    value = str(raw_url or '').strip()
    parsed = urlparse(value)
    if (parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1'} or
            parsed.username or parsed.password or parsed.query or parsed.fragment or
            parsed.path not in {'', '/'}):
        raise ValueError('base URL must be loopback HTTP origin only')
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError('base URL requires a valid port') from error
    if port is None or not (1 <= port <= 65535):
        raise ValueError('base URL requires an explicit valid port')
    return f'http://{parsed.hostname}:{port}'


def validate_external_path(path, *, repo_root):
    target = Path(path).expanduser().resolve()
    root = Path(repo_root).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return target
    raise ValueError('collector files must remain outside the repository')


def load_cookie_jar(path, *, repo_root):
    target = validate_external_path(path, repo_root=repo_root)
    info = target.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('cookie jar must be a private regular file with mode 0600')
    jar = MozillaCookieJar(str(target))
    jar.load(ignore_discard=True, ignore_expires=False)
    if not list(jar):
        raise ValueError('cookie jar contains no active cookies')
    return jar


class EndpointClient:
    def __init__(self, base_url, cookie_jar, *, timeout_seconds=30):
        self.base_url = validate_base_url(base_url)
        self.timeout_seconds = timeout_seconds
        self.opener = build_opener(NoRedirect(), HTTPCookieProcessor(cookie_jar))

    def get_json(self, path, params=None):
        if not str(path).startswith('/api/') or '://' in str(path):
            raise CollectorError('invalid_endpoint')
        query = urlencode(params or {}, doseq=True)
        url = self.base_url + path + (f'?{query}' if query else '')
        request = Request(url, headers={'Accept': 'application/json',
                                        'User-Agent': 'jira-execution-planner-endpoint-collector/1'})
        started = time.perf_counter()
        try:
            response = self.opener.open(request, timeout=self.timeout_seconds)
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            if error.code in {401, 403}:
                raise CollectorError('auth_required') from None
            if 300 <= error.code < 400:
                raise CollectorError('auth_redirected') from None
            raise CollectorError('endpoint_rejected') from None
        except (TimeoutError, URLError):
            raise CollectorError('endpoint_unavailable') from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise CollectorError('response_too_large')
        try:
            body = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise CollectorError('invalid_response') from None
        if not isinstance(body, dict):
            raise CollectorError('invalid_response')
        headers = {str(key): str(value) for key, value in response.headers.items()}
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        return body, headers, elapsed_ms


def _strings(values):
    return [str(value).strip() for value in values or [] if str(value).strip()]


def _team_labels(group, team_ids):
    raw = group.get('teamLabels') or {}
    if isinstance(raw, dict):
        return _strings(raw.get(team_id) for team_id in team_ids)
    return _strings(raw)


def _count_unique(rows, key='key'):
    if not isinstance(rows, list):
        raise CollectorError('invalid_response')
    values = set()
    anonymous = 0
    for row in rows:
        if not isinstance(row, dict):
            raise CollectorError('invalid_response')
        value = str(row.get(key) or '').strip()
        if value:
            values.add(value)
        else:
            anonymous += 1
    return len(values) + anonymous


def _sample(body, *, group_index, project, scope, team_count, component_count,
            elapsed_ms, refresh):
    issues = body.get('issues') or []
    epics = body.get('epics') or {}
    scope_epics = body.get('epicsInScope') or []
    if not isinstance(epics, dict):
        raise CollectorError('invalid_response')
    issue_count = _count_unique(issues)
    reported_total = body.get('total')
    if isinstance(reported_total, bool) or not isinstance(reported_total, int) or reported_total < 0:
        reported_total = issue_count
    return {
        'groupIndex': group_index,
        'project': project,
        'scope': scope,
        'refresh': bool(refresh),
        'wallMs': elapsed_ms,
        'issueCount': issue_count,
        'epicDetailCount': len(epics),
        'scopeEpicCount': _count_unique(scope_epics),
        'reportedTotal': reported_total,
        'capped': reported_total > issue_count or issue_count >= 250,
        'teamCount': team_count,
        'componentCount': component_count,
        'responseJsonBytes': len(json.dumps(body, separators=(',', ':')).encode('utf-8')),
    }


def collect_endpoint_metrics(get_json, *, sprint_id, include_all_work=True, refresh=True):
    if isinstance(sprint_id, bool) or not isinstance(sprint_id, int) or sprint_id <= 0:
        raise ValueError('sprint id must be a positive integer')
    groups_body, _headers, _elapsed = get_json('/api/groups-config')
    groups = groups_body.get('groups') or []
    if not isinstance(groups, list):
        raise CollectorError('invalid_response')
    eligible = []
    for group in groups:
        if not isinstance(group, dict):
            raise CollectorError('invalid_response')
        group_id = str(group.get('id') or '').strip()
        team_ids = _strings(group.get('teamIds'))
        if group_id and team_ids:
            eligible.append((group, group_id, team_ids))
    result = {
        'schemaVersion': SCHEMA_VERSION,
        'source': 'existing_authenticated_endpoints',
        'result': 'complete' if eligible else 'stopped',
        'groupCount': len(groups),
        'eligibleGroupCount': len(eligible),
        'skippedGroupCount': len(groups) - len(eligible),
        'samples': [],
    }
    if not eligible:
        result['stopCode'] = 'no_saved_team_scope'
        return result
    scopes = [('selected_sprint', str(sprint_id))]
    if include_all_work:
        scopes.append(('all_work', ''))
    for group_index, (group, group_id, team_ids) in enumerate(eligible, 1):
        team_labels = _team_labels(group, team_ids)
        component_count = len(_strings(group.get('missingInfoComponents')))
        for scope, sprint in scopes:
            for project in PROJECTS:
                params = {'team': 'all', 'project': project, 'groupId': group_id,
                          'teamIds': ','.join(team_ids), 'purpose': 'dashboard',
                          'refresh': str(bool(refresh)).lower()}
                if team_labels:
                    params['teamLabels'] = ','.join(team_labels)
                if sprint:
                    params['sprint'] = sprint
                body, _response_headers, elapsed_ms = get_json('/api/tasks-with-team-name', params)
                result['samples'].append(_sample(
                    body, group_index=group_index, project=project, scope=scope,
                    team_count=len(team_ids), component_count=component_count,
                    elapsed_ms=elapsed_ms, refresh=refresh,
                ))
    return result


def write_summary(path, document):
    target = Path(path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f'.{target.name}.', dir=target.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(document, handle, sort_keys=True, separators=(',', ':'))
            handle.write('\n')
        os.replace(temporary_name, target)
        os.chmod(target, 0o600)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://localhost:5050')
    parser.add_argument('--cookie-file', required=True,
                        help='External mode-0600 Netscape cookie jar for the signed-in local app')
    parser.add_argument('--sprint-id', required=True, type=int)
    parser.add_argument('--output', required=True, help='Sanitized JSON path outside the repository')
    parser.add_argument('--selected-only', action='store_true')
    parser.add_argument('--reuse-cache', action='store_true')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    try:
        base_url = validate_base_url(args.base_url)
        output = validate_external_path(args.output, repo_root=repo_root)
        jar = load_cookie_jar(args.cookie_file, repo_root=repo_root)
        client = EndpointClient(base_url, jar)
        result = collect_endpoint_metrics(
            client.get_json,
            sprint_id=args.sprint_id,
            include_all_work=not args.selected_only,
            refresh=not args.reuse_cache,
        )
        write_summary(output, result)
    except (CollectorError, OSError, ValueError) as error:
        code = error.code if isinstance(error, CollectorError) else 'invalid_input'
        print(f'STOP {code}')
        return 1
    print(f'WROTE {result["result"]} {len(result["samples"])} samples')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
