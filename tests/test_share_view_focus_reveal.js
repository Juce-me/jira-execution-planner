import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { captureShareViewFocus } from '../frontend/src/shareView/focusCapture.js';
import { revealShareViewFocus } from '../frontend/src/shareView/focusReveal.js';
import { createFakeDom } from './share_view_fake_dom.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { readDashboardCssSource } = createRequire(import.meta.url)('./css_source_helpers.js');

// Viewport 800 high; the sticky filter bar covers 0..50, so a revealed target's top lands at 62 (T + 12). With `filterBarDocTop` the bar
// starts lower in the document and only sticks once the page has scrolled, as in the app.
function page({ visibility = 'visible', filterBarDocTop = 0 } = {}) {
    const dom = createFakeDom({ innerHeight: 800 });
    const restore = dom.install();
    dom.document.visibilityState = visibility;
    const { el } = dom;
    const filterBar = el('div', { className: 'filterbar-wrap', sticky: { top: 0 }, box: { top: filterBarDocTop, height: 50 } });
    const group = (id, top, { kind, expanded = true } = {}) => {
        const node = el('div', { className: 'alert-team-group', dataset: { alertTeam: id, ...(kind ? { alertKind: kind } : {}) }, box: { top, height: 100 } });
        const body = el('div', { className: `alert-card-body ${expanded ? '' : 'collapsed'}`, box: { top, height: 100 } }, [node]);
        return { node, body, card: cardId => el('div', { className: `alert-card ${expanded ? '' : 'collapsed'}`, id: cardId, box: { top, height: 140 } }, [body]) };
    };
    const story = (key, top) => el('div', { className: 'task-item', dataset: { taskKey: key, issueKey: key }, box: { top, height: 70 } });
    const header = top => el('div', { className: 'epic-header', sticky: { top: 50 }, box: { top: top + 10, height: 40 } });
    const epicBlock = (key, top, children = []) => el('div', { className: 'epic-block', dataset: { epicKey: key }, box: { top, height: 400 } }, [header(top), ...children]);
    const row = (id, kind, key, top) => el('tr', { dataset: { planningRowKey: id, rowKind: kind, issueKey: key }, box: { top, height: 30 } });
    dom.append(dom.document, filterBar);
    return { dom, restore, el, group, story, epicBlock, row, mount: (...nodes) => dom.append(dom.document, ...nodes) };
}
const flush = async () => { for (let index = 0; index < 4; index += 1) await Promise.resolve(); };
function run(p, target, options = {}) {
    const handle = revealShareViewFocus(target, { root: p.dom.document, win: p.dom.window, ...options });
    const outcome = { result: undefined };
    handle.done.then((value) => { outcome.result = value; });
    return { handle, outcome };
}
const alertTarget = { kind: 'alertTeam', anchor: 'blocked', id: 't1' };

test('an expanded alert group is scrolled to T + 12 once its transition could have finished, then blinks', async () => {
    const p = page();
    try {
        const g = p.group('t1', 1500);
        p.mount(g.card('eng-alert-blocked'));
        const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
        p.dom.stepMs(300);
        assert.equal(p.dom.window.scrollCalls.length, 0, 'the 0.35s expand transition is waited out first');
        p.dom.stepMs(160);
        assert.deepEqual(p.dom.window.scrollCalls, [{ top: 1438, behavior: 'instant' }]);
        assert.equal(g.node.getBoundingClientRect().top, 62);
        p.dom.stepMs(100);
        await flush();
        assert.equal(outcome.result, 'revealed');
        assert.equal(p.dom.window.scrollCalls.length, 1, 'already in place: the single correction pass does not scroll');
        assert.ok(g.node.hasAttribute('data-share-reveal'));
        p.dom.stepMs(1300);
        assert.ok(g.node.hasAttribute('data-share-reveal'), 'the hold-then-fade overlay is still painting 1.3s in');
        p.dom.stepMs(500);
        assert.equal(g.node.hasAttribute('data-share-reveal'), false, 'the blink class is removed after the animation');
        assert.equal(p.dom.listenerCount(), 0, 'every document listener is removed on finish');
    } finally { p.restore(); }
});

