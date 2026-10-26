const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

// The early startup script (frontend/dist/early-bootstrap.js) and the app's HTTP boundary share each
// startup read through one window slot. Both are bundled here exactly as the browser receives them
// and run in one fake window with a recording fetch, so every request the page would make is counted.
const API_DIR = path.join(__dirname, '..', 'frontend', 'src', 'api');
const SCRIPT_PATH = path.join(API_DIR, 'earlyBootstrap.js');
const ORIGIN = 'https://planner.example.test';
const PAGE_SEARCH = '?v=1&mode=board&find=secret%20text';
const CONFIG_URL = `${ORIGIN}/api/config?includeViewConfig=true`;
const GROUPS_URL = `${ORIGIN}/api/groups-config`;
const GROUPS_INIT = { method: 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-cache' };

let scriptBundle;
let appBundle;
function bundles() {
    scriptBundle ||= esbuild.buildSync({
        entryPoints: [SCRIPT_PATH], bundle: true, write: false, format: 'iife', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"production"' },
    }).outputFiles[0].text;
    appBundle ||= esbuild.buildSync({
        stdin: {
            contents: [
                "export * from './configApi.js';",
                "export * from './http.js';",
                "export * from './earlyBootstrapRegistry.js';",
                "export * from './earlyBootstrapContract.js';",
                "export { consumeAuthRecoverySuccess } from './authRecoveryCoordinator.js';",
                "export { AUTH_REQUIRED_EVENT } from './authRequired.js';",
            ].join('\n'),
            resolveDir: API_DIR,
            loader: 'js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    return { scriptBundle, appBundle };
}

const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Rejects at once for an aborted signal and on a later abort, as the browser's fetch does.
function abortable(init, result) {
    if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
    return new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        Promise.resolve(result).then(resolve, reject);
    });
}

// Headers arrive, the body never ends; aborting the request's signal errors the body, as in the browser.
function stalledBodyResponse(init) {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('{"jiraUrl":'));
            init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
        },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function createPage({ protocol = 'https:', backendUrl = '', responder = () => jsonResponse({}), withFetch = true } = {}) {
    const clock = { now: 10, epoch: 1_000 };
    const fetchCalls = [];
    const events = [];
    const apiResults = [];
    const sensitiveReads = [];
    const timeouts = { scale: ms => ms };
    const location = {
        protocol,
        origin: protocol === 'file:' ? 'null' : ORIGIN,
        get search() { sensitiveReads.push('location.search'); return PAGE_SEARCH; },
        get href() { sensitiveReads.push('location.href'); return `${ORIGIN}/${PAGE_SEARCH}`; },
        get hash() { sensitiveReads.push('location.hash'); return ''; },
    };
    class HarnessDate extends Date {
        static now() { return clock.epoch; }
    }
    const sandbox = {
        console, URL, Headers, Request, Response, ReadableStream, TextEncoder, AbortController, AbortSignal, DOMException,
        Date: HarnessDate,
        location,
        BACKEND_URL: backendUrl,
        performance: { now: () => clock.now },
        setTimeout: (callback, ms) => setTimeout(callback, timeouts.scale(ms)),
        clearTimeout,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
        },
        dispatchEvent(event) { events.push(event); return true; },
        addEventListener() {},
        removeEventListener() {},
        JepAnalytics: { trackApiResult: (surface, params) => apiResults.push({ surface, params }) },
    };
    for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(sandbox, name, { get() { sensitiveReads.push(name); return undefined; } });
    }
    if (withFetch) {
        sandbox.fetch = (url, init) => {
            fetchCalls.push({ url: String(url), init, abortedAtCall: Boolean(init?.signal?.aborted) });
            return responder(String(url), init, fetchCalls.length - 1);
        };
    }
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    const loadApp = () => {
        sandbox.module = { exports: {} };
        sandbox.exports = sandbox.module.exports;
        vm.runInContext(bundles().appBundle, context);
        return sandbox.module.exports;
    };
    let appModule = null;
    return {
        sandbox, clock, fetchCalls, events, apiResults, sensitiveReads, timeouts,
        runScript: () => vm.runInContext(bundles().scriptBundle, context),
        get app() { appModule ||= loadApp(); return appModule; },
        loadSecondAppCopy: loadApp,
        slot: () => sandbox.__JEP_EARLY_BOOTSTRAP__,
        lock: () => sandbox.__JEP_AUTH_REQUIRED__,
        callsTo: url => fetchCalls.filter(call => call.url === url),
        networkCallsTo: url => fetchCalls.filter(call => call.url === url && !call.abortedAtCall),
    };
}

