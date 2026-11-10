// Guard: the ENG surfaces that name work entities take every entity word from EntityNames
// (`frontend/src/eng/engWorkModel.js`), never from a hard-coded "Story", "Epic" or "Initiative".
//
// The scan strips comments and looks at (a) JSX text, (b) the values of user-visible attributes and `title =`
// parameter defaults, single words included, and (c) every other string or template literal that is not a className
// value, not a selector argument and not a single token (a single capitalised entity word is still flagged).
// Lines that build Jira queries (`issuetype`, `"Epic Link"`, `jql`) are skipped. Known exceptions are listed in
// ALLOWLIST with the reason they are not a display name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const ENTITY_WORD = /\b(stor(y|ies)|epics?|initiatives?)\b(?!\s+points)/i;
const CAPITALISED_ENTITY = /^(Story|Stories|Epic|Epics|Initiative|Initiatives)$/;
const SINGLE_TOKEN = /^[\w-]+$/;
const VISIBLE_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label', 'data-tooltip', 'fieldLabel', 'emptyMessage']);
const SKIPPED_LINE = /issuetype|"Epic Link"|jql/i;
// Selector, anchor and attribute-selector strings (`.epic-name`, `#story-KEY`, `[data-story-key]`) are not copy.
const SELECTOR_LIKE = /^[.#\[]/;
// The second argument of openSingleIssueStatusControl(issue, 'Epic') is the fallbackIssueType token (data-issue-kind).
const FALLBACK_TYPE_CALL = /openSingleIssueStatusControl\??\.?\(\s*[^()]*,\s*$/;
const SELECTOR_CALL = /(querySelector|querySelectorAll|closest|matches)\s*\(\s*$/;

// Task 4 (Catch Up and alerts) and Task 6 (Planning, Board, Statistics, Scenario, onboarding) surfaces.
const FILES = [
    'frontend/src/eng/EngFilterControls.jsx',
    'frontend/src/eng/engCatchUpFilters.js',
    'frontend/src/eng/EngAlertsPanel.jsx',
    'frontend/src/futurePlanningNeedsStories.mjs',
    'frontend/src/eng/StoryRequirementCard.jsx',
    'frontend/src/eng/EpicBlock.jsx',
    'frontend/src/issues/IssueCard.jsx',
    'frontend/src/issues/WorkTypeGlyph.jsx',
    'frontend/src/eng/EngView.jsx',
    'frontend/src/eng/engWorkHierarchy.js',
    'frontend/src/eng/useEngAlerts.js',
    'frontend/src/eng/epicRefreshAlerts.js',
    'frontend/src/eng/useEpicRefresh.js',
    'frontend/src/eng/PlanningActionBar.jsx',
    'frontend/src/eng/PlanningAssigneeCapacity.jsx',
    'frontend/src/eng/PlanningProjectSplitBar.jsx',
    'frontend/src/eng/PlanningReviewTable.jsx',
    'frontend/src/eng/planningReviewTableModel.js',
    'frontend/src/eng/EngBoardView.jsx',
    'frontend/src/eng/EngBoardEpicPanel.jsx',
    'frontend/src/eng/EngBoardEpicCard.jsx',
    'frontend/src/eng/EngBoardHelp.jsx',
    'frontend/src/eng/engBoardColumns.js',
    'frontend/src/eng/engBoardFilters.js',
    'frontend/src/stats/StatsPanel.jsx',
    'frontend/src/cohort/LeadTimesEpicCharts.jsx',
    'frontend/src/stats/StatsTeamsView.jsx',
    'frontend/src/cohort/OpenEpicsChart.jsx',
    'frontend/src/stats/BurnoutChart.jsx',
    'frontend/src/stats/ProjectTrackPhaseChart.jsx',
    'frontend/src/stats/ProjectTrackBreakdownChart.jsx',
    'frontend/src/stats/StatsPriorityView.jsx',
    'frontend/src/cohort/CohortGrid.jsx',
    'frontend/src/cohort/LeadTimesWorkflowStatusCard.jsx',
    'frontend/src/scenario/ScenarioView.jsx',
    'frontend/src/scenario/scenarioUtils.js',
    'frontend/src/components/JiraExportButton.jsx',
    'frontend/src/shareView/ShareViewButton.jsx',
    'frontend/src/onboarding/onboardingSteps.js',
    'frontend/src/onboarding/OnboardingTour.jsx',
    'frontend/src/onboarding/useOnboardingTour.js',
];

// Only these ranges of the App are in scope. Line numbers drift, so each range starts at a source anchor and spans
// `lines` lines, or runs to the `end` anchor (inclusive).
const DASHBOARD = 'frontend/src/dashboard.jsx';
const DASHBOARD_RANGES = [
    { start: 'function InitiativeIcon(', lines: 1 },
    { start: 'const storyReadinessMessage = ', lines: 1 },
    { start: 'onMissing: () => setStoryRequirementNavigationError(', lines: 1 },
    { start: 'const buildPriorityStatusLink = ', end: 'const buildKeyListLink = ' },
];

// {file, snippet, reason}: a finding in `file` whose whole literal equals `snippet` is not a display name.
const ALLOWLIST = [
    { file: 'frontend/src/eng/PlanningProjectSplitBar.jsx',
        snippet: 'Planning capacity split: 70% Product / 30% Tech (tech-heavy teams may aim for 10% / 90%). Planned effort excludes excluded epics.',
        reason: 'Legacy-only branch: the new model renders CombinedWorkBar instead' },
    { file: 'frontend/src/stats/StatsPanel.jsx', snippet: 'Approximate, story-point based',
        reason: 'Story Points: the Jira estimate field, not a work entity' },
];

// ---- A small JS/JSX lexer: enough to tell comments, strings, templates, regexes, JSX text and attributes apart.

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$\-.:]/;
const REGEX_PREFIX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

function lex(source) {
    const found = [];
    let i = 0;
    let line = 1;
    // Each frame: {mode: 'js'|'tag'|'children'|'template', depth, attr}
    const stack = [{ mode: 'js', depth: 0, attr: null }];
    let prev = ''; // previous significant token in JS mode ('' = start, 'id' = identifier/number/close)
    let prevWord = '';

    const top = () => stack[stack.length - 1];
    const advance = (n = 1) => {
        for (let k = 0; k < n; k += 1) {
            if (source[i] === '\n') line += 1;
            i += 1;
        }
    };
    const emit = (kind, value, startLine, startIndex, attr) => found.push({ kind, value, line: startLine, index: startIndex, attr });

    const readString = (quote) => {
        const startLine = line;
        const startIndex = i;
        advance();
        let value = '';
        while (i < source.length && source[i] !== quote) {
            if (source[i] === '\\') { value += source[i + 1]; advance(2); continue; }
            value += source[i];
            advance();
        }
        advance();
        return { value, startLine, startIndex };
    };

    const skipComment = () => {
        if (source[i] === '/' && source[i + 1] === '/') {
            while (i < source.length && source[i] !== '\n') advance();
            return true;
        }
        if (source[i] === '/' && source[i + 1] === '*') {
            advance(2);
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) advance();
            advance(2);
            return true;
        }
        return false;
    };

    const jsxCanStart = () => (prev === '' || prev === 'op' || REGEX_PREFIX_WORDS.has(prevWord) && prev === 'word');

    // Template literal: emits the static text with `${…}` replaced by a placeholder; expressions are lexed as JS.
    const startTemplate = (attr) => {
        const startLine = line;
        const startIndex = i;
        advance();
        stack.push({ mode: 'template', depth: 0, attr, text: '', startLine, startIndex });
    };

    while (i < source.length) {
        const frame = top();
        const ch = source[i];

        if (frame.mode === 'template') {
            if (ch === '\\') { frame.text += source[i + 1]; advance(2); continue; }
            if (ch === '`') {
                advance();
                stack.pop();
                emit('template', frame.text, frame.startLine, frame.startIndex, frame.attr);
                prev = 'id';
                continue;
            }
            if (ch === '$' && source[i + 1] === '{') {
                frame.text += '\u0000';
                advance(2);
                stack.push({ mode: 'js', depth: 0, attr: frame.attr, closes: 'template' });
                prev = 'op';
                continue;
            }
            frame.text += ch;
            advance();
            continue;
        }

        if (frame.mode === 'children') {
            if (ch === '{') {
                advance();
                stack.push({ mode: 'js', depth: 0, attr: null, closes: 'children' });
                prev = 'op';
                continue;
            }
            if (ch === '<') {
                if (source[i + 1] === '/') {
                    while (i < source.length && source[i] !== '>') advance();
                    advance();
                    stack.pop(); // close this element's children
                    if (top().mode !== 'children') prev = 'id';
                    continue;
                }
                advance();
                stack.push({ mode: 'tag', depth: 0, attr: null, named: false });
                continue;
            }
            const startLine = line;
            const startIndex = i;
            let text = '';
            while (i < source.length && source[i] !== '<' && source[i] !== '{') { text += source[i]; advance(); }
            if (text.trim()) emit('jsx', text.trim(), startLine, startIndex, null);
            continue;
        }

        if (frame.mode === 'tag') {
            if (/\s/.test(ch)) { advance(); continue; }
            if (skipComment()) continue;
            if (ch === '/' && source[i + 1] === '>') {
                advance(2);
                stack.pop();
                if (top().mode !== 'children') prev = 'id';
                continue;
            }
            if (ch === '>') {
                advance();
                frame.mode = 'children';
                continue;
            }
            if (ch === '{') {
                advance();
                stack.push({ mode: 'js', depth: 0, attr: frame.pendingAttr || null, closes: 'tag' });
                frame.pendingAttr = null;
                prev = 'op';
                continue;
            }
            if (ch === '"' || ch === "'") {
                const { value, startLine, startIndex } = readString(ch);
                emit('attr', value, startLine, startIndex, frame.pendingAttr || null);
                frame.pendingAttr = null;
                continue;
            }
            if (ch === '=') { advance(); continue; }
            if (IDENT_START.test(ch)) {
                let name = '';
                while (i < source.length && IDENT_PART.test(source[i])) { name += source[i]; advance(); }
                if (frame.named) frame.pendingAttr = name;
                frame.named = true;
                continue;
            }
            advance();
            continue;
        }

        // JS mode
        if (/\s/.test(ch)) { advance(); continue; }
        if (skipComment()) continue;
        if (ch === '"' || ch === "'") {
            const { value, startLine, startIndex } = readString(ch);
            emit('string', value, startLine, startIndex, frame.attr);
            prev = 'id';
            continue;
        }
        if (ch === '`') { startTemplate(frame.attr); continue; }
        if (ch === '/') {
            if (prev === 'id' || (prev === 'word' && !REGEX_PREFIX_WORDS.has(prevWord))) {
                advance();
                prev = 'op';
                continue;
            }
            // Regex literal.
            advance();
            let inClass = false;
            while (i < source.length) {
                if (source[i] === '\\') { advance(2); continue; }
                if (source[i] === '[') inClass = true;
                else if (source[i] === ']') inClass = false;
                else if (source[i] === '/' && !inClass) break;
                advance();
            }
            advance();
            while (i < source.length && /[a-z]/.test(source[i])) advance();
            prev = 'id';
            continue;
        }
        if (ch === '<' && jsxCanStart() && (IDENT_START.test(source[i + 1] || '') || source[i + 1] === '>')) {
            advance();
            if (source[i] === '>') { advance(); stack.push({ mode: 'children', depth: 0, attr: null }); continue; }
            stack.push({ mode: 'tag', depth: 0, attr: null, named: false });
            continue;
        }
        if (ch === '{' || ch === '(' || ch === '[') {
            frame.depth += 1;
            advance();
            prev = 'op';
            continue;
        }
        if (ch === '}' || ch === ')' || ch === ']') {
            if (ch === '}' && frame.depth === 0 && frame.closes) {
                advance();
                stack.pop();
                prev = 'id';
                continue;
            }
            frame.depth -= 1;
            advance();
            prev = 'id';
            continue;
        }
        if (/[\w$]/.test(ch)) {
            let word = '';
            while (i < source.length && /[\w$]/.test(source[i])) { word += source[i]; advance(); }
            prevWord = word;
            prev = /^\d/.test(word) ? 'id' : 'word';
            continue;
        }
        if (ch === '=' && source[i + 1] === '>') { advance(2); prev = 'op'; continue; }
        advance();
        prev = (ch === '.' && prev === 'id') ? 'op' : 'op';
    }
    return { found, balanced: stack.length === 1 };
}

const lineAt = (source, index) => {
    const start = source.lastIndexOf('\n', index - 1) + 1;
    const end = source.indexOf('\n', index);
    return source.slice(start, end === -1 ? source.length : end);
};

function classify(source, item) {
    if (SKIPPED_LINE.test(lineAt(source, item.index))) return null;
    const value = item.value.replace(/\u0000/g, ' ').trim();
    if (!value || !ENTITY_WORD.test(value)) return null;
    if (item.attr === 'className' || item.attr === 'class' || item.attr === 'key') return null;
    if (item.kind === 'jsx') return 'jsx text';
    if (item.attr && VISIBLE_ATTRIBUTES.has(item.attr)) return `${item.attr} attribute`;
    const before = source.slice(Math.max(0, item.index - 80), item.index);
    if (/\btitle\s*=\s*$/.test(before)) return 'title default';
    if (/\bclassName\s*[:=]\s*$/.test(before)) return null;
    if (SELECTOR_CALL.test(before) || SELECTOR_LIKE.test(value) || FALLBACK_TYPE_CALL.test(before)) return null;
    // A template's placeholders join the text around them (`setBacklog${kind}Epics` is one identifier), while
    // `${n} stories` keeps its space and is text.
    const token = item.kind === 'template' ? item.value.replace(/\u0000/g, '') : value;
    if (SINGLE_TOKEN.test(token)) return CAPITALISED_ENTITY.test(token) ? 'capitalised entity word' : null;
    return 'string literal';
}

function scanSource(relative, source, inRange = () => true) {
    const { found, balanced } = lex(source);
    assert.ok(balanced, `${relative}: the guard lexer lost track of the source structure`);
    return found.flatMap((item) => {
        if (!inRange(item.line)) return [];
        const reason = classify(source, item);
        if (!reason) return [];
        return [{ file: relative, line: item.line, snippet: item.value.replace(/\u0000/g, '${…}').replace(/\s+/g, ' ').trim(), reason }];
    });
}

const scanFile = (relative, inRange) => scanSource(relative, fs.readFileSync(path.join(ROOT, relative), 'utf8'), inRange);

function dashboardRanges() {
    const lines = fs.readFileSync(path.join(ROOT, DASHBOARD), 'utf8').split('\n');
    return DASHBOARD_RANGES.map((range) => {
        const start = lines.findIndex(text => text.includes(range.start));
        assert.ok(start >= 0, `dashboard.jsx anchor not found: ${range.start}`);
        const end = range.end ? lines.findIndex((text, index) => index > start && text.includes(range.end)) : start + range.lines - 1;
        assert.ok(end >= start, `dashboard.jsx end anchor not found: ${range.end}`);
        return [start + 1, end + 1];
    });
}

function allFindings() {
    const ranges = dashboardRanges();
    return [
        ...FILES.flatMap(file => scanFile(file)),
        ...scanFile(DASHBOARD, lineNumber => ranges.some(([start, end]) => lineNumber >= start && lineNumber <= end)),
    ];
}

const allowedBy = (entry, finding) => entry.file === finding.file && finding.snippet === entry.snippet;
const allowed = finding => ALLOWLIST.some(entry => allowedBy(entry, finding));

test('the guard lexer finds JSX text, attributes, defaults and literals and ignores tokens, classes and selectors', () => {
    const source = [
        "function A({ title = 'Epic' }) {",
        "    // a Story in a comment",
        "    /* an Epic in a block comment */",
        "    const x = a < b ? `${n} stories left` : 'story';",
        "    document.querySelector('.epic-header');",
        "    const re = /story/i;",
        "    statusTransitions?.openSingleIssueStatusControl?.(entry.group.epic, 'Epic');",
        "    return <div className=\"epic-row\" title=\"Story\" aria-label={`Open ${k} epic`}>",
        "        {/* Story */}",
        "        Story Points",
        "        <span data-x={cond ? 'Initiatives' : 'x'}>Epics</span>",
        "        <Self label='epic' />",
        "    </div>;",
        "}",
    ].join('\n');
    const findings = scanSource('probe.jsx', source).map(item => `${item.line}:${item.reason}:${item.snippet}`);
    assert.deepEqual(findings, [
        '1:title default:Epic',
        '4:string literal:${…} stories left',
        '8:title attribute:Story',
        '8:aria-label attribute:Open ${…} epic',
        '11:capitalised entity word:Initiatives',
        '11:jsx text:Epics',
        '12:label attribute:epic',
    ]);
});

test('every allowlist entry still matches a finding', () => {
    const findings = allFindings();
    for (const entry of ALLOWLIST) {
        assert.ok(findings.some(finding => allowedBy(entry, finding)),
            `stale allowlist entry ${entry.file}: ${entry.snippet}`);
    }
});

test('in-scope ENG surfaces name work entities only through EntityNames', () => {
    const offending = allFindings().filter(finding => !allowed(finding));
    assert.deepEqual(offending.map(item => `${item.file}:${item.line} [${item.reason}] ${item.snippet}`), []);
});
