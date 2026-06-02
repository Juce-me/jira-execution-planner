const { test, expect } = require('@playwright/test');
const { activeHomeTokenConnection, installDashboardFixture } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

async function installAnalyticsRoutes(page, context) {
    await page.route('**/api/analytics/context', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(typeof context === 'function' ? context() : context)
    }));
}

test('disabled analytics initializes dataLayer but does not request Google tags', async ({ page }) => {
    const googleRequests = [];
    page.on('request', request => {
        const url = request.url();
        if (url.includes('googletagmanager.com') || url.includes('google-analytics.com')) {
            googleRequests.push(url);
        }
    });
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await installAnalyticsRoutes(page, { enabled: false });

    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    await expect.poll(() => page.evaluate(() => Array.isArray(window.dataLayer))).toBe(true);
    expect(googleRequests).toEqual([]);
});

test('enabled analytics lazy-loads GTM from context and emits only app-owned triggers', async ({ page }) => {
    const googleRequests = [];
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await installAnalyticsRoutes(page, {
        enabled: true,
        gtmContainerId: 'GTM-NZJW2CFN',
        ga4UserId: 'user-analytics-id',
        debugMode: true
    });
    await page.route('https://www.googletagmanager.com/gtm.js?id=GTM-NZJW2CFN', route => {
        googleRequests.push(route.request().url());
        return route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: ''
        });
    });
    await page.route('https://www.google-analytics.com/**', route => {
        googleRequests.push(route.request().url());
        return route.fulfill({ status: 204, body: '' });
    });

    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => typeof window.JepAnalytics?.trackEvent)).toBe('function');
    await expect.poll(() => googleRequests.includes('https://www.googletagmanager.com/gtm.js?id=GTM-NZJW2CFN')).toBe(true);
    await page.evaluate(() => {
        window.JepAnalytics.trackPageview('dashboard', {
            dashboard_view: 'eng',
            eng_mode: 'scenario',
            auth_mode: 'oauth',
            source_surface: 'dashboard'
        });
        window.JepAnalytics.trackEvent('app_search', {
            feature_name: 'search',
            search_scope: 'dashboard',
            query_length_bucket: '1_5',
            result_count_bucket: '6_10',
            source_surface: 'dashboard'
        });
        window.JepAnalytics.trackEvent('filter_changed', {
            feature_name: 'filters',
            filter_type: 'sprint',
            selection_count_bucket: '1_5',
            source_surface: 'dashboard'
        });
        window.JepAnalytics.trackEvent('settings_action', {
            feature_name: 'settings',
            section: 'connections',
            workflow_action: 'open',
            result: 'success'
        });
        window.JepAnalytics.trackEvent('login', {
            feature_name: 'auth',
            method: 'atlassian_oauth',
            auth_mode: 'oauth',
            result: 'success',
            source_surface: 'dashboard'
        });
        window.JepAnalytics.trackEvent('planning_action', {
            feature_name: 'planning',
            workflow_action: 'select_all_visible',
            status_bucket: 'selected',
            selected_count_bucket: '1_5',
            selected_sp_bucket: '6_10',
            selected_count: 3,
            selected_story_points: 8,
            source_surface: 'planning'
        });
        window.JepAnalytics.trackEvent('connection_action', {
            feature_name: 'connections',
            connection_type: 'home_townsquare',
            workflow_action: 'status',
            previous_status: 'missing',
            result: 'success'
        });
        window.JepAnalytics.trackEvent('scenario_action', {
            feature_name: 'scenario',
            workflow_action: 'compute',
            lane_mode: 'team',
            result: 'success',
            duration_bucket: '1_3s'
        });
        window.JepAnalytics.trackEvent('api_result', {
            feature_name: 'epm',
            api_surface: 'epm_rollup',
            method: 'GET',
            status_bucket: '2xx',
            result: 'success',
            duration_bucket: 'under_1s',
            cache_state: 'warm'
        });
        window.JepAnalytics.trackEvent('app_error_shown', {
            feature_name: 'auth',
            error_area: 'auth',
            error_code: 'auth_required',
            recoverable_state: 'reauth',
            source_surface: 'dashboard'
        });
        window.JepAnalytics.trackExternalLinkOpened({
            linkType: 'jira_issue_list',
            issueKind: 'mixed',
            issueCount: 7,
            sourceSurface: 'scenario',
            result: 'success'
        });
        window.JepAnalytics.trackExternalLinkOpened({
            linkType: 'jira_issue_browse',
            issueKind: 'epic',
            sourceSurface: 'epm',
            result: 'success'
        });
        window.JepAnalytics.trackExternalLinkOpened({
            linkType: 'jira_home_project',
            epmTab: 'active',
            projectScope: 'single',
            sourceSurface: 'epm',
            result: 'success'
        });
    });

    const pushes = await page.evaluate(() => window.dataLayer.filter(entry => entry && entry.trigger));
    expect(googleRequests).toContain('https://www.googletagmanager.com/gtm.js?id=GTM-NZJW2CFN');
    expect(pushes.length).toBeGreaterThanOrEqual(10);
    for (const push of pushes) {
        expect(['pageview', 'userevent']).toContain(push.event);
        expect(push.trigger).toBe(push.event);
        expect(Object.keys(push).length).toBeLessThanOrEqual(25);
        expect(JSON.stringify(push)).not.toMatch(/https?:|jql=|ABC-\d+|@|Bearer|token|raw/i);
        if (push.event === 'pageview') {
            expect(push.page_name).toBeTruthy();
            expect(push.event_name).toBe('page_view');
        } else {
            expect(push.feature_name).toBeTruthy();
            expect(push.event_name).not.toBe('page_view');
        }
    }
});

test('analytics kill switch stops app-owned sends in an open tab', async ({ page }) => {
    let analyticsContext = {
        enabled: true,
        gtmContainerId: 'GTM-NZJW2CFN',
        measurementId: 'G-6QERX19WB0',
        ga4UserId: 'user-analytics-id'
    };
    await installDashboardFixture(page, { connection: activeHomeTokenConnection() });
    await installAnalyticsRoutes(page, () => analyticsContext);
    await page.route('https://www.googletagmanager.com/gtm.js?id=GTM-NZJW2CFN', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));

    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.dataLayer.some(entry => entry && entry.trigger))).toBe(true);
    await page.evaluate(() => {
        window.dataLayer.length = 0;
    });
    await page.evaluate(() => {
        window.JepAnalytics.trackEvent('settings_action', {
            feature_name: 'settings',
            section: 'epm',
            workflow_action: 'open',
            result: 'success'
        });
    });

    analyticsContext = {
        enabled: false,
        gtmContainerId: null,
        measurementId: null,
        debugMode: false,
        ga4UserId: null
    };
    await page.evaluate(async () => {
        await window.JepAnalytics.refreshAnalyticsContext();
        window.JepAnalytics.trackEvent('settings_action', {
            feature_name: 'settings',
            section: 'epm',
            workflow_action: 'save',
            result: 'success'
        });
    });

    const state = await page.evaluate(() => ({
        pushes: window.dataLayer.filter(entry => entry && entry.trigger),
        disabled: window['ga-disable-G-6QERX19WB0']
    }));
    expect(state.pushes).toHaveLength(1);
    expect(state.pushes[0].workflow_action).toBe('open');
    expect(state.disabled).toBe(true);
});
