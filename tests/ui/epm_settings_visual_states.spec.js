const { test, expect } = require('@playwright/test');

const viewports = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
];

const epmConfig = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'CRITE-223', subGoalKey: 'CRITE-34' },
    projects: {
        'home-1': { id: 'home-1', homeProjectId: 'home-1', name: 'BidSwitch', label: 'rnd_project_bidswitch' },
    },
};

const homeProjects = Array.from({ length: 18 }, (_, index) => ({
    id: `home-${index + 1}`,
    homeProjectId: `home-${index + 1}`,
    name: `Synthetic Project ${index + 1}`,
    homeUrl: '',
    stateValue: 'ON_TRACK',
    stateLabel: 'On track',
    tabBucket: 'active',
    latestUpdateDate: '2026-04-27',
    latestUpdateSnippet: 'Synthetic update',
    label: index === 0 ? 'rnd_project_bidswitch' : '',
    resolvedLinkage: { labels: index === 0 ? ['rnd_project_bidswitch'] : [], epicKeys: [] },
    matchState: index === 0 ? 'jep-fallback' : 'metadata-only',
}));

async function mockSettings(page, overrides = {}) {
    await page.route('**/api/**', route => {
        const url = route.request().url();
        const handledBySpecificMock = [
            '/api/epm/config',
            '/api/epm/scope',
            '/api/epm/goals',
            '/api/epm/projects/configuration',
            '/api/jira/labels',
        ].some(path => url.includes(path));
        if (handledBySpecificMock) {
            return route.fallback();
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });
    await page.route('**/api/epm/config', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...epmConfig, ...(overrides.config || {}) }),
    }));
    await page.route('**/api/epm/scope', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cloudId: 'synthetic-cloud', error: '' }),
    }));
    await page.route('**/api/epm/goals**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            goals: [
                { id: 'root', key: 'CRITE-223', name: '[EPM] R&D bi weekly report hierarchy' },
                { id: 'child', key: 'CRITE-34', name: '[EPM] BidSwitch' },
            ],
            error: '',
        }),
    }));
    await page.route('**/api/epm/projects/configuration**', route => {
        if (overrides.projectError) {
            return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic failure' }) });
        }
        if (overrides.projectDelay) {
            setTimeout(() => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ projects: overrides.projects || homeProjects }),
            }), overrides.projectDelay);
            return;
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ projects: overrides.projects || homeProjects }),
        });
    });
    await page.route('**/api/jira/labels**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ labels: ['rnd_project_bidswitch', 'rnd_project_long_label_for_visual_qa'] }),
    }));
}

async function openEpmSettings(page) {
    await page.goto('http://127.0.0.1:5050');
    await page.getByRole('button', { name: /settings/i }).click();
    await page.getByRole('button', { name: 'EPM' }).click();
}

for (const viewport of viewports) {
    test.describe(`EPM settings visual states ${viewport.name}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('scope loaded', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await expect(page.getByRole('tab', { name: 'Scope' })).toHaveAttribute('aria-selected', 'true');
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-scope-loaded.png`, fullPage: true });
        });

        test('projects prerequisites', async ({ page }) => {
            await mockSettings(page, { config: { scope: { rootGoalKey: 'CRITE-223', subGoalKey: '' }, labelPrefix: '' } });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByText('Setup required')).toBeVisible();
            await expect(page.getByRole('button', { name: 'Set sub-goal' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Set label prefix' })).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-prerequisites.png`, fullPage: true });
        });

        test('projects loading skeleton', async ({ page }) => {
            await mockSettings(page, { projectDelay: 800 });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.locator('.epm-project-skeleton-row').first()).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-loading.png`, fullPage: true });
        });

        test('projects many rows and long labels', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByText('Synthetic Project 18')).toBeVisible();
            await expect(page.getByText('No Jira label selected.').first()).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-many-rows.png`, fullPage: true });
        });

        test('projects scrolled label menu stays aligned', async ({ page }) => {
            await mockSettings(page);
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            const scrollRegion = page.locator('.epm-projects-scroll-region');
            await expect(scrollRegion).toBeVisible();
            await scrollRegion.evaluate(node => { node.scrollTop = node.scrollHeight; });
            await page.getByPlaceholder('Search Jira labels...').last().click();
            await expect(page.locator('.epm-label-menu-layer')).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-scrolled-label-menu.png`, fullPage: true });
        });

        test('projects error state', async ({ page }) => {
            await mockSettings(page, { projectError: true });
            await openEpmSettings(page);
            await page.getByRole('tab', { name: 'Projects' }).click();
            await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
            await page.screenshot({ path: `/tmp/epm-settings-qa/${viewport.name}-projects-error.png`, fullPage: true });
        });
    });
}
