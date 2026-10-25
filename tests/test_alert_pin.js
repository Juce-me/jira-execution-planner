import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PIN_HEIGHT,
    alertLandingTop,
    clearCenteredTarget,
    alertIdentitiesBySection,
    createAlertPin,
    pinScopeKey,
    resolvePinClose,
    scrollTargetTop,
} from '../frontend/src/eng/alertPin.js';

const sections = (overrides = {}) => ({
    'eng-alert-missing': [],
    'eng-alert-blocked': [],
    ...overrides,
});

const pin = (overrides = {}) => createAlertPin({
    kind: 'issue',
    identity: 'PROJ-1',
    sectionId: 'eng-alert-missing',
    key: 'PROJ-1',
    title: 'Title',
    note: 'Note',
    ...overrides,
});

test('PIN_HEIGHT is 40', () => {
    assert.equal(PIN_HEIGHT, 40);
});

test('createAlertPin trims strings and keeps kind and identity', () => {
    const created = createAlertPin({
        kind: 'requirement',
        identity: '  req-1 ',
        sectionId: ' eng-alert-needs-stories ',
        key: ' PROJ-9 ',
        title: '  A title ',
        note: ' a note  ',
    });
    assert.deepEqual(created, {
        kind: 'requirement',
        identity: 'req-1',
        sectionId: 'eng-alert-needs-stories',
        key: 'PROJ-9',
        title: 'A title',
        note: 'a note',
    });
});

test('live and sibling remains: dismiss, no confetti, scroll to block', () => {
    const result = resolvePinClose(pin(), sections({ 'eng-alert-missing': ['PROJ-1', 'PROJ-2'] }), { loading: false });
    assert.deepEqual(result, { dismiss: true, celebrate: false, scroll: 'block' });
});

test('live and last in section: dismiss, confetti, scroll to top', () => {
    const result = resolvePinClose(pin(), sections({ 'eng-alert-missing': ['PROJ-1'] }), { loading: false });
    assert.deepEqual(result, { dismiss: true, celebrate: true, scroll: 'top' });
});

test('not live (resolved) and last: no dismiss, confetti, scroll to top', () => {
    const result = resolvePinClose(pin(), sections(), { loading: false });
    assert.deepEqual(result, { dismiss: false, celebrate: true, scroll: 'top' });
});

test('not live (resolved) and sibling remains: no dismiss, no confetti, scroll to block', () => {
    const result = resolvePinClose(pin(), sections({ 'eng-alert-missing': ['PROJ-2'] }), { loading: false });
    assert.deepEqual(result, { dismiss: false, celebrate: false, scroll: 'block' });
});

test('loading: dismiss, no confetti, block-or-top regardless of emptiness', () => {
    const expected = { dismiss: true, celebrate: false, scroll: 'block-or-top' };
    assert.deepEqual(resolvePinClose(pin(), sections(), { loading: true }), expected);
    assert.deepEqual(resolvePinClose(pin(), sections({ 'eng-alert-missing': ['PROJ-1'] }), { loading: true }), expected);
    assert.deepEqual(resolvePinClose(pin(), sections({ 'eng-alert-missing': ['PROJ-1', 'PROJ-2'] }), { loading: true }), expected);
});

test('same key in two sections: decision depends only on the pin own section', () => {
    const identities = sections({
        'eng-alert-missing': ['PROJ-1'],
        'eng-alert-blocked': ['PROJ-1', 'PROJ-2', 'PROJ-3'],
    });
    assert.deepEqual(
        resolvePinClose(pin(), identities, { loading: false }),
        { dismiss: true, celebrate: true, scroll: 'top' },
    );
    const blockedPin = pin({ sectionId: 'eng-alert-blocked' });
    assert.deepEqual(
        resolvePinClose(blockedPin, identities, { loading: false }),
        { dismiss: true, celebrate: false, scroll: 'block' },
    );
});

test('alertIdentitiesBySection maps all ten sections', () => {
    const result = alertIdentitiesBySection({
        consolidatedMissingStories: [{ task: { key: 'M-1' } }, { task: { key: 'M-2' } }],
        blockedTasks: [{ key: 'B-1' }],
        postponedTasks: [{ key: 'F-1' }],
        futureRoutedEpics: [{ key: 'F-2' }],
        backlogEpics: [{ key: 'K-1' }],
        missingTeamEpics: [{ key: 'T-1' }],
        missingLabelEpics: [{ key: 'L-1' }],
        needsStoriesEntries: [{ id: 'req-1', epic: { key: 'N-1' } }],
        waitingForStoriesEpics: [{ key: 'W-1' }],
        emptyEpicsForAlert: [{ key: 'E-1' }],
        doneStoryEpics: [{ key: 'D-1' }],
    });
    assert.deepEqual(result, {
        'eng-alert-missing': ['M-1', 'M-2'],
        'eng-alert-blocked': ['B-1'],
        'eng-alert-followup': ['F-1', 'F-2'],
        'eng-alert-backlog': ['K-1'],
        'eng-alert-missing-team': ['T-1'],
        'eng-alert-missing-labels': ['L-1'],
        'eng-alert-needs-stories': ['req-1'],
        'eng-alert-waiting': ['W-1'],
        'eng-alert-empty': ['E-1'],
        'eng-alert-done': ['D-1'],
    });
});

