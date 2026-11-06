const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const ENTRY = path.join(__dirname, '..', 'frontend', 'src', 'api', 'jiraIssueApi.js');

function bundle() {
    return esbuild.buildSync({
        entryPoints: [ENTRY], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
}

function harness(fetchImpl) {
    const calls = [];
    const sandbox = {
        module: { exports: {} }, exports: {}, console, URL, URLSearchParams, Headers, Request, Response,
        performance: { now: () => 1 },
        fetch: async (...args) => { calls.push(args); return fetchImpl(...args); },
    };
    vm.runInContext(bundle(), vm.createContext(sandbox));
    return { api: sandbox.module.exports, calls };
}

function jsonResponse(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json', ...headers },
    });
}

test('editable field metadata uses encoded issue and logical field with tracked auth-aware fetch', async () => {
    const h = harness(async () => jsonResponse({ editable: true }));
    assert.deepEqual(
        JSON.parse(JSON.stringify(await h.api.fetchEditableIssueField('/root', 'DEMO /1', 'deliveryOwner'))),
        { editable: true },
    );
    assert.equal(h.calls[0][0], '/root/api/issues/DEMO%20%2F1/editable-fields?field=deliveryOwner');
    assert.equal(h.calls[0][1].method, 'GET');
    assert.equal(h.calls[0][1].headers['X-Requested-With'], 'jira-execution-planner');
});

test('search and update each fetch their own single-use CSRF token and send exact POST bodies', async () => {
    let issued = 0;
    const h = harness(async (url) => {
        if (url.endsWith('/api/auth/csrf')) return jsonResponse({ csrfToken: `csrf-${++issued}` });
        return jsonResponse(url.endsWith('/user-options') ? { options: [] } : { result: 'success', value: 2 });
    });
    await Promise.all([
        h.api.searchIssueFieldUsers('/root', 'DEMO-1', { field: 'assignee', query: 'Ada' }),
        h.api.updateIssueField('/root', 'DEMO-2', {
            field: 'storyPoints', value: 2, baseValue: 1.5, baseUpdated: 'base', mappingRevision: 'rev',
        }),
    ]);
    assert.equal(h.calls.filter(([url]) => url.endsWith('/api/auth/csrf')).length, 2);

    const posts = h.calls.filter(([url]) => !url.endsWith('/api/auth/csrf'));
    assert.deepEqual(posts.map(([url]) => url), [
        '/root/api/issues/DEMO-1/user-options', '/root/api/issues/DEMO-2/field',
    ]);
    assert.deepEqual(posts.map(([, options]) => JSON.parse(options.body)), [
        { field: 'assignee', query: 'Ada' },
        { field: 'storyPoints', value: 2, baseValue: 1.5, baseUpdated: 'base', mappingRevision: 'rev' },
    ]);
    assert.deepEqual(posts.map(([, options]) => options.headers['X-CSRF-Token']).sort(), ['csrf-1', 'csrf-2']);
    posts.forEach(([, options]) => assert.equal(options.headers['X-Requested-With'], 'jira-execution-planner'));
});

test('field errors retain only approved typed conflict and retry details', async () => {
    const bodies = [
        jsonResponse({
            error: 'stale_issue', issueKey: 'DEMO-1', field: 'assignee', currentValue: { accountId: 'new' },
            baseUpdated: 'later', mappingRevision: 'rev-2', message: 'private upstream detail', arbitrary: 'secret',
        }, 409),
        jsonResponse({ error: 'jira_rate_limited', retryAfterSeconds: 600, message: 'raw rate text' }, 429),
    ];
    const h = harness(async (url) => url.endsWith('/api/auth/csrf')
        ? jsonResponse({ csrfToken: 'csrf' })
        : bodies.shift());

    await assert.rejects(
        h.api.updateIssueField('/root', 'DEMO-1', {}),
        error => error.code === 'stale_issue'
            && error.issueKey === 'DEMO-1'
            && error.field === 'assignee'
            && error.currentValue.accountId === 'new'
            && error.baseUpdated === 'later'
            && error.mappingRevision === 'rev-2'
            && error.message === 'stale_issue'
            && !('arbitrary' in error),
    );
    await assert.rejects(
        h.api.searchIssueFieldUsers('/root', 'DEMO-1', { field: 'assignee', query: 'Ada' }),
        error => error.code === 'jira_rate_limited'
            && error.retryAfterSeconds === 60
            && error.message === 'jira_rate_limited',
    );
});
