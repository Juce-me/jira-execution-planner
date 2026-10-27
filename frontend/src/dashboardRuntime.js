const UI_PREFS_KEY = 'jira_dashboard_ui_prefs_v1';
const SPRINT_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function loadCachedSprintCatalog(prefs, now = Date.now()) {
    const cache = prefs?.sprintCatalog;
    const cachedAt = Number(cache?.cachedAt);
    if (!Number.isFinite(cachedAt) || now - cachedAt < 0 || now - cachedAt >= SPRINT_CATALOG_CACHE_TTL_MS) return { cachedAt: 0, sprints: [] };
    const sprints = Array.isArray(cache?.sprints) ? cache.sprints.filter(sprint => sprint && sprint.id !== null && sprint.id !== undefined && String(sprint.name || '').trim()) : [];
    if (cache?.version === 2 && Array.isArray(cache?.sprints)) {
        return {
            version: 2,
            identity: typeof cache.identity === 'string' ? cache.identity : null,
            cachedAt,
            validatedAt: typeof cache.validatedAt === 'string' ? cache.validatedAt : null,
            catalogVersion: typeof cache.catalogVersion === 'string' ? cache.catalogVersion : null,
            sprints,
        };
    }
    return sprints.length ? { cachedAt, sprints } : { cachedAt: 0, sprints: [] };
}

function normalizeCatalogSource(source) {
    if (!source || typeof source !== 'object') return { identity: null, browserContextId: null };
    return {
        identity: typeof source.identity === 'string' && source.identity ? source.identity : null,
        browserContextId: typeof source.browserContextId === 'string' && source.browserContextId
            ? source.browserContextId
            : null,
    };
}

export function sprintCatalogSourcesEqual(left, right) {
    const normalizedLeft = normalizeCatalogSource(left);
    const normalizedRight = normalizeCatalogSource(right);
    return normalizedLeft.identity === normalizedRight.identity
        && normalizedLeft.browserContextId === normalizedRight.browserContextId;
}

export function shouldReconcileSprintCatalogSource(requestGeneration, currentState, configSource) {
    return currentState?.authority === 'validated'
        && Number(requestGeneration) !== Number(currentState.generation)
        && !sprintCatalogSourcesEqual(currentState, configSource);
}

export function sprintCatalogValidationKey(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sprints)) return '';
    if (!snapshot.validatedAt || !snapshot.catalogVersion) {
        return `legacy|${JSON.stringify(snapshot.sprints.map(sprint => [sprint.id, sprint.name, sprint.state || '']))}`;
    }
    return [
        snapshot.identity || '',
        snapshot.browserContextId || '',
        snapshot.validatedAt,
        snapshot.catalogVersion,
    ].join('|');
}

function normalizeSprintList(value) {
    if (!Array.isArray(value)) return null;
    const result = [];
    const ids = new Set();
    for (const sprint of value) {
        if (!sprint || sprint.id === null || sprint.id === undefined) return null;
        const name = String(sprint.name || '').trim();
        const id = String(sprint.id);
        if (!name || ids.has(id)) return null;
        ids.add(id);
        result.push({ ...sprint, name });
    }
    return result;
}

function sameEventGeneration(state, event) {
    return event.generation === state.generation
        && (event.identity ?? null) === (state.identity ?? null)
        && (event.browserContextId ?? null) === (state.browserContextId ?? null);
}

function selectSprintId(sprints, preferredId) {
    if (!sprints.length) return null;
    const preferred = preferredId === null || preferredId === undefined
        ? null
        : sprints.find(sprint => String(sprint.id) === String(preferredId));
    if (preferred) return preferred.id;
    const currentQuarter = getCurrentQuarter();
    const fallback = sprints.find(sprint => String(sprint.state || '').toLowerCase() === 'active')
        || sprints.find(sprint => sprint.name === currentQuarter)
        || sprints[sprints.length - 1];
    return fallback?.id ?? null;
}

export function createSprintCatalogState({ displaySnapshot = null, savedSprintId = null, savedSprintName = '' } = {}) {
    const displaySprints = normalizeSprintList(displaySnapshot?.sprints) || [];
    return {
        generation: 0,
        browserContextId: null,
        identity: null,
        authority: displaySnapshot ? 'display_only' : 'invalid',
        status: 'unknown',
        validatedSnapshot: null,
        displaySnapshot: displaySnapshot ? { ...displaySnapshot, sprints: displaySprints } : null,
        availableSprints: [],
        savedSprintId: savedSprintId ?? null,
        selectedSprintId: savedSprintId ?? null,
        savedSprintName: String(savedSprintName || ''),
        refreshAttemptId: null,
        errorReason: '',
    };
}

