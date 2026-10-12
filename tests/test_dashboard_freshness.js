import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardFreshnessController, isFreshnessEligible, parseFreshnessRetryAt } from '../frontend/src/dashboardFreshnessController.js';
import { installFreshnessListeners } from '../frontend/src/dashboardFreshnessListeners.js';

function harness({ environment = {}, descriptor = {}, sources = ['eng_product'], refreshScope, refreshAnchor, followUp } = {}) {
    const env = { surface: 'catch_up', contextKey: 'synthetic-scope', sessionEpoch: 1, focused: true, bootstrapReady: true, authReady: true, connectionOwned: false, blocked: false, ownerBusy: false, terminalAuth: false, ...environment };
    let clock = 3000;
    const calls = { scope: [], anchor: [], follow: [] };
    const deadlines = new Map();
    const timers = { setTimeout(callback, ms) { assert.equal(this, timers); const handle = {}; deadlines.set(handle, { callback, ms }); return handle; }, clearTimeout(handle) { assert.equal(this, timers); deadlines.delete(handle); } };
    const adapter = {
        sources: () => sources, captureAnchor: () => ({ key: 'synthetic' }),
        refreshAnchor: async job => { calls.anchor.push(job); return refreshAnchor ? refreshAnchor(job) : []; },
        refreshScope: async job => { calls.scope.push(job); return refreshScope ? refreshScope(job) : job.pendingSources.map(source => ({ source, status: 'ok', checkKind: 'forced', coverage: 'unknown', requestStartedAtMs: 2000, retryAtMs: null, ...descriptor })); },
        followUp: async job => { calls.follow.push(job); return followUp ? followUp(job) : []; },
    };
    const controller = createDashboardFreshnessController({ readEnvironment: () => env, readAdapter: () => adapter, now: () => clock, notify: () => {}, timers });
    return { env, calls, controller, deadlines, advance: value => { clock = value; } };
}
const request = h => h.controller.request({ reason: 'long_return', absenceStartedAtMs: 1000 });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

 test('blocked returns coalesce until current owner ready, then run once', async () => {
    const h = harness({ environment: { blocked: true } }); await request(h); await h.controller.request({ reason: 'long_return', absenceStartedAtMs: 1500 });
    assert.equal(h.calls.scope.length, 0); assert.equal(h.controller.getState().pending, true);
    h.env.blocked = false; await h.controller.update(); await h.controller.update();
    assert.equal(h.calls.scope.length, 1); assert.equal(h.controller.getState().pending, false); assert.equal(h.controller.getState().checks.eng_product.lastCheckedAtMs, 3000);
 });
 test('failed read settles once', async () => { const h = harness({ descriptor: { status: 'failed' } }); await request(h); for (let n = 0; n < 5; n++) await h.controller.update(); assert.equal(h.calls.scope.length, 1); assert.equal(h.controller.getState().pending, true); assert.equal(h.controller.getState().failure, 'failed'); });

