import { bucketCount } from '../analytics/dashboardAnalytics.js';
import { sumPlanningStoryPoints } from './planningSelectionStats.js';

// Target shape shared by the hook and UI. `summary` is for UI display only —
// never put summary/key/URL/team/sprint/JQL into an analytics payload builder.
// { key, issueType, currentStatus, summary }

// Status name -> low-cardinality issue_status_action bucket. Keeps Accepted and
// Postponed as their own buckets (unlike the scheduling-only DEFAULT_STATUS_PHASE_RANKS
// in engTaskUtils.js, which groups them together). Anything not listed here, including
// terminal/cancelled statuses such as Killed, falls back to 'other'.
const STATUS_BUCKET_BY_NAME = {
    'to do': 'todo',
    'todo': 'todo',
    'open': 'todo',
    'reopened': 'todo',
    'backlog': 'todo',
    'selected for development': 'todo',
    'pending': 'todo',

    'accepted': 'accepted',

    'in progress': 'in_progress',
    'in development': 'in_progress',
    'in review': 'in_progress',
    'in testing': 'in_progress',
    'analysis': 'in_progress',
    'release': 'in_progress',
    'waiting for release': 'in_progress',
    'awaiting validation': 'in_progress',

    'done': 'done',
    'closed': 'done',
    'resolved': 'done',
    'released': 'done',
    'complete': 'done',
    'completed': 'done',

    'blocked': 'blocked',
    'external block': 'blocked',
    'on hold': 'blocked',
    'impediment': 'blocked',
    'waiting': 'blocked',

    'postponed': 'postponed',
};

function normalizeStatusTargetKey(value) {
    return String(value || '').trim().toUpperCase();
}

function issueStatusName(statusValue) {
    if (!statusValue) return '';
    return typeof statusValue === 'string' ? statusValue : String(statusValue.name || '');
}

export function isStatusTransitionSurfaceEnabled({ selectedView, showPlanning, showStats, showScenario } = {}) {
    if (selectedView !== 'eng') return false;
    if (showStats || showScenario) return false;
    // Whatever remains is Catch Up, Planning or Board: all three are enabled surfaces.
    // Board is deliberately included — its epic cards carry the same status pills, and a
    // card drag is a trigger for this same transition (plan §6.4).
    return true;
}

// Derives {key, issueType, currentStatus, summary} from either the standard nested Jira
// task shape (task.fields.status.name / task.fields.issuetype.name / task.fields.summary,
// used by Story tasks across dashboard.jsx) or the flat shape used by epicGroups' epic
// entries and expanded-subtask items (status/summary directly on the object, no issueType).
// fallbackIssueType supplies the issue type for shapes that never carry one (Epic/Subtask).
export function buildCatchUpStatusTargets(issue, fallbackIssueType = '') {
    const key = String(issue?.key || '').trim();
    if (!key) return null;
    const fields = issue?.fields || null;
    const currentStatus = issueStatusName(fields ? fields.status : issue?.status);
    const issueType = String(fields?.issuetype?.name || issue?.issueType || fallbackIssueType || '');
    const summary = String(fields?.summary || issue?.summary || '');
    // Loaded Story Points (nested Jira shape or flat), kept only so analytics can bucket the clicked Story; absent when the issue carries none.
    const storyPoints = fields ? fields.customfield_10004 : issue?.storyPoints;
    return { key, issueType, currentStatus, summary, ...(storyPoints === undefined ? {} : { storyPoints }) };
}

// Maps subtask keys to the parent Story keys whose expanded subtask lists contain them,
// so a successful subtask status change can refresh only the affected stories' subtasks
// (keeping an expanded subtask row from showing a stale pill) without a full reload.
export function resolveSubtaskParentStoryKeys(subtaskKeys, storySubtasksByKey) {
    const wanted = new Set((subtaskKeys || []).map(normalizeStatusTargetKey).filter(Boolean));
    if (!wanted.size) return [];
    const storyKeys = new Set();
    const byStory = storySubtasksByKey || {};
    for (const storyKey of Object.keys(byStory)) {
        const items = byStory[storyKey]?.items || [];
        if (items.some((item) => wanted.has(normalizeStatusTargetKey(item?.key)))) {
            storyKeys.add(storyKey);
        }
    }
    return Array.from(storyKeys);
}

