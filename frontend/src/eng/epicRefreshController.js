import { diffEpic, mergeEpicStories } from './epicRefreshPatch.js';

export const EPIC_REFRESH = Object.freeze({ COOLDOWN_MS: 10000, MAX_IN_FLIGHT: 2, MIN_BUSY_MS: 400 });
export const EPIC_REFRESH_RESULT = Object.freeze({
    CHANGED: 'changed', UNCHANGED: 'unchanged', HIDDEN: 'hidden', FAILURE: 'failure', DISCARDED: 'discarded', BLOCKED: 'blocked',
});

const LANES = ['product', 'tech'];
const listNames = lane => ({ display: `${lane}Tasks`, loaded: `loaded${lane === 'product' ? 'Product' : 'Tech'}Tasks` });

export function createEpicRefreshController({
    loadEpicRefresh, readGuards, readHeld, apply, setEpicState, announce, track,
    now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
    const inFlight = new Map();
    const cooldownUntil = new Map();
    const sameScope = (a, b) => a.epoch === b.epoch && a.version === b.version && a.scopeKey === b.scopeKey;
    const cooldownKey = (guards, epicKey) => `${guards.scopeKey}|${epicKey}`;

    async function applyLanes(epicKey, lanes, click, options) {
        const statuses = LANES.map(lane => lanes?.[lane]?.status || 'failed');
        if (statuses.includes('auth_required') || statuses.every(status => status === 'ignored')) {
            return { result: EPIC_REFRESH_RESULT.DISCARDED };
        }
        const held = readHeld(epicKey);
        const update = {
            epicKey, source: options.source, deferFollowUps: options.deferFollowUps, shouldApply: options.shouldApply, changedKeys: [], silentKeys: [], addedKeys: [], removedKeys: [], changedFieldsByKey: {},
            fetchedStories: [], mergeInputs: [], epicDetailsPatch: null, epicChanged: false, epicSilent: false,
        };
        let failed = false;
        let okLanes = 0;
        let fetchedEpic;
        for (const lane of LANES) {
            const result = lanes?.[lane] || { status: 'failed' };
            if (result.status === 'denied' || result.status === 'ignored') continue;
            if (result.status !== 'ok') { failed = true; continue; }
            okLanes += 1;
            const meta = result.meta || {};
            fetchedEpic = fetchedEpic || meta.epics?.[epicKey];
            const common = {
                fetched: result.items || [], epicKey, laneApplied: true, capped: meta.capped === true,
                detailsMissing: (meta.epicKeysMissing || []).includes(epicKey), clickSnapshot: click.snapshot,
            };
            const names = listNames(lane);
            const display = mergeEpicStories({ ...common, held: held[names.display] || [], protectedKeys: held.protectedKeys, userRemovedKeys: held.userRemovedKeys(lane) });
            const loaded = mergeEpicStories({ ...common, held: held[names.loaded] || [], protectedKeys: held.protectedKeys, userRemovedKeys: new Set() });
            update.mergeInputs.push({ listName: names.display, lane, ...common }, { listName: names.loaded, lane, ...common });
            update.fetchedStories.push(...common.fetched);
            update.changedKeys.push(...display.changedKeys);
            update.silentKeys.push(...display.silentKeys, ...loaded.silentKeys.filter(key => !display.silentKeys.includes(key)));
            update.addedKeys.push(...display.addedKeys);
            update.removedKeys.push(...display.removedKeys);
            Object.assign(update.changedFieldsByKey, display.changedFieldsByKey);
        }
        const currentEpic = held.epicDetails?.[epicKey];
        const editedSinceClick = Boolean(click.epic) && diffEpic(click.epic, currentEpic).changedFields.length > 0;
        if (fetchedEpic && !editedSinceClick && !held.protectedKeys.has(epicKey)) {
            const epicDiff = diffEpic(currentEpic, fetchedEpic);
            if (!epicDiff.equal) {
                update.epicDetailsPatch = { [epicKey]: fetchedEpic };
                update.epicChanged = epicDiff.changedFields.length > 0;
                update.epicSilent = epicDiff.silent;
            }
        }
        const changedCount = new Set([...update.changedKeys, ...update.addedKeys, ...update.removedKeys]).size + (update.epicChanged ? 1 : 0);
        const dirty = changedCount > 0 || update.silentKeys.length > 0 || Boolean(update.epicDetailsPatch);
        let result = changedCount > 0 ? EPIC_REFRESH_RESULT.CHANGED : EPIC_REFRESH_RESULT.UNCHANGED;
        if (dirty) {
            const applied = (await apply(update)) || {};
            update.hiddenCount = applied.hiddenCount || 0;
            if (changedCount > 0 && update.hiddenCount >= changedCount) result = EPIC_REFRESH_RESULT.HIDDEN;
        }
        if (failed) result = EPIC_REFRESH_RESULT.FAILURE;
        return { result, partial: failed && okLanes > 0, changedCount, ...update };
    }

    async function refresh(epicKey, options = {}) {
        const automatic = options.source === 'automatic';
        if (automatic && !/^[A-Z][A-Z0-9_]*-\d+$/i.test(epicKey)) return { result: EPIC_REFRESH_RESULT.DISCARDED };
        if (!automatic && inFlight.get(epicKey)?.automatic) { inFlight.get(epicKey).abort.abort(); inFlight.delete(epicKey); }
        const started = now();
        const clickGuards = readGuards(epicKey);
        const cdKey = cooldownKey(clickGuards, epicKey);
        if (inFlight.has(epicKey) || inFlight.size >= EPIC_REFRESH.MAX_IN_FLIGHT || (!automatic && (cooldownUntil.get(cdKey) || 0) > started)) {
            return { result: EPIC_REFRESH_RESULT.BLOCKED };
        }
        if (clickGuards.blocked) return { result: EPIC_REFRESH_RESULT.BLOCKED, reason: clickGuards.reason };
        const heldAtClick = readHeld(epicKey);
        const click = { snapshot: heldAtClick.snapshotByKey, epic: heldAtClick.epicDetails?.[epicKey] };
        const abort = new AbortController();
        const entry = { automatic, abort };
        inFlight.set(epicKey, entry);
        if (!automatic) setEpicState(epicKey, 'busy');
        const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
        const shouldApply = () => !signal.aborted && options.shouldApply?.() !== false
            && sameScope(readGuards(epicKey), clickGuards) && (!automatic || !readGuards(epicKey).blocked);
        let outcome;
        let lanes;
        try {
            lanes = await loadEpicRefresh({ epicKey, automatic, signal, shouldApplyResult: shouldApply });
            const remaining = Math.max(0, EPIC_REFRESH.MIN_BUSY_MS - (now() - started));
            if (!automatic && remaining) await sleep(remaining);
            outcome = shouldApply()
                ? await applyLanes(epicKey, lanes, click, { ...options, shouldApply })
                : { result: EPIC_REFRESH_RESULT.DISCARDED };
        } catch (error) {
            if (automatic) throw error;
            outcome = { result: EPIC_REFRESH_RESULT.FAILURE };
        } finally {
            lanes?.release?.();
            if (inFlight.get(epicKey) === entry) inFlight.delete(epicKey);
        }
        if (!automatic && outcome.result !== EPIC_REFRESH_RESULT.FAILURE && outcome.result !== EPIC_REFRESH_RESULT.DISCARDED) {
            cooldownUntil.set(cdKey, now() + EPIC_REFRESH.COOLDOWN_MS);
        }
        if (automatic) return { ...outcome, lanes };
        setEpicState(epicKey, outcome.result === EPIC_REFRESH_RESULT.FAILURE ? 'error' : 'idle');
        if (outcome.result !== EPIC_REFRESH_RESULT.DISCARDED) {
            announce(outcome);
            track(outcome);
        }
        return { ...outcome, lanes, requestStartedAtMs: started };
    }

    return { refresh };
}
