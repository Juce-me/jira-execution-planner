// Catch Up warnings for a quarterly (DELIVERY) configuration: the dependency request builder and the Story readiness
// error classification and messages. Synthetic contexts only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const bundle = esbuild.buildSync({
    stdin: {
        contents: [
            "export { fetchDependencies } from './frontend/src/api/engApi.js';",
            "export { setActiveWorkContext, onWorkContextStale } from './frontend/src/workStructure/requestContext.js';",
            "export { buildConfigurationContext } from './frontend/src/workStructure/configurationContext.js';",
            "export { classifyStoryReadinessError, STORY_READINESS_STATUS } from './frontend/src/eng/useStoryReadiness.js';",
            "export { storyReadinessStatusMessage } from './frontend/src/eng/engWorkHierarchy.js';",
        ].join('\n'),
        resolveDir: root,
    },
    bundle: true, write: false, format: 'cjs', platform: 'browser',
}).outputFiles[0].text;
const loaded = { exports: {} };
new Function('module', 'exports', bundle)(loaded, loaded.exports);
const api = loaded.exports;

const DELIVERY = { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null, digest: 'd1' };

async function captureDependencyRequest(context, options) {
    api.setActiveWorkContext(context);
    const calls = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{"dependencies":{}}', { status: 200 }); };
    try {
        await api.fetchDependencies('http://backend', ['PLAN-1', 'PLAN-2'], options);
    } finally {
        globalThis.fetch = previous;
        api.setActiveWorkContext(null);
    }
    assert.equal(calls.length, 1);
    return { url: new URL(calls[0].url), body: JSON.parse(calls[0].init.body), init: calls[0].init };
}

test('dependency requests carry the DELIVERY selectors in the query and only {keys, refresh} in the body', async () => {
    const { url, body, init } = await captureDependencyRequest(api.buildConfigurationContext(DELIVERY, '2027Q1'), { refresh: true });
    assert.equal(url.pathname, '/api/dependencies');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
        configurationId: 'delivery', configurationRevision: '2', quarter: '2027Q1', configurationDigest: 'd1',
    });
    assert.deepEqual(body, { keys: ['PLAN-1', 'PLAN-2'], refresh: true });
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-Requested-With'], 'jira-execution-planner');
});

test('an unpromoted (no context) dependency request is unchanged: no query, plain {keys} body', async () => {
    const { url, body } = await captureDependencyRequest(null);
    assert.equal(url.search, '');
    assert.deepEqual(body, { keys: ['PLAN-1', 'PLAN-2'] });
});

test('only an explicit readiness configuration code is "incomplete"; context conflicts are silent', () => {
    const { classifyStoryReadinessError: classify, STORY_READINESS_STATUS: S } = api;
    const invalid = classify({ status: 409, code: 'story_readiness_configuration_invalid', reason: 'team_labels_missing', teams: ['Alpha', 7] });
    assert.equal(invalid.status, S.INVALID_CONFIGURATION);
    assert.equal(invalid.reason, 'team_labels_missing');
    assert.deepEqual(invalid.teams, ['Alpha']);
    const stale = classify({ status: 409, code: 'configuration_scope_changed' });
    assert.equal(stale.status, S.IDLE);
    assert.equal(stale.stale, true);
    for (const code of ['configuration_required', 'sprint_catalog_mismatch', 'sprint_catalog_pending']) {
        const result = classify({ status: code === 'sprint_catalog_pending' ? 503 : 409, code });
        assert.equal(result.status, S.IDLE, code);
        assert.equal(result.stale, undefined, code);
    }
    const incomplete = classify({ status: 409, code: 'configuration_incomplete', missingFields: ['fields.team.fieldId'] });
    assert.equal(incomplete.status, S.WORK_CONFIGURATION_INCOMPLETE);
    assert.deepEqual(incomplete.missingFields, ['fields.team.fieldId']);
    // An unrecognised conflict is transient, never "configuration is incomplete".
    assert.equal(classify({ status: 409, code: 'something_else' }).status, S.UNAVAILABLE);
});

test('readiness configuration messages name what is missing in the viewed model and who can fix it', () => {
    const message = (status, error, workModel = 'rnd_2027') => api.storyReadinessStatusMessage(status, '', { error, workModel });
    const labels = message('invalid_configuration', { code: 'story_readiness_configuration_invalid', reason: 'team_labels_missing', teams: ['Alpha', 'Beta'] });
    assert.match(labels, /^Epics Required needs a Team label/);
    assert.match(labels, /missing for Alpha, Beta/);
    assert.match(labels, /Open Settings/);
    assert.match(message('invalid_configuration', { reason: 'team_labels_missing' }, 'legacy'), /^Stories Required/);
    const admin = message('work_configuration_incomplete', { code: 'configuration_incomplete', missingFields: ['fields.team.fieldId'] });
    assert.match(admin, /missing: fields\.team\.fieldId/);
    assert.match(admin, /An administrator can complete it in Settings/);
    assert.doesNotMatch(admin, /Open Settings/);
    assert.match(message('invalid_configuration', { reason: 'projects_missing' }), /An administrator can add them in Settings/);
    // An old server without a reason keeps the generic copy; silent statuses have none.
    assert.match(message('invalid_configuration', {}), /^Epic readiness configuration is incomplete/);
    assert.match(message('invalid_configuration', {}, 'legacy'), /^Story readiness configuration is incomplete/);
    assert.equal(api.storyReadinessStatusMessage('idle'), '');
});

test('readiness status lines name the planned level: Epic readiness for DELIVERY, Story readiness for Legacy', () => {
    const line = (status, workModel) => api.storyReadinessStatusMessage(status, '', { workModel });
    assert.equal(line('invalid_scope', 'rnd_2027'), 'Epic readiness is unavailable for this Sprint: Jira reports a different name or state for it than this page has. Use Refresh to reload the Sprints.');
    assert.equal(line('unavailable', 'rnd_2027'), 'Epic readiness is temporarily unavailable. Jira Epics remain visible.');
    for (const status of ['invalid_scope', 'unavailable', 'access_denied', 'scope_too_large']) {
        assert.doesNotMatch(line(status, 'rnd_2027'), /Stor(y|ies)/, status);
    }
    // Legacy keeps its exact wording.
    assert.equal(line('invalid_scope', 'legacy'), 'Story readiness is unavailable for this Sprint: Jira reports a different name or state for it than this page has. Use Refresh to reload the Sprints.');
    assert.equal(line('unavailable', 'legacy'), 'Story readiness is temporarily unavailable. Jira Stories remain visible.');
});
