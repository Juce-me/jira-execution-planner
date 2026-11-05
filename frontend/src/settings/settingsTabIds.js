export const ADMIN_SETTINGS_TAB_IDS = new Set(['project', 'scope', 'source', 'mapping', 'capacity', 'priorityWeights', 'access', 'performance']);
export const DEPARTMENT_SETTINGS_TAB_IDS = new Set(['teams', 'labels', 'boards']);
export const SHARED_CONFIGURATION_TAB_IDS = new Set(ADMIN_SETTINGS_TAB_IDS);

// The legacy flat editor splits project config across three tabs; the Project config editor owns them as one.
export const LEGACY_PROJECT_CONFIG_TAB_IDS = new Set(['scope', 'source', 'mapping']);
const projectConfigOwnsTabs = workConfigMode => workConfigMode === 'enabled' || workConfigMode === 'unavailable';
export const adminTabIdsFor = (workConfigMode, { accessAvailable = true, performanceAvailable = false } = {}) => [
    ...(projectConfigOwnsTabs(workConfigMode) ? ['project'] : ['scope', 'source', 'mapping']),
    'capacity', 'priorityWeights',
    ...(accessAvailable ? ['access'] : []),
    ...(performanceAvailable ? ['performance'] : []),
];
export const effectiveAdminTab = (workConfigMode, tab) => (projectConfigOwnsTabs(workConfigMode) && LEGACY_PROJECT_CONFIG_TAB_IDS.has(tab) ? 'project' : tab);
