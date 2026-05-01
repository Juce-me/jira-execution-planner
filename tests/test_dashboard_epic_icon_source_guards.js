const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dashboard epic headers use the purple 16x16 epic svg icon', () => {
    const dashboardSource = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );
    const epmRollupSource = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupPanel.jsx'),
        'utf8'
    );
    const source = `${dashboardSource}\n${epmRollupSource}`;

    const iconViewBoxMatches = source.match(/<svg viewBox="0 0 16 16" fill="none">/g) || [];
    const iconFillMatches = source.match(/fill="#bf63f3"/g) || [];

    assert.equal(iconViewBoxMatches.length, 2);
    assert.equal(iconFillMatches.length, 2);
    assert.equal(source.includes('<rect x="3" y="3" width="18" height="18" rx="3" stroke="#1D7AFC" strokeWidth="2"/>'), false);
});
