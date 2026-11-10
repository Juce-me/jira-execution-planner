const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// The Planning overview summary names the count with the singular child word for exactly one and the plural otherwise.
function loadSummary() {
    const code = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '../frontend/src/eng/PlanningOverviewPanel.jsx')], bundle: true, write: false,
        format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' },
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports.PlanningOverviewSummary;
}

const PlanningOverviewSummary = loadSummary();
const text = props => renderToStaticMarkup(React.createElement(PlanningOverviewSummary, props)).replace(/<[^>]+>/g, '');

test('one planned story reads singular, every other count plural', () => {
    assert.equal(text({ planned: true, count: 1, sp: 1, capacity: 5 }), '1 story · 1.0 SP · Cap 5.0 SP');
    assert.equal(text({ planned: true, count: 0, sp: 0, capacity: 5 }), '0 stories · 0.0 SP · Cap 5.0 SP');
    assert.equal(text({ planned: true, count: 2, sp: 3, capacity: null }), '2 stories · 3.0 SP · Cap unavailable');
});

test('the configured child words are used for both forms', () => {
    assert.equal(text({ childSingular: 'epic', childPlural: 'epics', planned: true, count: 1, sp: 8, capacity: null }), '1 epic · 8.0 SP · Cap unavailable');
    assert.equal(text({ childSingular: 'epic', childPlural: 'epics', planned: true, count: 3, sp: 8, capacity: null }), '3 epics · 8.0 SP · Cap unavailable');
});
