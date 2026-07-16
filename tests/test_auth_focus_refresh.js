const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require('esbuild');

// Task 3 rewrites frontend/src/api/authFocusRefresh.js from a plain
// 60s-throttled focus/visibilitychange refresh into the refresh-only
// long-absence design specified in
// docs/plans/EXEC-auth-unfocused-auto-refresh.md. This file pins the NEW
// behavior and is expected to fail against the current module; Task 3 makes
// it pass. Each test builds the real module source with esbuild into an
// in-memory CJS bundle and evaluates it in a fresh `vm` context so the
// module's self-installed, module-scoped state never leaks across tests.
// Behavior is driven only through recorded window/document listener
// registrations and the module's public exports (installAuthFocusRefresh,
// refreshAuthOnFocus) -- never internals.

const MODULE_PATH = path.join(__dirname, '..', 'frontend', 'src', 'api', 'authFocusRefresh.js');

// Mirrors frontend/src/api/authRefreshContract.js, created in Task 3. These
// literals are hardcoded here (rather than imported) because the contract
// module does not exist yet during Task 2's expected-red phase.
const AUTH_REFRESH_THROTTLE_MS = 60 * 1000;
const LONG_ABSENCE_MS = 12 * 60 * 1000;
const AUTH_REFRESH_SHARED_STORAGE_KEY = 'jep.auth.lastRefreshAt';
const AUTH_LONG_ABSENCE_EVENT = 'jep:auth-long-absence-return';

// A realistic epoch-like base timestamp. Using 0 would collide with the
// module's zero-initialized lastAuthRefreshAt sentinel and mask throttle bugs.
const BASE_NOW = 1_700_000_000_000;

function bundleAuthFocusRefreshSource() {
    const result = esbuild.buildSync({
        entryPoints: [MODULE_PATH],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
    });
    return result.outputFiles[0].text;
}

// Minimal CustomEvent stand-in: only `type` and `detail` are used anywhere in
// the contract (the long-absence event carries `detail.unfocusedMs`).
class CustomEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

function createFakeStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { store.delete(key); },
    };
}

function createThrowingStorage() {
    const boom = () => { throw new Error('localStorage disabled'); };
    return { getItem: boom, setItem: boom, removeItem: boom };
}

