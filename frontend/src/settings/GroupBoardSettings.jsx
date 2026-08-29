import * as React from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import StatusPill from '../ui/StatusPill.jsx';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import { loadBoardStatusCatalog } from './boardStatusCatalog.js';
import { deriveDefaultBoardColumns } from '../eng/engBoardColumns.js';
import {
    BOARD_COLUMN_COLOURS,
    MAX_BOARD_COLUMNS,
    assignStatusToColumn,
    buildStatusPickerRows,
    columnEpicCount,
    createColumn,
    describeBreach,
    describeColumnMove,
    fromStoredBoard,
    moveColumn,
    parseBoundInput,
    removeStatusFromColumns,
    resolveInsertIndex,
    setStarredColumn,
    shiftColumn,
    staleColumnStatuses,
    toStoredBoard,
    unmappedStatuses,
    validateComposerBoard,
} from './groupBoardModel.js';

// The Group Board column composer (§5.4, §5.8). Presentational over groupBoardModel.js: every
// rule that can be stated without a DOM lives there, so this file owns rendering, the two drag
// gestures and the keyboard paths and nothing else.
//
// Not mounted here — the Boards sub-tab wires it in. It computes its own blocking errors from
// groupBoardModel but reports nothing upward: the mount point validates the committed board
// directly off the group draft, so the modal's existing .group-modal-validation banner and footer
// Save stay the single place errors are shown (D25); this component renders no banner of its own.

const COLOUR_NAMES = {
    '#8c8c8c': 'Grey',
    '#b37feb': 'Violet',
    '#597ef7': 'Blue',
    '#13c2c2': 'Teal',
    '#52c41a': 'Green',
    '#e8a11d': 'Amber',
    '#ff4d4f': 'Red',
};

// Each entry takes the server's own message so the banner can name the board and the Jira status
// it got back. The composer must never reduce these to one undifferentiated "unavailable": an
// unset board is an admin action away, a refused Jira read is a permissions answer, and an empty
// project status set is a Jira-side data problem — different next steps.
const CATALOG_MESSAGES = {
    no_board_configured: () => 'No Jira board is configured yet, so this group has no statuses to compose. '
        + 'Set the board in Settings → Admin first. Any columns saved earlier are shown below and are left untouched.',
    board_statuses_forbidden: (message) => `Jira would not return this board's project statuses (${message}). `
        + 'That is a permission answer, not an outage. The saved columns below are untouched; '
        + 'statuses can still be moved between them.',
    board_project_unavailable: (message) => `${message}. `
        + 'Choose a Jira project board in Settings → Admin, then reopen this tab. '
        + 'The saved columns below are untouched.',
    board_statuses_unavailable: (message) => `${message}. `
        + 'Check the project’s workflow statuses in Jira, then reopen this tab. '
        + 'The saved columns below are untouched; statuses can still be moved between them.',
};

const defaultCatalogMessage = (message) => `Could not read the board's statuses from Jira: ${message} `
    + 'The saved columns below are untouched; statuses can still be moved between them.';

// Short form of the same distinction, for the places that only have room for one line.
function catalogUnavailableLine(catalog, subject) {
    if (catalog.state === 'loading') return `Still loading the board’s statuses, so ${subject}.`;
    return catalog.code === 'no_board_configured'
        ? `No Jira board is configured, so ${subject}.`
        : `The board’s statuses could not be loaded, so ${subject}.`;
}

function boundText(value) {
    return value == null ? '' : String(value);
}

