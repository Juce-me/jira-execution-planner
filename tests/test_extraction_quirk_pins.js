const test = require('node:test');
const assert = require('node:assert/strict');
const { readOwnerSource } = require('./frontend_source_helpers');

const OWNERS = ['frontend/src/dashboard.jsx', 'frontend/src/scenario', 'frontend/src/settings', 'frontend/src/epm'];
const count = (source, text) => source.split(text).length - 1;

test('analytics call counts do not change when code moves between owner files', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'trackScenarioAction(' });
    assert.equal(count(source, 'trackScenarioAction('), 17);
    assert.equal(count(source, 'trackSettingsAction('), 33);
});

test('scheduleScenarioEdgeUpdate keeps its late-assignment quirk', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'let scheduleScenarioEdgeUpdate;' });
    const declaration = source.indexOf('let scheduleScenarioEdgeUpdate;');
    const layoutDeps = source.indexOf('scenarioLaneMeta, scheduleScenarioEdgeUpdate, perfEnabled]);');
    const assignment = source.indexOf('scheduleScenarioEdgeUpdate = React.useCallback(() => {');
    assert.equal(count(source, 'let scheduleScenarioEdgeUpdate;'), 1);
    assert.equal(count(source, 'scheduleScenarioEdgeUpdate = React.useCallback(() => {'), 1);
    // The layout effect's dependency array reads the variable before the assignment has run.
    assert.ok(declaration !== -1 && declaration < layoutDeps && layoutDeps < assignment);
});