export function reduceSprintCatalog(state, event) {
    if (!state || !event || typeof event !== 'object') return state;
    if (state.authority === 'auth_locked' && event.type !== 'AUTH_LOCK') return state;
    if (['RESPONSE', 'FAILURE', 'EXHAUSTED', 'FINISH', 'PERSISTED'].includes(event.type)
        && !sameEventGeneration(state, event)) return state;

    if (event.type === 'SOURCE') {
        const source = normalizeCatalogSource(event.source);
        if (source.identity === state.identity && source.browserContextId === state.browserContextId) return state;
        return {
            ...state,
            generation: state.generation + 1,
            ...source,
            authority: state.authority === 'display_only' && !state.validatedSnapshot ? 'display_only' : 'invalid',
            selectionPreserved: false,
            status: 'unknown',
            validatedSnapshot: null,
            availableSprints: [],
            selectedSprintId: null,
            refreshAttemptId: null,
            errorReason: '',
        };
    }
    if (event.type === 'START') {
        const newGeneration = event.newGeneration === true;
        return {
            ...state,
            generation: state.generation + (newGeneration ? 1 : 0),
            status: state.validatedSnapshot ? 'refreshing' : 'loading',
            refreshAttemptId: newGeneration ? null : state.refreshAttemptId,
            errorReason: '',
        };
    }
    if (event.type === 'RESPONSE') {
        const envelope = event.envelope || {};
        const cache = envelope.cache || {};
        if (envelope.httpStatus === 401 || envelope.error === 'auth_required') {
            return { ...state, authority: 'auth_locked', status: 'error', refreshAttemptId: null, errorReason: 'auth_required' };
        }
        if (envelope.httpStatus === 409 && envelope.error === 'sprint_board_required') {
            return {
                ...state,
                generation: state.generation + 1,
                identity: null,
                browserContextId: null,
                authority: 'invalid',
                status: 'error',
                validatedSnapshot: null,
                availableSprints: [],
                selectedSprintId: null,
                refreshAttemptId: null,
                errorReason: 'sprint_board_required',
            };
        }
        const sprints = normalizeSprintList(envelope.sprints);
        const isPostgresql = cache.backend === 'postgresql';
        const requiresValidatedCache = isPostgresql || String(state.identity || '').startsWith('sc1:');
        const cacheSource = normalizeCatalogSource(cache);
        const sourceMatches = requiresValidatedCache
            ? Boolean(cacheSource.identity && cacheSource.browserContextId)
                && (!state.identity || cacheSource.identity === state.identity)
                && (!state.browserContextId || cacheSource.browserContextId === state.browserContextId)
            : (!state.identity || !cacheSource.identity || cacheSource.identity === state.identity)
                && (!state.browserContextId || !cacheSource.browserContextId || cacheSource.browserContextId === state.browserContextId);
        const hasValidation = !requiresValidatedCache || (Boolean(cache.validatedAt) && Boolean(cache.catalogVersion));
        const acceptsPayload = envelope.httpStatus === 200 && sprints !== null && sourceMatches && hasValidation;
        const refreshAttemptId = cache.refreshStatus === 'pending' && cache.refreshAttemptId
            ? String(cache.refreshAttemptId)
            : null;
        if (acceptsPayload) {
            const identity = cacheSource.identity || state.identity;
            const browserContextId = cacheSource.browserContextId || state.browserContextId;
            const sourceEstablished = identity !== state.identity || browserContextId !== state.browserContextId;
            const failed = cache.state === 'failed' || cache.refreshStatus === 'failed' || cache.refreshFailed === true;
            const preserved = event.preserveSelection === true && event.selectedSprintId != null;
            return {
                ...state,
                generation: state.generation + (sourceEstablished ? 1 : 0),
                identity,
                browserContextId,
                authority: 'validated',
                status: failed ? 'error' : refreshAttemptId ? 'refreshing' : 'ready',
                validatedSnapshot: {
                    identity,
                    browserContextId,
                    catalogVersion: cache.catalogVersion || null,
                    validatedAt: cache.validatedAt || null,
                    sprints,
                },
                displaySnapshot: preserved ? state.validatedSnapshot || state.displaySnapshot : state.displaySnapshot,
                availableSprints: sprints,
                selectedSprintId: preserved ? event.selectedSprintId : selectSprintId(sprints, state.selectedSprintId ?? state.savedSprintId),
                selectionPreserved: preserved,
                refreshAttemptId,
                errorReason: failed ? 'refresh_failed' : '',
            };
        }
        const matchingSnapshot = state.validatedSnapshot
            && state.validatedSnapshot.identity === state.identity
            && state.validatedSnapshot.browserContextId === state.browserContextId;
        return {
            ...state,
            authority: matchingSnapshot ? 'validated' : state.authority === 'display_only' ? 'display_only' : 'invalid',
            status: 'error',
            refreshAttemptId,
            errorReason: envelope.error || 'catalog_unavailable',
        };
    }
    if (event.type === 'FAILURE') {
        return {
            ...state,
            authority: state.validatedSnapshot ? 'validated' : state.authority === 'display_only' ? 'display_only' : 'invalid',
            status: 'error',
            refreshAttemptId: null,
            errorReason: 'catalog_unavailable',
        };
    }
    if (event.type === 'EXHAUSTED') {
        return { ...state, status: 'exhausted', refreshAttemptId: null, errorReason: 'refresh_exhausted' };
    }
    if (event.type === 'INVALIDATE') {
        const preserveSelection = event.preserveSelection === true && (state.authority === 'validated' || state.selectionPreserved);
        return {
            ...state,
            generation: state.generation + 1,
            authority: 'invalid',
            status: 'unknown',
            validatedSnapshot: null,
            displaySnapshot: preserveSelection ? state.validatedSnapshot || state.displaySnapshot : state.displaySnapshot,
            availableSprints: preserveSelection ? state.availableSprints : [],
            selectedSprintId: preserveSelection ? state.selectedSprintId : null,
            selectionPreserved: preserveSelection,
            refreshAttemptId: null,
            errorReason: String(event.reason || ''),
        };
    }
    if (event.type === 'AUTH_LOCK') {
        return { ...state, generation: state.generation + 1, authority: 'auth_locked', status: 'error', refreshAttemptId: null, errorReason: 'auth_required' };
    }
    return state;
}