function memoryStorage(entries = {}) {
    const values = new Map(Object.entries(entries));
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    };
}

test('test_contract_requests_equal_the_loader_requests', async () => {
    const page = createPage({ responder: () => jsonResponse({ ok: true }) });
    const { earlyBootstrapRequests, fetchAppConfig, fetchGroupsConfig } = page.app;
    await fetchAppConfig(ORIGIN);
    await fetchGroupsConfig(ORIGIN);
    const requests = plain(earlyBootstrapRequests(ORIGIN));
    assert.deepEqual(requests.map(request => request.key), ['config', 'groups']);
    assert.equal(page.fetchCalls.length, 2);
    for (const [index, request] of requests.entries()) {
        const call = page.fetchCalls[index];
        const { signal, ...loaderInit } = call.init || {};
        assert.equal(call.url, request.url);
        assert.deepEqual(plain(loaderInit), request.init);
        assert.equal(String(loaderInit.method || 'GET').toUpperCase(), String(request.init.method || 'GET').toUpperCase());
        assert.deepEqual([...new Headers(loaderInit.headers || {})], [...new Headers(request.init.headers || {})]);
        assert.equal(loaderInit.cache || 'default', request.init.cache || 'default');
    }
    assert.deepEqual(requests.map(request => request.url), [CONFIG_URL, GROUPS_URL]);
});

test('test_script_starts_both_requests_once_with_no_referrer_and_no_query', () => {
    const pending = new Promise(() => {});
    const page = createPage({ responder: () => pending });
    page.runScript();
    page.runScript();
    assert.equal(page.fetchCalls.length, 2);
    const expected = [{ url: CONFIG_URL, init: {} }, { url: GROUPS_URL, init: GROUPS_INIT }];
    for (const [index, { url, init }] of expected.entries()) {
        const call = page.fetchCalls[index];
        const { signal, ...rest } = call.init;
        assert.equal(call.url, url);
        assert.ok(!call.url.includes('find='), 'The early request must never carry the page query');
        assert.deepEqual(plain(rest), { ...init, credentials: 'same-origin', referrerPolicy: 'no-referrer' });
        assert.equal(typeof signal?.aborted, 'boolean');
    }
    const slot = page.slot();
    assert.deepEqual(Object.keys(slot), ['config', 'groups']);
    for (const [key, method, cache, call] of [['config', 'GET', undefined, page.fetchCalls[0]], ['groups', 'GET', 'no-cache', page.fetchCalls[1]]]) {
        const entry = slot[key];
        assert.equal(entry.state, 'early');
        assert.equal(entry.url, call.url);
        assert.equal(entry.method, method);
        assert.equal(entry.cache, cache);
        assert.equal(entry.startedAt, 10);
        assert.equal(entry.startedAtEpoch, 1_000);
        assert.equal(entry.settledAt, null);
        assert.equal(entry.claimed, false);
        assert.equal(entry.controller.signal, call.init.signal);
        assert.equal(typeof entry.promise.then, 'function');
    }
    assert.deepEqual(page.sensitiveReads, []);

    // The base comes from resolveBackendUrl: an explicit BACKEND_URL wins over the page origin.
    const overridden = createPage({ backendUrl: 'https://api.example.test', responder: () => pending });
    overridden.runScript();
    assert.deepEqual(overridden.fetchCalls.map(call => call.url), [
        'https://api.example.test/api/config?includeViewConfig=true',
        'https://api.example.test/api/groups-config',
    ]);
    const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
    assert.match(source, /import \{ resolveBackendUrl \} from '\.\/backendUrl\.js';/);
    assert.ok(source.includes('resolveBackendUrl(window)'));
});

