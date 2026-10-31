const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadIssueApi = () => import('../frontend/src/api/jiraIssueApi.js');
const loadReviewApi = () => import('../frontend/src/api/sprintReviewApi.js');
const loadContext = () => import('../frontend/src/workStructure/requestContext.js');

const SUMMARY = { id: 'delivery', revision: 7, digest: 'a'.repeat(32), fromQuarter: '2027Q1', throughQuarter: null };
const contextFor = (summary = SUMMARY, quarter = '2027Q2') => Object.freeze({
    id: summary.id, revision: summary.revision, quarter, digest: summary.digest || null,
    fromQuarter: summary.fromQuarter, throughQuarter: summary.throughQuarter,
});
const STAMP = { id: 'delivery', revision: 7, quarter: '2027Q2', digest: 'a'.repeat(32) };

function installFetch(handler) {
    const old = global.fetch, calls = [];
    global.fetch = async (url, options = {}) => {
        if (String(url).endsWith('/api/auth/csrf')) return Response.json({ csrfToken: 'synthetic-csrf' });
        calls.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : undefined });
        return handler(calls[calls.length - 1], calls.length);
    };
    return { calls, restore: () => { global.fetch = old; } };
}
const ok = () => Response.json({ ok: true, issues: [], targetStatuses: [], priorities: [], value: 3 });

async function withContext(context, run) {
    const { setActiveWorkContext } = await loadContext();
    setActiveWorkContext(context);
    try { return await run(); } finally { setActiveWorkContext(null); }
}

test('unpromoted write builders keep their exact request shapes (no active context, no stamp)', async () => {
    const api = await loadIssueApi();
    const fetchStub = installFetch(ok);
    try {
        await api.updateIssueField('', 'PLAN-1', { field: 'storyPoints', value: 3, baseValue: 1, baseUpdated: 'x', mappingRevision: 'm' });
        await api.fetchEditableIssueField('', 'PLAN-1', 'summary');
        await api.fetchIssueTransitionOptions('', ['PLAN-1']);
        await api.transitionIssues('', { issueKeys: ['PLAN-1'], targetStatus: 'Done' });
        await api.fetchIssuePriorityOptions('', { issueKey: 'PLAN-1' });
        await api.updateIssuePriorities('', { issueKeys: ['PLAN-1'], targetPriorityId: '2' });
        await api.fetchIssueProjectTrackOptions('', { issueKey: 'PLAN-2' });
        await api.updateIssueProjectTrack('', { issueKey: 'PLAN-2', targetTrack: 'Committed' });
        const [field, editable, options, transition, prioOptions, prio, trackOptions, track] = fetchStub.calls;
        assert.deepEqual(field.body, { field: 'storyPoints', value: 3, baseValue: 1, baseUpdated: 'x', mappingRevision: 'm' });
        assert.equal(editable.url, '/api/issues/PLAN-1/editable-fields?field=summary');
        assert.deepEqual(options.body, { issueKeys: ['PLAN-1'] });
        assert.deepEqual(transition.body, { issueKeys: ['PLAN-1'], targetStatus: 'Done' });
        assert.equal(prioOptions.url, '/api/issues/priorities/options?issueKey=PLAN-1');
        assert.deepEqual(prio.body, { issueKeys: ['PLAN-1'], targetPriorityId: '2' });
        assert.equal(trackOptions.url, '/api/issues/project-track/options?issueKey=PLAN-2');
        assert.deepEqual(track.body, { issueKey: 'PLAN-2', targetTrack: 'Committed' });
        for (const call of fetchStub.calls) assert.ok(!JSON.stringify(call).includes('configuration'), call.url);
    } finally { fetchStub.restore(); }
});

