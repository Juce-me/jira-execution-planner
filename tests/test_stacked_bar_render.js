const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const golden = require('./fixtures/stackedBarGolden.js');

// StackedBar is shared by the Project Track totals, breakdown and phase charts. The opt-in
// resolveSegmentStrip prop (#173) must leave every existing consumer's markup untouched.
function loadStackedBar() {
    const entryPoint = path.join(__dirname, '..', 'frontend', 'src', 'stats', 'StackedBar.jsx');
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

const rows = [
    { id: 'a', label: 'Alpha Team', total: 10, segments: [{ key: 'Committed', value: 8 }, { key: 'No track', value: 2, epicKeys: ['E-1'] }] },
    { id: 'b', label: 'Beta Team', total: 3.25, segments: [{ key: 'Flexible', value: 3.25 }] },
];
const order = ['Committed', 'Flexible', 'No track'];
const resolveColor = (key) => ({ Committed: '#5b6fd8', Flexible: '#e0a93b' }[key] || '#94a3b8');

function scenarios(StackedBar) {
    return {
        default: React.createElement(StackedBar, { rows, segmentOrder: order, resolveColor, ariaLabel: 'Bars' }),
        empty: React.createElement(StackedBar, { rows: [], segmentOrder: order, resolveColor, emptyText: 'Nothing.' }),
        link: React.createElement(StackedBar, {
            rows, segmentOrder: order, resolveColor, ariaLabel: 'Bars',
            resolveSegmentLink: ({ segmentKey, segment }) => (segmentKey === 'No track'
                ? { href: 'https://jira.example.test/issues/?jql=key%20in%20(E-1)', title: 'Open', ariaLabel: `Open ${segment.epicKeys.join(',')}` }
                : null),
        }),
        phase: React.createElement(StackedBar, {
            rows, segmentOrder: order, resolveColor, ariaLabel: 'Phase',
            formatValue: (value) => `${value}d`,
            formatReadout: ({ rowLabel, segmentKey, value }) => `${rowLabel} — ${segmentKey}: ${value}d`,
            renderRowLabel: (row) => React.createElement('a', { className: 'phase-row-link', href: '#' }, row.label),
            resolveLabel: (state) => state,
        }),
    };
}

test('StackedBar markup is unchanged for every existing consumer without resolveSegmentStrip', () => {
    const StackedBar = loadStackedBar();
    const rendered = Object.fromEntries(Object.entries(scenarios(StackedBar))
        .map(([name, element]) => [name, renderToStaticMarkup(element)]));
    if (process.env.UPDATE_STACKED_BAR_GOLDEN === '1') {
        require('node:fs').writeFileSync(path.join(__dirname, 'fixtures', 'stackedBarGolden.js'),
            '// Synthetic StackedBar markup captured before the #173 strip prop; regenerate with\n'
            + '// UPDATE_STACKED_BAR_GOLDEN=1 node --test tests/test_stacked_bar_render.js\n'
            + `module.exports = ${JSON.stringify(rendered, null, 4)};\n`);
    }
    assert.deepEqual(rendered, golden);
});

test('resolveSegmentStrip renders one aligned strip per rendered segment with SP-share parts', () => {
    const StackedBar = loadStackedBar();
    const parts = {
        Committed: [{ key: 'c1', label: 'Build', colour: '#597ef7', value: 6 }, { key: 'c2', label: 'Review', colour: '#13c2c2', value: 0 }, { key: 'c3', label: 'Done', colour: '#52c41a', value: 2 }],
        'No track': [{ key: 'c3', label: 'Done', colour: '#52c41a', value: 2 }],
        Flexible: [{ key: 'c1', label: 'Build', colour: '#597ef7', value: 3.25 }],
    };
    const markup = renderToStaticMarkup(React.createElement(StackedBar, {
        rows, segmentOrder: order, resolveColor, ariaLabel: 'Bars',
        resolveSegmentStrip: ({ segmentKey }) => ({ parts: parts[segmentKey] }),
    }));

    assert.equal((markup.match(/class="stacked-bar-track-stack"/g) || []).length, 2);
    const strips = [...markup.matchAll(/<div class="stacked-bar-strip" role="group" tabindex="0" style="width:([\d.]+)%" aria-label="([^"]+)">(.*?)<\/div>/g)];
    assert.deepEqual(strips.map((m) => m[1]), ['80', '20', '100']);
    assert.equal(strips[0][2], 'Alpha Team Committed: 8 SP · Build 6 SP · Review 0 SP · Done 2 SP');
    // Zero parts stay in the readout/label but are not drawn.
    assert.deepEqual([...strips[0][3].matchAll(/width:([\d.]+)%/g)].map((m) => m[1]), ['75', '25']);
    assert.doesNotMatch(markup, /class="stacked-bar-strip"[^>]*onclick/i);
});
