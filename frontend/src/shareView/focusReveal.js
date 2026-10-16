import { blinkElement } from '../eng/planningConfirmedEdit.js';
import { alertCardId, measureShareViewStickyBottom, SHARE_VIEW_FOCUS_MARGIN } from './focusCapture.js';

const EXPAND_WAIT_MS = 350;     // .alert-card-body animates max-height for 0.35s
const FRAME_CAP_MS = 100;       // a longer frame (a hidden tab, a stalled main thread) does not count against the budget
const SETTLE_FRAMES = 2;        // the compact header, the filter bar and the docked Planning header settle within two frames
const LANDING_TOLERANCE_PX = 1; // the capture counts a node as visible only past T + SHARE_VIEW_FOCUS_MARGIN + 1, so a landing off by more than 1 px is corrected
const SHARE_REVEAL_MS = 1700;   // the 1.6s hold-then-fade overlay plus a margin
const TASK_HIGHLIGHT_MS = 2200; // the 1.8s pulse plus the margin dashboard.jsx gives it
const INTERRUPTS = ['wheel', 'touchmove', 'pointerdown', 'touchstart', 'keydown'];
// A bare keydown of one of these is not a deliberate interaction. The list is MODIFIER_KEYS in interactionGuard.js, the source of truth for it; this
// module is committed before that one exists, so it keeps a copy instead of importing it.
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS']);
const PLANNING_ROW_SELECTOR = 'tr[data-planning-row-key][data-row-kind][data-issue-key]';

// Targets are found by comparing dataset values, never by building a selector from a link value. Each result names what paints on that target: the `data-share-reveal` attribute on the alert group, Epic block and table row, `task-highlight` (a pseudo-element overlay) on the Story
// card.
function findAlertGroup({ anchor, id }, root) {
    const cardId = alertCardId(anchor);
    const card = Array.from(root.querySelectorAll('.alert-card')).find(candidate => candidate.id === cardId);
    const group = card && Array.from(card.querySelectorAll('.alert-team-group')).find(candidate => (
        candidate.dataset.alertTeam === id && (candidate.dataset.alertKind === 'epic') === (anchor === 'followupEpics')
    ));
    if (!group) return null;
    const collapsed = card.classList.contains('collapsed') || Boolean(group.closest('.alert-card-body')?.classList.contains('collapsed'));
    return { element: group, attribute: true, collapsed, settle: true };
}

function findTarget(target, mode, root) {
    const { kind, key } = target || {};
    if (kind === 'alertTeam') return findAlertGroup(target, root);
    if (kind !== 'epic' && kind !== 'story') return null;
    if (mode === 'planning') {
        const row = Array.from(root.querySelectorAll(PLANNING_ROW_SELECTOR)).find(candidate => candidate.dataset.rowKind === kind && candidate.dataset.issueKey === key);
        if (row) return { element: row, attribute: true };
    }
    if (kind === 'story') {
        const card = Array.from(root.querySelectorAll('.task-item[data-task-key]')).find(candidate => candidate.dataset.taskKey === key);
        return card ? { element: card, className: 'task-highlight', durationMs: TASK_HIGHLIGHT_MS, belowEpicHeader: true } : null;
    }
    const block = Array.from(root.querySelectorAll('.epic-block[data-epic-key]')).find(candidate => candidate.dataset.epicKey === key);
    return block ? { element: block, attribute: true } : null;
}

const revealTimers = new WeakMap();
// The hold-then-fade overlay is driven by an attribute, so no class hook is added for a one-off reveal.
function paintShareReveal(element, win = window) {
    win.clearTimeout(revealTimers.get(element));
    element.removeAttribute('data-share-reveal');
    void element.offsetWidth;
    element.setAttribute('data-share-reveal', '');
    revealTimers.set(element, win.setTimeout(() => { element.removeAttribute('data-share-reveal'); revealTimers.delete(element); }, SHARE_REVEAL_MS));
}

