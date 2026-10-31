const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readOwnerSource } = require('./frontend_source_helpers');

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

test('dashboard HTML loads analytics without CSP-blocked inline JavaScript', () => {
    const source = read('jira-dashboard.html');
    assert.doesNotMatch(source, /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);
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

test('ENG Board analytics and Work items export keep bounded low-cardinality contracts', () => {
    const analyticsSource = read('frontend/src/analytics/analytics.js');
    const eventsSource = read('frontend/src/analytics/events.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const workflowDoc = read('docs/features/eng-workflows.md');

    assert.ok(jsSetValues(analyticsSource, 'API_SURFACES').has('eng_board'));
    assert.match(eventsSource, /scope_type:\s*new Set\(\['eng', 'epm', 'board', 'all_work', 'component', 'sprint'\]\)/);
    assert.ok(analyticsDoc.includes('`api_surface=eng_board`'));
    assert.ok(analyticsDoc.includes('`scope_type=all_work|component|sprint`'));
    assert.ok(analyticsDoc.includes('Strict Board Work items use `issue_kind=mixed`'));
    assert.ok(workflowDoc.includes('**Open work items**'));
    assert.ok(workflowDoc.includes('complete and authoritative'));
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

test('issue field edit analytics stays typed, private, and mapped through the two-trigger GTM contract', () => {
    const eventsSource = read('frontend/src/analytics/events.js');
    const analyticsSource = read('frontend/src/analytics/analytics.js');
    const dashboardAnalytics = read('frontend/src/analytics/dashboardAnalytics.js');
    const jiraApi = read('frontend/src/api/jiraIssueApi.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const runbook = read('docs/plans/SUPPORT-ga4-user-configuration.md');
    const yaml = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');

    assert.ok(jsSetValues(eventsSource, 'EVENT_NAMES').has('issue_field_edit_action'));
    assert.ok(jsSetValues(eventsSource, 'EVENT_PARAMS').has('field_name'));
    assert.ok(jsSetValues(analyticsSource, 'API_SURFACES').has('jira_issue_field_edits'));
    assert.equal((jiraApi.match(/trackedFetch\('jira_issue_field_edits'/g) || []).length, 3);
    for (const token of [
        "new Set(['open', 'submit', 'result'])",
        "new Set(['assignee', 'delivery_owner', 'story_points', 'summary', 'team'])",
        "new Set(['epic', 'story'])",
        "new Set(['catch_up', 'planning', 'board'])",
        "new Set(['success', 'unchanged', 'conflict', 'failure', 'unknown'])",
    ]) assert.ok(dashboardAnalytics.includes(token), `Expected fixed issue-field enum ${token}`);
    for (const forbidden of ['query:', 'accountId:', 'issueKey:', 'fieldId:', 'storyPoints:', 'error:']) {
        const start = dashboardAnalytics.indexOf('export function buildIssueFieldEditAnalyticsParams');
        const end = dashboardAnalytics.indexOf('\n}', start) + 2;
        assert.equal(dashboardAnalytics.slice(start, end).includes(forbidden), false, `Builder must omit ${forbidden}`);
    }

    assert.match(yaml, /data_layer_variable_name: "field_name"/);
    assert.match(yaml, /^\s{8}field_name: "\{\{DLV - field_name\}\}"$/m);
    assert.equal((yaml.match(/event_name: "pageview"/g) || []).length, 1);
    assert.equal((yaml.match(/event_name: "userevent"/g) || []).length, 1);
    assert.doesNotMatch(yaml, /custom_dimensions:[\s\S]*?parameter_name: "field_name"/);
    assert.ok(analyticsDoc.includes('`issue_field_edit_action`'));
    assert.ok(analyticsDoc.includes('`api_surface=jira_issue_field_edits`'));
    assert.ok(runbook.includes('issue_field_edit_action'));
    assert.match(runbook, /Do not register `field_name` as a custom dimension[^.]*named report/i);
});

test('GA4 MCP YAML dataLayer variables match the app analytics allowlist', () => {
    const analyticsSource = read('frontend/src/analytics/events.js');
    const yamlSource = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');
    const appParams = jsSetValues(analyticsSource, 'EVENT_PARAMS');
    const appFields = jsSetValues(analyticsSource, 'DATA_LAYER_FIELDS');
    const appDataLayerKeys = new Set([...appParams, ...appFields]);
    appDataLayerKeys.delete('event');
    appDataLayerKeys.delete('page_path'); // Inspection-only; GA4 derives path from page_location.

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
        'ENG Board/Catch Up filter facet ticks, chip clears, +n more, passive option visuals, and explicit No Project Track state',
        'ENG Board epic detail panel open',
        'Group Board composer draft edits',
    ]) {
        assert.ok(analyticsDoc.includes(action), `Expected no-event allowlist row for ${action}`);
    }
    assert.ok(analyticsDoc.includes('ENG Board card drag: cancelled or refused'));
});

test('ENG filter option visuals and explicit No Project Track state emit no analytics', () => {
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const files = [
        'frontend/src/eng/engFilterOptionVisuals.js',
        'frontend/src/eng/engFilterFacets.js',
        'frontend/src/eng/engBoardFilters.js',
        'frontend/src/eng/engCatchUpFilters.js',
        'frontend/src/eng/engProjectTrack.js',
        'frontend/src/eng/EngFilterBar.jsx',
    ];
    files.forEach((filePath) => {
        const source = read(filePath);
        assert.equal(source.includes('trackEvent'), false, `${filePath} must not emit analytics`);
        assert.equal(source.includes('dataLayer.push'), false, `${filePath} must not push analytics`);
    });
    assert.ok(analyticsDoc.includes('passive option visuals, and explicit No Project Track state'));
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
    const source = readOwnerSource(['frontend/src/stats/StatsPanel.jsx'], { anchor: 'export function StatsPanel(' });
    assert.equal(source.split('data-stats-capacity-filters').length - 1, 1);
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
    assert.equal(/trackFilterChanged|trackStatsAction|trackStatsAnalyticsAction|trackEvent/.test(capacityControls), false);
    assert.ok(read('docs/README_ANALYTICS.md').includes('Lead Times capacity cohort filter'));
});

test('Lead Times Mode and Last N controls change local state without an app-owned event', () => {
    const source = readOwnerSource(['frontend/src/stats/StatsPanel.jsx'], { anchor: 'export function StatsPanel(' });
    const start = source.indexOf('aria-label="Lead Times mode"');
    const end = source.indexOf('<StatsRangeControl', start);
    assert.ok(start >= 0 && end > start, 'Expected the Lead Times Mode and Last N controls block');
    const controls = source.slice(start, end);
    assert.ok(controls.includes('setCohortMode(resolveLeadTimesMode(event.target.value))'));
    assert.ok(controls.includes('setCohortLastN(resolveLeadTimesLastN(event.target.value))'));
    assert.equal(/trackFilterChanged|trackStatsAction|trackStatsAnalyticsAction|trackEvent|trackChartAction|trackSelectContent/.test(controls), false);
    assert.ok(read('docs/README_ANALYTICS.md').includes('Lead Times Mode and per-mode selection controls'));
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
    assert.match(readOwnerSource(['frontend/src/eng/EngControls.jsx'], { anchor: 'export function GroupControl(' }), /trackFilterChanged\('group'/);
    assert.doesNotMatch(preferencesSource, /trackSettingsAction\([^\n]*star/);
    assert.doesNotMatch(firstRunPickerSource, /trackSettingsAction|trackEvent|fetch\(/);
    assert.doesNotMatch(firstRunChoiceSource, /trackSettingsAction|trackEvent|fetch\(/);
    const firstRunHookSource = read('frontend/src/settings/useFirstRunConfiguration.js');
    const handlersStart = firstRunHookSource.indexOf('const openFirstRunSetupChoice = React.useCallback');
    const handlersEnd = firstRunHookSource.indexOf('useEffect(() => {', handlersStart);
    assert.ok(handlersStart >= 0 && handlersEnd > handlersStart, 'Expected first-run setup handlers');
    assert.equal(dashboardSource.includes('const openFirstRunSetupChoice = React.useCallback'), false, 'the first-run setup handlers are owned by the first-run hook');
    const firstRunSetupHandlers = firstRunHookSource.slice(handlersStart, handlersEnd);
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
    assert.ok(runbook.includes('| `module_id` | `{{DLV - module_id}}` |')); // Native completion, outside the 25-row MCP core.
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
        guide.includes('requires both the configured mapped Team label and either the exact selected-sprint-name label or its `_candidate` form'),
        'Expected future sprint-ready guidance to require the mapped Team label and either accepted sprint label',
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
    const firstRunHook = read('frontend/src/settings/useFirstRunConfiguration.js');
    const recoveryStart = firstRunHook.indexOf('const retryFirstRunConfiguration');
    // The recovery callback ends at the first-run hook's return statement.
    const recoveryEnd = firstRunHook.indexOf('    return {', recoveryStart);
    assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'Expected both recovery slice markers in the first-run hook');
    assert.equal(guide.includes('trackSettingsAction'), false);
    assert.equal(guide.includes('trackEvent'), false);
    assert.doesNotMatch(firstRunHook.slice(recoveryStart, recoveryEnd), /trackSettingsAction|trackEvent/);
    assert.doesNotMatch(firstRunHook, /trackSettingsAction|trackEvent/, 'the first-run hook owns no analytics call');
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

test('epic refresh analytics keeps per-click requests on a dedicated api surface and stays documented', () => {
    const eventsSource = read('frontend/src/analytics/events.js');
    const analyticsSource = read('frontend/src/analytics/analytics.js');
    const engApi = read('frontend/src/api/engApi.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const runbook = read('docs/plans/SUPPORT-ga4-user-configuration.md');
    const yaml = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');

    assert.ok(jsSetValues(eventsSource, 'EVENT_NAMES').has('epic_refresh_action'));
    assert.ok(jsSetValues(analyticsSource, 'API_SURFACES').has('epic_refresh'));
    assert.match(engApi, /apiSurface: 'epic_refresh'/);
    assert.match(engApi, /featureName: 'epic_refresh'/);
    assert.match(engApi, /trackedFetch\(apiSurface, /);
    assert.match(yaml, /^\s{8}issue_count_bucket: "\{\{DLV - issue_count_bucket\}\}"$/m);
    assert.doesNotMatch(yaml, /custom_dimensions:[\s\S]*?parameter_name: "issue_count_bucket"/);
    assert.ok(analyticsDoc.includes('`epic_refresh_action`'));
    assert.ok(analyticsDoc.includes('`api_surface=epic_refresh`'));
    assert.ok(runbook.includes('epic_refresh_action'));
    assert.match(runbook, /Do not register `issue_count_bucket` as a custom dimension[^.]*named report/i);
});

test('Department Board status colours are passive: allowlisted and free of analytics calls', () => {
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    assert.ok(analyticsDoc.includes('Group Board composer draft edits, the "Use column colours for statuses" checkbox'));
    assert.ok(analyticsDoc.includes('Department Board status colours on Jira status pills (passive recolouring)'));
    ['frontend/src/issues/statusColumnColours.js', 'frontend/src/issues/StatusColourContext.jsx', 'frontend/src/ui/StatusPill.jsx'].forEach((filePath) => {
        const source = read(filePath);
        assert.equal(source.includes('trackEvent'), false, `${filePath} must not emit analytics`);
        assert.equal(source.includes('dataLayer.push'), false, `${filePath} must not push analytics`);
    });
});

test('automatic freshness and its status projection remain passive and analytics-free', () => {
    const doc = read('docs/README_ANALYTICS.md');
    assert.ok(doc.includes('Automatic return acquisition, age readout and reading-position retention'));
    assert.ok(doc.includes('feature_name=data_freshness'));
    for (const filePath of ['frontend/src/dashboardFreshnessSummary.js', 'frontend/src/components/DashboardFreshnessStatus.jsx', 'frontend/src/dashboardFreshnessAdapters.js', 'frontend/src/useDashboardFreshness.js']) {
        const source = read(filePath);
        assert.doesNotMatch(source, /trackEvent|trackProductEvent|trackApiResult|dataLayer|epic_refresh_action|ga4_event_name|event_group/, filePath);
    }
});

test('share view analytics stays typed, private, documented and mapped through the two-trigger GTM contract', () => {
    const eventsSource = read('frontend/src/analytics/events.js');
    const dashboardAnalytics = read('frontend/src/analytics/dashboardAnalytics.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const runbook = read('docs/plans/SUPPORT-ga4-user-configuration.md');
    const yaml = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');

    assert.ok(jsSetValues(eventsSource, 'EVENT_NAMES').has('share_view_action'));
    for (const token of [
        "['copy_link', new Set(['success', 'failure'])]",
        "['apply_link', new Set(['success', 'partial', 'rejected'])]",
        "new Set(['catch_up', 'planning', 'board', 'statistics'])",
    ]) assert.ok(dashboardAnalytics.includes(token), `Expected fixed Share enum ${token}`);
    const start = dashboardAnalytics.indexOf('export function buildShareViewActionParams');
    const end = dashboardAnalytics.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start, 'Expected to locate buildShareViewActionParams');
    for (const forbidden of ['url', 'URL', 'href', 'location', 'groupId', 'sprintId', 'teamId', 'teams', 'find', 'query', 'search', 'issueKey', 'categories', 'dropped', 'event_group', 'ga4_event_name', 'has_']) {
        assert.equal(dashboardAnalytics.slice(start, end).includes(forbidden), false, `Builder must omit ${forbidden}`);
    }

    // No new dataLayer key: the four params are already mapped by the shared userevent tag, so the MCP YAML is untouched.
    for (const key of ['feature_name', 'workflow_action', 'result', 'source_surface']) {
        assert.ok(jsSetValues(eventsSource, 'EVENT_PARAMS').has(key));
        assert.match(yaml, new RegExp(`data_layer_variable_name: "${key}"`));
    }
    assert.doesNotMatch(yaml, /share_view/);

    assert.ok(analyticsDoc.includes('| `share_view_action` |'));
    assert.ok(analyticsDoc.includes('`feature_name=share_view`'));
    assert.ok(analyticsDoc.includes('Share adoption and how often recipients resolve only partially, to decide whether stored links are worth building'));
    assert.ok(analyticsDoc.includes('### Shareable View Links'));
    assert.ok(analyticsDoc.includes('link queries never reach GA4'));
    for (const row of ['Share link URL strip before analytics initializes', 'Share notice (apply result and Share copy failures)', 'Share fallback link field']) {
        assert.ok(analyticsDoc.includes(`| ${row}`), `Expected no-event allowlist row for ${row}`);
    }
    assert.ok(runbook.includes('`share_view_action`'));
    assert.match(runbook, /Do not register new custom dimensions for Share[^.]*already registered/i);
});

test('share view source reaches analytics only through the fixed Share builder', () => {
    const offenders = listSourceFiles(path.join(repoRoot, 'frontend', 'src', 'shareView'))
        .filter(filePath => /dataLayer|gtag\s*\(|JepAnalytics|trackProductEvent|trackEvent\s*\(|analytics\/analytics\.js/.test(fs.readFileSync(filePath, 'utf8')))
        .map(filePath => path.relative(repoRoot, filePath));
    assert.deepEqual(offenders, []);
});

test('MCP core stays at 25 while native handoff covers every sparse app parameter', () => {
    const source = read('frontend/src/analytics/events.js');
    const yaml = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');
    const runbook = read('docs/plans/SUPPORT-ga4-user-configuration.md');
    const tagSections = yaml.split('  tags:')[1].split('  ecommerce:')[0].split('    - name:').slice(1);
    const counts = tagSections.map(section => [...section.matchAll(/^        [a-z_]+:/gm)].length);
    assert.deepEqual(counts, [7, 25]);
    for (const name of ['page_title', 'page_location']) {
        assert.ok(tagSections[0].includes(`${name}: "{{DLV - ${name}}}"`));
        assert.ok(runbook.includes(`| \`${name}\` | \`${name}\` |`));
        assert.ok(!yamlValues(yaml, 'parameter_name').has(name), `${name} uses predefined GA4 dimensions`);
    }
    assert.doesNotMatch(yaml.split('  tags:')[1], /^        page_path:/m);
    for (const name of jsSetValues(source, 'EVENT_PARAMS')) {
        if (['page_title', 'page_path', 'page_location'].includes(name)) continue;
        assert.ok(runbook.includes(`| \`${name}\` | \`{{DLV - ${name}}}\` |`), `Native mapping missing ${name}`);
    }
    assert.doesNotMatch(yaml.split('  tags:')[1], /^        (?:user_id|ga4_user_id):/m);
    assert.match(yaml, /create_container_version_allowed: false/);
    assert.match(yaml, /publish_allowed: false/);
});

test('group review columns add no analytics event and document their no-event rows (#267)', () => {
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const analyticsSource = read('frontend/src/analytics/dashboardAnalytics.js');
    const rows = [
        'Inherited-view hint and its dismissal',
        'Derived Epic and Story review columns',
        'Derived column marker and readout',
        'Group-switch dialog copy for the Planning review',
    ];
    for (const row of rows) {
        const line = analyticsDoc.split('\n').find(candidate => candidate.startsWith(`| ${row} |`));
        assert.ok(line, `Expected no-event allowlist row for ${row}`);
        assert.ok(line.includes('trigger none'), `${row}: trigger`);
        assert.ok(line.includes('`event_type=none`'), `${row}: event_type`);
        assert.ok(line.includes('canonical `event_name=none`'), `${row}: event_name`);
        assert.ok(line.includes('`feature_name=planning_review`'), `${row}: feature_name`);
        assert.ok(line.includes('typed params none'), `${row}: typed params`);
        assert.ok(line.endsWith('| 2026-10-20 |'), `${row}: reviewed on`);
    }
    const derived = analyticsDoc.split('\n').find(candidate => candidate.startsWith('| Derived Epic and Story review columns |'));
    assert.ok(derived.includes('`column_visibility_changed` with `mode` only'));
    assert.ok(derived.includes('existing review action events'));
    // No new event or review action name: the shipped set is unchanged by the group columns work.
    for (const name of ['inherited_hint', 'hint_dismissed', 'derived_column', 'group_changed', 'marker']) {
        assert.doesNotMatch(analyticsSource, new RegExp(`'[a-z_]*${name}[a-z_]*'`));
    }
});

test('assignee capacity strip adds no analytics event and documents its no-event row (#323)', () => {
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const analyticsSource = read('frontend/src/analytics/dashboardAnalytics.js');
    const row = 'Planning assignee capacity table, Team capacity (not in Jira) editor, reconcile banner and Add assignee';
    const line = analyticsDoc.split('\n').find(candidate => candidate.startsWith(`| ${row} |`));
    assert.ok(line, `Expected no-event allowlist row for ${row}`);
    assert.ok(line.includes('trigger none'), `${row}: trigger`);
    assert.ok(line.includes('`event_type=none`'), `${row}: event_type`);
    assert.ok(line.includes('canonical `event_name=none`'), `${row}: event_name`);
    assert.ok(line.includes('`feature_name=planning_review`'), `${row}: feature_name`);
    assert.ok(line.includes('typed params none'), `${row}: typed params`);
    assert.ok(line.includes('`api_surface=planning_assignee_capacity`'), `${row}: api surface`);
    assert.ok(line.endsWith('| 2026-10-30 |'), `${row}: reviewed on`);
    assert.ok(analyticsDoc.includes('`api_surface=planning_assignee_capacity` (the Planning assignee capacity document read and write and the Add assignee people search) sends only `feature_name=planning_review`'));
    assert.ok(jsSetValues(read('frontend/src/analytics/analytics.js'), 'API_SURFACES').has('planning_assignee_capacity'));
    // No new event or action name for the strip, the stored team number, the banner or Add assignee.
    for (const name of ['assignee_capacity', 'planned_capacity', 'reconcile', 'add_assignee']) {
        assert.doesNotMatch(analyticsSource, new RegExp(`'[a-z_]*${name}[a-z_]*'`));
    }
});

test('assignee capacity modules import no analytics emitter; the API module reports only its api_result surface (#323)', () => {
    const modules = [
        'frontend/src/eng/PlanningAssigneeCapacity.jsx',
        'frontend/src/eng/PlanningAssigneeCapacityBar.jsx',
        'frontend/src/eng/usePlanningAssigneeCapacity.js',
        'frontend/src/eng/planningAssigneeCapacityModel.js',
        'frontend/src/eng/PlanningAssigneeAddPicker.jsx',
        'frontend/src/api/assigneeCapacityApi.js',
    ];
    const emitter = /dataLayer|gtag\s*\(|JepAnalytics|analytics\/|\btrack[A-Z]\w*\s*\(|onAnalyticsAction|capacity_edit_open|capacity_change_(?:submit|result)/;
    for (const relativePath of modules) {
        const source = read(relativePath);
        assert.doesNotMatch(source, emitter, `${relativePath} must not emit analytics`);
    }
    // Allowed plumbing: the API module's trackedFetch calls (api_result only), each on the dedicated surface
    // with featureName planning_review; no other module calls trackedFetch.
    const api = read('frontend/src/api/assigneeCapacityApi.js');
    const calls = [...api.matchAll(/trackedFetch\(\s*'([a-z_]+)'/g)].map(match => match[1]);
    assert.deepEqual(calls, ['planning_assignee_capacity', 'planning_assignee_capacity']);
    assert.equal((api.match(/trackedFetch\(/g) || []).length, 2);
    assert.equal((api.match(/featureName: 'planning_review'/g) || []).length, 2);
    assert.doesNotMatch(api, /featureName: '(?!planning_review')/);
    for (const relativePath of modules.slice(0, -1)) assert.doesNotMatch(read(relativePath), /trackedFetch|api\/http\.js/, relativePath);
});
