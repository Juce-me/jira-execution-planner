import * as React from 'react';
import { flushSync } from 'react-dom';
import { REMOVE_FADE_MS } from '../issues/IssueCard.jsx';
import { sortTasksByPriority } from './engTaskUtils.js';
import { projectPlanningOriginals, restorePlanningDisplay } from './engIssueEditState.js';
import { createEpicRefreshController } from './epicRefreshController.js';
import { alertCallsFor, alertCallsForEdit, mergeEpicMissingIssues, mergeEpicScopeEntries, recomputeMissingPlanningInfo, replaceEpicStories } from './epicRefreshAlerts.js';
import { createEpicRecheckScheduler, resolveEditEpicKeys } from './epicRefreshEditRecheck.js';
import { glareDelayMs, playGlare, selectGlareKeys } from './epicRefreshGlare.js';
import { beginEngReadingCommit, finishEngReadingCommit, captureEngReadingAnchor, setEngReadingViewportReader, recheckEngReadingVisibility, releaseEngReadingContext, updateEngReadingCanonicalItems } from './engReadingAnchor.js';
import { diffEpic, mergeEpicStories, mergeEngScopeSnapshot, mergeEngScopeEntries, patchEpicScopeEntries, patchStoryCopies } from './epicRefreshPatch.js';

const EPIC_SCOPE_LISTS = ['productEpicsInScope', 'techEpicsInScope', 'readyToCloseProductEpicsInScope', 'readyToCloseTechEpicsInScope'];
const STORY_COPY_LISTS = ['readyToCloseProductTasks', 'readyToCloseTechTasks'];
const FRAME_TIMEOUT_MS = 250;
const ALERT_LANES = [['product', 'Product'], ['tech', 'Tech']];
const ALERT_CALLS = ['readyToClose', 'epicAlerts', 'missingInfo', 'backlog', 'readiness'];

const setterName = listName => `set${listName[0].toUpperCase()}${listName.slice(1)}`;
const headerSelector = epicKey => `[data-epic-key="${epicKey}"] .epic-header`;
const allHeaders = () => Array.from(document.querySelectorAll('.epic-header'));
// The epic block unmounted under the user's focus: move focus to the nearest surviving epic header (its refresh button when present).
function rescueFocus(headerIndex) {
    const remaining = allHeaders();
    const target = remaining[Math.min(Math.max(headerIndex, 0), remaining.length - 1)];
    if (!target) return;
    const focusable = target.querySelector('.epic-refresh-button') || target;
    if (focusable === target) target.tabIndex = -1;
    focusable.focus();
}
const twoFrames = () => new Promise(resolve => {
    // A hidden tab never paints; the timeout keeps the epic from staying busy until it is shown again.
    const timer = window.setTimeout(resolve, FRAME_TIMEOUT_MS);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); }));
});

function announcementFor(outcome) {
    if (outcome.result === 'changed') {
        const stories = (outcome.changedCount || 0) - (outcome.epicChanged ? 1 : 0);
        if (stories <= 0) return 'Epic updated';
        return stories === 1 ? '1 story updated' : `${stories} stories updated`;
    }
    if (outcome.result === 'hidden') return `${outcome.hiddenCount || outcome.changedCount || 0} changes hidden by filters`;
    if (outcome.result === 'failure') return 'Epic refresh failed';
    return 'Epic is up to date';
}

