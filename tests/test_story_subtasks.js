const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const helperPath = path.join(repoRoot, 'frontend', 'src', 'issues', 'subtaskProgressUtils.js');
const hookPath = path.join(repoRoot, 'frontend', 'src', 'issues', 'useStorySubtasks.js');
const issueCardPath = path.join(repoRoot, 'frontend', 'src', 'issues', 'IssueCard.jsx');
const dashboardPath = path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx');
const engSprintDataPath = path.join(repoRoot, 'frontend', 'src', 'eng', 'useEngSprintData.js');

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function loadProgressUtils() {
    assert.equal(fs.existsSync(helperPath), true, 'Expected frontend/src/issues/subtaskProgressUtils.js to exist');
    const source = readSource(helperPath)
        .replaceAll('export function ', 'function ');
    return new Function(`${source}; return { formatPercent, buildStorySubtaskProgress, formatSubtaskUpdatedDate };`)();
}

test('story subtask progress helper builds count-based widths and labels', () => {
    const { buildStorySubtaskProgress } = loadProgressUtils();

    const progress = buildStorySubtaskProgress({ total: 4, done: 1, inProgress: 2 });

    assert.equal(progress.total, 4);
    assert.equal(progress.doneWidth, '25%');
    assert.equal(progress.inProgressWidth, '50%');
    assert.equal(progress.percentLabel, '25%');
    assert.equal(progress.hasProgress, true);
    assert.equal(progress.hasDone, true);
    assert.equal(progress.hasInProgress, true);
});

test('story subtask progress helper returns disabled model for empty summary', () => {
    const { buildStorySubtaskProgress } = loadProgressUtils();

    const progress = buildStorySubtaskProgress();

    assert.deepEqual(progress, {
        total: 0,
        done: 0,
        inProgress: 0,
        waiting: 0,
        percentLabel: '0%',
        doneWidth: '0%',
        inProgressWidth: '0%',
        hasProgress: false,
        hasDone: false,
        hasInProgress: false,
    });
});

test('story subtask progress helper returns disabled model for null summary', () => {
    const { buildStorySubtaskProgress } = loadProgressUtils();

    const progress = buildStorySubtaskProgress(null);

    assert.equal(progress.total, 0);
    assert.equal(progress.hasProgress, false);
});

test('story subtask progress helper trusts backend-excluded killed counts', () => {
    const { buildStorySubtaskProgress } = loadProgressUtils();

    const progress = buildStorySubtaskProgress({
        total: 3,
        done: 1,
        inProgress: 1,
        statusCounts: { Killed: 9 },
    });

    assert.equal(progress.total, 3);
    assert.equal(progress.waiting, 1);
});

test('story subtask updated date uses compact ISO date display', () => {
    const { formatSubtaskUpdatedDate } = loadProgressUtils();

    assert.equal(formatSubtaskUpdatedDate('2026-05-01T00:00:00.000+0000'), '2026-05-01');
});

test('story subtask updated date does not drift in US timezones', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
        const { formatSubtaskUpdatedDate } = loadProgressUtils();

        assert.equal(formatSubtaskUpdatedDate('2026-05-01T00:00:00.000+0000'), '2026-05-01');
    } finally {
        process.env.TZ = originalTimezone;
    }
});

test('IssueCard exposes dedicated story subtask controls and rows', () => {
    const source = readSource(issueCardPath);

    [
        'aria-expanded',
        'aria-controls',
        'story-subtasks-toggle',
        'story-subtasks-progress',
        'story-subtasks-panel',
        'story-subtask-row',
        'formatSubtaskUpdatedDate',
    ].forEach((needle) => {
        assert.ok(source.includes(needle), `Expected IssueCard source to include ${needle}`);
    });
});

test('IssueCard hides story subtask control when the summary is empty', () => {
    const source = readSource(issueCardPath);

    assert.ok(
        source.includes('const showSubtaskControl = subtaskProgress.total > 0 || subtaskState?.expanded || subtaskState?.loading;'),
        'Expected zero-subtask summaries to render no subtask control by default'
    );
});

test('story subtask hook preserves state on the typed global auth error', () => {
    assert.equal(fs.existsSync(hookPath), true, 'Expected frontend/src/issues/useStorySubtasks.js to exist');
    const hookSource = readSource(hookPath);

    assert.ok(hookSource.includes("from '../api/engApi.js'"));
    assert.ok(hookSource.includes('fetchStorySubtasks'));
    assert.ok(hookSource.includes("from '../api/authRequired.js'"));
    assert.ok(hookSource.includes('if (isAuthenticationRequiredError(err)) {'));
    assert.ok(hookSource.includes('[storyKey]: previousEntry'));
    assert.ok(!hookSource.includes('redirectToAuthRecovery(err)'));
});