for (const [flag, value] of [['focused', false], ['blocked', true], ['bootstrapReady', false], ['authReady', false], ['connectionOwned', true], ['ownerBusy', true]]) {
    test(`temporary ${flag} preserves one intent`, async () => { const h = harness({ environment: { [flag]: value } }); await request(h); assert.equal(h.calls.scope.length, 0); assert.equal(h.controller.getState().pending, true); h.env[flag] = !value; await h.controller.update(); assert.equal(h.calls.scope.length, 1); });
}
test('ownerBusy raised by scope and follow-up never vetoes active apply', async () => {
    let h; h = harness({ refreshScope: async job => { h.env.ownerBusy = true; assert.equal(job.shouldApply(), true); return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }]; }, followUp: async job => { h.env.ownerBusy = true; assert.equal(job.shouldApply(), true); } });
    await request(h); assert.equal(h.calls.follow.length, 1); assert.equal(h.controller.getState().pending, false);
});
for (const checkKind of ['cached', 'unknown']) test(`${checkKind} success settles unverified without retries`, async () => { const h = harness({ descriptor: { checkKind } }); await request(h); await h.controller.update(); assert.equal(h.calls.scope.length, 1); assert.equal(h.controller.getState().pending, false); assert.equal(h.controller.getState().failure, 'unverified'); });
test('denied resolves without claiming a check', async () => { const h = harness({ descriptor: { status: 'denied' } }); await request(h); assert.equal(h.controller.getState().pending, false); assert.equal(h.controller.getState().checks.eng_product, undefined); });
test('forced observation before absence records time but remains resumable', async () => { const h = harness({ descriptor: { requestStartedAtMs: 500 } }); await request(h); assert.equal(h.controller.getState().pending, true); assert.equal(h.controller.getState().checks.eng_product.lastCheckedAtMs, 3000); await h.controller.update(); assert.equal(h.calls.scope.length, 2); });
test('ignored result is resumable without failure', async () => { const h = harness({ descriptor: { status: 'ignored' } }); await request(h); assert.equal(h.controller.getState().failure, null); await h.controller.update(); assert.equal(h.calls.scope.length, 2); });
test('settled failure is not rearmed by blur and refocus', async () => { const h = harness({ descriptor: { status: 'failed' } }); await request(h); h.env.focused = false; await h.controller.update(); h.env.focused = true; await h.controller.update(); assert.equal(h.calls.scope.length, 1); await request(h); assert.equal(h.calls.scope.length, 2); });
for (const retryAtMs of [null, 64000]) test(`rate limited with unusable deadline ${retryAtMs} never retries`, async () => { const h = harness({ descriptor: { status: 'rate_limited', retryAtMs } }); await request(h); await h.controller.update(); assert.equal(h.deadlines.size, 0); assert.equal(h.calls.scope.length, 1); assert.equal(h.controller.getState().failure, 'rate_limited'); });
test('one retry acquires only failed sources using bound timer methods', async () => {
    const h = harness({ sources: ['eng_product', 'eng_tech'], refreshScope: async job => job.pendingSources.map(source => ({ source, status: source === 'eng_tech' ? 'rate_limited' : 'ok', checkKind: 'forced', requestStartedAtMs: 2000, retryAtMs: 5000 })) });
    await request(h); assert.equal(h.deadlines.size, 1); assert.equal(h.controller.getState().retryAtMs, 5000);
    const [handle, timer] = [...h.deadlines][0]; h.deadlines.delete(handle); h.advance(5000); timer.callback(); await h.controller.update();
    assert.deepEqual(h.calls.scope[1].pendingSources, ['eng_tech']); assert.equal(h.deadlines.size, 0); assert.equal(h.calls.anchor.length, 1);
});
test('anchor 429 never schedules a retry or blocks scope discovery', async () => { const h = harness({ refreshAnchor: async () => [{ source: 'eng_epic_product', status: 'rate_limited', retryAtMs: 4000 }] }); await request(h); assert.equal(h.calls.scope.length, 1); assert.equal(h.deadlines.size, 0); });
test('blur cancels scheduled retry but resumes once with consumed budget', async () => {
    const h = harness({ descriptor: { status: 'rate_limited', retryAtMs: 5000 } }); await request(h); h.env.focused = false; await h.controller.update(); assert.equal(h.deadlines.size, 0); assert.equal(h.controller.getState().pending, true); h.env.focused = true; await h.controller.update(); assert.equal(h.calls.scope.length, 2); assert.equal(h.deadlines.size, 0); await h.controller.update(); assert.equal(h.calls.scope.length, 2);
});
test('deadline reached while unfocused remains pending without hot retries', async () => { const h = harness({ descriptor: { status: 'rate_limited', retryAtMs: 5000 } }); await request(h); const [handle, timer] = [...h.deadlines][0]; h.deadlines.delete(handle); h.env.focused = false; timer.callback(); assert.equal(h.calls.scope.length, 1); h.env.focused = true; await h.controller.update(); assert.equal(h.calls.scope.length, 2); assert.equal(h.deadlines.size, 0); });
test('per-source needsAfterMs skips satisfied lanes and newer absence rearms', async () => {
    const h = harness({ sources: ['eng_product', 'eng_tech'], environment: { blocked: true } });
    await request(h); h.controller.acceptChecks({ contextKey: h.env.contextKey, completedAtMs: 2100, checks: [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }] });
    await h.controller.request({ reason: 'long_return', absenceStartedAtMs: 1500 }); h.env.blocked = false; await h.controller.update(); assert.deepEqual(h.calls.scope[0].pendingSources, ['eng_tech']);
    await request(h); assert.equal(h.calls.scope.length, 1); await h.controller.request({ reason: 'long_return', absenceStartedAtMs: 2500 }); assert.deepEqual(h.calls.scope[1].pendingSources, ['eng_product', 'eng_tech']);
});
test('cached observations cannot advance forced checks and wrong context is discarded', async () => { const h = harness(); await request(h); const before = h.controller.getState(); h.controller.acceptChecks({ contextKey: 'other', checks: [{ source: 'eng_product', status: 'failed' }] }); assert.equal(h.controller.getState(), before); h.advance(5000); h.controller.acceptChecks({ contextKey: h.env.contextKey, completedAtMs: 5000, checks: [{ source: 'eng_product', status: 'ok', checkKind: 'cached', coverage: 'complete' }] }); assert.equal(h.controller.getState().checks.eng_product.lastCheckedAtMs, 3000); assert.equal(h.controller.getState().checks.eng_product.checkKind, 'forced'); assert.equal(Object.isFrozen(h.controller.getState().checks.eng_product), true); });
test('snapshot identity is stable while content unchanged', async () => { const h = harness(); const before = h.controller.getState(); await h.controller.update(); assert.equal(h.controller.getState(), before); await request(h); const settled = h.controller.getState(); await request(h); assert.equal(h.controller.getState(), settled); assert.equal(h.calls.scope.length, 1); });
test('bfcache request without absence uses current clock', async () => { const h = harness({ descriptor: { requestStartedAtMs: 3000 } }); await h.controller.request({ reason: 'bfcache' }); assert.equal(h.controller.getState().pending, false); });
for (const reason of ['blur', 'blocked', 'context', 'principal', 'surface', 'terminal_auth', 'manual']) test(`retire ${reason} has correct intent lifetime`, async () => { const gate = deferred(); const h = harness({ refreshScope: () => gate.promise }); const promise = request(h); await Promise.resolve(); await Promise.resolve(); h.controller.retire(reason); assert.equal(h.controller.getState().pending, ['blur', 'blocked'].includes(reason)); gate.resolve([]); await promise; });
test('same-context requests join running drain', async () => { const gate = deferred(); const h = harness({ refreshScope: () => gate.promise }); const first = request(h); const second = request(h); assert.equal(first, second); await Promise.resolve(); await Promise.resolve(); gate.resolve([{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }]); await first; assert.equal(h.calls.scope.length, 1); });
test('different-context request queues behind retired old drain and ignores late result', async () => {
    const gate = deferred(); let n = 0; const h = harness({ refreshScope: async job => { if (++n === 1) return gate.promise; return job.pendingSources.map(source => ({ source, status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 })); } }); const first = request(h); await Promise.resolve(); await Promise.resolve(); h.env.contextKey = 'new-context'; const second = request(h); assert.notEqual(first, second); assert.equal(h.calls.scope[0].shouldApply(), false); gate.resolve([{ source: 'eng_product', status: 'failed' }]); await first; await second; assert.equal(h.calls.scope.length, 2); assert.equal(h.controller.getState().failure, null); assert.equal(h.controller.getState().pending, false);
});
test('session epoch change retires and resumes exactly once', async () => { const gate = deferred(); let n = 0; const h = harness({ refreshScope: async job => { if (++n === 1) return gate.promise; return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }]; } }); const promise = request(h); await Promise.resolve(); await Promise.resolve(); h.env.sessionEpoch++; h.controller.update(); assert.equal(h.calls.scope[0].shouldApply(), false); gate.resolve([]); await promise; assert.equal(h.calls.scope.length, 2); assert.equal(h.calls.scope[1].sessionEpoch, 2); });
test('dispose forbids late apply and notifications', async () => { const gate = deferred(); const h = harness({ refreshScope: () => gate.promise }); const promise = request(h); await Promise.resolve(); await Promise.resolve(); const job = h.calls.scope[0]; h.controller.dispose(); const before = h.controller.getState(); assert.equal(job.shouldApply(), false); gate.resolve([{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }]); await promise; await request(h); assert.equal(h.controller.getState(), before); });
test('manual all drops intent without implicit replay', async () => { const h = harness({ environment: { blocked: true } }); await request(h); h.controller.supersedeManual({ scope: 'all' }); h.env.blocked = false; await h.controller.update(); assert.equal(h.calls.scope.length, 0); assert.equal(h.controller.getState().pending, false); });
test('manual anchor aborts child signal while scope continues', async () => { const gate = deferred(); const h = harness({ refreshAnchor: () => gate.promise }); const promise = request(h); await Promise.resolve(); h.controller.supersedeManual({ scope: 'anchor' }); assert.equal(h.calls.anchor[0].anchorSignal.aborted, true); assert.equal(h.calls.anchor[0].signal.aborted, false); gate.resolve([]); await promise; assert.equal(h.calls.scope.length, 1); });
for (const stage of ['anchor', 'scope', 'follow']) test(`blur during ${stage} retires guarded work`, async () => {
    const gate = deferred(); const h = harness({ [stage === 'anchor' ? 'refreshAnchor' : stage === 'scope' ? 'refreshScope' : 'followUp']: () => gate.promise }); const promise = request(h); for (let n = 0; n < 6; n++) await Promise.resolve(); const job = h.calls[stage][0]; h.env.focused = false; h.controller.update(); assert.equal(job.shouldApply(), false); gate.resolve([]); await promise; if (stage === 'anchor') assert.equal(h.calls.scope.length, 0); if (stage === 'scope') assert.equal(h.calls.follow.length, 0);
});
test('blur after response before owner application rejects writes and follow-up', async () => { let h; let applied = 0; h = harness({ refreshScope: async job => { h.env.focused = false; if (job.shouldApply()) applied++; return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }]; } }); await request(h); assert.equal(applied, 0); assert.equal(h.calls.follow.length, 0); assert.equal(h.controller.getState().checks.eng_product, undefined); });
test('failure summary precedence', async () => { const h = harness(); h.controller.acceptChecks({ contextKey: h.env.contextKey, checks: [{ source: 'a', status: 'ok', checkKind: 'cached' }, { source: 'b', status: 'rate_limited' }, { source: 'c', status: 'failed' }] }); assert.equal(h.controller.getState().failure, 'failed'); });
test('eligibility returns strict booleans', () => { assert.equal(isFreshnessEligible({}), false); const h = harness(); assert.equal(isFreshnessEligible(h.env), true); h.env.ownerBusy = true; assert.equal(isFreshnessEligible(h.env), true); assert.equal(isFreshnessEligible(h.env, { starting: true }), false); });
for (const [value, expected] of [['0', 1000], ['5', 6000], [' 7 ', 8000], ['61', null], ['1e3', null], ['0x10', null], ['5.5', null], ['-1', null], ['', null], [undefined, null], ['1 2', null], ['abc 1', null]]) test(`Retry-After ${String(value)}`, () => assert.equal(parseFreshnessRetryAt(value, 1000), expected));
test('Retry-After IMF dates and invalid clocks', () => { const now = Date.parse('Fri, 09 Oct 2026 10:00:00 GMT'); assert.equal(parseFreshnessRetryAt('Fri, 09 Oct 2026 09:00:00 GMT', now), now); assert.equal(parseFreshnessRetryAt('Fri, 09 Oct 2026 10:00:30 GMT', now), now + 30000); assert.equal(parseFreshnessRetryAt('5', Infinity), null); assert.equal(parseFreshnessRetryAt('9999999999999999999999999999999999999999999999999', now), null); });

function eventTarget() {
    const listeners = new Map(); let added = 0; let removed = 0;
    return { addEventListener(type, fn) { added++; if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }, removeEventListener(type, fn) { removed++; listeners.get(type)?.delete(fn); }, dispatch(type, detail = {}, extra = {}) { for (const fn of [...(listeners.get(type) || [])]) fn({ type, detail, ...extra }); }, counts: () => ({ added, removed }), count: () => [...listeners.values()].reduce((n, list) => n + list.size, 0) };
}
import { AUTH_FOCUS_REFRESH_STATE_EVENT, AUTH_LONG_ABSENCE_EVENT, AUTH_SESSION_REFRESH_EVENT, CONNECTION_UNAVAILABLE_EVENT, CONNECTION_AVAILABLE_EVENT, LONG_ABSENCE_MS } from '../frontend/src/api/authRefreshContract.js';
import { AUTH_REQUIRED_EVENT } from '../frontend/src/api/authRequired.js';
test('listeners balance registrations and dispose is idempotent', () => { const win = eventTarget(); const doc = eventTarget(); let calls = 0; const listener = installFreshnessListeners(win, doc, { update: () => calls++, request: () => calls++ }); win.dispatch('focus'); doc.dispatch('visibilitychange'); assert.equal(calls, 2); listener.dispose(); listener.dispose(); assert.deepEqual(win.counts(), { added: 9, removed: 9 }); assert.deepEqual(doc.counts(), { added: 1, removed: 1 }); win.dispatch('focus'); doc.dispatch('visibilitychange'); assert.equal(calls, 2); });
test('listener ignores short/exact-threshold returns and derives absence origin', () => { const win = eventTarget(); const doc = eventTarget(); const calls = []; const listener = installFreshnessListeners(win, doc, { update: () => {}, request: arg => calls.push(arg), now: () => 1000000 }); win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 11 * 60000 }); win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: LONG_ABSENCE_MS }); assert.equal(calls.length, 0); win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000, observedAtMs: 900000 }); win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000, absenceStartedAtMs: 20 }); assert.deepEqual(calls.map(call => call.absenceStartedAtMs), [120000, 220000, 20]); listener.dispose(); });
test('only persisted BFCache with stale sources requests', () => { const win = eventTarget(); const doc = eventTarget(); let stale = false; let calls = 0; const listener = installFreshnessListeners(win, doc, { update: () => {}, request: arg => { assert.equal(arg.reason, 'bfcache'); calls++; }, shouldCheckBfcache: () => stale }); win.dispatch('pageshow', {}, { persisted: false }); win.dispatch('pageshow', {}, { persisted: true }); assert.equal(calls, 0); stale = true; win.dispatch('pageshow', {}, { persisted: true }); assert.equal(calls, 1); listener.dispose(); });
test('auth/session/terminal/connection callbacks precede controller update', () => { const win = eventTarget(); const doc = eventTarget(); const calls = []; const listener = installFreshnessListeners(win, doc, { update: () => calls.push('update'), request: () => {}, onAuthActivity: detail => calls.push(detail.status), onSessionRefresh: () => calls.push('epoch'), onTerminalAuth: () => calls.push('terminal'), onConnectionChange: value => calls.push(value) }); win.dispatch(AUTH_FOCUS_REFRESH_STATE_EVENT, { status: 'refreshing' }); win.dispatch(AUTH_SESSION_REFRESH_EVENT); win.dispatch(AUTH_REQUIRED_EVENT); win.dispatch(CONNECTION_UNAVAILABLE_EVENT); win.dispatch(CONNECTION_AVAILABLE_EVENT); assert.deepEqual(calls, ['refreshing', 'update', 'epoch', 'update', 'terminal', 'update', true, 'update', false, 'update']); listener.dispose(); });