function catalogEventIdentity(state) {
    return {
        generation: state.generation,
        identity: state.identity,
        browserContextId: state.browserContextId,
    };
}

function pendingAttempt(envelope) {
    const cache = envelope?.cache;
    if (cache?.refreshStatus !== 'pending' || !cache.refreshAttemptId || !cache.identity) return null;
    return { attemptId: String(cache.refreshAttemptId), identity: String(cache.identity) };
}

export function createSprintCatalogController({
    read,
    onState = () => {},
    initialState,
    now = () => Date.now(),
    setTimer = (fn, delay) => setTimeout(fn, delay),
    clearTimer = handle => clearTimeout(handle),
} = {}) {
    if (typeof read !== 'function') throw new TypeError('Sprint catalog controller requires read().');
    let state = initialState || createSprintCatalogState();
    let disposed = false;
    let activeRequest = null;
    let activeRequestKind = null;
    let activeRequestAbortController = null;
    let queuedForce = null;
    let observer = null;

    const publish = (event) => {
        const next = reduceSprintCatalog(state, event);
        if (next !== state) {
            state = next;
            onState(state);
        }
        return state;
    };
    const cancelObserver = () => {
        if (!observer) return;
        const cancelled = observer;
        observer = null;
        if (cancelled.timer !== null) clearTimer(cancelled.timer);
        cancelled.abortController?.abort();
        cancelled.settle(state);
    };
    const retire = () => {
        cancelObserver();
        activeRequestAbortController?.abort();
        activeRequestAbortController = null;
        activeRequest = null;
        activeRequestKind = null;
        if (queuedForce) queuedForce.resolve(state);
        queuedForce = null;
    };
    const acceptResponse = (envelope, captured, options = {}) => {
        if (envelope?.httpStatus === 401 || envelope?.error === 'auth_required') return publish({ type: 'AUTH_LOCK' });
        if (options.shouldApply && !options.shouldApply()) return state;
        const event = { type: 'RESPONSE', ...captured, envelope, preserveSelection: options.automatic === true || options.preserveSelection === true, selectedSprintId: options.selectedSprintId };
        const next = reduceSprintCatalog(state, event);
        if (options.automatic && (next.authority !== 'validated' || next.status === 'error')) return state;
        return publish(event);
    };
    const scheduleCompletion = (attempt, captured, startedAt, reads = 0, options = {}) => {
        if (disposed || !sameEventGeneration(state, captured)) return Promise.resolve(state);
        if (observer?.promise && observer.attemptId === attempt.attemptId && observer.identity === attempt.identity) {
            return observer.promise;
        }
        let settle;
        const promise = new Promise(resolve => { settle = resolve; });
        const entry = observer = { attemptId: attempt.attemptId, identity: attempt.identity, timer: null, abortController: null, promise, settle, startedAt, reads };
        const cancelEntry = () => { if (observer === entry) cancelObserver(); else settle(state); };
        const run = async () => {
            if (observer !== entry || disposed || !sameEventGeneration(state, captured) || (options.shouldApply && !options.shouldApply())) { cancelEntry(); settle(state); return; }
            const elapsed = now() - startedAt;
            if (entry.reads >= 16 || elapsed >= 75000) {
                observer = null;
                if (!options.automatic) publish({ type: 'EXHAUSTED', ...captured });
                settle(state);
                return;
            }
            entry.reads += 1;
            const remaining = Math.max(0, 75000 - elapsed);
            const abortController = new AbortController();
            entry.abortController = abortController;
            const abortTimer = setTimer(() => abortController.abort(), Math.min(5000, remaining));
            try {
                const envelope = await read({
                    forceRefresh: false,
                    completionAttemptId: attempt.attemptId,
                    catalogIdentity: attempt.identity,
                    signal: abortController.signal,
                    automatic: options.automatic === true,
                });
                if (!disposed && (envelope?.httpStatus === 401 || envelope?.error === 'auth_required')) {
                    cancelObserver(); publish({ type: 'AUTH_LOCK' }); settle(state); return;
                }
                if (observer !== entry || disposed || !sameEventGeneration(state, captured) || (options.shouldApply && !options.shouldApply())) {
                    cancelEntry(); settle(state); return;
                }
                if (now() - startedAt >= 75000) {
                    observer = null;
                    if (!options.automatic) publish({ type: 'EXHAUSTED', ...captured });
                    settle(state);
                    return;
                }
                acceptResponse(envelope, captured, options);
                const nextAttempt = pendingAttempt(envelope);
                if (!nextAttempt || envelope?.cache?.state === 'failed' || envelope?.cache?.refreshStatus === 'failed' || state.status === 'error' || state.authority === 'auth_locked') {
                    observer = null;
                    settle(state);
                    return;
                }
            } catch (error) {
                if (!disposed && (error?.code === 'auth_required' || error?.status === 401)) {
                    cancelObserver();
                    publish({ type: 'AUTH_LOCK' });
                    settle(state);
                    return;
                }
                if (observer !== entry || disposed || !sameEventGeneration(state, captured) || (options.shouldApply && !options.shouldApply())) { cancelEntry(); settle(state); return; }
                if (now() - startedAt >= 75000) {
                    observer = null;
                    if (!options.automatic) publish({ type: 'EXHAUSTED', ...captured });
                    settle(state);
                    return;
                }
            } finally {
                clearTimer(abortTimer);
            }
            if (observer !== entry || disposed || !sameEventGeneration(state, captured) || (options.shouldApply && !options.shouldApply())) { cancelEntry(); return; }
            const delays = [1000, 2000, 4000];
            const delay = delays[Math.min(entry.reads - 1, delays.length - 1)] || 5000;
            const boundedDelay = entry.reads >= 4 ? 5000 : delay;
            entry.timer = setTimer(run, boundedDelay);
        };
        entry.timer = setTimer(run, 1000);
        return promise;
    };
    const initiate = (forceRefresh, options = {}) => {
        if (disposed || state.authority === 'auth_locked') return Promise.resolve(state);
        if (activeRequest) {
            if (forceRefresh && activeRequestKind === 'ordinary') {
                if (!queuedForce) {
                    let resolve;
                    let reject;
                    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
                    queuedForce = { promise, resolve, reject };
                }
                return queuedForce.promise;
            }
            return activeRequest;
        }
        if (forceRefresh && observer?.promise) return observer.promise;
        if (forceRefresh) cancelObserver();
        if (!options.automatic) publish({ type: 'START', newGeneration: forceRefresh });
        const captured = catalogEventIdentity(state);
        activeRequestKind = forceRefresh ? 'forced' : 'ordinary';
        const requestAbortController = new AbortController();
        activeRequestAbortController = requestAbortController;
        const requestPromise = Promise.resolve().then(() => read({
            forceRefresh,
            completionAttemptId: null,
            catalogIdentity: null,
            signal: requestAbortController.signal,
            automatic: options.automatic === true,
        }));
        let operation;
        operation = requestPromise.then((envelope) => {
            if (!disposed && (envelope?.httpStatus === 401 || envelope?.error === 'auth_required')) {
                publish({ type: 'AUTH_LOCK' });
                return state;
            }
            if (disposed || !sameEventGeneration(state, captured)) return state;
            if (options.shouldApply && !options.shouldApply()) return state;
            acceptResponse(envelope, captured, options);
            const attempt = pendingAttempt(envelope);
            if (attempt) scheduleCompletion(attempt, catalogEventIdentity(state), now(), 0, options);
            return state;
        }, (error) => {
            if (disposed) return state;
            if (error?.code === 'auth_required' || error?.status === 401) publish({ type: 'AUTH_LOCK' });
            else if (!sameEventGeneration(state, captured)) return state;
            else if (!options.automatic) publish({ type: 'FAILURE', ...captured, error });
            return state;
        }).finally(() => {
            if (activeRequest !== operation) return;
            activeRequest = null;
            activeRequestKind = null;
            activeRequestAbortController = null;
            if (!queuedForce || disposed) return;
            const queued = queuedForce;
            queuedForce = null;
            if (observer?.promise) observer.promise.then(queued.resolve, queued.reject);
            else initiate(true).then(queued.resolve, queued.reject);
        });
        activeRequest = operation;
        return activeRequest;
    };

    return {
        getState: () => state,
        readCurrent: (options = {}) => initiate(false, options),
        async readDue({ selectedSprintId, signal, shouldApply } = {}) {
            const validatedAt = Date.parse(state.validatedSnapshot?.validatedAt || '');
            if (!Number.isFinite(validatedAt) || now() - validatedAt < SPRINT_CATALOG_CACHE_TTL_MS
                || state.authority !== 'validated' || activeRequest || observer || !shouldApply?.() || signal?.aborted) return state;
            const abort = () => { activeRequestAbortController?.abort(); cancelObserver(); };
            signal?.addEventListener('abort', abort, { once: true });
            try {
                const result = await initiate(false, { automatic: true, selectedSprintId, shouldApply });
                return observer?.promise ? await observer.promise : result;
            } finally { signal?.removeEventListener('abort', abort); }
        },
        refresh: () => initiate(true),
        acceptSource(source) {
            if (disposed) return state;
            const before = state;
            const readInFlight = Boolean(activeRequest || observer?.promise);
            publish({ type: 'SOURCE', source });
            if (state === before) return state;
            retire();
            // The retired read's response is discarded by the generation fence, so re-read under
            // the new source instead of stranding the catalog in 'unknown' with no request.
            if (readInFlight) void initiate(false);
            return state;
        },
        invalidate(reason = '', { preserveSelection = false } = {}) {
            if (disposed) return state;
            retire();
            publish({ type: 'INVALIDATE', reason, preserveSelection });
            return state;
        },
        authLock() {
            if (disposed) return state;
            retire();
            publish({ type: 'AUTH_LOCK' });
            return state;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            retire();
        },
    };
}