test('alertIdentitiesBySection tolerates missing collections', () => {
    const result = alertIdentitiesBySection({});
    assert.equal(Object.keys(result).length, 10);
    Object.values(result).forEach(list => assert.deepEqual(list, []));
});

test('pinScopeKey varies by group and sprint, ignores catalog fields', () => {
    const base = { groupId: 'g1', sprintId: '42' };
    assert.equal(pinScopeKey(base), pinScopeKey({ ...base, catalog: { a: 1 }, extra: 'x' }));
    assert.notEqual(pinScopeKey(base), pinScopeKey({ ...base, groupId: 'g2' }));
    assert.notEqual(pinScopeKey(base), pinScopeKey({ ...base, sprintId: '43' }));
});

test('scrollTargetTop places the element below the sticky stack and clamps to 0', () => {
    assert.equal(scrollTargetTop({ elementTop: 500, scrollY: 1000, stickyBottom: 120, guard: 12 }), 1368);
    assert.equal(scrollTargetTop({ elementTop: 500, scrollY: 1000, stickyBottom: 120 }), 1368);
    assert.equal(scrollTargetTop({ elementTop: -300, scrollY: 100, stickyBottom: 120, guard: 12 }), 0);
});

test('clearCenteredTarget keeps a centered reveal that already clears the sticky stack', () => {
    assert.equal(clearCenteredTarget({ elementTop: 300, elementHeight: 100, scrollY: 0, viewportHeight: 800, stickyBottom: 200 }), null);
});

test('clearCenteredTarget moves a target whose centered top would sit under the sticky stack', () => {
    // Centered top is (500 - 300) / 2 = 100, above 200 + 12, so the target lands at the guard instead.
    assert.equal(
        clearCenteredTarget({ elementTop: 900, elementHeight: 300, scrollY: 1000, viewportHeight: 500, stickyBottom: 200 }),
        1688,
    );
});

// Landing stack = compact header (only once the main header has scrolled away) + filter bar + pin when it stays; never Epic headers or Planning.
test('alertLandingTop lands a deep target below the compact header, the filter bar and a kept pin', () => {
    // 2000 - (60 + 50 + 40 + 12) = 1838, past the header bottom (300), so the compact header is visible there.
    assert.equal(alertLandingTop({ elementDocTop: 2000, headerBottom: 300, compactHeight: 60, filterBarHeight: 50, pinHeight: 40 }), 1838);
});

test('alertLandingTop for a cleared pin counts only the compact header and the filter bar', () => {
    assert.equal(alertLandingTop({ elementDocTop: 2000, headerBottom: 300, compactHeight: 60, filterBarHeight: 50, pinHeight: 0 }), 1878);
});

test('alertLandingTop leaves out the compact header when the main header is still on screen at landing', () => {
    // 400 - (50 + 40 + 12) = 298, before the header bottom (300): the compact header stays hidden.
    assert.equal(alertLandingTop({ elementDocTop: 400, headerBottom: 300, compactHeight: 60, filterBarHeight: 50, pinHeight: 40 }), 298);
});

test('alertLandingTop picks the visible, compact-hidden landing when the compact header would toggle between the two', () => {
    // Without it 450 - 102 = 348 (header gone, compact would show); with it 288 (header back, compact hidden): land at 288, never under it.
    assert.equal(alertLandingTop({ elementDocTop: 450, headerBottom: 300, compactHeight: 60, filterBarHeight: 50, pinHeight: 40 }), 288);
});

test('alertLandingTop clamps to the page top', () => {
    assert.equal(alertLandingTop({ elementDocTop: 80, headerBottom: 300, compactHeight: 60, filterBarHeight: 50, pinHeight: 40 }), 0);
});

// Follow-up 1: each category's tone matches its summary pill (ALERT_SUMMARY_CONFIG) and its icon is the card header's.
test('ALERT_CATEGORY_STYLE gives all ten categories the summary-pill tone and an icon', async () => {
    const { ALERT_CATEGORY_STYLE } = await import('../frontend/src/eng/alertPin.js');
    const fs = await import('node:fs');
    const panelSource = fs.readFileSync(new URL('../frontend/src/eng/EngAlertsPanel.jsx', import.meta.url), 'utf8');
    const summaryTones = Object.fromEntries([...panelSource.matchAll(/tone: '([a-z]+)', sectionId: '([a-z-]+)'/g)].map(match => [match[2], match[1]]));
    assert.equal(Object.keys(summaryTones).length, 10);
    assert.deepEqual(Object.keys(ALERT_CATEGORY_STYLE).sort(), Object.keys(summaryTones).sort());
    for (const [sectionId, tone] of Object.entries(summaryTones)) {
        assert.equal(ALERT_CATEGORY_STYLE[sectionId].tone, tone, sectionId);
        assert.ok(ALERT_CATEGORY_STYLE[sectionId].icon, `${sectionId} icon`);
    }
    assert.deepEqual([...new Set(Object.values(ALERT_CATEGORY_STYLE).map(style => style.tone))].sort(), ['blocked', 'done', 'empty', 'following', 'missing']);
});

// Follow-up 2: the pin's title goes to the Story or Epic, not back to the alert row, so the row lookup is gone.
test('alertPin.js has no alert-row lookup', async () => {
    const module = await import('../frontend/src/eng/alertPin.js');
    assert.equal(module.findPinTarget, undefined);
});
