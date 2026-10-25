import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

import { alertCardId, captureShareViewFocus, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN } from '../frontend/src/shareView/focusCapture.js';
import { createFakeDom } from './share_view_fake_dom.js';

const SOURCE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src');

// Viewport 800 high. The sticky filter bar covers 0..50, so T is 50 and a node is visible when its bottom is below 50 + the landing margin + 1.
function page() {
    const dom = createFakeDom({ innerHeight: 800 });
    const restore = dom.install();
    const { el } = dom;
    const filterBar = el('div', { className: 'filterbar-wrap', sticky: { top: 0 }, box: { top: 0, height: 50 } });
    const group = (id, name, top, { kind, height = 100 } = {}) => el('div', {
        className: 'alert-team-group', dataset: { alertTeam: id, ...(kind ? { alertKind: kind } : {}) }, box: { top, height },
    }, [el('div', { className: 'alert-team-header', box: { top, height: 30 } }, [el('span', { className: 'alert-pill team', text: name })])]);
    // A collapsed body keeps its children's layout boxes, so their rects stay on screen.
    const card = (id, { expanded = true, bodyExpanded = expanded, top = 60, groups = [] } = {}) => el('div', {
        className: `alert-card following ${expanded ? '' : 'collapsed'}`, id, box: { top, height: 300 },
    }, [el('div', { className: 'alert-card-header', box: { top, height: 40 } }), el('div', { className: `alert-card-body ${bodyExpanded ? '' : 'collapsed'}`, box: { top: top + 40, height: 260 } }, groups)]);
    const header = top => el('div', { className: 'epic-header', sticky: { top: 50 }, box: { top: top + 10, height: 40 } });
    const story = (key, top) => el('div', { className: 'task-item', dataset: { taskKey: key, issueKey: key }, box: { top, height: 70 } });
    const requirement = (id, epicKey, top) => el('a', { className: 'story-requirement-card', dataset: { storyRequirementId: id, epicKey }, box: { top, height: 40 } });
    const epicBlock = (key, top, height, children = []) => el('div', { className: 'epic-block', dataset: { epicKey: key }, box: { top, height } }, [header(top), ...children]);
    const row = (id, kind, key, top, { synthetic = false } = {}) => el('tr', {
        dataset: { planningRowKey: id, rowKind: kind, ...(synthetic ? {} : { issueKey: key }) }, box: { top, height: 30 },
    });
    const mount = (...nodes) => { dom.append(dom.document, filterBar, ...nodes); return dom; };
    return { dom, restore, group, card, epicBlock, story, requirement, row, mount, el };
}
const capture = (dom, options) => captureShareViewFocus({ root: dom.document, win: dom.window, ...options });

test('catch up: the first visible group in an expanded card is the target, and it is named by card and Team', () => {
    const p = page();
    try {
        p.mount(p.el('div', { className: 'alert-panels' }, [
            p.card('eng-alert-blocked', { groups: [p.group('t1', 'Team One', 100), p.group('t2', 'Team Two', 220)] }),
            p.card('eng-alert-done', { top: 400, groups: [p.group('t1', 'Team One', 440)] }),
        ]), p.epicBlock('PROJ-1', 700, 400));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 't1' });
        p.dom.setScrollY(150);   // Team One has scrolled under the filter bar (its bottom is above 51)
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 't2' });
    } finally { p.restore(); }
});

test('visible means the bottom is more than the landing margin plus 1 below T and the top is above the viewport bottom', () => {
    assert.equal(SHARE_VIEW_FOCUS_MARGIN, 12);
    // A 100 high group with T at 50: its bottom must pass 63, so the sliver a reveal leaves above its target is not visible; its top must be above 800.
    const boundary = 50 + SHARE_VIEW_FOCUS_MARGIN + 1 - 100;
    for (const [top, visible] of [[boundary, false], [boundary + 1, true], [799, true], [800, false]]) {
        const p = page();
        try {
            p.mount(p.card('eng-alert-blocked', { groups: [p.group('t1', 'Team One', top)] }));
            assert.equal(capture(p.dom, { mode: 'catch-up' }) !== null, visible, `group top ${top}`);
        } finally { p.restore(); }
    }
});