// Builds a fresh isolated vm context per call so the module's self-installed,
// module-scoped state (lastAuthRefreshAt, unfocusedSince, refreshInFlight,
// listenersInstalled) never leaks across tests despite the module
// self-installing as a side effect of being loaded.
function createHarness({
    initialVisibility = 'visible',
    initialNow = BASE_NOW,
    fetchImpl,
    storage = createFakeStorage(),
} = {}) {
    const windowListeners = {};
    const documentListeners = {};
    const registrationCounts = { window: {}, document: {} };
    const dispatchedEvents = [];

    const fakeLocation = {
        assignCalls: [],
        assign(url) { this.assignCalls.push(url); },
    };

    const fakeWindow = {
        CustomEvent,
        location: fakeLocation,
        addEventListener(eventName, handler) {
            windowListeners[eventName] = windowListeners[eventName] || [];
            windowListeners[eventName].push(handler);
            registrationCounts.window[eventName] = (registrationCounts.window[eventName] || 0) + 1;
        },
        removeEventListener() {},
        dispatchEvent(event) {
            dispatchedEvents.push(event);
            return true;
        },
    };

    const fakeDocument = {
        visibilityState: initialVisibility,
        addEventListener(eventName, handler) {
            documentListeners[eventName] = documentListeners[eventName] || [];
            documentListeners[eventName].push(handler);
            registrationCounts.document[eventName] = (registrationCounts.document[eventName] || 0) + 1;
        },
        removeEventListener() {},
    };

    let currentNow = initialNow;
    const fetchCalls = [];
    const defaultFetchResponse = async () => ({ status: 200, ok: true, json: async () => ({}) });
    const activeFetch = fetchImpl || defaultFetchResponse;

    class FakeDate extends Date {
        static now() { return currentNow; }
    }

    const sandbox = {
        window: fakeWindow,
        document: fakeDocument,
        location: fakeLocation,
        localStorage: storage,
        CustomEvent,
        fetch: (...args) => {
            fetchCalls.push({ url: args[0], options: args[1] });
            return activeFetch(...args);
        },
        Date: FakeDate,
        module: { exports: {} },
        exports: {},
        console,
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(bundleAuthFocusRefreshSource(), context, { filename: 'authFocusRefresh.bundle.js' });

    return {
        exports: sandbox.module.exports,
        location: fakeLocation,
        storage,
        fetchCalls,
        dispatchedEvents,
        registrationCounts,
        setNow(value) { currentNow = value; },
        setVisibility(state) { fakeDocument.visibilityState = state; },
        fireWindowEvent(eventName) {
            return (windowListeners[eventName] || []).map((handler) => handler());
        },
        fireDocumentEvent(eventName) {
            return (documentListeners[eventName] || []).map((handler) => handler());
        },
    };
}

// Lets pending microtask chains inside refreshAuthOnFocus (await fetch, await
// response.json(), the 401 redirect, the finally-block flag reset) fully
// settle before assertions run.
async function flushMicrotasks(times = 8) {
    for (let i = 0; i < times; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

function longAbsenceEvents(harness) {
    return harness.dispatchedEvents.filter((event) => event.type === AUTH_LONG_ABSENCE_EVENT);
}

test('initial visible load performs exactly one auth POST and dispatches no long-absence event', async () => {
    const harness = createHarness({ initialVisibility: 'visible' });
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 1);
    assert.equal(harness.fetchCalls[0].url, '/api/auth/refresh');
    assert.equal(longAbsenceEvents(harness).length, 0);
});

test('initial visible load skips the POST when another tab refreshed within the throttle window', async () => {
    const storage = createFakeStorage({ [AUTH_REFRESH_SHARED_STORAGE_KEY]: String(BASE_NOW - 1000) });
    const harness = createHarness({ initialVisibility: 'visible', storage });
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 0);
    assert.equal(longAbsenceEvents(harness).length, 0);
});

test('initial hidden load performs no POST until a visible return', async () => {
    const harness = createHarness({ initialVisibility: 'hidden' });
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 0);
    assert.equal(longAbsenceEvents(harness).length, 0);
});

test('blur then focus return before 12 minutes performs one eligible throttled POST and no event', async () => {
    const harness = createHarness({ initialVisibility: 'visible' });
    await flushMicrotasks();
    const baseline = harness.fetchCalls.length;

    harness.fireWindowEvent('blur');
    harness.setNow(BASE_NOW + 90 * 1000); // clears the 60s throttle, well under 12 minutes
    harness.fireWindowEvent('focus');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length - baseline, 1);
    assert.equal(longAbsenceEvents(harness).length, 0);
});

test('blur then focus return at exactly 12 minutes performs one eligible POST and no long-absence event', async () => {
    const harness = createHarness({ initialVisibility: 'visible' });
    await flushMicrotasks();
    const baseline = harness.fetchCalls.length;

    harness.fireWindowEvent('blur');
    harness.setNow(BASE_NOW + LONG_ABSENCE_MS); // exactly 12:00.000 must NOT count as long absence
    harness.fireWindowEvent('focus');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length - baseline, 1);
    assert.equal(longAbsenceEvents(harness).length, 0);
});

test('blur then focus return at 12 minutes plus 1 millisecond dispatches exactly one long-absence event with the correct unfocusedMs', async () => {
    const harness = createHarness({ initialVisibility: 'visible' });
    await flushMicrotasks();
    const baseline = harness.fetchCalls.length;

    harness.fireWindowEvent('blur');
    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.fireWindowEvent('focus');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length - baseline, 1);
    const events = longAbsenceEvents(harness);
    assert.equal(events.length, 1);
    assert.equal(events[0].detail.unfocusedMs, LONG_ABSENCE_MS + 1);
});

