const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engProjectTrack.js');
}

test('classifies canonical Epic Project Track values case-insensitively', async () => {
    const { classifyEpicProjectTrack } = await loadModule();
    assert.deepEqual(classifyEpicProjectTrack({ projectTrack: ' Committed ' }), {
        kind: 'recognized',
        id: 'committed',
    });
    assert.deepEqual(classifyEpicProjectTrack({ projectTrack: 'FLEXIBLE' }), {
        kind: 'recognized',
        id: 'flexible',
    });
});

test('keeps unset, unknown, and missing Epic states distinct', async () => {
    const { classifyEpicProjectTrack } = await loadModule();
    for (const epic of [{ projectTrack: null }, {}, { projectTrack: '   ' }]) {
        assert.deepEqual(classifyEpicProjectTrack(epic), { kind: 'unset', id: null });
    }
    assert.deepEqual(classifyEpicProjectTrack({ projectTrack: 'Other' }), {
        kind: 'unknown',
        id: null,
    });
    assert.deepEqual(classifyEpicProjectTrack(null), {
        kind: 'missing_epic',
        id: null,
    });
});
