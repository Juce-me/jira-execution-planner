const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');

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
  !source.includes("localStorage.setItem('atlassian"),
  'dashboard must not store Atlassian tokens in localStorage'
);
