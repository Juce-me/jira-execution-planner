const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';

test('shows a visible server error when bootstrap API requests cannot connect', async ({ page }) => {
    const consoleFailures = [];
    page.on('console', message => {
        if (['error', 'warning', 'warn'].includes(message.type())) {
            consoleFailures.push(message.text());
        }
    });
    await installDashboardShell(page);
    await page.route('**/api/**', route => route.abort('connectionrefused'));

    await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Server is not responding');
    await expect(alert).toContainText('http://127.0.0.1:5050');
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    expect(consoleFailures.filter(message => !message.includes('Failed to load resource'))).toEqual([]);
});
