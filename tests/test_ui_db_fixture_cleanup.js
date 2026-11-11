const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startDbOAuthServer } = require('./ui/db_oauth_fixture');

async function syntheticLauncher(t, failure) {
    const scratch = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(scratch, { recursive: true });
    const root = fs.mkdtempSync(path.join(scratch, 'ui-cleanup-check-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const executable = path.join(root, 'synthetic-launcher.sh');
    fs.writeFileSync(executable, `#!/bin/sh
printf '%s\\n' '{"ready":true,"baseUrl":"http://localhost:9"}'
read -r command
printf '%s\\n' '{"id":1,"ok":true}'
${failure ? "printf '%s\\n' 'Synthetic DB/OAuth fixture failed: ready-forwarded/ClusterError' >&2\nexit 1" : 'exit 0'}
`, { mode: 0o755 });
    return startDbOAuthServer({ python: executable });
}

test('owned PostgreSQL cleanup failure cannot become a passing worker teardown', async t => {
    const server = await syntheticLauncher(t, true);
    await assert.rejects(server.stop(), /PostgreSQL.*cleanup failed/);
});

test('a normally stopped owned fixture can close repeatedly', async t => {
    const server = await syntheticLauncher(t, false);
    await server.stop();
    await server.stop();
});
