const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDashboardCssSource } = require('./css_source_helpers');

const repoRoot = path.join(__dirname, '..');
const boardCssPath = path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'board.css');
const issuesCssPath = path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'issues.css');

// An undefined custom property silently drops the WHOLE declaration it appears in, and this
// design's assets have already been caught shipping four variables that exist in no stylesheet
// (§0, §14). These guards are cheap and catch the class, not one instance.

// Written from JS rather than declared in CSS, mapped to the source file that writes them — the
// allowlist is only honest if that file really does. --board-column-accent is the composer's own
// name (settings/group-board.css); the board reuses it rather than inventing a second.
const JS_WRITTEN_CUSTOM_PROPERTIES = {
    '--board-column-accent': 'frontend/src/eng/EngBoardView.jsx',
    '--board-scrollbar-width': 'frontend/src/eng/EngBoardView.jsx',
    '--board-chrome-left': 'frontend/src/eng/EngBoardView.jsx',
    '--board-chrome-width': 'frontend/src/eng/EngBoardView.jsx',
    '--board-chrome-space': 'frontend/src/eng/EngBoardView.jsx',
    '--board-chrome-shift-y': 'frontend/src/eng/EngBoardView.jsx',
};
const INLINE_CUSTOM_PROPERTIES = new Set(Object.keys(JS_WRITTEN_CUSTOM_PROPERTIES));

// Comments are stripped: this file's own rationale names the four stand-ins in order to say they
// are not used, and a naive scan would read the explanation as the offence.
function boardCss() {
    return fs.readFileSync(boardCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function definedCustomProperties() {
    const source = readDashboardCssSource(repoRoot);
    return new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
}

test('eng/board.css exists and is imported by eng.css', async () => {
    assert.ok(fs.existsSync(boardCssPath), 'expected frontend/src/styles/eng/board.css');
    const engCss = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'styles', 'eng.css'), 'utf8');
    assert.match(engCss, /^@import "\.\/eng\/board\.css";$/m);
});