import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const hookBundle = esbuild.buildSync({ entryPoints: ['frontend/src/useDashboardFreshness.js'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
function hookHarness({ environment = {}, scope = null, anchor = null, bootstrapReady = true, sources = ['eng_product'], retainedLongReturn = null } = {}) {
    const win = eventTarget(); const doc = Object.assign(eventTarget(), { visibilityState: 'visible', hasFocus: () => doc.focused, focused: true });
    if (retainedLongReturn) win.__JEP_PENDING_LONG_RETURN__ = retainedLongReturn;
    let clock = 1000000; const env = { surface: 'catch_up', contextKey: 'hook-synthetic', blocked: false, ownerBusy: false, ...environment };
    const slots = []; let cursor = 0; let effects = []; let effectIndex = 0; let cleanups = []; let initial = true; let stateWrites = 0;
    const react = { useRef(value) { const index = cursor++; if (!slots[index]) slots[index] = { current: value }; return slots[index]; }, useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { stateWrites++; slots[index] = next; }]; }, useEffect(fn, deps) { const index = effectIndex++; if (initial || deps === undefined) effects.push({ index, fn }); } };
    const module = { exports: {} }; const FakeDate = class extends Date { static now() { return clock; } };
    vm.runInNewContext(hookBundle, { module, exports: module.exports, require: name => { assert.equal(name, 'react'); return react; }, window: win, document: doc, Date: FakeDate, AbortController, setTimeout, clearTimeout, console });
    const calls = []; const adapter = { sources: () => sources, captureAnchor: () => null, refreshAnchor: async job => anchor ? anchor(job) : [], refreshScope: async job => { calls.push(job); return scope ? scope(job) : [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: clock, coverage: 'unknown' }]; }, followUp: async () => [] };
    let result;
    function render() { cursor = 0; effectIndex = 0; effects = []; result = module.exports.useDashboardFreshness({ win, doc, bootstrapReady }); result.ownersRef.current = { readEnvironment: () => env, readAdapter: surface => surface === env.surface ? adapter : null }; for (const { index, fn } of effects) { cleanups[index]?.(); cleanups[index] = fn(); } initial = false; return result; }
    function unmount() { for (const cleanup of cleanups) cleanup?.(); cleanups = []; }
    render();
    return { win, doc, env, calls, render, unmount, result: () => result, advance: value => { clock = value; }, writes: () => stateWrites,
        strictRemount() { unmount(); initial = true; render(); } };
}
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
test('hook ordinary mount installs listeners without duplicate bootstrap', async () => { const h = hookHarness(); await flush(); assert.equal(h.calls.length, 0); assert.equal(h.result().ownsSurface('catch_up'), true); assert.equal(h.result().ownsSurface('board'), false); assert.equal(h.result().automaticRefreshRef.current, null); h.unmount(); assert.equal(h.win.count(), 0); assert.equal(h.doc.count(), 0); });
test('hook current refs release blocked pending intent after render', async () => { const h = hookHarness({ environment: { blocked: true } }); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); assert.equal(h.calls.length, 0); h.env.blocked = false; h.render(); await flush(); assert.equal(h.calls.length, 1); h.unmount(); });
test('hook activity guards pending work; failed renewal remains ready', async () => { const h = hookHarness(); h.win.dispatch(AUTH_FOCUS_REFRESH_STATE_EVENT, { status: 'refreshing' }); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); assert.equal(h.calls.length, 0); h.win.dispatch(AUTH_FOCUS_REFRESH_STATE_EVENT, { status: 'failed' }); await flush(); assert.equal(h.calls.length, 1); h.unmount(); });
test('hook bootstrap not ready keeps intent until successful bootstrap render', async () => {
    const h = hookHarness({ bootstrapReady: false, environment: { bootstrapReady: false } }); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); assert.equal(h.calls.length, 0); h.env.bootstrapReady = true; h.render(); await flush(); assert.equal(h.calls.length, 1); h.unmount();
});
test('hook connection ownership and terminal auth are initialized and terminal is irreversible', async () => { const h = hookHarness({ environment: { connectionOwned: true } }); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); assert.equal(h.calls.length, 0); h.env.connectionOwned = false; h.win.dispatch(CONNECTION_AVAILABLE_EVENT); await flush(); assert.equal(h.calls.length, 1); h.win.dispatch(AUTH_REQUIRED_EVENT); h.win.dispatch(AUTH_SESSION_REFRESH_EVENT); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); assert.equal(h.calls.length, 1); h.unmount(); });
test('hook BFCache freshness threshold and unknown sources', async () => { const h = hookHarness(); h.win.dispatch('pageshow', {}, { persisted: true }); await flush(); assert.equal(h.calls.length, 1); h.win.dispatch('pageshow', {}, { persisted: true }); await flush(); assert.equal(h.calls.length, 1); h.advance(1000000 + LONG_ABSENCE_MS); h.win.dispatch('pageshow', {}, { persisted: true }); await flush(); assert.equal(h.calls.length, 1); h.advance(1000000 + LONG_ABSENCE_MS + 1); h.win.dispatch('pageshow', {}, { persisted: true }); await flush(); assert.equal(h.calls.length, 2); h.unmount(); });
test('hook session refresh retires old epoch and resumes once', async () => { const gate = deferred(); let n = 0; const h = hookHarness({ scope: async job => { if (++n === 1) return gate.promise; return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 1000000 }]; } }); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); h.win.dispatch(AUTH_SESSION_REFRESH_EVENT); assert.equal(h.calls[0].signal.aborted, true); gate.resolve([]); await flush(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].sessionEpoch, 1); h.unmount(); });
test('hook context render retires immediately while Boolean eligibility stays true', async () => { const gate = deferred(); const h = hookHarness({ scope: () => gate.promise }); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); h.env.contextKey = 'new-hook-scope'; h.render(); assert.equal(h.calls[0].signal.aborted, true); gate.resolve([]); await flush(); h.render(); assert.equal(h.result().state.pending, false); assert.equal(h.calls.length, 1); h.unmount(); });
test('hook StrictMode cleanup/reinstall creates a working controller and balances listeners', async () => { const h = hookHarness(); h.strictRemount(); h.win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: 13 * 60000 }); await flush(); assert.equal(h.calls.length, 1); h.unmount(); assert.deepEqual(h.win.counts(), { added: 18, removed: 18 }); const writes = h.writes(); h.win.dispatch(AUTH_SESSION_REFRESH_EVENT); await flush(); assert.equal(h.writes(), writes); });
test('adapter authentication rejection is propagated without descriptor conversion', async () => { const error = Object.assign(new Error('synthetic terminal'), { status: 401 }); const h = harness({ refreshScope: async () => { throw error; } }); await assert.rejects(request(h), error); assert.equal(h.controller.getState().checks.eng_product, undefined); });
test('freshness modules contain no I/O, writes, periodic work, storage or browser test overrides', () => {
    const modules = ['dashboardFreshnessController.js', 'dashboardFreshnessListeners.js', 'useDashboardFreshness.js', 'dashboardFreshnessAdapters.js', 'dashboardFreshnessSummary.js', 'components/DashboardFreshnessStatus.jsx', 'eng/engReadingAnchor.js'];
    for (const name of modules) { const path = `frontend/src/${name}`; assert.ok(fs.existsSync(path), `${path} must exist for its negative guard`); const source = fs.readFileSync(path, 'utf8'); assert.doesNotMatch(source, /(^|[^.])\/api\/|\bfetch\s*\(|setInterval|localStorage|sessionStorage|BroadcastChannel|window\.__|advanceClock|updateCapacity|updateIssueField|transitionIssues|updateIssuePriorities|updateIssueProjectTrack|saveEpmConfig|saveAdminMembership|deleteHomeTokenConnection|savePlanningSprintReview|saveSprintReview/); }
});
test('blur then newer return retires pre-blur result and requests one current check', async () => {
    const gate = deferred(); let n = 0; const h = harness({ refreshScope: async () => {
        if (++n === 1) return gate.promise;
        return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 4000 }];
    } });
    const promise = request(h); await flush(); h.env.focused = false; h.controller.update();
    h.env.focused = true; h.advance(5000); const joined = h.controller.request({ reason: 'long_return', absenceStartedAtMs: 3500 });
    assert.notEqual(joined, promise); assert.equal(h.calls.scope[0].shouldApply(), false);
    gate.resolve([{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }]); await promise; await joined;
    assert.equal(h.calls.scope.length, 2); assert.equal(h.controller.getState().pending, false);
    assert.equal(h.controller.getState().checks.eng_product.lastCheckedAtMs, 5000);
});
test('surface change retires old job even when context key was unchanged', async () => {
    const gate = deferred(); const h = harness({ refreshScope: () => gate.promise }); const promise = request(h); await flush();
    h.env.surface = 'board'; h.controller.update(); assert.equal(h.calls.scope[0].signal.aborted, true); assert.equal(h.controller.getState().pending, false);
    gate.resolve([]); await promise;
});
test('epoch changing at response boundary is detected without an event update', async () => {
    let h; let n = 0; h = harness({ refreshScope: async () => { if (++n === 1) h.env.sessionEpoch++; return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }]; } });
    await request(h); assert.equal(h.calls.scope.length, 2); assert.equal(h.controller.getState().pending, false);
});
test('refocus while retired old drain is unresolved queues exactly one resumed attempt', async () => {
    const gate = deferred(); let n = 0; const h = harness({ refreshScope: async () => {
        if (++n === 1) return gate.promise;
        return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }];
    } });
    const first = request(h); await flush(); h.env.focused = false; h.controller.update();
    h.env.focused = true; const resumed = h.controller.update(); assert.notEqual(resumed, first); await resumed; assert.equal(h.calls.scope.length, 2);
    gate.resolve([{ source: 'eng_product', status: 'failed' }]); await first;
    assert.equal(h.calls.scope.length, 2); assert.equal(h.controller.getState().pending, false); assert.equal(h.controller.getState().failure, null);
});
test('retry resumes only its rate-limited subset, leaving unrelated failures settled', async () => {
    const h = harness({ sources: ['eng_product', 'eng_tech'], refreshScope: async job => job.pendingSources.map(source => ({ source, status: source === 'eng_product' ? 'failed' : 'rate_limited', retryAtMs: 5000 })) });
    await request(h); h.env.focused = false; h.controller.update(); h.env.focused = true; await h.controller.update();
    assert.deepEqual(h.calls.scope[1].pendingSources, ['eng_tech']); assert.equal(h.calls.anchor.length, 1); assert.equal(h.controller.getState().checks.eng_product.failure, 'failed');
});
test('unregistered surface starts no acquisition and leaves legacy ownership', async () => {
    let calls = 0; const env = { contextKey: 'unknown', surface: 'scenario', focused: true, bootstrapReady: true, authReady: true };
    const controller = createDashboardFreshnessController({ readEnvironment: () => env, readAdapter: () => null, notify: () => calls++ });
    await controller.request({ reason: 'long_return' }); await controller.update(); assert.equal(controller.ownsSurface('scenario'), false); assert.equal(controller.getState().pending, false); assert.equal(calls, 0);
});
test('bootstrap cached observation records no failure or pending intent', () => {
    const h = harness(); h.controller.acceptChecks({ contextKey: h.env.contextKey, completedAtMs: 3000, checks: [{ source: 'eng_product', status: 'ok', checkKind: 'cached', coverage: 'unknown', requestStartedAtMs: 2000 }] });
    assert.equal(h.controller.getState().pending, false); assert.equal(h.controller.getState().failure, null); assert.equal(h.controller.getState().checks.eng_product.checkKind, 'cached');
});
for (const status of ['failed', 'rate_limited']) for (const guard of ['focused', 'blocked']) test(`mixed settled ${status} survives ${guard} interruption during follow-up`, async () => {
    const gate = deferred(); const h = harness({ sources: ['eng_product', 'eng_tech'], refreshScope: async job => job.pendingSources.map(source => ({ source, status: source === 'eng_product' ? status : 'ok', checkKind: 'forced', requestStartedAtMs: 2000, retryAtMs: status === 'rate_limited' ? 64000 : null })), followUp: () => gate.promise });
    const first = request(h); await flush(); assert.equal(h.calls.follow.length, 1);
    h.env[guard] = guard === 'blocked'; h.controller.update();
    h.env[guard] = guard !== 'blocked'; const resumed = h.controller.update();
    gate.resolve([]); await first; await resumed; await h.controller.update();
    assert.equal(h.calls.scope.length, 1); assert.equal(h.controller.getState().pending, true); assert.equal(h.controller.getState().failure, status);
    await request(h); assert.equal(h.calls.scope.length, 2); assert.deepEqual(h.calls.scope[1].pendingSources, ['eng_product']);
});

