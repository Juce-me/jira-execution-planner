const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jsxSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);

const cssSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'dist', 'dashboard.css'),
    'utf8'
);

test('dashboard renders Jira-aligned initiative icon hooks', () => {
    assert.ok(
        jsxSource.includes('title="INITIATIVE"'),
        'Expected initiative icon title in dashboard.jsx'
    );
    assert.ok(
        jsxSource.includes('initiative-header'),
        'Expected initiative header wrapper in dashboard.jsx'
    );
    assert.ok(
        jsxSource.includes('initiative-header-icon'),
        'Expected initiative header icon class in dashboard.jsx'
    );
    assert.ok(
        jsxSource.includes('initiative-toggle-icon'),
        'Expected initiative toggle icon class in dashboard.jsx'
    );
    assert.ok(
        jsxSource.includes('initiative-body'),
        'Expected initiative body wrapper in dashboard.jsx'
    );
});

test('dashboard css declares Jira initiative accent fallback color', () => {
    assert.ok(
        cssSource.includes('--jira-initiative-accent'),
        'Expected Jira initiative accent custom property in dashboard.css'
    );
    assert.ok(
        cssSource.includes('#ffab00'),
        'Expected Jira initiative gold fallback color in dashboard.css'
    );
    assert.ok(
        cssSource.includes('color: var(--jira-initiative-accent);'),
        'Expected initiative text to reuse the icon accent color in dashboard.css'
    );
    assert.match(
        cssSource,
        /linear-gradient\(\s*to bottom,/,
        'Expected initiative vertical fade gradient in dashboard.css'
    );
});
