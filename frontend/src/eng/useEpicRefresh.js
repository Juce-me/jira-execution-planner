import * as React from 'react';
import { flushSync } from 'react-dom';
import { REMOVE_FADE_MS } from '../issues/IssueCard.jsx';
import { sortTasksByPriority } from './engTaskUtils.js';
import { createEpicRefreshController } from './epicRefreshController.js';
import { alertCallsFor, alertCallsForEdit, mergeEpicMissingIssues, mergeEpicScopeEntries, recomputeMissingPlanningInfo, replaceEpicStories } from './epicRefreshAlerts.js';
import { createEpicRecheckScheduler, resolveEditEpicKeys } from './epicRefreshEditRecheck.js';
import { glareDelayMs, playGlare, selectGlareKeys } from './epicRefreshGlare.js';
import { diffEpic, mergeEpicStories, patchEpicScopeEntries, patchStoryCopies } from './epicRefreshPatch.js';

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
    const overlay = React.useRef({});
    overlay.current = {};
    const leavingRef = React.useRef(new Set());
    const timersRef = React.useRef(new Set());
    const controllerRef = React.useRef(null);
    const alertVersionAtClick = React.useRef(new Map());
    const schedulerRef = React.useRef(null);
    const [epicStates, setEpicStates] = React.useState({});
    const [leavingKeys, setLeavingKeys] = React.useState(() => new Set());
    const [announcement, setAnnouncement] = React.useState('');
    const [announcementId, setAnnouncementId] = React.useState(0);

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
        if (readiness?.status === 'ok') mergeReadinessEpic?.(epicKey, readiness.payload, { epicDetails: getState().epicDetails?.[epicKey] });
        // The epic alert object is the only call with a per-epic limiter; the scheduler retries a limited answer once.
        const limited = ALERT_LANES.map(([lane]) => lanes?.[lane]?.epicAlerts).filter(result => result?.status === 'rate_limited');
        if (!limited.length) return {};
        const waits = limited.map(result => Number(result.retryAfterSeconds)).filter(seconds => Number.isFinite(seconds) && seconds > 0);
        return { rateLimited: true, ...(waits.length ? { retryAfterSeconds: Math.max(...waits) } : {}) };
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
            if (capacityScopeHoldRef) capacityScopeHoldRef.current = true;
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
                if (capacityScopeHoldRef) capacityScopeHoldRef.current = false;
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
                setAnnouncement(announcementFor(outcome));
                setAnnouncementId(id => id + 1);
            },
            track: outcome => latest.current.track({
                result: outcome.result === 'hidden' ? 'changed' : outcome.result,
                sourceSurface: latest.current.sourceSurface,
                changedCount: outcome.changedCount || 0,
            }),
        });
    }

    const refreshEpic = React.useCallback(epicKey => controllerRef.current.refresh(epicKey), []);
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
    return { epicStates, leavingKeys, announcement, announcementId, refreshEpic, recheckEpicAlerts, recheckAlertsForEdit };
}
