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

function loadCatchUp() {
    const result = buildSync({ entryPoints: ['frontend/src/settings/PerformanceCatchUpWeeks.jsx'], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'] });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
}

const metric = (avg, median, p95) => ({ avgMs: avg, medianMs: median, p95Ms: p95 });
const none = metric(null, null, null);
// A valid week: 12 successful loads; 14 list-eligible loads (the other two were an error and a cancellation after both lists arrived).
const catchWeek = (weekStart, overrides = {}) => ({ weekStart, partial: false, loads: 12, listLoads: 14, errors: 1, cancelled: 2, capped: 0,
    cacheHitShare: 0.25, listLoaded: metric(3200, 3000, 5200), fullyLoaded: metric(9000, 8500, 12000), ...overrides });
const renderCatchUp = weekly => renderToStaticMarkup(React.createElement(loadCatchUp().default, { weekly }));
const chartOf = (html, key) => html.match(new RegExp(`<svg[^>]*data-chart="${key}"[\\s\\S]*?</svg>`))[0];
const points = svg => [...svg.matchAll(/<(circle|rect)([^>]*data-point[^>]*)>/g)].map(([, kind, attrs]) => ({
    series: attrs.match(/data-point="(\w+)"/)[1], value: Number(attrs.match(/data-value="([\d.]+)"/)[1]),
    x: kind === 'circle' ? Number(attrs.match(/cx="([\d.]+)"/)[1])
        : Number(attrs.match(/ x="([\d.]+)"/)[1]) + Number(attrs.match(/width="([\d.]+)"/)[1]) / 2,
    y: kind === 'circle' ? Number(attrs.match(/cy="([\d.]+)"/)[1])
        : Number(attrs.match(/ y="([\d.]+)"/)[1]) + Number(attrs.match(/height="([\d.]+)"/)[1]) / 2 }));
const seriesValues = (svg, series) => points(svg).filter(point => point.series === series).map(point => point.value);
const plotY = (value, axis) => 22 + 192 * (1 - value / axis);

test('Catch Up weekly view draws average, median and p95 lines for list and full loads', () => {
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12'), catchWeek('2026-10-19', { partial: true })] });
    assert.match(html, /^<section aria-label="Catch Up weekly load times"/);
    assert.equal(html.match(/<polyline[^>]*data-series=/g).length, 6, 'three series in each of two charts');
    assert.equal(html.match(/data-week-hit=/g).length, 4);
    assert.equal(html.match(/<button(?=[^>]*aria-pressed="true")(?=[^>]*performance-week-legend-item)[^>]*>/g).length, 3);
    assert.match(html, /Average<\/button>[\s\S]*Median<\/button>[\s\S]*p95<\/button>/, 'legend order');
    assert.equal(html.match(/class="burnout-color performance-phase is-(avg|median|p95)"/g).length, 3, 'legend swatches reuse the phase hook');
    assert.equal(html.match(/<div class="performance-week-chart"/g).length, 2, 'each chart is its own readout boundary');
    assert.doesNotMatch(html, /<title>|\stitle=/, 'readouts are in-app, never native title tooltips');
    assert.equal(html.match(/2s target/g).length, 2);
    assert.equal(html.match(/4s SLO/g).length, 2);
    assert.match(html, /Oct 19\*/);
    assert.doesNotMatch(html, /Oct 12\*/, 'only the partial week is starred');
    assert.ok(chartOf(html, 'listLoaded').includes('Oct 19*') && chartOf(html, 'fullyLoaded').includes('Oct 19*')
        && !chartOf(html, 'listLoaded').includes('Oct 12*'), 'the chart labels star the partial week');
    assert.match(html, /<details[^>]*open[^>]*><summary>Weekly table/);
    assert.match(html, /<details(?![^>]*open)[^>]*><summary>About the weekly charts/);
    assert.match(html, /aria-label="Weekly average, median and p95 of List loaded time for Catch Up\. Exact values follow in the table\."/);
    assert.match(chartOf(html, 'listLoaded').match(/<rect[^>]*data-point="p95Ms"[^>]*>/)[0], /width="8"/);
    assert.match(html, /performance-table-scroll"><table/);
    for (const copy of [
        'Counts a load even when its dependency request failed or it was cancelled afterwards. Measured from the start of the data requests; downloading and starting the app is not included.',
        'Time until the issue lists and the requested dependencies have loaded and painted. Successful loads only.',
        'Weeks are UTC calendar weeks starting Monday. * marks a partial week: the current week is still filling, and the oldest week can begin before the 30-day window. Neither measurement includes the readiness check or alerts.',
        'Each week blends every revision, cache state, Sprint and Group in the current selection; Cache hit shows how much of the week was served from cache. Use the Group, Sprint and Revision filters to compare like with like.',
        'Fewer than 20 loads in a week is preliminary: its p95 is close to the slowest load.',
        'With dependencies hidden or skipped, Fully loaded ends with the lists.']) assert.ok(html.includes(copy), copy);
});

test('each chart plots its own metric under its own heading, weeks in order', () => {
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12'), catchWeek('2026-10-19', { listLoaded: metric(1000, 900, 1500), fullyLoaded: metric(2000, 1800, 2500), listLoads: 5, loads: 4 })] });
    const list = chartOf(html, 'listLoaded');
    const full = chartOf(html, 'fullyLoaded');
    assert.ok(html.indexOf('List loaded, by week') < html.indexOf(list) && html.indexOf(list) < html.indexOf('Fully loaded, by week')
        && html.indexOf('Fully loaded, by week') < html.indexOf(full), 'heading, chart, heading, chart');
    assert.deepEqual([seriesValues(list, 'avgMs'), seriesValues(list, 'medianMs'), seriesValues(list, 'p95Ms')], [[3200, 1000], [3000, 900], [5200, 1500]]);
    assert.deepEqual([seriesValues(full, 'avgMs'), seriesValues(full, 'medianMs'), seriesValues(full, 'p95Ms')], [[9000, 2000], [8500, 1800], [12000, 2500]]);
    for (const svg of [list, full]) assert.deepEqual([...svg.matchAll(/data-week-hit="([\d-]+)"/g)].map(match => match[1]), ['2026-10-12', '2026-10-19']);
    assert.ok(list.includes('14 loads') && list.includes('5 loads') && !list.includes('12 loads'), 'the list chart labels list loads');
    assert.ok(full.includes('12 loads') && full.includes('4 loads') && !full.includes('14 loads'), 'the full chart labels full loads');
    const listNote = 'Time until both the Product and Tech issue lists arrive';
    const fullNote = 'Time until the issue lists and the requested dependencies have loaded and painted.';
    assert.ok(html.indexOf('List loaded, by week') < html.indexOf(listNote) && html.indexOf(listNote) < html.indexOf(list), 'the list note sits under the list heading');
    assert.ok(html.indexOf('Fully loaded, by week') < html.indexOf(fullNote) && html.indexOf(fullNote) < html.indexOf(full), 'the full note sits under the full heading');
    for (const svg of [list, full]) for (const series of ['avgMs', 'medianMs', 'p95Ms']) {
        const xs = points(svg).filter(point => point.series === series).map(point => point.x);
        assert.ok(xs.every((x, index) => index === 0 || x > xs[index - 1]), `${series} weeks run left to right`);
    }
});

test('each chart sizes its own axis from its largest average, median or p95 and draws every mark at its height', () => {
    const weeks = [catchWeek('2026-10-05', { listLoaded: metric(140, 120, 160), fullyLoaded: metric(150, 130, 170) }),
        catchWeek('2026-10-12', { listLoaded: metric(4000, 3000, 9000), fullyLoaded: metric(9000, 8500, 12000) }),
        catchWeek('2026-10-19', { listLoaded: metric(4900, 3000, 3000), fullyLoaded: metric(30000, 20000, 12000) })];
    const html = renderCatchUp({ weeks });
    // List axis: the 9 s p95 decides (niceMaximum = 12000). Full axis: the 30 s average decides (niceMaximum = 40000).
    for (const [key, axis] of [['listLoaded', 12000], ['fullyLoaded', 40000]]) {
        const found = points(chartOf(html, key));
        assert.equal(found.length, 9);
        for (const point of found) {
            assert.ok(Math.abs(point.y - plotY(point.value, axis)) < 0.5, `${key} ${point.series} ${point.value}`);
            assert.ok(point.y >= 22 && point.y <= 214, `${point.y} inside the 22 to 214 plot`);
        }
    }
    assert.doesNotMatch(html, /NaN/);
});

test('one week draws markers without a line; a gap week breaks the line', () => {
    const one = renderCatchUp({ weeks: [catchWeek('2026-10-19')] });
    assert.doesNotMatch(one, /<polyline/);
    assert.equal(one.match(/data-point=/g).length, 6);
    const gap = renderCatchUp({ weeks: [catchWeek('2026-09-21'), catchWeek('2026-09-28'),
        catchWeek('2026-10-05', { listLoads: 0, listLoaded: none, cacheHitShare: null }), catchWeek('2026-10-12'), catchWeek('2026-10-19')] });
    assert.equal(gap.match(/<polyline[^>]*data-series=/g).length, 9, 'list chart: two segments per series; full chart: one');
    assert.equal(gap.match(/data-point=/g).length, 27, 'list chart skips the gap week: 4 weeks x 3 series; full chart 5 x 3');
});

test('a calendar week missing from the response breaks the line, and consecutive weeks keep one line', () => {
    const lines = svg => [...svg.matchAll(/<polyline[^>]*points="([^"]*)"[^>]*data-series="(\w+)"/g)]
        .map(([, list, series]) => ({ series, points: list.split(' ').length }));
    const missing = renderCatchUp({ weeks: [catchWeek('2026-09-14'), catchWeek('2026-09-21'), catchWeek('2026-10-05'), catchWeek('2026-10-12')] });
    assert.equal(missing.match(/<polyline[^>]*data-series=/g).length, 12, 'two runs per series in each of two charts');
    assert.equal(missing.match(/data-point=/g).length, 24, 'every week keeps its markers: 4 weeks x 3 series x 2 charts');
    for (const key of ['listLoaded', 'fullyLoaded']) {
        const svg = chartOf(missing, key);
        for (const series of ['avgMs', 'medianMs', 'p95Ms']) {
            assert.deepEqual(lines(svg).filter(line => line.series === series).map(line => line.points), [2, 2], `${key} ${series}`);
        }
        const xs = points(svg).filter(point => point.series === 'avgMs').map(point => point.x);
        assert.ok(Math.abs((xs[1] - xs[0]) - (xs[2] - xs[1])) < 0.01, 'markers keep equal slot spacing across the missing week');
    }
    const consecutive = renderCatchUp({ weeks: [catchWeek('2026-09-14'), catchWeek('2026-09-21'), catchWeek('2026-09-28'), catchWeek('2026-10-05')] });
    assert.equal(consecutive.match(/<polyline[^>]*data-series=/g).length, 6, 'one line per series in each of two charts');
    for (const key of ['listLoaded', 'fullyLoaded']) assert.deepEqual(lines(chartOf(consecutive, key)).map(line => line.points), [4, 4, 4]);
});

test('the 2s and 4s reference labels keep a text height apart on a large axis and stay by their lines otherwise', () => {
    // { line, text }: the reference line's y and its label's baseline y, in viewBox units.
    const reference = (svg, label) => {
        const [, line, text] = svg.match(new RegExp(`<g class="performance-reference"><line[^>]*y1="([\\d.]+)"[^>]*></line><text[^>]*y="([\\d.]+)"[^>]*>${label}<`));
        return { line: Number(line), text: Number(text) };
    };
    for (const slowest of [60000, 120000]) {
        const html = renderCatchUp({ weeks: [catchWeek('2026-10-12'), catchWeek('2026-10-19', { fullyLoaded: metric(9000, 8500, slowest) })] });
        const target = reference(chartOf(html, 'fullyLoaded'), '2s target');
        const slo = reference(chartOf(html, 'fullyLoaded'), '4s SLO');
        assert.ok(target.text - slo.text >= 12, `${slowest} ms axis: baselines ${slo.text} and ${target.text} are at least 12 apart`);
        assert.ok(Math.abs((target.text - (target.line + 4)) - ((slo.line + 4) - slo.text)) < 0.01, 'the 2s label moves down as far as the 4s label moves up');
        assert.ok(target.text <= 256 && slo.text >= 22, 'both labels stay inside the drawing');
    }
    const list = chartOf(renderCatchUp({ weeks: [catchWeek('2026-10-12')] }), 'listLoaded');
    for (const label of ['2s target', '4s SLO']) {
        const { line, text } = reference(list, label);
        assert.ok(Math.abs(text - (line + 4)) < 0.01, `${label} sits by its line when the lines are far apart`);
    }
});

test('an empty selection and a chart with no qualifying week say so', () => {
    for (const weekly of [{ weeks: [] }, undefined]) {
        const html = renderCatchUp(weekly);
        assert.match(html, /No Catch Up loads in this selection yet\./);
        assert.doesNotMatch(html, /<svg/);
    }
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12', { listLoads: 0, listLoaded: none, cacheHitShare: null })] });
    assert.match(html, /<p role="status"[^>]*>No loads in this selection reached this measurement yet\./);
    assert.equal(html.match(/data-chart=/g).length, 1, 'only the Fully loaded chart is drawn');
});

test('Catch Up weekly table keeps the exact numbers in the right column order and alignment', () => {
    const html = renderCatchUp({ weeks: [catchWeek('2026-10-12'), catchWeek('2026-10-19', { partial: true, cacheHitShare: 0.666 }),
        catchWeek('2026-10-26', { listLoads: 0, listLoaded: none, cacheHitShare: null })] });
    assert.match(html, /<th scope="col">Week<\/th><th scope="col" class="num">List loads<\/th><th scope="col" class="num">List avg<\/th><th scope="col" class="num">List median<\/th><th scope="col" class="num">List p95<\/th><th scope="col" class="num">Full loads<\/th><th scope="col" class="num">Full avg<\/th><th scope="col" class="num">Full median<\/th><th scope="col" class="num">Full p95<\/th><th scope="col" class="num">Cache hit<\/th><th scope="col" class="num">Errors<\/th><th scope="col" class="num">Cancelled<\/th><th scope="col" class="num">Capped<\/th>/);
    assert.match(html, /<td>Oct 12<\/td><td class="num">14<\/td><td class="num">3\.20s<\/td><td class="num">3\.00s<\/td><td class="num">5\.20s<\/td><td class="num">12<\/td><td class="num">9\.00s<\/td><td class="num">8\.50s<\/td><td class="num">12\.00s<\/td><td class="num">25%<\/td><td class="num">1<\/td><td class="num">2<\/td><td class="num">0<\/td>/);
    assert.match(html, /<td>Oct 19\*<\/td>[\s\S]*?<td class="num">67%<\/td>/, 'a partial week is starred in the table and the share is rounded');
    assert.match(html, /<td>Oct 26<\/td><td class="num">0<\/td><td class="num">Unknown<\/td><td class="num">Unknown<\/td><td class="num">Unknown<\/td>[\s\S]*?<td class="num">12\.00s<\/td><td class="num">Unknown<\/td><td class="num">1<\/td>/);
});

test('the week contract is pinned and the component never fetches or emits analytics', () => {
    assert.deepEqual(Object.keys(catchWeek('2026-10-12')).sort(),
        ['cacheHitShare', 'cancelled', 'capped', 'errors', 'fullyLoaded', 'listLoaded', 'listLoads', 'loads', 'partial', 'weekStart']);
    const source = require('node:fs').readFileSync('frontend/src/settings/PerformanceCatchUpWeeks.jsx', 'utf8');
    assert.doesNotMatch(source, /dataLayer|analytics|fetch\(|api\//);
});

function loadEpm() {
    const result = buildSync({ entryPoints: ['frontend/src/settings/PerformanceEpmWeeks.jsx'], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'] });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports;
}
const epmWeek = (weekStart, overrides = {}) => ({ weekStart, partial: false, loads: 12, listLoads: 14, errors: 1, cancelled: 2,
    projectsListed: metric(600, 500, 900), rollupLoaded: metric(4000, 3500, 7000), ...overrides });
const renderEpm = props => renderToStaticMarkup(React.createElement(loadEpm().default, props));

test('EPM weekly view plots Projects listed and Rollup loaded with average, median and p95 like Catch Up', () => {
    const html = renderEpm({ weekly: { weeks: [epmWeek('2026-10-12'), epmWeek('2026-10-19', { partial: true })] },
        projects: [{ projectId: 'p-2', name: 'Synthetic Two', loads: 5, avgMs: 4000, medianMs: 3000, p95Ms: 8000 },
            { projectId: 'p-1', name: 'Synthetic One', loads: 6, avgMs: 1000, medianMs: 900, p95Ms: 1200 }] });
    assert.match(html, /aria-label="EPM weekly load times"/);
    assert.match(html, /<h4>Projects listed, by week<\/h4>/);
    assert.match(html, /<h4>Rollup loaded, by week<\/h4>/);
    assert.deepEqual(seriesValues(chartOf(html, 'projectsListed'), 'p95Ms'), [900, 900]);
    assert.deepEqual(seriesValues(chartOf(html, 'rollupLoaded'), 'medianMs'), [3500, 3500]);
    assert.match(html, /<td>Oct 19\*<\/td>/);
    assert.match(html, /aria-pressed="true"[^>]*>[\s\S]*?Average/);
    assert.match(html, /<th scope="row">Synthetic Two<\/th><td class="num">5<\/td><td class="num">4\.00s<\/td><td class="num">3\.00s<\/td><td class="num">8\.00s<\/td>/);
    assert.ok(html.indexOf('Synthetic Two') < html.indexOf('Synthetic One'), 'slowest p95 first, as the server ranks them');
    assert.doesNotMatch(html, /title=|cache hit|capped/);
});

test('EPM weekly view names the selected project, tolerates empty data and never fetches', () => {
    const filtered = renderEpm({ weekly: { weeks: [epmWeek('2026-10-12')] }, projectName: 'Synthetic One' });
    assert.match(filtered, /Rollup time of Synthetic One/);
    assert.doesNotMatch(filtered, /Rollup time by project/);
    assert.match(renderEpm({ weekly: { weeks: [] } }), /No EPM loads in this selection yet/);
    const noRollups = renderEpm({ weekly: { weeks: [epmWeek('2026-10-12', { loads: 0, rollupLoaded: metric(null, null, null) })] } });
    assert.match(noRollups, /No loads in this selection reached this measurement yet/);
    const source = require('node:fs').readFileSync('frontend/src/settings/PerformanceEpmWeeks.jsx', 'utf8');
    assert.doesNotMatch(source, /dataLayer|analytics|fetch\(|api\//);
});
