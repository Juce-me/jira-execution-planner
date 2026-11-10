// DELIVERY No Allocation in the Stats Teams table and the Effort Split chart; Legacy markup stays as it was.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '..');

function load(file) {
    const entry = path.join(root, 'frontend', 'src', 'stats', file);
    const code = esbuild.buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' } }).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
    return loaded.exports.default;
}

const count = (markup, needle) => markup.split(needle).length - 1;
const metrics = (done, incomplete) => ({ done, incomplete, killed: 0 });
const team = {
    id: 'team-a', name: 'Alpha Team', straight: metrics(4, 2), product: metrics(1, 1), tech: metrics(1, 0), none: metrics(2, 1),
    weighted: metrics(4, 2), weightedProduct: metrics(1, 1), weightedTech: metrics(1, 0), weightedNone: metrics(2, 1),
    straightRate: 0.5, weightedRate: 0.5,
};
const teamsProps = extra => ({
    open: true, statsTeamRows: [team], statsBarColumns: 1, statsGraphMode: 'straight',
    buildStatLink: value => (value ? 'https://jira.example/issues/?jql=x' : ''),
    computeRate: value => { const denominator = (value?.done || 0) + (value?.incomplete || 0); return denominator ? value.done / denominator : 0; },
    formatPercent: value => `${(value * 100).toFixed(2)}%`, getRateClass: () => '', ...extra,
});

test('DELIVERY Stats Teams adds a No Allocation column and drops the project-based Product/Tech links', () => {
    const StatsTeamsView = load('StatsTeamsView.jsx');
    const markup = renderToStaticMarkup(React.createElement(StatsTeamsView, teamsProps({ noAllocation: true })));
    assert.match(markup, /<th class="stats-col none" colSpan="4">No Allocation<\/th>/);
    assert.equal(count(markup, 'metric stats-col none'), 8, 'four headers and four cells');
    // Only the two Total count cells keep their Jira links.
    assert.equal(count(markup, 'class="stats-link"'), 2);
    const body = markup.slice(markup.indexOf('<tbody>'));
    const noneCells = [...body.matchAll(/<td class="metric stats-col none">(.*?)<\/td>/g)].map(match => match[1].replace(/<[^>]+>/g, ''));
    assert.deepEqual(noneCells, ['2', '1', '66.67%', '66.67%']);
    assert.ok(markup.indexOf('stats-col tech" colSpan') < markup.indexOf('stats-col none" colSpan'), 'No Allocation follows Tech');
});

test('Legacy Stats Teams keeps Total/Product/Tech with every project-based link', () => {
    const StatsTeamsView = load('StatsTeamsView.jsx');
    const markup = renderToStaticMarkup(React.createElement(StatsTeamsView, teamsProps({})));
    assert.equal(count(markup, 'stats-col none'), 0);
    assert.doesNotMatch(markup, /No Allocation/);
    // Every non-zero count links (Tech incomplete is 0, so five links).
    assert.equal(count(markup, 'class="stats-link"'), 5);
});

const splitRow = withNone => ({
    teamId: 'team-a', teamName: 'Alpha Team', totalPoints: 10,
    segments: {
        excludedCapacity: { points: 1, percent: 0.1 }, adHoc: { points: 1, percent: 0.1 }, product: { points: 3, percent: 0.3 },
        tech: { points: withNone ? 3 : 5, percent: withNone ? 0.3 : 0.5 }, ...(withNone ? { none: { points: 2, percent: 0.2 } } : {}),
    },
});
const splitProps = (extra, events) => ({
    rows: [splitRow(extra.noAllocation)], metric: 'storyPoints', visibleBuckets: {}, onToggleBucket: () => {},
    onAnalyticsAction: (name, params) => events.push([name, params]), formatExcludedPoints: value => String(value), formatPercent: value => `${value * 100}%`, ...extra,
});

test('Effort Split adds a No Allocation series last for the new model only', () => {
    const EffortTypeSplitChart = load('EffortTypeSplitChart.jsx');
    const delivery = renderToStaticMarkup(React.createElement(EffortTypeSplitChart, splitProps({ noAllocation: true }, [])));
    const legend = [...delivery.matchAll(/effort-type-split-legend-item (\w+)/g)].map(match => match[1]);
    assert.deepEqual(legend, ['excludedCapacity', 'adHoc', 'product', 'tech', 'none']);
    assert.match(delivery, /<button type="button" class="effort-type-split-legend-item none active" aria-pressed="true"><span class="effort-type-split-swatch"><\/span>No Allocation<\/button>/);
    assert.match(delivery, /class="effort-type-split-segment none"[^>]*aria-label="Alpha Team No Allocation: 2 SP"/);
    assert.match(delivery, /No Allocation 2 story points, 20%\./);

    const legacy = renderToStaticMarkup(React.createElement(EffortTypeSplitChart, splitProps({}, [])));
    assert.doesNotMatch(legacy, /No Allocation|effort-type-split-legend-item none|effort-type-split-segment none/);
});
