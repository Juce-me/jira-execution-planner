const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const MODULE_PATH = path.join(
    __dirname,
    '..',
    'frontend',
    'src',
    'api',
    'authRecoveryCoordinator.js',
);
const EXPECTED_LOCK_NAME = 'jira-dashboard-auth-recovery-v1';
const EXPECTED_LEASE_KEY = 'jira_dashboard_auth_recovery_lease_v1';
const EXPECTED_SUCCESS_KEY = 'jira_dashboard_auth_recovery_success_v1';
const EXPECTED_TAB_ATTEMPT_KEY = 'jira_dashboard_auth_recovery_attempt_v1';
const EXPECTED_CONSUMED_KEY = 'jira_dashboard_auth_recovery_consumed_v1';
const EXPECTED_LEASE_MS = 5 * 60 * 1000;
const INVALID_NOW_VALUES = [NaN, Infinity, -Infinity, -1, '1000'];

function loadModule() {
    const source = esbuild.buildSync({
        entryPoints: [MODULE_PATH],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'browser',
    }).outputFiles[0].text;
    const sandbox = { module: { exports: {} }, exports: {}, console };
    vm.runInContext(source, vm.createContext(sandbox));
    return sandbox.module.exports;
}

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        peek(key) { return values.has(key) ? values.get(key) : null; },
    };
}

function createObservedStorage(initial = {}) {
    const storage = createStorage(initial);
    const operations = [];
    const getItem = storage.getItem.bind(storage);
    const setItem = storage.setItem.bind(storage);
    const removeItem = storage.removeItem.bind(storage);
    storage.getItem = key => {
        operations.push(['getItem', key]);
        return getItem(key);
    };
    storage.setItem = (key, value) => {
        operations.push(['setItem', key, String(value)]);
        setItem(key, value);
    };
    storage.removeItem = key => {
        operations.push(['removeItem', key]);
        removeItem(key);
    };
    return { storage, operations };
}

function createExplodingStorage() {
    const explode = () => { throw new Error('storage_must_not_be_used'); };
    return { getItem: explode, setItem: explode, removeItem: explode };
}

function createQueuedExclusiveLockManager() {
    let tail = Promise.resolve();
    let activeCallbacks = 0;
    const manager = {
        maxConcurrentCallbacks: 0,
        request(name, options, callback) {
            assert.equal(name, EXPECTED_LOCK_NAME);
            assert.deepEqual(json(options), { mode: 'exclusive' });
            const run = tail.then(async () => {
                activeCallbacks += 1;
                manager.maxConcurrentCallbacks = Math.max(
                    manager.maxConcurrentCallbacks,
                    activeCallbacks,
                );
                try {
                    return await callback();
                } finally {
                    activeCallbacks -= 1;
                }
            });
            tail = run.catch(() => undefined);
            return run;
        },
    };
    return manager;
}

function createBlockedExclusiveLockManager() {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    return {
        release,
        request(name, options, callback) {
            assert.equal(name, EXPECTED_LOCK_NAME);
            assert.deepEqual(json(options), { mode: 'exclusive' });
            return blocked.then(callback);
        },
    };
}

function json(value) {
    return JSON.parse(JSON.stringify(value));
}

const api = loadModule();

test('simultaneous claims serialize to one leader and one follower', async () => {
    const shared = createStorage();
    const tabA = createStorage();
    const tabB = createStorage();
    const locks = createQueuedExclusiveLockManager();
    const [first, second] = await Promise.all([
        api.claimAuthRecovery(shared, tabA, {
            lockManager: locks,
            clock: () => 1_000,
            newId: () => 'attempt-a',
        }),
        api.claimAuthRecovery(shared, tabB, {
            lockManager: locks,
            clock: () => 1_000,
            newId: () => 'attempt-b',
        }),
    ]);

    assert.deepEqual([first.role, second.role].sort(), ['follower', 'leader']);
    assert.equal(first.attemptId, second.attemptId);
    assert.equal(locks.maxConcurrentCallbacks, 1);
});