test('test_script_does_nothing_off_http_and_never_throws_without_fetch', async () => {
    const offline = createPage({ protocol: 'file:' });
    assert.doesNotThrow(() => offline.runScript());
    assert.equal(offline.fetchCalls.length, 0);
    assert.equal(offline.slot(), undefined);

    const noFetch = createPage({ withFetch: false });
    assert.doesNotThrow(() => noFetch.runScript());
    assert.equal(noFetch.slot(), undefined);

    const throwing = createPage({ responder: () => { throw new TypeError('blocked'); } });
    assert.doesNotThrow(() => throwing.runScript());
    assert.equal(await throwing.slot().config.promise, null);
    assert.equal(await throwing.slot().groups.promise, null);
    assert.equal(throwing.slot().config.settledAt, 10);

    const rejecting = createPage({ responder: () => Promise.reject(new TypeError('Failed to fetch')) });
    rejecting.runScript();
    assert.equal(await rejecting.slot().config.promise, null);
    assert.equal(rejecting.slot().config.settledAt, 10);
});

test('test_adoption_is_get_only_exact_url_cache_and_once', async () => {
    const pending = () => new Promise(() => {});
    const mismatched = createPage({ responder: pending });
    mismatched.runScript();
    const { takeEarlyResponse } = mismatched.app;
    assert.equal(takeEarlyResponse(`${CONFIG_URL}&extra=1`, {}), null);
    assert.equal(takeEarlyResponse('https://other.example.test/api/config?includeViewConfig=true', {}), null);
    assert.equal(mismatched.slot().config.claimed, false, 'A URL that is not an early URL leaves the entry alone');
    assert.equal(takeEarlyResponse(CONFIG_URL, { method: 'POST' }), null);
    assert.equal(mismatched.slot().config.claimed, true);
    assert.equal(mismatched.slot().config.controller.signal.aborted, true);
    assert.equal(takeEarlyResponse(CONFIG_URL, {}), null, 'A rejected entry is never adopted later');
    assert.equal(takeEarlyResponse(GROUPS_URL, { ...GROUPS_INIT, cache: 'no-store' }), null);
    assert.equal(mismatched.slot().groups.claimed, true);
    assert.equal(mismatched.slot().groups.controller.signal.aborted, true);

    const response = jsonResponse({ adopted: true });
    const matched = createPage({ responder: url => (url === CONFIG_URL ? response : jsonResponse({ groups: [] })) });
    matched.runScript();
    const first = matched.app.takeEarlyResponse(CONFIG_URL, {});
    assert.equal(first.startedAtEpoch, 1_000);
    assert.equal(await first.promise, response);
    assert.equal(matched.app.takeEarlyResponse(CONFIG_URL, {}), null);
    assert.equal(matched.slot().config.claimed, true);
    assert.equal(matched.slot().config.controller.signal.aborted, false);
    // The claim lives in the shared slot: a second bundled copy of the registry cannot adopt it too.
    const secondCopy = matched.loadSecondAppCopy();
    assert.equal(secondCopy.takeEarlyResponse(CONFIG_URL, {}), null);
    const groups = secondCopy.takeEarlyResponse(GROUPS_URL, { method: 'get', headers: GROUPS_INIT.headers, cache: 'no-cache' });
    assert.ok(groups, 'A lower-case GET with the same cache mode is adopted');
    assert.equal(matched.app.takeEarlyResponse(GROUPS_URL, GROUPS_INIT), null);
    assert.equal(matched.fetchCalls.length, 2);
});

test('test_adoption_rejects_entries_older_than_30_seconds', async () => {
    const stale = createPage({ responder: (url, init) => jsonResponse({ from: init.referrerPolicy ? 'early' : 'normal' }) });
    stale.runScript();
    const { EARLY_BOOTSTRAP_MAX_AGE_MS, fetchAppConfig } = stale.app;
    assert.equal(EARLY_BOOTSTRAP_MAX_AGE_MS, 30_000);
    stale.clock.now = 10 + EARLY_BOOTSTRAP_MAX_AGE_MS + 1;
    assert.deepEqual(plain(await fetchAppConfig(ORIGIN)), { from: 'normal' });
    assert.equal(stale.callsTo(CONFIG_URL).length, 2);
    assert.equal(stale.slot().config.controller.signal.aborted, true);

    const fresh = createPage({ responder: (url, init) => jsonResponse({ from: init.referrerPolicy ? 'early' : 'normal' }) });
    fresh.runScript();
    fresh.clock.now = 10 + fresh.app.EARLY_BOOTSTRAP_MAX_AGE_MS;
    assert.deepEqual(plain(await fresh.app.fetchAppConfig(ORIGIN)), { from: 'early' });
    assert.equal(fresh.callsTo(CONFIG_URL).length, 1);
});