test('after promotion every body route carries configuration {id, revision(int), quarter, digest}', async () => {
    const api = await loadIssueApi();
    const fetchStub = installFetch(ok);
    try {
        await withContext(contextFor(), async () => {
            await api.updateIssueField('', 'PLAN-1', { field: 'storyPoints', value: 3 });
            await api.searchIssueFieldUsers('', 'PLAN-1', { field: 'assignee', query: 'ab' });
            await api.fetchIssueTransitionOptions('', ['PLAN-1']);
            await api.transitionIssues('', { issueKeys: ['PLAN-1'], targetStatus: 'Done' });
            await api.updateIssuePriorities('', { issueKeys: ['PLAN-1'], targetPriorityId: '2' });
            await api.updateIssueProjectTrack('', { issueKey: 'PLAN-2', targetTrack: 'Committed' });
        });
        assert.equal(fetchStub.calls.length, 6);
        for (const call of fetchStub.calls) {
            assert.deepEqual(call.body.configuration, STAMP, call.url);
            assert.equal(Number.isInteger(call.body.configuration.revision), true);
            assert.match(call.body.configuration.digest, /^[0-9a-f]{32}$/);
        }
        // The route's own body keys are untouched next to the stamp.
        assert.equal(fetchStub.calls[0].body.field, 'storyPoints');
        assert.deepEqual(fetchStub.calls[5].body.issueKey, 'PLAN-2');
    } finally { fetchStub.restore(); }
});

test('after promotion the GET routes carry the stamp by query; the site-wide priority catalog stays unscoped', async () => {
    const api = await loadIssueApi();
    const fetchStub = installFetch(ok);
    try {
        await withContext(contextFor(), async () => {
            await api.fetchEditableIssueField('', 'PLAN-1', 'summary');
            await api.fetchIssuePriorityOptions('', { issueKey: 'PLAN-1' });
            await api.fetchIssuePriorityOptions('', {});
            await api.fetchIssueProjectTrackOptions('', { issueKey: 'PLAN-2' });
        });
        const [editable, scopedPriorities, sitePriorities, track] = fetchStub.calls;
        for (const call of [editable, scopedPriorities, track]) {
            const query = new URL(call.url, 'http://x').searchParams;
            assert.equal(query.get('configurationId'), 'delivery', call.url);
            assert.equal(query.get('configurationRevision'), '7');
            assert.equal(query.get('quarter'), '2027Q2');
            assert.equal(query.get('configurationDigest'), 'a'.repeat(32));
        }
        assert.equal(new URL(editable.url, 'http://x').searchParams.get('field'), 'summary');
        assert.equal(new URL(scopedPriorities.url, 'http://x').searchParams.get('issueKey'), 'PLAN-1');
        assert.equal(sitePriorities.url, '/api/issues/priorities/options', 'no issue key: the site catalog is not configuration scoped');
        assert.equal(new URL(track.url, 'http://x').searchParams.get('issueKey'), 'PLAN-2');
    } finally { fetchStub.restore(); }
});

test('a context without a digest sends digest null in bodies and omits it from queries', async () => {
    const api = await loadIssueApi();
    const fetchStub = installFetch(ok);
    try {
        await withContext(contextFor({ ...SUMMARY, digest: undefined }), async () => {
            await api.transitionIssues('', { issueKeys: ['PLAN-1'], targetStatus: 'Done' });
            await api.fetchIssueProjectTrackOptions('', { issueKey: 'PLAN-2' });
        });
        assert.deepEqual(fetchStub.calls[0].body.configuration, { ...STAMP, digest: null });
        assert.equal(new URL(fetchStub.calls[1].url, 'http://x').searchParams.has('configurationDigest'), false);
    } finally { fetchStub.restore(); }
});

