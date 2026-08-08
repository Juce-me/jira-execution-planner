const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The 409 branch of the unified settings save (§5.7, D45): what the conflict banner says, and what
// "Keep mine" re-POSTs. The Playwright side of this lives in tests/ui/settings_unified_save.spec.js.

function loadGroupsConfigConflict() {
    const modulePath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'groupsConfigConflict.js');
    assert.ok(fs.existsSync(modulePath), 'Expected frontend/src/settings/groupsConfigConflict.js to exist');
    const source = fs.readFileSync(modulePath, 'utf8')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    return new Function(`${source}; return {
        GROUP_CONFIG_CONFLICT_MESSAGE,
        groupConfigConflictHeadline,
        boardDraftIsDirty,
        committedSectionLabels,
        pendingSectionLabels,
        groupConfigConflictMessages,
        rebaseSharedGroupsPayload
    };`)();
}

test('committedSectionLabels names only the sections that were saved, in save order', () => {
    const { committedSectionLabels } = loadGroupsConfigConflict();
    assert.deepEqual(committedSectionLabels({ capacity: true, projects: true }), ['Scope projects', 'Capacity']);
    assert.deepEqual(committedSectionLabels({}), []);
    assert.deepEqual(committedSectionLabels(), []);
});

test('the conflict banner states the conflict and which sections already committed', () => {
    const { GROUP_CONFIG_CONFLICT_MESSAGE, groupConfigConflictMessages } = loadGroupsConfigConflict();
    const messages = groupConfigConflictMessages({ current: {}, savedSections: ['Capacity', 'Issue types'] }, { isBoardDraftDirty: true });
    assert.equal(messages[0], GROUP_CONFIG_CONFLICT_MESSAGE);
    assert.match(messages[1], /already saved: Capacity, Issue types/);
    assert.match(messages[1], /not saved/);
});

test('the partial-save banner names saved sections and pending EPM and visibility sections', () => {
    const { groupConfigConflictMessages } = loadGroupsConfigConflict();
    const messages = groupConfigConflictMessages(
        { current: {}, savedSections: ['Capacity'] },
        { pending: { epm: true, groupVisibility: true } },
    );
    assert.match(messages[1], /already saved: Capacity/);
    assert.match(messages[1], /EPM settings and group visibility preferences are also unsaved/);
});

test('the conflict banner is explicit when nothing else was saved', () => {
    const { groupConfigConflictMessages } = loadGroupsConfigConflict();
    const messages = groupConfigConflictMessages({ current: {}, savedSections: [] });
    assert.equal(messages.length, 2);
    assert.equal(messages[1], 'Nothing else was saved.');
});

test('there is no banner without a conflict', () => {
    const { groupConfigConflictMessages } = loadGroupsConfigConflict();
    assert.deepEqual(groupConfigConflictMessages(null), []);
});

// Fix 1: EPM and group-visibility preferences also run after the groups POST (saveEpmConfig inside
// saveAllSettings, persistGroupPreferences inside saveGroupsConfig), so a rejected groups POST skips
// them too. The fallback line used to claim "team groups and boards were the only change" even when
// one of these was dirty and unsaved — false whenever the unsaved-sections chip counts more than the
// conflict alone. Naming what is actually pending replaces that claim instead of merely deleting it.
test('pendingSectionLabels names only the sections that are dirty and were skipped by the rejection', () => {
    const { pendingSectionLabels } = loadGroupsConfigConflict();
    assert.deepEqual(pendingSectionLabels({ epm: true }), ['EPM settings']);
    assert.deepEqual(pendingSectionLabels({ groupVisibility: true }), ['group visibility preferences']);
    assert.deepEqual(pendingSectionLabels({ epm: true, groupVisibility: true }), ['EPM settings', 'group visibility preferences']);
    assert.deepEqual(pendingSectionLabels({}), []);
    assert.deepEqual(pendingSectionLabels(), []);
});

