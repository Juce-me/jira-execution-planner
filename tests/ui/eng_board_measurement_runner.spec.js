const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const port = 5067;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

test.beforeAll(async () => {
  server = spawn(path.join(root, '.venv/bin/python'), ['-c',
    `import jira_server; jira_server.app.run(host='127.0.0.1', port=${port}, debug=False, use_reloader=False)`], {
    cwd: root,
    env: {...process.env, APP_ENVIRONMENT_KEY:'local', ALLOW_DEV_DIAGNOSTIC_ENDPOINTS:'true',
      JIRA_AUTH_MODE:'basic', CONFIG_STORAGE_BACKEND:'json', DATABASE_URL:''},
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('real Flask test server did not become ready');
});

test.afterAll(() => {
  if (server && !server.killed) server.kill('SIGTERM');
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

test('runner loads through Flask with production CSP and its external script', async ({ page, request }) => {
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
  const asset = await request.head(`${baseUrl}/api/dev/eng-board-measurement/runner.js`);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('application/javascript');
  expect(asset.headers()['x-content-type-options']).toBe('nosniff');
});