test('409 configuration_scope_changed re-reads the configuration once, surfaces safe copy and is never replayed', async () => {
    const api = await loadIssueApi();
    const { onWorkContextStale } = await loadContext();
    let stale = 0;
    const off = onWorkContextStale(() => { stale += 1; });
    const fetchStub = installFetch(() => Response.json({ error: 'configuration_scope_changed' }, { status: 409 }));
    try {
        await withContext(contextFor(), async () => {
            await assert.rejects(api.updateIssueField('', 'PLAN-1', { field: 'storyPoints', value: 3 }),
                error => error.code === 'configuration_scope_changed' && error.status === 409 && /kept but was not saved/.test(error.message) && !/configuration_scope_changed/.test(error.message));
            await assert.rejects(api.transitionIssues('', { issueKeys: ['PLAN-1'], targetStatus: 'Done' }),
                error => error.code === 'configuration_scope_changed' && /kept but was not saved/.test(error.message));
        });
        assert.equal(fetchStub.calls.length, 2, 'one request per user action: no automatic replay');
        assert.equal(stale, 2, 'each rejection asks the dashboard to refresh the configuration');
    } finally { off(); fetchStub.restore(); }
});

test('issue_not_parent maps to a user-safe message without the raw code', async () => {
    const api = await loadIssueApi();
    const fetchStub = installFetch(() => Response.json({ error: 'issue_not_parent' }, { status: 409 }));
    try {
        await withContext(contextFor(), async () => {
            await assert.rejects(api.updateIssueProjectTrack('', { issueKey: 'PLAN-9', targetTrack: 'Committed' }),
                error => error.code === 'issue_not_parent' && /Only the parent work item/.test(error.message) && !/issue_not_parent/.test(error.message));
        });
        assert.equal(fetchStub.calls.length, 1);
    } finally { fetchStub.restore(); }
});

test('a late completion that outlives its context is dropped as an abort by the work-context runner', async () => {
    const { runInWorkContext, setActiveWorkContext } = await loadContext();
    setActiveWorkContext(contextFor());
    try {
        let release;
        const pending = runInWorkContext({}, () => new Promise(resolve => { release = resolve; }));
        setActiveWorkContext(contextFor({ ...SUMMARY, id: 'legacy', revision: 3, fromQuarter: null, throughQuarter: '2026Q4' }, '2026Q4'));
        release('late');
        await assert.rejects(pending, error => error.name === 'AbortError' && error.code === 'configuration_context_changed');
    } finally { setActiveWorkContext(null); }
});

test('review builders stamp GET by query and POST/PATCH by body; unpromoted URLs and bodies are unchanged', async () => {
    const review = await loadReviewApi();
    const fetchStub = installFetch(() => Response.json({ cells: [], unavailableIssueIds: [], columns: [], layouts: {} }));
    try {
        await review.fetchSprintReview('', '123', { groupId: 'g 1' });
        await review.readSprintReviewValues('', '123', { groupId: 'g1', rowKind: 'story', issueIds: ['1'] });
        await review.saveSprintReview('', '123', { groupId: 'g1', baseSchemaRevision: 1, baseViewRevision: 0, schemaChanges: [], cellChanges: [] });
        assert.equal(fetchStub.calls[0].url, '/api/eng/sprints/123/review?groupId=g%201');
        assert.deepEqual(fetchStub.calls[1].body, { groupId: 'g1', rowKind: 'story', issueIds: ['1'] });
        assert.equal('configuration' in fetchStub.calls[2].body, false);
        fetchStub.calls.length = 0;
        await withContext(contextFor(), async () => {
            await review.fetchSprintReview('', '123', { groupId: 'g1' });
            await review.readSprintReviewValues('', '123', { groupId: 'g1', rowKind: 'initiative', issueIds: ['1'] });
            await review.saveSprintReview('', '123', { groupId: 'g1', baseSchemaRevision: 1, baseViewRevision: 0, schemaChanges: [], cellChanges: [] });
        });
        const query = new URL(fetchStub.calls[0].url, 'http://x');
        assert.equal(query.pathname, '/api/eng/sprints/123/review');
        assert.equal(query.searchParams.get('groupId'), 'g1');
        assert.equal(query.searchParams.get('configurationId'), 'delivery');
        assert.equal(query.searchParams.get('configurationRevision'), '7');
        assert.equal(query.searchParams.get('quarter'), '2027Q2');
        assert.deepEqual(fetchStub.calls[1].body.configuration, STAMP);
        assert.equal(fetchStub.calls[1].body.rowKind, 'initiative');
        assert.deepEqual(fetchStub.calls[2].body.configuration, STAMP);
    } finally { fetchStub.restore(); }
});

