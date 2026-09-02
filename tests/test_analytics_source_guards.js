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

function listSourceFiles(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return listSourceFiles(fullPath);
        return /\.(?:js|jsx|mjs|cjs)$/.test(entry.name) ? [fullPath] : [];
    });
}

function jsSetValues(source, setName) {
    const match = source.match(new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
    assert.ok(match, `${setName} must be declared as a Set literal`);
    return new Set(Array.from(match[1].matchAll(/'([^']+)'/g), ([, value]) => value));
}

function identifiers(source) {
    const codeWithoutStringsOrComments = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, ' ');
    return new Set(codeWithoutStringsOrComments.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || []);
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

test('ENG Board high-frequency view and draft interactions stay on the no-event allowlist', () => {
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    for (const action of [
        'ENG Board column focus/fold/star',
        'ENG Board/Catch Up filter facet ticks, chip clears, and +n more',
        'ENG Board epic detail panel open',
        'Group Board composer draft edits',
    ]) {
        assert.ok(analyticsDoc.includes(action), `Expected no-event allowlist row for ${action}`);
    }
    assert.ok(analyticsDoc.includes('ENG Board card drag: cancelled or refused'));
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

test('personal group favorite analytics omit identity and retain existing event ownership', () => {
    const preferencesSource = read('frontend/src/settings/useGroupVisibilityPreferences.js');
    const dashboardSource = read('frontend/src/dashboard.jsx');
    const firstRunPickerSource = read('frontend/src/settings/FirstRunGroupSelectionModal.jsx');
    const firstRunChoiceSource = read('frontend/src/settings/FirstRunGroupSetupChoice.jsx');
    const analyticsDoc = read('docs/README_ANALYTICS.md');

    assert.doesNotMatch(
        preferencesSource,
        /first_run_selection'[\s\S]{0,240}selected_count_bucket/,
        'first-run favorite selection must not emit the constant selected-count bucket'
    );
    for (const forbidden of ['favorite_group_id', 'group_id', 'group_name']) {
        assert.equal(preferencesSource.includes(forbidden), false, `favorite analytics must omit ${forbidden}`);
    }
    assert.match(dashboardSource, /trackFilterChanged\('group'/);
    assert.doesNotMatch(preferencesSource, /trackSettingsAction\([^\n]*star/);
    assert.doesNotMatch(firstRunPickerSource, /trackSettingsAction|trackEvent|fetch\(/);
    assert.doesNotMatch(firstRunChoiceSource, /trackSettingsAction|trackEvent|fetch\(/);
    const handlersStart = dashboardSource.indexOf('const openFirstRunSetupChoice = React.useCallback');
    const handlersEnd = dashboardSource.indexOf('useEffect(() => {', handlersStart);
    assert.ok(handlersStart >= 0 && handlersEnd > handlersStart, 'Expected first-run setup handlers');
    const firstRunSetupHandlers = dashboardSource.slice(handlersStart, handlersEnd);
    assert.match(firstRunSetupHandlers, /buildFirstRunGroupDraft\(/);
    assert.match(firstRunSetupHandlers, /mode: 'repair'/);
    assert.doesNotMatch(
        firstRunSetupHandlers,
        /trackSettingsAction|trackEvent|fetch\(|onboardingDone|groupSearchQuery/,
        'Add, create, duplicate, and repair staging must not emit analytics, write onboarding, or consume the picker query'
    );
    assert.ok(analyticsDoc.includes('first-run selection uses `group_count_bucket` only'));
    assert.ok(analyticsDoc.includes('Personal group favorite render/change'));
});

test('onboarding analytics use only the canonical settings action outcomes and safe parameters', () => {
    const helperSource = read('frontend/src/onboarding/onboardingAnalytics.js');
    const controllerSource = read('frontend/src/onboarding/useOnboardingTour.js');
    const analyticsSources = `${helperSource}\n${controllerSource}`;
    const frontendSource = path.join(repoRoot, 'frontend', 'src');
    const helperPath = path.join(frontendSource, 'onboarding', 'onboardingAnalytics.js');
    const directOnboardingPatterns = [
        /trackSettingsAction\s*(?:\?\.)?\s*\(\s*['"]onboarding['"]/,
        /track(?:Event|ProductEvent)\s*(?:\?\.)?\s*\(\s*['"]settings_action['"]\s*,\s*\{[\s\S]{0,1000}?\bsection\s*:\s*['"]onboarding['"]/,
    ];
    const bypasses = listSourceFiles(frontendSource)
        .filter((filePath) => filePath !== helperPath)
        .filter((filePath) => {
            const source = fs.readFileSync(filePath, 'utf8');
            return directOnboardingPatterns.some((pattern) => pattern.test(source));
        })
        .map((filePath) => path.relative(repoRoot, filePath));

    assert.match(controllerSource, /trackOnboardingAnalytics\(/);
    assert.match(helperSource, /module_id:\s*moduleId/);
    assert.match(controllerSource, /trackOnboardingAnalytics\(trackSettingsAction, 'started', normalizedSource, moduleId\)/);
    assert.match(controllerSource, /trackOnboardingAnalytics\(trackSettingsAction, outcome, sourceSurface, moduleId\)/);
    assert.deepEqual(bypasses, []);
    assert.doesNotMatch(controllerSource, /['"]onboarding['"]\s*,/);
    for (const forbidden of [
        'step', 'group', 'team', 'sprint', 'issue', 'summary', 'url', 'search',
        'account', 'email', 'user', 'workspace', 'name', 'key', 'raw', 'content',
    ]) {
        assert.equal(
            helperSource.toLowerCase().includes(forbidden),
            false,
            `onboarding analytics helper must not reference ${forbidden}`,
        );
    }
    assert.doesNotMatch(analyticsSources, /trackEvent|trackProductEvent|settings_action/);
});

test('onboarding module_id stays typed, mapped through GTM, and intentionally unregistered', () => {
    const analyticsSource = read('frontend/src/analytics/events.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const runbook = read('docs/plans/SUPPORT-ga4-user-configuration.md');
    const yaml = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');

    assert.ok(jsSetValues(analyticsSource, 'EVENT_PARAMS').has('module_id'));
    assert.match(
        analyticsSource,
        /module_id:\s*new Set\(\['catch-up', 'configuration', 'planning', 'board', 'statistics'\]\)/,
    );
    assert.ok(analyticsDoc.includes('`module_id=catch-up|configuration|planning|board|statistics`'));
    assert.ok(runbook.includes('module_id'));
    assert.match(runbook, /Do not register `module_id` as a custom dimension[^.]*named report/i);
    assert.match(yaml, /data_layer_variable_name: "module_id"/);
    assert.match(yaml, /^\s{8}module_id: "\{\{DLV - module_id\}\}"$/m);
    assert.doesNotMatch(yaml, /custom_dimensions:[\s\S]*?parameter_name: "module_id"/);
    assert.equal((yaml.match(/event_name: "pageview"/g) || []).length, 1);
    assert.equal((yaml.match(/event_name: "userevent"/g) || []).length, 1);
});

test('onboarding step navigation is untracked and its analytics contract is documented', () => {
    const controllerSource = read('frontend/src/onboarding/useOnboardingTour.js');
    const tourSource = read('frontend/src/onboarding/OnboardingTour.jsx');
    const stepsSource = read('frontend/src/onboarding/onboardingSteps.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const featureDoc = read('docs/features/onboarding.md');

    assert.doesNotMatch(tourSource, /track(?:SettingsAction|Event)|settings_action/);
    assert.doesNotMatch(stepsSource, /track(?:SettingsAction|Event)|settings_action/);
    assert.doesNotMatch(controllerSource, /trackEvent|trackProductEvent|settings_action/);
    assert.ok(analyticsDoc.includes('`section=onboarding`'));
    assert.ok(analyticsDoc.includes('`workflow_action=started|completed|skipped`'));
    assert.ok(analyticsDoc.includes('Step navigation is intentionally untracked'));
    assert.ok(featureDoc.includes('Mandatory Department selection'));
    assert.ok(featureDoc.includes('Run onboarding again'));
    assert.ok(featureDoc.includes('JSON, file, and environment configuration modes'));
    assert.ok(featureDoc.includes('Basic-auth mode'));
    assert.ok(featureDoc.includes('do not automatically run or replay the tour'));
    assert.ok(featureDoc.includes('do not write onboarding state'));
});

test('onboarding operational guidance documents the shipped workflow boundaries', () => {
    assert.ok(
        fs.existsSync(path.join(repoRoot, 'docs/features/eng-workflows.md')),
        'Expected docs/features/eng-workflows.md to exist',
    );
    const guide = read('docs/features/eng-workflows.md');
    const onboardingDoc = read('docs/features/onboarding.md');
    const favoriteDoc = read('docs/features/personal-group-star.md');
    const featureIndex = read('docs/features/README.md');

    for (const heading of [
        'Choose or add a Department',
        'Configure the Department',
        'Make expected Epics and Stories visible',
        'Planning',
        'Board (Kanban)',
        'Filters and search',
        'Continue in Jira',
    ]) {
        assert.ok(guide.includes(`## ${heading}`), `Expected operational heading: ${heading}`);
    }
    for (const required of [
        'zero through three Departments',
        'four or more',
        '**Add Department**',
        '**Save and continue**',
        '**Continue without components**',
        '**Show in Department selector**',
        'Missing Information and Lead Times',
        'Story Team',
        'mapped team label',
        'selected-sprint-name label',
        '`Accepted`, `To Do`, `Postponed`, `Awaiting Val.`, and `Select All`',
        'permission-gated Jira workflow transition',
        'session-only',
        'Delivery Owner',
        'Initiative, Epic, and Story',
        'Epic and Story only',
        'does not perform an in-app bulk mutation',
        'desktop only',
    ]) {
        assert.ok(guide.includes(required), `Expected operational guidance for: ${required}`);
    }
    assert.ok(
        guide.includes('requires both the configured mapped team label and the exact selected-sprint-name label'),
        'Expected future sprint-ready guidance to require both the mapped team label and selected-sprint-name label',
    );
    assert.doesNotMatch(
        guide,
        /requires the configured mapped team label and either the Epic's Jira Sprint value or the exact selected-sprint-name label/i,
        'Future sprint-ready guidance must not allow the Jira Sprint field to replace the required sprint label',
    );
    assert.ok(
        guide.includes('opens a menu with separate **Open epics** and **Open stories** choices'),
        'Expected the Jira handoff guide to document the two shipped issue-scope choices',
    );
    assert.ok(
        guide.includes('opens only that currently scoped subset in Jira'),
        'Expected the Jira handoff guide to preserve the selected Epic-or-Story scope',
    );
    assert.doesNotMatch(
        guide,
        /opens the currently scoped issue set in Jira/i,
        'The Jira control must not be documented as directly opening a combined issue set',
    );
    assert.ok(onboardingDoc.includes('four phases'));
    assert.ok(onboardingDoc.includes('configuration guide and dashboard tour never run together'));
    assert.ok(onboardingDoc.includes('shared Department configuration'));
    assert.ok(onboardingDoc.includes('private preferences'));
    assert.ok(onboardingDoc.includes('preference-only retry'));
    assert.ok(onboardingDoc.includes('desktop only'));
    assert.ok(
        onboardingDoc.includes('resets all modules, closes Settings, and returns to Catch Up, but no tour is shown'),
        'Expected the mobile replay guide to document successful module reset, Settings close, and Catch Up return',
    );
    assert.ok(
        onboardingDoc.includes('Catch Up begins at its first eligible step when the dashboard is next opened at desktop width'),
        'Expected the mobile replay guide to document deferred desktop start',
    );
    assert.doesNotMatch(
        onboardingDoc,
        /Starting replay first persists incomplete onboarding, closes Settings, prepares ENG Catch Up, and opens the desktop tour\./,
        'Replay guidance must not claim that a mobile invocation immediately opens the desktop tour',
    );
    assert.ok(onboardingDoc.includes('not replayed automatically'));
    assert.ok(onboardingDoc.includes('[ENG Workflows](eng-workflows.md)'));
    assert.ok(favoriteDoc.includes('Direct picker selection'));
    assert.ok(favoriteDoc.includes('Configure and use'));
    assert.ok(favoriteDoc.includes('pending private favorite'));
    assert.ok(favoriteDoc.includes('before any shared save'));
    assert.ok(favoriteDoc.includes('preference-only retry'));
    assert.ok(featureIndex.includes('[ENG Workflows](eng-workflows.md)'));
});

test('Statistics guide uses shipped labels and accurately defines Mono vs Cross', () => {
    const statisticsDoc = read('docs/features/statistics.md');
    for (const term of [
        '### Burndown',
        '### Lead Times',
        '### Excluded Capacity',
        '### Mono vs Cross',
        '### Project Track',
        'Cross Epic SP',
        'Total SP',
        'Cross Share',
        'Cross-Team Epic Footprint',
        'Team Cross Share',
        'team cross SP / total team story points',
        'assignee',
    ]) {
        assert.ok(statisticsDoc.includes(term), `Expected Statistics documentation for: ${term}`);
    }
    assert.doesNotMatch(statisticsDoc, /^### Burnout$/m);
    assert.doesNotMatch(statisticsDoc, /hover[^.\n]*(?:task key|task summary|individual task|assignee detail)/i);
});

test('tour target activation adds no onboarding event and retains safe field options-open analytics', () => {
    const tourSource = read('frontend/src/onboarding/OnboardingTour.jsx');
    const onboardingAnalyticsSource = read('frontend/src/onboarding/onboardingAnalytics.js');
    const prioritySource = read('frontend/src/eng/useEngPriorityTransitions.js');
    const trackSource = read('frontend/src/eng/useEngProjectTrackTransitions.js');
    const statusSource = read('frontend/src/eng/useEngStatusTransitions.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');

    assert.doesNotMatch(tourSource, /track(?:OnboardingAnalytics|SettingsAction|Event|ProductEvent)/);
    assert.match(onboardingAnalyticsSource, /new Set\(\['started', 'completed', 'skipped'\]\)/);
    assert.match(prioritySource, /trackIssuePriorityAction\('priority_options_open'/);
    assert.match(trackSource, /trackIssueProjectTrackAction\('project_track_options_open'/);
    assert.match(statusSource, /trackIssueStatusAction\('status_options_open'/);
    assert.ok(analyticsDoc.includes('Dashboard tour target activation'));
    assert.ok(analyticsDoc.includes('no new onboarding event'));
    for (const token of ['priority_options_open', 'project_track_options_open', 'status_options_open']) {
        assert.ok(analyticsDoc.includes(`\`${token}\``), `Expected safe options-open documentation for ${token}`);
    }
});

test('first-run guide recovery and focus ownership add no new analytics surface', () => {
    const guide = read('frontend/src/settings/FirstRunGroupConfigurationGuide.jsx');
    const dashboard = read('frontend/src/dashboard.jsx');
    const recoveryStart = dashboard.indexOf('const retryFirstRunConfiguration');
    const recoveryEnd = dashboard.indexOf('const filteredGroupDrafts', recoveryStart);
    assert.equal(guide.includes('trackSettingsAction'), false);
    assert.equal(guide.includes('trackEvent'), false);
    assert.doesNotMatch(dashboard.slice(recoveryStart, recoveryEnd), /trackSettingsAction|trackEvent/);
});

test('Jira issue transition API module sends the eng_status_transitions surface for both endpoints', () => {
    const source = read('frontend/src/api/jiraIssueApi.js');
    assert.ok(source.includes('/api/issues/transitions/options'), 'Expected the transition options endpoint literal');
    assert.ok(source.includes('/api/issues/transitions'), 'Expected the transition write endpoint literal');
    assert.ok(source.includes("trackedFetch('jira_issue_transitions'"), 'Expected both wrappers to use the jira_issue_transitions API surface');
    assert.ok(source.includes("featureName: 'eng_status_transitions'"), 'Expected both wrappers to tag the eng_status_transitions feature');
});

test('planning capacity analytics keeps an allowlisted planning_action contract', () => {
    const source = read('frontend/src/analytics/dashboardAnalytics.js');
    const match = source.match(/const trackPlanningCapacityAction = useCallback\(([\s\S]*?)\}, \[trackProductEvent\]\);/);
    assert.ok(match, 'Expected to locate the trackPlanningCapacityAction definition');
    const body = match[1];

    assert.match(body, /CAPACITY_WORKFLOW_ACTIONS\.has\(workflowAction\)/);
    assert.match(body, /trackProductEvent\('planning_action'/);
    assert.match(body, /feature_name:\s*'planning_capacity_edit'/);
    assert.match(body, /source_surface:\s*'planning'/);
    assert.match(body, /\['success', 'failure', 'conflict'\]\.includes\(result\)/);
    assert.equal(/\.\.\.\s*(?:params|payload|arguments)\b/.test(body), false, 'Capacity analytics must not spread dynamic caller data');

    const rawIdentifiers = identifiers(body);
    for (const forbidden of [
        'issueKey', 'teamName', 'sprintName', 'expectedCapacity', 'jiraUrl', 'jql', 'error',
        'email', 'token', 'apiToken', 'authToken', 'csrfToken', 'password', 'credential',
    ]) {
        assert.equal(rawIdentifiers.has(forbidden), false, `Capacity analytics must not reference raw ${forbidden}`);
    }
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

test('Jira issue project track API module sends the jira_issue_project_track surface for both endpoints', () => {
    const source = read('frontend/src/api/jiraIssueApi.js');
    assert.ok(source.includes('/api/issues/project-track/options'), 'Expected the project track options endpoint literal');
    assert.ok(source.includes('/api/issues/project-track'), 'Expected the project track write endpoint literal');
    assert.ok(source.includes("trackedFetch('jira_issue_project_track'"), 'Expected both project track wrappers to use the jira_issue_project_track API surface');
    assert.ok(source.includes("featureName: 'eng_project_track_changes'"), 'Expected both project track wrappers to tag the eng_project_track_changes feature');
});

test('trackIssueProjectTrackAction emits only the eng project track contract, never issue-level PII or raw track ids', () => {
    const source = read('frontend/src/analytics/dashboardAnalytics.js');
    const match = source.match(/const trackIssueProjectTrackAction = useCallback\(([\s\S]*?)\}, \[trackProductEvent\]\);/);
    assert.ok(match, 'Expected to locate the trackIssueProjectTrackAction definition');

    const body = match[1];
    assert.ok(body.includes("'issue_project_track_action'"), 'Expected trackIssueProjectTrackAction to emit issue_project_track_action');
    assert.ok(body.includes("feature_name: 'eng_project_track_changes'"), 'Expected trackIssueProjectTrackAction to tag the eng_project_track_changes feature');

    const forbiddenSnippets = [
        'issueKey', 'issue_key', 'summary', 'targetTrack', 'target_track',
        'assignee', 'jql', 'JQL', 'accountId', 'account_id', 'email',
        'apiToken', 'authToken', 'csrfToken', 'jiraUrl', 'jira_url'
    ];
    for (const snippet of forbiddenSnippets) {
        assert.equal(
            body.includes(snippet),
            false,
            `trackIssueProjectTrackAction must not reference ${snippet}`
        );
    }
});