test('live leases are adopted and expired leases are atomically replaced', async () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_LEASE_KEY]: JSON.stringify({ attemptId: 'attempt-old', startedAt: 1_000 }),
    });
    const locks = createQueuedExclusiveLockManager();

    const follower = await api.claimAuthRecovery(shared, createStorage(), {
        lockManager: locks,
        clock: () => 1_000 + EXPECTED_LEASE_MS,
        newId: () => 'must-not-run',
    });
    assert.equal(follower.role, 'follower');
    assert.equal(follower.attemptId, 'attempt-old');

    const replacement = await api.claimAuthRecovery(shared, createStorage(), {
        lockManager: locks,
        clock: () => 1_001 + EXPECTED_LEASE_MS,
        newId: () => 'attempt-new',
    });
    assert.equal(replacement.role, 'leader');
    assert.equal(replacement.attemptId, 'attempt-new');
    assert.deepEqual(JSON.parse(shared.getItem(api.AUTH_RECOVERY_LEASE_KEY)), {
        attemptId: 'attempt-new',
        startedAt: 1_001 + EXPECTED_LEASE_MS,
    });
});

test('claim samples time after the exclusive lock is granted', async () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_LEASE_KEY]: JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 }),
    });
    const tab = createStorage();
    const locks = createBlockedExclusiveLockManager();
    let now = 900;
    const pending = api.claimAuthRecovery(shared, tab, {
        lockManager: locks,
        clock: () => now,
        newId: () => 'attempt-b',
    });

    now = 1_100;
    locks.release();
    const claim = await pending;

    assert.equal(claim.role, 'follower');
    assert.equal(claim.attemptId, 'attempt-a');
});

test('invalid claim clocks return solo before storage or id generation', async () => {
    for (const now of INVALID_NOW_VALUES) {
        const shared = createObservedStorage();
        const tab = createObservedStorage();
        let clockCalls = 0;
        let idCalls = 0;
        const claim = await api.claimAuthRecovery(shared.storage, tab.storage, {
            lockManager: createQueuedExclusiveLockManager(),
            clock: () => {
                clockCalls += 1;
                return now;
            },
            newId: () => {
                idCalls += 1;
                return 'attempt-a';
            },
        });

        assert.deepEqual(json(claim), { role: 'solo', attemptId: '' }, String(now));
        assert.equal(clockCalls, 1, String(now));
        assert.equal(idCalls, 0, String(now));
        assert.deepEqual(shared.operations, [], String(now));
        assert.deepEqual(tab.operations, [], String(now));
    }
});

test('invalid completion clocks preserve all recovery records before storage access', async () => {
    const leaseRaw = JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 });
    const successRaw = JSON.stringify({ attemptId: 'attempt-prior', completedAt: 900 });
    const tabAttemptRaw = JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 });
    for (const now of INVALID_NOW_VALUES) {
        const shared = createObservedStorage({
            [EXPECTED_LEASE_KEY]: leaseRaw,
            [EXPECTED_SUCCESS_KEY]: successRaw,
        });
        const tab = createObservedStorage({
            [EXPECTED_TAB_ATTEMPT_KEY]: tabAttemptRaw,
            [EXPECTED_CONSUMED_KEY]: 'attempt-prior',
        });
        const completion = await api.completeAuthRecovery(shared.storage, tab.storage, {
            lockManager: createQueuedExclusiveLockManager(),
            clock: () => now,
        });

        assert.equal(completion, null, String(now));
        assert.deepEqual(shared.operations, [], String(now));
        assert.deepEqual(tab.operations, [], String(now));
        assert.equal(shared.storage.peek(EXPECTED_LEASE_KEY), leaseRaw, String(now));
        assert.equal(shared.storage.peek(EXPECTED_SUCCESS_KEY), successRaw, String(now));
        assert.equal(tab.storage.peek(EXPECTED_TAB_ATTEMPT_KEY), tabAttemptRaw, String(now));
        assert.equal(tab.storage.peek(EXPECTED_CONSUMED_KEY), 'attempt-prior', String(now));
    }
});

