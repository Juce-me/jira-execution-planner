// Epic-level derived data the board's card needs but the epic payload does not carry directly
// (§4.4/D41, §6.2). Pure, no React, no DOM — testable without mounting anything, and callable
// from EngBoardEpicCard.jsx, a .jsx file the plain-Node test runner cannot import directly.

import { buildStorySubtaskProgress } from '../issues/subtaskProgressUtils.js';
import { getStatusPhaseRank } from './engTaskUtils.js';

// D41: an epic carries no `projectKey` of its own — the fetch provenance that knew is discarded
// at the merge (§4.4) — so the board reuses the app's existing story-derived some() rule, the
// same shape as dashboard.jsx's own pre-existing inline copy (`scrollToFirstExcludedEpic`, not a
// fourth copy — left alone, not this module). `isTechTask` is injected rather than re-derived, so
// this module never imports techProjectKeys and never touches capacityClassification.mjs. Stories
// on both sides means the epic genuinely is both (D41, not a defect); no stories in scope means
// neither.
export function classifyEpicProjects(epicGroup, isTechTask) {
    const tasks = (epicGroup && epicGroup.tasks) || [];
    return {
        isTech: tasks.some((task) => isTechTask(task)),
        isProduct: tasks.some((task) => !isTechTask(task)),
    };
}

// §6.2 row 2's "n of m stories" bar. The epic payload never carries how many of its stories are
// done or in progress, so this counts child stories via the same status-phase buckets
// sortEpicGroups already sorts by (getStatusPhaseRank / DEFAULT_STATUS_PHASE_RANKS,
// engTaskUtils.js), then feeds the raw counts through buildStorySubtaskProgress
// (issues/subtaskProgressUtils.js) exactly as a story's own subtask bar does, rather than
// re-deriving the percentages by hand.
//
// DEFAULT_STATUS_PHASE_RANKS' "done" phase (rank 5) buckets Done alongside Killed, Cancelled,
// Rejected and Won't-do — correct for board/status SORT order, wrong for a percent-complete bar:
// a killed story is abandoned, not delivered, and filling the done segment with it overstates how
// much of the epic actually shipped. The app already draws exactly this line for the analogous
// story-subtask progress bar (backend/services/eng_subtasks.py: DONE_STATUSES = {"done"},
// EXCLUDED_STATUSES = {"killed"}). Decision here: the four abandoned-work statuses stay IN the
// total — an epic's "n of m stories" counts every story, not a filtered subset — but land in
// `waiting` (buildStorySubtaskProgress's residual bucket) rather than `done`. Treated identically
// rather than singling out Killed, so a future Cancelled/Rejected story cannot silently count as
// done while a Killed one does not.
const DONE_PHASE_RANK = 5;
const IN_PROGRESS_PHASE_RANK = 4;
const ABANDONED_STATUS_NAMES = new Set(['killed', 'cancelled', 'canceled', 'rejected', "won't do"]);

export function computeEpicStoryProgress(tasks = []) {
    const list = tasks || [];
    let done = 0;
    let inProgress = 0;
    list.forEach((task) => {
        const statusName = task?.fields?.status?.name;
        if (ABANDONED_STATUS_NAMES.has(String(statusName || '').trim().toLowerCase())) return;
        const rank = getStatusPhaseRank(statusName);
        if (rank === DONE_PHASE_RANK) done += 1;
        else if (rank === IN_PROGRESS_PHASE_RANK) inProgress += 1;
    });
    return buildStorySubtaskProgress({ total: list.length, done, inProgress });
}
