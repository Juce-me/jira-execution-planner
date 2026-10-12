import * as React from 'react';
import { restoreEngReadingAnchor, projectEngEpicOrder, projectEngReadingOrder } from './engReadingAnchor.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { createPortal } from 'react-dom';
import {
    boardScaleMax,
    buildBoardColumns,
    resolveFocus,
    resolveFocusAfterFold,
} from './engBoardColumns.js';
import { computeEpicStoryProgress } from './engBoardCardModel.js';
import {
    buildStatusCategoryIndex,
    describeStatus,
    needsOpenStoryConfirmation,
    offeredStatusNames,
    openStoryCount,
    resolveBoardDrop,
} from './engBoardDrop.js';
import { fetchIssueStatusCatalog } from '../api/jiraIssueApi.js';
import { summarizeTransitionResults } from './engStatusTransitionUtils.js';
import { trackBoardSmallScreenSupportRequest } from '../analytics/dashboardAnalytics.js';
import EngBoardEpicCard from './EngBoardEpicCard.jsx';
import EngBoardEpicPanel from './EngBoardEpicPanel.jsx';
import EngBoardHelp from './EngBoardHelp.jsx';
import EngFilterBar from './EngFilterBar.jsx';
import IssueFieldOptionMenu from '../issues/IssueFieldOptionMenu.jsx';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import { useStatusColourStyle } from '../issues/StatusColourContext.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import LoadingState from '../ui/LoadingState.jsx';

// The ENG Group Board (§6.1). Presentational over engBoardColumns.js: every rule that can be
// stated without a DOM lives there, so this file owns rendering, the centring measurement and the
// three gestures — focus a rail, fold a header, toggle a star — and nothing else.
//
// THE INVARIANT (D43, §6.1.2): exactly one column is focused and open, at all times. It is
// structural here rather than defended case by case — the rendered focus is *always* the return of
// resolveFocus, computed fresh from the live columns on every render. State holds a preference,
// never the answer, so a stale id (column deleted or renamed in settings, group switched, board
// replaced) can never reach the DOM: resolveFocus checks `preferred` against the live ids and
// falls through to the star, then the first column holding work, then simply the first.
//
// Column identity is `id` everywhere — focus, star, `data-column-id` — never `name`, because
// `board.columns[]` is shared DB-backed config and a rename must not rebind another user's focus.

// The board's own frame, in the asset's own tolerance: a column counts as off-frame once it clears
// the scroller's edge by more than a rounding pixel or two.
const OFF_FRAME_EPSILON = 4;

// How long the live region keeps the outcome of the last drop before clearing itself, and how long
// a refused card stays outlined. Both are the asset's own timings.
const ANNOUNCEMENT_MS = 6000;
const REJECTED_MS = 2600;
// Keeps a clamped drop menu clear of the viewport edge.
const MENU_EDGE_GAP = 8;

// Pane mode (docs/agents/features/2026-09-24-executed-board-column-scroll-panes.md): desktop only —
// a hovering fine pointer, so touch tablets keep the page-scroll model, and wider than the repo's
// 760px narrow breakpoint. The order of the checks is the order of the alert's `reason`.
const PANE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';
const PANE_WIDTH_QUERY = '(min-width: 761px)';
// Keeps the height gate from flapping on rounding while a viewport is resized.
const PANE_GATE_HYSTERESIS = 8;

function breachText(breach) {
    if (!breach) return '';
    return breach.dir === 'over'
        ? `${breach.by} over max ${breach.limit}`
        : `${breach.by} under min ${breach.limit}`;
}

// Private presentation support comes only from observed lane membership, never issue naming.
export function reconcileBoardReadingSupport(record, observation) {
    if (!record || !observation) return record;
    if (observation.scopeDenied) return null;
    const support = {};
    for (const lane of ['product', 'tech']) {
        const title = lane === 'product' ? 'Product' : 'Tech';
        support[lane] = new Set([...(observation.state?.[`${lane}Tasks`] || []),
            ...(observation.state?.[`loaded${title}Tasks`] || []), ...(observation.state?.[`${lane}EpicsInScope`] || [])]
            .flatMap(item => [item.key, item.fields?.epicKey].filter(Boolean)));
    }
    const origins = {}, previousSupport = {};
    for (const key of [record.group.key, ...(record.group.tasks || []).map(task => task.key)]) {
        const lanes = new Set(record.origins?.[key] || ['product', 'tech'].filter(lane => support[lane].has(key)));
        previousSupport[key] = lanes.size;
        for (const lane of ['product', 'tech']) {
            if (observation.deniedLanes?.includes(lane)) lanes.delete(lane);
            else if (support[lane].has(key) || observation.acceptedSourceKeys?.[lane]?.includes(key)) lanes.add(lane);
        }
        origins[key] = [...lanes];
    }
    if (observation.deniedEpicKeys?.includes(record.group.key) || observation.deniedIssueKeys?.includes(record.group.key)
        || (previousSupport[record.group.key] && !origins[record.group.key].length)) return null;
    const tasks = (record.group.tasks || []).filter(task => !observation.deniedIssueKeys?.includes(task.key)
        && !(previousSupport[task.key] && !origins[task.key].length));
    return { ...record, group: { ...record.group, tasks }, origins };
}

