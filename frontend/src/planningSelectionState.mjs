// UI scope labels only. Legacy browser selection records are intentionally neither read nor written.
export const PLANNING_SELECTION_MODE_MANUAL = 'manual';
export function buildPlanningScopeKey({ sprintId, groupId } = {}) {
    return `planning::${String(sprintId || '').trim()}::${String(groupId || '').trim()}`;
}