test('a pinned alert under the filter bar counts toward the sticky stack, and capture without a pin is unchanged', () => {
    const groups = () => [['t1', 'Team One', -30], ['t2', 'Team Two', 200]];
    const mountGroups = (p, withPin) => p.mount(
        ...(withPin ? [p.el('div', { className: 'alert-story alert-story--pinned', dataset: { alertPin: '' }, sticky: { top: 50 }, box: { top: 50, height: 40 } })] : []),
        p.card('eng-alert-blocked', { groups: groups().map(([id, name, top]) => p.group(id, name, top)) }),
    );
    for (const [withPin, expected] of [[false, 't1'], [true, 't2']]) {
        const p = page();
        try {
            mountGroups(p, withPin);
            assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: expected }, withPin ? 'with the pin' : 'without a pin');
        } finally { p.restore(); }
    }
});

test('V20: a group inside a collapsed card or body is never visible, even though its box is on screen', () => {
    const p = page();
    try {
        p.mount(p.el('div', { className: 'alert-panels' }, [
            p.card('eng-alert-missing', { expanded: false, top: 60, groups: [p.group('hidden-card', 'Hidden Card', 100)] }),
            p.card('eng-alert-waiting', { bodyExpanded: false, top: 60, groups: [p.group('hidden-body', 'Hidden Body', 110)] }),
            p.card('eng-alert-blocked', { top: 60, groups: [p.group('t2', 'Team Two', 120)] }),
        ]));
        const collapsed = p.dom.document.querySelectorAll('.alert-team-group').find(node => node.dataset.alertTeam === 'hidden-card');
        assert.ok(collapsed.getBoundingClientRect().top > 51, 'the collapsed group still has an on-screen box');
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 't2' });
    } finally { p.restore(); }
});

test('V20: followup story groups and future-routed Epic groups resolve to different anchors', () => {
    const epics = page();
    try {
        epics.mount(epics.card('eng-alert-followup', { groups: [epics.group('t1', 'Team One', 100, { kind: 'epic' })] }));
        assert.deepEqual(capture(epics.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'followupEpics', id: 't1' });
    } finally { epics.restore(); }
    const stories = page();
    try {
        stories.mount(stories.card('eng-alert-followup', { groups: [stories.group('t1', 'Team One', 100)] }));
        assert.deepEqual(capture(stories.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'followup', id: 't1' });
    } finally { stories.restore(); }
});

test('V20: a name-keyed group emits no alertTeam; the two placeholders and real ids still do', () => {
    const named = page();
    try {
        named.mount(named.card('eng-alert-blocked', { groups: [named.group('Orbit', 'Orbit', 100)] }), named.epicBlock('PROJ-1', 420, 300));
        // No fall-through to the Epic below: the reader is on the alerts.
        assert.equal(capture(named.dom, { mode: 'catch-up' }), null);
    } finally { named.restore(); }
    for (const [id, name] of [['unknown', 'Unknown Team'], ['Unknown Team', 'Unknown Team'], ['team-9', 'Orbit']]) {
        const p = page();
        try {
            p.mount(p.card('eng-alert-empty', { groups: [p.group(id, name, 100)] }));
            assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'empty', id });
        } finally { p.restore(); }
    }
});

test('catch up: every alert card id maps to its category key, and an unknown card yields no focus', () => {
    const keys = ['missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done'];
    for (const key of keys) {
        const p = page();
        try {
            p.mount(p.card(alertCardId(key), { groups: [p.group('t1', 'Team One', 100)] }));
            assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: key, id: 't1' });
        } finally { p.restore(); }
    }
    assert.equal(alertCardId('followupEpics'), 'eng-alert-followup');
    assert.equal(alertCardId('__proto__'), undefined);
    const stray = page();
    try {
        stray.mount(stray.card('eng-alert-unexpected', { groups: [stray.group('t1', 'Team One', 100)] }));
        assert.equal(capture(stray.dom, { mode: 'catch-up' }), null);
    } finally { stray.restore(); }
});

