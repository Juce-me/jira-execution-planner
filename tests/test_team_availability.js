const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const source = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'frontend', 'src', 'settings', 'teamAvailability.js')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
}).outputFiles[0].text;
const sandbox = { module: { exports: {} }, exports: {} };
vm.runInContext(source, vm.createContext(sandbox));
const {
    buildTeamAvailability,
    buildTeamMembershipOwnerKey,
    isTeamMembershipCurrent,
    shouldForceAfterOrdinaryTeamRead,
    shouldRetainTeamMembershipAfterFailure,
} = sandbox.module.exports;

test('directory names never grant Sprint membership', () => {
    const rows = buildTeamAvailability({
        directory: {
            'team-a': { id: 'team-a', name: 'Alpha Directory' },
            'team-b': { id: 'team-b', name: 'Beta Directory' },
        },
        sprintTeams: [{ id: 'team-a', name: 'Alpha Issue' }],
        configuredTeamIds: ['team-b'],
        membershipReady: true,
    });

    assert.deepEqual(Array.from(rows, row => ({ ...row })), [
        { id: 'team-a', name: 'Alpha Issue', availableInSprint: true, canAdd: true },
        { id: 'team-b', name: 'Beta Directory', availableInSprint: false, canAdd: false },
    ]);
});

test('unknown membership does not assert absence', () => {
    const rows = buildTeamAvailability({
        directory: { 'team-a': { id: 'team-a', name: 'Alpha' } },
        sprintTeams: [],
        configuredTeamIds: ['team-b'],
        membershipReady: false,
    });

    assert.deepEqual(Array.from(rows, row => ({ ...row })), [
        { id: 'team-a', name: 'Alpha', availableInSprint: null, canAdd: false },
        { id: 'team-b', name: 'team-b', availableInSprint: null, canAdd: false },
    ]);
});

test('validated empty disables additions but retains names', () => {
    const rows = buildTeamAvailability({
        directory: {
            'team-a': { id: 'team-a', name: 'Alpha' },
            'team-b': { id: 'team-b', name: 'Beta' },
        },
        sprintTeams: [],
        configuredTeamIds: ['team-b'],
        membershipReady: true,
    });

    assert.deepEqual(Array.from(rows, row => ({ ...row })), [
        { id: 'team-a', name: 'Alpha', availableInSprint: false, canAdd: false },
        { id: 'team-b', name: 'Beta', availableInSprint: false, canAdd: false },
    ]);
});

test('archived names are preserved and stale generations ignored', () => {
    const rows = buildTeamAvailability({
        directory: {
            'team-a': { id: 'team-a', name: ' Directory Alpha ' },
            'team-b': { id: 'team-b', name: 'Directory Beta' },
        },
        sprintTeams: [
            { id: 'team-a', name: ' [ARCHIVED] Alpha ' },
            { id: 'team-b', name: 'Issue Beta', generation: 2 },
        ],
        configuredTeamIds: [],
        membershipReady: true,
        generation: 3,
    });

    assert.deepEqual(Array.from(rows, row => ({ ...row })), [
        { id: 'team-a', name: '[ARCHIVED] Alpha', availableInSprint: true, canAdd: true },
        { id: 'team-b', name: 'Directory Beta', availableInSprint: false, canAdd: false },
    ]);
});

test('validated membership is current only for its exact lifecycle identity and scope', () => {
    const membership = {
        validated: true,
        generation: 7,
        modalGeneration: 3,
        sprintId: '42',
        identity: 'tc1:workspace:42:scope-a',
        browserContextId: 'bc1:user-a',
        scopeDigest: 'scope-a',
    };
    const current = {
        generation: 7,
        modalGeneration: 3,
        sprintId: '42',
        identity: 'tc1:workspace:42:scope-a',
        browserContextId: 'bc1:user-a',
        scopeDigest: 'scope-a',
    };

    assert.equal(isTeamMembershipCurrent(membership, current), true);
    for (const key of ['generation', 'modalGeneration', 'sprintId', 'identity', 'browserContextId', 'scopeDigest']) {
        assert.equal(isTeamMembershipCurrent(membership, { ...current, [key]: `${current[key]}-changed` }), false, key);
    }
    assert.equal(isTeamMembershipCurrent({ ...membership, validated: false }, current), false);
});

test('Team request ownership separates modal and request generations', () => {
    const current = buildTeamMembershipOwnerKey({ sprintId: '42', modalGeneration: 3, requestGeneration: 7 });
    assert.notEqual(current, buildTeamMembershipOwnerKey({ sprintId: '42', modalGeneration: 4, requestGeneration: 7 }));
    assert.notEqual(current, buildTeamMembershipOwnerKey({ sprintId: '42', modalGeneration: 3, requestGeneration: 8 }));
    assert.notEqual(current, buildTeamMembershipOwnerKey({ sprintId: '43', modalGeneration: 3, requestGeneration: 7 }));
});

test('manual Team refresh forces only when an ordinary initiation found no pending attempt', () => {
    assert.equal(shouldForceAfterOrdinaryTeamRead({ lifecycleCurrent: true, pendingAttemptObserved: false }), true);
    assert.equal(shouldForceAfterOrdinaryTeamRead({ lifecycleCurrent: true, pendingAttemptObserved: true }), false);
    assert.equal(shouldForceAfterOrdinaryTeamRead({ lifecycleCurrent: false, pendingAttemptObserved: false }), false);
});

test('Team failures retain authority only for the exact validated identity and scope', () => {
    const membership = {
        validated: true,
        identity: 'tc1:workspace:42:scope-a',
        browserContextId: 'bc1:user-a',
        scopeDigest: 'scope-a',
    };
    const matchingCache = {
        identity: membership.identity,
        browserContextId: membership.browserContextId,
        scopeDigest: membership.scopeDigest,
    };

    assert.equal(shouldRetainTeamMembershipAfterFailure({ membership, failureCache: matchingCache }), true);
    assert.equal(shouldRetainTeamMembershipAfterFailure({ membership, failureCache: null }), true);
    assert.equal(shouldRetainTeamMembershipAfterFailure({
        membership,
        failureCode: 'catalog_identity_changed',
        failureCache: matchingCache,
    }), false);
    assert.equal(shouldRetainTeamMembershipAfterFailure({
        membership,
        failureCode: 'team_catalog_identity_changed',
    }), false);
    for (const key of ['identity', 'browserContextId', 'scopeDigest']) {
        assert.equal(shouldRetainTeamMembershipAfterFailure({
            membership,
            failureCache: { ...matchingCache, [key]: `${matchingCache[key]}-changed` },
        }), false, key);
    }
});
