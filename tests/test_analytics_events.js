const test = require('node:test');
const assert = require('node:assert/strict');

async function loadAnalytics() {
    return import('../frontend/src/analytics/analytics.js');
}

async function loadEvents() {
    return import('../frontend/src/analytics/events.js');
}

async function loadExternalLinks() {
    return import('../frontend/src/analytics/externalLinks.js');
}

async function loadHttp() {
    return import('../frontend/src/api/http.js');
}

function resetDom() {
    delete global.window;
    delete global.document;
    const appendedScripts = [];
    const head = {
        appendChild(node) {
            appendedScripts.push(node);
            return node;
        }
    };
    global.document = {
        head,
        createElement(tagName) {
            return {
                tagName: String(tagName || '').toUpperCase(),
                async: false,
                src: '',
                dataset: {}
            };
        },
        querySelector(selector) {
            return appendedScripts.find(script => script.dataset?.analyticsGtm === selector.match(/\[data-analytics-gtm="([^"]+)"\]/)?.[1]) || null;
        },
        location: { href: 'http://127.0.0.1:5050/' }
    };
    global.window = {
        dataLayer: undefined,
        location: { href: 'http://127.0.0.1:5050/' }
    };
    return { appendedScripts };
}

test('analytics initializes dataLayer without loading GTM before enabled context', async () => {
    const { initAnalytics } = await loadAnalytics();
    const { appendedScripts } = resetDom();
    const contextCalls = [];

    await initAnalytics({
        fetchContext: async () => {
            contextCalls.push('/api/analytics/context');
            return { enabled: false, gtmContainerId: 'GTM-NZJW2CFN', ga4UserId: 'user-1' };
        }
    });

    assert.deepEqual(contextCalls, ['/api/analytics/context']);
    assert.deepEqual(global.window.dataLayer, []);
    assert.equal(appendedScripts.length, 0);
});

test('analytics context request uses the dashboard X-Requested-With header', async () => {
    const { initAnalytics } = await loadAnalytics();
    resetDom();
    const requests = [];
    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        return {
            ok: true,
            json: async () => ({ enabled: false })
        };
    };

    await initAnalytics();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/analytics/context');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.headers['X-Requested-With'], 'jira-execution-planner');
    delete global.fetch;
});

test('analytics lazy-loads GTM only from enabled context and pushes only through dataLayer', async () => {
    const { initAnalytics, setAnalyticsUser, trackPageview, trackEvent } = await loadAnalytics();
    const { appendedScripts } = resetDom();
    const pushed = [];
    global.window.dataLayer = { push: entry => pushed.push(entry) };
    global.window.gtag = () => {
        throw new Error('app analytics must not call gtag');
    };

    await initAnalytics({
        fetchContext: async () => ({
            enabled: true,
            gtmContainerId: 'GTM-NZJW2CFN',
            ga4UserId: 'pseudonymous-user',
            debugMode: true
        })
    });
    setAnalyticsUser('updated-user');
    trackPageview('dashboard', { dashboard_view: 'eng', eng_mode: 'scenario', auth_mode: 'oauth', source_surface: 'dashboard' });
    trackEvent('scenario_action', { feature_name: 'scenario', workflow_action: 'compute', result: 'success', duration_bucket: '1_3s' });

    assert.equal(appendedScripts.length, 1);
    assert.equal(appendedScripts[0].src, 'https://www.googletagmanager.com/gtm.js?id=GTM-NZJW2CFN');
    assert.deepEqual(pushed, [
        {
            event: 'pageview',
            trigger: 'pageview',
            event_type: 'pageview',
            event_name: 'page_view',
            page_name: 'dashboard',
            dashboard_view: 'eng',
            eng_mode: 'scenario',
            auth_mode: 'oauth',
            source_surface: 'dashboard',
            ga4_user_id: 'updated-user',
            debug_mode: true
        },
        {
            event: 'userevent',
            trigger: 'userevent',
            event_type: 'event',
            event_name: 'scenario_action',
            feature_name: 'scenario',
            workflow_action: 'compute',
            result: 'success',
            duration_bucket: '1_3s',
            ga4_user_id: 'updated-user',
            debug_mode: true
        }
    ]);
});

