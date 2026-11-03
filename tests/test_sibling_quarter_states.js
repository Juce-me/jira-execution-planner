const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../frontend/src/workStructure/useSiblingQuarterStates.js');
const LEGACY = { id: 'legacy', name: 'Legacy', revision: 3, digest: 'd3', model: 'legacy', fromQuarter: null, throughQuarter: '2026Q4' };
const DELIVERY = { id: 'delivery', name: 'DELIVERY', revision: 2, model: 'rnd_2027', fromQuarter: '2027Q1', throughQuarter: null };
const viewing = summary => ({ id: summary.id, revision: summary.revision, quarter: summary.fromQuarter || summary.throughQuarter });

test('siblings are the other configurations, each keyed by its own catalog identity', async () => {
    const { siblingCatalogs } = await load();
    const catalogs = siblingCatalogs([LEGACY, DELIVERY], viewing(DELIVERY));
    assert.deepEqual(catalogs.map(({ key, id }) => [key, id]), [['legacy|3|d3', 'legacy']]);
    assert.equal(catalogs[0].context.quarter, '2026Q4');
    assert.deepEqual(siblingCatalogs([LEGACY, DELIVERY], viewing(LEGACY)).map(({ id }) => id), ['delivery']);
});

test('a catalog answer gives each quarter its best state from the sibling\'s own rows; a non-catalog body is no observation', async () => {
    const { siblingStatesFromBody } = await load();
    const body = { sprints: [
        { id: 1, name: '2026Q3', state: 'future', configurationId: 'legacy' },
        { id: 2, name: '2026Q3', state: 'closed', configurationId: 'legacy' },
        { id: 3, name: '2026Q4', state: 'active', configurationId: 'legacy' },
        { id: 9, name: '2027Q1', state: 'future', configurationId: 'delivery' },
        { id: 4, name: 'Team sprint 7', state: 'active', configurationId: 'legacy' },
    ] };
    assert.deepEqual(siblingStatesFromBody(body, 'legacy'), { '2026Q3': 'closed', '2026Q4': 'active' });
    assert.deepEqual(siblingStatesFromBody({ sprints: [] }, 'legacy'), {}, 'a complete empty catalog observes nothing');
    assert.equal(siblingStatesFromBody({ error: 'jira_unavailable' }, 'legacy'), null);
});

test('only the current catalog identity is visible: a revision change or a context switch drops the old quarters', async () => {
    const { siblingCatalogs, visibleSiblingStates } = await load();
    const observations = { 'legacy|3|d3': { '2026Q4': 'active' }, 'legacy|2|d2': { '2026Q1': 'closed' }, 'delivery|2|': { '2027Q1': 'future' } };
    assert.deepEqual(visibleSiblingStates(observations, siblingCatalogs([LEGACY, DELIVERY], viewing(DELIVERY))), { '2026Q4': 'active' });
    assert.deepEqual(visibleSiblingStates(observations, siblingCatalogs([LEGACY, DELIVERY], viewing(LEGACY))), { '2027Q1': 'future' });
    const bumped = siblingCatalogs([{ ...LEGACY, revision: 4, digest: 'd4' }, DELIVERY], viewing(DELIVERY));
    assert.deepEqual(visibleSiblingStates(observations, bumped), {}, 'a new revision shows nothing until its own answer arrives');
});
