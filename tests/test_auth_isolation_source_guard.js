const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');
const gateSource = fs.readFileSync('frontend/src/components/AuthRequiredGate.jsx', 'utf8');
const authRequiredSource = fs.readFileSync('frontend/src/api/authRequired.js', 'utf8');
const resumeSource = fs.readFileSync('frontend/src/api/authResumeState.js', 'utf8');
const coordinatorSource = fs.readFileSync('frontend/src/api/authRecoveryCoordinator.js', 'utf8');
const localStorageAtlassianPattern = /localStorage[\s\S]{0,160}atlassian|atlassian[\s\S]{0,160}localStorage/i;

assert(
  !source.includes('/api/auth/status'),
  'auth-mode implementation must stay isolated from dashboard.jsx in this slice'
);

assert(
  !source.includes('/api/auth/atlassian/login'),
  'dashboard.jsx must not expose Atlassian login UI in this slice'
);

assert(
  !source.includes('/api/auth/refresh'),
  'dashboard.jsx must not own OAuth focus refresh in this slice'
);

assert(
  !source.includes('session_expired'),
  'dashboard.jsx must not own expired-auth screen routing in this slice'
);

assert(
  !source.includes('auth_required'),
  'dashboard.jsx must not add auth_required handling in this slice'
);

assert(
  !localStorageAtlassianPattern.test(source),
  'dashboard must not store Atlassian tokens in localStorage'
);

assert(
  !/localStorage|sessionStorage/.test(authRequiredSource),
  'the terminal auth-required latch must remain window-local'
);
assert(
  !resumeSource.includes('localStorage'),
  'the allowlisted recovery capsule must remain tab-local in sessionStorage'
);
assert(
  !/window\.(?:localStorage|sessionStorage)/.test(gateSource),
  'the gate must obtain both storage boundaries through getAuthRecoveryStores'
);
assert(
  gateSource.includes('getAuthRecoveryStores(window)')
    && gateSource.includes('claimAuthRecovery(')
    && gateSource.includes('consumeAuthRecoverySuccess(')
    && gateSource.includes('readLiveAuthRecoveryLease('),
  'the terminal gate must integrate only through guarded coordinator helpers'
);
assert(
  !/fetch\s*\(|apiFetch\s*\(|trackedFetch\s*\(|publishAuthenticationRequired\s*\(/.test(gateSource),
  'the gate must not call an API, publish another latch, or replay the failed request'
);
assert(
  !gateSource.includes('lockedAt')
    && gateSource.includes('requestStartedAt: authRequired.requestStartedAt'),
  'recovery causality must use requestStartedAt and never lockedAt'
);
assert(
  gateSource.includes("window.location.assign(loginUrl)")
    && gateSource.includes("window.location.assign('/')")
    && !/window\.open|target=|location\.replace/.test(gateSource),
  'recovery must stay in the same tab with only the sanitized login target and root reload'
);
assert(
  source.includes('getAuthRecoveryStores(window)')
    && source.includes('await completeAuthRecovery(recoveryStores.sharedStorage, recoveryStores.tabStorage);'),
  'authenticated config bootstrap must publish coordinator success through guarded stores'
);
const configFetchIndex = source.indexOf('const config = await fetchAppConfig(BACKEND_URL);');
const completionIndex = source.indexOf('await completeAuthRecovery(', configFetchIndex);
const resumeReadIndex = source.indexOf('readAuthResumeState(', configFetchIndex);
assert(
  configFetchIndex >= 0 && completionIndex > configFetchIndex && completionIndex < resumeReadIndex,
  'authenticated success must publish after principal config and before capsule or feature hydration'
);
assert(
  !/(?:email|accessToken|apiToken|responseBody|configPayload|issuePayload)/i.test(coordinatorSource),
  'shared coordinator records must not accept identity, credential, config, or issue payload fields'
);
assert(
  !/AUTH_RECOVERY_(?:LEASE|SUCCESS)_KEY[\s\S]{0,120}(?:loginUrl|workspaceId|viewConfigId|selectedTaskKeys)/.test(coordinatorSource),
  'shared recovery records must contain only opaque attempt ids and timestamps'
);

const epmSaveStart = source.indexOf('const saveEpmConfig = async () => {');
const epmSaveEnd = source.indexOf('const normalizeStatus = (status) => {', epmSaveStart);
const epmSaveSource = source.slice(epmSaveStart, epmSaveEnd);
assert(
  epmSaveSource.includes('if (isAuthenticationRequiredError(err)) throw err;'),
  'EPM saves must preserve their draft and delegate authentication recovery to the root gate'
);
assert(!epmSaveSource.includes('setWorkspaceConfigRecoveryLoginUrl('), 'EPM saves must not own local sign-in recovery');
assert(
  !epmSaveSource.includes('applySavedEpmConfig(createEmptyEpmConfigDraft())'),
  'an EPM save 401 must preserve the private draft and baseline'
);

const windowKeydownRegistrations = [...source.matchAll(
  /window\.addEventListener\('keydown',\s*([A-Za-z_$][\w$]*)\);/g
)];
assert.strictEqual(
  windowKeydownRegistrations.length,
  6,
  'enumerate every dashboard window keydown handler so new global shortcuts cannot bypass the auth lock'
);
for (const registration of windowKeydownRegistrations) {
  const handlerName = registration[1];
  const handlerMarker = `const ${handlerName} =`;
  const handlerStart = source.lastIndexOf(handlerMarker, registration.index);
  assert(handlerStart >= 0, `find the ${handlerName} implementation registered at ${registration.index}`);
  const handlerSource = source.slice(handlerStart, registration.index);
  const authGuardIndex = handlerSource.indexOf('if (readPendingAuthenticationRequired()) return;');
  const keyReadIndexes = [handlerSource.indexOf('event.key'), handlerSource.indexOf('e.key')]
    .filter(index => index >= 0);
  const firstKeyReadIndex = keyReadIndexes.length ? Math.min(...keyReadIndexes) : Number.POSITIVE_INFINITY;
  assert(
    authGuardIndex >= 0 && authGuardIndex < firstKeyReadIndex,
    `${handlerName} registered at ${registration.index} must check the terminal auth latch before handling a key`
  );
}