export default function EngBoardView({
    board = null, epicGroups = [], view = null, onViewChange, onConfigure, renderPriorityIcon,
    engFilters, onFacetChange, jiraUrl = '', backendUrl = '', transitionsEnabled = false,
    statusTransitions = null, priorityTransitions = null, projectTrackTransitions = null,
    issueFieldEdits = null,
    statusTransitionSubmitting = false, onSubmitStatusTransition, onFilterBarHeightChange,
    loading = false, error = null, onRetry,
    strictColumns = null, authorityPending = false, stale = false,
    onResolvedFocusChange, freshnessBridge, onInteractionChange,
}) {
    const statusStyle = useStatusColourStyle();
    const boardPresentationRef = React.useRef(null);
    const [readingRevision, setReadingRevision] = React.useState(0);
    const projectColumns = values => values.map(column => {
        const pin = boardPresentationRef.current;
        if (!pin) return column;
        return { ...column, epicGroups: projectEngEpicOrder(column.epicGroups.map(group => group.key === pin.epicKey
            ? { ...group, readingStoryKeys: pin.storyKeys, tasks: projectEngReadingOrder(group.tasks || [], pin.storyKeys) } : group), pin.epicKey, column.id === pin.columnId ? pin.slot : null) };
    });
    const columns = React.useMemo(
        () => {
            if (!Array.isArray(strictColumns)) {
                return projectColumns(buildBoardColumns({ columns: board?.columns || [], epicGroups }));
            }
            const admitted = new Set(epicGroups.map((group) => group.key));
            return projectColumns(strictColumns.map((column) => {
                const visibleGroups = column.epicGroups.filter((group) => admitted.has(group.key));
                return {
                    ...column,
                    epicGroups: visibleGroups,
                    epicCount: visibleGroups.length,
                    storyPoints: visibleGroups.reduce(
                        (total, group) => total + (Number(group.storyPoints) || 0), 0,
                    ),
                };
            }));
        },
        [board, epicGroups, strictColumns, readingRevision],
    );
    const scaleMax = boardScaleMax(columns);
    const configStarredId = React.useMemo(
        () => (columns.find((column) => column.star) || {}).id || null,
        [columns],
    );

    // Focus and star are one session-scoped view preference (§6.1). The star seeds from the shared
    // `columns[].star`, which the composer owns — a one-click control here must not rewrite group
    // config for everyone — and neither value is ever written back.
    //
    // The caller holds it, because this component unmounts on a mode switch and §12.9 requires
    // Board -> Statistics -> Board to restore the same focused column; holding it per group also
    // stops one group's focus leaking into another's.
    //
    // Derived during render, never written during render: a `view` that belongs to a different
    // board (group switch, settings save, star moved in the composer) is simply ignored in favour
    // of a fresh seed, so there is no re-seeding effect and no frame of wrong focus.
    const seed = view && view.configStarredId === configStarredId
        ? view
        : { configStarredId, starredId: configStarredId, focusedId: null };
    const starredId = seed.starredId;
    const focusedId = resolveFocus(columns, { preferred: seed.focusedId, starredId });
    React.useEffect(() => {
        onResolvedFocusChange?.(focusedId);
    }, [focusedId, onResolvedFocusChange]);

    // §6.3/§10.1: the epic detail panel. Only the key is held — the epic itself is re-read from
    // the live columns on every render, so a filter change, a refresh or a status transition that
    // moves the epic keeps the OPEN panel showing current data instead of a captured snapshot.
    // The card that opened it is remembered as a node, because Escape must return focus to it.
    const [openEpicKey, setOpenEpicKey] = React.useState(null);
    const openerRef = React.useRef(null);
    const departingGroupRef = React.useRef(null);
    const privateReadingRef = React.useRef(null);
    const canonicalOpenGroup = openEpicKey ? columns.flatMap(column => column.epicGroups).find(group => group.key === openEpicKey) : null;
    const retainedTask = boardPresentationRef.current?.task;
    const storyDeparting = retainedTask && openEpicKey === boardPresentationRef.current?.epicKey
        && !canonicalOpenGroup?.tasks.some(task => task.key === retainedTask.key);
    const panelDeparting = Boolean(openEpicKey && (!canonicalOpenGroup || storyDeparting));
    const openEpicGroup = canonicalOpenGroup && storyDeparting
        ? { ...canonicalOpenGroup, readingDepartureKeys: [retainedTask.key], tasks: projectEngReadingOrder([...canonicalOpenGroup.tasks, retainedTask], boardPresentationRef.current.storyKeys) }
        : canonicalOpenGroup || (openEpicKey && departingGroupRef.current ? { ...departingGroupRef.current,
            readingDepartureKeys: departingGroupRef.current.tasks.map(task => task.key), readingStoryKeys: boardPresentationRef.current?.storyKeys, childProgress: null,
            childrenIncomplete: false, childrenLoading: false, storyPoints: 0 } : null);

    const [departureTarget, setDepartureTarget] = React.useState(null);
    React.useLayoutEffect(() => { setDepartureTarget(panelDeparting ? document.querySelector('.epic-panel .m-head') : null); }, [panelDeparting]);

    const openPanel = (epicKey) => {
        openerRef.current = document.activeElement;
        departingGroupRef.current = null;
        setOpenEpicKey(epicKey);
    };

    const closePanel = () => {
        const opener = openerRef.current;
        const key = openEpicKey;
        openerRef.current = null;
        departingGroupRef.current = null;
        setOpenEpicKey(null);
        // The card can have unmounted while the panel was open (a transition moved the epic into
        // a folded column, a filter narrowed it away), so the stored node is only used while it is
        // still in the document, and the live card is looked up by key as the fallback.
        const target = (opener && document.contains(opener))
            ? opener
            : document.querySelector(`.eng-board .ecard[data-epic-key="${key}"] .ecard-open`);
        target?.focus();
    };

    // Leaving Board unmounts this component; the panel must not survive as orphaned state.
    React.useEffect(() => {
        if (openEpicKey && !openEpicGroup) setOpenEpicKey(null);
    }, [openEpicKey, openEpicGroup]);

    /* ── Moving an epic by dragging its card (§6.4, D37, D42) ───────────────────────────────────
       A second TRIGGER for the transition the app already performs, never a second way of
       performing it (§9.5): the options come from the hook's own single-issue status control, the
       write from the caller's onSubmitStatusTransition, and the card moves through the hook's
       existing optimistic patch — there is no board-local patch and no second refresh policy here.
       What this component owns is the gesture, the menu placement and the announcement.

       The live drag is a REF, not state: dragstart/dragover/drop can all land in one JS turn, and
       a batched setState would leave dragover reading a null drag and silently refusing every
       drop. State carries only what has to be painted. */
    const dragRef = React.useRef(null);
    const interactionRef = React.useRef({});
    const interaction = (kind, value) => { interactionRef.current[kind] = Boolean(value); onInteractionChange?.(Object.values(interactionRef.current).some(Boolean)); };
    const [draggingKey, updateDraggingKey] = React.useState('');
    const setDraggingKey = value => { interaction('drag', value); updateDraggingKey(value); };
    const [dropOverId, setDropOverId] = React.useState(null);
    // { epicKey, columnId, point, statuses, confirm: null | { status, open } }
    const [drop, updateDrop] = React.useState(null);
    const dropRef = React.useRef(null);
    const setDrop = React.useCallback(value => {
        const next = typeof value === 'function' ? value(dropRef.current) : value;
        dropRef.current = next; interactionRef.current.menu = Boolean(next);
        onInteractionChange?.(Object.values(interactionRef.current).some(Boolean)); updateDrop(next);
    }, [onInteractionChange]);
    const [rejectedKey, setRejectedKey] = React.useState('');
    const [announcement, setAnnouncement] = React.useState(null);

    const epicGroupByKey = React.useMemo(() => {
        const byKey = new Map();
        columns.forEach((column) => column.epicGroups.forEach((group) => {
            byKey.set(group.key, { group, columnId: column.id, columnName: column.name });
        }));
        return byKey;
    }, [columns]);

    const announce = React.useCallback((text, isError = false) => {
        setAnnouncement({ text, isError });
    }, []);

    React.useEffect(() => {
        if (!announcement) return undefined;
        const timer = window.setTimeout(() => setAnnouncement(null), ANNOUNCEMENT_MS);
        return () => window.clearTimeout(timer);
    }, [announcement]);

    React.useEffect(() => {
        if (!rejectedKey) return undefined;
        const timer = window.setTimeout(() => setRejectedKey(''), REJECTED_MS);
        return () => window.clearTimeout(timer);
    }, [rejectedKey]);

    // The drag borrows the hook's single-issue target — the same one the status pill sets when it
    // is clicked (openSingleIssueStatusControl). That is not bookkeeping: submitStatusTransition
    // builds its write target from it, and falls back to a key-only target with an EMPTY
    // currentStatus when it is missing, so a write that throws would roll the epic back to no
    // status at all. Released again at every terminal outcome, so a later panel open does not find
    // a pill menu already open.
    const releaseStatusTarget = React.useCallback(() => {
        statusTransitions?.closeSingleIssueStatusControl?.();
    }, [statusTransitions]);

    const refuse = React.useCallback((epicKey, text) => {
        releaseStatusTarget();
        setRejectedKey(epicKey);
        announce(text, true);
    }, [announce, releaseStatusTarget]);

    // Escape, "Keep it where it is" and an outside click all leave the epic exactly where it was,
    // and all three owe the drag its focus back (§10.1) — the confirmation is reachable only from
    // a pointer gesture, so there is nowhere else for focus to go.
    const focusCard = React.useCallback((epicKey) => {
        document.querySelector(`.eng-board .ecard[data-epic-key="${epicKey}"] .ecard-open`)?.focus();
    }, []);

    const closeDropMenu = React.useCallback(() => {
        releaseStatusTarget();
        setDrop((previous) => {
            if (previous) focusCard(previous.epicKey);
            return null;
        });
    }, [focusCard, releaseStatusTarget, setDrop]);

    // The transition status catalog, loaded lazily on the FIRST drop and never on a plain board load —
    // initial load is performance-critical and a user who never drags never pays for it. Shared
    // failure settles as an empty index rather than blocking the drop: the gate then falls back to
    // the three literal names. This is deliberately separate from the composer's project-status
    // catalog, whose `{ id, name }` contract does not carry transition category metadata.
    const [statusCategoryIndex, setStatusCategoryIndex] = React.useState(null);
    const catalogRequestedRef = React.useRef(false);
    const requestStatusCatalog = React.useCallback(() => {
        if (catalogRequestedRef.current) return;
        catalogRequestedRef.current = true;
        fetchIssueStatusCatalog(backendUrl)
            .then((payload) => setStatusCategoryIndex(buildStatusCategoryIndex(payload && payload.statuses)))
            .catch((error) => {
                if (isAuthenticationRequiredError(error)) return;
                setStatusCategoryIndex({});
            });
    }, [backendUrl]);

    // Every exit from the menu hands focus back to the card, and choosing a status is no exception
    // — the option the user clicked unmounts with the menu, so focus would otherwise fall to <body>.
    // It cannot be done inline: the optimistic patch REMOUNTS the card (out of the source column,
    // and back again if the write fails), so the handover has to happen after that commit lands.
    // Requested as state and performed in an effect, which is exactly that guarantee. On a
    // successful move the card has legitimately left for another column and this finds nothing.
    const [refocusKey, setRefocusKey] = React.useState('');
    React.useEffect(() => {
        if (!refocusKey) return;
        focusCard(refocusKey);
        setRefocusKey('');
    }, [refocusKey, focusCard]);

    const submitMove = React.useCallback(async (epicKey, column, fromName, status) => {
        setDrop(null);
        try {
            const response = await onSubmitStatusTransition?.(status, { key: epicKey });
            if (summarizeTransitionResults(response?.results).succeeded > 0) {
                announce(`${epicKey} → ${status} · ${fromName} → ${column.name}`);
                return;
            }
            refuse(epicKey, `${epicKey} — the move to ${status} did not go through. Nothing moved.`);
        } finally {
            releaseStatusTarget();
            setRefocusKey(epicKey);
        }
    }, [announce, onSubmitStatusTransition, refuse, releaseStatusTarget]);

    // The gate lives HERE, inside the move path, so a single-status column reaches it too: it is a
    // property of the destination status, not of how the status was chosen (D42). It warns, it
    // never blocks — Jira's workflow decides what is permitted.
    const moveEpic = React.useCallback((epicKey, column, status, point, confirmed) => {
        const entry = epicGroupByKey.get(epicKey);
        if (!entry) return;
        const progress = computeEpicStoryProgress(entry.group.tasks);
        // The catalog is what makes "resolved" the `done` statusCategory rather than three literal
        // names — a column holds names only, so without it the general case cannot fire at all.
        const target = describeStatus(status, statusCategoryIndex);
        if (!confirmed && needsOpenStoryConfirmation({ status: target, progress })) {
            setDrop({
                epicKey,
                columnId: column.id,
                point,
                statuses: [status],
                confirm: { status, open: openStoryCount(progress) },
            });
            return;
        }
        void submitMove(epicKey, column, entry.columnName, status);
    }, [epicGroupByKey, statusCategoryIndex, submitMove]);

    // Ask, then commit — and the asking is the hook's, unchanged. A drop asks Jira what this epic
    // can become and waits; only when that settles is the drop resolved, so the drop itself never
    // commits anything. { epicKey, sourceColumnId, columnId, point } while it waits.
    const [pendingDrop, updatePendingDrop] = React.useState(null);
    const setPendingDrop = value => { interaction('pending', value); updatePendingDrop(value); };
    const pendingColumn = pendingDrop ? columns.find((entry) => entry.id === pendingDrop.columnId) : null;
    const optionsTargetKey = statusTransitions?.activeSingleIssueTarget?.key || '';
    const optionsLoading = Boolean(statusTransitions?.transitionOptionsLoading);
    const loadedOptions = statusTransitions?.transitionOptions || null;

    React.useEffect(() => {
        if (!pendingDrop) return;
        // Wait for THIS epic's options: a settled response still belonging to the previous drag
        // would resolve the drop against the wrong workflow.
        if (optionsLoading || optionsTargetKey !== pendingDrop.epicKey) return;
        // The gate needs the status catalog, so the drop waits for it too. It is asked for at the
        // same moment as the options, so the two are in flight together rather than one after the
        // other — and after the first drop it is already cached.
        if (statusCategoryIndex === null) return;
        setPendingDrop(null);
        if (!pendingColumn) {
            // The column went away under the drop (filter change, group switch, settings save).
            releaseStatusTarget();
            return;
        }
        if (!loadedOptions) {
            refuse(pendingDrop.epicKey, `${pendingDrop.epicKey} — Jira's status options are unavailable. Nothing moved.`);
            return;
        }
        const resolution = resolveBoardDrop({
            sourceColumnId: pendingDrop.sourceColumnId,
            targetColumn: pendingColumn,
            offeredStatuses: offeredStatusNames(loadedOptions),
        });
        // Not eligible is a normal outcome, not a failure (§9.5): say so and call no write route.
        if (resolution.outcome === 'refused') {
            refuse(pendingDrop.epicKey, `${pendingDrop.epicKey} — Jira offers no transition into ${pendingColumn.name}. Nothing moved.`);
            return;
        }
        if (resolution.outcome === 'transition') {
            moveEpic(pendingDrop.epicKey, pendingColumn, resolution.statuses[0], pendingDrop.point, false);
            return;
        }
        if (resolution.outcome === 'choose') {
            setDrop({
                epicKey: pendingDrop.epicKey,
                columnId: pendingColumn.id,
                point: pendingDrop.point,
                statuses: resolution.statuses,
                confirm: null,
            });
            return;
        }
        // 'no-op' — the drop resolved to nowhere after all. Nothing is open and nothing is in
        // flight, so the borrowed single-issue target is released here like every other end state.
        releaseStatusTarget();
    }, [
        pendingDrop, pendingColumn, optionsLoading, optionsTargetKey, loadedOptions,
        statusCategoryIndex, moveEpic, refuse, releaseStatusTarget,
    ]);

    const handleCardDragStart = (event, epicKey) => {
        const entry = epicGroupByKey.get(epicKey);
        dragRef.current = { key: epicKey, columnId: entry ? entry.columnId : null };
        setDraggingKey(epicKey);
        setDrop(null);
        releaseStatusTarget();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', epicKey); // Firefox refuses a drag with no payload
    };

    const handleCardDragEnd = () => {
        dragRef.current = null;
        setDraggingKey('');
        // Clears wherever the pointer ended up, including outside every column and on a cancel.
        setDropOverId(null);
    };

    const handleColumnDragOver = (event, column) => {
        const active = dragRef.current;
        if (!active) return;
        // The source column is not a target: dropping an epic where it already is would be a
        // no-op, and highlighting it — or accepting the dragover — would promise otherwise.
        if (column.id === active.columnId) {
            setDropOverId(null);
            return;
        }
        setDropOverId(column.id);
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    };

    // dragover only ever sets or reassigns the highlight, so a pointer that leaves the board
    // entirely would otherwise keep outlining a column it is no longer over — promising a target
    // that is not there. dragleave also fires when the pointer moves onto one of the column's own
    // descendants, hence the relatedTarget check.
    const handleColumnDragLeave = (event, column) => {
        if (!dragRef.current) return;
        if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
        setDropOverId((previous) => (previous === column.id ? null : previous));
    };

    const handleColumnDrop = (event, column) => {
        const active = dragRef.current;
        if (!active || column.id === active.columnId) return;
        const entry = epicGroupByKey.get(active.key);
        if (!entry) return;
        event.preventDefault();
        setDropOverId(null);
        // Close-then-open is the status pill's own toggle, and both halves matter: close resets the
        // hook's in-flight options request (which otherwise dedupes a repeat drag of the same epic
        // into a null response), and open sets the single-issue target the write is built from and
        // asks Jira for this epic's transitions.
        statusTransitions?.closeSingleIssueStatusControl?.();
        statusTransitions?.openSingleIssueStatusControl?.(entry.group.epic, 'Epic');
        requestStatusCatalog();
        setPendingDrop({
            epicKey: active.key,
            sourceColumnId: active.columnId,
            columnId: column.id,
            point: { x: event.clientX, y: event.clientY },
        });
    };

    const dropColumn = drop ? columns.find((column) => column.id === drop.columnId) : null;
    // A filter change, a refresh or a group switch can retire the epic or the column under an open
    // menu; it must not survive as a control pointing at nothing.
    React.useEffect(() => {
        if (drop && (!dropColumn || !epicGroupByKey.has(drop.epicKey))) setDrop(null);
    }, [drop, dropColumn, epicGroupByKey]);

    // The menu is appended to <body> and positioned fixed (§10.2), so the board's overflow-x
    // scroller cannot clip it. Placement is measured rather than guessed: the panel is laid out at
    // the drop point first, then nudged back inside the viewport if it overhangs an edge.
    const dropMenuRef = React.useRef(null);
    React.useLayoutEffect(() => {
        const wrapper = dropMenuRef.current;
        const panel = wrapper && wrapper.firstElementChild;
        if (!drop || !panel) return;
        wrapper.style.left = `${drop.point.x}px`;
        wrapper.style.top = `${drop.point.y}px`;
        const rect = panel.getBoundingClientRect();
        const right = document.documentElement.clientWidth - MENU_EDGE_GAP;
        const bottom = window.innerHeight - MENU_EDGE_GAP;
        const dx = Math.min(0, right - rect.right) || 0;
        const dy = Math.min(0, bottom - rect.bottom) || 0;
        wrapper.style.left = `${Math.max(MENU_EDGE_GAP, drop.point.x + dx)}px`;
        wrapper.style.top = `${Math.max(MENU_EDGE_GAP, drop.point.y + dy)}px`;
        // IssueFieldOptionMenu takes first-option focus when it MOUNTS; the confirmation replaces
        // the options inside the same mounted menu, so focus has to be handed on explicitly or
        // Escape would have nothing to reach (§10.1). It goes to the LAST option — "Keep it where
        // it is" — because Enter on a warning must not perform the thing being warned about.
        if (drop.confirm) {
            const options = panel.querySelectorAll('.status-transition-option');
            options[options.length - 1]?.focus();
        }
    }, [drop]);

    // Both shapes of the ONE menu (§6.4, D42): the column's eligible statuses, or — one step
    // further into the same menu, never a second popup — the unresolved-story confirmation.
    const dropOptions = !drop ? [] : (drop.confirm
        ? [
            { id: 'confirm', label: `Move to ${drop.confirm.status} anyway`, status: drop.confirm.status, warn: true },
            { id: 'cancel', label: 'Keep it where it is', cancel: true },
        ]
        : drop.statuses.map((status) => ({ id: status, label: status, status })));

    const boardRef = React.useRef(null);
    const rootRef = React.useRef(null);
    const openColumnIdsRef = React.useRef(new Set());
    const paneAlertRef = React.useRef(null);
    // Why pane mode cannot apply ('touch' | 'narrow' | 'short'), or null while it applies or no
    // board is rendered. State, not a class, because the alert strip renders from it.
    const [paneBlockReason, setPaneBlockReason] = React.useState(null);
    const [smallScreenRequested, setSmallScreenRequested] = React.useState(false);
    const pendingVerticalRevealRef = React.useRef(null);
    // Only a gesture animates the scroll; mount and resize land instantly, so no test has to wait
    // on a transition that exists purely for the eye.
    const smoothRef = React.useRef(false);
    const chromeFrameRef = React.useRef(null);
    const [offFrame, setOffFrame] = React.useState({ left: 0, right: 0 });

    const syncHints = React.useCallback(() => {
        const element = boardRef.current;
        if (!element) return;
        const frame = element.getBoundingClientRect();
        let left = 0;
        let right = 0;
        Array.from(element.children).forEach((child) => {
            const rect = child.getBoundingClientRect();
            if (rect.right < frame.left + OFF_FRAME_EPSILON) left += 1;
            else if (rect.left > frame.right - OFF_FRAME_EPSILON) right += 1;
        });
        setOffFrame((previous) => (
            previous.left === left && previous.right === right ? previous : { left, right }
        ));
    }, []);

    // The bleed itself is CSS (board.css) so it can never lag a resize. What JS owns is the part
    // CSS cannot express: pad only as far as the focused column needs in order to reach the centre
    // (D7), so a wide display centres by padding alone with no pointless scrollbar and a narrow one
    // pads to 0 with the remainder still reachable by scrolling. Stale padding after a resize is
    // merely off-centre for a frame; a stale *width* would scroll the whole document sideways.
    const applyBoardLayout = React.useCallback((smooth) => {
        const element = boardRef.current;
        if (!element || !element.children.length) return;

        // The one number the CSS bleed cannot compute for itself: `100vw` counts the vertical
        // scrollbar and documentElement.clientWidth does not (D16, D29).
        document.documentElement.style.setProperty(
            '--board-scrollbar-width',
            `${Math.max(0, window.innerWidth - document.documentElement.clientWidth)}px`,
        );

        // Only widths and the gap are read, never absolute positions, so the padding still in place
        // from the previous pass cannot skew the measurement and does not need clearing first.
        const children = Array.from(element.children);
        const index = children.findIndex((child) => child.classList.contains('is-focused'));
        if (index < 0) return;
        const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
        const widths = children.map((child) => child.getBoundingClientRect().width);
        const before = widths.slice(0, index).reduce((total, width) => total + width, 0) + gap * index;
        const centre = before + widths[index] / 2;
        const contentWidth = widths.reduce((total, width) => total + width, 0) + gap * (widths.length - 1);
        const view = element.clientWidth;

        const padLeft = Math.max(0, view / 2 - centre);
        element.style.paddingLeft = `${padLeft}px`;
        element.style.paddingRight = `${Math.max(0, view / 2 - (contentWidth - centre))}px`;
        // 'instant', not 'auto': `auto` defers to the CSS `scroll-behavior: smooth` above, so a
        // mount or a resize would animate and the column would be measurably off-centre until the
        // animation landed. Only a gesture asks for smooth.
        element.scrollTo({
            left: Math.max(0, centre + padLeft - view / 2),
            behavior: smooth ? 'smooth' : 'instant',
        });
    }, []);

    // The pane class is imperative, like is-chrome-pinned: the root's className prop never changes,
    // so a React render cannot wipe it.
    const setPaneMode = React.useCallback((next, reason = null) => {
        const root = rootRef.current;
        if (root) {
            root.classList.toggle('is-pane-mode', next);
            if (!next) {
                root.style.removeProperty('--board-pane-top');
                root.style.removeProperty('--board-pane-trailing');
            }
        }
        setPaneBlockReason(next ? null : reason);
    }, []);

    const syncPaneMode = React.useCallback(() => {
        const root = rootRef.current;
        const board = boardRef.current;
        if (!root || !board) {
            setPaneMode(false);
            return;
        }
        if (!window.matchMedia?.(PANE_POINTER_QUERY).matches) {
            setPaneMode(false, 'touch');
            return;
        }
        if (!window.matchMedia(PANE_WIDTH_QUERY).matches) {
            setPaneMode(false, 'narrow');
            return;
        }
        // The board's document top, measured without the fallback alert strip so the strip that
        // only renders while the gate fails cannot hold the gate shut.
        const alert = paneAlertRef.current;
        if (alert) alert.style.display = 'none';
        const boardTop = board.getBoundingClientRect().top + window.scrollY;
        if (alert) alert.style.removeProperty('display');
        const head = board.querySelector('.col.is-focused > .col-head');
        const card = board.querySelector('.col.is-focused .ecard');
        const headSpace = head
            ? head.getBoundingClientRect().height + (parseFloat(getComputedStyle(head).marginBottom) || 0)
            : 0;
        const railHeight = parseFloat(getComputedStyle(root).getPropertyValue('--board-strip-h')) || 0;
        const required = Math.max(railHeight, headSpace + (card ? card.getBoundingClientRect().height : 0))
            - (root.classList.contains('is-pane-mode') ? PANE_GATE_HYSTERESIS : 0);
        if (window.innerHeight - boardTop < required) {
            setPaneMode(false, 'short');
            return;
        }
        setPaneMode(true);

        // The board fills the viewport below its own top, and whatever the document renders below
        // the board (today .container's bottom padding) is cancelled by a negative margin, so the
        // document is exactly one viewport tall and the page never scrolls. The trailing space is
        // measured with the margin removed so it never compounds across passes.
        root.style.setProperty('--board-pane-top', `${boardTop}px`);
        root.style.setProperty('--board-pane-trailing', '0px');
        const boardBottom = board.getBoundingClientRect().bottom + window.scrollY;
        const scroller = document.scrollingElement || document.documentElement;
        root.style.setProperty('--board-pane-trailing', `${Math.max(0, scroller.scrollHeight - boardBottom)}px`);
    }, [setPaneMode]);

    const clearBoardChrome = React.useCallback(() => {
        const board = boardRef.current;
        if (!board) return;
        board.classList.remove('is-chrome-pinned');
        board.querySelectorAll('.col').forEach((column) => {
            column.style.removeProperty('--board-chrome-left');
            column.style.removeProperty('--board-chrome-width');
            column.style.removeProperty('--board-chrome-space');
            column.style.removeProperty('--board-chrome-shift-y');
        });
    }, []);

    const syncBoardChrome = React.useCallback(() => {
        const board = boardRef.current;
        if (!board) return;
        const frame = board.getBoundingClientRect();
        const stickyTop = Math.max(
            0,
            parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0,
        );
        // Pane mode never pins chrome: the panes are the frame.
        if (rootRef.current?.classList.contains('is-pane-mode')) {
            clearBoardChrome();
            return;
        }
        const shouldPin = frame.top <= stickyTop && frame.bottom > stickyTop;
        if (!shouldPin) {
            clearBoardChrome();
            return;
        }

        // Measure each chrome element in its normal layout before promoting it to fixed position.
        board.classList.remove('is-chrome-pinned');
        const columns = Array.from(board.querySelectorAll('.col'));
        const geometry = columns.map((column) => {
            const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
            const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
            if (!chrome || getComputedStyle(chrome).display === 'none') return null;
            const columnRect = column.getBoundingClientRect();
            const chromeRect = chrome.getBoundingClientRect();
            const marginBottom = isOpen ? (parseFloat(getComputedStyle(chrome).marginBottom) || 0) : 0;
            return { column, columnRect, chromeRect, marginBottom };
        });
        if (!geometry.length || geometry.some((entry) => !entry)) {
            clearBoardChrome();
            return;
        }

        geometry.forEach(({ column, columnRect, chromeRect, marginBottom }) => {
            column.style.setProperty('--board-chrome-left', `${columnRect.left}px`);
            column.style.setProperty('--board-chrome-width', `${columnRect.width}px`);
            column.style.setProperty('--board-chrome-space', `${chromeRect.height + marginBottom}px`);
            column.style.setProperty(
                '--board-chrome-shift-y',
                `${Math.min(0, frame.bottom - stickyTop - chromeRect.height)}px`,
            );
        });
        board.classList.add('is-chrome-pinned');
    }, [clearBoardChrome]);

    const scheduleBoardChrome = React.useCallback(() => {
        if (chromeFrameRef.current !== null) return;
        chromeFrameRef.current = window.requestAnimationFrame(() => {
            chromeFrameRef.current = null;
            syncBoardChrome();
        });
    }, [syncBoardChrome]);

    const readingRef = React.useRef({});
    readingRef.current.openGroup = openEpicGroup; readingRef.current.columns = columns;
    readingRef.current.scopeKey = freshnessBridge?.current.contextKey || columns.map(column => column.id).join('|');
    const priorReadingScope = React.useRef(readingRef.current.scopeKey);
    React.useLayoutEffect(() => {
        if (priorReadingScope.current !== readingRef.current.scopeKey) { freshnessBridge?.current.release?.(); priorReadingScope.current = readingRef.current.scopeKey; }
    });
    const paneEpochsRef = React.useRef(new WeakMap());
    React.useEffect(() => {
        if (!freshnessBridge) return undefined;
        const epochs = paneEpochsRef.current;
        const settlements = new Set();
        const cancelSettlements = () => settlements.forEach(cancel => cancel());
        const releaseReading = () => { const held = boardPresentationRef.current || departingGroupRef.current || privateReadingRef.current; cancelSettlements(); boardPresentationRef.current = null; departingGroupRef.current = null; privateReadingRef.current = null; if (held) setReadingRevision(value => value + 1); };
        window.addEventListener('blur', cancelSettlements);
        document.addEventListener('visibilitychange', cancelSettlements);
        const paneFor = target => {
            const pane = target?.closest?.('.m-body,.col-body');
            return pane && ['auto', 'scroll'].includes(getComputedStyle(pane).overflowY) ? pane : window;
        };
        const move = event => {
            if (event.type === 'keydown' && (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key)
                || event.target.closest?.('input,textarea,select,[contenteditable="true"]'))) return;
            const pane = paneFor(event.target);
            epochs.set(pane, (epochs.get(pane) || 0) + 1);
            const board = boardRef.current;
            if (board && (event.deltaX || event.shiftKey || ['ArrowLeft','ArrowRight'].includes(event.key) || (event.type === 'pointerdown' && event.target === board))) epochs.set(board, (epochs.get(board) || 0) + 1);
        };
        const deliberateClick = event => { if (event.target.closest?.('button,a,input,textarea,[role="button"]')) releaseReading(); };
        document.addEventListener('click', deliberateClick);
        for (const name of ['wheel', 'touchmove', 'pointerdown', 'keydown']) document.addEventListener(name, move, { passive: true, capture: true });
        const scroll = event => {
            const board = boardRef.current;
            if (event.target === board && board.scrollLeft !== readingRef.current.expectedLeft) epochs.set(board, (epochs.get(board) || 0) + 1);
            if (readingRef.current.pending) return;
            const pin = boardPresentationRef.current;
            if (!pin) return;
            const node = readingRef.current.openGroup && pin.task
                ? Array.from(document.querySelectorAll('.epic-panel [data-story-key]')).find(row => row.dataset.storyKey === pin.task.key)
                : Array.from(board?.querySelectorAll('.ecard') || []).find(card => card.dataset.epicKey === pin.epicKey);
            const pane = paneFor(node);
            if (paneFor(event.target) !== pane || (epochs.get(pane) || 0) <= pin.movementEpoch) return;
            const top = pane === window ? freshnessBridge.current.getViewport?.().top || 0 : pane.getBoundingClientRect().top;
            const bottom = pane === window ? window.innerHeight : pane.getBoundingClientRect().bottom;
            const rect = node?.getBoundingClientRect();
            if (!rect || rect.bottom <= top || rect.top >= bottom) releaseReading();
        };
        document.addEventListener('scroll', scroll, true);
        const beforeCommit = (_data, observation = null, shouldApply = () => true) => {
            const board = boardRef.current;
            const containers = [...Array.from(board?.querySelectorAll('.col.is-open .col-body,.col.is-focused .col-body') || []),
                ...Array.from(document.querySelectorAll('.epic-panel .m-body'))].filter(pane => paneFor(pane) === pane);
            if (!rootRef.current?.classList.contains('is-pane-mode')) containers.push(window);
            const panes = containers.map(pane => {
                const origin = pane === window ? 0 : pane.getBoundingClientRect().top + pane.clientTop;
                const bottom = pane === window ? window.innerHeight : pane.getBoundingClientRect().bottom;
                const root = pane === window ? board : pane;
                const nodes = Array.from(root?.querySelectorAll('.ecard[data-epic-key],[data-story-key]') || []);
                const visible = item => { const rect = item.getBoundingClientRect(); return rect.bottom > (pane === window ? freshnessBridge.current.getViewport?.().top || 0 : origin) && rect.top < bottom; };
                const focused = document.activeElement?.closest?.('.ecard[data-epic-key],[data-story-key]');
                const node = nodes.find(item => item === focused && visible(item)) || nodes.find(visible);
                return { pane, node, origin, key: node?.dataset.storyKey || node?.dataset.epicKey,
                    selector: node?.dataset.storyKey ? '[data-story-key]' : '.ecard[data-epic-key]',
                    top: pane === window ? window.scrollY : pane.scrollTop,
                    anchor: { container: pane === window ? 'window' : 'pane', offsetTop: node ? node.getBoundingClientRect().top - origin : 0,
                        movementEpoch: epochs.get(pane) || 0, scopeKey: readingRef.current.scopeKey } };
            });
            const previous = { pin: boardPresentationRef.current, departure: departingGroupRef.current, privateReading: privateReadingRef.current };
            if (observation?.scopeDenied) boardPresentationRef.current = null;
            const readingKey = readingRef.current.openGroup?.key || panes.find(entry => entry.node)?.node?.dataset.epicKey;
            const readingColumn = readingRef.current.columns.find(column => column.epicGroups.some(group => group.key === readingKey));
            const group = readingColumn?.epicGroups.find(group => group.key === readingKey);
            const storyPane = panes.find(entry => entry.selector === '[data-story-key]');
            if (group && !boardPresentationRef.current && !observation?.scopeDenied) boardPresentationRef.current = { epicKey: readingKey, columnId: readingColumn.id,
                slot: readingColumn.epicGroups.indexOf(group), storyKeys: readingRef.current.openGroup
                    ? Array.from(document.querySelectorAll('.epic-panel [data-story-key]'), node => node.dataset.storyKey) : (group.tasks || []).map(task => task.key),
                movementEpoch: storyPane?.anchor.movementEpoch ?? panes.find(entry => entry.node?.dataset.epicKey === readingKey)?.anchor.movementEpoch ?? 0,
                task: group.tasks?.find(task => task.key === storyPane?.key) };
            if (boardPresentationRef.current) boardPresentationRef.current = { ...boardPresentationRef.current,
                movementEpoch: storyPane?.anchor.movementEpoch ?? panes.find(entry => entry.node?.dataset.epicKey === readingKey)?.anchor.movementEpoch ?? 0 };
            const heldGroup = readingRef.current.openGroup;
            if (heldGroup) privateReadingRef.current = { group: heldGroup, origins: privateReadingRef.current?.group.key === heldGroup.key ? privateReadingRef.current.origins : {} };
            privateReadingRef.current = reconcileBoardReadingSupport(privateReadingRef.current, observation);
            departingGroupRef.current = privateReadingRef.current?.group || null;
            if (observation && heldGroup && !departingGroupRef.current) { boardPresentationRef.current = null; setOpenEpicKey(null); }
            else if (boardPresentationRef.current?.task && !departingGroupRef.current?.tasks.some(task => task.key === boardPresentationRef.current.task.key)) boardPresentationRef.current = { ...boardPresentationRef.current, task: null };
            if (boardPresentationRef.current?.task && observation?.deniedIssueKeys?.includes(boardPresentationRef.current.task.key)) boardPresentationRef.current = null;
            const captured = { previous, observation, panes, shouldApply, horizontalEpoch: epochs.get(board) || 0, left: board?.scrollLeft || 0, board, scopeKey: readingRef.current.scopeKey };
            readingRef.current.pending = captured;
            return captured;
        };
        const afterCommit = (captured, changes = {}) => new Promise(resolve => {
            privateReadingRef.current = reconcileBoardReadingSupport(privateReadingRef.current, { ...captured?.observation, ...changes });
            departingGroupRef.current = privateReadingRef.current?.group || null;
            if (boardPresentationRef.current?.task && !departingGroupRef.current?.tasks.some(task => task.key === boardPresentationRef.current.task.key)) boardPresentationRef.current = { ...boardPresentationRef.current, task: null };
            if (changes.deniedIssueKeys?.includes(boardPresentationRef.current?.task?.key)) boardPresentationRef.current = null;
            if (changes.deniedEpicKeys?.includes(readingRef.current.openGroup?.key) || (!privateReadingRef.current && readingRef.current.openGroup && changes.deniedLanes?.length)) setOpenEpicKey(null);
            let frame;
            const cancel = () => { cancelAnimationFrame(frame); settlements.delete(cancel); readingRef.current.pending = null; resolve(); };
            settlements.add(cancel);
            frame = requestAnimationFrame(() => { if (!settlements.has(cancel)) return; frame = requestAnimationFrame(() => {
                let settled = false;
                try {
                    if (!captured || !captured.shouldApply() || document.visibilityState !== 'visible' || !document.hasFocus()
                        || readingRef.current.scopeKey !== captured.scopeKey) return;
                    if (captured.board?.isConnected && (epochs.get(captured.board) || 0) === captured.horizontalEpoch) { readingRef.current.expectedLeft = captured.left; captured.board.scrollLeft = captured.left; }
                    for (const entry of captured.panes) {
                        const { pane, anchor } = entry;
                        if ((epochs.get(pane) || 0) !== anchor.movementEpoch || (pane !== window && !pane.isConnected)) continue;
                        const root = pane === window ? boardRef.current : pane;
                        const nodes = Array.from(root?.querySelectorAll(entry.selector) || []);
                        const origin = pane === window ? 0 : pane.getBoundingClientRect().top + pane.clientTop;
                        const node = nodes.find(item => (item.dataset.storyKey || item.dataset.epicKey) === entry.key)
                            || nodes.sort((a, b) => Math.abs(a.getBoundingClientRect().top - origin - anchor.offsetTop) - Math.abs(b.getBoundingClientRect().top - origin - anchor.offsetTop))[0];
                        if (node) restoreEngReadingAnchor(anchor, { node, container: pane,
                            bounds: { top: entry.origin },
                            movementEpoch: epochs.get(pane) || 0, scopeKey: readingRef.current.scopeKey, win: window });
                        else if (pane === window) window.scrollTo(window.scrollX, entry.top);
                        else pane.scrollTop = entry.top;
                    }
                    settled = true;
                } finally {
                    cancel();
                    if (settled) for (const entry of captured.panes) {
                        if ((epochs.get(entry.pane) || 0) !== entry.anchor.movementEpoch) scroll({ target: entry.pane });
                    }
                }
            }); });
        });
        const cancelCommit = captured => {
            if (readingRef.current.pending !== captured) return;
            boardPresentationRef.current = captured.previous.pin; departingGroupRef.current = captured.previous.departure;
            privateReadingRef.current = captured.previous.privateReading; readingRef.current.pending = null;
        };
        Object.assign(freshnessBridge.current, { beforeCommit, afterCommit, cancelCommit,
            release: releaseReading });
        return () => {
            cancelSettlements(); document.removeEventListener('scroll', scroll, true); window.removeEventListener('blur', cancelSettlements); document.removeEventListener('visibilitychange', cancelSettlements);
            document.removeEventListener('click', deliberateClick);
            for (const name of ['wheel', 'touchmove', 'pointerdown', 'keydown']) document.removeEventListener(name, move, true);
            delete freshnessBridge.current.beforeCommit; delete freshnessBridge.current.afterCommit;
            delete freshnessBridge.current.release; delete freshnessBridge.current.cancelCommit; onInteractionChange?.(false);
        };
    }, [freshnessBridge, onInteractionChange]);

    const handleBoardScroll = React.useCallback(() => {
        syncHints();
        scheduleBoardChrome();
    }, [scheduleBoardChrome, syncHints]);

    React.useLayoutEffect(() => {
        syncPaneMode();
        // Decision 8 (spec): a folded column reopens at its top. Its .col-body stays mounted through a
        // fold and keeps its offset, so every column that was not open on the previous pass starts at 0.
        const board = boardRef.current;
        if (board) {
            const open = new Set();
            board.querySelectorAll('.col.is-open, .col.is-focused').forEach((column) => {
                open.add(column.dataset.columnId);
                if (!openColumnIdsRef.current.has(column.dataset.columnId)) {
                    const body = column.querySelector('.col-body');
                    if (body) body.scrollTop = 0;
                }
            });
            openColumnIdsRef.current = open;
        }
        if (!readingRef.current.pending) applyBoardLayout(smoothRef.current);
        smoothRef.current = false;
        syncHints();
        syncBoardChrome();
    }, [applyBoardLayout, syncBoardChrome, syncHints, syncPaneMode, columns, focusedId, starredId]);

    // The empty state renders no .board; neither the pane class nor the alert may outlive it.
    React.useLayoutEffect(() => {
        if (!boardRef.current) setPaneMode(false);
    });

    React.useLayoutEffect(() => {
        const columnId = pendingVerticalRevealRef.current;
        if (!columnId) return;
        pendingVerticalRevealRef.current = null;

        const board = boardRef.current;
        const column = board && Array.from(board.children).find((child) => child.dataset.columnId === columnId);
        // Pane mode: the page never scrolls, and the main layout pass already opened the column at
        // its top.
        if (rootRef.current?.classList.contains('is-pane-mode')) return;
        const card = column?.querySelector('.ecard');
        const header = column?.querySelector('.col-head');
        if (!card || !header || !column.classList.contains('is-focused')) return;

        const stickyTop = Math.max(
            0,
            parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0,
        );
        const headerRect = header.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const headerMarginBottom = parseFloat(getComputedStyle(header).marginBottom) || 0;
        window.scrollTo({
            top: Math.max(0, window.scrollY + cardRect.top - (stickyTop + headerRect.height + headerMarginBottom)),
            behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
    }, [columns, focusedId]);

    // A ResizeObserver on documentElement, not a window `resize` listener: it runs after layout
    // and before paint, so the re-centring lands a frame earlier. documentElement rather than the
    // board's own wrapper, because growing past the 1040px container cap leaves the wrapper's size
    // unchanged while the centre still moves.
    //
    // Only the padding and the scroll offset are recomputed here. The bleed width is CSS precisely
    // because *nothing* JS-driven is fast enough: with the width written from a resize handler the
    // board stayed wider than the new viewport and the document scrolled sideways — 132px going
    // 1280 -> 1028 — and moving that handler to this observer only shifted the lag by one step.
    React.useEffect(() => {
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => {
            syncPaneMode();
            if (!readingRef.current.pending) applyBoardLayout(false);
            syncHints();
            syncBoardChrome();
        });
        observer.observe(document.documentElement);
        return () => observer.disconnect();
    }, [applyBoardLayout, syncBoardChrome, syncHints, syncPaneMode]);

    React.useEffect(() => {
        window.addEventListener('scroll', scheduleBoardChrome, { passive: true });
        window.addEventListener('resize', scheduleBoardChrome);
        // documentElement's box is content-driven (D16/D29): once the page is taller than the
        // viewport — the exact condition pane mode cares about — shrinking the viewport further
        // stops changing that box at all, so the ResizeObserver above never fires again. The gate
        // needs the viewport height itself, which only the window resize event carries.
        window.addEventListener('resize', syncPaneMode);
        return () => {
            window.removeEventListener('scroll', scheduleBoardChrome);
            window.removeEventListener('resize', scheduleBoardChrome);
            window.removeEventListener('resize', syncPaneMode);
            if (chromeFrameRef.current !== null) {
                window.cancelAnimationFrame(chromeFrameRef.current);
                chromeFrameRef.current = null;
            }
            clearBoardChrome();
        };
    }, [clearBoardChrome, scheduleBoardChrome, syncPaneMode]);

    // --board-scrollbar-width is published on documentElement, which outlives this component, so
    // leaving Board would otherwise strand it there for the rest of the session.
    React.useEffect(() => () => {
        document.documentElement.style.removeProperty('--board-scrollbar-width');
    }, []);

    const requestSmallScreenSupport = () => {
        trackBoardSmallScreenSupportRequest(paneBlockReason);
        setSmallScreenRequested(true);
    };

    const focusColumn = (columnId) => {
        smoothRef.current = true;
        onViewChange?.({ ...seed, focusedId: columnId });
    };

    const focusFoldedRail = (event, columnId) => {
        if (event.detail > 0) {
            pendingVerticalRevealRef.current = columnId;
        }
        focusColumn(columnId);
    };

    // Folding the focused column TRANSFERS focus (D43). Nothing here can produce "no focus".
    const foldColumn = (columnId) => {
        smoothRef.current = true;
        onViewChange?.({ ...seed, focusedId: resolveFocusAfterFold(columns, { columnId, starredId }) });
    };

    const toggleStar = (columnId) => {
        const nextStarredId = starredId === columnId ? null : columnId;
        // Re-assert the invariant with the focus that is currently on screen as the preference, so
        // unstarring the focused column leaves it focused — merely unpinned.
        onViewChange?.({
            ...seed,
            starredId: nextStarredId,
            focusedId: resolveFocus(columns, { preferred: focusedId, starredId: nextStarredId }),
        });
    };

    // The hint is a control, not decoration: it focuses the next column in that direction, which
    // also centres it.
    const stepFocus = (direction) => {
        const index = columns.findIndex((column) => column.id === focusedId);
        const next = columns[index + direction];
        if (next) focusColumn(next.id);
    };

    // §6.1: a group that has never been composed is a first-run state. It says so and offers the composer, because the fix is one screen away and nothing else here
    // will help.
    const firstRun = columns.length === 1 && columns[0].isUnconfigured;

    // Carried from Task 11: on a one-column board (first-run, or a board with a single configured
    // column) both the star and Fold promise something they cannot deliver — folding the only
    // column is impossible (the focus invariant forbids it) and starring it changes nothing
    // visible. An affordance that promises nothing is the review stop D38/D46 were both written
    // about, so it is gated on there being somewhere else for focus to go, not styled away.
    const hasMultipleColumns = columns.length > 1;

    // §1's acceptance point 4, as narrowed to what O6 permits: no SINGLE facet can ever admit
    // nothing (D20's hide-at-zero and §7.3's last-option lock are both per-facet), but two facets
    // that each admit work can still intersect to zero epics. That is a legitimate result, not a
    // silent blank — it says so, the same way Catch Up's empty result does (§7.4).
    const hasNoEpics = !firstRun && epicGroups.length === 0 && !authorityPending && !loading;

    // State-specific returns live after every hook so loading/error changes never alter hook order.
    // Match EngView's fetch-state precedence and presentation: loading wins over an older error.
    const hasStrictContent = Array.isArray(strictColumns) && strictColumns.length > 0;
    const strictWorkItemLabel = Array.isArray(strictColumns) ? 'work items' : 'stories';
    // §7.1/D19: Board owns its facet set, sharing Catch Up's chip grammar only.
    const filterBar = (
            <EngFilterBar
                facets={engFilters.facets}
                selection={engFilters.selection}
                counts={engFilters.counts}
                scopeTotal={engFilters.scopeTotal}
                subject={engFilters.subject}
                readoutCount={epicGroups.length}
                readoutUnit={engFilters.readoutUnit}
                onChange={onFacetChange}
                onClearAll={() => onFacetChange?.({})}
                onHeightChange={onFilterBarHeightChange}
                boardColumns={board?.columns || []}
                renderPriorityIcon={renderPriorityIcon}
                disabled={authorityPending || (!hasStrictContent && (loading || Boolean(error)))}
                viewControls={<EngBoardHelp scaleMax={scaleMax} workItemLabel={Array.isArray(strictColumns) ? 'work items' : 'Stories'} />}
            />
    );
    if (loading && (!hasStrictContent || (authorityPending && epicGroups.length === 0))) {
        return <>{filterBar}<LoadingState title="Loading tasks" message={Array.isArray(strictColumns)
            ? 'Refreshing retained Jira work.' : 'Refreshing Jira sprint work.'} /></>;
    }
    if (error && (!hasStrictContent || (epicGroups.length === 0 && !stale))) {
        return (
            <>
                {filterBar}
                <div className="error" role="alert">
                    {error}
                    <div style={{ marginTop: '1rem' }}>
                        <button onClick={onRetry}>Retry</button>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            {stale && (
                <div className="board-data-state" role="status">
                    Showing last complete Board data. {error || ''}
                    {error && <button type="button" className="secondary compact" onClick={onRetry}>Retry</button>}
                </div>
            )}
            {!stale && error && hasStrictContent && epicGroups.length > 0 && (
                <div className="board-data-state is-error" role="alert">
                    <span>Loaded so far — {error}</span>
                    {onRetry && <button type="button" className="secondary compact" onClick={onRetry}>Retry</button>}
                </div>
            )}
            {filterBar}
            <div className="eng-board" role="region" aria-label="Group board" ref={rootRef}>
                {firstRun && (
                    <div className="board-head">
                        <div>
                            <span className="board-head-title">Epics by column</span>
                            <div className="board-head-sub board-first-run">
                                This group&apos;s board is not set up yet, so every epic in scope sits in one column.
                                Compose columns in Settings → Departments → Boards.
                            </div>
                        </div>
                        {onConfigure && (
                            <button type="button" className="secondary compact board-configure" onClick={onConfigure}>
                                Configure Group Board ↗
                            </button>
                        )}
                    </div>
                )}
                {paneBlockReason && (
                    <div className="board-data-state" role="status" ref={paneAlertRef}>
                        <span>Board needs a larger screen.</span>
                        {smallScreenRequested ? <span>Thanks, noted</span> : (
                            <button type="button" className="secondary compact" onClick={requestSmallScreenSupport}>
                                Request small-screen support
                            </button>
                        )}
                    </div>
                )}
                <span
                    className={`board-say${announcement ? ' has-message' : ''}${announcement?.isError ? ' is-error' : ''}`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {announcement ? announcement.text : ''}
                </span>

            {hasNoEpics ? (
                <EmptyState title="No epics found" className="eng-empty-results">
                    {/* Cause-neutral by default: this also renders on a cold load before tasks
                        arrive, and on a genuinely empty scope with nothing ticked, so naming the
                        filters unconditionally would assert a cause that is often false. */}
                    <p>
                        There are no epics matching the current criteria.
                        {engFilters.activeFacetCount > 0 ? ' Clear a filter in the bar above.' : ''}
                    </p>
                </EmptyState>
            ) : (
            <div className="board-scroll">
                <button
                    type="button"
                    className={`board-hint left${offFrame.left > 0 ? ' is-on' : ''}`}
                    aria-label={`Focus the previous column — ${offFrame.left} to the left`}
                    title={`${offFrame.left} column${offFrame.left === 1 ? '' : 's'} to the left`}
                    onClick={() => stepFocus(-1)}
                >
                    <span className="pip"><b>{offFrame.left}</b>◀</span>
                </button>

                <div
                    className="board"
                    ref={boardRef}
                    onScroll={handleBoardScroll}
                    data-onboarding-target="board-overview"
                    tabIndex={-1}
                >
                    {columns.map((column) => {
                        const isFocused = column.id === focusedId;
                        const isStarred = column.id === starredId;
                        const breach = breachText(column.breach);
                        const stripTitle = `${breach ? `${column.name} — ${breach}. ` : ''}Click to centre this column`;
                        return (
                            <section
                                key={column.id}
                                className={[
                                    'col',
                                    isFocused ? 'is-focused' : '',
                                    !isFocused && isStarred ? 'is-open' : '',
                                    isStarred ? 'is-starred' : '',
                                    column.breach ? 'is-breach' : '',
                                    dropOverId === column.id ? 'is-drop' : '',
                                ].filter(Boolean).join(' ')}
                                data-column-id={column.id}
                                style={{ '--board-column-accent': column.colour }}
                                // Every column is a target, open or FOLDED — the section wraps the
                                // rail as well as the body, so a folded column accepts a drop
                                // without being unfolded first (§6.4).
                                onDragOver={(event) => handleColumnDragOver(event, column)}
                                onDragLeave={(event) => handleColumnDragLeave(event, column)}
                                onDrop={(event) => handleColumnDrop(event, column)}
                            >
                                {/* D26: the whole header folds the column — the name, the count and the
                                    story-point text all do. The star is exempt because it is its own
                                    control, and a starred column has no fold action at all. The Fold
                                    button is the keyboard path; its click bubbles here. */}
                                <div
                                    className="col-head"
                                    // A named region, not a control: D26 makes the whole header the
                                    // POINTER target, and .fold is the keyboard one. Giving this div
                                    // a button role and a tabindex would add a second tab stop that
                                    // does exactly what .fold already does.
                                    role="group"
                                    aria-label={`${column.name} column`}
                                    onClick={(event) => {
                                        if (event.target.closest('.col-star')) return;
                                        if (isStarred) return;
                                        if (isFocused) foldColumn(column.id);
                                    }}
                                >
                                    {/* The label says the scope out loud (§6.1): this is a view
                                        preference for the session, and the group's default lives in
                                        the composer — so nobody is surprised when a reload restores
                                        the shared default. Withdrawn on a one-column board — see
                                        hasMultipleColumns above. */}
                                    {hasMultipleColumns && (
                                        <button
                                            type="button"
                                            className="col-star"
                                            aria-pressed={isStarred}
                                            aria-label={isStarred
                                                ? `Stop keeping ${column.name} open for this session`
                                                : `Keep ${column.name} open for this session`}
                                            title={isStarred
                                                ? 'Kept open for this session — click to release. The group’s default is set in Group Board settings.'
                                                : 'Keep this column open for this session. The group’s default is set in Group Board settings.'}
                                            onClick={() => toggleStar(column.id)}
                                        >
                                            ★
                                        </button>
                                    )}
                                    <span className="nm">{column.name}</span>
                                    <span className="ct">{column.epicCount}</span>
                                    <span className="sp">epics · {column.epicGroups.some(group => group.childrenIncomplete)
                                        ? (column.epicGroups.some(group => group.childrenLoading) ? 'SP pending' : 'SP unavailable')
                                        : `${column.storyPoints.toFixed(1)} sp`}</span>
                                    <span className="col-breach" title="Min/Max is set in Group Board settings">
                                        ⚠ {breach}
                                    </span>
                                    {hasMultipleColumns && (
                                        <button
                                            type="button"
                                            className="fold"
                                            tabIndex={isStarred ? -1 : 0}
                                            aria-label={`Fold ${column.name}`}
                                        >
                                            Fold
                                        </button>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    className="col-strip"
                                    title={stripTitle}
                                    aria-label={`Focus ${column.name}, ${column.epicCount} epics, ${column.epicGroups.some(group => group.childrenIncomplete) ? (column.epicGroups.some(group => group.childrenLoading) ? 'story points pending' : 'story points unavailable') : `${column.storyPoints.toFixed(1)} story points`}`}
                                    onClick={(event) => focusFoldedRail(event, column.id)}
                                >
                                    <span
                                        className="fill"
                                        style={{ height: `${Math.round((column.epicCount / scaleMax) * 100)}%` }}
                                    />
                                    <span className="cap">
                                        <span className="n">{column.epicCount}</span>
                                        <span className="vert">{column.name}</span>
                                    </span>
                                </button>

                                <div className="col-body">
                                    {(isFocused || isStarred) && column.epicGroups.map((epicGroup) => (
                                        <EngBoardEpicCard
                                            key={epicGroup.key}
                                            epicGroup={epicGroup}
                                            renderPriorityIcon={renderPriorityIcon}
                                            onOpen={openPanel}
                                            onDragStart={transitionsEnabled && !epicGroup.childrenIncomplete ? handleCardDragStart : null}
                                            onDragEnd={transitionsEnabled ? handleCardDragEnd : null}
                                            isDragging={draggingKey === epicGroup.key}
                                            isRejected={rejectedKey === epicGroup.key}
                                            workItemLabel={strictWorkItemLabel}
                                            issueFieldEdits={epicGroup.epic ? issueFieldEdits : null}
                                            jiraUrl={jiraUrl}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>

                <button
                    type="button"
                    className={`board-hint right${offFrame.right > 0 ? ' is-on' : ''}`}
                    aria-label={`Focus the next column — ${offFrame.right} to the right`}
                    title={`${offFrame.right} column${offFrame.right === 1 ? '' : 's'} to the right`}
                    onClick={() => stepFocus(1)}
                >
                    <span className="pip"><b>{offFrame.right}</b>▶</span>
                </button>
            </div>
            )}

            {drop && dropColumn && createPortal(
                // The SAME menu the status pill opens — IssueFieldOptionMenu is the panel
                // StatusTransitionMenu itself delegates to, so the rows, the markers, first-option
                // focus, Escape and outside-click dismissal are all inherited rather than
                // re-implemented (§10.1). What differs is only where it is anchored: a drop point
                // rather than a pill, hence the fixed wrapper.
                <div className="eng-board-drop-menu" ref={dropMenuRef} style={{ '--board-column-accent': dropColumn.colour }}>
                    <IssueFieldOptionMenu
                        blockClass="status-transition"
                        issueKey={drop.epicKey}
                        menuLabel={drop.confirm ? `Move ${drop.epicKey} to ${drop.confirm.status}?` : `Move ${drop.epicKey} to ${dropColumn.name}`}
                        leadingContent={drop.confirm ? (
                            <div className="status-transition-menu-note eng-board-drop-warn" role="alert">
                                {`${drop.epicKey} has ${drop.confirm.open} open ${drop.confirm.open === 1 ? 'story' : 'stories'}`}
                            </div>
                        ) : null}
                        options={dropOptions}
                        optionKey={(option) => option.id}
                        optionLabel={(option) => option.label}
                        renderMarker={(option) => {
                            const isStatus = option.status && !option.warn;
                            const background = isStatus ? statusStyle(option.status)?.background : undefined;
                            return (
                                <span
                                    className={isStatus
                                        ? getIssueStatusClassName(option.status, 'status-transition-option-marker')
                                        : `task-status status-transition-option-marker eng-board-drop-marker${option.warn ? ' is-warn' : ''}`}
                                    style={background ? { background } : undefined}
                                    aria-hidden="true"
                                />
                            );
                        }}
                        onSelect={(option) => {
                            if (option.cancel) {
                                closeDropMenu();
                                return;
                            }
                            moveEpic(drop.epicKey, dropColumn, option.status, drop.point, Boolean(drop.confirm));
                        }}
                        onEscape={closeDropMenu}
                        dismissRef={dropMenuRef}
                    />
                </div>,
                document.body,
            )}

            {panelDeparting && departureTarget && createPortal(<div className="board-data-state board-reading-departure" role="status" data-board-reading-departure>{canonicalOpenGroup ? `Story ${retainedTask.key}` : `Epic ${openEpicKey}`} left the current Board scope.</div>, departureTarget)}
            {openEpicGroup && (
                <EngBoardEpicPanel
                    key={openEpicGroup.key}
                    epicGroup={openEpicGroup}
                    columns={columns}
                    jiraUrl={jiraUrl}
                    backendUrl={backendUrl}
                    renderPriorityIcon={renderPriorityIcon}
                    transitionsEnabled={transitionsEnabled && !panelDeparting}
                    statusTransitions={statusTransitions}
                    priorityTransitions={priorityTransitions}
                    projectTrackTransitions={projectTrackTransitions}
                    issueFieldEdits={panelDeparting ? null : issueFieldEdits}
                    onSortChange={() => freshnessBridge?.current.release?.()}
                    statusTransitionSubmitting={statusTransitionSubmitting}
                    workItemLabel={strictWorkItemLabel}
                    workItemLabelSingular={Array.isArray(strictColumns) ? 'work item' : 'story'}
                    onSubmitStatusTransition={onSubmitStatusTransition}
                    onClose={closePanel}
                />
            )}
            </div>
        </>
    );
}
