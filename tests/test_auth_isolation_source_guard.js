const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');
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
