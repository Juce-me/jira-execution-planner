const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engTaskUtils.js');
}

test('resetEngFacetFilters resets only the four Catch Up facet setters and emits no analytics', async () => {
    const { resetEngFacetFilters } = await loadModule();
    const calls = [];
    const setter = (name) => (value) => calls.push([name, value]);
    const trackFilterChanged = () => calls.push(['analytics']);

    resetEngFacetFilters({
        setEngStatusFilter: setter('status'),
        setEngPriorityFilter: setter('priority'),
        defaultEngStatusFilter: { hidden: ['Killed'] },
        setShowTech: setter('tech'),
        setShowProduct: setter('product'),
        trackFilterChanged,
    });

    assert.deepEqual(calls, [
        ['status', { hidden: ['Killed'] }],
        ['priority', null],
        ['tech', true],
        ['product', true],
    ]);
});
