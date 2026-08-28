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

test('story subtask hook uses shared ENG auth recovery helpers', () => {
    assert.equal(fs.existsSync(hookPath), true, 'Expected frontend/src/issues/useStorySubtasks.js to exist');
    const hookSource = readSource(hookPath);

    assert.ok(hookSource.includes("from '../api/engApi.js'"));
    assert.ok(hookSource.includes('fetchStorySubtasks'));
    assert.ok(hookSource.includes("from '../eng/useEngSprintData.js'"));
    assert.ok(hookSource.includes('authRecoveryLoginUrl(err)'));
    assert.ok(hookSource.includes('redirectToAuthRecovery(err)'));
    assert.ok(hookSource.includes('onAuthRecoveryRequired?.()'));
});

test('ENG sprint data exports shared auth recovery helpers', () => {
    const source = readSource(engSprintDataPath);

    assert.match(source, /export function authRecoveryLoginUrl\(err\)/);
    assert.match(source, /export function redirectToAuthRecovery\(err\)/);
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