test('one correction scroll follows when the sticky stack grows during the two settle frames, and never a second', async () => {
    const p = page();
    try {
        const g = p.group('t1', 1500);
        p.mount(g.card('eng-alert-blocked'));
        const compact = p.el('div', { className: 'compact-sticky-header is-visible', sticky: { top: 0 }, box: { top: 0, height: 90 } });
        const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
        while (p.dom.window.scrollCalls.length === 0) p.dom.step(16);
        p.dom.step(16);   // the first settle frame passes before the stack grows: the check waits for the second one
        p.dom.append(p.dom.document, compact);
        p.dom.stepMs(100);
        await flush();
        assert.equal(outcome.result, 'revealed');
        assert.deepEqual(p.dom.window.scrollCalls, [{ top: 1438, behavior: 'instant' }, { top: 1398, behavior: 'instant' }]);
        assert.equal(g.node.getBoundingClientRect().top, 102);
    } finally { p.restore(); }
});

test('an Epic reveal is not pushed down by its own pinned header; a Story reveal lands below its parent header', async () => {
    const epic = page({ filterBarDocTop: 160 });
    try {
        const block = epic.epicBlock('PROJ-1', 1500);
        epic.mount(block);
        const { outcome } = run(epic, { kind: 'epic', key: 'PROJ-1' }, { mode: 'catch-up' });
        epic.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
        // The first jump happens before the filter bar sticks (T = 0) and parks the block under it, pinning its own header; that header is ignored.
        assert.deepEqual(epic.dom.window.scrollCalls, [{ top: 1488, behavior: 'instant' }, { top: 1438, behavior: 'instant' }]);
        assert.equal(block.getBoundingClientRect().top, 62);
    } finally { epic.restore(); }
    const story = page({ filterBarDocTop: 160 });
    try {
        const card = story.story('PROJ-2', 1500);
        story.mount(story.epicBlock('PROJ-2', 1400, [card]));
        const { outcome } = run(story, { kind: 'story', key: 'PROJ-2' }, { mode: 'catch-up' });
        story.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
        assert.equal(card.getBoundingClientRect().top, 102, 'the parent header, 40 high below a 50 high stack, is cleared by its height');
    } finally { story.restore(); }
});

test('a Story at the end of its Epic is not left under the header the end of the Epic pushes up', async () => {
    const p = page({ filterBarDocTop: 160 });
    try {
        const card = p.el('div', { className: 'task-item', dataset: { taskKey: 'PROJ-9', issueKey: 'PROJ-9' }, box: { top: 1500, height: 40 } });
        const block = p.el('div', { className: 'epic-block', dataset: { epicKey: 'PROJ-9' }, box: { top: 1400, height: 150 } }, [
            p.el('div', { className: 'epic-header', sticky: { top: 50 }, box: { top: 1410, height: 40 } }), card,
        ]);
        p.mount(block);
        const { outcome } = run(p, { kind: 'story', key: 'PROJ-9' }, { mode: 'catch-up' });
        p.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
        const headerRect = block.children[0].getBoundingClientRect();
        assert.equal(headerRect.bottom, 90, 'the header ends up fully pinned under the 50 high stack');
        assert.equal(card.getBoundingClientRect().top, 102);
    } finally { p.restore(); }
});

