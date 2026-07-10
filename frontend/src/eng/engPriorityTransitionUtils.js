import { buildSelectedCountBucket, summarizeIssueTypeMix } from './engStatusTransitionUtils.js';

// Target shape shared by the hook and UI. `summary` is for UI display only —
// never put summary/key/URL/team/sprint/JQL into an analytics payload builder.
// { key, issueType, currentPriority, summary }

function issuePriorityName(priorityValue) {
    if (!priorityValue) return '';
    return typeof priorityValue === 'string' ? priorityValue : String(priorityValue.name || '');
}

// Derives {key, issueType, currentPriority, summary} from either the standard nested Jira
// task shape (task.fields.priority.name / task.fields.issuetype.name / task.fields.summary,
// used by Story tasks across dashboard.jsx) or the flat shape used by epicGroups' epic
// entries (priority/summary directly on the object, no issueType). fallbackIssueType
// supplies the issue type for shapes that never carry one (Epic). Mirrors
// buildCatchUpStatusTargets in engStatusTransitionUtils.js for the priority field.
export function buildCatchUpPriorityTargets(issue, fallbackIssueType = '') {
    const key = String(issue?.key || '').trim();
    if (!key) return null;
    const fields = issue?.fields || null;
    const currentPriority = issuePriorityName(fields ? fields.priority : issue?.priority);
    const issueType = String(fields?.issuetype?.name || issue?.issueType || fallbackIssueType || '');
    const summary = String(fields?.summary || issue?.summary || '');
    return { key, issueType, currentPriority, summary };
}

// Priority names the app renders a first-class icon for via renderPriorityIcon
// (dashboard.jsx): the Blocker/Critical flags, the High/Low chevron stacks, and the neutral
// circle used for Medium, Trivial, and the empty/none state. This mirrors that function's
// (and formatPriorityShort's) includes-based vocabulary so the priority menu can decide, per
// option, between the app's own icon and a Jira status-color dot fallback for an exotic
// priority the app has no icon for — without importing the large dashboard module. Keep this
// list aligned with renderPriorityIcon's branches if that icon vocabulary changes.
const RECOGNIZED_PRIORITY_ICON_TOKENS = [
    'blocker', 'critical', 'highest', 'high', 'major', 'medium', 'minor', 'lowest', 'low', 'trivial',
];

export function isRecognizedPriorityIconName(name) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized) return false;
    return RECOGNIZED_PRIORITY_ICON_TOKENS.some((token) => normalized.includes(token));
}

// Cache key for a per-project/issue-type priority scheme. A Jira issue's allowed priorities
// depend on its project + issue type (its priority scheme), NOT its current priority — so this
// deliberately OMITS currentPriority, unlike useEngStatusTransitions' three-part
// transitionOptionCacheKey (which must include currentStatus for transition availability).
// Mirroring that derivation here (instead of importing the status hook) keeps the two hooks
// decoupled. A context-less target still keys by project prefix so distinct issue types never
// collapse; a fully keyless target falls back to a per-key signature.
export function priorityOptionCacheKey(target) {
    const key = String(target?.key || '').trim();
    const projectKey = target?.projectKey || key.split('-')[0] || '';
    const issueType = String(target?.issueType || '').trim();
    if (!projectKey && !issueType) return `key:${key}`;
    return `${projectKey}|${issueType}`;
}

// Ascending-rank copy of a priority catalog list (defensive; the backend catalog already
// returns priorities in urgency order). Never mutates the input array.
export function sortPriorityOptionsByRank(priorities) {
    return [...(priorities || [])].sort((a, b) => (Number(a?.rank) || 0) - (Number(b?.rank) || 0));
}

// Finds the catalog rank for a given priority id, or null when the id is missing or not
// found in the supplied catalog. Never returns or logs the raw priority id/name.
export function resolvePriorityRank(priorityOptions, priorityId) {
    const id = String(priorityId || '').trim();
    if (!id) return null;
    const match = (priorityOptions || []).find((option) => String(option?.id || '') === id);
    if (!match) return null;
    const rank = Number(match.rank);
    return Number.isFinite(rank) ? rank : null;
}

