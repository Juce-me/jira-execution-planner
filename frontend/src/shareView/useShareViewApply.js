import * as React from 'react';
import { SHARE_VIEW_PHASES, dismissShareViewNotice, getShareViewSnapshot, subscribeShareView } from './store.js';
import { createApplyController } from './applyController.js';
import { armInteractionGuard } from './interactionGuard.js';
import { buildShareViewState } from './captureState.js';
import { encodeShareView } from './codec.js';
import { readPlanningRowsMode } from './focusCapture.js';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';

// Refs have no notifications, so a pending link is stepped on every commit and on this interval.
const APPLY_TICK_MS = 50;

const isApplyTerminal = snapshot => snapshot.terminal || snapshot.phase === SHARE_VIEW_PHASES.ABSENT;
const selectHold = () => getShareViewSnapshot().hold;
const selectApplyTerminal = () => isApplyTerminal(getShareViewSnapshot());
const ROWS_SEEDED_STAGES = new Set(['C', 'D']);
const selectPlanningTableKey = () => (ROWS_SEEDED_STAGES.has(getShareViewSnapshot().stage) ? 1 : 0);

// Declared early in App, before the ENG task-load effect: a pending link holds the default-scope load.
export function useShareViewHold() {
    return React.useSyncExternalStore(subscribeShareView, selectHold, selectHold);
}

// Declared early as well, before the onboarding controller: the Catch Up tour waits for the link to settle.
export function useShareViewApplyTerminal() {
    return React.useSyncExternalStore(subscribeShareView, selectApplyTerminal, selectApplyTerminal);
}

// Stage C seeds the Planning table's Epics/Stories rows for its next mount, and a mounted table never re-reads the seed.
// The App keys the table on this value, which changes once, when Stage C begins and the scope has loaded.
export function useShareViewPlanningTableKey() {
    return React.useSyncExternalStore(subscribeShareView, selectPlanningTableKey, selectPlanningTableKey);
}

// Sharing needs a settled scope: a Sprint, loaded Departments, a validated catalog and no pending apply, and, where a task list loads, a
// hydrated Team selection. A source-only Statistics view and a strict Board scope load no tasks, so no Team hydrate ever runs there.
const isShareDisabled = (o, applyTerminal) => !applyTerminal
    || o.selectedSprint === null || o.groupsLoading || o.onboardingRequired || o.adminSettingsGate.status === 'missing'
    || !o.teamSelectionScopeKey || (o.engLoadsTasks && o.teamSelectionHydratedScopeRef.current !== o.teamSelectionScopeKey)
    || o.sprintCatalogState.authority !== 'validated' || o.selectedView !== 'eng' || o.activeEngMode === 'scenario'
    || Boolean(readPendingAuthenticationRequired());

// One transient copy owner per mounted dashboard, shared by every header/Epic control.
export function createShareViewCopyOwner() {
    let generation = 0;
    const listeners = new Set();
    return {
        getSnapshot: () => generation,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        begin() { generation += 1; listeners.forEach(listener => listener()); return generation; },
    };
}

export function useShareViewApply(options) {
    const snapshot = React.useSyncExternalStore(subscribeShareView, getShareViewSnapshot, getShareViewSnapshot);
    const optionsRef = React.useRef(options);
    const controllerRef = React.useRef(null);
    const copyOwnerRef = React.useRef(null);
    if (!copyOwnerRef.current) copyOwnerRef.current = createShareViewCopyOwner();
    if (!controllerRef.current) controllerRef.current = createApplyController({ readOptions: () => optionsRef.current });
    const controller = controllerRef.current;
    const [shareDisabled, setShareDisabled] = React.useState(true);
    const active = snapshot.phase === SHARE_VIEW_PHASES.PENDING || snapshot.phase === SHARE_VIEW_PHASES.RUNNING;

    // After every commit, so the apply reads state that React has committed and the refs the earlier effects just wrote.
    React.useEffect(() => {
        optionsRef.current = options;
        controller.noteCommit();
        controller.evaluate();
        controller.flushTrack(options.trackShareViewAction, options.analyticsReady);
        setShareDisabled(isShareDisabled(options, selectApplyTerminal()));
    });

    React.useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => controller.evaluate(), APPLY_TICK_MS);
        const disarm = armInteractionGuard({
            onInteraction: (kind) => { controller.noteInterrupt(kind); controller.evaluate(); },
            isPaused: () => controller.isPaused(),
        });
        return () => { clearInterval(timer); disarm(); };
    }, [active, controller]);

    const captureShareUrl = React.useCallback((focus = null) => {
        const o = optionsRef.current;
        if (isShareDisabled(o, selectApplyTerminal())) return { ok: false, reason: 'disabled' };
        if (focus && (!['epic', 'alertTeam'].includes(focus.kind) || !['catch-up', 'planning'].includes(o.activeEngMode) || (focus.kind === 'alertTeam' && o.activeEngMode !== 'catch-up'))) return { ok: false, reason: 'invalid_state' };
        const rowsMode = readPlanningRowsMode(document);
        const state = buildShareViewState({
            mode: o.activeEngMode, groupId: o.activeGroupId, sprintId: o.selectedSprint, snapshot: o.buildGroupStateSnapshot(),
            searchQuery: o.searchQuery, sort: o.engEpicSort, layout: o.planningLayout, rowsMode, boardStrictScope: o.boardStrictScope,
            sprintRange: { start: o.excludedCapacityStartSprintId, end: o.excludedCapacityEndSprintId },
            alertFlags: o.alertFlags, alertCounts: o.alertCounts,
            focus,
        });
        const encoded = encodeShareView(state);
        if (focus && encoded.ok && encoded.dropped.includes('focus')) return { ok: false, reason: 'too_long' };
        return encoded.ok ? { ok: true, url: `${window.location.origin}/?${encoded.query}`, dropped: encoded.dropped } : { ok: false, reason: encoded.reason };
    }, []);

    return {
        notice: snapshot.notice, dismissNotice: dismissShareViewNotice, captureShareUrl, shareDisabled,
        applyTerminal: isApplyTerminal(snapshot), copyOwner: copyOwnerRef.current,
    };
}