// Inputs (all read through a ref, so closures may change every render):
//   getState() -> { productTasks, techTasks, loadedProductTasks, loadedTechTasks, epicDetails, readyToCloseProductTasks, readyToCloseTechTasks,
//       missingPlanningInfoTasks, ...epic scope lists }   `missingPlanningInfoTasks` is read by the edit re-check's key-to-epic resolver
//   active (optional, default true) false outside Catch Up and Planning clears the announcement
//   loadEpicRefresh, loadEpicAlerts, loadEpicReadiness, mergeReadinessEpic, readGuards(epicKey), getAlertVersion(), isFutureSprint, sourceSurface
//   getSubtaskParentStoryKeys(keys) -> parent story keys of subtask keys (optional; `resolveSubtaskParentStoryKeys(keys, storySubtasksByKey)`)
//   alertCohortInFlight() -> boolean   true while the department alert cohort loads (optional; absent means never in flight)
//   subscribeAlertCohortSettle(cb) -> unsubscribe   `cb({ aborted })` runs when the cohort ends: `aborted: false` after it finished (its
//       result is applied), `aborted: true` when it was cancelled and will restart on post-edit data (optional)
// `recheckAlertsForEdit({ keys, field })` -> { handled, unresolved }: Catch Up only. `handled: true` means the scoped re-check is scheduled
// (status) or nothing is needed (priority); `handled: false` means the caller must use its own invalidation (not Catch Up, an unknown
// field, no keys, or `unresolved` keys no held source maps to an epic; nothing is scheduled then).
export function useEpicRefresh(inputs) {
    const latest = React.useRef(inputs);
    latest.current = inputs;
    React.useEffect(() => setEngReadingViewportReader(() => latest.current.getViewport?.()), []);
    const readingViewportRef = React.useRef(null);
    React.useLayoutEffect(() => {
        const viewport = latest.current.getViewport?.(), previous = readingViewportRef.current;
        if (viewport?.top === previous?.top && viewport?.bottom === previous?.bottom) return;
        readingViewportRef.current = viewport; recheckEngReadingVisibility({ viewport });
    });
    const overlay = React.useRef({});
    overlay.current = {};
    const automaticSelectionRef = React.useRef(null);
    const leavingRef = React.useRef(new Set());
    const timersRef = React.useRef(new Set());
    const controllerRef = React.useRef(null);
    const alertVersionAtClick = React.useRef(new Map());
    const schedulerRef = React.useRef(null);
    const [epicStates, setEpicStates] = React.useState({});
    const [leavingKeys, setLeavingKeys] = React.useState(() => new Set());
    const [announcement, setAnnouncement] = React.useState('');
    const [announcementId, setAnnouncementId] = React.useState(0);
    const announceCountRef = React.useRef(0);
    // The status region stays mounted (a re-inserted live region is often skipped by screen readers), so every announcement must change its
    // text: alternate a trailing non-breaking space so identical consecutive messages still re-announce.
    const epicRefreshActive = inputs.active !== false;
    React.useEffect(() => { if (!epicRefreshActive) setAnnouncement(''); }, [epicRefreshActive]);

    React.useEffect(() => () => {
        timersRef.current.forEach(timer => window.clearTimeout(timer));
        timersRef.current.clear();
        schedulerRef.current?.cancel();
    }, []);

    // Epic-scoped alert calls for one epic (Tasks 11 and 12; Task 13b reuses it for inline edits). `calls` are names from `alertCallsFor`;
    // unknown names are ignored. Every call is merged on its own: a call or lane that fails (or answers `denied`, `rate_limited`, ...)
    // leaves the held entries untouched and shows nothing. Results are dropped if a department reload or a re-armed alert cohort started
    // meanwhile (a wholesale reload is authoritative). `alertVersion` defaults to the version at this call.
    const recheckEpicAlerts = React.useCallback(async (epicKey, calls, { alertVersion } = {}) => {
        const wanted = (calls || []).filter(call => ALERT_CALLS.includes(call));
        const started = latest.current;
        const laneCalls = started.loadEpicAlerts ? wanted.filter(call => call !== 'readiness') : [];
        const wantsReadiness = wanted.includes('readiness') && Boolean(started.loadEpicReadiness);
        if (!laneCalls.length && !wantsReadiness) return {};
        const version = alertVersion !== undefined ? alertVersion : started.getAlertVersion?.();
        const guards = started.readGuards(epicKey);
        const [lanes, readiness] = await Promise.all([
            laneCalls.length ? started.loadEpicAlerts({ epicKey, calls: laneCalls }).catch(() => null) : null,
            wantsReadiness ? started.loadEpicReadiness(epicKey).catch(() => null) : null,
        ]);
        try {
            const { setters, getAlertVersion, readGuards, getProtectedKeys, mergeReadinessEpic, getState } = latest.current;
            const now = readGuards(epicKey);
            if (getAlertVersion?.() !== version || now.epoch !== guards.epoch || now.version !== guards.version || now.scopeKey !== guards.scopeKey) return { discarded: true };
            // The epic's own header entry is kept as held while the user is editing it.
            const editing = getProtectedKeys(epicKey).has(epicKey);
            ALERT_LANES.forEach(([lane, title]) => {
                const { epicAlerts, readyToClose, backlog } = lanes?.[lane] || {};
                // The alert object's successful empty answer is the only proof the epic left scope: the other endpoints answer an empty list
                // with 200 when their own epic search fails, and an empty answer must not delete from partial data (MRT019).
                const outOfScope = epicAlerts?.status === 'ok' && epicAlerts.epicsInScope.length === 0;
                if (epicAlerts?.status === 'ok' && !editing) {
                    setters[`set${title}EpicsInScope`](prev => mergeEpicScopeEntries({ held: prev, incoming: epicAlerts.epicsInScope, epicKey }));
                }
                if (readyToClose?.status === 'ok') {
                    setters[`setReadyToClose${title}Tasks`](prev => replaceEpicStories({ held: prev, incoming: readyToClose.items, epicKey, emptyConfirmed: outOfScope }));
                    if (!editing) setters[`setReadyToClose${title}EpicsInScope`](prev => mergeEpicScopeEntries({ held: prev, incoming: readyToClose.epicsInScope, epicKey, deleteWhenAbsent: outOfScope }));
                }
                if (backlog?.status === 'ok' && !editing) {
                    setters[`setBacklog${title}Epics`](prev => mergeEpicScopeEntries({ held: prev, incoming: backlog.epics, epicKey, deleteWhenAbsent: outOfScope }));
                }
            });
            const missingInfo = lanes?.missingInfo;
            if (missingInfo?.status === 'ok') {
                // The endpoint's epic search answers an error on failure, so an answer without the epic means it left the Missing Info scope.
                const epicInScope = missingInfo.epics.some(epic => String(epic?.key ?? '') === String(epicKey));
                setters.setMissingInfoEpics(prev => mergeEpicScopeEntries({ held: prev, incoming: missingInfo.epics, epicKey }));
                setters.setMissingPlanningInfoTasks(prev => mergeEpicMissingIssues({ held: prev, incoming: missingInfo.issues, epicKey, epicInScope }));
            }
            if (readiness?.status === 'ok') mergeReadinessEpic?.(epicKey, readiness.payload, { epicDetails: getState().epicDetails?.[epicKey], readToken: readiness.readToken });
            // The epic alert object is the only call with a per-epic limiter; the scheduler retries a limited answer once.
            const limited = ALERT_LANES.map(([lane]) => lanes?.[lane]?.epicAlerts).filter(result => result?.status === 'rate_limited');
            if (!limited.length) return {};
            const waits = limited.map(result => Number(result.retryAfterSeconds)).filter(seconds => Number.isFinite(seconds) && seconds > 0);
            return { rateLimited: true, ...(waits.length ? { retryAfterSeconds: Math.max(...waits) } : {}) };
        } finally {
            // The readiness answer's edit-state read is finished once, whether it was merged, discarded as stale or thrown away by a failure.
            readiness?.release?.();
        }
    }, []);

    // Every epic-scoped alert re-check (the refresh follow-up and the inline-edit re-check) goes through one per-epic scheduler: one run in
    // flight plus one trailing run per epic, so the 8 s per-epic limiter is not hit by our own requests. A job is dropped when a department
    // reload, a re-armed cohort or a scope switch happened since it was requested.
    if (!schedulerRef.current) {
        schedulerRef.current = createEpicRecheckScheduler({
            run: (epicKey, { calls, ctx }) => recheckEpicAlerts(epicKey, calls, { alertVersion: ctx.alertVersion }),
            isStale: (epicKey, ctx) => {
                const { getAlertVersion, readGuards } = latest.current;
                if (ctx.alertVersion !== undefined && getAlertVersion?.() !== ctx.alertVersion) return true;
                if (!ctx.guards) return false;
                const now = readGuards(epicKey);
                return now.epoch !== ctx.guards.epoch || now.version !== ctx.guards.version || now.scopeKey !== ctx.guards.scopeKey;
            },
            cohort: {
                inFlight: () => Boolean(latest.current.subscribeAlertCohortSettle) && latest.current.alertCohortInFlight?.() === true,
                subscribeSettle: callback => latest.current.subscribeAlertCohortSettle(callback),
            },
        });
    }
    const captureRecheckContext = epicKey => ({ alertVersion: latest.current.getAlertVersion?.(), guards: latest.current.readGuards(epicKey) });

    const sortAutomaticItems = items => {
        const input = latest.current;
        const originals = input.getPlanningOriginals?.();
        const sorted = restorePlanningDisplay(sortTasksByPriority(projectPlanningOriginals(items, originals), input.priorityOrder), items, originals);
        const overlaid = input.overlayPlanningIssues?.(sorted) || sorted;
        return overlaid.length === items.length && overlaid.every((item, index) => item === items[index]) ? items : overlaid;
    };
    const readScopeState = () => ({ ...latest.current.getState(), ...overlay.current });
    const scopeGuardsMatch = (a, b) => !a.blocked && a.epoch === b.epoch && a.version === b.version && a.scopeKey === b.scopeKey;
    const markAutomaticSelection = (state, guards, shouldApply) => {
        const selection = latest.current.getSelectionState?.();
        automaticSelectionRef.current = selection ? { productTasks: state.productTasks, techTasks: state.techTasks,
            guards: { ...guards }, shouldApply, selection: { ...selection } } : null;
    };
    const shouldPreserveAutomaticSelection = () => {
        const marker = automaticSelectionRef.current, input = latest.current;
        if (!marker) return false;
        const state = readScopeState(), selection = input.getSelectionState?.();
        if (!selection || marker.shouldApply?.() === false || !scopeGuardsMatch(input.readScopeGuards(), marker.guards)
            || state.productTasks !== marker.productTasks || state.techTasks !== marker.techTasks
            || Object.keys(selection).length !== Object.keys(marker.selection).length
            || Object.keys(marker.selection).some(name => selection[name] !== marker.selection[name])) {
            automaticSelectionRef.current = null; return false;
        }
        return true;
    };
    const applyScopeSnapshot = (job, merged) => {
        const input = latest.current;
        if (!job.shouldApply() || !scopeGuardsMatch(input.readScopeGuards(), merged.guards)) return null;
        const state = readScopeState();
        const protectedKeys = input.getProtectedKeys(merged.epicKey);
        const changes = { source: 'automatic', epicKey: merged.epicKey, changedKeys: [], addedKeys: [], silentKeys: [], fetchedStories: [], deniedEpicKeys: [], deniedIssueKeys: [], deniedLanes: [] };
        const next = {};
        for (const [lane, title] of ALERT_LANES) {
            const shown = new Set((state[`${lane}Tasks`] || []).map(item => item.key));
            const loaded = state[`loaded${title}Tasks`] || [];
            const result = mergeEngScopeSnapshot({ held: state[`${lane}Tasks`], loaded, lane: merged.lanes[lane], protectedKeys,
                userRemovedKeys: new Set(loaded.filter(item => !shown.has(item.key)).map(item => item.key)), requestSnapshot: merged.requestSnapshot });
            next[`${lane}Tasks`] = sortAutomaticItems(result.items);
            next[`loaded${title}Tasks`] = result.loadedItems;
            const observation = merged.lanes[lane];
            next[`${lane}EpicsInScope`] = mergeEngScopeEntries({ held: state[`${lane}EpicsInScope`], fetched: observation?.meta?.epicsInScope,
                lane: observation, protectedKeys, requestSnapshot: merged.scopeSnapshots?.[lane] });
            if (observation?.status === 'denied' && observation.projectAccessStatus === 'inaccessible') {
                changes.deniedLanes.push(lane);
                next[`readyToClose${title}Tasks`] = [];
                next[`readyToClose${title}EpicsInScope`] = [];
                if (input.setters[`setBacklog${title}Epics`]) next[`backlog${title}Epics`] = [];
                const deniedKeys = new Set([...loaded, ...(state[`${lane}EpicsInScope`] || []), ...(state[`readyToClose${title}Tasks`] || [])].map(item => item.key));
                const other = lane === 'product' ? 'tech' : 'product';
                const otherTitle = other === 'product' ? 'Product' : 'Tech';
                const otherDenied = merged.lanes[other]?.status === 'denied' && merged.lanes[other].projectAccessStatus === 'inaccessible';
                const surviving = new Set(otherDenied ? [] : [...(state[`${other}EpicsInScope`] || []).map(item => item.key), ...(state[`loaded${otherTitle}Tasks`] || []).map(item => item.fields?.epicKey),
                    ...(merged.lanes[other]?.status === 'ok' ? merged.lanes[other].meta?.epicsInScope || [] : []).map(item => item.key),
                    ...(merged.lanes[other]?.status === 'ok' ? merged.lanes[other].items || [] : []).map(item => item.fields?.epicKey),
                    ...(merged.readinessSnapshot?.epics || []).filter(item => item.projectClass === other).map(item => item.key)]);
                for (const key of surviving) deniedKeys.delete(key);
                const survivingIssues = otherDenied ? [] : [...(state[`loaded${otherTitle}Tasks`] || []), ...(merged.lanes[other]?.status === 'ok' ? merged.lanes[other].items || [] : [])];
                for (const item of survivingIssues) deniedKeys.delete(item.key);
                changes.deniedIssueKeys.push(...deniedKeys);
                const deniedEpics = new Set([...(state[`${lane}EpicsInScope`] || []).map(item => item.key), ...loaded.map(item => item.fields?.epicKey),
                    ...(merged.readinessSnapshot?.epics || []).filter(item => item.projectClass === lane).map(item => item.key)].filter(key => key && !surviving.has(key)));
                changes.deniedEpicKeys.push(...deniedEpics);
                for (const name of ['missingPlanningInfoTasks', 'missingInfoEpics']) if (Array.isArray(state[name])) {
                    next[name] = (next[name] || state[name]).filter(item => !deniedKeys.has(item.key) && !deniedEpics.has(item.key) && !deniedEpics.has(item.fields?.epicKey));
                }
            }
            for (const name of ['changedKeys', 'addedKeys', 'silentKeys', 'fetchedStories']) changes[name].push(...result[name]);
        }
        if (!job.shouldApply() || !scopeGuardsMatch(latest.current.readScopeGuards(), merged.guards)) return null;
        input.markDependencySignature?.([...new Set([...next.loadedProductTasks, ...next.loadedTechTasks].map(item => item.key))].filter(Boolean).sort().join('|'), merged.guards.epoch);
        const hold = input.capacityScopeHoldRef;
        if (hold) hold.current += 1;
        const acceptedSourceKeys = Object.fromEntries(ALERT_LANES.map(([lane]) => [lane, merged.lanes[lane]?.status === 'ok' ? [...(merged.lanes[lane].items || []), ...(merged.lanes[lane].meta?.epicsInScope || [])].map(item => item.key) : []]));
        const readingAnchor = beginEngReadingCommit({ surface: input.sourceSurface, scopeKey: merged.guards.scopeKey, viewport: input.getViewport?.(), state, deniedEpicKeys: changes.deniedEpicKeys, deniedIssueKeys: changes.deniedIssueKeys, deniedLanes: changes.deniedLanes, acceptedSourceKeys });
        updateEngReadingCanonicalItems([...next.loadedProductTasks, ...next.loadedTechTasks]);
        markAutomaticSelection(next, merged.guards, job.shouldApply);
        try {
            flushSync(() => {
                if (merged.readinessSnapshot?.complete === true) for (const key of changes.deniedEpicKeys) {
                    input.mergeReadinessEpic?.(key, { ...merged.readinessSnapshot, epics: [] });
                }
                for (const [name, value] of Object.entries(next)) { input.setters[setterName(name)](value); overlay.current[name] = value; }
                input.setters.setEpicDetails(prev => {
                    let value = prev;
                    for (const key of changes.deniedEpicKeys) if (key in value) { value = { ...value }; delete value[key]; }
                    for (const [lane] of ALERT_LANES) if (merged.lanes[lane]?.status === 'ok') {
                        for (const [key, incoming] of Object.entries(merged.lanes[lane].meta?.epics || {})) {
                            const old = merged.epicSnapshot?.[key];
                            if (protectedKeys.has(key) || (old && !diffEpic(old, prev[key]).equal) || diffEpic(prev[key], incoming).equal) continue;
                            value = { ...value, [key]: incoming };
                        }
                    }
                    overlay.current.epicDetails = value;
                    return value;
                });
            });
        } finally { if (hold) hold.current -= 1; }
        changes.settled = finishEngReadingCommit(readingAnchor, { scopeKey: input.readScopeGuards().scopeKey, viewport: input.getViewport?.(), shouldApply: job.shouldApply, deniedEpicKeys: changes.deniedEpicKeys, deniedIssueKeys: changes.deniedIssueKeys });
        return changes;
    };

    if (!controllerRef.current) {
        const readState = () => ({ ...latest.current.getState(), ...overlay.current });
        const currentProtected = epicKey => new Set([...latest.current.getProtectedKeys(epicKey), ...leavingRef.current]);
        const currentUserRemoved = lane => {
            const state = readState();
            const shown = new Set((state[`${lane}Tasks`] || []).map(task => task.key));
            return new Set((state[`loaded${lane === 'product' ? 'Product' : 'Tech'}Tasks`] || []).filter(task => !shown.has(task.key)).map(task => task.key));
        };
        const setLeaving = keys => { leavingRef.current = keys; setLeavingKeys(keys); };

        const applyMerge = (input, epicKey, leavingSink) => {
            const isLoaded = input.listName.startsWith('loaded');
            latest.current.setters[setterName(input.listName)](prev => {
                const merged = mergeEpicStories({
                    ...input, held: prev, protectedKeys: currentProtected(epicKey), userRemovedKeys: isLoaded ? new Set() : currentUserRemoved(input.lane),
                });
                if (!merged.changed) return prev;
                let next = merged.items;
                if (!isLoaded) {
                    // The updater's own merge decides what it keeps for the dissolve, so every such key gets a drop timer.
                    merged.removedKeys.forEach(key => leavingSink.add(key));
                    // Leaving cards stay in place until the dissolve ends; entering cards join, then priority order is restored.
                    const byKey = new Map(merged.items.map(task => [task.key, task]));
                    const prevKeys = new Set(prev.map(task => task.key));
                    next = sortTasksByPriority([...prev.map(task => byKey.get(task.key) ?? task), ...merged.items.filter(task => !prevKeys.has(task.key))], latest.current.priorityOrder);
                }
                overlay.current[input.listName] = next;
                return next;
            });
        };

        const applyCopies = update => {
            const { setters } = latest.current;
            const fetchedEpic = update.epicDetailsPatch?.[update.epicKey];
            if (update.epicDetailsPatch) setters.setEpicDetails(prev => ({ ...prev, ...update.epicDetailsPatch }));
            // Stale readiness assignee, track or initiative must not shadow what the refreshed epic details cleared.
            if (fetchedEpic) latest.current.mergeReadinessEpic?.(update.epicKey, null, { epicDetails: fetchedEpic });
            if (fetchedEpic) EPIC_SCOPE_LISTS.forEach(name => setters[setterName(name)](prev => patchEpicScopeEntries(prev, update.epicKey, fetchedEpic)));
            const fetchedByKey = new Map(update.fetchedStories.map(issue => [issue.key, issue]));
            STORY_COPY_LISTS.forEach(name => setters[setterName(name)](prev => patchStoryCopies(prev, fetchedByKey)));
        };

        const scheduleLeaving = (removedKeys, epicKey, focusedAtApply = false) => {
            if (!removedKeys.length) return;
            const removed = new Set(removedKeys);
            setLeaving(new Set([...leavingRef.current, ...removed]));
            const timer = window.setTimeout(() => {
                timersRef.current.delete(timer);
                const { setters } = latest.current;
                const header = document.querySelector(headerSelector(epicKey));
                const headerIndex = allHeaders().indexOf(header);
                const block = header?.closest('[data-epic-key]');
                const active = document.activeElement;
                // is-removing disables the leaving card's remove button, so the browser may already have moved focus to body;
                // body counts as the same focus when it was inside the block at apply time (focus moved elsewhere is not stolen).
                const hadFocus = block?.contains(active) === true || (focusedAtApply && (!active || active === document.body));
                const drop = prev => prev.filter(task => !removed.has(task.key));
                // Dropping the last story unmounts the epic block here, not in apply, so the focus rescue runs after this commit.
                flushSync(() => {
                    setters.setProductTasks(drop);
                    setters.setTechTasks(drop);
                    setLeaving(new Set([...leavingRef.current].filter(key => !removed.has(key))));
                });
                if (hadFocus && !document.querySelector(headerSelector(epicKey))) rescueFocus(headerIndex);
            }, REMOVE_FADE_MS);
            timersRef.current.add(timer);
        };

        const apply = async update => {
            const { epicKey } = update;
            if (update.source === 'automatic') {
                if (update.shouldApply?.() === false) return {};
                const input = latest.current;
                const hold = input.capacityScopeHoldRef;
                if (hold) hold.current += 1;
                const readingAnchor = beginEngReadingCommit({ surface: input.sourceSurface, scopeKey: input.readScopeGuards().scopeKey, viewport: input.getViewport?.(), state: readScopeState() });
                markAutomaticSelection(readScopeState(), input.readScopeGuards(), update.shouldApply);
                try {
                    flushSync(() => {
                        update.mergeInputs.forEach(mergeInput => input.setters[setterName(mergeInput.listName)](prev => {
                            const state = readScopeState();
                            const shown = new Set((state[`${mergeInput.lane}Tasks`] || []).map(item => item.key));
                            const loaded = state[`loaded${mergeInput.lane === 'product' ? 'Product' : 'Tech'}Tasks`] || [];
                            const result = mergeEpicStories({ ...mergeInput, held: prev, protectedKeys: input.getProtectedKeys(epicKey),
                                userRemovedKeys: mergeInput.listName.startsWith('loaded') ? new Set() : new Set(loaded.filter(item => !shown.has(item.key)).map(item => item.key)) });
                            const next = sortAutomaticItems(result.items);
                            overlay.current[mergeInput.listName] = next;
                            if (automaticSelectionRef.current && ['productTasks', 'techTasks'].includes(mergeInput.listName)) automaticSelectionRef.current[mergeInput.listName] = next;
                            return next;
                        }));
                        updateEngReadingCanonicalItems(update.fetchedStories);
                        applyCopies(update);
                    });
                } finally { if (hold) hold.current -= 1; }
                await finishEngReadingCommit(readingAnchor, { scopeKey: latest.current.readScopeGuards().scopeKey, viewport: latest.current.getViewport?.(), shouldApply: update.shouldApply });
                return {};
            }
            automaticSelectionRef.current = null;
            const header = document.querySelector(headerSelector(epicKey));
            // The sticky header's own rect is clamped at its sticky offset; the block container is not sticky, so its top is the true anchor.
            const block = header?.closest('[data-epic-key]');
            const oldTop = block?.getBoundingClientRect().top;
            const focusedInBlock = Boolean(block) && block.contains(document.activeElement);
            const headerIndex = allHeaders().indexOf(header);
            const button = header?.querySelector('.epic-refresh-button');
            const hadFocus = Boolean(button) && document.activeElement === button;

            const fetchedEpic = update.epicDetailsPatch?.[epicKey];
            const epicChangedFields = fetchedEpic ? diffEpic(latest.current.getState().epicDetails?.[epicKey], fetchedEpic).changedFields : [];
            const keptForDissolve = new Set();
            // Planning's capacity scope signature keeps its previous value while the merge renders (a team crossing zero SP must not reread capacity).
            const { capacityScopeHoldRef } = latest.current;
            if (capacityScopeHoldRef) capacityScopeHoldRef.current += 1;
            try {
                flushSync(() => {
                    update.mergeInputs.forEach(input => applyMerge(input, epicKey, keptForDissolve));
                    applyCopies(update);
                });
                // The updaters have run by now; leaving cards get is-removing in the same task, before paint.
                flushSync(() => scheduleLeaving([...keptForDissolve], epicKey, focusedInBlock));
                latest.current.clearAggregateSources();
                await twoFrames();
            } finally {
                if (capacityScopeHoldRef) capacityScopeHoldRef.current -= 1;
            }

            const newHeader = document.querySelector(headerSelector(epicKey));
            const newBlock = newHeader?.closest('[data-epic-key]');
            if (newBlock && oldTop !== undefined) {
                const delta = newBlock.getBoundingClientRect().top - oldTop;
                if (Math.abs(delta) > 1) window.scrollBy(0, delta);
            }

            const changed = Array.from(new Set([...update.changedKeys, ...update.addedKeys]));
            const nodes = new Map();
            const rects = new Map();
            let hiddenCount = 0;
            changed.forEach(key => {
                const node = document.querySelector(`[data-issue-key="${key}"]`);
                if (!node) { hiddenCount += 1; return; }
                if (node.classList.contains('is-dimmed')) return;
                nodes.set(key, node);
                rects.set(key, node.getBoundingClientRect());
            });
            const viewport = latest.current.getViewport();
            selectGlareKeys({ changedKeys: changed, rects, viewport, suppressed: latest.current.getRecentEditKeys() })
                .forEach(key => playGlare(nodes.get(key), glareDelayMs(rects.get(key).top, viewport.top)));
            if (update.epicChanged) playGlare(newHeader);

            if (!newHeader && hadFocus) rescueFocus(headerIndex);
            // Catch Up only: the held Missing Info entries follow the refreshed stories with no request; a newer alert cohort wins.
            const { setters, sourceSurface, getAlertVersion } = latest.current;
            if (sourceSurface === 'catch_up' && getAlertVersion?.() === alertVersionAtClick.current.get(epicKey)) {
                setters.setMissingPlanningInfoTasks?.(prev => recomputeMissingPlanningInfo({ held: prev, refreshedStories: update.fetchedStories, epicKey }));
            }
            latest.current.afterApply?.(update);
            // Scope-based alerts follow in the background: the epic is not kept busy for them, and a failure shows nothing.
            const calls = alertCallsFor({ ...update, epicChangedFields }, { isFutureSprint: latest.current.isFutureSprint === true, isCatchUp: sourceSurface === 'catch_up' });
            if (calls.length) void schedulerRef.current.request(epicKey, { calls, ctx: { alertVersion: alertVersionAtClick.current.get(epicKey), guards: latest.current.readGuards(epicKey) } });
            return { hiddenCount };
        };

        const setEpicState = (epicKey, value) => setEpicStates(prev => {
            if (value === 'idle') {
                if (!(epicKey in prev)) return prev;
                const { [epicKey]: _removed, ...rest } = prev;
                return rest;
            }
            return { ...prev, [epicKey]: value };
        });

        controllerRef.current = createEpicRefreshController({
            loadEpicRefresh: args => {
                alertVersionAtClick.current.set(args.epicKey, latest.current.getAlertVersion?.());
                return latest.current.loadEpicRefresh(args);
            },
            readGuards: epicKey => latest.current.readGuards(epicKey),
            readHeld: epicKey => {
                const state = readState();
                const snapshotByKey = new Map();
                [...(state.productTasks || []), ...(state.techTasks || [])]
                    .filter(task => String(task.fields?.epicKey ?? '') === String(epicKey))
                    .forEach(task => snapshotByKey.set(task.key, task));
                return { ...state, protectedKeys: currentProtected(epicKey), snapshotByKey, userRemovedKeys: currentUserRemoved };
            },
            apply,
            setEpicState,
            announce: outcome => {
                announceCountRef.current += 1;
                setAnnouncement(announcementFor(outcome) + (announceCountRef.current % 2 ? '' : '\u00a0'));
                setAnnouncementId(announceCountRef.current);
            },
            track: outcome => latest.current.track({
                result: outcome.result === 'hidden' ? 'changed' : outcome.result,
                sourceSurface: latest.current.sourceSurface,
                changedCount: outcome.changedCount || 0,
            }),
        });
    }

    const refreshEpic = React.useCallback((epicKey, options) => {
        if (options?.source !== 'automatic') { releaseEngReadingContext(); latest.current.supersedeManual?.({ scope: 'anchor' }); }
        const result = controllerRef.current.refresh(epicKey, options);
        if (options?.source !== 'automatic') latest.current.recordManualEpicRefresh?.(result);
        return result;
    }, []);
    // Inline status and priority edits (Task 13b). Context (alert version and the epic's guards) is captured now, at edit success time, and
    // checked again when the job starts; with an alert cohort in flight the job waits for it, so a stale cohort result never lands after it.
    const recheckAlertsForEdit = React.useCallback(({ keys, field } = {}) => {
        const input = latest.current;
        const isCatchUp = input.sourceSurface === 'catch_up';
        if (!isCatchUp) return { handled: false, unresolved: [] };
        if (field === 'priority') return { handled: true, unresolved: [] };
        const calls = alertCallsForEdit({ field, isFutureSprint: input.isFutureSprint === true, isCatchUp });
        if (!calls.length) return { handled: false, unresolved: [] };
        const state = input.getState();
        const { epicKeys, unresolved } = resolveEditEpicKeys({
            keys, lists: state, epicDetails: state.epicDetails, parentStoryKeysFor: input.getSubtaskParentStoryKeys,
        });
        if (unresolved.length || !epicKeys.length) return { handled: false, unresolved };
        epicKeys.forEach(epicKey => { void schedulerRef.current.request(epicKey, { calls, ctx: captureRecheckContext(epicKey), awaitCohort: true }); });
        return { handled: true, unresolved: [] };
    }, []);
    return { epicStates, leavingKeys, announcement, announcementId, refreshEpic, applyScopeSnapshot, shouldPreserveAutomaticSelection, captureAnchor: () => captureEngReadingAnchor({ surface: latest.current.sourceSurface, scopeKey: latest.current.readScopeGuards().scopeKey, viewport: latest.current.getViewport() }), readState: readScopeState, getViewport: () => latest.current.getViewport(), recheckEpicAlerts, recheckAlertsForEdit };
}