test('analytics guards drop sends while context is disabled or uninitialized', async () => {
    const { trackEvent, initAnalytics } = await loadAnalytics();
    resetDom();
    const pushed = [];
    global.window.dataLayer = { push: entry => pushed.push(entry) };

    trackEvent('settings_action', { feature_name: 'settings', section: 'epm', workflow_action: 'open' });
    await initAnalytics({ fetchContext: async () => ({ enabled: false }) });
    trackEvent('settings_action', { feature_name: 'settings', section: 'epm', workflow_action: 'open' });

    assert.deepEqual(pushed, []);
});

test('analytics context refresh shuts off collection in an already-open tab', async () => {
    const { initAnalytics, refreshAnalyticsContext, trackEvent } = await loadAnalytics();
    resetDom();
    const pushed = [];
    const contexts = [
        {
            enabled: true,
            gtmContainerId: 'GTM-NZJW2CFN',
            measurementId: 'G-6QERX19WB0',
            ga4UserId: 'pseudonymous-user'
        },
        {
            enabled: false,
            gtmContainerId: null,
            measurementId: null,
            debugMode: false,
            ga4UserId: null
        }
    ];
    global.window.dataLayer = { push: entry => pushed.push(entry) };

    await initAnalytics({ fetchContext: async () => contexts.shift() });
    trackEvent('settings_action', { feature_name: 'settings', section: 'epm', workflow_action: 'open' });
    await refreshAnalyticsContext();
    trackEvent('settings_action', { feature_name: 'settings', section: 'epm', workflow_action: 'save' });

    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].workflow_action, 'open');
    assert.equal(global.window['ga-disable-G-6QERX19WB0'], true);
});

test('schema validates triggers, required context, event names, params, and event parameter count', async () => {
    const { sanitizeAnalyticsParams, validateAnalyticsPayload } = await loadEvents();
    assert.throws(
        () => validateAnalyticsPayload({ event: 'scenario_action', trigger: 'scenario_action', event_type: 'event', event_name: 'scenario_action', feature_name: 'scenario' }),
        /unsupported analytics trigger/
    );
    assert.throws(
        () => validateAnalyticsPayload({ event: 'pageview', trigger: 'pageview', event_type: 'pageview', event_name: 'page_view' }),
        /page_name is required/
    );
    assert.throws(
        () => validateAnalyticsPayload({ event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'page_view', feature_name: 'dashboard' }),
        /unsupported analytics event_name/
    );
    assert.throws(
        () => sanitizeAnalyticsParams({ feature_name: 'settings', event_category: 'legacy' }, 'settings_action'),
        /unsupported analytics parameter/
    );
    assert.throws(
        () => sanitizeAnalyticsParams({ feature_name: 'settings', section: 'epm', workflow_action: 'save', source_surface: 'settings', auth_mode: 'oauth', result: 'success', dirty_state: 'dirty', validation_count_bucket: '1_5', visible_count_bucket: '1_5', selection_count_bucket: '1_5', team_count_bucket: '1_5', group_count_bucket: '1_5', project_count_bucket: '1_5', issue_count_bucket: '1_5', conflict_count_bucket: '1_5', selected_count_bucket: '1_5', selected_sp_bucket: '1_5', override_count_bucket: '1_5', result_count_bucket: '1_5', query_length_bucket: '1_5', duration_bucket: '1_3s', range_size_bucket: '1_5', point_bucket: '1_5', status_bucket: 'selected', value_state: 'selected', cache_state: 'warm' }, 'settings_action'),
        /at most 25/
    );
});

