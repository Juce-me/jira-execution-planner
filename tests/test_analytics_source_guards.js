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

function jsSetValues(source, setName) {
    const match = source.match(new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
    assert.ok(match, `${setName} must be declared as a Set literal`);
    return new Set(Array.from(match[1].matchAll(/'([^']+)'/g), ([, value]) => value));
}

function yamlValues(source, key) {
    return new Set(Array.from(source.matchAll(new RegExp(`${key}: "([^"]+)"`, 'g')), ([, value]) => value));
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

test('GA4 MCP YAML dataLayer variables match the app analytics allowlist', () => {
    const analyticsSource = read('frontend/src/analytics/events.js');
    const yamlSource = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');
    const appParams = jsSetValues(analyticsSource, 'EVENT_PARAMS');
    const appFields = jsSetValues(analyticsSource, 'DATA_LAYER_FIELDS');
    const appDataLayerKeys = new Set([...appParams, ...appFields]);
    appDataLayerKeys.delete('event');

    const yamlDataLayerKeys = yamlValues(yamlSource, 'data_layer_variable_name');
    assert.deepEqual(
        [...yamlDataLayerKeys].sort(),
        [...appDataLayerKeys].sort(),
        'MCP Data Layer Variables must match app-supported dataLayer keys'
    );

    const yamlCustomDefinitions = yamlValues(yamlSource, 'parameter_name');
    for (const key of yamlCustomDefinitions) {
        assert.ok(appParams.has(key), `MCP custom definition ${key} must be accepted by the app analytics allowlist`);
    }

    const yamlTagParams = new Set(Array.from(yamlSource.matchAll(/^\s{8}([a-z0-9_]+): "\{\{DLV - /gm), ([, value]) => value));
    for (const key of yamlTagParams) {
        assert.ok(appParams.has(key), `MCP tag parameter ${key} must be accepted by the app analytics allowlist`);
    }
});

test('ENG story subtask expand does not add a separate app-owned event', () => {
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    assert.ok(analyticsDoc.includes('### No-Event Allowlist'));
    assert.ok(analyticsDoc.includes('ENG story subtask expand/collapse'));
    assert.ok(analyticsDoc.includes('api_surface=eng_subtasks'));
    assert.ok(!analyticsDoc.includes('eng_action'));
});
