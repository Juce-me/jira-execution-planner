import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PIN_HEIGHT,
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
