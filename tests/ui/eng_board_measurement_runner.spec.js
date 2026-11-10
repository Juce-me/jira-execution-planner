const { test: base, expect } = require('@playwright/test');
const { DB_OAUTH_SETUP_TIMEOUT_MS, startDbOAuthServer } = require('./db_oauth_fixture');
const fs = require('node:fs');
const path = require('node:path');
const { python, pythonMissingReason } = require('./python_interpreter');

const root = path.resolve(__dirname, '../..');
const test = base.extend({
  measurementServer: [async ({}, use) => {
    base.skip(Boolean(pythonMissingReason), pythonMissingReason);
    const server = await startDbOAuthServer({ python, mode: 'measurement' });
    try { await use(server); }
    finally { await server.stop(); }
  }, { timeout: DB_OAUTH_SETUP_TIMEOUT_MS + 30000 }],
});

test('measurement runner is external-script-only and keeps results transient', async () => {
  const html = fs.readFileSync(path.join(root, 'runners/local/eng_board_measurement_runner.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'runners/local/eng_board_measurement_runner.js'), 'utf8');
  expect(html).toContain('src="/api/dev/eng-board-measurement/runner.js"');
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
  expect(html).not.toMatch(/\son\w+=/i);
  expect(js).not.toContain('localStorage');
  expect(js).not.toContain('sessionStorage');
  expect(js).not.toContain('eval(');
  expect(js).not.toContain('console.');
  expect(js).toContain('deadline_bound_unproven');
});

test('runner loads through Flask with production CSP and its external script', async ({ browser, measurementServer: server }) => {
  const baseUrl = server.baseUrl;
  const context = await server.createContext(browser);
  const page = await context.newPage();
  try {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__measurementCspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.__measurementCspViolations.push({directive:event.effectiveDirective, blocked:event.blockedURI});
      });
    });
    const response = await page.goto(`${baseUrl}/api/dev/eng-board-measurement`);
    expect(response.status()).toBe(200);
    const csp = response.headers()['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    await expect(page.locator('#status')).not.toHaveText('Loading options…');
    expect(await page.evaluate(() => window.__measurementCspViolations)).toEqual([]);
    expect(pageErrors).toEqual([]);
    const asset = await context.request.head(`${baseUrl}/api/dev/eng-board-measurement/runner.js`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['content-type']).toContain('application/javascript');
    expect(asset.headers()['x-content-type-options']).toBe('nosniff');
  } finally { await context.close(); }
});
