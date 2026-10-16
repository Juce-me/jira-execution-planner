const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SOURCE_ROOT = path.join(__dirname, '..', 'frontend', 'src');

// The boundary "+" always portals into document.body, which the server renderer cannot do; the rows mode does not depend on it.
const stubBoundaryPlus = {
    name: 'stub-boundary-plus',
    setup(build) {
        build.onResolve({ filter: /^\.\/PlanningReviewBoundaryPlus\.jsx$/ }, () => ({ path: 'PlanningReviewBoundaryPlus', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'module.exports = () => null;' }));
    },
};

// One bundle holds the real table and the real store, so the seed the test sets is the seed the table reads.
let tablePromise;
const loadTable = () => { tablePromise = tablePromise || buildTable(); return tablePromise; };
async function buildTable() {
    const code = (await esbuild.build({
        stdin: {
            contents: "export { default as PlanningReviewTable } from './eng/PlanningReviewTable.jsx'; export { setPendingPlanningRowMode, resetShareViewForTests } from './shareView/store.js';",
            resolveDir: SOURCE_ROOT, loader: 'jsx',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], plugins: [stubBoundaryPlus],
    })).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
    return loaded.exports;
}

const noop = () => {};
const epic = { key: 'PROJ-1', id: '1001', summary: 'Synthetic epic', status: 'In Progress', priority: 'Major', storyPoints: 3, teamName: 'Synthetic team', teamId: 'team-1' };
const story = { key: 'PROJ-11', id: '2001', fields: { summary: 'Synthetic story', status: { name: 'To Do' }, priority: { name: 'Major' }, epicKey: 'PROJ-1', customfield_10004: 3, teamId: 'team-1', teamName: 'Synthetic team' } };
const review = {
    layouts: {}, columns: [], cells: {}, drafts: {}, capabilities: { canSave: false, reason: 'unavailable' }, loading: false, saving: false,
    error: '', conflict: null, unconfirmed: false, unavailableIssueIds: [], isRowReadable: () => true,
    setCell: () => ({ valid: true }), changeSchema: () => true, save: async () => true, discard: noop,
};
const tableProps = {
    epicGroups: [{ key: 'PROJ-1', epic, tasks: [story], requirements: [] }], visibleTasks: [story], review,
    jiraUrl: 'https://jira.example.test', getTeamInfo: () => ({ id: 'team-1', name: 'Synthetic team' }), admittedTeamCount: 1, admittedProjectCount: 1,
    renderPriorityIcon: noop,
};

// Each render is a new mount: the state initializer runs once per render here, as it does once per mount in the browser.
function mountTable(table) {
    globalThis.document = { body: {} };
    try { return renderToStaticMarkup(React.createElement(table.PlanningReviewTable, tableProps)); }
    finally { delete globalThis.document; }
}
const activeOption = markup => markup.match(/segmented-control-button active"[^>]*>([^<]+)</)?.[1];
const rowKinds = markup => Array.from(markup.matchAll(/<tr[^>]*data-row-kind="([a-z]+)"/g), match => match[1]);

test('a Planning table nobody seeded opens in Epics', async () => {
    const table = await loadTable();
    table.resetShareViewForTests();
    const markup = mountTable(table);
    assert.equal(activeOption(markup), 'Epics');
    assert.deepEqual(rowKinds(markup), ['epic']);
});

test('a link seed is consumed by the first table mount only; the next mount resets to Epics like any user choice', async () => {
    const table = await loadTable();
    table.resetShareViewForTests();
    table.setPendingPlanningRowMode('story');
    const first = mountTable(table);
    const second = mountTable(table);
    assert.equal(activeOption(first), 'Stories');
    assert.deepEqual(rowKinds(first), ['story']);
    assert.equal(activeOption(second), 'Epics');
    assert.deepEqual(rowKinds(second), ['epic']);
});

test('source: the seed is read lazily inside the table, and the app mounts without StrictMode, which would run the initializer twice', () => {
    const tableSource = fs.readFileSync(path.join(SOURCE_ROOT, 'eng', 'PlanningReviewTable.jsx'), 'utf8');
    assert.ok(tableSource.includes("import { takeInitialPlanningRowMode } from '../shareView/store.js';"));
    assert.ok(tableSource.includes("const [mode, setMode] = React.useState(() => takeInitialPlanningRowMode() || 'epic');"));
    assert.equal(tableSource.match(/takeInitialPlanningRowMode\(/g).length, 1, 'the seed is taken in one place');
    assert.equal(fs.readFileSync(path.join(SOURCE_ROOT, 'dashboard.jsx'), 'utf8').includes('StrictMode'), false,
        'StrictMode runs a state initializer twice: the second call would find the one-shot seed already taken');
});
