const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');

for (const [name, pattern, refName] of [
    ['Board', /React\.useCallback\(active => \{([^\n]+)\}, \[\]\)/, 'boardFreshnessRef'],
    ['capacity', /onInteractionChange=\{value => \{([^\n]*capacityInteractionRef[^\n]*)\}\}/, 'capacityInteractionRef'],
    ['Planning table', /onInteractionChange=\{value => \{([^\n]*planningInteractionRef[^\n]*)\}\}/, 'planningInteractionRef'],
]) test(`${name} interaction wakes freshness only on a boolean transition`, () => {
    const body = source.match(pattern)?.[1];
    assert.ok(body, 'exercise the actual App callback');
    const ref = { current: name === 'Board' ? { interaction: false } : false };
    let wakes = 0;
    const callback = new Function(refName, 'notifyPlanningInteraction', `return ${name === 'Board' ? 'active' : 'value'} => {${body}}`)(ref, update => { wakes = update(wakes); });
    callback(false); callback(false); assert.equal(wakes, 0);
    callback(true); callback(true); assert.equal(wakes, 1);
    callback(false); callback(false); assert.equal(wakes, 2);
});

test('missing Planning information propagates semantic auth and always releases its read', async () => {
    const start = source.indexOf('const fetchMissingPlanningInfo = async');
    const body = source.slice(start, source.indexOf('useEffect(() => {', start));
    assert.ok(start >= 0);
    let finished = 0, cleaned = 0, writes = 0;
    const error = Object.assign(new Error('Sign in'), { name: 'AuthenticationRequiredError' });
    const dependencies = {
        registerSprintFetch: () => new AbortController(),
        cleanupSprintFetch: () => cleaned++,
        issueEditStateRef: { current: { beginRead: () => ({}), finishRead: () => finished++, reconcileIssues: items => items } },
        activeGroupId: 'sample', activeGroupTeamIds: ['sample-team'], activeGroup: {}, BACKEND_URL: 'https://synthetic.invalid',
        requestMissingPlanningInfo: async () => { throw error; },
        setMissingPlanningInfoTasks: () => writes++, setMissingInfoEpics: () => writes++,
        isAuthenticationRequiredError: candidate => candidate === error,
    };
    const read = new Function(...Object.keys(dependencies), `${body}; return fetchMissingPlanningInfo;`)(...Object.values(dependencies));
    await assert.rejects(read('sample-sprint'), candidate => candidate === error);
    assert.equal(finished, 1); assert.equal(cleaned, 1); assert.equal(writes, 0);
});


test('preserved catalog display updates never ask a dirty Planning review to change scope', () => {
    const start = source.indexOf('onState: nextState => {') + 'onState: nextState => {'.length;
    const end = source.indexOf('\n                    },\n                });', start);
    assert.ok(start > 0 && end > start, 'exercise the actual catalog consumer');
    let current, guarded = 0, changed = 0, queued;
    const dependencies = {
        setSprintCatalogState: state => { current = state; },
        sprintCatalogControllerRef: { current: { getState: () => current } },
        selectedSprintRef: { current: 42 }, setSelectedSprint: () => changed++, setSprintName: () => {},
        planningReviewGuardRef: { current: apply => { guarded++; queued = apply; } },
        sprintCatalogValidationKey: () => 'synthetic-validation', sprintCatalogPersistedValidationRef: { current: '' },
        sprintCatalogCacheRef: { current: null }, savedPrefsRef: { current: {} },
        loadUiPrefs: () => ({ selectedSprint: 42 }), saveUiPrefs: () => {}, setSprintError: () => {},
    };
    const consume = new Function(...Object.keys(dependencies), `return nextState => {${source.slice(start, end)}}`)(...Object.values(dependencies));
    consume({ authority: 'invalid', selectionPreserved: true, status: 'unknown', validatedSnapshot: null });
    consume({ authority: 'validated', selectionPreserved: true, status: 'ready', selectedSprintId: 42, validatedSnapshot: { sprints: [{ id: 99, name: 'Next' }] } });
    assert.equal(guarded, 0, 'automatic display updates cannot open the Save/Discard scope dialog');
    assert.equal(changed, 0, 'the selected Sprint remains held');
    consume({ authority: 'validated', selectionPreserved: false, status: 'ready', selectedSprintId: 99, validatedSnapshot: { sprints: [{ id: 99, name: 'Next' }] } });
    assert.equal(guarded, 1, 'manual fallback still guards a real scope change');
    assert.equal(changed, 0);
    queued(); assert.equal(changed, 1);
});