test('ENG sprint data delegates auth recovery to the shared typed boundary', () => {
    const source = readSource(engSprintDataPath);

    assert.match(source, /import \{ isAuthenticationRequiredError \} from '\.\.\/api\/authRequired\.js';/);
    assert.doesNotMatch(source, /location\.assign|redirectToAuthRecovery/);
});

test('dashboard wires story subtask hook without owning endpoint literals', () => {
    const source = readSource(dashboardPath);

    assert.ok(source.includes("import { useStorySubtasks } from './issues/useStorySubtasks.js';"));
    assert.equal(source.includes('/api/issues/subtasks'), false);
    assert.ok(source.includes('clearStorySubtasks();'));
    assert.ok(source.includes('subtaskState={storySubtasksByKey[task.key] || null}'));
    assert.ok(source.includes('onToggleSubtasks={toggleStorySubtasks}'));
    assert.ok(source.includes('onRetrySubtasks={retryStorySubtasks}'));
});

function loadInvalidationHelper() {
    const source = readSource(hookPath);
    const start = source.indexOf('export function dropStorySubtaskEntries');
    assert.ok(start > -1, 'Expected useStorySubtasks.js to export dropStorySubtaskEntries');
    const end = source.indexOf('\n}\n', start);
    const body = source.slice(start, end + 3).replace('export function ', 'function ');
    return new Function(`${body}; return dropStorySubtaskEntries;`)();
}

test('invalidateStorySubtasks drops cached entries for the keys and reloads the expanded ones', () => {
    const dropStorySubtaskEntries = loadInvalidationHelper();
    const state = {
        'SYN-1': { expanded: true, loaded: true, items: [{ key: 'SYN-1-a' }], summary: { total: 1 } },
        'SYN-2': { expanded: false, loaded: true, items: [{ key: 'SYN-2-a' }], summary: { total: 1 } },
        'SYN-3': { expanded: true, loaded: true, items: [], summary: { total: 0 } },
    };
    const { next, reloadKeys } = dropStorySubtaskEntries(state, ['SYN-1', 'SYN-2']);
    assert.deepEqual(reloadKeys, ['SYN-1']);
    assert.equal('SYN-2' in next, false, 'collapsed entries are dropped');
    assert.equal(next['SYN-1'].loaded, false, 'expanded entries are marked stale until the reload lands');
    assert.equal(next['SYN-1'].expanded, true);
    assert.equal(next['SYN-3'], state['SYN-3'], 'untouched keys keep the same entry');
});

test('invalidateStorySubtasks is a no-op for unknown keys', () => {
    const dropStorySubtaskEntries = loadInvalidationHelper();
    const state = { 'SYN-1': { expanded: true, loaded: true, items: [], summary: null } };
    const { next, reloadKeys } = dropStorySubtaskEntries(state, ['SYN-9']);
    assert.equal(next, state, 'state identity is preserved so no re-render is scheduled');
    assert.deepEqual(reloadKeys, []);
});

test('story subtask hook exposes invalidateStorySubtasks and reloads through the existing loader', () => {
    const hookSource = readSource(hookPath);
    assert.match(hookSource, /invalidateStorySubtasks,\n\s*\};/, 'hook must return invalidateStorySubtasks');
    const start = hookSource.indexOf('const invalidateStorySubtasks = React.useCallback(');
    assert.ok(start > -1, 'Expected invalidateStorySubtasks to be a useCallback in the hook');
    const end = hookSource.indexOf('[loadStorySubtasks]);', start);
    assert.ok(end > -1, 'invalidateStorySubtasks must depend on loadStorySubtasks');
    const body = hookSource.slice(start, end);
    assert.ok(body.includes('dropStorySubtaskEntries('), 'invalidation must go through dropStorySubtaskEntries');
    assert.match(body, /reloadKeys\.forEach\(/, 'only the expanded keys returned by the helper are reloaded');
    assert.match(body, /loadStorySubtasks\(\{ key \}, \{ forceRefresh: true \}\)/, 'reload must reuse loadStorySubtasks');
    assert.equal(/fetchStorySubtasks\(/.test(body), false, 'invalidation must not fetch subtasks directly');
});