test('catch up Epics: an Epic whose header is in its natural position is the epic target', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('PROJ-1', 120, 400, [p.story('PROJ-11', 180), p.story('PROJ-12', 260)]));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-1' });
    } finally { p.restore(); }
});

test('catch up Epics: a pinned header names the first visible Story; a requirement card or no visible card names the Epic', () => {
    const pinned = page();
    try {
        pinned.mount(pinned.epicBlock('PROJ-1', 0, 600, [pinned.story('PROJ-11', 70), pinned.story('PROJ-12', 150), pinned.story('PROJ-13', 230)]));
        pinned.dom.setScrollY(150);   // the header is pinned at 50..90 (T = 90); PROJ-11 is above the band and PROJ-12 (0..70) is hidden under the header
        assert.deepEqual(capture(pinned.dom, { mode: 'catch-up' }), { kind: 'story', key: 'PROJ-13' });
    } finally { pinned.restore(); }
    const requirement = page();
    try {
        requirement.mount(requirement.epicBlock('PROJ-2', 0, 600, [requirement.requirement('req-1', 'PROJ-2', 140), requirement.story('PROJ-21', 190)]));
        requirement.dom.setScrollY(60);   // pinned header (T = 90, so a node must reach below 103); the requirement card (80..120) is the first visible child, so the Epic is the target
        assert.deepEqual(capture(requirement.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-2' });
    } finally { requirement.restore(); }
    const bare = page();
    try {
        bare.mount(bare.epicBlock('PROJ-4', 0, 300));
        bare.dom.setScrollY(60);
        assert.deepEqual(capture(bare.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-4' });
    } finally { bare.restore(); }
});

test('catch up Epics: a header within the landing margin below its pin line counts as pinned, one further down does not', () => {
    // The header sits 10 below its block's top and pins at 50: a block top of 44 puts it 4 below the pin line (inside the margin), 62 puts it 22 below.
    for (const [blockTop, expected] of [[44, { kind: 'story', key: 'PROJ-11' }], [62, { kind: 'epic', key: 'PROJ-1' }]]) {
        const p = page();
        try {
            p.mount(p.epicBlock('PROJ-1', blockTop, 600, [p.story('PROJ-11', blockTop + 70)]));
            assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), expected, `block top ${blockTop}`);
        } finally { p.restore(); }
    }
});

test('catch up Epics: the Epic-less bucket never becomes an epic target', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('NO_EPIC', 120, 300, [p.story('PROJ-31', 180)]), p.epicBlock('PROJ-5', 460, 300));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'story', key: 'PROJ-31' });
        p.dom.setScrollY(200);   // PROJ-31 has scrolled above the band; NO_EPIC has no visible card, so the next Epic is the target
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-5' });
    } finally { p.restore(); }
});

test('Board and Statistics carry no focus, and nothing visible means no focus', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('PROJ-1', 120, 400));
        for (const mode of ['board', 'statistics', undefined]) assert.equal(capture(p.dom, { mode }), null);
        p.dom.setScrollY(2000);
        assert.equal(capture(p.dom, { mode: 'catch-up' }), null);
    } finally { p.restore(); }
});