test('hidden then visible return after more than 12 minutes behaves like the blur path: one POST, one event', async () => {
    const harness = createHarness({ initialVisibility: 'hidden' });
    await flushMicrotasks();
    const baseline = harness.fetchCalls.length;

    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.setVisibility('visible');
    harness.fireDocumentEvent('visibilitychange');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length - baseline, 1);
    assert.equal(longAbsenceEvents(harness).length, 1);
});

test('a focus event while still hidden preserves the earliest unfocused start and does not refresh', async () => {
    const harness = createHarness({ initialVisibility: 'hidden' });
    await flushMicrotasks();
    const baseline = harness.fetchCalls.length;

    // A spurious focus event fires while the document is still hidden; it
    // must not reset the tracked unfocused-start timestamp nor trigger a
    // refresh.
    harness.setNow(BASE_NOW + 5 * 60 * 1000);
    harness.fireWindowEvent('focus');
    await flushMicrotasks();
    assert.equal(harness.fetchCalls.length - baseline, 0, 'focus while hidden must not trigger a refresh');

    // Total elapsed since the ORIGINAL hidden start now exceeds 12 minutes.
    // If the spurious focus event had reset unfocusedSince, this would look
    // like an under-threshold return instead of a long-absence return.
    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.setVisibility('visible');
    harness.fireDocumentEvent('visibilitychange');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length - baseline, 1);
    assert.equal(longAbsenceEvents(harness).length, 1, 'the preserved original hidden start must drive the long-absence decision');
});

test('a focus and visibilitychange burst after a long-absence return settles to exactly one POST and one event total', async () => {
    const harness = createHarness({ initialVisibility: 'hidden' });
    await flushMicrotasks();

    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.setVisibility('visible');
    harness.fireDocumentEvent('visibilitychange');
    await flushMicrotasks(); // let the long-absence POST resolve before the burst

    harness.fireWindowEvent('focus');
    harness.fireDocumentEvent('visibilitychange');
    harness.fireWindowEvent('focus');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 1);
    assert.equal(longAbsenceEvents(harness).length, 1);
});

test('overlapping visible-return signals fired before the in-flight POST settles still collapse to one POST and one event', async () => {
    const harness = createHarness({ initialVisibility: 'hidden' });
    await flushMicrotasks();

    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.setVisibility('visible');
    // visibilitychange and focus fire in the same synchronous turn, before
    // the first call's `await fetch(...)` has any chance to resolve.
    const pending = [
        ...harness.fireDocumentEvent('visibilitychange'),
        ...harness.fireWindowEvent('focus'),
    ];
    await assert.doesNotReject(Promise.all(pending));
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 1);
    assert.equal(longAbsenceEvents(harness).length, 1);
});

test('a long-absence return skips the POST when another tab refreshed within the throttle window but still dispatches one event', async () => {
    const storage = createFakeStorage();
    const harness = createHarness({ initialVisibility: 'hidden', storage });
    await flushMicrotasks();

    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    // Another tab refreshed a moment ago.
    storage.setItem(AUTH_REFRESH_SHARED_STORAGE_KEY, String(BASE_NOW + LONG_ABSENCE_MS));
    harness.setVisibility('visible');
    harness.fireDocumentEvent('visibilitychange');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 0);
    assert.equal(longAbsenceEvents(harness).length, 1);
});

