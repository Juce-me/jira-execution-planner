const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.join(__dirname, '..', 'frontend', 'src');

function read(relative) {
    const source = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    // Full-line comments mention <StatusPill> and getIssueStatusClassName; they are not call sites.
    return source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
}

const count = (source, pattern) => (source.match(pattern) || []).length;

// Every `getIssueStatusClassName(` call and raw `task-status` literal in the frontend, classified.
//   inherits    - the file passes `status=` to the shared StatusPill, or hands the status to a
//                 component that applies it itself (StatusTransitionMenu, IssueCard).
//   direct-style - the Settings composer passes the same style straight from its local draft (Decision 9).
//   excluded    - not an in-scope Jira status pill; the reason is the Excluded table in the plan.
const SITES = {
    'dashboard.jsx': { kind: 'inherits', calls: 1, pills: 0, menus: 1, statusAttrs: 1, taskStatus: 0, note: 'statusAttrs: the unrelated connection-recovery banner status=' },
    'eng/EpicBlock.jsx': { kind: 'inherits', calls: 2, pills: 1, menus: 1, statusAttrs: 1, taskStatus: 0 },
    'eng/EngBoardEpicCard.jsx': { kind: 'inherits', calls: 1, pills: 1, menus: 0, statusAttrs: 1, taskStatus: 0 },
    'eng/EngBoardEpicPanel.jsx': { kind: 'inherits', calls: 3, pills: 2, menus: 2, statusAttrs: 2, taskStatus: 0 },
    'eng/EngBoardView.jsx': { kind: 'inherits', calls: 1, pills: 0, menus: 0, statusAttrs: 0, taskStatus: 1, hook: true },
    'eng/PlanningReviewTable.jsx': { kind: 'inherits', calls: 2, pills: 2, menus: 0, statusAttrs: 1, taskStatus: 0, note: 'the second pill is the "N Stories awaited" count badge (excluded)' },
    'issues/IssueCard.jsx': { kind: 'inherits', calls: 4, pills: 2, menus: 2, statusAttrs: 2, taskStatus: 0 },
    'issues/StatusTransitionMenu.jsx': { kind: 'inherits', calls: 1, pills: 1, menus: 0, statusAttrs: 1, taskStatus: 0, hook: true },
    'settings/GroupBoardSettings.jsx': { kind: 'direct-style', calls: 1, pills: 1, menus: 0, statusAttrs: 0, taskStatus: 0 },
    'eng/EngFilterBar.jsx': { kind: 'excluded', reason: 'filter popover keeps its own soft tint', calls: 1, pills: 1, menus: 0, statusAttrs: 0, taskStatus: 0 },
    'epm/EpmRollupPanel.jsx': { kind: 'excluded', reason: 'EPM', calls: 3, pills: 5, menus: 0, statusAttrs: 0, taskStatus: 0 },
    'epm/EpmRollupTree.jsx': { kind: 'excluded', reason: 'EPM', calls: 0, pills: 0, menus: 0, statusAttrs: 0, taskStatus: 1 },
    'epm/EpmSettings.jsx': { kind: 'excluded', reason: 'EPM', calls: 0, pills: 1, menus: 0, statusAttrs: 0, taskStatus: 0 },
    'settings/JiraFieldSettings.jsx': { kind: 'excluded', reason: 'Settings mapping preview, no Board column semantics', calls: 1, pills: 1, menus: 0, statusAttrs: 0, taskStatus: 0 },
    'issues/issueViewUtils.js': { kind: 'definition', calls: 1, pills: 0, menus: 0, statusAttrs: 0, taskStatus: 1 },
};

function listSources(dir) {
    return fs.readdirSync(path.join(srcRoot, dir), { withFileTypes: true }).flatMap((entry) => {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'styles' ? [] : listSources(relative);
        return /\.(jsx?|mjs)$/.test(entry.name) ? [relative] : [];
    });
}