test('completion eligibility is rechecked inside the lock before any storage access', async () => {
    const leaseRaw = JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 });
    const successRaw = JSON.stringify({ attemptId: 'attempt-prior', completedAt: 900 });
    const tabAttemptRaw = JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 });
    const ineligibleCases = [
        ['false', () => false],
        ['null', () => null],
        ['truthy non-true', () => 'true'],
        ['throwing', () => { throw new Error('document_became_ineligible'); }],
    ];

    for (const [label, eligibility] of ineligibleCases) {
        const shared = createObservedStorage({
            [EXPECTED_LEASE_KEY]: leaseRaw,
            [EXPECTED_SUCCESS_KEY]: successRaw,
        });
        const tab = createObservedStorage({
            [EXPECTED_TAB_ATTEMPT_KEY]: tabAttemptRaw,
            [EXPECTED_CONSUMED_KEY]: 'attempt-prior',
        });
        let insideExclusiveLock = false;
        let eligibilityCalls = 0;
        const lockManager = {
            request(name, options, callback) {
                assert.equal(name, EXPECTED_LOCK_NAME);
                assert.deepEqual(json(options), { mode: 'exclusive' });
                insideExclusiveLock = true;
                try {
                    return Promise.resolve(callback());
                } finally {
                    insideExclusiveLock = false;
                }
            },
        };

        const completion = await api.completeAuthRecovery(shared.storage, tab.storage, {
            lockManager,
            clock: () => 2_000,
            canComplete: () => {
                eligibilityCalls += 1;
                assert.equal(insideExclusiveLock, true, label);
                return eligibility();
            },
        });

        assert.equal(completion, null, label);
        assert.equal(eligibilityCalls, 1, label);
        assert.deepEqual(shared.operations, [], label);
        assert.deepEqual(tab.operations, [], label);
        assert.equal(shared.storage.peek(EXPECTED_LEASE_KEY), leaseRaw, label);
        assert.equal(shared.storage.peek(EXPECTED_SUCCESS_KEY), successRaw, label);
        assert.equal(tab.storage.peek(EXPECTED_TAB_ATTEMPT_KEY), tabAttemptRaw, label);
        assert.equal(tab.storage.peek(EXPECTED_CONSUMED_KEY), 'attempt-prior', label);
    }
});

test('a queued replacement wins before late completion without being cleared or overwritten', async () => {
    const shared = createStorage();
    const oldLeaderTab = createStorage();
    const replacementTab = createStorage();
    const locks = createQueuedExclusiveLockManager();
    await api.claimAuthRecovery(shared, oldLeaderTab, {
        lockManager: locks,
        clock: () => 1_000,
        newId: () => 'attempt-old',
    });
    const expiredAt = 1_001 + EXPECTED_LEASE_MS;

    const [replacement, lateCompletion] = await Promise.all([
        api.claimAuthRecovery(shared, replacementTab, {
            lockManager: locks,
            clock: () => expiredAt,
            newId: () => 'attempt-new',
        }),
        api.completeAuthRecovery(shared, oldLeaderTab, {
            lockManager: locks,
            clock: () => expiredAt,
        }),
    ]);

    assert.equal(replacement.role, 'leader');
    assert.equal(lateCompletion, null);
    assert.deepEqual(JSON.parse(shared.getItem(api.AUTH_RECOVERY_LEASE_KEY)), {
        attemptId: 'attempt-new',
        startedAt: expiredAt,
    });
    assert.equal(shared.getItem(api.AUTH_RECOVERY_SUCCESS_KEY), null);
});

test('expired completion scheduled first publishes nothing and the queued claim becomes leader', async () => {
    const shared = createStorage();
    const oldLeaderTab = createStorage();
    const replacementTab = createStorage();
    const locks = createQueuedExclusiveLockManager();
    await api.claimAuthRecovery(shared, oldLeaderTab, {
        lockManager: locks,
        clock: () => 1_000,
        newId: () => 'attempt-old',
    });
    const expiredAt = 1_001 + EXPECTED_LEASE_MS;

    const [lateCompletion, replacement] = await Promise.all([
        api.completeAuthRecovery(shared, oldLeaderTab, {
            lockManager: locks,
            clock: () => expiredAt,
        }),
        api.claimAuthRecovery(shared, replacementTab, {
            lockManager: locks,
            clock: () => expiredAt,
            newId: () => 'attempt-new',
        }),
    ]);

    assert.equal(lateCompletion, null);
    assert.equal(replacement.role, 'leader');
    assert.equal(replacement.attemptId, 'attempt-new');
    assert.equal(shared.getItem(api.AUTH_RECOVERY_SUCCESS_KEY), null);
});