test('test_each_endpoint_is_requested_once_whatever_the_arrival_order', async () => {
    const responder = url => jsonResponse(url === CONFIG_URL ? { jiraUrl: 'https://jira.example.test' } : { groups: [] });
    const loadBoth = async page => {
        const config = await page.app.fetchBootstrapConfig(ORIGIN);
        const groups = await page.app.fetchGroupsConfig(ORIGIN);
        assert.equal(config.jiraUrl, 'https://jira.example.test');
        assert.deepEqual(plain(await groups.json()), { groups: [] });
    };
    const assertOnceEach = page => {
        assert.equal(page.callsTo(CONFIG_URL).length, 1);
        assert.equal(page.callsTo(GROUPS_URL).length, 1);
        assert.equal(page.fetchCalls.length, 2);
    };

    const scriptFirst = createPage({ responder });
    scriptFirst.runScript();
    await loadBoth(scriptFirst);
    assertOnceEach(scriptFirst);
    assert.deepEqual(['config', 'groups'].map(key => [scriptFirst.slot()[key].state, scriptFirst.slot()[key].claimed]), [['early', true], ['early', true]]);

    const scriptLate = createPage({ responder });
    const configRead = scriptLate.app.fetchBootstrapConfig(ORIGIN);
    const groupsRead = scriptLate.app.fetchGroupsConfig(ORIGIN);
    scriptLate.runScript();
    await configRead;
    await groupsRead;
    assertOnceEach(scriptLate);
    assert.deepEqual(['config', 'groups'].map(key => scriptLate.slot()[key].state), ['app', 'app']);

    const scriptBetween = createPage({ responder });
    const firstRead = scriptBetween.app.fetchBootstrapConfig(ORIGIN);
    scriptBetween.runScript();
    const secondRead = scriptBetween.app.fetchGroupsConfig(ORIGIN);
    await firstRead;
    await secondRead;
    assertOnceEach(scriptBetween);
    assert.deepEqual(['config', 'groups'].map(key => [scriptBetween.slot()[key].state, scriptBetween.slot()[key].claimed]), [['app', true], ['early', true]]);
});

test('test_stalled_body_after_adopted_headers_obeys_the_callers_abort_signal', async () => {
    const stalled = createPage({ responder: (url, init) => abortable(init, stalledBodyResponse(init)) });
    stalled.runScript();
    const controller = new AbortController();
    const read = stalled.app.apiFetch(CONFIG_URL, { signal: controller.signal });
    await tick();
    assert.equal(typeof stalled.slot().config.settledAt, 'number', 'The early headers have arrived');
    controller.abort();
    await assert.rejects(read, error => error.name === 'AbortError');
    assert.equal(stalled.slot().config.controller.signal.aborted, true);
    assert.equal(stalled.callsTo(CONFIG_URL).length, 1, 'An abort during the body never starts a second request');

    // While the headers are still pending, the abort stops the early request and the normal
    // request that replaces it rejects at once without reaching the network.
    const hanging = createPage({ responder: (url, init) => abortable(init, new Promise(() => {})) });
    hanging.runScript();
    const headersController = new AbortController();
    const headersRead = hanging.app.apiFetch(CONFIG_URL, { signal: headersController.signal });
    await tick();
    headersController.abort();
    await assert.rejects(headersRead, error => error.name === 'AbortError');
    assert.equal(hanging.slot().config.controller.signal.aborted, true);
    assert.equal(hanging.networkCallsTo(CONFIG_URL).length, 1);

    // The existing startup timeout ends a stalled early body (timeout shortened from 15 s).
    const timed = createPage({ responder: (url, init) => abortable(init, stalledBodyResponse(init)) });
    timed.timeouts.scale = ms => (ms === timed.app.CONFIG_BOOTSTRAP_TIMEOUT_MS ? 20 : ms);
    timed.runScript();
    await assert.rejects(timed.app.fetchBootstrapConfig(ORIGIN), error => error.name === 'ConfigBootstrapTimeoutError');
    assert.equal(timed.slot().config.claimed, true);
    assert.equal(timed.slot().config.controller.signal.aborted, true);
    assert.equal(timed.callsTo(CONFIG_URL).length, 1);
});