test('every status-class call site and raw task-status literal is classified', () => {
    const files = ['dashboard.jsx', ...listSources('.').filter((file) => file !== 'dashboard.jsx')];
    const found = {};
    for (const file of new Set(files.map((entry) => entry.replace(/^\.\//, '')))) {
        const source = read(file);
        const calls = count(source, /getIssueStatusClassName\(/g);
        const taskStatus = count(source, /task-status/g);
        if (calls || taskStatus) found[file] = { calls, taskStatus };
    }
    for (const [file, actual] of Object.entries(found)) {
        assert.ok(SITES[file], `${file} has a status-class call or task-status literal that is not classified`);
        assert.equal(actual.calls, SITES[file].calls, `${file}: getIssueStatusClassName( count`);
        assert.equal(actual.taskStatus, SITES[file].taskStatus, `${file}: task-status literal count`);
    }
    for (const [file, site] of Object.entries(SITES)) {
        if (site.calls || site.taskStatus) assert.ok(found[file], `${file} is classified but has no call site any more`);
    }
});

test('per-file pill, menu, status= and hook counts are pinned, so a second unpassed pill fails', () => {
    for (const [file, site] of Object.entries(SITES)) {
        const source = read(file);
        assert.equal(count(source, /<StatusPill\b/g), site.pills, `${file}: <StatusPill count`);
        assert.equal(count(source, /<StatusTransitionMenu\b/g), site.menus, `${file}: <StatusTransitionMenu count`);
        assert.equal(count(source, /\sstatus=\{/g), site.statusAttrs, `${file}: status= count`);
        assert.equal(count(source, /useStatusColourStyle\(/g), site.hook ? 1 : 0, `${file}: useStatusColourStyle( count`);
    }
});

test('inheriting files pass status= or apply the colour themselves', () => {
    for (const [file, site] of Object.entries(SITES)) {
        if (site.kind !== 'inherits') continue;
        const source = read(file);
        const passes = /\sstatus=\{/.test(source) || /useStatusColourStyle\(/.test(source);
        assert.ok(passes, `${file} inherits Board colours but neither passes status= nor calls useStatusColourStyle`);
    }
});

test('the Settings composer previews with a direct style and never passes status', () => {
    const source = read('settings/GroupBoardSettings.jsx');
    assert.match(source, /buildStatusStyle\(resolveStatusColumnColour\(/);
    assert.doesNotMatch(source, /\sstatus=\{/);
});

test('excluded surfaces never pass status', () => {
    for (const [file, site] of Object.entries(SITES)) {
        if (site.kind === 'excluded') assert.doesNotMatch(read(file), /\sstatus=\{/, `${file} (${site.reason})`);
    }
});

test('the dashboard mounts the provider but never calls the hook, and the hook sits at the top of its two owners', () => {
    const dashboard = read('dashboard.jsx');
    assert.doesNotMatch(dashboard, /useStatusColourStyle/);
    assert.match(dashboard, /<StatusColourProvider columns=\{activeGroup\?\.board\?\.columns\} enabled=\{selectedView === 'eng' && activeGroup\?\.board\?\.inheritColumnColours === true\}>/);
    const menu = read('issues/StatusTransitionMenu.jsx');
    const board = read('eng/EngBoardView.jsx');
    for (const [name, source] of [['StatusTransitionMenu', menu], ['EngBoardView', board]]) {
        const hookAt = source.indexOf('useStatusColourStyle()');
        const renderMarkerAt = source.indexOf('renderMarker=');
        assert.ok(hookAt > 0 && renderMarkerAt > hookAt, `${name}: the hook is called before, never inside, renderMarker`);
        assert.ok(!/renderMarker=\{[^]*?useStatusColourStyle/.test(source.slice(renderMarkerAt, renderMarkerAt + 900)), `${name}: no hook inside renderMarker`);
    }
});

test('the Epic header passes status= like every other site and the header class builders stay unedited', () => {
    const dashboard = read('eng/EpicBlock.jsx');
    assert.match(dashboard, /label=\{epicStatus\}\s+status=\{epicStatus\}/);
    assert.match(dashboard, /getIssueStatusClassName\(epicStatus, 'epic-status-pill'\)/);
});

test('StatusPill never forwards status to the DOM and no colour module emits analytics', () => {
    const pill = read('ui/StatusPill.jsx');
    assert.match(pill, /\n\s+status,\n\s+style,\n\s+\.\.\.props/);
    for (const file of ['issues/statusColumnColours.js', 'issues/StatusColourContext.jsx']) {
        assert.doesNotMatch(read(file), /trackEvent|dataLayer\.push/, file);
    }
});