test('authenticated completion is consumable exactly once in each follower tab', async () => {
    const shared = createStorage();
    const leaderTab = createStorage();
    const followerA = createStorage();
    const followerB = createStorage();
    const locks = createQueuedExclusiveLockManager();
    const claim = await api.claimAuthRecovery(shared, leaderTab, {
        lockManager: locks,
        clock: () => 1_000,
        newId: () => 'attempt-a',
    });
    assert.equal(claim.role, 'leader');
    assert.deepEqual(json(await api.completeAuthRecovery(shared, leaderTab, {
        lockManager: locks,
        clock: () => 2_000,
    })), {
        attemptId: 'attempt-a',
        completedAt: 2_000,
    });

    assert.equal(api.consumeAuthRecoverySuccess(shared, followerA, {
        now: 2_001,
        requestStartedAt: 1_500,
    })?.attemptId, 'attempt-a');
    assert.equal(api.consumeAuthRecoverySuccess(shared, followerA, {
        now: 2_002,
        requestStartedAt: 1_500,
    }), null);
    assert.equal(api.consumeAuthRecoverySuccess(shared, followerB, {
        now: 2_002,
        requestStartedAt: 1_500,
    })?.attemptId, 'attempt-a');
});

test('a pre-subscribed success resumes when requestStartedAt precedes completion', async () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_SUCCESS_KEY]: JSON.stringify({ attemptId: 'attempt-a', completedAt: 2_000 }),
    });
    const tab = createStorage();
    const claim = await api.claimAuthRecovery(shared, tab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 3_000,
        requestStartedAt: 1_500,
        newId: () => 'must-not-run',
    });

    assert.equal(claim.role, 'resume');
    assert.equal(claim.attemptId, 'attempt-a');
    assert.equal(tab.getItem(EXPECTED_CONSUMED_KEY), 'attempt-a');
});

test('a success older than the failing request is ignored', async () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_SUCCESS_KEY]: JSON.stringify({ attemptId: 'attempt-old', completedAt: 2_000 }),
    });
    const tab = createStorage();

    assert.equal(api.consumeAuthRecoverySuccess(shared, tab, {
        now: 3_000,
        requestStartedAt: 2_001,
    }), null);
    const claim = await api.claimAuthRecovery(shared, tab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 3_000,
        requestStartedAt: 2_001,
        newId: () => 'attempt-new',
    });
    assert.equal(claim.role, 'leader');
    assert.equal(claim.attemptId, 'attempt-new');
});

test('read boundaries reject invalid attempts and request timestamps without mutation', () => {
    const invalidAttempts = [
        { attemptId: '', completedAt: 2_000 },
        { attemptId: 'x'.repeat(129), completedAt: 2_000 },
        { attemptId: 'attempt-a', completedAt: -1 },
        { attemptId: 'attempt-a', completedAt: 2_002 },
    ];
    for (const value of invalidAttempts) {
        const raw = JSON.stringify(value);
        const shared = createStorage({ [EXPECTED_SUCCESS_KEY]: raw });
        assert.equal(api.readAuthRecoverySuccess(shared, 2_001), null);
        assert.equal(shared.getItem(EXPECTED_SUCCESS_KEY), raw);
    }

    const shared = createStorage({
        [EXPECTED_SUCCESS_KEY]: JSON.stringify({ attemptId: 'attempt-a', completedAt: 2_000 }),
    });
    for (const requestStartedAt of [undefined, NaN, -1, 2_002]) {
        const tab = createStorage();
        assert.equal(api.consumeAuthRecoverySuccess(shared, tab, {
            now: 2_001,
            requestStartedAt,
        }), null);
        assert.equal(tab.getItem(EXPECTED_CONSUMED_KEY), null);
    }
});

