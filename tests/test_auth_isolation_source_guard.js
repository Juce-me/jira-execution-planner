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
  epmSaveSource.includes('setWorkspaceConfigRecoveryLoginUrl(safeAppLoginUrl('),
  'Task 4 must preserve the existing safe auth-recovery action for EPM saves'
);
assert(
  !epmSaveSource.includes('applySavedEpmConfig(createEmptyEpmConfigDraft())'),
  'an EPM save 401 must preserve the private draft and baseline'
);