export function isActiveHomeTokenConnection(connection) {
    return Boolean(connection?.connected && connection.status === 'active' && !connection.needsReconnect);
}

const EPM_ACCESS_STATES = new Set(['available', 'disabled', 'scope_missing', 'empty', 'denied', 'unavailable']);

// Same-tab scope-update link: only the app's own /login or /login?reason=missing_scope is accepted.
function normalizeSameTabLoginUrl(value) {
    return typeof value === 'string' && /^\/login(\?reason=missing_scope)?$/.test(value.trim()) ? value.trim() : '';
}

// The three EPM capability fields of the config response. Production fails closed: a missing or mistyped field is
// false/empty. Basic compatibility is the established `authMode === 'basic'` rule (service credentials).
export function normalizeEpmCapabilities(config) {
    const source = config && typeof config === 'object' ? config : {};
    return {
        basicCompatibility: source.authMode === 'basic',
        viewEnabled: source.epmViewEnabled === true,
        homeReadAvailable: source.epmHomeReadAvailable === true,
        loginUrl: normalizeSameTabLoginUrl(source.epmHomeReadLoginUrl),
    };
}

// The EPM access response body. An unknown or mistyped state is `unavailable`; null stays unresolved.
export function normalizeEpmAccess(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const state = EPM_ACCESS_STATES.has(payload.state) ? payload.state : 'unavailable';
    return {
        state,
        homeReadAvailable: payload.epmHomeReadAvailable === true,
        loginUrl: normalizeSameTabLoginUrl(payload.loginUrl),
        message: typeof payload.message === 'string' ? payload.message : '',
    };
}

