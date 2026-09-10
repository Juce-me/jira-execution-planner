const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadEngBoardView() {
    const entryPoint = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngBoardView.jsx');
    const result = esbuild.buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        external: ['react', 'react-dom'],
        loader: { '.jsx': 'jsx', '.js': 'jsx' },
    });
    const mod = new Module(entryPoint, module);
    mod.paths = Module._nodeModulePaths(path.dirname(entryPoint));
    mod._compile(result.outputFiles[0].text, entryPoint);
    return mod.exports.default;
}

const engFilters = {
    facets: [], selection: {}, counts: {}, scopeTotal: 0,
    subject: 'Filtering epics', readoutUnit: 'of 0 epics', activeFacetCount: 0,
};

function renderBoard(overrides = {}) {
    const EngBoardView = loadEngBoardView();
    return renderToStaticMarkup(React.createElement(EngBoardView, {
        board: { columns: [{ id: 'col-00000001', name: 'To Do', colour: '#8c8c8c', star: true, statuses: ['To Do'] }] },
        epicGroups: [],
        engFilters,
        onFacetChange: () => {},
        ...overrides,
    }));
}

test('EngBoardView renders shared loading state before its normal empty result', () => {
    const markup = renderBoard({ loading: true, error: 'ignored while loading' });
    assert.match(markup, /Loading tasks/);
    assert.match(markup, /Refreshing Jira sprint work\./);
    assert.doesNotMatch(markup, /No epics found/);
});

test('EngBoardView renders retryable fetch errors instead of a normal empty result', () => {
    const markup = renderBoard({ error: 'Jira fetch failed', onRetry: () => {} });
    assert.match(markup, /class="error"/);
    assert.match(markup, /Jira fetch failed/);
    assert.match(markup, />Retry<\/button>/);
    assert.doesNotMatch(markup, /No epics found/);
});

test('EngBoardView keeps the normal empty result when loading and error are clear', () => {
    const markup = renderBoard();
    assert.match(markup, /No epics found/);
    assert.doesNotMatch(markup, /Loading tasks|class="error"/);
});

test('strict Board never renders provisional zero as a final empty result', () => {
    const strictColumns = [{
        id: 'active', name: 'Active', colour: '#8c8c8c', star: true, statuses: ['In Progress'],
        terminal: false, isUnmapped: false, isUnconfigured: false, epicGroups: [], epicCount: 0,
        storyPoints: 0, breach: null,
    }];
    const markup = renderBoard({
        strictColumns,
        loading: true,
        authorityPending: true,
        scope: { type: 'sprint', sprintId: 21 },
        allWorkAvailable: true,
        onScopeChange: () => {},
    });

    assert.match(markup, /Loading tasks/);
    assert.doesNotMatch(markup, /All work|Loaded so far|No epics found|<select/);
});

test('Board view does not render its own sprint scope control', () => {
    const markup = renderBoard({
        scope: { type: 'sprint', sprintId: 21 },
        sprintName: 'Sprint 21',
        allWorkAvailable: false,
    });
    assert.doesNotMatch(markup, /All work|Toggle between the selected sprint/);
    assert.doesNotMatch(markup, /<select/);
});

test('strict stale snapshot is labelled while retryable refresh failure remains visible', () => {
    const strictColumns = [{
        id: 'active', name: 'Active', colour: '#8c8c8c', star: true, statuses: ['In Progress'],
        terminal: false, isUnmapped: false, isUnconfigured: false, epicGroups: [], epicCount: 0,
        storyPoints: 0, breach: null,
    }];
    const markup = renderBoard({
        strictColumns,
        stale: true,
        error: 'Jira is temporarily unavailable.',
        onRetry: () => {},
        scope: { type: 'all_work' },
        allWorkAvailable: true,
    });
    assert.match(markup, /Showing last complete Board data/);
    assert.match(markup, /Jira is temporarily unavailable/);
    assert.match(markup, />Retry</);
    assert.match(markup, /class="eng-board"/);
});

test('strict structural columns without epics do not masquerade as loaded partial data', () => {
    const strictColumns = [{
        id: 'active', name: 'Active', colour: '#8c8c8c', star: true, statuses: ['In Progress'],
        terminal: false, isUnmapped: false, isUnconfigured: false, epicGroups: [], epicCount: 0,
        storyPoints: 0, breach: null,
    }];
    const markup = renderBoard({
        strictColumns,
        authorityPending: true,
        error: 'Board load failed: partial error.',
        onRetry: () => {},
        scope: { type: 'sprint', sprintId: 21 },
        allWorkAvailable: true,
    });
    assert.doesNotMatch(markup, /Loaded so far/);
    assert.match(markup, /Board load failed: partial error/);
    assert.match(markup, />Retry</);
    assert.doesNotMatch(markup, /class="eng-board"/);
});

test('strict pending cards show provisional work counts and gray placeholders without false zero totals', () => {
    const group = { key: 'E-1', epic: { key: 'E-1', summary: 'Visible while children load', status: 'In Progress' },
        tasks: [], storyPoints: 0, childrenIncomplete: true, childrenLoading: true,
        childProgress: { total: 4, done: 2, inProgress: 1, doneWidth: '50%', inProgressWidth: '25%' } };
    const column = { id: 'active', name: 'Active', colour: '#597ef7', star: true, statuses: ['In Progress'],
        epicGroups: [group], epicCount: 1, storyPoints: 0, breach: null };
    const markup = renderBoard({ strictColumns: [column], epicGroups: [group], loading: true, authorityPending: true });
    assert.match(markup, /Visible while children load/);
    assert.match(markup, /2 of 4\+ work items/);
    assert.match(markup, /board-loading-bar/);
    assert.match(markup, /SP pending/);
    assert.doesNotMatch(markup, /0 of 0|0\.0 sp/);
    assert.match(markup, /aria-busy="true"/);
});
