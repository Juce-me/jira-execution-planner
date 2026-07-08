import { bucketCount } from '../analytics/dashboardAnalytics.js';
import { sumPlanningStoryPoints } from './planningSelectionStats.js';

// Client-side cap for a single status-transition batch. Must match backend
// backend/services/jira_issue_transitions.py MAX_STATUS_TRANSITION_ISSUES.
export const MAX_STATUS_TRANSITION_ISSUES = 50;

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
    // showPlanning true or false: both ENG Catch Up and ENG Planning are enabled surfaces.
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
    return { key, issueType, currentStatus, summary };
}

function findEpicGroupByKey(epicGroups, key) {
    const normalized = normalizeStatusTargetKey(key);
    return (epicGroups || []).find((group) => normalizeStatusTargetKey(group?.key) === normalized) || null;
}

function resolveEpicStatusTargets(selectedEpicKeys, epicGroups) {
    return (selectedEpicKeys || [])
        .map((key) => {
            const group = findEpicGroupByKey(epicGroups, key);
            const epicIssue = group?.epic || null;
            return buildCatchUpStatusTargets({
                key: group?.key || key,
                status: epicIssue?.status,
                summary: epicIssue?.summary || group?.parentSummary || '',
            }, 'Epic');
        })
        .filter(Boolean);
}

function findSubtaskItemByKey(storySubtasksByKey, key) {
    const normalized = normalizeStatusTargetKey(key);
    const byStory = storySubtasksByKey || {};
    for (const storyKey of Object.keys(byStory)) {
        const items = byStory[storyKey]?.items || [];
        const found = items.find((item) => normalizeStatusTargetKey(item?.key) === normalized);
        if (found) return found;
    }
    return null;
}

function resolveSubtaskStatusTargets(selectedSubtaskKeys, storySubtasksByKey) {
    return (selectedSubtaskKeys || [])
        .map((key) => buildCatchUpStatusTargets(findSubtaskItemByKey(storySubtasksByKey, key) || { key }, 'Subtask'))
        .filter(Boolean);
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

// Inserts each target list in low-to-high precedence order so a later list's value wins
// the collision. Callers pass (subtaskTargets, storyTargets, epicTargets) so a duplicate
// key deterministically resolves to Epic > Story > Subtask.
function dedupeStatusTargetsByPrecedence(...targetListsLowToHighPrecedence) {
    const byKey = new Map();
    targetListsLowToHighPrecedence.forEach((list) => {
        (list || []).forEach((target) => {
            if (!target?.key) return;
            byKey.set(normalizeStatusTargetKey(target.key), target);
        });
    });
    return Array.from(byKey.values());
}

// Composes the Planning batch status-target set: selected Story targets from
// selectedTasksList, plus selected Epics and selected Subtasks resolved separately from
// epicGroups/storySubtasksByKey. Epics/Subtasks are never mixed into selectedTasksList, so
// they cannot affect selected story-point totals computed elsewhere from that same list.
export function buildEngStatusTargets({
    selectedTasksList = [],
    selectedEpicKeys = [],
    selectedSubtaskKeys = [],
    epicGroups = [],
    storySubtasksByKey = {},
} = {}) {
    const storyTargets = (selectedTasksList || [])
        .map((task) => buildCatchUpStatusTargets(task, 'Story'))
        .filter(Boolean);
    const epicTargets = resolveEpicStatusTargets(selectedEpicKeys, epicGroups);
    const subtaskTargets = resolveSubtaskStatusTargets(selectedSubtaskKeys, storySubtasksByKey);
    return dedupeStatusTargetsByPrecedence(subtaskTargets, storyTargets, epicTargets);
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
// selected_sp_bucket reflects Planning's selected Story points; Catch Up acts on
// one explicit issue unrelated to Planning selection, so it omits
// selected_sp_bucket entirely rather than reporting an unrelated bucket.
export function buildStatusActionAnalyticsParams({
    sourceSurface,
    targets = [],
    selectedStories = [],
    status,
} = {}) {
    const list = Array.isArray(targets) ? targets : [];
    const uniqueKeyCount = new Set(list.map((target) => String(target?.key || target || '').trim()).filter(Boolean)).size;
    return {
        source_surface: sourceSurface,
        ...(status === undefined ? {} : { status_bucket: buildStatusBucket(status) }),
        issue_type_mix: summarizeIssueTypeMix(list),
        selected_count_bucket: buildSelectedCountBucket(uniqueKeyCount),
        ...(sourceSurface === 'catch_up' ? {} : { selected_sp_bucket: buildSelectedSpBucket(sumPlanningStoryPoints(selectedStories || [])) }),
    };
}