function classifyIssueTypeToken(issueType) {
    const normalized = String(issueType || '').trim().toLowerCase();
    if (normalized === 'epic') return 'epic';
    if (normalized === 'subtask' || normalized === 'sub-task') return 'subtask';
    return 'story';
}

export function summarizeIssueTypeMix(targets) {
    const list = Array.isArray(targets) ? targets : [];
    let hasEpic = false;
    let hasStory = false;
    let hasSubtask = false;
    list.forEach((target) => {
        const type = classifyIssueTypeToken(target?.issueType);
        if (type === 'epic') hasEpic = true;
        else if (type === 'subtask') hasSubtask = true;
        else hasStory = true;
    });
    const distinctCount = [hasEpic, hasStory, hasSubtask].filter(Boolean).length;
    if (distinctCount > 1) return 'mixed';
    if (hasEpic) return 'epics';
    if (hasSubtask) return 'subtasks';
    return 'stories';
}

// Turns backend per-issue transition results (which carry raw issue keys and error text)
// into a safe aggregate: counts plus a success/partial/failure enum. No raw issue details
// are read into the return value. Backend `already_in_status` counts as success per the
// endpoint contract (an issue already at the requested status is not a failure).
export function summarizeTransitionResults(results) {
    const list = Array.isArray(results) ? results : [];
    let succeeded = 0;
    let failed = 0;
    list.forEach((entry) => {
        const outcome = String(entry?.result || '').trim().toLowerCase();
        if (outcome === 'success' || outcome === 'already_in_status') {
            succeeded += 1;
        } else {
            failed += 1;
        }
    });
    const total = list.length;
    const result = succeeded === 0 ? 'failure' : failed === 0 ? 'success' : 'partial';
    return { total, succeeded, failed, result };
}

export function buildStatusBucket(statusName) {
    const normalized = String(statusName || '').trim().toLowerCase();
    return STATUS_BUCKET_BY_NAME[normalized] || 'other';
}

// selected_count_bucket / selected_sp_bucket both reuse the shared bucketCount ranges
// (dashboardAnalytics.js) rather than defining a new bucketing scheme.
export function buildSelectedCountBucket(count) {
    return bucketCount(count);
}

export function buildSelectedSpBucket(storyPoints) {
    return bucketCount(storyPoints);
}

// Builds the shared issue_status_action params for status_options_open,
// status_change_submit, and status_change_result, so the leak this fixed (Catch
// Up reporting Planning's selected_sp_bucket) cannot recur by duplicating this
// assembly at each call site. `status` is omitted so no status_bucket key is
// sent for status_options_open, where no target status has been chosen yet.
// selected_sp_bucket is the bucket of the Story points of the ONE Story the action is
// for (a Planning status pill writes only its own issue, whatever is selected), so ONLY
// Planning sends it and only for a Story target; Epic and Subtask actions, Catch Up and
// Board omit it rather than reporting an unrelated bucket. (Before issue #250 it was
// the selection's Story points, which are no longer related to the write.)
export function buildStatusActionAnalyticsParams({
    sourceSurface,
    targets = [],
    status,
} = {}) {
    const list = Array.isArray(targets) ? targets : [];
    const uniqueKeyCount = new Set(list.map((target) => String(target?.key || target || '').trim()).filter(Boolean)).size;
    const storyTargets = list.filter((target) => classifyIssueTypeToken(target?.issueType) === 'story');
    return {
        source_surface: sourceSurface,
        ...(status === undefined ? {} : { status_bucket: buildStatusBucket(status) }),
        issue_type_mix: summarizeIssueTypeMix(list),
        selected_count_bucket: buildSelectedCountBucket(uniqueKeyCount),
        ...(sourceSurface === 'planning' && storyTargets.length ? { selected_sp_bucket: buildSelectedSpBucket(sumPlanningStoryPoints(storyTargets.map(target => ({ key: target.key, fields: { customfield_10004: target.storyPoints } })))) } : {}),
    };
}

