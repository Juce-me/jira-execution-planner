// The shared groups-config POST is optimistically locked: a 409 means someone else saved the
// shared group config while this draft was open (§5.7, D45). The draft is never overwritten or merged
// automatically — a column layout is order- and identity-sensitive, so a silent three-way merge
// would produce a board nobody designed. This module owns what the conflict banner says and what
// the "Keep mine" exit re-POSTs; the modal keeps the draft and asks.

export const GROUP_CONFIG_CONFLICT_MESSAGE = 'Team groups changed while you were editing. Your board layout is unsaved.';
const GROUP_CONFIG_CONFLICT_MESSAGE_GENERIC = 'Team groups changed while you were editing. Your changes are unsaved.';

// The trigger is any dirty group draft, not only a dirty board (the groups POST only runs when the
// draft is already dirty, so narrowing the trigger to `board` would have kept destroying teamIds and
// label edits for no gain). The mandated sentence above was written for the board-only trigger, so
// it only fits when a board actually changed; a user who edited only teamIds never touched a board.
export const groupConfigConflictHeadline = (isBoardDraftDirty) => (
    isBoardDraftDirty ? GROUP_CONFIG_CONFLICT_MESSAGE : GROUP_CONFIG_CONFLICT_MESSAGE_GENERIC
);

// Whether any group's board differs from its last-saved baseline — a per-field echo of the
// whole-draft JSON-signature comparison dashboard.jsx already uses for `groupDraftSignature`.
export const boardDraftIsDirty = (groupDraft, baselineGroups = []) => {
    if (!groupDraft) return false;
    const nullBoard = JSON.stringify(null);
    const baselineBoardById = new Map((baselineGroups || []).map(group => [group.id, JSON.stringify(group.board ?? null)]));
    return (groupDraft.groups || []).some(group => (
        JSON.stringify(group.board ?? null) !== (baselineBoardById.has(group.id) ? baselineBoardById.get(group.id) : nullBoard)
    ));
};

// The footer Save runs these sections through their own endpoints before the groups POST, so a
// rejected groups POST leaves them committed. Listed in save order.
const SECTION_LABELS = [
    ['projects', 'Scope projects'],
    ['priorityWeights', 'Priority weights'],
    ['board', 'Jira board'],
    ['capacity', 'Capacity'],
    ['fieldConfigs', 'Field mapping'],
    ['issueTypes', 'Issue types']
];

export const committedSectionLabels = (committed = {}) => SECTION_LABELS
    .filter(([key]) => committed?.[key])
    .map(([, label]) => label);

// EPM settings (saveAllSettings, after the groups POST) and group-visibility preferences
// (persistGroupPreferences, inside saveGroupsConfig, after the POST resolves) both run after the
// groups POST, so a rejected groups POST skips them exactly like it skips the groups POST itself.
// Named here so "nothing else was saved" never gets said while one of these is still dirty.
const PENDING_SECTION_LABELS = [
    ['epm', 'EPM settings'],
    ['groupVisibility', 'group visibility preferences']
];

export const pendingSectionLabels = (pending = {}) => PENDING_SECTION_LABELS
    .filter(([key]) => pending?.[key])
    .map(([, label]) => label);

export const groupConfigConflictMessages = (conflict, { isBoardDraftDirty = false, pending = {} } = {}) => {
    if (!conflict) return [];
    const saved = conflict.savedSections || [];
    const stillPending = pendingSectionLabels(pending);
    return [
        groupConfigConflictHeadline(isBoardDraftDirty),
        saved.length
            ? `These sections were already saved: ${saved.join(', ')}. Team groups and boards were not saved.${stillPending.length ? ` ${stillPending.join(' and ')} ${stillPending.length > 1 ? 'are' : 'is'} also unsaved.` : ''}`
            : (stillPending.length
                ? `${stillPending.join(' and ')} ${stillPending.length > 1 ? 'are' : 'is'} also unsaved.`
                : 'Nothing else was saved.')
    ];
};

// "Keep mine": the user's payload wins whole, carried onto the revision the server reports. Taking
// the revision from the rejection (never from the stale draft) is what stops a re-POST loop.
export const rebaseSharedGroupsPayload = (payload, current) => ({
    ...payload,
    baseRevision: current?.configRevision
});