test('a target that renders late, or a card that expands late, is revealed 0.35s after it is first seen expanded', async () => {
    const late = page();
    try {
        const { outcome } = run(late, alertTarget, { mode: 'catch-up' });
        late.dom.stepMs(1200);
        const g = late.group('t1', 1500);
        late.mount(g.card('eng-alert-blocked'));
        late.dom.stepMs(300);
        assert.equal(late.dom.window.scrollCalls.length, 0);
        late.dom.stepMs(400);
        await flush();
        assert.equal(late.dom.window.scrollCalls.length, 1);
        late.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { late.restore(); }
    const collapsed = page();
    try {
        const g = collapsed.group('t1', 1500, { expanded: false });
        collapsed.mount(g.card('eng-alert-blocked'));
        const { outcome } = run(collapsed, alertTarget, { mode: 'catch-up' });
        collapsed.dom.stepMs(1000);
        assert.equal(collapsed.dom.window.scrollCalls.length, 0, 'a collapsed card is not scrolled to');
        g.body.parentElement.classList.remove('collapsed');
        g.body.classList.remove('collapsed');
        collapsed.dom.stepMs(300);
        assert.equal(collapsed.dom.window.scrollCalls.length, 0);
        collapsed.dom.stepMs(120);
        assert.equal(collapsed.dom.window.scrollCalls.length, 1);
        collapsed.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { collapsed.restore(); }
});

test('V20: followup Story groups and future-routed Epic groups are revealed separately even when they share a Team id', async () => {
    for (const [anchor, kind] of [['followup', undefined], ['followupEpics', 'epic']]) {
        const p = page();
        try {
            const stories = p.group('t1', 1500);
            const epics = p.group('t1', 1700, { kind: 'epic' });
            const card = p.el('div', { className: 'alert-card', id: 'eng-alert-followup', box: { top: 1500, height: 400 } }, [p.el('div', { className: 'alert-card-body' }, [stories.node, epics.node])]);
            p.mount(card);
            const { outcome } = run(p, { kind: 'alertTeam', anchor, id: 't1' }, { mode: 'catch-up' });
            p.dom.stepMs(700);
            await flush();
            assert.equal(outcome.result, 'revealed', anchor);
            const [hit, other] = kind ? [epics.node, stories.node] : [stories.node, epics.node];
            assert.ok(hit.hasAttribute('data-share-reveal'), `${anchor} blinks its own list`);
            assert.equal(other.hasAttribute('data-share-reveal'), false);
        } finally { p.restore(); }
    }
});

test('a target that never appears resolves missing after 8 seconds of visible time, without touching the page', async () => {
    const p = page();
    try {
        const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
        p.dom.stepMs(7900);
        await flush();
        assert.equal(outcome.result, undefined);
        p.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'missing');
        assert.deepEqual(p.dom.window.scrollCalls, []);
        assert.equal(p.dom.listenerCount(), 0);
        assert.equal(p.dom.pendingFrames(), 0);
    } finally { p.restore(); }
});

// MODIFIER_KEYS in the apply guard (interactionGuard.js, Task 11a) is the source of truth for this list; focusReveal.js keeps a copy of it.
const GUARD_MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS'];

test('each trusted deliberate input cancels the reveal, a keydown of any non-modifier key included', async () => {
    const events = [
        { type: 'wheel' }, { type: 'touchmove' }, { type: 'pointerdown' }, { type: 'touchstart' },
        { type: 'keydown', key: 'a' }, { type: 'keydown', key: 'Escape' }, { type: 'keydown', key: 'Tab' },
    ].map(event => ({ isTrusted: true, ...event }));
    for (const event of events) {
        const p = page();
        try {
            const g = p.group('t1', 1500);
            p.mount(g.card('eng-alert-blocked'));
            const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
            p.dom.stepMs(100);
            p.dom.dispatch('document', event);
            await flush();
            assert.equal(outcome.result, 'cancelled', `${event.type} ${event.key ?? ''}`);
            p.dom.stepMs(1000);
            assert.deepEqual(p.dom.window.scrollCalls, [], `${event.type} stops every later scroll`);
            assert.equal(p.dom.listenerCount(), 0);
        } finally { p.restore(); }
    }
});

test('an event a script dispatched and a bare modifier key never cancel the reveal', async () => {
    const ignored = [
        ...['wheel', 'touchmove', 'pointerdown', 'touchstart'].map(type => ({ type, isTrusted: false })),
        { type: 'keydown', key: 'a', isTrusted: false },
        ...GUARD_MODIFIER_KEYS.map(key => ({ type: 'keydown', key, isTrusted: true })),
    ];
    for (const event of ignored) {
        const p = page();
        try {
            const g = p.group('t1', 1500);
            p.mount(g.card('eng-alert-blocked'));
            const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
            p.dom.stepMs(100);
            p.dom.dispatch('document', event);
            p.dom.stepMs(700);
            await flush();
            assert.equal(outcome.result, 'revealed', `${event.type} ${event.key ?? ''} trusted: ${event.isTrusted}`);
        } finally { p.restore(); }
    }
});

test('cancel() and isCancelled() both end the reveal as cancelled', async () => {
    const direct = page();
    try {
        const { handle, outcome } = run(direct, alertTarget, { mode: 'catch-up' });
        handle.cancel();
        handle.cancel();
        await flush();
        assert.equal(outcome.result, 'cancelled');
        assert.equal(direct.dom.pendingFrames(), 0);
    } finally { direct.restore(); }
    const pulled = page();
    try {
        const g = pulled.group('t1', 1500);
        pulled.mount(g.card('eng-alert-blocked'));
        let cancelled = false;
        const { outcome } = run(pulled, alertTarget, { mode: 'catch-up', isCancelled: () => cancelled });
        pulled.dom.stepMs(200);
        cancelled = true;
        pulled.dom.stepMs(32);
        await flush();
        assert.equal(outcome.result, 'cancelled');
        assert.deepEqual(pulled.dom.window.scrollCalls, []);
    } finally { pulled.restore(); }
});

test('a hidden tab neither scrolls nor spends the budget; visibilitychange resumes the reveal', async () => {
    const p = page({ visibility: 'hidden' });
    try {
        const { outcome } = run(p, alertTarget, { mode: 'catch-up', timeoutMs: 500 });
        p.dom.stepMs(5000);
        assert.equal(p.dom.pendingFrames(), 0, 'no frame is queued while hidden');
        const g = p.group('t1', 1500);
        p.mount(g.card('eng-alert-blocked'));
        p.dom.document.visibilityState = 'visible';
        p.dom.dispatch('document', { type: 'visibilitychange' });
        p.dom.stepMs(700);
        await flush();
        assert.equal(outcome.result, 'revealed', 'the 5 hidden seconds did not count against a 500ms budget');
    } finally { p.restore(); }
    const midway = page();
    try {
        const g = midway.group('t1', 1500);
        midway.mount(g.card('eng-alert-blocked'));
        const { outcome } = run(midway, alertTarget, { mode: 'catch-up' });
        midway.dom.stepMs(100);
        midway.dom.document.visibilityState = 'hidden';
        midway.dom.stepMs(2000);
        assert.deepEqual(midway.dom.window.scrollCalls, [], 'nothing scrolls while the tab is hidden');
        midway.dom.document.visibilityState = 'visible';
        midway.dom.dispatch('document', { type: 'visibilitychange' });
        midway.dom.stepMs(700);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { midway.restore(); }
    // A real browser queues no frame while hidden, so the first visible frame arrives with a huge time gap: it counts for at most 100ms.
    const gap = page();
    try {
        const { outcome } = run(gap, alertTarget, { mode: 'catch-up', timeoutMs: 500 });
        gap.dom.stepMs(32);
        gap.dom.document.visibilityState = 'hidden';
        gap.dom.advanceClock(5000);
        gap.dom.document.visibilityState = 'visible';
        gap.dom.step(16);
        const g = gap.group('t1', 1500);
        gap.mount(g.card('eng-alert-blocked'));
        gap.dom.stepMs(700);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { gap.restore(); }
});

test('each target kind paints with the existing class or the share reveal attribute', async () => {
    const seen = [];
    const story = page();
    try {
        const card = story.story('PROJ-12', 1500);
        story.mount(story.epicBlock('PROJ-1', 1400, [card]));
        const { outcome } = run(story, { kind: 'story', key: 'PROJ-12' }, { mode: 'catch-up' });
        story.dom.stepMs(300);
        await flush();
        seen.push(['story card', outcome.result, card.classList.contains('task-highlight')]);
        story.dom.stepMs(1300);
        assert.ok(card.classList.contains('task-highlight'), 'the 1.8s pulse outlives the default 1.2s blink');
        story.dom.stepMs(1000);
        assert.equal(card.classList.contains('task-highlight'), false);
    } finally { story.restore(); }
    const epic = page();
    try {
        const block = epic.epicBlock('PROJ-2', 1500);
        epic.mount(block);
        const { outcome } = run(epic, { kind: 'epic', key: 'PROJ-2' }, { mode: 'catch-up' });
        epic.dom.stepMs(300);
        await flush();
        seen.push(['epic block', outcome.result, block.hasAttribute('data-share-reveal')]);
    } finally { epic.restore(); }
    const table = page();
    try {
        const epicRow = table.row('9001', 'epic', 'PROJ-3', 1500);
        table.mount(table.el('table', {}, [epicRow, table.row('9002', 'epic', 'PROJ-4', 1530)]));
        const { outcome } = run(table, { kind: 'epic', key: 'PROJ-3' }, { mode: 'planning' });
        table.dom.stepMs(300);
        await flush();
        seen.push(['planning row', outcome.result, epicRow.hasAttribute('data-share-reveal')]);
    } finally { table.restore(); }
    const list = page();
    try {
        const card = list.story('PROJ-13', 1500);
        list.mount(list.epicBlock('PROJ-1', 1400, [card]));
        const { outcome } = run(list, { kind: 'story', key: 'PROJ-13' }, { mode: 'planning' });
        list.dom.stepMs(300);
        await flush();
        seen.push(['planning list card', outcome.result, card.classList.contains('task-highlight')]);
    } finally { list.restore(); }
    assert.deepEqual(seen, [['story card', 'revealed', true], ['epic block', 'revealed', true], ['planning row', 'revealed', true], ['planning list card', 'revealed', true]]);
});

// Capturing right after a reveal must name the revealed target, so forwarding a received link points at the same place. The layouts use the real
// gaps between siblings: alert groups 0.6rem (9.6 px), Epic blocks 0.8rem (12.8 px), Story cards 0.9rem (14.4 px), Planning table rows none.
async function revealThenCapture(p, target, mode) {
    const { outcome } = run(p, target, { mode });
    p.dom.stepMs(700);
    await flush();
    assert.equal(outcome.result, 'revealed', JSON.stringify(target));
    return captureShareViewFocus({ mode, root: p.dom.document, win: p.dom.window });
}

test('round trip: capturing right after revealing an alert group names that group, not the one above it', async () => {
    for (const id of ['t1', 't2', 't3']) {
        const p = page({ filterBarDocTop: 160 });
        try {
            const groups = ['t1', 't2', 't3'].map((groupId, index) => p.el('div', { className: 'alert-team-group', dataset: { alertTeam: groupId }, box: { top: 1500 + index * 109.6, height: 100 } }, [p.el('span', { className: 'alert-pill team', text: `Team ${groupId}` })]));
            p.mount(p.el('div', { className: 'alert-card', id: 'eng-alert-blocked', box: { top: 1500, height: 400 } }, [p.el('div', { className: 'alert-card-body', box: { top: 1500, height: 400 } }, groups)]));
            assert.deepEqual(await revealThenCapture(p, { kind: 'alertTeam', anchor: 'blocked', id }, 'catch-up'), { kind: 'alertTeam', anchor: 'blocked', id });
        } finally { p.restore(); }
    }
});

test('round trip: capturing right after revealing an Epic block, or a Story card below its pinned header, names the same target', async () => {
    for (const key of ['PROJ-1', 'PROJ-2', 'PROJ-3']) {
        const p = page({ filterBarDocTop: 160 });
        try {
            p.mount(...['PROJ-1', 'PROJ-2', 'PROJ-3'].map((epicKey, index) => p.epicBlock(epicKey, 1400 + index * 412.8)));
            assert.deepEqual(await revealThenCapture(p, { kind: 'epic', key }, 'catch-up'), { kind: 'epic', key });
        } finally { p.restore(); }
    }
    for (const key of ['PROJ-91', 'PROJ-92', 'PROJ-93', 'PROJ-94']) {
        const p = page({ filterBarDocTop: 160 });
        try {
            const cards = ['PROJ-91', 'PROJ-92', 'PROJ-93', 'PROJ-94'].map((storyKey, index) => p.el('div', { className: 'task-item', dataset: { taskKey: storyKey, issueKey: storyKey }, box: { top: 1460 + index * 84.4, height: 70 } }));
            p.mount(p.epicBlock('PROJ-9', 1400, cards));
            assert.deepEqual(await revealThenCapture(p, { kind: 'story', key }, 'catch-up'), { kind: 'story', key });
        } finally { p.restore(); }
    }
});

test('round trip: capturing right after revealing a Planning table row names that row, not the adjacent row above it', async () => {
    for (const kind of ['epic', 'story']) {
        for (const index of [0, 1, 2, 3]) {
            const p = page({ filterBarDocTop: 160 });
            try {
                p.mount(p.el('table', {}, [0, 1, 2, 3].map(position => p.row(String(9000 + position), kind, `PROJ-${position + 1}`, 1500 + position * 30))));
                const key = `PROJ-${index + 1}`;
                assert.deepEqual(await revealThenCapture(p, { kind, key }, 'planning'), { kind, key }, `${kind} row ${key}`);
            } finally { p.restore(); }
        }
    }
});

test('round trip: a stack that moves by 2 px between the settle frames is corrected, so a Planning row is never captured as the row above it', async () => {
    // Table rows touch, so the row above ends exactly where the target begins; a landing more than 1 px below T + margin would leave it visible to the capture.
    for (const [shrink, scrolls] of [[0, 1], [1, 1], [2, 2], [3, 2]]) {
        const p = page({ filterBarDocTop: 160 });
        try {
            p.mount(p.el('table', {}, [0, 1, 2, 3].map(position => p.row(String(9000 + position), 'epic', `PROJ-${position + 1}`, 1500 + position * 30))));
            p.dom.setScrollY(1000);   // the filter bar is already stuck, so the first jump measures its 50 px
            const { outcome } = run(p, { kind: 'epic', key: 'PROJ-3' }, { mode: 'planning' });
            while (p.dom.window.scrollCalls.length === 0) p.dom.step(16);
            p.dom.document.querySelector('.filterbar-wrap').box.height = 50 - shrink;
            p.dom.stepMs(200);
            await flush();
            assert.equal(outcome.result, 'revealed');
            assert.equal(p.dom.window.scrollCalls.length, scrolls, `the stack moved by ${shrink} px`);
            assert.deepEqual(captureShareViewFocus({ mode: 'planning', root: p.dom.document, win: p.dom.window }), { kind: 'epic', key: 'PROJ-3' }, `the stack moved by ${shrink} px`);
        } finally { p.restore(); }
    }
});

test('a row kind that does not match the table, and an unknown anchor or kind, resolve missing', async () => {
    const cases = [
        [{ kind: 'story', key: 'PROJ-3' }, 'planning'],
        [{ kind: 'alertTeam', anchor: 'nope', id: 't1' }, 'catch-up'],
        [{ kind: 'alertTeam', anchor: '__proto__', id: 't1' }, 'catch-up'],
        [{ kind: 'board', key: 'PROJ-3' }, 'catch-up'],
        [null, 'catch-up'],
    ];
    for (const [target, mode] of cases) {
        const p = page();
        try {
            const g = p.group('t1', 1500);
            p.mount(p.el('table', {}, [p.row('9001', 'epic', 'PROJ-3', 1200)]), g.card('eng-alert-blocked'));
            const { outcome } = run(p, target, { mode, timeoutMs: 300 });
            p.dom.stepMs(400);
            await flush();
            assert.equal(outcome.result, 'missing', JSON.stringify(target));
            assert.deepEqual(p.dom.window.scrollCalls, []);
        } finally { p.restore(); }
    }
});

test('V4: hostile ids are compared as data, so they neither throw nor match another node', async () => {
    const hostile = 'x"],.alert-card,[a="';
    const p = page();
    try {
        const exact = p.group(hostile, 1500);
        const decoy = p.group('x', 1700);
        const epic = p.epicBlock(hostile, 2000, [p.story(hostile, 2100)]);
        p.mount(exact.card('eng-alert-blocked'), decoy.card('eng-alert-done'), epic);
        const hits = [];
        for (const [target, node] of [
            [{ kind: 'alertTeam', anchor: 'blocked', id: hostile }, exact.node],
            [{ kind: 'epic', key: hostile }, epic],
            [{ kind: 'story', key: hostile }, epic.children[1]],
        ]) {
            const { outcome } = run(p, target, { mode: 'catch-up' });
            p.dom.stepMs(700);
            await flush();
            hits.push([outcome.result, node.hasAttribute('data-share-reveal') || node.classList.contains('task-highlight')]);
        }
        assert.deepEqual(hits, [['revealed', true], ['revealed', true], ['revealed', true]]);
        assert.equal(decoy.node.hasAttribute('data-share-reveal'), false);
        const { outcome } = run(p, { kind: 'epic', key: 'x"]' }, { mode: 'catch-up', timeoutMs: 200 });
        p.dom.stepMs(300);
        await flush();
        assert.equal(outcome.result, 'missing');
    } finally { p.restore(); }
});

test('V4: the focus modules never clear filters, open Jira, navigate, move focus or build a selector from a value', () => {
    for (const file of ['focusCapture.js', 'focusReveal.js']) {
        const source = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'src', 'shareView', file), 'utf8');
        for (const forbidden of ['clearEngFilters', 'resetEngFilters', 'navigateToAlertStory', 'handleAlertStoryClick', 'applyEngMode', 'window.open', 'location', 'scrollIntoView', '.focus(', 'onMissing']) {
            assert.equal(source.includes(forbidden), false, `${file} must not contain ${forbidden}`);
        }
        assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\(\s*`/, `${file} builds no template-literal selector`);
        assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\([^)]*\+/, `${file} concatenates no selector`);
    }
});

test('the reveal lands targets at the one margin the capture adds to its visible rule', () => {
    const revealSource = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'src', 'shareView', 'focusReveal.js'), 'utf8');
    assert.match(revealSource, /import \{[^}]*SHARE_VIEW_FOCUS_MARGIN[^}]*\} from '\.\/focusCapture\.js';/);
    assert.ok(revealSource.includes('(stackBottom + SHARE_VIEW_FOCUS_MARGIN)'), 'the landing offset is the shared constant, not a literal');
});

test('the three reused highlight classes still paint through an animation', () => {
    const css = readDashboardCssSource(REPO_ROOT);
    assert.match(css, /\.epic-flash\s*\{\s*animation:\s*epicFlash\s/);
    assert.match(css, /@keyframes epicFlash\s*\{\s*0%\s*\{\s*background:\s*rgba\(255,\s*255,\s*0,\s*0\.45\)/);
    assert.match(css, /\.task-item\.task-highlight::after\s*\{\s*animation:\s*taskHighlightPulse\s/);
    assert.match(css, /\.planning-review-table tr\.planning-review-confirmed td::after\s*\{[^}]*animation:\s*epicFlash\s/);
});

test('the share reveal overlay holds, then fades out over one second, and Epic, alert and row targets all use it', () => {
    const css = readDashboardCssSource(REPO_ROOT);
    assert.match(css, /\[data-share-reveal\]:not\(tr\)::after\s*\{[^}]*animation:\s*shareViewReveal\s+1\.6s/);
    assert.match(css, /@keyframes shareViewReveal\s*\{\s*0%,\s*35%\s*\{[^}]*rgba\(255,\s*200,\s*0,\s*0\.5\)/);
    assert.match(css, /tr\[data-share-reveal\] td::after\s*\{[^}]*animation:\s*planningShareReveal\s+1\.6s/);
});


test('bounded alignment reaches once and waits through cohort expansion without restarting search', async () => {
    const p = page();
    try {
        let settled = false;
        let reached = 0;
        const block = p.epicBlock('PROJ-1', 1500);
        p.dom.stepMs(7900);
        const { handle, outcome } = run(p, { kind: 'epic', key: 'PROJ-1' }, { mode: 'catch-up', onReached: () => { reached += 1; }, isLayoutSettled: () => settled });
        p.dom.stepMs(7900);
        p.mount(block);
        p.dom.stepMs(80);
        assert.equal(reached, 1);
        assert.equal(block.getBoundingClientRect().top, 62);
        assert.equal(outcome.result, undefined);
        for (const shift of [200, 300]) {
            block.box.top += shift;
            p.dom.stepMs(100);
            assert.equal(block.getBoundingClientRect().top, 62);
            assert.equal(reached, 1);
        }
        p.dom.stepMs(1200);
        assert.equal(block.classList.contains('epic-flash'), false, 'no second blink');
        settled = true;
        p.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, undefined, 'a queued expansion is not mistaken for two stable frames');
        block.box.top += 250;
        p.dom.stepMs(100);
        assert.equal(block.getBoundingClientRect().top, 62);
        p.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
        assert.equal(p.dom.listenerCount(), 0);
        assert.equal(p.dom.pendingFrames(), 0);
        handle.cancel();
    } finally { p.restore(); }
    const delayed = page();
    try {
        let settled = false;
        const { outcome } = run(delayed, { kind: 'epic', key: 'PROJ-1' }, { mode: 'catch-up', isLayoutSettled: () => settled });
        delayed.dom.stepMs(100);
        settled = true;
        delayed.mount(delayed.epicBlock('PROJ-1', 1500));
        delayed.dom.stepMs(80);
        await flush();
        assert.equal(outcome.result, undefined, 'a cohort completing just before reach still needs its mounted expansion interval');
        delayed.dom.stepMs(500);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { delayed.restore(); }
});
