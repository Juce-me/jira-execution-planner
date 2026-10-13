// One document's presentation exception. Canonical collections never pass through this store.
let presentation = null;
let context = null;
let movementEpoch = 0;
let deliberateNode = null;
let settling = 0;
let lastViewport = null;
let viewportReader = null;
const pendingSettlements = new Set();
export function setEngReadingViewportReader(reader) {
    viewportReader = reader;
    return () => { if (viewportReader === reader) { viewportReader = null; releaseEngReadingContext(); } };
}
let expectedScroll = null;
let tableRows = [];
const readingTask = row => row?.rowKind === 'epic' ? { ...row.issue, fields: row.issue } : row?.issue;
export const setEngReadingTableRows = rows => {
    tableRows = rows;
    const row = presentation?.rowKind === 'epic' && rows.find(item => item.key === presentation.task?.key && !item.readingDeparture);
    if (row && JSON.stringify(row.issue) !== JSON.stringify(presentation.task.fields)) { presentation = { ...presentation, task: readingTask(row) }; notify(); }
};
const listeners = new Set();
const geometry = new WeakMap();
export const subscribeEngReading = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const getEngReadingPresentation = () => presentation;
const notify = () => listeners.forEach(listener => listener());
export function releaseEngReadingContext() {
    movementEpoch += 1; pendingSettlements.forEach(cancel => cancel()); expectedScroll = null; settling = 0; lastViewport = null; context = null; presentation = null; deliberateNode = null; notify();
}
export function projectEngReadingOrder(items, heldKeys = [], keyOf = item => item.key) {
    const rank = new Map(heldKeys.map((key, index) => [key, index]));
    return [...items.filter(item => rank.has(keyOf(item))).sort((a, b) => rank.get(keyOf(a)) - rank.get(keyOf(b))),
        ...items.filter(item => !rank.has(keyOf(item)))];
}
export function projectEngEpicOrder(items, pinnedKey, previousIndex, keyOf = item => item.key) {
    const pinned = items.find(item => keyOf(item) === pinnedKey);
    if (!pinned || !Number.isInteger(previousIndex)) return items;
    const rest = items.filter(item => item !== pinned);
    rest.splice(Math.min(Math.max(previousIndex, 0), rest.length), 0, pinned);
    return rest;
}
// Hold the complete one-Epic Story/requirement order around its retained reading row slot.
// Other Epics continue to follow the table's canonical comparator.
export function projectEngTableReadingOrder(rows, pin, mode) {
    if (!pin?.rowKey) return rows;
    const departure = pin.departure && !rows.some(row => row.key === pin.departure.key)
        ? [{ id: pin.rowKey, key: pin.departure.key, rowKind: pin.rowKind || 'story', epicKey: pin.epicKey, issue: pin.departure, readingDeparture: true }] : [];
    if (mode !== 'story') return projectEngEpicOrder([...rows, ...departure], pin.rowKey, pin.slot, row => row.id || row.key);
    const belongs = row => row.epicKey === pin.epicKey;
    const held = projectEngReadingOrder([...rows.filter(belongs), ...departure], pin.storyKeys, row => row.id || row.key);
    const anchorIndex = held.findIndex(row => (row.id || row.key) === pin.rowKey);
    if (anchorIndex < 0 || !Number.isInteger(pin.slot)) return rows;
    const rest = rows.filter(row => !belongs(row));
    rest.splice(Math.min(Math.max(pin.slot - anchorIndex, 0), rest.length), 0, ...held);
    return rest;
}
const selector = '[data-planning-row-key],.task-item[data-task-key],.epic-block[data-epic-key]';
const readingNode = node => node?.closest?.('[data-planning-row-key]') || node;
const identity = node => { const owner = readingNode(node); return owner?.dataset?.planningRowKey || owner?.dataset?.taskKey || owner?.dataset?.epicKey; };
const candidates = root => Array.from(root.querySelectorAll?.(selector) || []).filter(node => node === readingNode(node) && (!node.dataset.planningRowKey || (['epic', 'story'].includes(node.dataset.rowKind) && !node.classList.contains('planning-review-synthetic'))));
const containerFor = (node, win) => {
    const pane = node.closest('.col-body,.panel-body,.planning-review-scroll');
    // The spreadsheet scrolls horizontally; vertical reading belongs to the document unless it has a real vertical range.
    return pane && pane.scrollHeight > pane.clientHeight + 1 && ['auto', 'scroll'].includes(win.getComputedStyle(pane).overflowY) ? pane : win;
};
const originFor = (container, win) => container === win ? 0 : container.getBoundingClientRect().top + (container.clientTop || 0);
const boundsFor = (container, win, viewport) => container === win ? viewport : {
    top: Math.max(viewport.top, container.getBoundingClientRect().top + container.clientTop),
    bottom: Math.min(viewport.bottom, container.getBoundingClientRect().bottom),
};
const visible = (node, bounds) => { const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; };
export function captureEngReadingAnchor({ root = document, win = window, surface, scopeKey, viewport, preferredNode, epoch = movementEpoch } = {}) {
    const nodes = candidates(root);
    const preferred = readingNode((preferredNode || root.activeElement)?.closest?.(selector));
    const inView = node => node?.isConnected && nodes.includes(node) && visible(node, boundsFor(containerFor(node, win), win, viewport));
    const chosen = [preferred, deliberateNode].find(inView) || nodes.filter(node => !node.classList.contains('epic-block')).find(node => inView(node) && node.getBoundingClientRect().top >= boundsFor(containerFor(node, win), win, viewport).top) || nodes.find(inView);
    if (!chosen) return null;
    const container = containerFor(chosen, win);
    const epicKey = chosen.dataset.epicKey || chosen.closest('.epic-block')?.dataset.epicKey;
    const anchor = { surface, scopeKey, kind: chosen.dataset.planningRowKey ? 'row' : chosen.dataset.taskKey ? 'story' : 'epic',
        key: identity(chosen), issueKey: chosen.dataset.issueKey || chosen.dataset.taskKey || chosen.dataset.epicKey, epicKey, container: container === win ? 'window' : container.classList.contains('planning-review-scroll') ? 'planning-scroll' : container.classList.contains('col-body') ? 'col-body' : 'panel-body',
        offsetTop: chosen.getBoundingClientRect().top - originFor(container, win), movementEpoch: epoch };
    geometry.set(anchor, { container, scrollTop: container === win ? win.scrollY : container.scrollTop });
    return anchor;
}
export function restoreEngReadingAnchor(anchor, { node, container, bounds, movementEpoch: epoch, scopeKey, win } = {}) {
    if (!anchor || !node || epoch !== anchor.movementEpoch || scopeKey !== anchor.scopeKey) return 0;
    const delta = node.getBoundingClientRect().top - bounds.top - anchor.offsetTop;
    if (Math.abs(delta) < 0.5) return 0;
    if (anchor.container === 'window') {
        const scrollRoot = win.document.scrollingElement;
        const before = win.scrollY;
        let target = before + delta;
        // Returning above the main header hides the in-flow compact header. Include that
        // known layout change in this single correction, before its observer commits it.
        const compact = win.document.querySelector?.('.compact-sticky-header.is-visible');
        const header = win.document.querySelector?.('header');
        if (compact && header && header.getBoundingClientRect().bottom + before - target > 0) {
            const style = win.getComputedStyle(compact);
            target -= compact.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
        }
        target = Math.min(Math.max(target, 0), Math.max(0, scrollRoot.scrollHeight - win.innerHeight));
        win.scrollTo(win.scrollX, target); return target - before;
    }
    const before = container.scrollTop;
    container.scrollTop = Math.min(Math.max(before + delta, 0), Math.max(0, container.scrollHeight - container.clientHeight));
    return container.scrollTop - before;
}
export function recheckEngReadingVisibility({ root = document, win = window, viewport = viewportReader?.() || lastViewport } = {}) {
    if (!context) return;
    const node = candidates(root).find(item => identity(item) === context.key);
    if (!node || !viewport || !visible(node, boundsFor(containerFor(node, win), win, viewport))) releaseEngReadingContext();
}
export function installEngReadingEvents(root, win, readViewport) {
    const intent = event => {
        if (event.type === 'keydown' && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return;
        movementEpoch += 1;
    };
    const interact = event => {
        if (event.type === 'pointerdown') movementEpoch += 1;
        if (event.target.closest?.('[data-status-transition-trigger],[data-priority-transition-trigger],[data-project-track-transition-trigger],.issue-person-editor-trigger,.story-points-editor-wrap,input,textarea')) { releaseEngReadingContext(); return; }
        const node = readingNode(event.target.closest?.(selector));
        if (node) {
            const epicKey = node.dataset.epicKey || node.closest('.epic-block')?.dataset.epicKey;
            if (presentation && (epicKey !== presentation.epicKey || ((node.dataset.taskKey || node.dataset.rowKind === 'story') && ['story', 'row'].includes(context?.kind) && identity(node) !== context.key))) releaseEngReadingContext();
            deliberateNode = node;
        }
        else if (event.target.closest?.('button,a,[role="option"]')) releaseEngReadingContext();
    };
    const checkVisibility = () => recheckEngReadingVisibility({ root, win, viewport: viewportReader?.() || readViewport?.() || lastViewport });
    const scroll = () => {
        const internal = settling && expectedScroll && expectedScroll.windowY === win.scrollY && (!expectedScroll.container || expectedScroll.container.scrollTop === expectedScroll.top);
        if (!internal) movementEpoch += 1;
        if (!context || internal) return;
        checkVisibility();
    };
    for (const name of ['wheel', 'touchmove', 'keydown']) root.addEventListener(name, intent, { passive: true });
    for (const name of ['pointerdown', 'focusin']) root.addEventListener(name, interact);
    const navigate = event => {
        if (event.target.closest?.('a[href]') || (!event.target.closest?.(selector) && event.target.closest?.('button,[role="option"]'))) releaseEngReadingContext();
    };
    root.addEventListener('click', navigate);
    root.addEventListener('scroll', scroll, true);
    win.addEventListener('resize', checkVisibility);
    for (const name of ['popstate', 'pagehide', 'jep:auth-session-refreshed']) win.addEventListener(name, releaseEngReadingContext);
    return () => {
        for (const name of ['wheel', 'touchmove', 'keydown']) root.removeEventListener(name, intent);
        for (const name of ['pointerdown', 'focusin']) root.removeEventListener(name, interact);
        root.removeEventListener('click', navigate);
        root.removeEventListener('scroll', scroll, true);
        win.removeEventListener('resize', checkVisibility);
        for (const name of ['popstate', 'pagehide', 'jep:auth-session-refreshed']) win.removeEventListener(name, releaseEngReadingContext);
        releaseEngReadingContext();
    };
}
const supportedLanes = (task, rowKind, state, acceptedSourceKeys, deniedLanes) => ['product', 'tech'].filter(lane => {
    if (deniedLanes.includes(lane) || !task) return false;
    const title = lane === 'product' ? 'Product' : 'Tech';
    const tasks = [...(state[`${lane}Tasks`] || []), ...(state[`loaded${title}Tasks`] || [])];
    return acceptedSourceKeys[lane]?.includes(task.key) || (rowKind === 'epic'
        ? tasks.some(item => item.fields?.epicKey === task.key) || (state[`${lane}EpicsInScope`] || []).some(item => item.key === task.key)
        : tasks.some(item => item.key === task.key));
});
export function beginEngReadingCommit({ surface, scopeKey, viewport, state, deniedEpicKeys = [], deniedIssueKeys = [], deniedLanes = [], acceptedSourceKeys = {} }) {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !viewport) return null;
    lastViewport = viewport;
    const anchor = captureEngReadingAnchor({ surface, scopeKey, viewport });
    if (!anchor) return null;
    const observed = supportedLanes(presentation?.task, presentation?.rowKind, state, acceptedSourceKeys, deniedLanes);
    const origins = [...new Set([...(presentation?.originLanes || []).filter(lane => !deniedLanes.includes(lane)), ...observed])];
    const unsupported = presentation?.originLanes?.length > 0 && origins.length === 0;
    if (presentation && origins.join('|') !== (presentation.originLanes || []).join('|')) { presentation = { ...presentation, originLanes: origins }; notify(); }
    if (unsupported || deniedEpicKeys.includes(anchor.epicKey) || deniedIssueKeys.includes(anchor.issueKey)) {
        releaseEngReadingContext(); anchor.movementEpoch = movementEpoch; context = anchor; settling += 1; return anchor;
    }
    const nodes = candidates(document);
    const node = nodes.find(item => identity(item) === anchor.key);
    const block = node?.closest('.epic-block');
    const tableRow = anchor.kind === 'row' && tableRows.find(row => (row.id || row.key) === anchor.key);
    const issueKey = tableRow?.key || (anchor.kind === 'row' ? node?.dataset.issueKey : anchor.key);
    if (!presentation || presentation.epicKey !== anchor.epicKey) {
        const siblings = block ? Array.from(block.parentElement.children).filter(item => item.classList.contains('epic-block')) : [];
        const storyKeys = block ? Array.from(block.querySelectorAll('[data-task-key],[data-story-requirement-id]')).map(identityNode => identityNode.dataset.taskKey || identityNode.dataset.storyRequirementId) : tableRows.filter(row => row.epicKey === anchor.epicKey || (row.rowKind === 'epic' && row.key === anchor.epicKey)).map(row => row.id || row.key);
        presentation = { epicKey: anchor.epicKey, groupKey: state.epicDetails?.[anchor.epicKey]?.initiative?.key || null,
            slot: block ? siblings.indexOf(block) : Array.from(node?.parentElement?.children || []).indexOf(node), storyKeys, rowKey: anchor.kind === 'row' ? anchor.key : null,
            rowKind: tableRow?.rowKind, task: readingTask(tableRow) || [...(state.productTasks || []), ...(state.techTasks || [])].find(item => item.key === issueKey), departure: null };
        presentation.originLanes = supportedLanes(presentation.task, presentation.rowKind, state, acceptedSourceKeys, deniedLanes);
        notify();
    }
    context = anchor; settling += 1;
    return anchor;
}
export function finishEngReadingCommit(anchor, { scopeKey, viewport, shouldApply = () => true, deniedEpicKeys = [], deniedIssueKeys = [] } = {}) {
    if (!anchor) return Promise.resolve();
    // Force current layout/native anchoring before recording the scroll position we own.
    const existing = candidates(document).find(item => identity(item) === anchor.key);
    existing?.getBoundingClientRect();
    const pane = existing && containerFor(existing, window);
    expectedScroll = { windowY: window.scrollY, container: pane !== window ? pane : null, top: pane?.scrollTop };
    return new Promise(resolve => {
        let finished = false, timer, frame;
        const cancel = () => complete(true);
        const complete = (cancelled = false) => {
            if (finished) return;
            finished = true; window.clearTimeout(timer); window.cancelAnimationFrame?.(frame); pendingSettlements.delete(cancel);
            try {
                if (cancelled || document.visibilityState === 'hidden' || !shouldApply() || context !== anchor || anchor.movementEpoch !== movementEpoch) return;
                const container = geometry.get(anchor)?.container || window;
                const nodes = candidates(document).filter(item => !deniedEpicKeys.includes(item.dataset.epicKey || item.closest('.epic-block')?.dataset.epicKey) && !deniedIssueKeys.includes(item.dataset.issueKey || item.dataset.taskKey || item.dataset.epicKey) && containerFor(item, window) === container);
                const nearest = [...nodes].sort((a, b) => Math.abs(a.getBoundingClientRect().top - originFor(container, window) - anchor.offsetTop) - Math.abs(b.getBoundingClientRect().top - originFor(container, window) - anchor.offsetTop));
                const node = nodes.find(item => identity(item) === anchor.key) || nodes.find(item => item.classList.contains('epic-block') && item.dataset.epicKey === anchor.epicKey) || nearest[0];
                if (node) restoreEngReadingAnchor(anchor, { node, container, bounds: { top: originFor(container, window) }, movementEpoch, scopeKey, win: window });
                else {
                    const previous = geometry.get(anchor)?.scrollTop;
                    if (container === window) window.scrollTo(window.scrollX, Math.min(previous, Math.max(0, document.scrollingElement.scrollHeight - window.innerHeight)));
                    else container.scrollTop = Math.min(previous, Math.max(0, container.scrollHeight - container.clientHeight));
                }
                expectedScroll = { windowY: window.scrollY, container: container !== window ? container : null, top: container.scrollTop };
            } finally { settling = Math.max(0, settling - 1); resolve(); }
        };
        pendingSettlements.add(cancel);
        timer = window.setTimeout(() => complete(), 250);
        frame = window.requestAnimationFrame(() => { if (!finished) frame = window.requestAnimationFrame(() => complete()); });
    });
}
export function updateEngReadingCanonicalItems(items) {
    if (!presentation?.task) return;
    const task = items.find(item => item.key === presentation.task.key);
    if (task && task !== presentation.task) {
        presentation = { ...presentation, task, departure: presentation.departure ? task : null }; notify();
    }
}
export function markEngReadingDeparture(visibleKeys, deniedEpicKeys = [], visibleEpicKeys = new Set()) {
    if (!presentation) return;
    if (deniedEpicKeys.includes(presentation.epicKey)) { releaseEngReadingContext(); return; }
    const membership = presentation.rowKind === 'epic' ? visibleEpicKeys : visibleKeys;
    const departure = presentation.task && !membership.has(presentation.task.key) ? presentation.task : null;
    if (presentation.departure !== departure) { presentation = { ...presentation, departure }; notify(); }
}
