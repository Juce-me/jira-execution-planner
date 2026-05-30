const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const analyticsFiles = [
    'frontend/src/analytics/analytics.js',
    'frontend/src/analytics/events.js'
];

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('app analytics source never sends direct gtag events', () => {
    for (const relativePath of analyticsFiles) {
        const source = read(relativePath);
        assert.equal(/gtag\s*\(\s*['"]event['"]/.test(source), false, `${relativePath} must not call gtag('event')`);
    }
});

test('dashboard html initializes dataLayer without hard-coded GTM container', () => {
    const source = read('jira-dashboard.html');
    assert.match(source, /window\.dataLayer\s*=/);
    assert.doesNotMatch(source, /googletagmanager\.com\/gtm\.js/);
    assert.doesNotMatch(source, /GTM-NZJW2CFN/);
    assert.doesNotMatch(source, /frontend\/src\/analytics/);
});

test('analytics source does not hard-code production measurement or GTM ids', () => {
    for (const relativePath of analyticsFiles) {
        const source = read(relativePath);
        assert.doesNotMatch(source, /G-6QERX19WB0/);
        assert.doesNotMatch(source, /GTM-NZJW2CFN/);
    }
});

test('analytics event allowlist excludes forbidden parameter names and unsafe snippets', () => {
    const source = read('frontend/src/analytics/events.js');
    for (const snippet of [
        'event_category',
        'event_action',
        'event_label',
        'query_id',
        'user_id',
        'session_id',
        'link_url',
        'page_location',
        'page_title',
        'issue_key',
        'jql',
        'token',
        'email',
        'project_name',
        'team_name',
        'sprint_name',
        'label'
    ]) {
        assert.equal(
            source.includes(`'${snippet}'`) || source.includes(`"${snippet}"`),
            false,
            `events.js must not allow ${snippet}`
        );
    }
});
