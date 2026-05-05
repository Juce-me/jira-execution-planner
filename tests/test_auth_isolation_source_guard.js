const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');
const engSprintDataSource = fs.readFileSync('frontend/src/eng/useEngSprintData.js', 'utf8');
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
  engSprintDataSource.includes('route_not_oauth_ready') &&
  engSprintDataSource.includes('OAuth login succeeded, but this dashboard data route has not been migrated to Atlassian OAuth yet.'),
  'ENG task errors must explain route_not_oauth_ready instead of saying the server is down'
);