export default function GroupBoardSettings(props) {
    const {
        board = null,
        backendUrl = '',
        boardId = '',
        projectScopeKey = '',
        groupName = '',
        epicsByStatus = {},
        onChange,
        random = Math.random,
    } = props;
    const [columns, setColumns] = React.useState(() => fromStoredBoard(board));
    // `statuses` is the name list every rule here works in; `entries` keeps the catalog rows whole
    // for the shared default-column derivation.
    const [catalog, setCatalog] = React.useState({ state: 'loading', statuses: [], entries: [], code: '', message: '' });
    const catalogRef = React.useRef(catalog);
    catalogRef.current = catalog;
    const [pickerColumnId, setPickerColumnId] = React.useState(null);
    const [colourColumnId, setColourColumnId] = React.useState(null);
    const [colourFocusIndex, setColourFocusIndex] = React.useState(0);
    const [boundDrafts, setBoundDrafts] = React.useState({});
    const [boundErrors, setBoundErrors] = React.useState({});
    const [announcement, setAnnouncement] = React.useState('');
    const [dragKind, setDragKind] = React.useState(null);
    const [dropColumnId, setDropColumnId] = React.useState(null);
    const [poolIsDropTarget, setPoolIsDropTarget] = React.useState(false);

    // Read during event handlers, which see a stale closure otherwise.
    const columnsRef = React.useRef(columns);
    columnsRef.current = columns;
    const dragKindRef = React.useRef(null);
    // Which handle the current press started on. Both column reorder and chip drag are
    // handle-initiated (D38/D46), and both elements stay statically `draggable` so the browser
    // always raises dragstart — the gesture is then allowed or refused right there, from these
    // refs. Toggling `draggable` on press instead would put a React render inside the gesture
    // and a press-then-move faster than that render would silently start no drag at all.
    const pressedColumnHandleRef = React.useRef(null);
    const pressedChipGripRef = React.useRef(null);
    const draggedStatusRef = React.useRef(null);
    const draggingColumnIdRef = React.useRef(null);
    const reorderSnapshotRef = React.useRef(null);
    const reorderCommittedRef = React.useRef(false);
    const columnElementsRef = React.useRef(new Map());
    const handleElementsRef = React.useRef(new Map());
    const addStatusElementsRef = React.useRef(new Map());
    const colourCellsRef = React.useRef([]);
    const swatchElementsRef = React.useRef(new Map());
    // One place that restores focus after a re-render replaces the control that had it.
    const pendingFocusRef = React.useRef(null);
    // Every id this session has ever issued, deleted ones included: reusing one would rebind a
    // per-user focus/star state to a different column (§6.1.2).
    const usedIdsRef = React.useRef(new Set(columns.map((column) => column.id)));
    const lastEmittedRef = React.useRef(board);

    // Re-seed only when the board arrives from outside (group switch, conflict discard). A board
    // this component itself emitted must not reset the editor mid-edit.
    React.useEffect(() => {
        if (board === lastEmittedRef.current) return;
        lastEmittedRef.current = board;
        const seeded = fromStoredBoard(board);
        seeded.forEach((column) => usedIdsRef.current.add(column.id));
        setColumns(seeded);
        setBoundDrafts({});
        setBoundErrors({});
        setPickerColumnId(null);
        setColourColumnId(null);
    }, [board]);

    // Task 3 added no server cache by design; the session cache is keyed by board id so changing
    // the global board invalidates it.
    React.useEffect(() => {
        let cancelled = false;
        const previousCatalog = catalogRef.current;
        setCatalog((current) => {
            return current.state === 'loading' ? current : { ...current, state: 'loading', code: '', message: '' };
        });
        loadBoardStatusCatalog(backendUrl, { boardId, projectScopeKey })
            .then((payload) => {
                if (cancelled) return;
                const entries = (payload?.statuses || []).filter((status) => status?.name);
                setCatalog({
                    state: 'ready',
                    statuses: entries.map((status) => status.name),
                    entries,
                    code: '',
                    message: '',
                });
            })
            .catch((error) => {
                if (cancelled) return;
                if (isAuthenticationRequiredError(error)) {
                    setCatalog(previousCatalog);
                    return;
                }
                setCatalog({
                    state: 'error',
                    statuses: [],
                    entries: [],
                    code: error?.code || 'board_statuses_fetch_failed',
                    message: error?.message || '',
                });
            });
        return () => { cancelled = true; };
    }, [backendUrl, boardId, projectScopeKey]);

    const commit = (next) => {
        setColumns(next);
        const stored = toStoredBoard(next);
        lastEmittedRef.current = stored;
        onChange?.(stored);
    };

    const catalogStatuses = catalog.statuses;
    const leftover = unmappedStatuses(catalogStatuses, columns);
    const stale = staleColumnStatuses(columns, catalogStatuses);
    const staleSet = new Set(stale);
    const { errors } = validateComposerBoard(columns);
    const boundErrorMessages = Object.values(boundErrors).filter(Boolean);

    // Keyboard reorder must leave focus on the handle it was invoked from, and closing a picker
    // must not drop focus to <body> (§5.8, §10.1).
    React.useEffect(() => {
        const focus = pendingFocusRef.current;
        if (!focus) return;
        pendingFocusRef.current = null;
        focus();
    });

    React.useEffect(() => {
        if (colourColumnId == null) return;
        colourCellsRef.current[colourFocusIndex]?.focus();
    }, [colourColumnId, colourFocusIndex]);

    // Two moves that land on the same position produce identical announcement text; most screen
    // readers do not re-announce an aria-live region whose text has not changed. Clearing it after
    // each announcement guarantees the next one, even an identical one, is a real text change.
    const announcementTimerRef = React.useRef(null);
    React.useEffect(() => () => {
        if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
    }, []);
    const announce = (text) => {
        if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
        setAnnouncement(text);
        announcementTimerRef.current = setTimeout(() => setAnnouncement(''), 1000);
    };

    const resetDragState = () => {
        dragKindRef.current = null;
        pressedColumnHandleRef.current = null;
        pressedChipGripRef.current = null;
        draggedStatusRef.current = null;
        draggingColumnIdRef.current = null;
        reorderSnapshotRef.current = null;
        reorderCommittedRef.current = false;
        setDragKind(null);
        setDropColumnId(null);
        setPoolIsDropTarget(false);
    };

    /* ── Column edits ───────────────────────────────────────────────────────────────────────── */

    const updateColumn = (columnId, patch) => {
        commit(columnsRef.current.map((column) => (column.id === columnId ? { ...column, ...patch } : column)));
    };

    const addColumn = () => {
        const column = createColumn({ usedIds: usedIdsRef.current, random });
        usedIdsRef.current.add(column.id);
        commit([...columnsRef.current, column]);
    };

    // *Reset to default columns* (§5.5's second fixture). The derivation itself lives in
    // eng/engBoardColumns.js, which is also what the board falls back on, so the two surfaces
    // cannot produce different defaults — a second implementation here would be the defect this
    // action was deferred to avoid. Ids are freshly generated and recorded, never reused (§5.6).
    const resetToDefaultColumns = () => {
        const derived = deriveDefaultBoardColumns(catalog.entries, { usedIds: usedIdsRef.current, random });
        if (!derived.length) return;
        derived.forEach((column) => usedIdsRef.current.add(column.id));
        setPickerColumnId(null);
        setColourColumnId(null);
        setBoundDrafts({});
        setBoundErrors({});
        commit(derived);
        announce(`Reset to ${derived.length} default columns`);
    };

    // A deleted column must not strand an unclearable Min/Max error: boundDrafts/boundErrors are
    // keyed by column id, and with no input left to blur, only the delete itself can clear them.
    const deleteColumn = (columnId) => {
        if (pickerColumnId === columnId) setPickerColumnId(null);
        if (colourColumnId === columnId) setColourColumnId(null);
        setBoundDrafts((drafts) => {
            const next = { ...drafts };
            delete next[`${columnId}:min`];
            delete next[`${columnId}:max`];
            return next;
        });
        setBoundErrors((current) => {
            const next = { ...current };
            delete next[`${columnId}:min`];
            delete next[`${columnId}:max`];
            return next;
        });
        commit(columnsRef.current.filter((column) => column.id !== columnId));
    };

    const commitBound = (column, bound, raw) => {
        const key = `${column.id}:${bound}`;
        const result = parseBoundInput(raw, column[bound]);
        setBoundDrafts((drafts) => {
            const next = { ...drafts };
            delete next[key];
            return next;
        });
        // Named by column so the banner at the bottom (boundErrorMessages) can say which of
        // several columns' inputs is wrong, not just show a bare, unattributed message.
        const boundLabel = bound === 'min' ? 'Min' : 'Max';
        const message = result.ok ? '' : `${column.name || 'This column'} ${boundLabel}: ${result.reason}`;
        setBoundErrors((current) => ({ ...current, [key]: message }));
        if (result.value !== column[bound]) updateColumn(column.id, { [bound]: result.value });
    };

    /* ── Statuses ───────────────────────────────────────────────────────────────────────────── */

    const closePicker = (columnId) => {
        setPickerColumnId(null);
        pendingFocusRef.current = () => addStatusElementsRef.current.get(columnId)?.focus();
    };

    const assignStatus = (status, columnId) => {
        commit(assignStatusToColumn(columnsRef.current, status, columnId));
        // Only the click path has a picker to close; a drop must not pull focus anywhere.
        if (pickerColumnId === columnId) closePicker(columnId);
    };

    const removeStatus = (status) => {
        commit(removeStatusFromColumns(columnsRef.current, status));
    };

    /* ── Drag system 1: a status chip, dragged by its grip ──────────────────────────────────── */

    const onChipDragStart = (event, status) => {
        if (pressedChipGripRef.current !== status) {
            // The chip body is not a drag surface; only its grip starts the gesture (D38).
            event.preventDefault();
            return;
        }
        // Stops the column's own dragstart from claiming this gesture — the two systems share
        // this subtree and would otherwise collide (D46).
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', status);
        dragKindRef.current = 'status';
        draggedStatusRef.current = status;
        setDragKind('status');
    };

    // dragenter must preventDefault as well as dragover: an element that refuses the enter is
    // never registered as a drop target, so no dragover follows it and the drop never lands.
    const onColumnDragOverStatus = (event, columnId) => {
        if (dragKindRef.current !== 'status') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropColumnId(columnId);
    };

    const onColumnDropStatus = (event, columnId) => {
        if (dragKindRef.current !== 'status') return;
        event.preventDefault();
        event.stopPropagation();
        const status = draggedStatusRef.current;
        if (status) assignStatus(status, columnId);
        resetDragState();
    };

    const onPoolDragOver = (event) => {
        if (dragKindRef.current !== 'status') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setPoolIsDropTarget(true);
    };

    const onPoolDrop = (event) => {
        if (dragKindRef.current !== 'status') return;
        event.preventDefault();
        const status = draggedStatusRef.current;
        if (status) removeStatus(status);
        resetDragState();
    };

    /* ── Drag system 2: the column, dragged only by its handle ──────────────────────────────── */

    const onColumnDragStart = (event, column) => {
        if (dragKindRef.current === 'status') return;
        if (pressedColumnHandleRef.current !== column.id) {
            // The body is not a drag surface. Refusing here is what keeps the gestures apart.
            event.preventDefault();
            return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', column.id);
        dragKindRef.current = 'column';
        draggingColumnIdRef.current = column.id;
        reorderSnapshotRef.current = columnsRef.current;
        reorderCommittedRef.current = false;
        setDragKind('column');
    };

    // Where the dragged column belongs for a pointer at `clientX`, against the columns as they are
    // laid out right now. The drop recomputes this rather than trusting whatever the last dragover
    // previewed: a drop that arrives in the same frame as its dragover would otherwise commit the
    // pre-move order, because the previewed state has not rendered yet.
    const reorderFor = (clientX) => {
        const current = columnsRef.current;
        const fromIndex = current.findIndex((column) => column.id === draggingColumnIdRef.current);
        if (fromIndex < 0) return null;
        const midpoints = current.map((column) => {
            const element = columnElementsRef.current.get(column.id);
            if (!element) return Number.POSITIVE_INFINITY;
            const rect = element.getBoundingClientRect();
            return rect.left + (rect.width / 2);
        });
        return moveColumn(current, fromIndex, resolveInsertIndex(midpoints, clientX));
    };

    const onColumnsDragOver = (event) => {
        if (dragKindRef.current !== 'column') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const result = reorderFor(event.clientX);
        // Local only: the gap follows the pointer, but nothing is persisted until the drop.
        if (result) setColumns(result.columns);
    };

    const onColumnsDrop = (event) => {
        if (dragKindRef.current !== 'column') return;
        event.preventDefault();
        reorderCommittedRef.current = true;
        const result = reorderFor(event.clientX);
        if (result) {
            commit(result.columns);
            announce(describeColumnMove(
                result.columns[result.index].name,
                result.index,
                result.columns.length,
            ));
        }
        resetDragState();
    };

    const onColumnDragEnd = () => {
        if (dragKindRef.current === 'column' && !reorderCommittedRef.current && reorderSnapshotRef.current) {
            setColumns(reorderSnapshotRef.current);
        }
        resetDragState();
    };

    const onHandleKeyDown = (event, index) => {
        if (!event.altKey) return;
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!delta) return;
        event.preventDefault();
        const current = columnsRef.current;
        const result = shiftColumn(current, index, delta);
        if (result.index === index) return;
        commit(result.columns);
        announce(describeColumnMove(current[index].name, result.index, current.length));
        const movedId = current[index].id;
        pendingFocusRef.current = () => handleElementsRef.current.get(movedId)?.focus();
    };

    /* ── Colour grid ────────────────────────────────────────────────────────────────────────── */

    const openColourGrid = (column) => {
        if (colourColumnId === column.id) {
            setColourColumnId(null);
            return;
        }
        colourCellsRef.current = [];
        setColourFocusIndex(Math.max(0, BOARD_COLUMN_COLOURS.indexOf(column.colour)));
        setColourColumnId(column.id);
    };

    const closeColourGrid = (columnId) => {
        setColourColumnId(null);
        swatchElementsRef.current.get(columnId)?.focus();
    };

    const onColourKeyDown = (event, column) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeColourGrid(column.id);
            return;
        }
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
            : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
        if (step) {
            event.preventDefault();
            const next = (colourFocusIndex + step + BOARD_COLUMN_COLOURS.length) % BOARD_COLUMN_COLOURS.length;
            setColourFocusIndex(next);
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            pickColour(column, BOARD_COLUMN_COLOURS[colourFocusIndex]);
        }
    };

    // The only writer of `colour`, and it can only write a member of the enum.
    const pickColour = (column, colour) => {
        updateColumn(column.id, { colour });
        closeColourGrid(column.id);
    };

    /* ── Rendering ──────────────────────────────────────────────────────────────────────────── */

    const renderStatusChipBody = (status) => (
        <span className="component-name">
            <StatusPill label={status} className={getIssueStatusClassName(status)} />
        </span>
    );

    const renderColumn = (column, index) => {
        const epics = columnEpicCount(column, epicsByStatus);
        const breach = describeBreach(column, epics);
        const minError = boundErrors[`${column.id}:min`];
        const maxError = boundErrors[`${column.id}:max`];
        const rangeInvalid = column.min != null && column.max != null && column.min > column.max;
        const pickerRows = pickerColumnId === column.id
            ? buildStatusPickerRows({ columns, columnId: column.id, statuses: catalogStatuses })
            : [];
        const className = [
            'board-column',
            column.statuses.length ? '' : 'is-empty',
            breach ? 'is-breach' : '',
            dropColumnId === column.id ? 'is-drop' : '',
            dragKind === 'column' && draggingColumnIdRef.current === column.id ? 'is-reordering' : '',
        ].filter(Boolean).join(' ');

        return (
            <div
                key={column.id}
                className={className}
                style={{ '--board-column-accent': column.colour }}
                data-column-id={column.id}
                ref={(element) => {
                    if (element) columnElementsRef.current.set(column.id, element);
                    else columnElementsRef.current.delete(column.id);
                }}
                draggable
                onDragStart={(event) => onColumnDragStart(event, column)}
                onDragEnd={onColumnDragEnd}
                onDragEnter={(event) => onColumnDragOverStatus(event, column.id)}
                onDragOver={(event) => onColumnDragOverStatus(event, column.id)}
                onDragLeave={(event) => {
                    if (dragKindRef.current !== 'status') return;
                    if (!event.currentTarget.contains(event.relatedTarget)) setDropColumnId(null);
                }}
                onDrop={(event) => onColumnDropStatus(event, column.id)}
                onKeyDown={(event) => {
                    // The colour grid stops its own Escape before it reaches here.
                    if (event.key !== 'Escape' || pickerColumnId !== column.id) return;
                    event.preventDefault();
                    event.stopPropagation();
                    closePicker(column.id);
                }}
            >
                <div className="board-column-top">
                    <button
                        type="button"
                        className="board-column-drag"
                        title="Reorder column — or Alt+← / Alt+→"
                        aria-label={`Reorder ${column.name}`}
                        ref={(element) => {
                            if (element) handleElementsRef.current.set(column.id, element);
                            else handleElementsRef.current.delete(column.id);
                        }}
                        onMouseDown={() => { pressedColumnHandleRef.current = column.id; }}
                        onKeyDown={(event) => onHandleKeyDown(event, index)}
                    >
                        ⠿
                    </button>
                    <button
                        type="button"
                        className="board-column-colour"
                        aria-label={`Colour for ${column.name}`}
                        aria-expanded={colourColumnId === column.id}
                        title={`Column colour — ${COLOUR_NAMES[column.colour] || column.colour}`}
                        ref={(element) => {
                            if (element) swatchElementsRef.current.set(column.id, element);
                            else swatchElementsRef.current.delete(column.id);
                        }}
                        onClick={() => openColourGrid(column)}
                    />
                    <input
                        className="board-column-name"
                        value={column.name}
                        aria-label={`Name of column ${column.name}`}
                        onChange={(event) => updateColumn(column.id, { name: event.target.value })}
                    />
                    <button
                        type="button"
                        className="board-column-star"
                        aria-pressed={column.star}
                        title={column.star
                            ? 'Opens focused and never folds — click to release'
                            : 'Keep this column open on the board'}
                        aria-label={column.star ? `Release ${column.name}` : `Keep ${column.name} open`}
                        onClick={() => commit(setStarredColumn(columnsRef.current, column.id))}
                    >
                        ★
                    </button>
                    <button
                        type="button"
                        className="remove-btn"
                        aria-label={`Delete column ${column.name}`}
                        title="Delete column"
                        onClick={() => deleteColumn(column.id)}
                    >
                        ×
                    </button>
                </div>

                {colourColumnId === column.id && (
                    <div
                        className="board-pick board-pick-colours"
                        role="radiogroup"
                        aria-label={`Colour for ${column.name}`}
                        onKeyDown={(event) => onColourKeyDown(event, column)}
                    >
                        {BOARD_COLUMN_COLOURS.map((colour, colourIndex) => (
                            <button
                                key={colour}
                                type="button"
                                role="radio"
                                aria-checked={colour === column.colour}
                                aria-label={COLOUR_NAMES[colour] || colour}
                                title={COLOUR_NAMES[colour] || colour}
                                className="board-column-colour"
                                style={{ '--board-column-accent': colour }}
                                tabIndex={colourIndex === colourFocusIndex ? 0 : -1}
                                ref={(element) => { colourCellsRef.current[colourIndex] = element; }}
                                onClick={() => pickColour(column, colour)}
                            />
                        ))}
                    </div>
                )}

                {/* .hot marks a rejected value or an unsatisfiable min>max — both blocking (D24).
                    A breach is a fact about the work, not the config, and is already signalled by
                    the border, the animated glow and the warning line below; folding it into .hot
                    here would make a valid configuration read as invalid input. */}
                <div className="board-column-limits">
                    <label>
                        Min
                        <input
                            inputMode="numeric"
                            className={minError || rangeInvalid ? 'hot' : ''}
                            title={minError || (rangeInvalid ? 'Min is above Max.' : '')}
                            placeholder="None"
                            aria-label={`${column.name} minimum epics`}
                            value={boundDrafts[`${column.id}:min`] ?? boundText(column.min)}
                            onChange={(event) => {
                                const value = event.target.value;
                                setBoundDrafts((drafts) => ({ ...drafts, [`${column.id}:min`]: value }));
                                setBoundErrors((current) => ({ ...current, [`${column.id}:min`]: '' }));
                            }}
                            onBlur={(event) => commitBound(column, 'min', event.target.value)}
                        />
                    </label>
                    <label>
                        Max
                        <input
                            inputMode="numeric"
                            className={maxError || rangeInvalid ? 'hot' : ''}
                            title={maxError || (rangeInvalid ? 'Min is above Max.' : '')}
                            placeholder="None"
                            aria-label={`${column.name} maximum epics`}
                            value={boundDrafts[`${column.id}:max`] ?? boundText(column.max)}
                            onChange={(event) => {
                                const value = event.target.value;
                                setBoundDrafts((drafts) => ({ ...drafts, [`${column.id}:max`]: value }));
                                setBoundErrors((current) => ({ ...current, [`${column.id}:max`]: '' }));
                            }}
                            onBlur={(event) => commitBound(column, 'max', event.target.value)}
                        />
                    </label>
                </div>

                {breach ? (
                    <div className="group-modal-warning">
                        {epics} epics · {breach.by} {breach.dir === 'over' ? 'over max' : 'under min'} {breach.limit}
                    </div>
                ) : (
                    <span className="group-modal-meta">{epics} epics now</span>
                )}

                <div className="selected-components-list">
                    {column.statuses.map((status) => (
                        <span
                            key={status}
                            className={`component-chip${staleSet.has(status) ? ' is-stale' : ''}`}
                            draggable
                            data-status={status}
                            title={staleSet.has(status) ? `${status} is no longer on the board. It is kept as saved.` : undefined}
                            onDragStart={(event) => onChipDragStart(event, status)}
                            onDragEnd={resetDragState}
                        >
                            {/* Deliberately not focusable: it is a pointer-only accelerator for the
                                drag gesture, not a control in its own right (§10.1 never lists it).
                                The keyboard paths are + Add status (assign) and this chip's ×
                                (remove) — a tabbable control with no keyboard action would be worse
                                than none (D38). */}
                            <span
                                className="chip-grip"
                                aria-hidden="true"
                                onMouseDown={() => { pressedChipGripRef.current = status; }}
                            >
                                ⠿
                            </span>
                            {renderStatusChipBody(status)}
                            <button
                                type="button"
                                className="remove-btn"
                                aria-label={`Move ${status} out of ${column.name}`}
                                title="Move out of this column"
                                onClick={() => removeStatus(status)}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    <div className="board-drop">Drop here</div>
                </div>

                <button
                    type="button"
                    className="board-add-status"
                    aria-expanded={pickerColumnId === column.id}
                    ref={(element) => {
                        if (element) addStatusElementsRef.current.set(column.id, element);
                        else addStatusElementsRef.current.delete(column.id);
                    }}
                    onClick={() => setPickerColumnId(pickerColumnId === column.id ? null : column.id)}
                >
                    + Add status
                </button>

                {pickerColumnId === column.id && (
                    <div
                        className="board-pick"
                        role="group"
                        aria-label={`Statuses to add to ${column.name}`}
                    >
                        {pickerRows.length === 0 && (
                            <span className="board-pick-empty">
                                {catalog.state === 'ready'
                                    ? 'Every status is already in this column.'
                                    : catalogUnavailableLine(catalog, 'there is nothing to add')}
                            </span>
                        )}
                        {pickerRows.map((row) => (
                            <button
                                key={row.status}
                                type="button"
                                className="component-chip"
                                data-status={row.status}
                                title={row.fromColumnName
                                    ? `Move ${row.status} here from ${row.fromColumnName}`
                                    : `Add ${row.status} — currently not in a column`}
                                onClick={() => assignStatus(row.status, column.id)}
                            >
                                {renderStatusChipBody(row.status)}
                                <span className="board-pick-from">
                                    {row.fromColumnName ? `from ${row.fromColumnName}` : 'not in a column'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {!column.statuses.length && (
                    <div className="group-modal-warning">No statuses — will not render</div>
                )}
            </div>
        );
    };

    const liveColumns = columns.filter((column) => column.statuses.length);
    const scaleMax = Math.max(1, ...liveColumns.map((column) => columnEpicCount(column, epicsByStatus)));
    const breachCount = columns.filter(
        (column) => describeBreach(column, columnEpicCount(column, epicsByStatus)),
    ).length;

    return (
        <div
            className={`group-board-composer${dragKind === 'status' ? ' is-dragging-status' : ''}`}
            // Every press clears both handle records first; the handle or grip under the pointer
            // then claims this one. Without this, a press on a grip that never became a drag
            // would still authorise a later drag started from the chip body.
            onMouseDownCapture={() => {
                pressedColumnHandleRef.current = null;
                pressedChipGripRef.current = null;
            }}
        >
            <div className="component-selector">
                <label className="component-selector-label">
                    {groupName ? `Board columns — ${groupName}` : 'Board columns'}
                </label>
                <span className="group-modal-meta">
                    Put a status in a column with <b>+ Add status</b>, or drag its chip by the grip. Every status
                    belongs to exactly one column; anything left over is collected into an <b>Unmapped</b> column so
                    no epic disappears. Min and Max only warn — they never block a transition or a save.
                </span>
                {/* The asset puts this in a `.group-pane-tools` strip that production has no
                    equivalent of, so it sits here instead — beside the columns it replaces, in the
                    app's own `.group-modal-button-row` with the app's own button classes (D25). */}
                <div className="group-modal-button-row">
                    <button
                        type="button"
                        className="secondary compact"
                        disabled={catalog.state !== 'ready' || !catalog.entries.length}
                        title={catalog.state === 'ready' && catalog.entries.length
                            ? 'Replace these columns with the To Do / In Progress / Done default'
                            : catalogUnavailableLine(catalog, 'there is nothing to derive columns from')}
                        onClick={resetToDefaultColumns}
                    >
                        Reset to default columns
                    </button>
                </div>
                <div
                    className="board-columns"
                    onDragEnter={onColumnsDragOver}
                    onDragOver={onColumnsDragOver}
                    onDrop={onColumnsDrop}
                >
                    {columns.map(renderColumn)}
                    <button
                        type="button"
                        className="board-add-column"
                        disabled={columns.length >= MAX_BOARD_COLUMNS}
                        title={columns.length >= MAX_BOARD_COLUMNS ? `A board can have at most ${MAX_BOARD_COLUMNS} columns.` : undefined}
                        onClick={addColumn}
                    >
                        + Add column
                    </button>
                </div>
                {!columns.length && (
                    <span className="group-modal-meta">
                        This group has no board configured. Add a column to compose one.
                    </span>
                )}
            </div>

            <div className="component-selector">
                <label className="component-selector-label">Not in a column</label>
                <span className="group-modal-meta">
                    These render in <b>Unmapped</b> until you place them. Drag one onto a column, or use that
                    column&apos;s <b>+ Add status</b>. Dragging a chip back here removes it from its column.
                </span>
                <div
                    className={`selected-components-list board-unmapped${poolIsDropTarget ? ' is-drop' : ''}`}
                    onDragEnter={onPoolDragOver}
                    onDragOver={onPoolDragOver}
                    onDragLeave={() => setPoolIsDropTarget(false)}
                    onDrop={onPoolDrop}
                >
                    {catalog.state === 'loading' && (
                        <span className="group-modal-meta">Loading the board&apos;s statuses…</span>
                    )}
                    {catalog.state === 'error' && (
                        <span className="group-modal-meta">
                            {catalogUnavailableLine(catalog, 'nothing can be listed here')}
                        </span>
                    )}
                    {catalog.state === 'ready' && leftover.length === 0 && (
                        <span className="group-modal-meta">Nothing left over — every status is in a column.</span>
                    )}
                    {leftover.map((status) => (
                        <span
                            key={status}
                            className="component-chip"
                            draggable
                            data-status={status}
                            onDragStart={(event) => onChipDragStart(event, status)}
                            onDragEnd={resetDragState}
                        >
                            {/* Same pointer-only accelerator as the column chips above; a column's
                                + Add status is the keyboard path back out of this pool (D38). */}
                            <span
                                className="chip-grip"
                                aria-hidden="true"
                                onMouseDown={() => { pressedChipGripRef.current = status; }}
                            >
                                ⠿
                            </span>
                            {renderStatusChipBody(status)}
                        </span>
                    ))}
                    <div className="board-drop">Drop here</div>
                </div>
            </div>

            <div className="component-selector">
                <label className="component-selector-label">How the board will read</label>
                <div className="board-preview">
                    {liveColumns.map((column) => {
                        const epics = columnEpicCount(column, epicsByStatus);
                        const breach = describeBreach(column, epics);
                        const title = `${column.name}${breach
                            ? ` — ${breach.by} ${breach.dir === 'over' ? 'over max' : 'under min'}`
                            : ''}`;
                        return (
                            <div
                                key={column.id}
                                className={`col${column.star ? ' is-focused' : ''}${breach ? ' is-breach' : ''}`}
                                style={{ '--board-column-accent': column.colour }}
                                title={title}
                            >
                                <div className="col-strip">
                                    {!column.star && (
                                        <span className="fill" style={{ height: `${Math.round((epics / scaleMax) * 100)}%` }} />
                                    )}
                                    <span className="n">{epics}</span>
                                    <span className="vert">{column.name}{column.star ? ' ★' : ''}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="component-selector">
                {catalog.state === 'error' && (
                    <div className="group-modal-warning">
                        {(CATALOG_MESSAGES[catalog.code] || defaultCatalogMessage)(catalog.message)}
                    </div>
                )}
                {stale.length > 0 && (
                    <div className="group-modal-warning">
                        {stale.join(', ')} {stale.length === 1 ? 'is' : 'are'} no longer on the board. Kept as saved;
                        {stale.length === 1 ? ' it matches' : ' they match'} no epic and never blocks a save.
                    </div>
                )}
                {leftover.length > 0 && (
                    <div className="group-modal-warning">
                        {leftover.length} status{leftover.length === 1 ? '' : 'es'} unmapped — collected into an
                        Unmapped column.
                    </div>
                )}
                {breachCount > 0 && (
                    <div className="group-modal-warning">
                        {breachCount} column{breachCount === 1 ? '' : 's'} outside Min/Max. Reported only; saving is
                        not blocked.
                    </div>
                )}
                {boundErrorMessages.length > 0 && (
                    <div className="group-modal-warning">{boundErrorMessages[0]}</div>
                )}
                {catalog.state === 'ready' && !stale.length && !leftover.length && !breachCount && !errors.length && (
                    <span className="group-modal-meta">
                        All {catalogStatuses.length} statuses mapped, every column within range.
                    </span>
                )}
                <span className="group-modal-meta" aria-live="polite">{announcement}</span>
            </div>
        </div>
    );
}