test('public reads reject invalid now values before touching shared storage', () => {
    const leaseRaw = JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 });
    const successRaw = JSON.stringify({ attemptId: 'attempt-a', completedAt: 1_500 });
    for (const now of INVALID_NOW_VALUES) {
        const shared = createObservedStorage({
            [EXPECTED_LEASE_KEY]: leaseRaw,
            [EXPECTED_SUCCESS_KEY]: successRaw,
        });

        assert.equal(api.readLiveAuthRecoveryLease(shared.storage, now), null, String(now));
        assert.equal(api.readAuthRecoverySuccess(shared.storage, now), null, String(now));
        assert.deepEqual(shared.operations, [], String(now));
        assert.equal(shared.storage.peek(EXPECTED_LEASE_KEY), leaseRaw, String(now));
        assert.equal(shared.storage.peek(EXPECTED_SUCCESS_KEY), successRaw, String(now));
    }
});

test('public consumption rejects invalid now values without reading or writing markers', () => {
    const successRaw = JSON.stringify({ attemptId: 'attempt-a', completedAt: 1_500 });
    for (const now of INVALID_NOW_VALUES) {
        const shared = createObservedStorage({ [EXPECTED_SUCCESS_KEY]: successRaw });
        const tab = createObservedStorage();

        assert.equal(api.consumeAuthRecoverySuccess(shared.storage, tab.storage, {
            now,
            requestStartedAt: 1_000,
        }), null, String(now));
        assert.deepEqual(shared.operations, [], String(now));
        assert.deepEqual(tab.operations, [], String(now));
        assert.equal(shared.storage.peek(EXPECTED_SUCCESS_KEY), successRaw, String(now));
        assert.equal(tab.storage.peek(EXPECTED_CONSUMED_KEY), null, String(now));
    }
});

test('unlocked readers ignore stale records without deleting a newer concurrent value', () => {
    const cases = [
        {
            key: api.AUTH_RECOVERY_LEASE_KEY,
            stale: '{malformed',
            newer: JSON.stringify({ attemptId: 'lease-new', startedAt: 2_000 }),
            read: storage => api.readLiveAuthRecoveryLease(storage, 2_001),
        },
        {
            key: api.AUTH_RECOVERY_SUCCESS_KEY,
            stale: JSON.stringify({ attemptId: 'success-old', completedAt: 1_000 }),
            newer: JSON.stringify({ attemptId: 'success-new', completedAt: 400_001 }),
            read: storage => api.readAuthRecoverySuccess(storage, 400_002),
        },
    ];

    for (const scenario of cases) {
        const storage = createStorage({ [scenario.key]: scenario.stale });
        const originalGet = storage.getItem;
        let swapped = false;
        storage.getItem = key => {
            const result = originalGet.call(storage, key);
            if (!swapped) {
                swapped = true;
                storage.setItem(key, scenario.newer);
            }
            return result;
        };
        assert.equal(scenario.read(storage), null);
        assert.equal(storage.peek(scenario.key), scenario.newer);
    }
});

test('the next locked claim overwrites malformed or expired shared records', async () => {
    const now = 1_001 + EXPECTED_LEASE_MS;
    const shared = createStorage({
        [api.AUTH_RECOVERY_LEASE_KEY]: '{malformed',
        [api.AUTH_RECOVERY_SUCCESS_KEY]: JSON.stringify({ attemptId: 'success-old', completedAt: 1_000 }),
    });
    const claim = await api.claimAuthRecovery(shared, createStorage(), {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => now,
        newId: () => 'attempt-new',
    });

    assert.equal(claim.role, 'leader');
    assert.deepEqual(JSON.parse(shared.getItem(api.AUTH_RECOVERY_LEASE_KEY)), {
        attemptId: 'attempt-new',
        startedAt: now,
    });
    assert.equal(shared.getItem(api.AUTH_RECOVERY_SUCCESS_KEY), null);
});

