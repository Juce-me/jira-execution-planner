import { isAuthenticationRequiredError } from './api/authRequired.js';

export function isFreshnessEligible(environment, { starting = false } = {}) {
    return Boolean(environment.focused && environment.bootstrapReady && environment.authReady
        && !environment.connectionOwned && !environment.blocked && !environment.terminalAuth
        && !(starting && environment.ownerBusy));
}

export function parseFreshnessRetryAt(value, nowMs, maxDelayMs = 60 * 1000) {
    if (!Number.isFinite(nowMs)) return null;
    const text = String(value ?? '').trim();
    let retryAt = null;
    if (/^\d+$/.test(text)) retryAt = nowMs + Number(text) * 1000;
    else if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
        const date = Date.parse(text);
        if (Number.isFinite(date)) retryAt = Math.max(nowMs, date);
    }
    return retryAt !== null && Number.isFinite(retryAt) && retryAt - nowMs <= maxDelayMs ? retryAt : null;
}

export function createDashboardFreshnessController({ readEnvironment, readAdapter, now = Date.now, notify = () => {},
    timers = { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: handle => globalThis.clearTimeout(handle) } }) {
    let contextKey = readEnvironment().contextKey;
    let surface = readEnvironment().surface;
    let checks = {};
    let observations = {};
    let intent = null;
    let active = null;
    let drain = null;
    let generation = 0;
    let disposed = false;
    let retryHandle = null;
    let retryAtMs = null;
    let retrySources = [];
    let resumeQueued = false;
    let snapshot;
    function publish() {
        if (disposed) return;
        const failure = ['failed', 'rate_limited', 'unverified'].find(value => Object.values(checks).some(check => check.failure === value)) || null;
        const next = { pending: Boolean(intent && Object.values(intent.sources).some(source => source.pending)), running: Boolean(active), retryAtMs, failure, checks: Object.freeze({ ...checks }) };
        if (snapshot && JSON.stringify(snapshot) === JSON.stringify(next)) return;
        const hadSnapshot = Boolean(snapshot);
        snapshot = Object.freeze(next);
        if (hadSnapshot) notify(snapshot);
    }
    function cancelRetry() {
        if (retryHandle !== null) timers.clearTimeout(retryHandle);
        retryHandle = null;
        retryAtMs = null;
    }
    function retire(reason) {
        // Active acquisitions remain unsettled; accepted failures must stay settled.
        // Only the scheduled retry subset needs rearming when its timer is retired.
        const interrupted = retryHandle !== null ? retrySources : [];
        cancelRetry();
        retrySources = [];
        generation += 1;
        active?.abort.abort();
        active?.anchorAbort.abort();
        // A retired job may never settle; detach it so later drains are not blocked behind it.
        active?.supersede();
        active = null;
        if (['blur', 'blocked', 'epoch'].includes(reason)) {
            if (intent) for (const name of interrupted) { const source = intent.sources[name]; if (source?.pending) source.settled = false; }
        } else intent = null;
        publish();
    }
    function reconcile() {
        const env = readEnvironment();
        if (env.contextKey !== contextKey || env.surface !== surface) {
            retire(env.surface !== surface ? 'surface' : 'context'); contextKey = env.contextKey; surface = env.surface; checks = {}; observations = {}; publish();
        }
        if (env.terminalAuth) retire('terminal_auth');
        else if (active && active.job.sessionEpoch !== env.sessionEpoch) { retire('epoch'); resumeQueued = true; }
        else if (!isFreshnessEligible(env) && (active || retryHandle !== null)) retire(env.focused ? 'blocked' : 'blur');
        return env;
    }
    function acceptChecks({ contextKey: key, completedAtMs = now(), checks: descriptors = [] }) {
        if (disposed || key !== readEnvironment().contextKey || key !== contextKey) return;
        for (const descriptor of descriptors) {
            const { source, status, checkKind = 'unknown', coverage = 'unknown', requestStartedAtMs } = descriptor;
            const pending = intent?.sources[source];
            const old = checks[source] || { lastCheckedAtMs: null, checkKind: 'unknown', coverage: 'unknown', failure: null };
            if (status === 'ignored') { if (pending) pending.settled = false; continue; }
            if (status === 'ok') {
                const forced = checkKind === 'forced';
                const preserveForced = !forced && old.checkKind === 'forced';
                checks[source] = Object.freeze({ lastCheckedAtMs: preserveForced ? old.lastCheckedAtMs : completedAtMs, checkKind: preserveForced ? old.checkKind : checkKind, coverage: preserveForced ? old.coverage : coverage, failure: forced ? null : (pending?.pending ? 'unverified' : old.failure) });
                if (forced) observations[source] = { requestStartedAtMs, completedAtMs };
                if (pending) {
                    pending.pending = forced ? !(requestStartedAtMs >= pending.needsAfterMs) : false;
                    pending.settled = !pending.pending;
                }
            } else if (status === 'denied') {
                if (pending) { pending.pending = false; pending.settled = true; }
                if (old.failure) checks[source] = Object.freeze({ ...old, failure: null });
            } else if (status === 'failed' || status === 'rate_limited') {
                checks[source] = Object.freeze({ ...old, failure: status });
                if (pending) { pending.pending = true; pending.settled = true; }
            }
        }
        publish();
    }
    function scheduleRetry(descriptors, currentIntent) {
        if (currentIntent !== intent || intent.retryUsed) return;
        const retryable = descriptors.filter(item => item.status === 'rate_limited' && Number.isFinite(item.retryAtMs) && item.retryAtMs - now() <= 60000 && intent.sources[item.source]?.pending);
        if (!retryable.length) return;
        intent.retryUsed = true;
        intent.retryScopeOnly = true;
        retrySources = retryable.map(item => item.source);
        retryAtMs = Math.max(now(), ...retryable.map(item => item.retryAtMs));
        retryHandle = timers.setTimeout(() => {
            const eligible = isFreshnessEligible(readEnvironment(), { starting: true });
            retryHandle = null; retryAtMs = null;
            reconcile();
            if (intent !== currentIntent || disposed) return;
            for (const descriptor of retryable) if (intent.sources[descriptor.source]?.pending) intent.sources[descriptor.source].settled = false;
            retrySources = [];
            if (eligible) { if (drain) resumeQueued = true; void update().catch(() => {}); }
            else publish();
        }, retryAtMs - now());
        publish();
    }
    function update() {
        if (disposed) return Promise.resolve();
        const env = reconcile();
        if (drain) {
            if (!active && intent && isFreshnessEligible(env, { starting: true })) resumeQueued = true;
            return drain;
        }
        const adapter = readAdapter(env.surface);
        const pendingSources = intent ? Object.keys(intent.sources).filter(source => intent.sources[source].pending && !intent.sources[source].settled) : [];
        const recoveryOnly = Boolean(adapter && !pendingSources.length && adapter.hasDeferredReads?.(env.contextKey));
        if (!adapter || (!pendingSources.length && !recoveryOnly) || retryHandle !== null || !isFreshnessEligible(env, { starting: true })) return Promise.resolve();
        const abort = new AbortController();
        const anchorAbort = new AbortController();
        const currentIntent = intent;
        const jobGeneration = ++generation;
        const job = { contextKey, sessionEpoch: env.sessionEpoch, generation: jobGeneration, signal: abort.signal, anchorSignal: anchorAbort.signal, pendingSources,
            shouldApply: () => { const current = readEnvironment(); return !disposed && !abort.signal.aborted && jobGeneration === generation && current.contextKey === job.contextKey && current.sessionEpoch === job.sessionEpoch && current.surface === env.surface && isFreshnessEligible(current); },
            resumeAfterInterruption: () => {
                if (!currentIntent || !job.shouldApply() || intent !== currentIntent || currentIntent.interruptionResumed) return;
                currentIntent.interruptionResumed = true;
                resumeQueued = true;
            } };
        let superseded = false;
        resumeQueued = false;
        active = { job, abort, anchorAbort, supersede: () => { superseded = true; drain = null; } };
        publish();
        const propagateAuthentication = error => {
            if (isAuthenticationRequiredError(error) || error?.status === 401) {
                retire('terminal_auth');
                throw error;
            }
        };
        let scopeAccepted = false;
        drain = Promise.resolve().then(async () => {
            if (recoveryOnly) { if (job.shouldApply()) await adapter.resumeDeferredReads(job); return; }
            let anchor = null, anchorChecks = [];
            try {
                anchor = currentIntent.retryScopeOnly ? null : (adapter.captureAnchor?.() ?? null);
                if (job.shouldApply() && !currentIntent.retryScopeOnly) anchorChecks = await adapter.refreshAnchor(job, anchor);
            } catch (error) { propagateAuthentication(error); }
            if (!job.shouldApply()) return;
            if (!anchorAbort.signal.aborted) acceptChecks({ contextKey: job.contextKey, checks: anchorChecks || [] });
            const descriptors = await adapter.refreshScope(job, anchor) || [];
            if (!job.shouldApply()) return;
            const missing = pendingSources.filter(source => !descriptors.some(item => item.source === source));
            acceptChecks({ contextKey: job.contextKey, checks: [...descriptors, ...missing.map(source => ({ source, status: 'failed' }))] });
            scopeAccepted = true;
            // Reserve the one retry before secondary work can be interrupted.
            scheduleRetry(descriptors, currentIntent);
            if (descriptors.some(item => item.status === 'ok' && pendingSources.includes(item.source)) && job.shouldApply()) await adapter.followUp(job);
        }).catch(error => {
            propagateAuthentication(error);
            if (!scopeAccepted && job.shouldApply()) acceptChecks({ contextKey: job.contextKey, checks: pendingSources
                .filter(source => intent?.sources[source]?.pending && !intent.sources[source].settled)
                .map(source => ({ source, status: 'failed' })) });
        }).finally(() => {
            if (superseded) return;
            if (!disposed) reconcile();
            if (active?.job === job) active = null;
            drain = null;
            if (!disposed) {
                reconcile(); publish();
                if (resumeQueued) { resumeQueued = false; return update(); }
                if (!recoveryOnly && job.shouldApply() && adapter.hasDeferredReads?.(job.contextKey)
                    && !Object.values(intent?.sources || {}).some(source => source.pending && !source.settled)) return update();
            }
        });
        return drain;
    }
    function request({ reason, absenceStartedAtMs } = {}) {
        if (disposed) return Promise.resolve();
        const env = reconcile();
        const adapter = readAdapter(env.surface);
        if (!adapter || env.terminalAuth) return Promise.resolve();
        const neededAt = reason === 'bfcache' || !Number.isFinite(absenceStartedAtMs) ? now() : absenceStartedAtMs;
        if (!intent || !Object.values(intent.sources).some(source => source.pending)) intent = { sources: {}, retryUsed: false };
        for (const source of adapter.sources()) {
            const existing = intent.sources[source];
            const observation = observations[source];
            if (observation && observation.requestStartedAtMs >= neededAt) continue;
            intent.sources[source] = { needsAfterMs: existing?.pending ? Math.min(existing.needsAfterMs, neededAt) : neededAt, pending: true, settled: false };
        }
        if (drain && active?.job.contextKey !== env.contextKey) resumeQueued = true;
        publish();
        return update();
    }
    publish();
    return { request, update, retire, acceptChecks, getState: () => snapshot,
        ownsSurface: surface => Boolean(readAdapter(surface)),
        supersedeManual: ({ scope } = {}) => { if (scope === 'anchor') active?.anchorAbort.abort(); else retire('manual'); },
        dispose: () => { retire('manual'); disposed = true; },
    };
}