for (const rejected of ['null', 'throw']) {
    test(`ordinary Board cancels provisional capture after ${rejected} acceptance and releases leases once`, async () => {
        const { createCatchUpFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
        const calls = []; const bridge = {};
        const input = { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 },
            boardFreshnessRef: { current: { beforeCommit() { calls.push('capture'); return bridge; }, cancelCommit(value) { assert.equal(value, bridge); calls.push('cancel'); } } },
            epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }),
                applyScopeSnapshot() { if (rejected === 'throw') throw new Error('acceptance failed'); return null; } },
            collectGroupRefresh: async () => ({ release() { calls.push('release'); } }) };
        const adapter = createCatchUpFreshnessAdapter(() => input, { board: true });
        const job = { shouldApply: () => true, pendingSources: ['eng_product', 'eng_tech'] };
        if (rejected === 'throw') await assert.rejects(adapter.refreshScope(job, null), /acceptance failed/);
        else assert.deepEqual(await adapter.refreshScope(job, null), [{ source: 'eng_product', status: 'ignored' }, { source: 'eng_tech', status: 'ignored' }]);
        assert.deepEqual(calls, ['capture', 'cancel', 'release']);
    });
}

test('Planning eligibility distinguishes review loading from current dirty/editor guards', async () => {
    const { readFreshnessScopeGuards, readFreshnessEnvironment } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    let review = { loading: true }; const input = { showPlanning: true, planningReview: { getState: () => review }, planningInteractionRef: { current: false }, capacityInteractionRef: { current: false },
        loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, authResumePrincipalRef: {}, connectionRecoveryPrincipalRef: {}, acceptedBoardConfigRef: {}, connectionUnavailableRef: {}, alertCohortRef: {} };
    assert.equal(readFreshnessScopeGuards(input).blocked, false); assert.equal(readFreshnessEnvironment(input).ownerBusy, true);
    for (const key of ['dirty', 'saving', 'conflict', 'unconfirmed', 'pendingScopeChange']) { review = { [key]: true }; assert.equal(readFreshnessScopeGuards(input).blocked, true); }
    review = {}; for (const ref of [input.planningInteractionRef, input.capacityInteractionRef]) { ref.current = true; assert.equal(readFreshnessScopeGuards(input).blocked, true); ref.current = false; }
});
test('Planning primary hold releases on scope settlement or anchor cancellation even if follow-up skips', async () => {
    const { createPlanningFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const input = { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, planningAutomaticReadRef: { current: 0 }, capacityScopeHoldRef: { current: 2 },
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }), applyScopeSnapshot: () => null },
        collectGroupRefresh: async () => ({ release() {} }) };
    const adapter = createPlanningFreshnessAdapter(() => input); const signal = new AbortController();
    const job = { signal: signal.signal, shouldApply: () => true, pendingSources: ['eng_product', 'eng_tech'] };
    await adapter.refreshAnchor(job, null); assert.equal(input.capacityScopeHoldRef.current, 3); assert.equal(input.planningAutomaticReadRef.current, 1);
    await adapter.refreshScope(job, null); signal.abort(); assert.equal(input.capacityScopeHoldRef.current, 2); assert.equal(input.planningAutomaticReadRef.current, 0);
    const cancel = new AbortController(), next = { ...job, signal: cancel.signal }; await adapter.refreshAnchor(next, null); cancel.abort(); assert.equal(input.capacityScopeHoldRef.current, 2);
});

