import * as React from 'react';
import { blinkElement, prefersReducedMotion, restoreViewportAnchor, revealIfHidden, viewportAnchor } from './planningConfirmedEdit.js';

// Motion and feedback for a CONFIRMED Planning status/priority edit (issue #250). The trigger is the explicit confirmed-edit event from
// `usePlanningIssueEdits`, never an order change on its own (filters, search, mode and column changes also reorder rows).
const MOTION_MS = 200;
const WINDOW_MARGIN_PX = 600;
const MENU_SELECTOR = '.priority-transition-menu:not(.is-portalled), .status-transition-menu:not(.is-portalled)';

function motionWindow(row) {
    const rect = row.getBoundingClientRect();
    return rect.bottom > -WINDOW_MARGIN_PX && rect.top < window.innerHeight + WINDOW_MARGIN_PX;
}

// Slides every moved row's cells (not the <tr>: the pinned cells are sticky with their own z-index) from its old position to its new one.
// The edited row's cells are raised above the rows it passes (`planning-review-moving`), which also keeps its open menu on top.
function animateMoves({ rows, before, after, edited }) {
    const animations = [];
    rows.forEach((row) => {
        const id = row.dataset.reviewRow;
        const delta = (before.get(id) ?? after.get(id)) - after.get(id);
        if (Math.abs(delta) < 1 || !motionWindow(row)) return;
        if (!edited.has(row) && row.querySelector(MENU_SELECTOR)) return; // a menu inside a transformed cell would be trapped in it
        if (edited.has(row)) row.classList.add('planning-review-moving');
        Array.from(row.cells).forEach((cell) => {
            animations.push(cell.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: MOTION_MS, easing: 'ease-out' }));
        });
    });
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => edited.forEach(row => row.classList.remove('planning-review-moving')));
}

// Table: animates the displaced rows, blinks the edited rows and reveals the latest one when it would otherwise be off-screen.
export function usePlanningRowMotion({ tbodyRef, orderSignature, pendingCount, confirmedEdit, ackConfirmed, isHeld }) {
    const positions = React.useRef(new Map());
    const anchorRef = React.useRef(null);
    // Read while the old DOM is still in place (this runs in the render that carries the event), before the commit reorders the rows.
    if (confirmedEdit?.keys.length && tbodyRef.current && !anchorRef.current) anchorRef.current = viewportAnchor(Array.from(tbodyRef.current.rows));
    React.useLayoutEffect(() => {
        const tbody = tbodyRef.current;
        if (!tbody) return undefined;
        const keys = confirmedEdit?.keys || [];
        if (keys.length) tbody.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
        const rows = Array.from(tbody.rows);
        if (keys.length) {
            // Whatever the browser's own scroll anchoring did, the reader's row goes back where it was; only a reveal below may move the page.
            restoreViewportAnchor(rows, anchorRef.current);
            anchorRef.current = null;
        }
        const origin = tbody.getBoundingClientRect().top;
        const after = new Map(rows.map(row => [row.dataset.reviewRow, row.getBoundingClientRect().top - origin]));
        if (keys.length) {
            const targets = keys.map(key => rows.find(row => row.dataset.issueKey === key)).filter(Boolean);
            if (!isHeld()) {
                const reducedMotion = prefersReducedMotion();
                if (!reducedMotion) animateMoves({ rows, before: positions.current, after, edited: new Set(targets) });
                targets.forEach(row => blinkElement(row, 'planning-review-confirmed'));
                const latest = targets.find(row => row.dataset.issueKey === confirmedEdit.latest);
                if (latest && !confirmedEdit.scrolled.has(confirmedEdit.latest)) revealIfHidden(latest, { reducedMotion });
            }
            ackConfirmed(keys);
        }
        positions.current = after;
        return undefined;
    }, [orderSignature, pendingCount, confirmedEdit]);
    React.useEffect(() => () => tbodyRef.current?.getAnimations({ subtree: true }).forEach(animation => animation.cancel()), []);
}

// List: blinks the edited Story card (or Epic block) with the existing epicFlash tint and reveals the latest when it would be off-screen.
const listCards = () => Array.from(document.querySelectorAll('.task-item[data-task-key]'));
const cardId = card => card.dataset.taskKey;

export function usePlanningListConfirmedEdit({ enabled, confirmedEdit, ackConfirmed, isHeld }) {
    const anchorRef = React.useRef(null);
    // Read in the render that carries the event, while the old DOM is still in place.
    if (enabled && confirmedEdit?.keys.length && !anchorRef.current) anchorRef.current = viewportAnchor(listCards(), cardId);
    React.useLayoutEffect(() => {
        const keys = confirmedEdit?.keys || [];
        if (!enabled || !keys.length) return;
        restoreViewportAnchor(listCards(), anchorRef.current, cardId);
        anchorRef.current = null;
        if (!isHeld()) {
            const reducedMotion = prefersReducedMotion();
            const find = key => document.querySelector(`.task-item[data-task-key="${CSS.escape(key)}"]`) || document.querySelector(`[data-epic-key="${CSS.escape(key)}"]`);
            const targets = keys.map(find).filter(Boolean);
            targets.forEach(element => blinkElement(element, 'epic-flash'));
            const latest = find(confirmedEdit.latest);
            if (latest && !confirmedEdit.scrolled.has(confirmedEdit.latest)) revealIfHidden(latest, { reducedMotion });
        }
        ackConfirmed(keys);
    }, [enabled, confirmedEdit]);
}