test('lease, tab-attempt, and success records contain only recovery metadata', async () => {
    const shared = createStorage();
    const tab = createStorage();
    const locks = createQueuedExclusiveLockManager();
    await api.claimAuthRecovery(shared, tab, {
        lockManager: locks,
        clock: () => 1_000,
        newId: () => 'attempt-a',
    });
    assert.deepEqual(Object.keys(JSON.parse(shared.getItem(EXPECTED_LEASE_KEY))).sort(), [
        'attemptId',
        'startedAt',
    ]);
    assert.deepEqual(Object.keys(JSON.parse(tab.getItem(EXPECTED_TAB_ATTEMPT_KEY))).sort(), [
        'attemptId',
        'startedAt',
    ]);

    await api.completeAuthRecovery(shared, tab, {
        lockManager: locks,
        clock: () => 2_000,
    });
    assert.deepEqual(Object.keys(JSON.parse(shared.getItem(EXPECTED_SUCCESS_KEY))).sort(), [
        'attemptId',
        'completedAt',
    ]);
});

test('missing Web Locks takes a storage-free solo path without generating an id', async () => {
    const result = await api.claimAuthRecovery(createExplodingStorage(), createExplodingStorage(), {
        lockManager: null,
        clock: () => { throw new Error('clock_must_not_run'); },
        newId: () => { throw new Error('id_must_not_run'); },
    });

    assert.deepEqual(json(result), { role: 'solo', attemptId: '' });
});

test('lock and shared-read failures return solo without claiming a lease', async () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_LEASE_KEY]: JSON.stringify({ attemptId: 'attempt-live', startedAt: 1_000 }),
    });
    const liveRaw = shared.peek(api.AUTH_RECOVERY_LEASE_KEY);
    let sharedWrites = 0;
    shared.getItem = () => { throw new Error('read_blocked'); };
    shared.setItem = () => { sharedWrites += 1; };
    shared.removeItem = () => { sharedWrites += 1; };
    const readFailure = await api.claimAuthRecovery(shared, createStorage(), {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 2_000,
        newId: () => 'attempt-new',
    });
    assert.equal(readFailure.role, 'solo');
    assert.equal(sharedWrites, 0);
    assert.equal(shared.peek(api.AUTH_RECOVERY_LEASE_KEY), liveRaw);

    const lockFailureStorage = createStorage();
    const lockFailure = await api.claimAuthRecovery(lockFailureStorage, createStorage(), {
        lockManager: { request() { throw new Error('locks_failed'); } },
        newId: () => 'attempt-new',
    });
    assert.equal(lockFailure.role, 'solo');
    assert.equal(lockFailureStorage.getItem(api.AUTH_RECOVERY_LEASE_KEY), null);
});

test('tab-attempt and shared-lease write failures cannot commit a lease', async () => {
    const tabWriteShared = createStorage();
    const tabWriteFailure = createStorage();
    tabWriteFailure.setItem = () => { throw new Error('tab_write_failed'); };
    const tabResult = await api.claimAuthRecovery(tabWriteShared, tabWriteFailure, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 1_000,
        newId: () => 'attempt-a',
    });
    assert.equal(tabResult.role, 'solo');
    assert.equal(tabWriteShared.getItem(api.AUTH_RECOVERY_LEASE_KEY), null);

    const leaseWriteShared = createStorage();
    const originalSet = leaseWriteShared.setItem;
    leaseWriteShared.setItem = (key, value) => {
        if (key === api.AUTH_RECOVERY_LEASE_KEY) throw new Error('lease_write_failed');
        originalSet.call(leaseWriteShared, key, value);
    };
    const leaseWriteTab = createStorage();
    const leaseResult = await api.claimAuthRecovery(leaseWriteShared, leaseWriteTab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 1_000,
        newId: () => 'attempt-a',
    });
    assert.equal(leaseResult.role, 'solo');
    assert.equal(leaseWriteShared.getItem(api.AUTH_RECOVERY_LEASE_KEY), null);
    assert.equal(leaseWriteTab.getItem(api.AUTH_RECOVERY_TAB_ATTEMPT_KEY), null);
});