// Catalog rank -> low-cardinality issue_priority_action bucket. Backend
// (backend/services/jira_issue_priorities.py shape_priority_options) assigns rank
// (index + 1) * 10 in the catalog's returned urgency order (Highest first), matching
// Jira Cloud's default five-tier scheme (Highest/High/Medium/Low/Lowest). A rank outside
// that default five tiers, or an unresolved rank, falls back to 'other'.
const PRIORITY_BUCKET_BY_RANK = {
    10: 'highest',
    20: 'high',
    30: 'medium',
    40: 'low',
    50: 'lowest',
};

export function buildPriorityBucket(rank) {
    return PRIORITY_BUCKET_BY_RANK[Number(rank)] || 'other';
}

// Turns backend per-issue priority results (which carry raw issue keys and error text)
// into a safe aggregate: counts plus a success/partial/failure enum. No raw issue details
// are read into the return value. Backend `already_in_priority` counts as success per the
// endpoint contract (an issue already at the requested priority is not a failure). Mirrors
// summarizeTransitionResults in engStatusTransitionUtils.js.
export function summarizePriorityTransitionResults(results) {
    const list = Array.isArray(results) ? results : [];
    let succeeded = 0;
    let failed = 0;
    list.forEach((entry) => {
        const outcome = String(entry?.result || '').trim().toLowerCase();
        if (outcome === 'success' || outcome === 'already_in_priority') {
            succeeded += 1;
        } else {
            failed += 1;
        }
    });
    const total = list.length;
    const result = succeeded === 0 ? 'failure' : failed === 0 ? 'success' : 'partial';
    return { total, succeeded, failed, result };
}

// After a successful priority write, patches the matching Story's rendered priority in
// place so its icon/card color reflect the change before the task-list refresh resolves.
// Epic priority writes have no matching entry in the Story task list (epicGroup.key is
// never a Story's own key there), so this is a harmless no-op for Epics: the Epic header
// icon is a derived "most urgent child Story priority" (getEpicEffectivePriority in
// engTaskUtils.js), not a value this patches directly. Returns the same array reference
// when no task matches, so a no-op call never forces an extra re-render.
export function applyLocalPriorityUpdate(tasks, issueKey, priorityPatch) {
    const key = String(issueKey || '').trim();
    if (!key || !priorityPatch) return tasks;
    const list = Array.isArray(tasks) ? tasks : [];
    let changed = false;
    const next = list.map((task) => {
        if (!task || task.key !== key) return task;
        changed = true;
        return { ...task, fields: { ...task.fields, priority: priorityPatch } };
    });
    return changed ? next : tasks;
}

// Builds the shared issue_priority_action params for priority_options_open,
// priority_change_submit, and priority_change_result. `priorityId` is omitted for
// priority_options_open, where no target priority has been chosen yet, so no
// priority_bucket key is sent. issue_type_mix/selected_count_bucket reuse the same
// low-cardinality helpers as issue_status_action instead of duplicating them.
export function buildPriorityActionAnalyticsParams({
    sourceSurface,
    targets = [],
    priorityId,
    priorityOptions = [],
    result,
} = {}) {
    const list = Array.isArray(targets) ? targets : [];
    const uniqueKeyCount = new Set(list.map((target) => String(target?.key || target || '').trim()).filter(Boolean)).size;
    return {
        source_surface: sourceSurface,
        issue_type_mix: summarizeIssueTypeMix(list),
        selected_count_bucket: buildSelectedCountBucket(uniqueKeyCount),
        ...(priorityId === undefined ? {} : { priority_bucket: buildPriorityBucket(resolvePriorityRank(priorityOptions, priorityId)) }),
        ...(result === undefined ? {} : { result }),
    };
}