test('test_early_401_is_adopted_locks_once_and_is_never_replaced_by_a_second_request', async () => {
    const page = createPage({
        responder: (url, init, index) => (url === CONFIG_URL && index === 0
            ? jsonResponse({ error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401)
            : jsonResponse({ jiraUrl: 'https://jira.example.test', groups: [] })),
    });
    page.runScript();
    page.clock.epoch = 5_000;
    const { fetchBootstrapConfig, fetchAppConfig, AUTH_REQUIRED_EVENT, consumeAuthRecoverySuccess } = page.app;
    await assert.rejects(fetchBootstrapConfig(ORIGIN), error => error.name === 'AuthenticationRequiredError' && error.status === 401);
    await assert.rejects(fetchAppConfig(ORIGIN), error => error.name === 'AuthenticationRequiredError');
    assert.equal(page.callsTo(CONFIG_URL).length, 1, 'A 401 is never replaced by a request that would succeed');
    assert.equal(page.events.filter(event => event.type === AUTH_REQUIRED_EVENT).length, 1);
    const lock = page.lock();
    assert.equal(lock.locked, true);
    assert.equal(lock.loginUrl, '/login?reason=session_expired');
    assert.equal(lock.requestStartedAt, page.slot().config.startedAtEpoch);
    assert.equal(lock.requestStartedAt, 1_000);

    // authRecoveryCoordinator compares this start with a recovery success: one completed after the
    // early request was sent (3,000) may resume it, which the app's later adoption time (5,000) would deny.
    const success = { attemptId: 'attempt-early', completedAt: 3_000 };
    const shared = () => memoryStorage({ jira_dashboard_auth_recovery_success_v1: JSON.stringify(success) });
    assert.equal(consumeAuthRecoverySuccess(shared(), memoryStorage(), { now: 6_000, requestStartedAt: lock.requestStartedAt })?.attemptId, 'attempt-early');
    assert.equal(consumeAuthRecoverySuccess(shared(), memoryStorage(), { now: 6_000, requestStartedAt: 5_000 }), null);
});

test('test_groups_401_with_config_200_locks_once', async () => {
    const page = createPage({
        responder: url => (url === GROUPS_URL
            ? jsonResponse({ error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401)
            : jsonResponse({ jiraUrl: 'https://jira.example.test' })),
    });
    page.runScript();
    page.clock.epoch = 5_000;
    const outcomes = await Promise.allSettled([page.app.fetchBootstrapConfig(ORIGIN), page.app.fetchGroupsConfig(ORIGIN)]);
    assert.equal(outcomes[1].status, 'rejected');
    assert.equal(outcomes[1].reason.name, 'AuthenticationRequiredError');
    assert.equal(page.events.filter(event => event.type === page.app.AUTH_REQUIRED_EVENT).length, 1);
    assert.equal(page.lock().requestStartedAt, page.slot().groups.startedAtEpoch);
    assert.equal(page.callsTo(CONFIG_URL).length, 1);
    assert.equal(page.callsTo(GROUPS_URL).length, 1);
});

test('test_early_5xx_is_handled_like_a_normal_5xx_and_not_retried', async () => {
    const responder = url => (url === CONFIG_URL ? jsonResponse({ error: 'unavailable' }, 503) : jsonResponse({ error: 'broken' }, 500));
    const outcome = async page => {
        const config = await page.app.fetchBootstrapConfig(ORIGIN).then(() => 'resolved', error => `${error.name}: ${error.message}`);
        const groups = await page.app.fetchGroupsConfig(ORIGIN);
        return { config, groupsStatus: groups.status, groupsBody: plain(await groups.json()) };
    };
    const early = createPage({ responder });
    early.runScript();
    const normal = createPage({ responder });
    const adopted = await outcome(early);
    assert.deepEqual(adopted, await outcome(normal));
    assert.deepEqual(adopted, { config: 'Error: Config error 503', groupsStatus: 500, groupsBody: { error: 'broken' } });
    assert.equal(early.callsTo(CONFIG_URL).length, 1);
    assert.equal(early.callsTo(GROUPS_URL).length, 1);
    assert.equal(early.lock(), undefined);
    assert.equal(early.events.length, 0);
});

test('test_network_error_falls_back_to_exactly_one_normal_request', async () => {
    const page = createPage({
        responder: (url, init, index) => (index < 2
            ? Promise.reject(new TypeError('Failed to fetch'))
            : jsonResponse(url === CONFIG_URL ? { jiraUrl: 'https://jira.example.test' } : { groups: [] })),
    });
    page.runScript();
    const config = await page.app.fetchBootstrapConfig(ORIGIN);
    const groups = await page.app.fetchGroupsConfig(ORIGIN);
    assert.equal(config.jiraUrl, 'https://jira.example.test');
    assert.equal(groups.status, 200);
    for (const url of [CONFIG_URL, GROUPS_URL]) {
        const calls = page.callsTo(url);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
        assert.equal(calls[1].init.referrerPolicy, undefined, 'The fallback is the loader\'s own request');
    }
    assert.equal(page.fetchCalls.length, 4);
});

test('test_adoption_through_getJson_keeps_the_json_and_error_contract', async () => {
    const run = async (responder, read) => {
        const early = createPage({ responder });
        early.runScript();
        const normal = createPage({ responder });
        const settle = page => read(page.app).then(value => ({ value: plain(value) }), error => ({
            name: error.name, message: error.message, status: error.status, code: error.code,
        }));
        const adopted = await settle(early);
        assert.deepEqual(adopted, await settle(normal));
        assert.equal(early.fetchCalls.length, 2);
        return adopted;
    };
    const readConfig = app => app.getJson(CONFIG_URL, 'Config');
    assert.deepEqual(await run(() => jsonResponse({ jiraUrl: 'https://jira.example.test' }), readConfig), { value: { jiraUrl: 'https://jira.example.test' } });
    assert.deepEqual(await run(() => jsonResponse({}, 404), readConfig), {
        name: 'Error', message: 'Config error 404', status: undefined, code: undefined,
    });
    const readGroups = app => app.apiFetch(GROUPS_URL, GROUPS_INIT).then(response => app.jsonOrStructuredError(response, 'Groups'));
    assert.deepEqual(await run(() => jsonResponse({ error: 'conflict', message: 'Changed elsewhere.' }, 409), readGroups), {
        name: 'Error', message: 'Changed elsewhere.', status: 409, code: 'conflict',
    });
});

test('test_tracked_fetch_measures_from_the_early_start_to_the_earlier_of_settle_and_adoption', async () => {
    // Settled before adoption: the wait for the entry is not part of the measured duration.
    const headers = deferred();
    const settledFirst = createPage({ responder: url => (url === CONFIG_URL ? headers.promise : new Promise(() => {})) });
    settledFirst.clock.now = 100;
    settledFirst.runScript();
    settledFirst.clock.now = 250;
    headers.resolve(jsonResponse({ ok: true }));
    await tick();
    settledFirst.clock.now = 400;
    await settledFirst.app.trackedFetch('config_bootstrap', CONFIG_URL, {}, { featureName: 'config' });
    assert.equal(settledFirst.apiResults.length, 1);
    assert.equal(settledFirst.apiResults[0].surface, 'config_bootstrap');
    assert.equal(settledFirst.apiResults[0].params.status, 200);
    assert.equal(settledFirst.apiResults[0].params.durationMs, 150);

    // Adopted while pending: the duration still ends when the early response settled.
    const late = deferred();
    const pendingAtAdoption = createPage({ responder: url => (url === CONFIG_URL ? late.promise : new Promise(() => {})) });
    pendingAtAdoption.clock.now = 100;
    pendingAtAdoption.runScript();
    pendingAtAdoption.clock.now = 200;
    const tracked = pendingAtAdoption.app.trackedFetch('config_bootstrap', CONFIG_URL, {}, { featureName: 'config' });
    await tick();
    pendingAtAdoption.clock.now = 350;
    late.resolve(jsonResponse({ ok: true }));
    await tracked;
    assert.equal(pendingAtAdoption.apiResults[0].params.durationMs, 250);
    assert.ok(pendingAtAdoption.apiResults[0].params.durationMs <= pendingAtAdoption.clock.now - 100);

    // A normal request keeps today's clock: from the tracked call to its completion.
    const normalResponse = deferred();
    const normal = createPage({ responder: () => normalResponse.promise });
    normal.clock.now = 500;
    const normalTracked = normal.app.trackedFetch('config_bootstrap', CONFIG_URL, {}, { featureName: 'config' });
    await tick();
    normal.clock.now = 520;
    normalResponse.resolve(jsonResponse({ ok: true }));
    await normalTracked;
    assert.equal(normal.apiResults[0].params.durationMs, 20);
});
