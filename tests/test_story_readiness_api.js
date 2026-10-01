const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiPath = path.join(__dirname, '..', 'frontend', 'src', 'api', 'engApi.js');
const hookPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useStoryReadiness.js');

function loadApi(dependencies = {}) {
    const source = fs.readFileSync(apiPath, 'utf8')
        .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/http\.js';\n?/, '')
        .replaceAll('export const ', 'const ');
    const defaults = {
        apiFetch: () => { throw new Error('unexpected apiFetch'); },
        getJson: () => { throw new Error('unexpected getJson'); },
        trackedFetch: () => { throw new Error('unexpected trackedFetch'); },
        jsonOrStructuredError: async response => {
            if (!response.ok) {
                const body = await response.json();
                const error = new Error(body.message || body.error);
                error.status = response.status;
                error.code = body.error;
                error.recoveryUrl = body.recoveryUrl;
                throw error;
            }
            return response.json();
        },
        ...dependencies,
    };
    return new Function(...Object.keys(defaults), `${source}; return { fetchStoryReadiness, fetchEpicReadiness, fetchEpicMissingInfo, fetchEpicBacklog };`)(...Object.values(defaults));
}

function response(body, status = 200) {
    return { ok: status >= 200 && status < 400, status, json: async () => body };
}

test('story readiness API uses the exact encoded GET scope and tracked analytics surface', async () => {
    const calls = [];
    const api = loadApi({
        trackedFetch: async (...args) => {
            calls.push(args);
            return response({ schemaVersion: 1, complete: true, scope: {}, epics: [] });
        },
    });
    const signal = new AbortController().signal;
    const result = await api.fetchStoryReadiness('https://planner.test', {
        sprint: '42/7', sprintName: 'Sprint & Future', sprintState: 'future', groupId: 'group a', refresh: true, signal,
    });

    assert.equal(result.complete, true);
    assert.equal(calls.length, 1);
    const [surface, rawUrl, options, analytics] = calls[0];
    assert.equal(surface, 'eng_story_readiness');
    const url = new URL(rawUrl);
    assert.equal(url.pathname, '/api/eng/story-readiness');
    assert.deepEqual(Array.from(url.searchParams.keys()), ['sprint', 'sprintName', 'sprintState', 'groupId', 'refresh']);
    assert.equal(url.searchParams.get('sprint'), '42/7');
    assert.equal(url.searchParams.get('sprintName'), 'Sprint & Future');
    assert.equal(url.searchParams.get('sprintState'), 'future');
    assert.equal(url.searchParams.get('groupId'), 'group a');
    assert.equal(url.searchParams.get('refresh'), 'true');
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-cache');
    assert.equal(options.signal, signal);
    assert.equal(new Headers(options.headers).get('Content-Type'), 'application/json');
    assert.deepEqual(analytics, { featureName: 'eng', suppressAbortResult: true });
});

test('story readiness API omits refresh unless explicitly requested and propagates aborts', async () => {
    const abort = new DOMException('stopped', 'AbortError');
    let requestUrl = '';
    const api = loadApi({
        trackedFetch: async (_surface, url) => {
            requestUrl = url;
            throw abort;
        },
    });
    await assert.rejects(
        api.fetchStoryReadiness('https://planner.test', {
            sprint: '42', sprintName: 'Sprint 42', sprintState: 'active', groupId: 'g1',
        }),
        error => error === abort,
    );
    assert.equal(new URL(requestUrl).searchParams.has('refresh'), false);
});

test('story readiness API preserves only structured safe error fields', async () => {
    const api = loadApi({
        trackedFetch: async () => response({
            error: 'story_readiness_configuration_invalid',
            message: 'Story readiness configuration is incomplete.',
            token: 'must-not-escape',
            jiraUrl: 'https://private.invalid',
        }, 409),
    });
    await assert.rejects(
        api.fetchStoryReadiness('https://planner.test', {
            sprint: '42', sprintName: 'Sprint 42', sprintState: 'active', groupId: 'g1',
        }),
        (error) => {
            assert.equal(error.status, 409);
            assert.equal(error.code, 'story_readiness_configuration_invalid');
            assert.equal(error.token, undefined);
            assert.equal(error.jiraUrl, undefined);
            return true;
        },
    );
});