for (const [view, sources] of [['teams',['eng_product','eng_tech']], ['priority',['eng_product','eng_tech']], ['burnout',['eng_product','eng_tech','stats_burnout']], ['cohort',['stats_cohort']], ['excludedCapacity',['stats_excluded_capacity']], ['monoCrossShare',['stats_excluded_capacity']], ['projectTrack',['stats_excluded_capacity']]]) {
    test(`Statistics automatic ${view} owns only its active sources`, async () => {
        const { createStatsFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
        const calls = [], ref = { current: null };
        const input = { statsView: view, automaticRefreshRef: ref, startStatsRefresh(source) { calls.push(source); ref.current.settle([{ source, status:'ok', checkKind:'unknown' }]); } };
        const primary = { refreshScope: async () => { calls.push('scope'); return sources.filter(s=>s.startsWith('eng_')).map(source=>({source,status:'ok',checkKind:'forced'})); } };
        const adapter = createStatsFreshnessAdapter(() => input, primary);
        assert.deepEqual(adapter.sources(), sources);
        const controller = new AbortController();
        await adapter.refreshScope({ signal: controller.signal, shouldApply:()=>true, pendingSources:sources });
        assert.deepEqual(calls, [...(sources.includes('eng_product')?['scope']:[]), ...sources.filter(s=>s.startsWith('stats_'))]);
        assert.equal(ref.current, null);
    });
}
test('Statistics automatic waiter retires on abort even if no hook settles', async () => {
    const { createStatsFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const ref={current:null}, controller=new AbortController();
    const adapter=createStatsFreshnessAdapter(()=>({statsView:'cohort',automaticRefreshRef:ref,startStatsRefresh(){}}),{});
    const pending=adapter.refreshScope({signal:controller.signal,shouldApply:()=>!controller.signal.aborted,pendingSources:['stats_cohort']});
    controller.abort(); assert.deepEqual(await pending, []); assert.equal(ref.current,null);
});
test('EPM adapter invokes the guarded view owner once and has no client fanout', async () => {
    const { createEpmFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const calls=[], adapter=createEpmFreshnessAdapter(()=>({refreshEpmView:async options=>{calls.push(options);return [{source:'epm_projects',status:'ok',checkKind:'cached'},{source:'epm_rollup',status:'ok',checkKind:'unknown'}];}}));
    const job={shouldApply:()=>true}; assert.deepEqual(adapter.sources(),['epm_projects','epm_rollup']);
    assert.equal((await adapter.refreshScope(job)).length,2); assert.deepEqual(calls,[{job,issueEditState:undefined,beforeCommit:undefined}]);
});

test('Stats explicit recorder records only actual current accepted observations and never nonce success',async()=>{
    const {createDashboardFreshnessOwners}=await import('../frontend/src/dashboardFreshnessAdapters.js');const observations=[];
    const ref={current:null},freshness={ownersRef:{current:null},automaticRefreshRef:ref,acceptChecks:value=>observations.push(value)};
    const inputs={showStats:true,statsView:'excludedCapacity',loadEpochRef:{current:1},groupLoadVersionRef:{current:1},authResumePrincipalRef:{},connectionRecoveryPrincipalRef:{},acceptedBoardConfigRef:{},connectionUnavailableRef:{},alertCohortRef:{},automaticRefreshRef:ref};
    const owners=createDashboardFreshnessOwners(freshness,inputs);freshness.ownersRef.current=owners;
    owners.recordExplicitRefresh('stats',{statsSource:true});assert.equal(observations.length,0);
    const record=ref.createExplicitRecorder('stats_excluded_capacity');assert.equal(typeof record,'function');record({cached:false},123);
    assert.equal(observations.length,1);assert.equal(observations[0].checks[0].checkKind,'forced');assert.equal(observations[0].checks[0].requestStartedAtMs,123);
    owners.recordExplicitRefresh('stats',{statsSource:true});const stale=ref.createExplicitRecorder('stats_excluded_capacity');inputs.activeGroupId='changed';stale({cached:false},124);assert.equal(observations.length,1);
    assert.equal(ref.createExplicitRecorder('stats_cohort'),null);
});

test('Burnout acquisition context stays current when its own ENG acceptance changes task-derived query values',async()=>{
    const {readFreshnessEnvironment}=await import('../frontend/src/dashboardFreshnessAdapters.js');
    const input={showStats:true,statsView:'burnout',activeGroupId:'synthetic-group',selectedSprint:'synthetic-sprint',activeGroupTeamIds:['synthetic-team'],statsQueryScope:['synthetic-team','2026Q1','2026Q2','synthetic-sprint','synthetic-sprint'],loadEpochRef:{current:1},groupLoadVersionRef:{current:1},authResumePrincipalRef:{current:'synthetic-principal'},connectionRecoveryPrincipalRef:{current:'synthetic-site'},acceptedBoardConfigRef:{current:true},connectionUnavailableRef:{current:false},alertCohortRef:{current:null},burnoutQueryKey:'sprint::DEMO-1',issuePeopleStatsRevision:1};
    const before=readFreshnessEnvironment(input).contextKey;input.burnoutQueryKey='sprint::DEMO-1,DEMO-2';input.issuePeopleStatsRevision++;
    assert.equal(readFreshnessEnvironment(input).contextKey,before,'accepted task-derived ids/revision cannot retire the owner job');
    input.statsQueryScope=['synthetic-team','2026Q1','2026Q3','synthetic-sprint','synthetic-sprint'];assert.notEqual(readFreshnessEnvironment(input).contextKey,before,'deliberate source acquisition scope still retires');
});

test('ignored outside-range Stats pending intent does not repeat nonce work on ordinary unchanged hook renders',async()=>{
    const {createStatsFreshnessAdapter}=await import('../frontend/src/dashboardFreshnessAdapters.js');let adapter,nonces=0,reads=0;const priorFetch=global.fetch;
    const h=hookHarness({environment:{surface:'stats'},sources:['stats_excluded_capacity'],scope:job=>adapter.refreshScope(job)}),ref=h.result().automaticRefreshRef;
    adapter=createStatsFreshnessAdapter(()=>({statsView:'projectTrack',automaticRefreshRef:ref,startStatsRefresh(){nonces++;ref.current.settle([{source:'stats_excluded_capacity',status:'ignored',checkKind:'unknown',coverage:'unknown',requestStartedAtMs:0}]);}}),{});
    global.fetch=async()=>{reads++;throw new Error('no source outside approved range');};
    try {
        h.win.dispatch(AUTH_LONG_ABSENCE_EVENT,{unfocusedMs:13*60000});await flush();h.render();assert.equal(h.result().state.running,false);assert.equal(h.result().state.pending,true);assert.equal(Object.keys(h.result().state.checks).length,0);
        for(let n=0;n<4;n++){h.render();await flush();}assert.equal(h.calls.length,1);assert.equal(nonces,1);assert.equal(reads,0);assert.equal(ref.current,null);assert.equal(h.result().state.running,false);assert.equal(h.result().state.pending,true);
    } finally {h.unmount();global.fetch=priorFetch;}
});

test('freshness checked age floors elapsed time and clamps future observations', async () => {
    const { formatCheckedAge } = await import('../frontend/src/dashboardFreshnessSummary.js');
    for (const [age, copy] of [[0, '0s'], [59000, '59s'], [60000, '1m'], [61 * 60000, '1h'], [25 * 3600000, '1d'], [-1000, '0s']]) {
        assert.equal(formatCheckedAge(100000000, 100000000 - age), copy);
    }
});
test('freshness summary uses only active scope sources and their oldest forced observation', async () => {
    const { summarizeFreshness } = await import('../frontend/src/dashboardFreshnessSummary.js');
    const sources = ['eng_product', 'eng_tech'];
    const state = { pending: false, running: false, failure: null, checks: {
        eng_epic_product: { checkKind: 'forced', lastCheckedAtMs: 1, coverage: 'partial', failure: 'failed' },
        eng_product: { checkKind: 'forced', lastCheckedAtMs: 60000, coverage: 'complete' },
        eng_tech: { checkKind: 'forced', lastCheckedAtMs: 120000, coverage: 'unknown' },
    } };
    assert.equal(summarizeFreshness(state, sources, 180000), 'Checked 2m ago; coverage unknown');
    state.checks.eng_tech.coverage = 'partial';
    assert.equal(summarizeFreshness(state, sources, 180000), 'Checked 2m ago; partial results');
    state.checks.eng_product.coverage = 'unknown';
    assert.equal(summarizeFreshness(state, sources, 180000), 'Checked 2m ago; partial results; coverage unknown');
    state.checks.eng_tech.checkKind = 'cached';
    assert.equal(summarizeFreshness(state, sources, 180000), 'Checked 2m ago; coverage unknown');
    assert.equal(summarizeFreshness({ checks: { eng_product: { checkKind: 'cached' } } }, sources, 180000), '');
    assert.equal(summarizeFreshness({ checks: {} }, sources, 180000), '');
});
test('freshness summary failure and pending precedence never claims a failed lane checked', async () => {
    const { summarizeFreshness } = await import('../frontend/src/dashboardFreshnessSummary.js');
    const sources = ['eng_product', 'eng_tech'];
    const state = { pending: true, checks: { eng_product: { checkKind: 'forced', lastCheckedAtMs: 60000, coverage: 'complete' }, eng_tech: { failure: 'failed' } } };
    assert.equal(summarizeFreshness(state, sources, 120000), 'Could not check; showing previous data');
    state.checks.eng_tech.failure = 'rate_limited';
    assert.equal(summarizeFreshness(state, sources, 120000), 'Could not check; showing previous data');
    state.checks.eng_tech.failure = 'unverified';
    assert.equal(summarizeFreshness(state, sources, 120000), 'Cached data; check unavailable');
    state.checks.eng_tech.failure = null;
    assert.equal(summarizeFreshness(state, sources, 120000), 'Updates pending');
    state.running = true;
    assert.equal(summarizeFreshness(state, sources, 120000), 'Checked 1m ago; coverage unknown');
});
test('Scenario dirty, load, history, writeback, conflict and synchronous drag owners block current acceptance', async () => {
    const { readFreshnessScopeGuards, readFreshnessEnvironment } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const input = { showScenario: true, scenarioDraftMeta: {}, scenarioDragStateRef: { current: null }, loadEpochRef: {}, groupLoadVersionRef: {}, authResumePrincipalRef: {}, connectionRecoveryPrincipalRef: {}, acceptedBoardConfigRef: {}, connectionUnavailableRef: {}, alertCohortRef: {} };
    assert.equal(readFreshnessScopeGuards(input).blocked, false);
    for (const name of ['scenarioHasUnsavedChanges', 'scenarioEditMode', 'scenarioDragState']) { input[name] = true; assert.equal(readFreshnessScopeGuards(input).blocked, true, name); input[name] = false; }
    for (const name of ['saving', 'loadingHistory', 'loadingVersionNumber', 'loadingActiveDraft', 'rollingBackVersionNumber', 'reloadingFromJira', 'pendingHistoryAction', 'pendingActiveDraftReload', 'pendingReloadFromJira', 'writebackPreviewing', 'writebackChecking', 'conflict', 'staleDraft', 'pendingScopeChange']) {
        input.scenarioDraftMeta[name] = true; assert.equal(readFreshnessScopeGuards(input).blocked, true, name); input.scenarioDraftMeta[name] = false;
    }
    input.scenarioDragStateRef.current = {}; assert.equal(readFreshnessScopeGuards(input).blocked, true); input.scenarioDragStateRef.current = null;
    for (const name of ['groupSaving', 'epmConfigSaving', 'groupVisibilitySaving', 'workspaceConfigConflict', 'groupsConfigConflict']) { input[name] = true; assert.equal(readFreshnessScopeGuards(input).blocked, true, name); input[name] = false; }
    input.showGroupManage = true; assert.equal(readFreshnessEnvironment(input).ownerBusy, true); input.isGroupDraftDirty = true; assert.equal(readFreshnessScopeGuards(input).blocked, true);
    input.showGroupManage = false; input.isGroupDraftDirty = false; input.onboardingActive = true; assert.equal(readFreshnessEnvironment(input).ownerBusy, true);
});
test('Scenario adapter has only ENG scope acquisition and no anchor or follow-ups', async () => {
    const { createScenarioFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    let reads = 0, applies = 0, releases = 0;
    const input = { loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }), applyScopeSnapshot: () => { applies++; return { settled: Promise.resolve(), changedKeys: [], addedKeys: [], silentKeys: [], fetchedStories: [] }; } }, collectGroupRefresh: async () => { reads++; return { product: { status: 'ok' }, tech: { status: 'ok' }, release() { releases++; } }; } };
    const adapter = createScenarioFreshnessAdapter(() => input), job = { shouldApply: () => true, pendingSources: ['eng_product', 'eng_tech'] };
    assert.deepEqual(adapter.sources(), ['eng_product', 'eng_tech']); assert.equal(adapter.captureAnchor(), null);
    assert.deepEqual(await adapter.refreshAnchor(job), []); assert.deepEqual(await adapter.followUp(job), []);
    const checks = await adapter.refreshScope(job, null); assert.equal(checks.length, 2); assert.ok(checks.every(check => check.coverage === 'unknown'));
    assert.deepEqual([reads, applies, releases], [1, 1, 1]);
});

test('leaf status owns one foreground age timer, freezes running copy, and never acquires', () => {
    const bundle = esbuild.buildSync({ entryPoints: ['frontend/src/components/DashboardFreshnessStatus.jsx'], bundle: true, write: false, format: 'cjs', external: ['react'] }).outputFiles[0].text;
    const win = eventTarget(), doc = Object.assign(eventTarget(), { visibilityState: 'visible', focused: true, hasFocus: () => doc.focused });
    const slots = [], timeouts = new Map(); let cursor = 0, initial = true, clock = 60000, effect, cleanup, writes = 0, acquisitions = 0;
    const react = { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], value => { writes++; slots[i] = value; }]; }, useRef(value) { const i = cursor++; return slots[i] || (slots[i] = { current: value }); }, useEffect(fn) { if (initial) effect = fn; }, createElement: (type, props, ...children) => ({ type, props, children }) };
    const module = { exports: {} }, FakeDate = class extends Date { static now() { return clock; } };
    vm.runInNewContext(bundle, { module, exports: module.exports, require: () => react, document: doc, window: win, Date: FakeDate, setTimeout: fn => { const token = {}; timeouts.set(token, fn); return token; }, clearTimeout: token => timeouts.delete(token) });
    const freshness = { state: { checks: { eng_product: { lastCheckedAtMs: 0, checkKind: 'forced', coverage: 'unknown' } } }, request: () => acquisitions++, update: () => acquisitions++, ownersRef: { current: { readEnvironment: () => ({ contextKey: 'scope' }), resolveFreshnessSurface: () => 'catch_up', readAdapter: () => ({ sources: () => ['eng_product'] }) } } };
    const render = () => { cursor = 0; const result = module.exports.default({ freshness }); if (initial) cleanup = effect(); initial = false; assert.equal(result.props.className, 'dashboard-freshness-slot');
        assert.ok(result.children.filter(child => child?.props?.className?.includes('dashboard-freshness-size')).every(child => child.props['aria-hidden'] === 'true'));
        return { text: result.children.find(child => child?.props?.['data-dashboard-freshness-status'] === true)?.children[0] }; };
    assert.equal(render().text, 'Checked 1m ago; coverage unknown'); assert.equal(timeouts.size, 1);
    freshness.state.pending = true; assert.equal(render().text, 'Updates pending'); freshness.state.running = true; freshness.state.checks.eng_product.failure = 'failed'; assert.equal(render().text, 'Updates pending');
    freshness.state.running = false; assert.equal(render().text, 'Could not check; showing previous data'); freshness.state.pending = false; freshness.state.checks.eng_product.failure = null;
    clock += 61 * 60000; for (const [token, callback] of timeouts) { timeouts.delete(token); callback(); break; }
    assert.equal(render().text, 'Checked 1h ago; coverage unknown'); assert.equal(acquisitions, 0); assert.equal(timeouts.size, 1);
    doc.focused = false; win.dispatch('blur'); assert.equal(timeouts.size, 0); const before = writes; clock += 60000; assert.equal(writes, before);
    doc.visibilityState = 'hidden'; doc.focused = true; win.dispatch('focus'); assert.equal(timeouts.size, 0);
    doc.visibilityState = 'visible'; doc.dispatch('visibilitychange'); assert.equal(timeouts.size, 1);
    freshness.state = { checks: {} }; assert.equal(render().text, undefined, 'the reserved slot makes no initial freshness claim');
    cleanup(); assert.equal(timeouts.size, 0); assert.equal(win.count(), 0); assert.equal(doc.count(), 0);
    const source = fs.readFileSync('frontend/src/components/DashboardFreshnessStatus.jsx', 'utf8'); assert.doesNotMatch(source, /freshness\.(request|update|acceptChecks)|fetch|setInterval|aria-live|role="status"/);
});