// Shown where a write's outcome could not be confirmed (or the field is locked by one).
export const UNCONFIRMED_WRITE_MESSAGE = 'The change could not be confirmed. Refresh to check Jira before editing it again.';

// ---- Outcome classification for single-issue status and priority writes (issue #250) ----------
// A write ends in one of three outcomes. `confirmed`: Jira reported the change. `rejected`: no
// write was applied, so the display can return to its base. `unconfirmed`: a write may have been
// applied (or the answer is unusable), so the field stays locked until an explicit Refresh shows
// Jira's value. HTTP 200 and aggregate counts are never authority: only the matching per-key result.
// These pairs are raised before a write or reported by Jira as a rejection (verified against the
// transition and priority services); everything else after the job started is unconfirmed.
const DEFINITIVE_HTTP_ERRORS = Object.freeze({
    400: ['invalid_json', 'issue_keys_required', 'invalid_issue_key', 'too_many_issues', 'target_status_required', 'target_priority_required', 'invalid_priority_id'],
    403: ['csrf_required', 'jira_oauth_required'],
    503: ['config_storage_unavailable'],
});
const STATUS_DEFINITIVE_ERRORS = Object.freeze([
    'transition_not_available', 'transitions_unavailable', 'invalid_transition', 'transition_forbidden',
    'transition_conflict', 'jira_auth_error', 'issue_not_found',
]);

// An error thrown after the job started is unconfirmed unless it carries one of the definitive
// status/code pairs: the CSRF-token read precedes the POST and nothing marks the send. A queued
// job cancelled before dispatch is rejected (callers treat an auth-lock abort as an abandon first).
export function classifyWriteError(error) {
    if (error?.name === 'AbortError') return 'rejected';
    const codes = DEFINITIVE_HTTP_ERRORS[Number(error?.status)];
    return codes && codes.includes(String(error?.code || '')) ? 'rejected' : 'unconfirmed';
}

const normalizedResultKey = value => String(value || '').trim().toUpperCase();

// Exactly one result must match the requested key; none or several is unconfirmed.
export function findIssueResult(response, key) {
    const matches = (Array.isArray(response?.results) ? response.results : [])
        .filter(entry => normalizedResultKey(entry?.key) === normalizedResultKey(key));
    if (matches.length === 1) return { entry: matches[0] };
    return { problem: matches.length ? 'duplicate_result' : 'missing_result' };
}

export function classifyStatusResult(response, key, { staleAlreadyIn = false } = {}) {
    const found = findIssueResult(response, key);
    if (found.problem) return { outcome: 'unconfirmed', code: found.problem };
    const { entry } = found;
    if (entry.result === 'failure') {
        return STATUS_DEFINITIVE_ERRORS.includes(entry.error)
            ? { outcome: 'rejected', code: entry.error, currentStatus: entry.currentStatus }
            : { outcome: 'unconfirmed', code: entry.error || 'transition_failed' };
    }
    if (entry.result !== 'success' && entry.result !== 'already_in_status') return { outcome: 'unconfirmed', code: 'unknown_result' };
    if (entry.result === 'already_in_status' && staleAlreadyIn) return { outcome: 'unconfirmed', code: 'stale_already_in' };
    const name = entry.result === 'success'
        ? (entry.toStatus || response?.targetStatus)
        : (entry.currentStatus || entry.toStatus || response?.targetStatus);
    return name ? { outcome: 'confirmed', value: { name } } : { outcome: 'unconfirmed', code: 'unusable_value' };
}
