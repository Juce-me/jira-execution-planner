const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');

function loadChart() {
    const result = buildSync({ entryPoints: ['frontend/src/settings/PerformanceSettings.jsx'], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['react'] });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports.PerformanceTrend;
}

test('performance chart expands for spikes and preserves fixed target references', () => {
    const html = renderToStaticMarkup(React.createElement(loadChart(), { trend: [
        { date: '2026-09-08', sampleCount: 25, avgMs: 6000, p95Ms: 12000 },
    ] }));
    assert.match(html, /2s target/);
    assert.match(html, /4s SLO/);
    assert.match(html, /12\.00s/);
    for (const match of html.matchAll(/cy="([\d.]+)"/g)) {
        assert.ok(Number(match[1]) >= 24 && Number(match[1]) <= 176);
    }
    assert.match(html, /<table/);
});

test('empty performance chart does not imply zero latency', () => {
    const html = renderToStaticMarkup(React.createElement(loadChart(), { trend: [] }));
    assert.match(html, /No successful non-capped loads/);
    assert.doesNotMatch(html, /<polyline/);
});

function loadWeeks() {
    const result = buildSync({ entryPoints: ['frontend/src/settings/PerformanceBoardWeeks.jsx'], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'] });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
}

const phases = (wait, index, focused, rest) => ({ waitMs: wait, indexMs: index, focusedMs: focused, restMs: rest });
const week = (weekStart, overrides = {}) => ({
    weekStart, loads: 4, medianMs: 10000, p95Ms: 12000, phases: phases(5000, 1800, 1700, 1500),
    medianJiraRequests: 18, retries: 0, medianPayloadBytes: 600000, breachCount: 4, errors: 1, cancelled: 0,
    partial: false, ...overrides,
});
const sample = (loadId, recordedAt, total, revision, parts = phases(5000, 1800, 1700, total - 8500)) => ({
    loadId, recordedAt, durationMs: total, phases: parts, revision, environment: 'staging', jiraRequests: 18, jiraRetries: 0,
    issueCount: 449, epicCount: 165, payloadBytes: 682270, cacheState: 'miss', completeness: 'complete',
    peakChildSearches: 2, firstFocusedContentMs: parts.waitMs + parts.indexMs + parts.focusedMs, focusedCompleteMs: parts.indexMs + parts.focusedMs,
});
const render = (props) => {
    const { default: Weeks } = loadWeeks();
    return renderToStaticMarkup(React.createElement(Weeks, props));
};

test('weekly Board view stacks the four phase medians per week with a native-button legend and no native tooltips', () => {
    const html = render({
        weekly: { scopeType: 'component', mixedScopes: false, weeks: [week('2026-10-12'), week('2026-10-19', { partial: true })] },
        samples: [],
    });
    assert.equal(html.match(/data-phase="/g).length, 8, 'four phases in each of two weeks');
    for (const label of ['Before first byte', 'Epic index', 'Focused column', 'Other columns + render']) assert.ok(html.includes(label), label);
    assert.equal(html.match(/<button[^>]*aria-pressed="true"[^>]*performance-week-legend-item/g).length, 4);
    assert.match(html, /performance-week-p95-key/);
    assert.doesNotMatch(html, /<title>/, 'readouts are in-app, never native title tooltips');
    assert.match(html, /Oct 19\*/, 'a partial week is starred');
    assert.match(html, /median 10\.0s/);
    assert.match(html, /Week of Oct 19 \(so far\): median <strong>10\.00s<\/strong>/, 'the latest week is selected first');
    assert.match(html, /performance-reference/);
    assert.match(html, /2s target/);
    assert.match(html, /4s SLO/);
});

test('weekly table keeps numbers in right-aligned columns and marks the selected week', () => {
    const html = render({ weekly: { scopeType: 'component', mixedScopes: false, weeks: [week('2026-10-12'), week('2026-10-19')] }, samples: [] });
    assert.match(html, /<tr class="is-selected"><td><button[^>]*performance-week-pick[^>]*aria-pressed="true">Oct 19</);
    assert.match(html, /<th scope="col" class="num">Retries<\/th>/);
    assert.match(html, /<td class="num">586 KB<\/td>/);
});

test('loads list is limited to the selected week, with a revision divider and a truncation note', () => {
    const html = render({
        weekly: { scopeType: 'component', mixedScopes: false, weeks: [week('2026-10-19', { loads: 3 })] },
        samples: [
            sample('a', '2026-10-21T13:41:00+00:00', 5000, 'rev-new', phases(900, 1800, 1000, 1300)),
            sample('b', '2026-10-21T09:35:00+00:00', 11210, 'rev-old'),
            sample('c', '2026-10-12T09:35:00+00:00', 9000, 'rev-old'),
        ],
    });
    assert.match(html, /Loads in the week of Oct 19/);
    assert.match(html, /Wed 21 Oct · 13:41/);
    assert.doesNotMatch(html, /Mon 12 Oct/, 'another week');
    assert.match(html, /Revision changed: loads above ran on rev-new, loads below on rev-old/);
    assert.match(html, /Showing 2 of 3 loads/);
    assert.match(html, /aria-sort="descending"[^>]*><button[^>]*performance-sort[^>]*>Time \(UTC\)/);
    assert.equal(html.match(/performance-phase-bar/g).length, 2);
});

test('weekly view asks for one scope, or says there is nothing to split yet', () => {
    assert.match(render({ weekly: { scopeType: null, mixedScopes: true, weeks: [] }, samples: [] }), /Choose one Scope/);
    assert.match(render({ weekly: { scopeType: null, mixedScopes: false, weeks: [] }, samples: [] }), /No complete Board loads with a phase breakdown/);
    assert.match(render({ weekly: undefined, samples: [] }), /No complete Board loads with a phase breakdown/);
});

test('formatters follow the server grouping: UTC Monday weeks and stated-once UTC stamps', () => {
    const format = (() => {
        const result = buildSync({ entryPoints: ['frontend/src/settings/performanceFormat.js'], bundle: true, platform: 'node', format: 'cjs', write: false });
        const module = { exports: {} };
        new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
        return module.exports;
    })();
    assert.equal(format.weekStartOf('2026-10-21T09:35:26.558269+00:00'), '2026-10-19');
    assert.equal(format.weekStartOf('2026-10-25T23:59:59+00:00'), '2026-10-19', 'Sunday belongs to the Monday before');
    assert.equal(format.weekStartOf('2026-10-26T00:00:00+00:00'), '2026-10-26');
    assert.equal(format.weekLabel('2026-10-05'), 'Oct 5');
    assert.equal(format.loadTime('2026-10-21T09:05:00+00:00'), 'Wed 21 Oct · 09:05');
    assert.equal(format.sizeLabel(682270), '666 KB');
    assert.equal(format.sizeLabel(3 * 1024 * 1024), '3.0 MB');
    assert.equal(format.seconds(null), 'Unknown');
    const { niceMaximum, phaseTotal } = loadWeeks();
    assert.equal(niceMaximum(12820), 16000);
    assert.equal(niceMaximum(3000), 8000);
    assert.equal(phaseTotal(phases(1000, 2000, 3000, 4000)), 10000);
});