test('Scenario scope collector rethrows terminal auth before any application or descriptor', async () => {
    const { createScenarioFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const error = Object.assign(new Error('Synthetic terminal authentication'), { status: 401 }); let applied=0;
    const input={loadEpochRef:{current:1},groupLoadVersionRef:{current:1},epicRefresh:{readState:()=>({loadedProductTasks:[],loadedTechTasks:[],epicDetails:{}}),applyScopeSnapshot:()=>applied++},collectGroupRefresh:async()=>{throw error;}};
    const adapter=createScenarioFreshnessAdapter(()=>input);await assert.rejects(adapter.refreshScope({shouldApply:()=>true,pendingSources:['eng_product','eng_tech']},null),error);assert.equal(applied,0);
});
test('freshness mounted composition guards all Settings composers through their owner and keeps Scenario realtime independent', () => {
    const app=fs.readFileSync('frontend/src/dashboard.jsx','utf8'),owner=fs.readFileSync('frontend/src/settings/useSharedConfigSave.js','utf8');
    for (const name of ['isProjectsDraftDirty','isPriorityWeightsDirty','isBoardConfigDirty','isCapacityDraftDirty','isIssueTypesDraftDirty','anyFieldConfigDirty','isAdminAccessDirty','isEpmConfigDirty','isGroupVisibilityDraftDirty','groupDraftSignature']) assert.ok(owner.includes(name),name);
    const composition=app.slice(app.indexOf('freshness.ownersRef.current = createDashboardFreshnessOwners('),app.indexOf('boardFreshnessRef.current.contextKey ='));
    for (const name of ['scenarioHasUnsavedChanges','scenarioEditMode','scenarioDraftMeta','scenarioState.scenarioDragStateRef','scenarioState.scenarioLoading','showGroupManage','isGroupDraftDirty','groupSaving','epmConfigSaving','groupVisibilitySaving','workspaceConfigConflict','groupsConfigConflict','onboarding.run','onboarding.pending']) assert.ok(composition.includes(name),name);
    const realtime=fs.readFileSync('frontend/src/scenario/useScenarioRealtime.js','utf8'),drag=fs.readFileSync('frontend/src/scenario/useScenarioDrag.js','utf8');
    assert.doesNotMatch(realtime+drag,/hasFocus|visibilityState|freshness\./);assert.ok(drag.includes('scenarioDragStateRef.current = dragState;'));
    assert.ok(app.includes('<DashboardFreshnessStatus freshness={freshness} />'));assert.doesNotMatch(app,/longAbsenceRefreshRef|AUTH_LONG_ABSENCE_EVENT/);
});

for (const mode of ['throw', 'empty', 'missing']) test(`current scope ${mode} settles missing sources without a retry loop`, async () => {
    const h = harness({ sources: ['eng_product', 'eng_tech'], refreshScope: async () => {
        if (mode === 'throw') throw new Error('source unavailable');
        return mode === 'empty' ? [] : [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }];
    } });
    await request(h);
    for (let i = 0; i < 4; i++) await h.controller.update();
    assert.equal(h.calls.scope.length, 1);
    assert.equal(h.controller.getState().failure, 'failed');
    if (mode === 'missing') assert.equal(h.controller.getState().checks.eng_product.failure, null);
});
test('anchor exception permits scope discovery and follow-up exception preserves accepted sources', async () => {
    const h = harness({ refreshAnchor: async () => { throw new Error('anchor unavailable'); }, followUp: async () => { throw new Error('secondary unavailable'); } });
    await request(h); await h.controller.update();
    assert.equal(h.calls.scope.length, 1); assert.equal(h.calls.follow.length, 1);
    assert.equal(h.controller.getState().pending, false); assert.equal(h.controller.getState().failure, null);
});
test('semantic authentication with status zero is never a source failure', async () => {
    const error = Object.assign(new Error('terminal auth'), { name: 'AuthenticationRequiredError', status: 0 });
    const h = harness({ refreshScope: async () => { throw error; } });
    await assert.rejects(request(h), error); await h.controller.update();
    assert.equal(h.calls.scope.length, 1); assert.equal(h.controller.getState().failure, null);
});
test('retired thrown acquisition preserves resumable intent', async () => {
    let h, attempts = 0;
    h = harness({ refreshScope: async () => {
        if (++attempts === 1) { h.env.focused = false; throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
        return [{ source: 'eng_product', status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 }];
    } });
    await request(h); assert.equal(h.controller.getState().failure, null);
    h.env.focused = true; await h.controller.update(); assert.equal(attempts, 2);
});
test('blur during follow-up preserves the reserved rate-limited retry subset', async () => {
    const gate = deferred();
    const h = harness({ sources: ['eng_product', 'eng_tech'], refreshScope: async job => job.pendingSources.map(source => ({ source, status: source === 'eng_product' ? 'ok' : 'rate_limited', checkKind: 'forced', requestStartedAtMs: 2000, retryAtMs: 5000 })), followUp: () => gate.promise });
    const first = request(h); await flush(); assert.equal(h.deadlines.size, 1);
    h.env.focused = false; h.controller.update(); h.env.focused = true; const resume = h.controller.update();
    gate.resolve([]); await first; await resume;
    assert.equal(h.calls.scope.length, 2); assert.deepEqual(h.calls.scope[1].pendingSources, ['eng_tech']); assert.equal(h.deadlines.size, 0);
});
test('retry deadline during follow-up queues one scope-only drain', async () => {
    const gate = deferred();
    const h = harness({ sources: ['eng_product', 'eng_tech'], refreshScope: async job => job.pendingSources.map(source => ({ source, status: source === 'eng_product' ? 'ok' : 'rate_limited', checkKind: 'forced', requestStartedAtMs: 2000, retryAtMs: 5000 })), followUp: () => gate.promise });
    const first = request(h); await flush(); const [handle, timer] = [...h.deadlines][0]; h.deadlines.delete(handle); h.advance(5000); timer.callback();
    assert.equal(h.calls.scope.length, 1); gate.resolve([]); await first;
    assert.equal(h.calls.scope.length, 2); assert.deepEqual(h.calls.scope[1].pendingSources, ['eng_tech']); assert.equal(h.calls.anchor.length, 1);
});
test('mounted listener claims one retained shell intent without new bootstrap work', async () => {
    const win = eventTarget(), doc = eventTarget(), calls = [];
    const slot = '__JEP_PENDING_LONG_RETURN__';
    win[slot] = { unfocusedMs: LONG_ABSENCE_MS + 1, absenceStartedAtMs: 10, observedAtMs: LONG_ABSENCE_MS + 11 };
    const controller = { request: value => calls.push(value), update: () => {} };
    const first = installFreshnessListeners(win, doc, controller);
    assert.equal(calls.length, 1); assert.equal(calls[0].absenceStartedAtMs, 10); await flush(); assert.equal(win[slot], undefined);
    first.dispose(); const second = installFreshnessListeners(win, doc, controller); assert.equal(calls.length, 1); second.dispose();
});
test('listener consumes rejected auth requests and update promises', async () => {
    const win = eventTarget(), doc = eventTarget(); let calls = 0;
    const reject = () => { calls++; return Promise.reject(Object.assign(new Error('terminal'), { name: 'AuthenticationRequiredError' })); };
    const listener = installFreshnessListeners(win, doc, { request: reject, update: reject });
    win.dispatch('focus'); win.dispatch(AUTH_LONG_ABSENCE_EVENT, { unfocusedMs: LONG_ABSENCE_MS + 1 }); win.dispatch('pageshow', {}, { persisted: true });
    await flush(); assert.equal(calls, 3); listener.dispose();
});

test('ignored anchor lanes with discarded shape do not crash broader discovery', async () => {
    const { createCatchUpFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const input = { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 },
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }),
            refreshEpic: async () => ({ result: 'discarded', lanes: { product: { status: 'ignored' }, tech: { status: 'ignored' } } }) } };
    const adapter = createCatchUpFreshnessAdapter(() => input);
    const signal = new AbortController(); const job = { signal: signal.signal, anchorSignal: signal.signal, shouldApply: () => true };
    const result = await adapter.refreshAnchor(job, { epicKey: 'EPIC-1' });
    assert.deepEqual(result.map(item => item.status), ['ignored', 'ignored']);
});
test('Planning retirement after primary release wakes deferred values without duplicating successful follow-ups', async () => {
    const { createPlanningFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    let resumes = 0;
    const input = { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, planningAutomaticReadRef: { current: 0 },
        planningReview: { resumeDeferredRead: async () => { resumes++; } },
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }), applyScopeSnapshot: () => null }, collectGroupRefresh: async () => ({ release() {} }) };
    const adapter = createPlanningFreshnessAdapter(() => input), abort = new AbortController();
    const job = { signal: abort.signal, shouldApply: () => !abort.signal.aborted, pendingSources: ['eng_product', 'eng_tech'] };
    await adapter.refreshAnchor(job, null); await adapter.refreshScope(job, null);
    assert.equal(resumes, 0); assert.equal(input.planningAutomaticReadRef.current, 0);
    abort.abort(); await flush(); assert.equal(resumes, 0);
    assert.equal(adapter.hasDeferredReads(job.contextKey), true);
    await adapter.resumeDeferredReads({ ...job, signal: new AbortController().signal, shouldApply: () => true }); assert.equal(resumes, 1);
});