test('a long-absence POST that returns 401 clears the shared timestamp, redirects, and dispatches no event', async () => {
    const storage = createFakeStorage({
        [AUTH_REFRESH_SHARED_STORAGE_KEY]: String(BASE_NOW - 10 * 60 * 1000),
    });
    const harness = createHarness({
        initialVisibility: 'hidden',
        storage,
        fetchImpl: async () => ({
            status: 401,
            ok: false,
            json: async () => ({ loginUrl: '/login?reason=custom' }),
        }),
    });
    await flushMicrotasks();

    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.setVisibility('visible');
    harness.fireDocumentEvent('visibilitychange');
    await flushMicrotasks();

    assert.deepEqual(harness.location.assignCalls, ['/login?reason=custom']);
    assert.equal(longAbsenceEvents(harness).length, 0);
    assert.equal(
        harness.storage.getItem(AUTH_REFRESH_SHARED_STORAGE_KEY),
        null,
        'the shared timestamp must be cleared so other tabs can discover the expired session',
    );
});

test('a 401 without a loginUrl falls back to the default expired-session login path', async () => {
    const harness = createHarness({
        initialVisibility: 'visible',
        fetchImpl: async () => ({
            status: 401,
            ok: false,
            json: async () => ({}),
        }),
    });
    await flushMicrotasks();

    assert.deepEqual(harness.location.assignCalls, ['/login?reason=session_expired']);
});

test('a long-absence network error dispatches no event, does not crash, and a later long-absence attempt recovers with its own event', async () => {
    let shouldFail = true;
    const harness = createHarness({
        initialVisibility: 'hidden',
        fetchImpl: async () => {
            if (shouldFail) throw new Error('network down');
            return { status: 200, ok: true, json: async () => ({}) };
        },
    });
    await flushMicrotasks();

    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.setVisibility('visible');
    const pending = harness.fireDocumentEvent('visibilitychange');
    await assert.doesNotReject(Promise.all(pending), 'a network failure must be swallowed, not thrown to the caller');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 1, 'the failed attempt still counts as one POST attempt');
    assert.equal(longAbsenceEvents(harness).length, 0, 'a network error must not dispatch a long-absence event');

    // A later, independent long-absence return recovers: the POST succeeds
    // and dispatches its own event, proving the earlier failure left no
    // stuck in-flight or throttle state behind.
    shouldFail = false;
    const recoverBlurAt = BASE_NOW + LONG_ABSENCE_MS + 1 + AUTH_REFRESH_THROTTLE_MS + 1000;
    harness.setNow(recoverBlurAt);
    harness.fireWindowEvent('blur');
    harness.setNow(recoverBlurAt + LONG_ABSENCE_MS + 1);
    harness.fireWindowEvent('focus');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 2, 'a later eligible attempt must not be stuck behind a leaked in-flight flag');
    assert.equal(longAbsenceEvents(harness).length, 1, 'the recovering long-absence attempt must dispatch exactly one event');
});

test('a throwing localStorage degrades gracefully: single-tab behavior continues without crashing', async () => {
    const harness = createHarness({ initialVisibility: 'hidden', storage: createThrowingStorage() });
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 0, 'hidden initial load still performs no POST');

    harness.setNow(BASE_NOW + LONG_ABSENCE_MS + 1);
    harness.setVisibility('visible');
    const pending = harness.fireDocumentEvent('visibilitychange');
    await assert.doesNotReject(Promise.all(pending), 'a throwing localStorage must not crash the refresh flow');
    await flushMicrotasks();

    assert.equal(harness.fetchCalls.length, 1, 'a throwing localStorage must still allow in-memory throttling/refresh to work');
    assert.equal(longAbsenceEvents(harness).length, 1);
});

test('calling the installer twice registers each listener once and performs only one initial POST', async () => {
    const harness = createHarness({ initialVisibility: 'visible' });
    await flushMicrotasks();

    harness.exports.installAuthFocusRefresh();
    await flushMicrotasks();

    assert.equal(harness.registrationCounts.window.focus, 1);
    assert.equal(harness.registrationCounts.window.blur, 1);
    assert.equal(harness.registrationCounts.document.visibilitychange, 1);
    assert.equal(harness.fetchCalls.length, 1);
});
