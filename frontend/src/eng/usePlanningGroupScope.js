import React from 'react';

// Department group scope for the Planning review (#267): which group the review loads, the guard for
// user-initiated group changes, and the per-viewer dismissals of the inherited-view hint.
export const INHERITED_HINT_DISMISSAL_LIMIT = 50;

// Sprint ids are digits, so the first ':' separates the Sprint from any group id.
const dismissalKey = (groupId, sprintId) => `${sprintId}:${groupId}`;

// Runs the review's save/discard/stay guard (assigned to the ref after the review hook runs); resolves false on Stay.
export function confirmPlanningReviewScope(guardRef, apply = () => {}) {
    const guard = guardRef?.current;
    if (!guard) { apply(); return Promise.resolve(true); }
    return guard(apply);
}

// A user-initiated change accepts a value or a functional updater; choosing the current group commits at once.
// onCommit runs inside the guarded callback, so Stay reports nothing.
export function guardGroupChange({ guardRef, currentGroupId, next, setActiveGroupId, onCommit }) {
    const target = typeof next === 'function' ? next(currentGroupId) : next;
    const apply = () => { onCommit?.(); setActiveGroupId(next); };
    if (String(target ?? '') === String(currentGroupId ?? '')) { apply(); return Promise.resolve(true); }
    return confirmPlanningReviewScope(guardRef, apply);
}

// A transiently null group keeps the previous scope; only a resolved group id changes it.
export const nextReviewGroupId = (previous, activeGroup) => (activeGroup?.id ? String(activeGroup.id) : previous);

export function normalizeInheritedHintDismissals(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const entries = Object.entries(raw).filter(([key, entry]) => /^[1-9][0-9]*:./.test(key)
        && entry && typeof entry.sourceSprintId === 'string' && entry.sourceSprintId && Number.isInteger(entry.viewRevision));
    return Object.fromEntries(entries.slice(-INHERITED_HINT_DISMISSAL_LIMIT)
        .map(([key, entry]) => [key, { sourceSprintId: entry.sourceSprintId, viewRevision: entry.viewRevision }]));
}

// Records a dismissal as the newest entry, keeping the newest INHERITED_HINT_DISMISSAL_LIMIT.
export function recordInheritedHintDismissal(map, { groupId, sprintId, inheritedFrom }) {
    if (!groupId || !sprintId || !inheritedFrom?.sprintId) return map;
    const key = dismissalKey(groupId, sprintId);
    const entries = Object.entries(map || {}).filter(([existing]) => existing !== key);
    entries.push([key, { sourceSprintId: String(inheritedFrom.sprintId), viewRevision: Number(inheritedFrom.viewRevision) || 0 }]);
    return Object.fromEntries(entries.slice(-INHERITED_HINT_DISMISSAL_LIMIT));
}

// A dismissal holds only for the source Sprint and viewRevision it was made against.
export function isInheritedHintDismissed(map, { groupId, sprintId, inheritedFrom }) {
    const entry = inheritedFrom ? map?.[dismissalKey(groupId, sprintId)] : null;
    return Boolean(entry && entry.sourceSprintId === String(inheritedFrom.sprintId) && entry.viewRevision === (Number(inheritedFrom.viewRevision) || 0));
}

export function usePlanningGroupScope({ planningReviewGuardRef, activeGroup, groupsLoading, activeGroupId, setActiveGroupId, savedPrefs }) {
    const reviewGroupIdRef = React.useRef('');
    reviewGroupIdRef.current = nextReviewGroupId(reviewGroupIdRef.current, activeGroup);
    const currentGroupIdRef = React.useRef(activeGroupId);
    currentGroupIdRef.current = activeGroupId;
    const guardedSetActiveGroupId = React.useCallback((next, onCommit) => guardGroupChange({
        guardRef: planningReviewGuardRef, currentGroupId: currentGroupIdRef.current, next, setActiveGroupId, onCommit,
    }), [planningReviewGuardRef, setActiveGroupId]);
    const [inheritedHintDismissals, setInheritedHintDismissals] = React.useState(() => normalizeInheritedHintDismissals(savedPrefs?.planningInheritedHintDismissals));
    const dismissInheritedHint = React.useCallback(scope => setInheritedHintDismissals(map => recordInheritedHintDismissal(map, scope)), []);
    return {
        reviewGroupId: reviewGroupIdRef.current, reviewGroupReady: Boolean(activeGroup?.id) && !groupsLoading,
        guardedSetActiveGroupId, inheritedHintDismissals, dismissInheritedHint,
    };
}
