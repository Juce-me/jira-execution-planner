const DATA_LAYER_TRIGGERS = new Set(['pageview', 'userevent']);
const EVENT_NAMES = new Set([
    'login',
    'logout',
    'select_content',
    'app_search',
    'filter_changed',
    'settings_action',
    'connection_action',
    'planning_action',
    'scenario_action',
    'sort_changed',
    'stats_action',
    'chart_action',
    'epm_action',
    'external_link_opened',
    'api_result',
    'app_error_shown'
]);

const EVENT_PARAMS = new Set([
    'api_surface',
    'auth_mode',
    'blocking_reason',
    'cache_state',
    'capacity_side',
    'chart_id',
    'connection_type',
    'content_id',
    'content_type',
    'conflict_count',
    'conflict_count_bucket',
    'conflict_state',
    'dashboard_view',
    'dependency_state',
    'dirty_state',
    'duration_bucket',
    'duration_ms',
    'eng_mode',
    'epm_tab',
    'error_area',
    'error_code',
    'feature_name',
    'filter_type',
    'from_mode',
    'from_view',
    'group_count_bucket',
    'issue_count',
    'issue_count_bucket',
    'issue_kind',
    'lane_mode',
    'link_type',
    'method',
    'metric',
    'mode',
    'override_count',
    'override_count_bucket',
    'page_name',
    'pending_unsaved_state',
    'point_bucket',
    'previous_status',
    'project_count',
    'project_count_bucket',
    'project_scope',
    'query_length_bucket',
    'range_size_bucket',
    'recoverable_state',
    'result',
    'result_count_bucket',
    'search_scope',
    'section',
    'selected_count',
    'selected_count_bucket',
    'selected_sp_bucket',
    'selected_story_points',
    'selection_count_bucket',
    'series_type',
    'source_surface',
    'scope_type',
    'sort_direction',
    'sort_key',
    'sort_scope',
    'sprint_selection_state',
    'stats_view',
    'status_bucket',
    'subgoal_scope',
    'team_count_bucket',
    'unschedulable_count',
    'validation_count_bucket',
    'value_state',
    'visible_count',
    'visible_count_bucket',
    'workflow_action'
]);

const DATA_LAYER_FIELDS = new Set([
    'event',
    'trigger',
    'event_type',
    'event_name',
    'ga4_user_id',
    'debug_mode'
]);

const SAFE_STRING = /^[a-z][a-z0-9_]*$|^[A-Z]{3,8}$|^[1-5][0-9]{2}$|^[1-5]xx$/;
const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const URL_OR_QUERY = /https?:\/\/|www\.|[?&][a-z0-9_]+=|\/browse\/|\/issues\//i;
const ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const RAW_TEXT = /\s|{|}|\[|\]|stack trace|returned|sprint \d+|team [a-z]|draft-\d+|rnd-project|rnd_project_|bearer\s+[a-z0-9._-]+/i;
const RESERVED_PREFIX = /^(ga_|google_|firebase_|_|gtag\.)/;
const BUCKETS = new Set(['0', '1_5', '6_10', '11_25', '26_50', '51_100', 'over_100', 'under_1s', '1_3s', '3_10s', 'over_10s', '2xx', '3xx', '4xx', '5xx']);

function assertSafeName(name) {
    if (!EVENT_PARAMS.has(name) && !DATA_LAYER_FIELDS.has(name)) {
        throw new Error(`unsupported analytics parameter: ${name}`);
    }
    if (RESERVED_PREFIX.test(name)) {
        throw new Error(`reserved analytics parameter: ${name}`);
    }
}

function assertSafeValue(name, value) {
    if (value === undefined || value === null || value === '') return;
    if (DATA_LAYER_FIELDS.has(name)) return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`unsupported analytics value for ${name}`);
        }
        return;
    }
    if (typeof value === 'boolean') return;
    if (typeof value !== 'string') {
        throw new Error(`unsupported analytics value for ${name}`);
    }
    if (ISSUE_KEY.test(value) || URL_OR_QUERY.test(value) || ADDRESS.test(value) || RAW_TEXT.test(value)) {
        throw new Error(`unsafe analytics value for ${name}`);
    }
    if (!SAFE_STRING.test(value) && !BUCKETS.has(value)) {
        throw new Error(`unsafe analytics value for ${name}`);
    }
}

export function bucketCount(value) {
    const count = Math.max(0, Number(value) || 0);
    if (count === 0) return '0';
    if (count <= 5) return '1_5';
    if (count <= 10) return '6_10';
    if (count <= 25) return '11_25';
    if (count <= 50) return '26_50';
    if (count <= 100) return '51_100';
    return 'over_100';
}

export function bucketDuration(value) {
    const duration = Math.max(0, Number(value) || 0);
    if (duration < 1000) return 'under_1s';
    if (duration < 3000) return '1_3s';
    if (duration < 10000) return '3_10s';
    return 'over_10s';
}

export function sanitizeAnalyticsParams(params = {}, eventName = '') {
    if (eventName && eventName !== 'page_view' && !EVENT_NAMES.has(eventName)) {
        throw new Error(`unsupported analytics event_name: ${eventName}`);
    }
    const clean = {};
    for (const [name, value] of Object.entries(params || {})) {
        if (value === undefined || value === null || value === '') continue;
        assertSafeName(name);
        assertSafeValue(name, value);
        clean[name] = value;
    }
    if (Object.keys(clean).length > 25) {
        throw new Error('analytics event parameters must stay at most 25');
    }
    return clean;
}

export function validateAnalyticsPayload(payload) {
    if (!DATA_LAYER_TRIGGERS.has(payload?.event) || payload.event !== payload.trigger) {
        throw new Error('unsupported analytics trigger');
    }
    if (payload.event === 'pageview') {
        if (payload.event_type !== 'pageview' || payload.event_name !== 'page_view') {
            throw new Error('invalid analytics pageview payload');
        }
        if (!payload.page_name) {
            throw new Error('page_name is required');
        }
    } else {
        if (payload.event_type !== 'event' || !EVENT_NAMES.has(payload.event_name)) {
            throw new Error(`unsupported analytics event_name: ${payload.event_name}`);
        }
        if (!payload.feature_name) {
            throw new Error('feature_name is required');
        }
    }
    sanitizeAnalyticsParams(payload, payload.event_name);
    return payload;
}