test('planning table: the first visible real row names the target from its issue key, never from the numeric row key', () => {
    const epics = page();
    try {
        epics.mount(epics.el('table', {}, [
            epics.row('9001', 'epic', 'PROJ-1', 70),
            epics.row('placeholder', 'epic', '', 110, { synthetic: true }),
            epics.row('9002', 'epic', 'PROJ-2', 150),
        ]));
        assert.deepEqual(capture(epics.dom, { mode: 'planning' }), { kind: 'epic', key: 'PROJ-1' });
        epics.dom.setScrollY(60);   // PROJ-1 (10..40) is under the filter bar; the synthetic row is skipped
        assert.deepEqual(capture(epics.dom, { mode: 'planning' }), { kind: 'epic', key: 'PROJ-2' });
        assert.equal(readPlanningRowsMode(epics.dom.document), 'epic');
    } finally { epics.restore(); }
    const stories = page();
    try {
        stories.mount(stories.el('table', {}, [stories.row('7001', 'story', 'PROJ-11', 70), stories.row('awaiting', 'requirement', '', 110, { synthetic: true })]));
        assert.deepEqual(capture(stories.dom, { mode: 'planning' }), { kind: 'story', key: 'PROJ-11' });
        assert.deepEqual(capture(stories.dom, { mode: 'planning', rowsMode: 'story' }), { kind: 'story', key: 'PROJ-11' });
        assert.equal(capture(stories.dom, { mode: 'planning', rowsMode: 'epic' }), null, 'a rows mode that does not match the table names nothing');
        assert.equal(readPlanningRowsMode(stories.dom.document), 'story');
    } finally { stories.restore(); }
});

test('planning list layout uses the Epic and Story blocks; an empty table has no rows mode', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('PROJ-1', 120, 400, [p.story('PROJ-11', 180)]));
        assert.deepEqual(capture(p.dom, { mode: 'planning' }), { kind: 'epic', key: 'PROJ-1' });
        assert.equal(readPlanningRowsMode(p.dom.document), null);
    } finally { p.restore(); }
});

test('hostile attribute values are compared as data and never reach a selector', () => {
    const p = page();
    try {
        p.mount(p.card('eng-alert-blocked', { groups: [p.group('x"]', 'Team', 100)] }));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 'x"]' });
    } finally { p.restore(); }
});

test('V4: the capture never clears filters, opens Jira, navigates, moves focus or builds a selector from a value', () => {
    const source = fs.readFileSync(path.join(SOURCE_ROOT, 'shareView', 'focusCapture.js'), 'utf8');
    for (const forbidden of ['clearEngFilters', 'resetEngFilters', 'navigateToAlertStory', 'handleAlertStoryClick', 'applyEngMode', 'window.open', 'location', 'scrollIntoView', '.focus(']) {
        assert.equal(source.includes(forbidden), false, `focusCapture.js must not contain ${forbidden}`);
    }
    assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\(\s*`/, 'focusCapture.js builds no template-literal selector');
    assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\([^)]*\+/, 'focusCapture.js concatenates no selector');
});

test('the card id table matches ALERT_SUMMARY_CONFIG, the card ids in the panel and the codec alert vocabulary', () => {
    const alertsSource = fs.readFileSync(path.join(SOURCE_ROOT, 'eng', 'EngAlertsPanel.jsx'), 'utf8');
    const config = Array.from(alertsSource.matchAll(/\{ key: '(\w+)', label: '[^']*', tone: '\w+', sectionId: '(eng-alert-[a-z-]+)' \}/g), match => [match[1], match[2]]);
    assert.equal(config.length, 10);
    for (const [key, sectionId] of config) assert.equal(alertCardId(key), sectionId);
    const cardIds = Array.from(alertsSource.matchAll(/ id="(eng-alert-[a-z-]+)" tabIndex=\{-1\}/g), match => match[1]).sort();
    assert.deepEqual(cardIds, config.map(([, sectionId]) => sectionId).sort());
    const code = esbuild.buildSync({ entryPoints: [path.join(SOURCE_ROOT, 'shareView', 'viewDefaults.js')], bundle: true, write: false, format: 'cjs', platform: 'browser' }).outputFiles[0].text;
    const defaults = { exports: {} };
    new Function('module', 'exports', code)(defaults, defaults.exports);
    assert.deepEqual([...defaults.exports.SHARE_VIEW_ALERT_KEYS].sort(), config.map(([key]) => key).sort());
    assert.deepEqual([...defaults.exports.SHARE_VIEW_ALERT_ANCHORS].sort(), [...config.map(([key]) => key), 'followupEpics'].sort());
});
