// Canonical Epic Project Track values. Mirrors backend.services.jira_issue_project_track's
// CANONICAL_TRACKS tuple; the browser only ever normalizes to/validates against this pair.

export const CANONICAL_PROJECT_TRACKS = ['Flexible', 'Committed'];

export function normalizeProjectTrackValue(value) {
    const lowered = String(value || '').trim().toLowerCase();
    const match = CANONICAL_PROJECT_TRACKS.find(track => track.toLowerCase() === lowered);
    return match || '';
}

// Options the change menu should offer: never the epic's own current recognized track, and
// both canonical values when the current track is blank/unrecognized (nothing to omit yet).
export function filterProjectTrackOptions(options, currentTrack) {
    const current = normalizeProjectTrackValue(currentTrack);
    const list = Array.isArray(options) ? options : [];
    return list
        .map(option => ({ value: normalizeProjectTrackValue(option && option.value) }))
        .filter(option => option.value && option.value !== current);
}

// Builds the shared issue_project_track_action params for project_track_options_open,
// project_track_change_submit, and project_track_change_result. targetTrack is omitted for
// project_track_options_open, where no target track has been chosen yet, so no value_state
// key is sent. issue_type_mix is always 'epics' (Project Track only exists on Epics) and
// selected_count_bucket is always '1_5' (this is a single-issue change), matching the eng
// priority/status siblings' bucketing conventions without duplicating them for a fixed count.
export function buildProjectTrackActionAnalyticsParams({ sourceSurface, targetTrack, result } = {}) {
    const params = {
        source_surface: sourceSurface === 'planning' ? 'planning' : 'catch_up',
        issue_type_mix: 'epics',
        selected_count_bucket: '1_5',
    };
    const valueState = normalizeProjectTrackValue(targetTrack).toLowerCase();
    if (valueState) params.value_state = valueState;
    if (result !== undefined) params.result = result;
    return params;
}
