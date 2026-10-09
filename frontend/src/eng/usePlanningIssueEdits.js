import * as React from 'react';

// Transient, render-facing state of Planning status/priority edits (issue #250). The edit state owns the reservations, overlays,
// bases and locks; this hook subscribes to it so a change re-renders the App, and exposes the ORIGINAL (pre-edit) values of every
// open edit, which sorting and filtering read while the display already shows the new value. It owns no task arrays and starts
// no request.
//
// While an editor is open (Summary, Story Points, Team, assignee or a Table review cell) the order is frozen: an edit that settles
// during the hold keeps projecting by its original value, so nothing re-sorts, leaves a filter or unmounts under the open editor,
// and a confirmed priority re-sort of a lane is deferred. Closing the last editor releases all of it at once.
//
// It also reports which Planning edits were just confirmed, so the Table and the List can blink the edited row and, only when it
// would otherwise be off-screen, scroll to it (never after the user scrolled, never while an editor is open).
const originalsOf = map => (map instanceof Map ? map : new Map());
const SCROLL_TOLERANCE_PX = 4;
const pageScroll = () => globalThis.window?.scrollY ?? 0;

export function usePlanningIssueEdits({ issueEditState, onReorderReleased }) {
    const [revision, setRevision] = React.useState(0);
    // { keys, latest, scrolled }: confirmed Planning edits no consumer has handled yet; `scrolled` names the keys whose page was scrolled by the user since the click.
    const [confirmedEdit, setConfirmedEdit] = React.useState(null);
    const startScrollRef = React.useRef(new Map());
    const holdsRef = React.useRef({});
    const retainedRef = React.useRef(new Map());
    const deferredRef = React.useRef(new Set());
    const lastLiveRef = React.useRef(new Map());
    const releasedRef = React.useRef(onReorderReleased);
    releasedRef.current = onReorderReleased;
    const held = () => Object.values(holdsRef.current).some(Boolean);

    React.useEffect(() => issueEditState.subscribePlanning(() => {
        const live = issueEditState.planningOriginals();
        // An edit that settles while an editor is open leaves the live map; remember what it was, earliest value winning.
        if (held()) lastLiveRef.current.forEach((original, key) => {
            Object.keys(original).forEach((field) => {
                if (live.get(key)?.[field] !== undefined) return;
                retainedRef.current.set(key, { [field]: original[field], ...(retainedRef.current.get(key) || {}) });
            });
        });
        lastLiveRef.current = live;
        setRevision(value => value + 1);
    }), [issueEditState]);

    // `source` names who holds ('fields' for the shared field editor, 'table' for a review cell); `issueKey` is falsy to release it.
    const holdEditor = React.useCallback((source, issueKey) => {
        const before = held();
        holdsRef.current = { ...holdsRef.current, [source]: issueKey ? String(issueKey) : '' };
        if (!before && held()) lastLiveRef.current = issueEditState.planningOriginals();
        if (before && !held()) {
            const deferred = [...deferredRef.current];
            retainedRef.current = new Map();
            deferredRef.current = new Set();
            deferred.forEach(key => releasedRef.current?.(key));
        }
        if (before !== held()) setRevision(value => value + 1);
    }, [issueEditState]);

    // Returns true when the caller must not re-sort now: the key is remembered and `onReorderReleased(key)` runs once the last editor closes.
    const deferReorder = React.useCallback((issueKey) => {
        if (!held()) return false;
        deferredRef.current.add(String(issueKey));
        return true;
    }, []);

    const noteEditStart = React.useCallback((issueKey) => { startScrollRef.current.set(String(issueKey), pageScroll()); }, []);
    const noteConfirmed = React.useCallback((issueKey) => {
        const key = String(issueKey);
        const scrolled = Math.abs(pageScroll() - (startScrollRef.current.get(key) ?? pageScroll())) > SCROLL_TOLERANCE_PX;
        startScrollRef.current.delete(key);
        setConfirmedEdit(previous => ({
            keys: [...new Set([...(previous?.keys || []), key])],
            latest: key,
            scrolled: new Set([...(previous?.scrolled || []), ...(scrolled ? [key] : [])]),
        }));
    }, []);
    const ackConfirmed = React.useCallback((handled) => {
        const done = new Set(handled);
        setConfirmedEdit(previous => {
            const keys = (previous?.keys || []).filter(key => !done.has(key));
            return keys.length ? { ...previous, keys } : null;
        });
    }, []);
    const isHeld = React.useCallback(() => held(), []);

    const planningOriginals = React.useMemo(() => {
        const live = originalsOf(issueEditState.planningOriginals());
        if (!held() || !retainedRef.current.size) return live;
        const merged = new Map(live);
        retainedRef.current.forEach((original, key) => merged.set(key, { ...(live.get(key) || {}), ...original }));
        return merged;
    }, [issueEditState, revision]);

    return { planningRevision: revision, planningOriginals, holdEditor, deferReorder, isHeld, confirmedEdit, noteEditStart, noteConfirmed, ackConfirmed };
}
