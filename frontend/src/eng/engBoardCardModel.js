// Epic-level derived data the board's card needs but the epic payload does not carry directly
// (§4.4/D41, §6.2). Pure, no React, no DOM — testable without mounting anything, and callable
// from EngBoardEpicCard.jsx, a .jsx file the plain-Node test runner cannot import directly.

import { buildStorySubtaskProgress } from '../issues/subtaskProgressUtils.js';
import { getStatusPhaseRank } from './engTaskUtils.js';

// D41: an epic carries no project classification of its own, so classification remains derived
// from its children. Legacy callers inject their existing boolean `isTechTask` predicate. The
// strict adapter instead injects the server's closed product/tech/other child classification.
// Keeping both forms at this seam preserves the legacy Product/Tech rule without collapsing the
// strict `other` cohort into Product. A mixed Epic may genuinely set multiple flags; no children
// in scope means none.
export function classifyEpicProjects(epicGroup, isTechTask) {
    const tasks = (epicGroup && epicGroup.tasks) || [];
    let isTech = false;
    let isProduct = false;
    let isOther = false;
    tasks.forEach((task) => {
        const classification = isTechTask(task);
        if (classification === 'other') isOther = true;
        else if (classification === 'product') isProduct = true;
        else if (classification === 'tech') isTech = true;
        // Preserve the legacy predicate contract, including its ordinary truthy/falsy behavior.
        else if (classification) isTech = true;
        else isProduct = true;
    });
    return {
        isTech,
        isProduct,
        isOther,
    };
}

// §6.2 row 2's "n of m stories" bar. The epic payload never carries how many of its stories are
// done or in progress, so this counts child stories into buckets and feeds the raw counts through
// buildStorySubtaskProgress (issues/subtaskProgressUtils.js) exactly as a story's own subtask bar
// does, rather than re-deriving the percentages by hand.
//
// Issue #253. Killed is taken off the total entirely — neither done nor remaining work, the same
// line the story-subtask bar draws (backend/services/eng_subtasks.py: EXCLUDED_STATUSES) — so an
// epic of Done + Killed reads "1 of 1". Incomplete is done even though DEFAULT_STATUS_PHASE_RANKS
// ranks it 4 (that rank is for board/status SORT order). Every other rank-5 status is done, except
// the remaining abandoned-work statuses: Cancelled, Rejected and Won't do stay IN the total but
// land in `waiting` (buildStorySubtaskProgress's residual bucket), not `done`. In progress is the
// shared rank 4.
const DONE_PHASE_RANK = 5;
const IN_PROGRESS_PHASE_RANK = 4;
const EXCLUDED_STATUS_NAMES = new Set(['killed']);
const DONE_STATUS_NAMES = new Set(['incomplete']);
const ABANDONED_STATUS_NAMES = new Set(['cancelled', 'canceled', 'rejected', "won't do"]);

function classifyChildStatus(statusName) {
    const normalized = String(statusName || '').trim().toLowerCase();
    if (EXCLUDED_STATUS_NAMES.has(normalized)) return 'excluded';
    if (ABANDONED_STATUS_NAMES.has(normalized)) return 'waiting';
    if (DONE_STATUS_NAMES.has(normalized)) return 'done';
    const rank = getStatusPhaseRank(statusName);
    if (rank === DONE_PHASE_RANK) return 'done';
    if (rank === IN_PROGRESS_PHASE_RANK) return 'inProgress';
    return 'waiting';
}

export function computeEpicStoryProgress(tasks = []) {
    const list = tasks || [];
    let done = 0;
    let inProgress = 0;
    let excluded = 0;
    list.forEach((task) => {
        const bucket = classifyChildStatus(task?.fields?.status?.name);
        if (bucket === 'excluded') excluded += 1;
        else if (bucket === 'done') done += 1;
        else if (bucket === 'inProgress') inProgress += 1;
    });
    return buildStorySubtaskProgress({ total: list.length - excluded, done, inProgress });
}

export function computeEpicStatusCountProgress(statusCounts = {}, total = 0) {
    let done = 0;
    let inProgress = 0;
    let excluded = 0;
    for (const [name, count] of Object.entries(statusCounts)) {
        const bucket = classifyChildStatus(name);
        if (bucket === 'excluded') excluded += count;
        else if (bucket === 'done') done += count;
        else if (bucket === 'inProgress') inProgress += count;
    }
    return buildStorySubtaskProgress({ total: total - excluded, done, inProgress });
}