test('the no-sections banner names EPM as pending instead of claiming groups were the only change', () => {
    const { groupConfigConflictMessages } = loadGroupsConfigConflict();
    const messages = groupConfigConflictMessages({ current: {}, savedSections: [] }, { pending: { epm: true } });
    assert.equal(messages.length, 2);
    assert.equal(messages[1], 'EPM settings is also unsaved.');
    assert.doesNotMatch(messages[1], /only change/);
});

test('the no-sections banner names both pending sections together, plural', () => {
    const { groupConfigConflictMessages } = loadGroupsConfigConflict();
    const messages = groupConfigConflictMessages({ current: {}, savedSections: [] }, { pending: { epm: true, groupVisibility: true } });
    assert.equal(messages[1], 'EPM settings and group visibility preferences are also unsaved.');
});

// Fix 2: the mandated "Your board layout is unsaved." sentence was written for the board-only
// trigger. The trigger widened to any dirty group draft, so the headline must say "board layout"
// only when a board is actually the dirty part, and something accurate otherwise.
test('groupConfigConflictHeadline says board layout only when the board draft is actually dirty', () => {
    const { GROUP_CONFIG_CONFLICT_MESSAGE, groupConfigConflictHeadline } = loadGroupsConfigConflict();
    assert.equal(groupConfigConflictHeadline(true), GROUP_CONFIG_CONFLICT_MESSAGE);
    assert.match(groupConfigConflictHeadline(true), /board layout/);
    assert.equal(groupConfigConflictHeadline(false), 'Team groups changed while you were editing. Your changes are unsaved.');
    assert.doesNotMatch(groupConfigConflictHeadline(false), /board layout/);
});

test('boardDraftIsDirty is true only when a board actually differs from the baseline', () => {
    const { boardDraftIsDirty } = loadGroupsConfigConflict();
    const baseline = [{ id: 'platform', board: { columns: [{ id: 'c1', name: 'A' }] } }];
    const draftWithRenamedTeamOnly = { groups: [{ id: 'platform', teamIds: ['team-x'], board: { columns: [{ id: 'c1', name: 'A' }] } }] };
    const draftWithRenamedColumn = { groups: [{ id: 'platform', board: { columns: [{ id: 'c1', name: 'B' }] } }] };
    const draftWithNewGroupBoard = { groups: [{ id: 'platform', board: baseline[0].board }, { id: 'growth', board: { columns: [] } }] };

    assert.equal(boardDraftIsDirty(draftWithRenamedTeamOnly, baseline), false);
    assert.equal(boardDraftIsDirty(draftWithRenamedColumn, baseline), true);
    assert.equal(boardDraftIsDirty(draftWithNewGroupBoard, baseline), true);
    assert.equal(boardDraftIsDirty(null, baseline), false);
});

test('rebasing takes the revision from the server config and nothing else', () => {
    const { rebaseSharedGroupsPayload } = loadGroupsConfigConflict();
    const payload = {
        version: 1,
        baseRevision: 2,
        groups: [{ id: 'platform', name: 'Mine', board: { columns: [{ id: 'col-1a2b3c4d', name: 'Local' }] } }],
        defaultGroupId: 'platform'
    };
    const current = {
        configRevision: 9,
        groups: [{ id: 'platform', name: 'Theirs', board: { columns: [{ id: 'col-1a2b3c4d', name: 'Server' }] } }],
        defaultGroupId: 'other'
    };

    const rebased = rebaseSharedGroupsPayload(payload, current);

    // Rebase, not retry: the same baseRevision would be rejected again forever.
    assert.equal(rebased.baseRevision, 9);
    assert.notEqual(rebased.baseRevision, payload.baseRevision);
    // Never a merge: the user's groups win whole, and the payload keeps its own shape.
    assert.deepEqual(rebased.groups, payload.groups);
    assert.equal(rebased.defaultGroupId, 'platform');
    assert.equal(rebased.version, 1);
    assert.deepEqual(Object.keys(rebased).sort(), Object.keys(payload).sort());
    // The caller's payload is not mutated, so a failed re-POST leaves the original intact.
    assert.equal(payload.baseRevision, 2);
});
