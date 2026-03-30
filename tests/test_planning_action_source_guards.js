const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('planning action row includes postponed and awaiting validation bulk actions', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /Include Postponed/);
    assert.match(source, /Include Awaiting Validation/);
    assert.match(source, /status === 'postponed'/);
    assert.match(source, /status === 'awaiting validation'/);
});
