import { measureStickyBottom } from '../eng/alertEpicNavigation.js';

// The sticky tiers above the reading area. The default list in alertEpicNavigation.js names `.eng-filter-bar`, which no element carries;
// the sticky filter bar is `.filterbar-wrap`. A pinned Epic header hides what is under it, so the capture counts it; a reveal asks for the stack
// without Epic headers (a target Epic's own pinned header would push it down) and adds a Story's own header by height.
const STICKY_SELECTORS = [
    '.compact-sticky-header.is-visible',
    '.filterbar-wrap',
    '.planning-panel.open',
    '.planning-review-sticky-stack',
    '.planning-review-docked-header',
];
export const measureShareViewStickyBottom = ({ epicHeaders = true } = {}) => measureStickyBottom(epicHeaders ? [...STICKY_SELECTORS, '.epic-header'] : STICKY_SELECTORS);

// Where a reveal lands its target below the sticky stack, and how far below the stack a node must reach before the capture calls it visible.
// A node that shows only the sliver the landing margin leaves above the target (the previous sibling) is not visible, so capturing right after a
// reveal returns the revealed target and a forwarded link points at the same place.
export const SHARE_VIEW_FOCUS_MARGIN = 12;

// Alert card id -> category key. These are the `sectionId` values of ALERT_SUMMARY_CONFIG in EngAlertsPanel.jsx; a test pins the pairs.
const ALERT_KEY_BY_SECTION_ID = new Map([
    ['eng-alert-missing', 'missing'],
    ['eng-alert-blocked', 'blocked'],
    ['eng-alert-followup', 'followup'],
    ['eng-alert-backlog', 'backlog'],
    ['eng-alert-missing-team', 'missingTeam'],
    ['eng-alert-missing-labels', 'missingLabels'],
    ['eng-alert-needs-stories', 'needsStories'],
    ['eng-alert-waiting', 'waiting'],
    ['eng-alert-empty', 'empty'],
    ['eng-alert-done', 'done'],
]);
const SECTION_ID_BY_ALERT_KEY = new Map(Array.from(ALERT_KEY_BY_SECTION_ID, ([sectionId, key]) => [key, sectionId]));
// `followupEpics` is the future-routed Epic list inside the `followup` card.
export const alertCardId = anchor => SECTION_ID_BY_ALERT_KEY.get(anchor === 'followupEpics' ? 'followup' : anchor);

// A group id is `team.id || team.name || 'unknown'` (groupAlertsByTeam), so an id equal to the group's own name is a name fallback.
// Only the two placeholders may be named in a link.
const ALERT_PLACEHOLDER_IDS = new Set(['unknown', 'Unknown Team']);
const ALERT_GROUP_SELECTOR = '.alert-card:not(.collapsed) .alert-card-body:not(.collapsed) .alert-team-group';
const NO_EPIC = 'NO_EPIC';
const PLANNING_ROW_SELECTOR = 'tr[data-planning-row-key][data-row-kind][data-issue-key]';

const planningRows = root => Array.from(root.querySelectorAll(PLANNING_ROW_SELECTOR))
    .filter(row => row.dataset.rowKind === 'epic' || row.dataset.rowKind === 'story');
// The table shows one row kind at a time, so the first real row names the current Epics/Stories mode.
export const readPlanningRowsMode = (root = document) => planningRows(root)[0]?.dataset.rowKind || null;

const isVisible = (element, band) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > band.top && rect.top < band.bottom;
};
// A sticky header at its `top` offset is pinned, as in measureStickyBottom; one within the landing margin below it counts too, because revealing
// the first Story of an Epic leaves that Epic's header a few pixels under its pin line and capturing right after must still name the Story.
const isPinned = (header, win) => {
    const style = win.getComputedStyle(header);
    return style.position === 'sticky' && header.getBoundingClientRect().top <= Math.max(1, Number.parseFloat(style.top) || 0) + SHARE_VIEW_FOCUS_MARGIN + 1;
};

function alertTeamFocus(group) {
    const key = ALERT_KEY_BY_SECTION_ID.get(group.closest('.alert-card')?.id);
    const id = group.dataset.alertTeam;
    if (!key || !id) return null;
    if (!ALERT_PLACEHOLDER_IDS.has(id) && id === group.querySelector('.alert-pill.team')?.textContent) return null;
    return { kind: 'alertTeam', anchor: key === 'followup' && group.dataset.alertKind === 'epic' ? 'followupEpics' : key, id };
}

function epicBlockFocus(block, band, win) {
    const epicKey = block.dataset.epicKey;
    const children = Array.from(block.children);
    const header = children.find(child => child.classList.contains('epic-header'));
    if (epicKey !== NO_EPIC && !(header && isPinned(header, win))) return { kind: 'epic', key: epicKey };
    // The header is pinned (or the block is the Epic-less bucket): the first visible card is what the reader is on.
    const card = children.find(child => (child.classList.contains('task-item') || child.classList.contains('story-requirement-card')) && isVisible(child, band));
    if (card?.classList.contains('task-item') && card.dataset.taskKey) return { kind: 'story', key: card.dataset.taskKey };
    return epicKey === NO_EPIC ? null : { kind: 'epic', key: epicKey };
}

// Read-only capture of what the sender is looking at. `T`, the sticky stack's bottom, comes from measureStickyBottom, which reads the global
// document and window: `root` and `win` are those objects in the app and the same stand-ins in tests.
export function captureShareViewFocus({ mode, rowsMode, root = document, win = window } = {}) {
    if (mode !== 'catch-up' && mode !== 'planning') return null;
    const band = { top: measureShareViewStickyBottom() + SHARE_VIEW_FOCUS_MARGIN + 1, bottom: win.innerHeight };
    if (mode === 'catch-up') {
        const group = Array.from(root.querySelectorAll(ALERT_GROUP_SELECTOR)).find(candidate => isVisible(candidate, band));
        if (group) return alertTeamFocus(group);
    } else {
        const kind = rowsMode || readPlanningRowsMode(root);
        const row = planningRows(root).find(candidate => candidate.dataset.rowKind === kind && isVisible(candidate, band));
        if (row) return { kind, key: row.dataset.issueKey };
    }
    for (const block of root.querySelectorAll('.epic-block[data-epic-key]')) {
        const focus = isVisible(block, band) ? epicBlockFocus(block, band, win) : null;
        if (focus) return focus;
    }
    return null;
}