// Puts the target's top SHARE_VIEW_FOCUS_MARGIN below the sticky stack, give or take LANDING_TOLERANCE_PX. An instant jump: a smooth one would still be
// moving when the settle check measures.
// A Story also clears its own Epic's header by the header's height: while the page is still moving, that header may sit pushed up by the end
// of its Epic instead of pinned, so its current position is no measure of where it will be.
function alignBelowStickyStack({ element, belowEpicHeader = false }, win) {
    const header = belowEpicHeader ? element.closest('.epic-block')?.querySelector('.epic-header') : null;
    const stackBottom = measureShareViewStickyBottom({ epicHeaders: false }) + (header ? header.getBoundingClientRect().height : 0);
    const delta = element.getBoundingClientRect().top - (stackBottom + SHARE_VIEW_FOCUS_MARGIN);
    if (Math.abs(delta) <= LANDING_TOLERANCE_PX) return;
    win.scrollTo({ top: Math.max(0, win.scrollY + delta), behavior: 'instant' });
}

// Scrolls to and blinks the link's focus target without moving keyboard focus, clearing a filter or leaving the page. A target that never
// appears within `timeoutMs` of visible time resolves 'missing'; any deliberate input or `isCancelled()` resolves 'cancelled'.
export function revealShareViewFocus(target, { mode, root = document, win = window, timeoutMs = 8000, isCancelled = () => false, onReached = () => {}, isLayoutSettled = () => true } = {}) {
    let finished = false;
    let frame = null;
    let lastTime = null;
    let elapsed = 0;
    let readySince = null;
    let settleFramesLeft = 0;
    let reached = false;
    let awaitingLayout = !isLayoutSettled();
    let layoutSettledSince = null;
    let stableTop = null;
    let stableFrames = 0;
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });

    const finish = (result) => {
        if (finished) return;
        finished = true;
        if (frame !== null) win.cancelAnimationFrame(frame);
        for (const name of INTERRUPTS) root.removeEventListener(name, onInterrupt, true);
        root.removeEventListener('visibilitychange', onVisible);
        resolveDone(result);
    };
    const schedule = () => { frame = win.requestAnimationFrame(step); };
    function onInterrupt(event) {
        if (event.isTrusted === false) return;   // an event a script dispatched is not the reader
        if (event.type === 'keydown' && MODIFIER_KEYS.has(event.key)) return;
        finish('cancelled');
    }
    function onVisible() {
        if (!finished && frame === null && root.visibilityState === 'visible') schedule();
    }
    function step(time) {
        frame = null;
        if (finished) return;
        if (isCancelled()) { finish('cancelled'); return; }
        if (root.visibilityState !== 'visible') { lastTime = null; return; }   // `visibilitychange` resumes the loop
        elapsed += lastTime === null ? 0 : Math.min(time - lastTime, FRAME_CAP_MS);
        lastTime = time;
        if (!isLayoutSettled()) awaitingLayout = true;
        const found = findTarget(target, mode, root);
        if (!found || found.collapsed) {
            readySince = null;
            settleFramesLeft = 0;
            if (!reached && elapsed >= timeoutMs) finish('missing'); else schedule();
            return;
        }
        if (reached) {
            // Keep correcting the same target without another blink or a fresh search/stage clock.
            alignBelowStickyStack(found, win);
            const top = found.element.getBoundingClientRect().top + win.scrollY;
            if (!isLayoutSettled()) { layoutSettledSince = null; stableFrames = 0; }
            else {
                layoutSettledSince = layoutSettledSince ?? time;
                stableFrames = stableTop !== null && Math.abs(top - stableTop) <= LANDING_TOLERANCE_PX ? stableFrames + 1 : 0;
                if (time - layoutSettledSince >= EXPAND_WAIT_MS && stableFrames >= SETTLE_FRAMES) { finish('revealed'); return; }
            }
            stableTop = top;
            schedule();
            return;
        }
        if (settleFramesLeft === 0) {
            readySince = readySince ?? time;
            if (found.settle && time - readySince < EXPAND_WAIT_MS) { schedule(); return; }
            alignBelowStickyStack(found, win);
            settleFramesLeft = SETTLE_FRAMES;
            schedule();
            return;
        }
        settleFramesLeft -= 1;
        if (settleFramesLeft > 0) { schedule(); return; }
        alignBelowStickyStack(found, win);
        if (found.attribute) paintShareReveal(found.element); else blinkElement(found.element, found.className, found.durationMs);
        reached = true;
        onReached();
        if (finished) return;
        if (!awaitingLayout && isLayoutSettled()) finish('revealed');
        else schedule();
    }

    for (const name of INTERRUPTS) root.addEventListener(name, onInterrupt, { capture: true, passive: true });
    root.addEventListener('visibilitychange', onVisible);
    schedule();
    return { cancel: () => finish('cancelled'), done };
}