test('an unavailable randomUUID degrades a locked claim to solo without a lease', async () => {
    const shared = createStorage();
    const tab = createStorage();
    const result = await api.claimAuthRecovery(shared, tab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 1_000,
    });

    assert.equal(result.role, 'solo');
    assert.equal(shared.getItem(api.AUTH_RECOVERY_LEASE_KEY), null);
    assert.equal(tab.getItem(api.AUTH_RECOVERY_TAB_ATTEMPT_KEY), null);
});

test('invalid generated attempt ids return solo without mutating recovery records', async () => {
    const successRaw = JSON.stringify({ attemptId: 'attempt-prior', completedAt: 1_500 });
    const invalidAttemptIds = ['', 'x'.repeat(129), null, undefined, 123, true, {}];
    for (const attemptId of invalidAttemptIds) {
        const shared = createObservedStorage({ [EXPECTED_SUCCESS_KEY]: successRaw });
        const tab = createObservedStorage();
        const claim = await api.claimAuthRecovery(shared.storage, tab.storage, {
            lockManager: createQueuedExclusiveLockManager(),
            clock: () => 2_000,
            requestStartedAt: 1_600,
            newId: () => attemptId,
        });

        assert.deepEqual(json(claim), { role: 'solo', attemptId: '' }, String(attemptId));
        assert.equal(shared.storage.peek(EXPECTED_SUCCESS_KEY), successRaw, String(attemptId));
        assert.equal(shared.storage.peek(EXPECTED_LEASE_KEY), null, String(attemptId));
        assert.equal(tab.storage.peek(EXPECTED_TAB_ATTEMPT_KEY), null, String(attemptId));
        assert.equal(
            shared.operations.some(([operation]) => operation !== 'getItem'),
            false,
            String(attemptId),
        );
        assert.equal(
            tab.operations.some(([operation]) => operation !== 'getItem'),
            false,
            String(attemptId),
        );
    }
});

test('simultaneous queued claims skip an invalid id and elect only the next valid leader', async () => {
    const shared = createStorage();
    const invalidTab = createStorage();
    const leaderTab = createStorage();
    const followerTab = createStorage();
    const locks = createQueuedExclusiveLockManager();
    const [invalid, leader, follower] = await Promise.all([
        api.claimAuthRecovery(shared, invalidTab, {
            lockManager: locks,
            clock: () => 1_000,
            newId: () => '',
        }),
        api.claimAuthRecovery(shared, leaderTab, {
            lockManager: locks,
            clock: () => 1_000,
            newId: () => 'attempt-valid',
        }),
        api.claimAuthRecovery(shared, followerTab, {
            lockManager: locks,
            clock: () => 1_000,
            newId: () => { throw new Error('follower_must_not_generate'); },
        }),
    ]);

    assert.deepEqual(
        [invalid.role, leader.role, follower.role],
        ['solo', 'leader', 'follower'],
    );
    assert.equal(leader.attemptId, 'attempt-valid');
    assert.equal(follower.attemptId, 'attempt-valid');
    assert.equal(invalidTab.getItem(EXPECTED_TAB_ATTEMPT_KEY), null);
    assert.equal(JSON.parse(shared.getItem(EXPECTED_LEASE_KEY)).attemptId, 'attempt-valid');
    assert.equal(locks.maxConcurrentCallbacks, 1);
});

test('completion requires Web Locks and the current tab matching the live lease', async () => {
    const noLockResult = await api.completeAuthRecovery(
        createExplodingStorage(),
        createExplodingStorage(),
        { lockManager: null },
    );
    assert.equal(noLockResult, null);

    const noLeaseShared = createStorage();
    const noLeaseTab = createStorage({
        [api.AUTH_RECOVERY_TAB_ATTEMPT_KEY]: JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 }),
    });
    assert.equal(await api.completeAuthRecovery(noLeaseShared, noLeaseTab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 2_000,
    }), null);
    assert.equal(noLeaseShared.getItem(api.AUTH_RECOVERY_SUCCESS_KEY), null);

    const replacedShared = createStorage({
        [api.AUTH_RECOVERY_LEASE_KEY]: JSON.stringify({ attemptId: 'attempt-b', startedAt: 1_500 }),
    });
    const replacedTab = createStorage({
        [api.AUTH_RECOVERY_TAB_ATTEMPT_KEY]: JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 }),
    });
    assert.equal(await api.completeAuthRecovery(replacedShared, replacedTab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 2_000,
    }), null);
    assert.equal(replacedShared.getItem(api.AUTH_RECOVERY_SUCCESS_KEY), null);
    assert.equal(JSON.parse(replacedShared.getItem(api.AUTH_RECOVERY_LEASE_KEY)).attemptId, 'attempt-b');
});

