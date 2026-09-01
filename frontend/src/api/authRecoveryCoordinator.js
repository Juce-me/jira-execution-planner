export const AUTH_RECOVERY_LOCK_NAME = 'jira-dashboard-auth-recovery-v1';
export const AUTH_RECOVERY_LEASE_KEY = 'jira_dashboard_auth_recovery_lease_v1';
export const AUTH_RECOVERY_SUCCESS_KEY = 'jira_dashboard_auth_recovery_success_v1';
export const AUTH_RECOVERY_TAB_ATTEMPT_KEY = 'jira_dashboard_auth_recovery_attempt_v1';
export const AUTH_RECOVERY_CONSUMED_KEY = 'jira_dashboard_auth_recovery_consumed_v1';
export const AUTH_RECOVERY_LEASE_MS = 5 * 60 * 1000;

export function getAuthRecoveryStores(win = globalThis.window) {
    try {
        const sharedStorage = win?.localStorage;
        const tabStorage = win?.sessionStorage;
        return sharedStorage && tabStorage ? { sharedStorage, tabStorage } : null;
    } catch (error) {
        return null;
    }
}

const parseRecord = raw => {
    try { return JSON.parse(raw || 'null'); } catch (error) { return null; }
};

const validAttempt = (value, timestampKey, now) => Boolean(
    typeof value?.attemptId === 'string'
    && value.attemptId.length > 0
    && value.attemptId.length <= 128
    && Number.isFinite(value?.[timestampKey])
    && value[timestampKey] >= 0
    && value[timestampKey] <= now
    && now - value[timestampKey] <= AUTH_RECOVERY_LEASE_MS
);

const validRequestStart = (value, now) => Number.isFinite(value)
    && value >= 0
    && value <= now;

const readLiveAuthRecoveryLeaseStrict = (sharedStorage, now) => {
    const value = parseRecord(sharedStorage.getItem(AUTH_RECOVERY_LEASE_KEY));
    if (!validAttempt(value, 'startedAt', now)) return null;
    return { attemptId: value.attemptId, startedAt: value.startedAt };
};

export function readLiveAuthRecoveryLease(sharedStorage, now = Date.now()) {
    try {
        return readLiveAuthRecoveryLeaseStrict(sharedStorage, now);
    } catch (error) {
        return null;
    }
}

const readAuthRecoverySuccessStrict = (sharedStorage, now) => {
    const value = parseRecord(sharedStorage.getItem(AUTH_RECOVERY_SUCCESS_KEY));
    if (!validAttempt(value, 'completedAt', now)) return null;
    return { attemptId: value.attemptId, completedAt: value.completedAt };
};

const consumeAuthRecoverySuccessStrict = (
    sharedStorage,
    tabStorage,
    now,
    requestStartedAt,
) => {
    const success = readAuthRecoverySuccessStrict(sharedStorage, now);
    if (!success) return null;
    if (!validRequestStart(requestStartedAt, now) || success.completedAt < requestStartedAt) return null;
    if (tabStorage.getItem(AUTH_RECOVERY_CONSUMED_KEY) === success.attemptId) return null;
    tabStorage.setItem(AUTH_RECOVERY_CONSUMED_KEY, success.attemptId);
    return success;
};

const writeTabAttempt = (tabStorage, attemptId, startedAt) => {
    tabStorage.setItem(
        AUTH_RECOVERY_TAB_ATTEMPT_KEY,
        JSON.stringify({ attemptId, startedAt }),
    );
};

export async function claimAuthRecovery(sharedStorage, tabStorage, {
    lockManager = globalThis.navigator?.locks,
    clock = () => Date.now(),
    requestStartedAt,
    newId = () => globalThis.crypto.randomUUID(),
} = {}) {
    const solo = () => ({ role: 'solo', attemptId: '' });
    if (!lockManager?.request) return solo();
    try {
        return await lockManager.request(
            AUTH_RECOVERY_LOCK_NAME,
            { mode: 'exclusive' },
            () => {
                const now = clock();
                const completed = consumeAuthRecoverySuccessStrict(
                    sharedStorage,
                    tabStorage,
                    now,
                    requestStartedAt,
                );
                if (completed) return { role: 'resume', attemptId: completed.attemptId };
                const current = readLiveAuthRecoveryLeaseStrict(sharedStorage, now);
                if (current) return { role: 'follower', attemptId: current.attemptId };
                const attemptId = String(newId());
                sharedStorage.removeItem(AUTH_RECOVERY_SUCCESS_KEY);
                writeTabAttempt(tabStorage, attemptId, now);
                sharedStorage.setItem(
                    AUTH_RECOVERY_LEASE_KEY,
                    JSON.stringify({ attemptId, startedAt: now }),
                );
                return { role: 'leader', attemptId };
            },
        );
    } catch (error) {
        try { tabStorage.removeItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY); } catch (storageError) { }
        return solo();
    }
}

export async function completeAuthRecovery(sharedStorage, tabStorage, {
    lockManager = globalThis.navigator?.locks,
    clock = () => Date.now(),
} = {}) {
    if (!lockManager?.request) return null;
    try {
        return await lockManager.request(
            AUTH_RECOVERY_LOCK_NAME,
            { mode: 'exclusive' },
            () => {
                const now = clock();
                const tabAttempt = parseRecord(
                    tabStorage.getItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY),
                );
                const current = readLiveAuthRecoveryLeaseStrict(sharedStorage, now);
                if (!validAttempt(tabAttempt, 'startedAt', now)
                    || !current
                    || current.attemptId !== tabAttempt.attemptId) {
                    if (!current) sharedStorage.removeItem(AUTH_RECOVERY_LEASE_KEY);
                    tabStorage.removeItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY);
                    return null;
                }
                const success = { attemptId: tabAttempt.attemptId, completedAt: now };
                sharedStorage.removeItem(AUTH_RECOVERY_LEASE_KEY);
                sharedStorage.setItem(AUTH_RECOVERY_SUCCESS_KEY, JSON.stringify(success));
                try {
                    tabStorage.setItem(AUTH_RECOVERY_CONSUMED_KEY, tabAttempt.attemptId);
                    tabStorage.removeItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY);
                } catch (error) { }
                return success;
            },
        );
    } catch (error) {
        return null;
    }
}

export function readAuthRecoverySuccess(sharedStorage, now = Date.now()) {
    try {
        return readAuthRecoverySuccessStrict(sharedStorage, now);
    } catch (error) {
        return null;
    }
}

export function consumeAuthRecoverySuccess(sharedStorage, tabStorage, {
    now = Date.now(),
    requestStartedAt,
} = {}) {
    try {
        return consumeAuthRecoverySuccessStrict(
            sharedStorage,
            tabStorage,
            now,
            requestStartedAt,
        );
    } catch (error) {
        return null;
    }
}