test('owner dependency interruption resumes once without an external update or hot ignored loop', async () => {
    let attempts = 0;
    const h = harness({ refreshScope: async job => {
        attempts++; job.resumeAfterInterruption();
        return [{ source: 'eng_product', status: 'ignored' }];
    } });
    await request(h);
    assert.equal(attempts, 2); assert.equal(h.controller.getState().pending, true); assert.equal(h.controller.getState().failure, null);
});

test('Planning deferred row recovery wakes only on eligible foreground update', async () => {
    const h = harness(); await request(h);
    // The real adapter has owner-specific recovery; controller supplies lifecycle eligibility.
    let resumes = 0;
    let deferred = true;
    const adapter = { sources: () => [], hasDeferredReads: () => deferred, resumeDeferredReads: async job => { assert.equal(job.shouldApply(), true); assert.doesNotThrow(() => job.resumeAfterInterruption()); deferred = false; resumes++; } };
    const c = createDashboardFreshnessController({ readEnvironment: () => h.env, readAdapter: () => adapter });
    h.env.focused = false; await c.update(); assert.equal(resumes, 0);
    h.env.focused = true; h.env.blocked = true; await c.update(); assert.equal(resumes, 0);
    h.env.blocked = false; await c.update(); assert.equal(resumes, 1);
});

test('secondary failure preserves an accepted observation that predates the absence', async () => {
    const h = harness({ descriptor: { requestStartedAtMs: 500 }, followUp: async () => { throw new Error('secondary unavailable'); } });
    await request(h);
    assert.equal(h.controller.getState().checks.eng_product.checkKind, 'forced');
    assert.equal(h.controller.getState().checks.eng_product.failure, null);
    assert.equal(h.controller.getState().pending, true);
    await h.controller.update(); assert.equal(h.calls.scope.length, 2);
});