test('story readiness hook owns gating, abort, exact scope validation, and typed retry policy', () => {
    const source = fs.readFileSync(hookPath, 'utf8');
    assert.match(source, /enabled && primaryReady && scopeKey/);
    assert.match(source, /SUPPORTED_SPRINT_STATES\.has/);
    assert.match(source, /const controller = new AbortController\(\)/);
    assert.match(source, /controller\.abort\(\)/);
    assert.match(source, /storyReadinessScopeMatches\(snapshot, scope\)/);
    assert.match(source, /refresh: requestRefresh/);
    assert.match(source, /completedRefreshRevisionRef/);
    assert.match(source, /if \(state\.canRetry\) setRetryRevision/);
    assert.doesNotMatch(source, /missing-info|ready-to-close|backlog-epics/);
});

test('story readiness lifecycle helpers reject stale scopes and classify only transient failures as retryable', async () => {
    const source = fs.readFileSync(hookPath, 'utf8');
    const transformed = source
        .replace("import * as React from 'react';\n", '')
        .replace("import { fetchEpicReadiness, fetchStoryReadiness } from '../api/engApi.js';\n", 'const fetchEpicReadiness = null; const fetchStoryReadiness = null;\n')
        .replace("import { mergeReadinessEpic } from './epicRefreshAlerts.js';\n", 'const mergeReadinessEpic = null;\n')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    const helpers = new Function(`${transformed}; return { storyReadinessScopeKey, storyReadinessScopeMatches, classifyStoryReadinessError, STORY_READINESS_STATUS };`)();
    const scope = { groupId: 'g1', sprintId: '42', sprintName: 'Sprint 42', sprintState: 'active' };
    const snapshot = { schemaVersion: 1, complete: true, scope, epics: [] };
    assert.ok(helpers.storyReadinessScopeKey(scope));
    assert.equal(helpers.storyReadinessScopeMatches(snapshot, scope), true);
    assert.equal(helpers.storyReadinessScopeMatches({ ...snapshot, scope: { ...scope, sprintId: '43' } }, scope), false);
    assert.equal(helpers.storyReadinessScopeMatches({ ...snapshot, complete: false }, scope), false);
    assert.deepEqual(helpers.classifyStoryReadinessError({ status: 502 }), {
        status: helpers.STORY_READINESS_STATUS.UNAVAILABLE, code: 'story_readiness_unavailable', canRetry: true,
    });
    for (const [status, expected] of [[400, 'invalid_scope'], [403, 'access_denied'], [404, 'scope_not_found'], [409, 'invalid_configuration'], [422, 'scope_too_large']]) {
        assert.equal(helpers.classifyStoryReadinessError({ status }).status, expected);
        assert.equal(helpers.classifyStoryReadinessError({ status }).canRetry, false);
    }
});

test('per-epic readiness API is a separate GET with the epic key and refresh, and the department request stays untouched', async () => {
    const calls = [];
    const api = loadApi({
        trackedFetch: async (...args) => { calls.push(args); return response({ schemaVersion: 1, complete: true, scope: {}, epics: [] }); },
    });
    const signal = new AbortController().signal;
    await api.fetchEpicReadiness('https://planner.test', {
        sprint: '42', sprintName: 'Sprint 42', sprintState: 'future', groupId: 'g1', epicKey: 'PROD-5', signal,
    });
    await api.fetchStoryReadiness('https://planner.test', { sprint: '42', sprintName: 'Sprint 42', sprintState: 'future', groupId: 'g1' });
    const [surface, rawUrl, options, analytics] = calls[0];
    const url = new URL(rawUrl);
    assert.equal(url.pathname, '/api/eng/story-readiness');
    assert.deepEqual(Array.from(url.searchParams.keys()), ['sprint', 'sprintName', 'sprintState', 'groupId', 'epicKeys', 'refresh']);
    assert.equal(url.searchParams.get('epicKeys'), 'PROD-5');
    assert.equal(url.searchParams.get('refresh'), 'true');
    assert.equal(surface, 'epic_refresh');
    assert.equal(options.signal, signal);
    assert.equal(options.method, 'GET');
    assert.deepEqual(analytics, { featureName: 'epic_refresh', suppressAbortResult: true });
    assert.equal(new URL(calls[1][1]).searchParams.has('epicKeys'), false);
    assert.equal(calls[1][0], 'eng_story_readiness');
});

