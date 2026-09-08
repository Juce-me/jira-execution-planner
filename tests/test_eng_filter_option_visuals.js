const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engFilterOptionVisuals.js');
}

test('Status uses the first exact owning valid board colour', async () => {
    const { resolveEngFilterOptionVisual } = await loadModule();
    const columns = [
        { colour: '#597ef7', statuses: ['In Progress'] },
        { colour: '#ff4d4f', statuses: ['In Progress'] },
    ];
    assert.deepEqual(resolveEngFilterOptionVisual({ facetId: 'status', option: { label: 'In Progress' }, boardColumns: columns }), {
        kind: 'status_label', configuredColour: '#597ef7',
    });
    assert.deepEqual(resolveEngFilterOptionVisual({ facetId: 'status', option: { label: 'in progress' }, boardColumns: columns }), {
        kind: 'status_label', configuredColour: null,
    });
});

test('Status rejects invalid and malformed board colours safely', async () => {
    const { resolveEngFilterOptionVisual } = await loadModule();
    assert.deepEqual(resolveEngFilterOptionVisual({ facetId: 'status', option: { label: 'Done' }, boardColumns: [{ colour: 'red', statuses: ['Done'] }] }), {
        kind: 'status_label', configuredColour: null,
    });
    assert.deepEqual(resolveEngFilterOptionVisual({ facetId: 'status', option: { label: 'Done' }, boardColumns: null }), {
        kind: 'status_label', configuredColour: null,
    });
});

test('Priority and Project Track reuse presentation vocabularies while text-only facets resolve null', async () => {
    const { resolveEngFilterOptionVisual } = await loadModule();
    assert.deepEqual(resolveEngFilterOptionVisual({ facetId: 'priority', option: { label: 'Critical' } }), { kind: 'priority', value: 'Critical' });
    assert.deepEqual(resolveEngFilterOptionVisual({ facetId: 'track', option: { label: 'Committed' } }), { kind: 'project_track', value: 'Committed' });
    assert.equal(resolveEngFilterOptionVisual({ facetId: 'projects', option: { label: 'Tech' } }), null);
    assert.equal(resolveEngFilterOptionVisual({ facetId: 'assignee', option: { label: 'Anyone' } }), null);
    assert.equal(resolveEngFilterOptionVisual({ facetId: 'unknown', option: { label: 'Anything' } }), null);
});
