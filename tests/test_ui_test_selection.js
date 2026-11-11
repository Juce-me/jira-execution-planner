const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise the contributor command, not just its string: two positional filters
// are ORed by Playwright, so a built-in tests/ui filter defeats an appended file.
test('the npm Chromium command selects only the explicitly requested spec file', () => {
    const root = path.join(__dirname, '..');
    const command = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['test:frontend:ui'];
    const [executable, ...args] = command.split(/\s+/);
    assert.equal(executable, 'playwright');
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), ...args,
        'eng_story_subtasks.spec.js', '--list'], {
        cwd: root, encoding: 'utf8', timeout: 30000,
        env: { PATH: process.env.PATH || '/usr/bin:/bin', CI: '1', FORCE_COLOR: '0' },
    });
    assert.equal(result.status, 0, result.stderr);
    const files = new Set([...result.stdout.matchAll(/([\w-]+\.spec\.js):/g)].map(match => match[1]));
    assert.deepEqual([...files], ['eng_story_subtasks.spec.js']);
    assert.match(result.stdout, /in 1 file\b/);
});
