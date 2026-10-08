const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

const boundaryPath = path.join(__dirname, '../frontend/src/components/LazyViewBoundary.jsx');
const e = React.createElement;

function loadBoundary() {
    const result = esbuild.buildSync({ entryPoints: [boundaryPath], bundle: true, format: 'cjs', platform: 'node', write: false, external: ['react'] });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
    return module.exports.default;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
// Each call is a fresh mount of the boundary, like closing and reopening a view.
const open = (LazyViewBoundary, load) => renderToString(
    e(LazyViewBoundary, { load, fallback: e('i', null, 'fallback') }, View => e(View)));
const viewModule = text => ({ default: () => e('p', null, text) });

test('a resolved lazy view renders on reopen instead of suspending again', async () => {
    const LazyViewBoundary = loadBoundary();
    let calls = 0;
    const load = async () => { calls += 1; return viewModule('view'); };
    assert.match(open(LazyViewBoundary, load), /fallback/, 'the first open waits for the chunk');
    await settle();
    const reopened = open(LazyViewBoundary, load);
    assert.match(reopened, /<p>view<\/p>/);
    assert.doesNotMatch(reopened, /fallback/);
    assert.equal(calls, 1);
});

test('a rejected load is evicted so the next open retries it', async () => {
    const LazyViewBoundary = loadBoundary();
    let calls = 0;
    const load = async () => {
        calls += 1;
        if (calls === 1) throw new Error('asset failed');
        return viewModule('view');
    };
    assert.match(open(LazyViewBoundary, load), /fallback/);
    await settle();
    assert.match(open(LazyViewBoundary, load), /fallback/, 'the failed view is not served from the cache');
    await settle();
    assert.match(open(LazyViewBoundary, load), /<p>view<\/p>/);
    assert.equal(calls, 2);
});

test('each loader keeps its own view', async () => {
    const LazyViewBoundary = loadBoundary();
    const loadA = async () => viewModule('view-a');
    const loadB = async () => viewModule('view-b');
    open(LazyViewBoundary, loadA); open(LazyViewBoundary, loadB);
    await settle();
    assert.match(open(LazyViewBoundary, loadA), /view-a/);
    assert.match(open(LazyViewBoundary, loadB), /view-b/);
});

test('lazy boundary keeps one attempt per mount, a keyed error reset and the sanitized recovery copy', () => {
    const source = fs.readFileSync(boundaryPath, 'utf8');
    assert.match(source, /export default function LazyViewBoundary\(\{ load, fallback, children \}\)/);
    assert.match(source, /const \[attempt, setAttempt\] = React\.useState\(0\)/);
    assert.match(source, /key=\{attempt\}/);
    assert.match(source, /attempt === 0/);
    assert.match(source, /setAttempt\(1\)/);
    assert.match(source, /<React\.Suspense fallback=\{fallback\}>/);
    assert.match(source, /\{children\(View\)\}/);
    assert.match(source, /type="button"[^>]*onClick=\{this\.props\.onRetry\}[^>]*>Retry</);
    assert.match(source, /Reload the page to get the latest version/);
    assert.doesNotMatch(source, /location\.reload|window\.location|error\.message/);
});