test('every custom property board.css reads is defined somewhere, or set inline', async () => {
    const defined = definedCustomProperties();
    const referenced = [...boardCss().matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((match) => match[1]);
    assert.ok(referenced.length > 0, 'expected board.css to read at least one custom property');
    const undefinedProperties = [...new Set(referenced)]
        .filter((name) => !defined.has(name) && !INLINE_CUSTOM_PROPERTIES.has(name));
    assert.deepEqual(undefinedProperties, []);
});

test('every JS-written custom property is really written by the file that claims it', async () => {
    Object.entries(JS_WRITTEN_CUSTOM_PROPERTIES).forEach(([name, sourcePath]) => {
        const source = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8');
        assert.ok(source.includes(`'${name}'`), `${sourcePath} must set ${name}`);
    });
});

test('board.css ships none of the four mockup stand-ins', async () => {
    const source = boardCss();
    ['--compact-h', '--container-max', '--sticky-controls-z', '--mono'].forEach((standIn) => {
        assert.ok(!source.includes(standIn), `${standIn} is a mockup stand-in and must not ship`);
    });
});

// §6.2's card CSS turned up four more of the same problem: --st-done/--st-progress/--serif are
// read by the asset's .ecard/.eprog-track/.etitle but defined in no real stylesheet, and
// --text-muted is read by the app's own .story-subtask-assignee yet defined nowhere either (the
// asset's own header comment says so). None belong in board.css, which reuses real classes/tokens
// instead (.story-subtasks-progress-track, var(--text-secondary), the inherited body serif).
test('board.css ships none of the four card-CSS mockup stand-ins either', async () => {
    const source = boardCss();
    ['--st-done', '--st-progress', '--serif', '--text-muted'].forEach((standIn) => {
        assert.ok(!source.includes(standIn), `${standIn} is a mockup stand-in and must not ship`);
    });
});

test('board.css scopes its column classes so the composer preview cannot collide', async () => {
    // `.col`, `.col-strip`, `.fill` and `.vert` are shared with the settings preview by design
    // (they must not drift), which also makes them collidable: both stylesheets land in one
    // dashboard.css. The preview scopes under `.board-preview`; the board scopes under `.eng-board`.
    const selectors = boardCss()
        .split('}')
        .map((block) => block.split('{')[0])
        .filter((selector) => /(^|[\s,])\.(col|col-strip|col-head|col-body|fill|vert)\b/.test(selector));
    assert.ok(selectors.length > 0, 'expected board.css to style the shared column classes');
    selectors.forEach((selector) => {
        selector.split(',').forEach((part) => {
            const trimmed = part.trim();
            if (!trimmed || !/\.(col|col-strip|col-head|col-body|fill|vert)\b/.test(trimmed)) return;
            assert.ok(
                trimmed.startsWith('.eng-board'),
                `"${trimmed}" must be scoped under .eng-board so it cannot reach .board-preview`,
            );
        });
    });
});

test('ENG epic headline source keeps the calibrated one-row sizing contract scoped away from EPM', async () => {
    const source = fs.readFileSync(issuesCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const scoped = '.task-list:not(.epm-issue-board) .epic-block > .epic-header';

    assert.ok(source.includes(scoped), 'epic headline correction must cover grouped ENG epics while remaining scoped away from EPM boards');
    assert.doesNotMatch(source, /\.epic-meta\s*>\s*\*\s*\{[^}]*(?:^|;)\s*height\s*:/ms);
    assert.doesNotMatch(source, /\.epic-assignee\s*\{[^}]*(?:^|;)\s*height\s*:/ms);
    assert.doesNotMatch(source, /\.epic-key\s*,[^{]*\.epic-meta\s*\{[^}]*\btop\s*:/s,
        'vertical offsets cannot substitute for visible-size calibration');
    assert.match(source, /\.epic-title\s*\{[^}]*flex:\s*1\s+1\s+0(?:px|%)?\s*;/s);
    assert.match(source, /\.epic-link\s*\{[^}]*grid-template-columns:\s*minmax\(110px,\s*1fr\)\s+max-content\s*;/s);
    assert.match(source, /\.epic-name[^}]*font-size:\s*16px\s*;[^}]*line-height:\s*24px\s*;/s);
    assert.match(source, /\.epic-key[^}]*font-size:\s*14px\s*;[^}]*line-height:\s*24px\s*;/s);
    assert.match(source, /\.epic-meta[^}]*flex:\s*0\s+1\s+auto\s*;[^}]*min-width:\s*0\s*;[^}]*max-width:\s*none\s*;/s);
    assert.match(source, /\.epic-meta[^}]*font-size:\s*14px\s*;[^}]*line-height:\s*24px\s*;/s);
    assert.match(source, /\.epic-status-pill[^}]*height:\s*24px\s*;/s);
    assert.match(source, /\.epic-story-points[^}]*height:\s*24px\s*;/s);
    assert.match(source, /\.epic-assignee\s+input\.issue-person-editor-trigger[^}]*height:\s*24px\s*;/s);
    assert.match(source, /\.epic-assignee[^}]*min-width:\s*126px\s*;/s);
    assert.match(source, /\.epic-status-pill[^}]*max-width:\s*140px\s*;[^}]*text-overflow:\s*ellipsis\s*;/s);
});

test('ENG epic headline source sizes artwork and keeps focus/readout visible', async () => {
    const source = fs.readFileSync(issuesCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    assert.match(source, /\.epic-icon[^}]*width:\s*24px\s*;[^}]*height:\s*24px\s*;/s);
    assert.match(source, /\.epic-icon\s+svg[^}]*width:\s*16px\s*;[^}]*height:\s*16px\s*;/s);
    assert.match(source, /\.task-priority-icon[^}]*width:\s*24px\s*;[^}]*height:\s*24px\s*;/s);
    assert.match(source, /\.task-priority-icon\s+svg[^}]*width:\s*18px\s*;[^}]*height:\s*18px\s*;/s);
    assert.match(source, /\.task-priority-icon\s*,[^}]*\.epic-track-indicator\s*\{[^}]*width:\s*24px\s*;[^}]*height:\s*24px\s*;/s);
    assert.match(source, /\.epic-track-indicator\s*\{[^}]*font-size:\s*14px\s*;/s);
    assert.match(source, /\.epic-header\s+\.task-assignee-icon[^}]*width:\s*20px\s*;[^}]*height:\s*24px\s*;/s);
    assert.match(source, /\.epic-header\s+\.task-assignee-icon\s+svg[^}]*width:\s*21px\s*;[^}]*height:\s*21px\s*;/s);
    assert.match(source, /:is\(button,\s*input,\s*a,\s*\[tabindex\]\):focus-visible[^}]*outline:\s*2px[^}]*outline-offset:\s*-2px\s*;/s);
    assert.match(source, /\.epic-full-value-readout\s*\{[^}]*position:\s*fixed\s*;[^}]*z-index:/s);
});
