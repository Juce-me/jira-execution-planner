export const PROJECT_TRACK_COMMITTED = 'committed';
export const PROJECT_TRACK_FLEXIBLE = 'flexible';

export function classifyEpicProjectTrack(epic) {
    if (!epic) return { kind: 'missing_epic', id: null };
    if (epic.projectTrack == null || String(epic.projectTrack).trim() === '') {
        return { kind: 'unset', id: null };
    }
    const value = String(epic.projectTrack).trim().toLowerCase();
    if (value === PROJECT_TRACK_COMMITTED || value === PROJECT_TRACK_FLEXIBLE) {
        return { kind: 'recognized', id: value };
    }
    return { kind: 'unknown', id: null };
}
