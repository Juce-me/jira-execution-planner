const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('missing-label rule requires epic to match the selected sprint', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );

    assert.equal(
        source.includes('if (!epicMatchesPlanningSprintValue(epic)) return false;'),
        true
    );
});