// The single EPM navigation rule. An unresolved access state hides navigation.
export function isEpmNavigationVisible(capabilities, access) {
    if (!capabilities) return false;
    if (capabilities.basicCompatibility === true) return true;
    return capabilities.viewEnabled === true
        && capabilities.homeReadAvailable === true
        && access?.state === 'available';
}

const EPM_RATE_LIMIT_CATEGORIES = new Set(['home_rate_limited', 'jira_rate_limited']);
const EPM_DENIED_CATEGORIES = new Set(['home_access_denied', 'jira_access_denied']);

// Shared by automatic and explicit EPM refresh paths. Real 401s never reach it (apiFetch owns them).
// retryAtMs is deliberately null: callers must not schedule retries from it.
export function classifyEpmReadError(error) {
    const status = Number(error?.status) || 0;
    const category = String(error?.category || error?.code || '');
    const retryAfterSeconds = Number.isFinite(error?.retryAfterSeconds) && error.retryAfterSeconds > 0
        ? Math.min(error.retryAfterSeconds, 30)
        : undefined;
    let outcome = 'failed';
    if (status === 429 || (status === 503 && EPM_RATE_LIMIT_CATEGORIES.has(category))) outcome = 'rate_limited';
    else if (status === 403 && EPM_DENIED_CATEGORIES.has(category)) outcome = 'denied';
    return {
        outcome,
        status,
        category,
        retryAfterSeconds,
        retryAtMs: null,
        invalidateHomeAvailability: outcome === 'denied' && category === 'home_access_denied',
    };
}