test('deferred Planning recovery is an active lifecycle-fenced drain and resumes after blur', async () => {
    const h = harness(); let queued = true, commits = 0, reads = 0; const gate = deferred();
    const adapter = { sources: () => [], hasDeferredReads: () => queued,
        async resumeDeferredReads(job) { reads++; if (reads === 1) await gate.promise; if (job.shouldApply()) { queued = false; commits++; } } };
    const c = createDashboardFreshnessController({ readEnvironment: () => h.env, readAdapter: () => adapter });
    const first = c.update(); await flush(); assert.equal(c.getState().running, true);
    h.env.focused = false; c.update(); gate.resolve(); await first; assert.equal(commits, 0); assert.equal(queued, true);
    h.env.focused = true; await c.update(); assert.equal(reads, 2); assert.equal(commits, 1);
});
for (const failure of ['throw', 'empty']) test(`Planning ${failure} primary cleans its hold and queues only missing-row recovery`, async () => {
    const { createPlanningFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    let resumes = 0, removals = 0;
    const input = { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, planningAutomaticReadRef: { current: 0 },
        planningReview: { resumeDeferredRead: async options => { assert.equal(options.shouldApply(), true); resumes++; } },
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }), applyScopeSnapshot: () => { if (failure === 'throw') throw new Error('acceptance unavailable'); return null; } },
        collectGroupRefresh: async () => ({ release() {} }) };
    const adapter = createPlanningFreshnessAdapter(() => input), abort = new AbortController();
    const remove = abort.signal.removeEventListener.bind(abort.signal); abort.signal.removeEventListener = (...args) => { removals++; remove(...args); };
    const job = { contextKey: 'context', signal: abort.signal, shouldApply: () => true, pendingSources: ['eng_product', 'eng_tech'] };
    await adapter.refreshAnchor(job, null);
    if (failure === 'throw') await assert.rejects(adapter.refreshScope(job, null), /acceptance unavailable/); else await adapter.refreshScope(job, null);
    assert.equal(input.planningAutomaticReadRef.current, 0); assert.equal(removals, 1); assert.equal(resumes, 0);
    assert.equal(adapter.hasDeferredReads('context'), true); await adapter.resumeDeferredReads(job); assert.equal(resumes, 1);
    abort.abort(); assert.equal(adapter.hasDeferredReads('context'), false);
});
test('deferred Planning recovery drops a retired context instead of reading the replacement scope', async () => {
    const { createPlanningFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    let resumes = 0;
    const input = { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, planningAutomaticReadRef: { current: 0 },
        planningReview: { resumeDeferredRead: async () => resumes++ }, epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [] }) } };
    const adapter = createPlanningFreshnessAdapter(() => input), abort = new AbortController();
    await adapter.refreshAnchor({ contextKey: 'old', signal: abort.signal, shouldApply: () => !abort.signal.aborted }, null); abort.abort();
    assert.equal(adapter.hasDeferredReads('new'), false); assert.equal(resumes, 0);
});

test('StrictMode delayed-mount handover retains return intent through setup cleanup setup', async () => {
    const h = hookHarness({ environment: { bootstrapReady: false }, retainedLongReturn: { unfocusedMs: LONG_ABSENCE_MS + 1, absenceStartedAtMs: 10, observedAtMs: LONG_ABSENCE_MS + 11 } });
    h.strictRemount(); await flush(); assert.equal(h.calls.length, 0);
    h.env.bootstrapReady = true; h.render(); await flush();
    h.render();
    assert.equal(h.calls.length, 1); assert.equal(h.result().state.pending, false);
    assert.equal(h.win.__JEP_PENDING_LONG_RETURN__, undefined); h.unmount();
});

test('retained handover coalesces reentrant dispatch and terminal auth removes the slot', async () => {
    const win = eventTarget(), doc = eventTarget(); let requests = 0, terminals = 0;
    const slot = '__JEP_PENDING_LONG_RETURN__', detail = { unfocusedMs: LONG_ABSENCE_MS + 1, absenceStartedAtMs: 10 };
    win[slot] = detail;
    const h = harness({ environment: { bootstrapReady: false } });
    const listener = installFreshnessListeners(win, doc, { request: value => { requests++; return h.controller.request(value); }, update: h.controller.update, onTerminalAuth: () => { terminals++; h.env.terminalAuth = true; } });
    win.dispatch(AUTH_LONG_ABSENCE_EVENT, detail); await flush(); assert.equal(requests, 2); assert.equal(h.calls.scope.length, 0);
    win[slot] = detail; win.dispatch(AUTH_REQUIRED_EVENT); await flush(); assert.equal(terminals, 1); assert.equal(win[slot], undefined);
    h.env.bootstrapReady = true; await h.controller.update(); assert.equal(h.calls.scope.length, 0); listener.dispose();
});

test('a later independent return starts a fresh intent after a retried return completes', async () => {
    let n = 0;
    const h = harness({ refreshScope: async job => { n++; return job.pendingSources.map(source => ({ source, status: n === 1 || n === 3 ? 'rate_limited' : 'ok', checkKind: 'forced', requestStartedAtMs: 2000, retryAtMs: n === 1 ? 5000 : 801000 })); } });
    await request(h); assert.equal(h.deadlines.size, 1);
    const [handle, timer] = [...h.deadlines][0]; h.deadlines.delete(handle); h.advance(5000); timer.callback(); await h.controller.update();
    assert.equal(h.calls.scope.length, 2); assert.equal(h.calls.anchor.length, 1); assert.equal(h.controller.getState().pending, false);
    h.advance(800000); await h.controller.request({ reason: 'long_return', absenceStartedAtMs: 700000 });
    assert.equal(h.calls.anchor.length, 2, 'the independent return runs the anchor-first stage'); assert.equal(h.deadlines.size, 1, 'the independent return owns its own retry');
});
test('a non-settling adapter promise does not block later drains after retirement', async () => {
    const never = new Promise(() => {}); let n = 0;
    const h = harness({ refreshScope: async job => n++ === 0 ? never : job.pendingSources.map(source => ({ source, status: 'ok', checkKind: 'forced', requestStartedAtMs: 2000 })) });
    void request(h); await flush(); h.env.focused = false; h.controller.update();
    h.env.focused = true; await h.controller.update();
    assert.equal(h.calls.scope.length, 2); assert.equal(h.controller.getState().pending, false); assert.equal(h.controller.getState().running, false);
});

function planningDeferredInput(resumes) {
    return { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 }, planningAutomaticReadRef: { current: 0 },
        planningReview: { resumeDeferredRead: async () => { resumes.count++; } },
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }), applyScopeSnapshot: () => null }, collectGroupRefresh: async () => ({ release() {} }) };
}
test('Planning deferred reads are shared by adapters created from the same stable ref', async () => {
    const { createPlanningFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const resumes = { count: 0 }, input = planningDeferredInput(resumes), stable = {};
    const first = createPlanningFreshnessAdapter(() => input, stable), second = createPlanningFreshnessAdapter(() => input, stable);
    const abort = new AbortController();
    await first.refreshAnchor({ contextKey: 'context', signal: abort.signal, shouldApply: () => !abort.signal.aborted }, null); abort.abort();
    assert.equal(second.hasDeferredReads('context'), true);
    await second.resumeDeferredReads({ contextKey: 'context', signal: new AbortController().signal, shouldApply: () => true }); assert.equal(resumes.count, 1);
    assert.equal(first.hasDeferredReads('context'), false);
});
test('dashboard owners rebuilt each render keep Planning deferred reads', async () => {
    const { createDashboardFreshnessOwners } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const resumes = { count: 0 }, input = planningDeferredInput(resumes), freshness = { ownersRef: { current: null }, automaticRefreshRef: {}, acceptChecks() {} };
    const render = () => { const owners = createDashboardFreshnessOwners(freshness, input); freshness.ownersRef.current = owners; return owners; };
    const abort = new AbortController();
    await render().readAdapter('planning').refreshAnchor({ contextKey: 'context', signal: abort.signal, shouldApply: () => !abort.signal.aborted }, null); abort.abort();
    assert.equal(render().readAdapter('planning').hasDeferredReads('context'), true);
});

for (const mode of ['scope-before-apply', 'null-acceptance', 'scope-after-settle']) test(`Catch Up scope refusal (${mode}) reports pending sources as ignored, not failed`, async () => {
    const { createCatchUpFreshnessAdapter } = await import('../frontend/src/dashboardFreshnessAdapters.js');
    const input = { activeGroupId: 'synthetic', selectedSprint: 1, loadEpochRef: { current: 1 }, groupLoadVersionRef: { current: 1 },
        epicRefresh: { readState: () => ({ loadedProductTasks: [], loadedTechTasks: [], epicDetails: {} }),
            applyScopeSnapshot: () => mode === 'null-acceptance' ? null : { settled: (async () => { if (mode === 'scope-after-settle') input.loadEpochRef.current = 2; })(), changedKeys: [], addedKeys: [], silentKeys: [], fetchedStories: [] } },
        collectGroupRefresh: async () => { if (mode === 'scope-before-apply') input.loadEpochRef.current = 2; return { release() {} }; } };
    const adapter = createCatchUpFreshnessAdapter(() => input);
    const result = await adapter.refreshScope({ shouldApply: () => true, pendingSources: ['eng_product', 'eng_tech'] }, null);
    assert.deepEqual(result, [{ source: 'eng_product', status: 'ignored' }, { source: 'eng_tech', status: 'ignored' }]);
});
