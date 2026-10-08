const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('lazy boundary owns one attempt and stable lazy identity plus keyed error reset', () => {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/src/components/LazyViewBoundary.jsx'), 'utf8');
    assert.match(source, /export default function LazyViewBoundary\(\{ load, fallback, children \}\)/);
    assert.match(source, /const \[attempt, setAttempt\] = React\.useState\(0\)/);
    assert.match(source, /React\.useMemo\(\(\) => React\.lazy\(\(\) => load\(attempt\)\), \[load, attempt\]\)/);
    assert.match(source, /key=\{attempt\}/);
    assert.match(source, /attempt === 0/);
    assert.match(source, /setAttempt\(1\)/);
    assert.match(source, /<React\.Suspense fallback=\{fallback\}>/);
    assert.match(source, /\{children\(View\)\}/);
    assert.match(source, /type="button"[^>]*onClick=\{this\.props\.onRetry\}[^>]*>Retry</);
    assert.match(source, /Reload the page to get the latest version/);
    assert.doesNotMatch(source, /location\.reload|window\.location|error\.message/);
});
