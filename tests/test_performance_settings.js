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
