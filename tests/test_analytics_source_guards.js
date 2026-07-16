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

test('effort split chart_action sends only the safe series_type enum token, never raw epic keys', () => {
    const source = read('frontend/src/stats/EffortTypeSplitChart.jsx');
    // The bucket keys are camelCase identifiers; analytics must travel through the snake_case token map.
    assert.match(
        source,
        /SERIES_ANALYTICS_TOKENS = \{ excludedCapacity: 'excluded_capacity', adHoc: 'ad_hoc' \}/,
        'Expected the Ad Hoc / Excluded Capacity buckets to map to safe snake_case analytics tokens'
    );
    assert.ok(
        source.includes('series_type: seriesAnalyticsToken(bucket.key)'),
        'Expected chart_action to send the mapped analytics token, not the raw bucket key'
    );
    // No epic key, summary, team name, or BAU display copy may reach the analytics call.
    assert.ok(
        !/series_type:\s*(?:row\.|segment\.|bucket\.label)/.test(source),
        'Effort split analytics must not send row/segment data or bucket display labels as series_type'
    );
    assert.equal(/['"]BAU['"]/.test(source), false, 'BAU must not appear as an analytics or code value');
});

test('Lead Times capacity exclusions change local state without an app-owned event', () => {
    const source = read('frontend/src/dashboard.jsx');
    const start = source.indexOf('data-stats-capacity-filters');
    const end = source.indexOf('<div className="stats-actions cohort-status-actions">', start);
    assert.ok(start >= 0 && end > start, 'Expected the Lead Times capacity checkbox block');
    const capacityControls = source.slice(start, end);
    assert.ok(capacityControls.includes('setCohortExcludeAdHoc'));
    assert.ok(capacityControls.includes('setCohortExcludeCapacity'));
    assert.ok(capacityControls.includes('aria-label="Exclude Ad Hoc"'));
    assert.ok(capacityControls.includes('aria-label="Exclude Excluded Capacity"'));
    assert.ok(capacityControls.includes('<span>Ad Hoc</span>'));
    assert.ok(capacityControls.includes('<span>Excluded Capacity</span>'));
    assert.equal(capacityControls.includes('setCohortCapacityFilter'), false);
    assert.equal(/trackFilterChanged|trackStatsAnalyticsAction|trackEvent/.test(capacityControls), false);
    assert.ok(read('docs/README_ANALYTICS.md').includes('Lead Times capacity cohort filter'));
});

test('Jira issue transition API module sends the eng_status_transitions surface for both endpoints', () => {
    const source = read('frontend/src/api/jiraIssueApi.js');
    assert.ok(source.includes('/api/issues/transitions/options'), 'Expected the transition options endpoint literal');
    assert.ok(source.includes('/api/issues/transitions'), 'Expected the transition write endpoint literal');
    assert.ok(source.includes("trackedFetch('jira_issue_transitions'"), 'Expected both wrappers to use the jira_issue_transitions API surface');
    assert.ok(source.includes("featureName: 'eng_status_transitions'"), 'Expected both wrappers to tag the eng_status_transitions feature');
});

test('trackIssueStatusAction emits only the eng status transition contract, never issue-level PII', () => {
    const source = read('frontend/src/analytics/dashboardAnalytics.js');
    const match = source.match(/const trackIssueStatusAction = useCallback\(([\s\S]*?)\}, \[trackProductEvent\]\);/);
    assert.ok(match, 'Expected to locate the trackIssueStatusAction definition');

    const body = match[1];
    assert.ok(body.includes("'issue_status_action'"), 'Expected trackIssueStatusAction to emit issue_status_action');
    assert.ok(body.includes("feature_name: 'eng_status_transitions'"), 'Expected trackIssueStatusAction to tag the eng_status_transitions feature');

    const forbiddenSnippets = [
        'issueKey', 'issue_key', 'summary', 'transitionId', 'transition_id',
        'assignee', 'jql', 'JQL', 'accountId', 'account_id', 'email',
        'apiToken', 'authToken', 'csrfToken', 'jiraUrl', 'jira_url'
    ];
    for (const snippet of forbiddenSnippets) {
        assert.equal(
            body.includes(snippet),
            false,
            `trackIssueStatusAction must not reference ${snippet}`
        );
    }
});

test('Jira issue priority API module sends the jira_issue_priorities surface for both endpoints', () => {
    const source = read('frontend/src/api/jiraIssueApi.js');
    assert.ok(source.includes('/api/issues/priorities/options'), 'Expected the priority options endpoint literal');
    assert.ok(source.includes('/api/issues/priorities'), 'Expected the priority write endpoint literal');
    assert.ok(source.includes("trackedFetch('jira_issue_priorities'"), 'Expected both priority wrappers to use the jira_issue_priorities API surface');
    assert.ok(source.includes("featureName: 'eng_priority_changes'"), 'Expected both priority wrappers to tag the eng_priority_changes feature');
});

test('trackIssuePriorityAction emits only the eng priority transition contract, never issue-level PII or raw priority ids', () => {
    const source = read('frontend/src/analytics/dashboardAnalytics.js');
    const match = source.match(/const trackIssuePriorityAction = useCallback\(([\s\S]*?)\}, \[trackProductEvent\]\);/);
    assert.ok(match, 'Expected to locate the trackIssuePriorityAction definition');

    const body = match[1];
    assert.ok(body.includes("'issue_priority_action'"), 'Expected trackIssuePriorityAction to emit issue_priority_action');
    assert.ok(body.includes("feature_name: 'eng_priority_changes'"), 'Expected trackIssuePriorityAction to tag the eng_priority_changes feature');

    const forbiddenSnippets = [
        'issueKey', 'issue_key', 'summary', 'priorityId', 'priority_id',
        'assignee', 'jql', 'JQL', 'accountId', 'account_id', 'email',
        'apiToken', 'authToken', 'csrfToken', 'jiraUrl', 'jira_url'
    ];
    for (const snippet of forbiddenSnippets) {
        assert.equal(
            body.includes(snippet),
            false,
            `trackIssuePriorityAction must not reference ${snippet}`
        );
    }
});