test('per-epic readiness API keeps the structured safe error fields', async () => {
    const api = loadApi({ trackedFetch: async () => response({ error: 'story_readiness_unavailable', message: 'down', jiraUrl: 'https://private.invalid' }, 503) });
    await assert.rejects(
        api.fetchEpicReadiness('https://planner.test', { sprint: '42', sprintName: 'S', sprintState: 'active', groupId: 'g1', epicKey: 'PROD-5' }),
        (error) => error.status === 503 && error.jiraUrl === undefined,
    );
});

test('per-epic missing-info API sends the sprint scope, the one epic key and refresh', async () => {
    const calls = [];
    const api = loadApi({ apiFetch: async (...args) => { calls.push(args); return response({ issues: [], epics: [] }); } });
    const signal = new AbortController().signal;
    await api.fetchEpicMissingInfo('https://planner.test', { sprintId: 42, teamIds: ['t1', 't2'], components: ['C1'], epicKey: 'PROD-5', signal });
    const [rawUrl, options] = calls[0];
    const url = new URL(rawUrl);
    assert.equal(url.pathname, '/api/missing-info');
    assert.equal(url.searchParams.get('sprint'), '42');
    assert.equal(url.searchParams.get('teamIds'), 't1,t2');
    assert.equal(url.searchParams.get('components'), 'C1');
    assert.equal(url.searchParams.get('epicKeys'), 'PROD-5');
    assert.equal(url.searchParams.get('refresh'), 'true');
    assert.equal(options.signal, signal);
});

test('per-epic backlog API sends the project, teams and the one epic key', async () => {
    const calls = [];
    const api = loadApi({ getJson: async (...args) => { calls.push(args); return { epics: [] }; } });
    await api.fetchEpicBacklog('https://planner.test', { project: 'product', teamIds: ['t1'], epicKey: 'PROD-5' });
    const [rawUrl, label, options] = calls[0];
    const url = new URL(rawUrl);
    assert.equal(url.pathname, '/api/backlog-epics');
    assert.equal(url.searchParams.get('project'), 'product');
    assert.equal(url.searchParams.get('teamIds'), 't1');
    assert.equal(url.searchParams.get('epicKeys'), 'PROD-5');
    assert.equal(options.method, 'GET');
});

test('story readiness hook merges one epic into the held snapshot without blanking it', () => {
    const source = fs.readFileSync(hookPath, 'utf8');
    assert.match(source, /mergeReadinessEpic\(/);
    assert.match(source, /const mergeEpic = React\.useCallback/);
    assert.match(source, /const loadEpic = React\.useCallback/);
    const merge = source.slice(source.indexOf('const mergeEpic = React.useCallback'), source.indexOf('const loadEpic = React.useCallback'));
    assert.doesNotMatch(merge, /snapshot: null/);
    assert.match(merge, /STORY_READINESS_STATUS\.READY/);
    assert.match(merge, /storyReadinessScopeMatches\(/);
    assert.match(source, /return \{ \.\.\.state, scope, scopeKey, retry, mergeEpic, loadEpic \}/);
});

test('story readiness hook sends no per-epic request unless the department load condition holds', () => {
    const source = fs.readFileSync(hookPath, 'utf8');
    const loadEpic = source.slice(source.indexOf('const loadEpic = React.useCallback'), source.indexOf('return { ...state'));
    assert.match(source, /const shouldLoad = Boolean\(enabled && primaryReady && scopeKey\)/);
    assert.match(loadEpic, /if \(!shouldLoad \|\| !storyReadinessScopeKey\(requested\)\) return \{ status: 'ignored' \}/);
    assert.ok(loadEpic.indexOf('!shouldLoad') < loadEpic.indexOf('requestEpicReadiness('));
    assert.match(loadEpic, /\[shouldLoad, backendUrl, requestEpicReadiness\]/);
});
