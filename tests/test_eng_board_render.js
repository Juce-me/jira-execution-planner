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