test('completion removal failure publishes no success', async () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_LEASE_KEY]: JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 }),
    });
    const tab = createStorage({
        [api.AUTH_RECOVERY_TAB_ATTEMPT_KEY]: JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 }),
    });
    const originalRemove = shared.removeItem;
    shared.removeItem = key => {
        if (key === api.AUTH_RECOVERY_LEASE_KEY) throw new Error('remove_failed');
        originalRemove.call(shared, key);
    };

    assert.equal(await api.completeAuthRecovery(shared, tab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 2_000,
    }), null);
    assert.equal(shared.getItem(api.AUTH_RECOVERY_SUCCESS_KEY), null);
    assert.notEqual(shared.getItem(api.AUTH_RECOVERY_LEASE_KEY), null);
});

test('completion success-write failure leaves no ghost live lease', async () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_LEASE_KEY]: JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 }),
    });
    const tab = createStorage({
        [api.AUTH_RECOVERY_TAB_ATTEMPT_KEY]: JSON.stringify({ attemptId: 'attempt-a', startedAt: 1_000 }),
    });
    const originalSet = shared.setItem;
    shared.setItem = (key, value) => {
        if (key === api.AUTH_RECOVERY_SUCCESS_KEY) throw new Error('success_write_failed');
        originalSet.call(shared, key, value);
    };

    assert.equal(await api.completeAuthRecovery(shared, tab, {
        lockManager: createQueuedExclusiveLockManager(),
        clock: () => 2_000,
    }), null);
    assert.equal(shared.getItem(api.AUTH_RECOVERY_LEASE_KEY), null);
    assert.equal(shared.getItem(api.AUTH_RECOVERY_SUCCESS_KEY), null);
});

test('consumed-marker write failure disables automatic success consumption', () => {
    const shared = createStorage({
        [api.AUTH_RECOVERY_SUCCESS_KEY]: JSON.stringify({ attemptId: 'attempt-a', completedAt: 2_000 }),
    });
    const tab = createStorage();
    tab.setItem = () => { throw new Error('consumed_write_failed'); };

    assert.equal(api.consumeAuthRecoverySuccess(shared, tab, {
        now: 2_001,
        requestStartedAt: 1_500,
    }), null);
    assert.equal(tab.getItem(api.AUTH_RECOVERY_CONSUMED_KEY), null);
});

test('storage discovery and public reads are fail-soft', () => {
    const blocked = Object.defineProperty({}, 'localStorage', {
        get() { throw new Error('blocked'); },
    });
    assert.equal(api.getAuthRecoveryStores(blocked), null);
    assert.equal(api.getAuthRecoveryStores({ localStorage: createStorage() }), null);
    assert.equal(api.readLiveAuthRecoveryLease(createExplodingStorage(), 1_000), null);
    assert.equal(api.readAuthRecoverySuccess(createExplodingStorage(), 1_000), null);
});

test('exclusive lock callbacks contain only synchronous storage transactions', async () => {
    const shared = createStorage();
    const tab = createStorage();
    const lockManager = {
        request(name, options, callback) {
            assert.equal(name, EXPECTED_LOCK_NAME);
            assert.deepEqual(json(options), { mode: 'exclusive' });
            const result = callback();
            assert.notEqual(typeof result?.then, 'function');
            return Promise.resolve(result);
        },
    };
    await api.claimAuthRecovery(shared, tab, {
        lockManager,
        clock: () => 1_000,
        newId: () => 'attempt-a',
    });
    await api.completeAuthRecovery(shared, tab, {
        lockManager,
        clock: () => 2_000,
    });
});