test('schema rejects unsafe values and keeps safe numeric, enum, and bucket values', async () => {
    const { bucketCount, bucketDuration, sanitizeAnalyticsParams } = await loadEvents();

    assert.equal(bucketCount(0), '0');
    assert.equal(bucketCount(3), '1_5');
    assert.equal(bucketCount(20), '11_25');
    assert.equal(bucketDuration(250), 'under_1s');
    assert.equal(bucketDuration(2400), '1_3s');
    assert.equal(bucketDuration(10000), 'over_10s');
    assert.deepEqual(
        sanitizeAnalyticsParams({
            feature_name: 'external_links',
            link_type: 'jira_issue_list',
            issue_kind: 'mixed',
            issue_count_bucket: '11_25',
            source_surface: 'scenario',
            result: 'success',
            visible_count: 3
        }, 'external_link_opened'),
        {
            feature_name: 'external_links',
            link_type: 'jira_issue_list',
            issue_kind: 'mixed',
            issue_count_bucket: '11_25',
            source_surface: 'scenario',
            result: 'success',
            visible_count: 3
        }
    );

    const unsafeValues = [
        'ABC-123',
        'https://jira.example.com/issues/?jql=project=ABC',
        'alice@example.com',
        'Team Platform',
        'Sprint 42',
        'rnd_project_alpha',
        'draft-123',
        'Bearer abc.def.ghi',
        '{"error":"bad"}',
        'Jira returned stack trace'
    ];
    for (const value of unsafeValues) {
        assert.throws(
            () => sanitizeAnalyticsParams({ feature_name: 'settings', section: value }, 'settings_action'),
            /unsafe analytics value/
        );
    }
    assert.throws(
        () => sanitizeAnalyticsParams({ feature_name: 'settings', section: { raw: 'object' } }, 'settings_action'),
        /unsupported analytics value/
    );
});

test('effort split series_type accepts the ad_hoc and excluded_capacity enum values', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const seriesType of ['ad_hoc', 'excluded_capacity', 'product', 'tech']) {
        assert.deepEqual(
            sanitizeAnalyticsParams({
                feature_name: 'statistics',
                chart_id: 'effort_split',
                workflow_action: 'toggle_series',
                series_type: seriesType,
                value_state: 'on'
            }, 'chart_action'),
            {
                feature_name: 'statistics',
                chart_id: 'effort_split',
                workflow_action: 'toggle_series',
                series_type: seriesType,
                value_state: 'on'
            }
        );
    }
    // The Ad Hoc series must travel as the snake_case enum token, never a raw epic key or BAU display copy.
    assert.throws(
        () => sanitizeAnalyticsParams({ feature_name: 'statistics', chart_id: 'effort_split', series_type: 'TECH-9' }, 'chart_action'),
        /unsafe analytics value/
    );
});

test('external link helper emits bucketed Jira link events without raw URLs', async () => {
    const { initAnalytics, trackExternalLinkOpened } = await loadAnalytics();
    resetDom();
    const pushed = [];
    global.window.dataLayer = { push: entry => pushed.push(entry) };

    await initAnalytics({
        fetchContext: async () => ({ enabled: true, gtmContainerId: 'GTM-NZJW2CFN' })
    });
    trackExternalLinkOpened({
        linkType: 'jira_issue_list',
        issueKind: 'story',
        issueCount: 12,
        sourceSurface: 'planning',
        result: 'success'
    });

    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].event_name, 'external_link_opened');
    assert.equal(pushed[0].issue_count_bucket, '11_25');
    assert.equal('url' in pushed[0], false);
});

test('external link metadata builders use explicit safe metadata without hrefs', async () => {
    const {
        buildJiraBrowseLinkAnalytics,
        buildJiraIssueListLinkAnalytics,
        buildJiraHomeLinkAnalytics,
    } = await loadExternalLinks();

    assert.deepEqual(
        buildJiraIssueListLinkAnalytics({
            issueKind: 'story',
            issueCount: 18,
            sourceSurface: 'planning',
        }),
        {
            linkType: 'jira_issue_list',
            issueKind: 'story',
            issueCount: 18,
            sourceSurface: 'planning',
            result: 'success',
        }
    );
    assert.deepEqual(
        buildJiraBrowseLinkAnalytics({
            issueKind: 'epic',
            sourceSurface: 'epm',
        }),
        {
            linkType: 'jira_issue_browse',
            issueKind: 'epic',
            sourceSurface: 'epm',
            result: 'success',
        }
    );
    assert.deepEqual(
        buildJiraHomeLinkAnalytics({
            linkType: 'jira_home_update',
            sourceSurface: 'epm',
        }),
        {
            linkType: 'jira_home_update',
            sourceSurface: 'epm',
            result: 'success',
        }
    );
});