test('a stale review save keeps its code, asks for a configuration refresh and sends no second request', async () => {
    const review = await loadReviewApi();
    const { onWorkContextStale } = await loadContext();
    let stale = 0;
    const off = onWorkContextStale(() => { stale += 1; });
    const fetchStub = installFetch(() => Response.json({ error: 'configuration_scope_changed', code: 'configuration_scope_changed' }, { status: 409 }));
    try {
        await withContext(contextFor(), async () => {
            await assert.rejects(review.saveSprintReview('', '123', { groupId: 'g1', schemaChanges: [], cellChanges: [] }),
                error => error.status === 409 && error.code === 'configuration_scope_changed');
        });
        assert.equal(fetchStub.calls.length, 1);
        assert.equal(stale, 1);
    } finally { off(); fetchStub.restore(); }
});

test('Capacity PATCH stays unstamped and the own-key hooks never import the stamp helpers', () => {
    const src = path.join(__dirname, '..', 'frontend', 'src');
    assert.doesNotMatch(fs.readFileSync(path.join(src, 'api', 'capacityApi.js'), 'utf8'), /requestContext|stampWrite|configuration/);
    for (const hook of ['useEngIssueFieldEdits', 'useEngStatusTransitions', 'useEngPriorityTransitions', 'useEngProjectTrackTransitions']) {
        assert.doesNotMatch(fs.readFileSync(path.join(src, 'eng', `${hook}.js`), 'utf8'), /stampWrite|requestContext/, `${hook} builds no stamp: the API builders own it`);
    }
});

test('the design system documents the stamp for every registered Jira write builder', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'design-system.md'), 'utf8');
    const registry = JSON.parse(/```json\s*\n([\s\S]*?)\n```/.exec(doc)[1]);
    const section = doc.slice(doc.indexOf('### Quarterly configuration stamp on own-key writes'), doc.indexOf('The single JSON block is the machine-readable source'));
    assert.ok(section.length > 200, 'stamp contract section exists');
    const writers = registry.apiEffects.filter(entry => entry.path.endsWith('jiraIssueApi.js') && entry.effect === 'jira-write');
    assert.ok(writers.length >= 4);
    for (const entry of writers) assert.ok(section.includes(`\`${entry.symbol}\``), `${entry.symbol} has a stamp contract row`);
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'api', 'jiraIssueApi.js'), 'utf8');
    for (const entry of writers) {
        const start = source.indexOf(`function ${entry.symbol}(`);
        const body = source.slice(start, source.indexOf('\n}\n', start));
        assert.match(body, /stampWriteBody\(/, `${entry.symbol} stamps its body`);
    }
});

test('excluded-capacity source: same-era requests are stamped, a mixed-era range is not', async () => {
    const engApi = await import('../frontend/src/api/engApi.js');
    const fetchStub = installFetch(() => Response.json({}));
    try {
        await withContext(contextFor(), async () => {
            await engApi.fetchExcludedCapacityStatsSource('', { sprintIds: [1], teamIds: ['t'] });
            await engApi.fetchExcludedCapacityStatsSource('', { sprintIds: [1, 2], teamIds: ['t'], scoped: false });
        });
        assert.equal(fetchStub.calls[0].body.configurationId, 'delivery');
        assert.equal(fetchStub.calls[0].body.quarter, '2027Q2');
        assert.deepEqual(fetchStub.calls[1].body, { sprintIds: [1, 2], teamIds: ['t'] });
    } finally { fetchStub.restore(); }
});