// Settings copy for typed OAuth goals/scope failures; never echoes a provider payload.
export function describeEpmReadError(error, fallback = '') {
    const status = Number(error?.status) || 0;
    const category = String(error?.category || error?.code || '');
    if (status === 409 && category === 'epm_scope_required') return 'Atlassian Home read permission is needed. Update your Atlassian permissions in Settings > Connections.';
    if (status === 403 && category === 'home_access_denied') return 'Atlassian Home did not grant access to this scope.';
    if (status === 502 && category === 'home_read_failed') return 'Atlassian Home could not be read. Try again later.';
    if (status === 503 && category === 'home_rate_limited') {
        const seconds = classifyEpmReadError(error).retryAfterSeconds;
        return seconds ? `Atlassian Home is rate limiting requests. Try again in ${seconds}s.` : 'Atlassian Home is rate limiting requests. Try again shortly.';
    }
    return error?.message || fallback;
}

export function isBackendConnectionFailure(error) {
    if (!error || error.name === 'AbortError') return false;
    if (error.name === 'ConfigBootstrapTimeoutError') return true;
    const message = String(error.message || error || '').toLowerCase();
    return message.includes('failed to fetch') ||
        message.includes('load failed') ||
        message.includes('networkerror') ||
        message.includes('network error') ||
        message.includes('connection refused');
}

export function getServerConnectionErrorMessage(backendUrl) {
    return `Server is not responding at ${backendUrl}. Start the Python server, then retry.`;
}

export function getCurrentQuarter() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    return `${year}Q${quarter}`;
}

export function setCookie(name, value, days = 365) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${JSON.stringify(value)};expires=${expires.toUTCString()};path=/`;
}

export function getCookie(name) {
    const namePrefix = `${name}=`;
    const cookies = document.cookie.split(';');
    for (let index = 0; index < cookies.length; index += 1) {
        let cookie = cookies[index];
        while (cookie.charAt(0) === ' ') cookie = cookie.substring(1, cookie.length);
        if (cookie.indexOf(namePrefix) !== 0) continue;
        try {
            return JSON.parse(cookie.substring(namePrefix.length, cookie.length));
        } catch (_error) {
            return null;
        }
    }
    return null;
}

export function loadUiPrefs() {
    try {
        const raw = window.localStorage.getItem(UI_PREFS_KEY);
        if (!raw) return null;
        const prefs = JSON.parse(raw);
        if (prefs && typeof prefs === 'object') prefs.showScenario = false;
        return prefs;
    } catch (_error) {
        return null;
    }
}

export function saveUiPrefs(prefs) {
    try {
        window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
    } catch (_error) {
        // Ignore unavailable browser storage.
    }
}