test('api result helper emits explicit allowlisted API surfaces only', async () => {
    const { initAnalytics, trackApiResult } = await loadAnalytics();
    resetDom();
    const pushed = [];
    global.window.dataLayer = { push: entry => pushed.push(entry) };

    await initAnalytics({
        fetchContext: async () => ({ enabled: true, gtmContainerId: 'GTM-NZJW2CFN' })
    });
    trackApiResult('epm_rollup', {
        featureName: 'epm',
        method: 'GET',
        status: 200,
        durationMs: 1250,
        cacheState: 'warm',
        epmTab: 'active',
        projectScope: 'single',
        subgoalScope: 'single'
    });
    assert.throws(
        () => trackApiResult('/api/epm/projects/ABC-123?jql=bad', { method: 'GET', status: 200 }),
        /unsupported api surface/
    );

    assert.equal(pushed.length, 1);
    assert.deepEqual(pushed[0], {
        event: 'userevent',
        trigger: 'userevent',
        event_type: 'event',
        event_name: 'api_result',
        feature_name: 'epm',
        api_surface: 'epm_rollup',
        method: 'GET',
        status_bucket: '2xx',
        result: 'success',
        duration_bucket: '1_3s',
        duration_ms: 1250,
        cache_state: 'warm',
        epm_tab: 'active',
        project_scope: 'single',
        subgoal_scope: 'single'
    });
});

test('tracked fetch does not let analytics validation failures affect API fetch', async () => {
    const { trackedFetch } = await loadHttp();
    resetDom();
    global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '' },
        json: async () => ({ ok: true })
    });

    const response = await trackedFetch('/api/raw', '/api/test');

    assert.equal(response.status, 200);
    delete global.fetch;
});

async function loadDashboardAnalytics() {
    return import('../frontend/src/analytics/dashboardAnalytics.js');
}

test('buildSortChangedParams produces correct ENG sort payload with source_surface=eng', async () => {
    const { buildSortChangedParams } = await loadDashboardAnalytics();
    const { sanitizeAnalyticsParams } = await loadEvents();

    // ENG call site: trackSortChanged('eng_epics', value, { feature_name: 'eng', source_surface: 'eng' })
    const payload = buildSortChangedParams('eng_epics', 'track-committed', { feature_name: 'eng', source_surface: 'eng' });
    assert.deepEqual(payload, {
        feature_name: 'eng',
        sort_scope: 'eng_epics',
        sort_key: 'track_committed',
        source_surface: 'eng',
    });

    // sanitize must keep all ENG values and strip no required fields
    assert.deepEqual(
        sanitizeAnalyticsParams(payload, 'sort_changed'),
        {
            feature_name: 'eng',
            sort_scope: 'eng_epics',
            sort_key: 'track_committed',
            source_surface: 'eng',
        }
    );
});

test('buildSortChangedParams defaults to epm surface for EPM callers', async () => {
    const { buildSortChangedParams } = await loadDashboardAnalytics();

    const payload = buildSortChangedParams('projects', 'updated-desc');
    assert.deepEqual(payload, {
        feature_name: 'epm',
        sort_scope: 'projects',
        sort_key: 'updated_desc',
        source_surface: 'epm',
    });
});

test('sort_changed rejects raw hyphenated sort keys that bypass analyticsToken', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();

    // Raw hyphenated sort values (pre-analyticsToken) are rejected as unsafe
    assert.throws(
        () => sanitizeAnalyticsParams({ feature_name: 'eng', sort_scope: 'eng_epics', sort_key: 'track-committed', source_surface: 'eng' }, 'sort_changed'),
        /unsafe analytics value/
    );
});
