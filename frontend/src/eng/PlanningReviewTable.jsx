import * as React from 'react';
import { createPortal } from 'react-dom';
import useIssueFieldPopover from '../issues/useIssueFieldPopover.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import JiraMarkIcon from '../ui/JiraMarkIcon.jsx';
import { buildJiraBrowseLinkAnalytics } from '../analytics/externalLinks.js';
import { reviewCellKey, newReviewColumnId, formatReviewDisplay, insertColumnId, DEFAULT_REVIEW_HIDDEN_COLUMNS } from './planningReviewTableModel.js';
import SegmentedControl from '../ui/SegmentedControl.jsx';
import IconButton from '../ui/IconButton.jsx';
import StatusPill from '../ui/StatusPill.jsx';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import PlanningReviewBoundaryPlus from './PlanningReviewBoundaryPlus.jsx';
import PlanningReviewColumnMenu from './PlanningReviewColumnMenu.jsx';
import PlanningReviewStateCluster from './PlanningReviewStateCluster.jsx';
import { usePlanningRowMotion } from './usePlanningRowMotion.js';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import { buildPlanningReviewRows, buildPlanningReviewColumns, hasZeroStoryPoints, reviewSelectionState, reviewValue, selectedStoryPoints, sortPlanningReviewRows, planningReviewTotals } from './planningReviewTableModel.js';

function ReviewColumnPopover({ open, onClose, label, trigger, children, error, anchorClassName = '' }) {
    const wrapperRef = React.useRef(null);
    const target = document.body;
    const { triggerRef, panelRef, focusTrigger } = useIssueFieldPopover({
        blockClass: 'planning-review-popover', wrapperRef, portalTarget: target, active: open,
        onDismiss: () => close(false), useVisualViewport: true, dependencies: [children, error],
    });
    const close = restoreFocus => {
        if (panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
        onClose();
        if (restoreFocus) focusTrigger();
    };
    // Focus synchronously so Escape works the moment the panel is open.
    React.useLayoutEffect(() => {
        if (open) (panelRef.current?.querySelector('[data-autofocus]') ?? panelRef.current)?.focus({ preventScroll: true });
    }, [open]);
    return <span className={`planning-review-popover-anchor${anchorClassName ? ` ${anchorClassName}` : ''}`} ref={wrapperRef}>
        {React.cloneElement(trigger, { ref: triggerRef, 'aria-haspopup': 'dialog', 'aria-expanded': open })}
        {open && createPortal(<div ref={panelRef} className="planning-review-popover" role="dialog" aria-label={label} tabIndex={-1}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}
            onClick={event => { if (event.target.closest('[data-review-popover-close]')) close(true); }}>
            {children}{error && <p className="planning-review-guidance" role="alert">{error}</p>}
        </div>, target)}
    </span>;
}

function TrimmedValue({ value, children = value }) {
    const editable = React.isValidElement(children) && typeof children.props.onOpen === 'function';
    return <EpicHeaderValueReadout value={value} suppressed={editable && children.props.isOpen}
        measureSelector={editable ? '.issue-summary-editor-trigger' : ''} nativeSelector={editable ? '.issue-summary-editor-trigger' : ''}>
        {({ discoveryProps }) => <span {...discoveryProps} tabIndex={editable ? undefined : discoveryProps.tabIndex} className="planning-review-truncated-value">{children}</span>}
    </EpicHeaderValueReadout>;
}

function Selection({ row, selectedKeys, onToggleStory, onSelectStories }) {
    const state = reviewSelectionState(row, selectedKeys);
    const input = React.useRef(null);
    React.useEffect(() => { if (input.current) input.current.indeterminate = state.mixed; }, [state.mixed]);
    return <input ref={input} type="checkbox" checked={state.checked} disabled={state.disabled} aria-label={`Select ${row.key || row.summary}`} onChange={event => row.rowKind === 'story' ? onToggleStory?.(row.issue) : onSelectStories?.(state.tasks, event.target.checked)} />;
}

function CustomCell({ row, column, review, editing, setEditing, focusNew, onHold }) {
    const stored = reviewValue(row, { ...column, custom: true }, review.cells);
    const value = column.type === 'number' ? formatReviewDisplay(stored) : stored;
    const persistedInput = review.drafts?.[reviewCellKey(row.rowKind, row.issueId, column.id)]?.input;
    const [draft, setDraft] = React.useState(persistedInput ?? value ?? '');
    const [error, setError] = React.useState('');
    const ref = React.useRef(null);
    const initialInput = React.useRef(persistedInput ?? value ?? '');
    const cancelBlur = React.useRef(false);
    const holding = React.useRef(false);
    // The row is held while this input has focus, so a reorder or a filter change cannot unmount it; blur, unmount and row removal release it.
    const hold = on => { if (holding.current !== on) { holding.current = on; onHold?.(on ? row.key : null); } };
    React.useEffect(() => () => { if (holding.current) onHold?.(null); }, []);
    React.useEffect(() => { if (document.activeElement !== ref.current) { setDraft(persistedInput ?? value ?? ''); if (persistedInput === undefined) setError(''); } }, [value, editing, persistedInput]);
    React.useEffect(() => { if (focusNew) ref.current?.focus(); }, [focusNew]);
    if (row.synthetic || !row.issueId) return <span aria-label="No review value">—</span>;
    const commit = () => {
        if (cancelBlur.current) { cancelBlur.current = false; return true; }
        const result = review.setCell(row, column, draft);
        setError(result.error || '');
        if (result.valid) setEditing(null);
        return result.valid;
    };
    return <><input ref={ref} className={`planning-review-input ${error ? 'invalid' : ''}`} type="text" inputMode={column.type === 'number' ? 'decimal' : 'text'} aria-label={`${column.label} for ${row.key}`} aria-invalid={Boolean(error)} maxLength={column.type === 'text' ? 500 : 16} value={draft} disabled={!review.capabilities?.canSave || review.saving} onFocus={() => { initialInput.current = draft; hold(true); setEditing(row.id); }} onChange={event => { setDraft(event.target.value); const result = review.setCell(row, column, event.target.value); setError(result.error || ''); }} onBlur={() => { hold(false); return commit(); }} onKeyDown={event => { if (event.key === 'Enter') { if (commit()) ref.current.blur(); } else if (event.key === 'Escape') { cancelBlur.current = true; review.setCell(row, column, initialInput.current); setDraft(initialInput.current); setError(''); setEditing(null); ref.current.blur(); } }} />{error && <span className="planning-review-validation" role="alert">{error}</span>}</>;
}

export function PlanningReviewScopeDialog({ review }) {
    if (!review?.pendingScopeChange) return null;
    return <div className="planning-review-dialog-backdrop"><div className="planning-review-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-review-leave-heading">
        <h3 id="planning-review-leave-heading">Save this Sprint review?</h3><p>Your review has unsaved changes. Save or discard them before changing Sprint.</p>
        {review.error && <p role="alert">{review.error}</p>}
        <div className="planning-review-dialog-actions"><button type="button" className="planning-action-button" disabled={review.saving || !review.capabilities?.canSave || review.unconfirmed || Boolean(review.conflict)} onClick={() => review.resolveScopeChange('save')}>Save review</button><button type="button" className="planning-action-button" disabled={review.saving} onClick={() => review.resolveScopeChange('discard')}>Discard</button><button type="button" className="planning-action-button" disabled={review.saving} onClick={() => review.resolveScopeChange('stay')}>Stay</button></div>
    </div></div>;
}

export default function PlanningReviewTable({ epicGroups = [], visibleTasks = [], selectedStoryKeys = new Set(), onToggleStory, onSelectStories, jiraUrl = '', review, getTeamInfo, admittedTeamCount, admittedProjectCount, renderPriorityIcon, renderFieldEditor, onReviewAction, toolbarHost, excludedEpicSet = new Set(), pendingOriginals = null, onHoldRow, confirmedEdit = null, onConfirmedEditHandled, isRowHeld }) {
    const [mode, setMode] = React.useState('epic');
    const hidden = new Set(review.layouts?.[mode]?.hidden ?? DEFAULT_REVIEW_HIDDEN_COLUMNS);
    const draggedColumn = React.useRef(null);
    const [dropColumn, setDropColumn] = React.useState(null);
    const [sort, setSort] = React.useState([]);
    const [editing, setEditing] = React.useState(null);
    const [openMenu, setOpenMenu] = React.useState(null);   // 'add' or a column id
    const [addAfter, setAddAfter] = React.useState(null);     // column the Add popover inserts after; null appends (corner)
    const [dragging, setDragging] = React.useState(false);
    const [hotBoundary, setHotBoundary] = React.useState(null);
    const [name, setName] = React.useState('');
    const [type, setType] = React.useState('number');
    const [formError, setFormError] = React.useState('');
    const [newColumnId, setNewColumnId] = React.useState('');
    const stableOrder = React.useRef(null);
    // The dashboard passes a fresh Set every render; key the memo on its content instead.
    const selectionSignature = Array.from(selectedStoryKeys).sort().join('|');
    const rows = React.useMemo(() => buildPlanningReviewRows({ epicGroups, visibleTasks, mode, getTeamInfo }).map(row => ({ ...row, accepted: selectedStoryPoints(row, selectedStoryKeys), capacity: row.synthetic ? '' : excludedEpicSet.has(String(row.rowKind === 'epic' ? row.key : row.epicKey || '').toUpperCase()) ? 'Excluded' : 'Included' })), [epicGroups, visibleTasks, mode, getTeamInfo, excludedEpicSet, selectionSignature]);
    const scroller = React.useRef(null);
    const dockedHeader = React.useRef(null), dockedFooter = React.useRef(null);
    const [dock, setDock] = React.useState(null);
    const allColumns = buildPlanningReviewColumns({ rows, mode, customColumns: review.columns, admittedTeamCount, admittedProjectCount, layout: review.layouts?.[mode] });
    const layoutColumns = buildPlanningReviewColumns({ rows, mode, customColumns: review.columns, admittedTeamCount: 2, admittedProjectCount: 2, layout: review.layouts?.[mode] });
    const columns = allColumns.filter(column => column.required || !hidden.has(column.id));
    const keyHidden = !columns.some(column => column.id === 'key');
    const columnSignature = columns.map(column => `${column.id}:${column.type}`).join(',');
    React.useLayoutEffect(() => {
        const node = scroller.current, table = node.querySelector('table');
        const stack = document.querySelector('.planning-review-sticky-stack');
        let frame;
        const measure = () => {
            const bounds = node.getBoundingClientRect();
            const head = table.tHead.getBoundingClientRect(), foot = table.tFoot.getBoundingClientRect();
            const top = Math.max(0, stack?.getBoundingClientRect().bottom || 0);
            const widths = Array.from(table.tHead.rows[0].cells, cell => cell.getBoundingClientRect().width);
            const header = head.top < top && foot.top > top + head.height;
            const footer = bounds.top < window.innerHeight - foot.height && foot.bottom > window.innerHeight && bounds.bottom > top + head.height;
            // The controls are narrower than the sheet; rows must not show beside them above the docked headings.
            node.style.clipPath = header ? `inset(${Math.max(0, top + head.height - bounds.top)}px 0 0 0)` : '';
            const next = { top, left: bounds.left + node.clientLeft, width: node.clientWidth, widths, header, footer };
            setDock(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
            for (const ref of [dockedHeader, dockedFooter]) if (ref.current) ref.current.scrollLeft = node.scrollLeft;
        };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
        const observer = new ResizeObserver(schedule);
        observer.observe(table); observer.observe(node); if (stack) observer.observe(stack);
        // The stack's sticky offset lives in the container's inline variables: it moves when the compact header appears or the filter bar changes height, with no scroll or resize.
        const offsets = stack?.closest('.container');
        const offsetObserver = offsets ? new MutationObserver(schedule) : null;
        offsetObserver?.observe(offsets, { attributes: true, attributeFilter: ['style'] });
        window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, { passive: true });
        node.addEventListener('scroll', schedule, { passive: true }); measure();
        return () => { observer.disconnect(); offsetObserver?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule); node.removeEventListener('scroll', schedule); };
    }, [columnSignature]);
    React.useLayoutEffect(() => {
        for (const ref of [dockedHeader, dockedFooter]) if (ref.current) ref.current.scrollLeft = scroller.current.scrollLeft;
    }, [dock]);
    // The real header and its docked clone are different elements; a menu left open across the flip would sit on a vanished trigger.
    React.useEffect(() => { setOpenMenu(null); setAddAfter(null); setFormError(''); setDragging(false); }, [dock?.header]);

    const sorted = sortPlanningReviewRows(rows, sort, columns, review.cells, pendingOriginals);
    if (!editing) stableOrder.current = sorted.map(row => row.id);
    const displayed = editing && stableOrder.current ? [...rows].sort((a, b) => stableOrder.current.indexOf(a.id) - stableOrder.current.indexOf(b.id)) : sorted;
    const tbodyRef = React.useRef(null);
    usePlanningRowMotion({ tbodyRef, orderSignature: displayed.map(row => `${row.rowKind}:${row.id || row.key}`).join('|'), pendingCount: pendingOriginals?.size || 0, confirmedEdit, ackConfirmed: onConfirmedEditHandled || (() => {}), isHeld: isRowHeld || (() => false) });
    const totals = planningReviewTotals(rows, columns, review.cells);
    const editable = review.capabilities?.canSave && !review.saving;
    const trackedAction = (action, params = {}) => onReviewAction?.(action, { mode, ...params });
    // An Epic still waiting for Stories shows a chip beside its title, so the row keeps its one-line height.
    const summaryCell = row => {
        const title = <TrimmedValue value={row.summary}>{field(row, 'summary', row.summary)}</TrimmedValue>;
        const awaited = row.rowKind === 'epic' ? row.requirements?.length || 0 : 0;
        // Without the Key column the Summary still reaches Jira: an icon link stands in for the key.
        const jiraLink = keyHidden && !row.synthetic ? <TrackedExternalLink href={`${jiraUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(row.key)}`} className="planning-review-jira-link" target="_blank" rel="noopener noreferrer" aria-label={`Open ${row.key} in Jira`} title={`Open ${row.key} in Jira`} analyticsMeta={buildJiraBrowseLinkAnalytics({ issueKind: row.rowKind, sourceSurface: 'planning' })}><JiraMarkIcon /></TrackedExternalLink> : null;
        if (!awaited && !jiraLink) return title;
        return <span className="planning-review-summary-line">{jiraLink}{title}{awaited ? <StatusPill className={getIssueStatusClassName('Pending', 'planning-review-awaiting')} label={`${awaited} ${awaited === 1 ? 'Story' : 'Stories'} awaited`} /> : null}</span>;
    };
    const field = (row, fieldName, fallback) => !row.synthetic && renderFieldEditor ? (renderFieldEditor({ row, field: fieldName, value: fallback }) ?? fallback) : fallback;
    const changeMode = next => { if (editing) document.activeElement?.blur(); setEditing(null); setMode(next); setNewColumnId(''); trackedAction('row_mode_changed', { mode: next }); };
    const changeSort = (column, additive) => {
        const current = sort.find(item => item.columnId === column.id);
        const direction = !current ? 'asc' : current.direction === 'asc' ? 'desc' : null;   // ascending, descending, off
        const kept = additive ? sort.filter(item => item.columnId !== column.id) : [];
        const next = direction ? [...kept, { columnId: column.id, direction }] : kept;
        if (next.length > 5) { setFormError('Use at most five sort criteria.'); return; }
        setSort(next); trackedAction('sort_changed', { sortKey: column.custom ? 'custom' : column.id });
    };
    const addColumn = event => {
        event.preventDefault();
        const label = name.trim();
        if (!label || Array.from(label).length > 80) { setFormError('Enter a column name of 1–80 characters.'); return; }
        const id = newReviewColumnId();
        const column = { id, rowKind: mode, label, type, aggregation: type === 'number' ? 'sum' : 'none', archived: false, order: review.columns.filter(item => item.rowKind === mode).length };
        if (!review.changeSchema({ action: 'add', column })) { setFormError('This row mode supports up to 30 active custom columns.'); return; }
        const nextHidden = [...hidden].filter(columnId => columnId !== id);
        review.changeSchema({ action: 'layout', rowKind: mode, order: insertColumnId(movableIds(), id, addAfter), hidden: nextHidden });
        setNewColumnId(id); setName(''); setFormError(''); setOpenMenu(null); setAddAfter(null); trackedAction('column_added');
    };
    const updateLayout = (order, nextHidden = [...hidden]) => review.changeSchema({ action: 'layout', rowKind: mode, order, hidden: nextHidden });
    const setColumnVisible = (columnId, visible, afterId = null) => {
        const next = new Set(hidden);
        if (visible) next.delete(columnId); else next.add(columnId);
        // Key is pinned first and never part of the saved order; a hidden column cannot keep sorting rows.
        const order = afterId && columnId !== 'key' ? insertColumnId(movableIds(), columnId, afterId) : movableIds();
        if (updateLayout(order, [...next])) { if (!visible) setSort(current => current.filter(item => item.columnId !== columnId)); trackedAction('column_visibility_changed'); }
    };
    const movableIds = () => layoutColumns.filter(column => !['key', 'summary'].includes(column.id)).map(column => column.id);
    const moveColumn = (source, target, after = false) => {
        const ids = movableIds();
        if (source === target || !ids.includes(source) || !ids.includes(target) || !editable) return;
        ids.splice(ids.indexOf(source), 1); ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, source);
        if (updateLayout(ids)) trackedAction('columns_reordered');
    };
    const reorder = (column, direction) => {
        const visible = columns.map(item => item.id).filter(id => !['key', 'summary'].includes(id));
        const index = visible.indexOf(column.id), target = visible[index + direction];
        if (index >= 0 && target) moveColumn(column.id, target, direction > 0);
    };
    // Rendered into the Filters row's view-controls slot; without a host (local harnesses) it sits above the table instead.
    const toolbar = (
        <div className="planning-review-controls">
            <SegmentedControl className="eng-mode-control segmented-control-compact" ariaLabel="Planning review rows" options={[{ value: 'epic', label: 'Epics' }, { value: 'story', label: 'Stories' }]} value={mode} onChange={changeMode} />
            <PlanningReviewStateCluster review={review} editable={editable}
                onSave={async () => { const saved = await review.save(); trackedAction('save_review', { result: saved ? 'success' : 'failure' }); }}
                onDiscard={() => { review.discard(); trackedAction('discard_review'); }} />
        </div>
    );
    const movable = column => ['key', 'summary'].includes(column.id) ? '' : ' planning-review-movable';
    const visibleMovable = columns.map(item => item.id).filter(id => !['key', 'summary'].includes(id));
    const hiddenColumns = allColumns.filter(column => !column.required && hidden.has(column.id));
    const closeAdd = () => { setOpenMenu(null); setAddAfter(null); setFormError(''); };
    const addContent = <>
        <div className="pop-subject">Add column · {mode === 'epic' ? 'Epics' : 'Stories'}</div>
        <div className="pop-group">
            <form className="planning-review-add" onSubmit={addColumn}>
                <input data-autofocus required maxLength={80} className="planning-review-column-name" aria-label="Column name" placeholder="Column name" value={name} onChange={event => setName(event.target.value)} />
                <div className="planning-review-add-row">
                    <SegmentedControl className="eng-mode-control" ariaLabel="Column type" options={[{ value: 'number', label: 'Number' }, { value: 'text', label: 'Text' }]} value={type} onChange={setType} />
                    <button type="submit" className="planning-action-button" disabled={!editable}>Add column</button>
                </div>
                <p className="planning-review-guidance">Shared with everyone reviewing this Sprint.</p>
            </form>
        </div>
        {hiddenColumns.length > 0 && <div className="pop-group">
            <div className="pop-head"><span className="pop-facet">Show hidden</span></div>
            <div className="pop-list">{hiddenColumns.map(column => <button key={column.id} type="button" className="pop-opt" aria-pressed="false" disabled={!editable} onClick={() => setColumnVisible(column.id, true, addAfter)}>
                <span className="box" aria-hidden="true" /><span className="pop-opt-content"><span className="pop-opt-label" title={column.label}>{column.label}</span></span>
            </button>)}</div>
        </div>}
    </>;
    const header = (floating = false) => {
        // The real header and its docked clone are separate elements: only the one the user can reach owns the popovers.
        const docked = !floating && dock?.header;
        const interactive = floating || !dock?.header;
        const corner = <ReviewColumnPopover open={openMenu === 'add' && addAfter === null && interactive} onClose={closeAdd} label="Add review column" error={formError}
            trigger={<IconButton size="sm" className="planning-review-column-action planning-review-corner" tabIndex={docked ? -1 : undefined} aria-hidden={docked ? true : undefined} disabled={!editable} aria-label="+ Add column"
                onClick={() => { const open = !(openMenu === 'add' && addAfter === null); setAddAfter(null); setOpenMenu(open ? 'add' : null); if (open) { setFormError(''); trackedAction('add_column_opened'); } }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
            </IconButton>}>
            {addContent}
        </ReviewColumnPopover>;
        return <thead><tr><th className="planning-review-selection planning-review-text" aria-label="Select">{corner}</th>{columns.map(column => {
        // The grip sits in a right-hand gutter outside the content box, so headings, values and totals share their alignment edge.
        const grip = !['key', 'summary'].includes(column.id) && <button type="button" className="planning-review-drag" tabIndex={docked ? -1 : undefined} aria-hidden={docked ? true : undefined} draggable={editable} disabled={!editable} aria-label={`Move ${column.label} column`} title="Drag to move column"
            onDragStart={event => { draggedColumn.current = column.id; setDragging(true); event.dataTransfer.setData('text/plain', column.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { draggedColumn.current = null; setDropColumn(null); setDragging(false); }}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); reorder(column, event.key === 'ArrowLeft' ? -1 : 1); } }}>⠿</button>;
        const index = visibleMovable.indexOf(column.id);
        const menu = (index >= 0 || column.id === 'key') && <ReviewColumnPopover open={openMenu === column.id && interactive} onClose={() => { setOpenMenu(null); setFormError(''); }} label={`${column.label} column options`} error={openMenu === column.id ? formError : ''}
            trigger={<IconButton size="sm" className="planning-review-column-action planning-review-colmenu" tabIndex={docked ? -1 : undefined} aria-hidden={docked ? true : undefined} disabled={!editable} aria-label={`${column.label} column options`}
                onClick={() => { const open = openMenu !== column.id; setOpenMenu(open ? column.id : null); if (open) { setFormError(''); trackedAction('columns_opened'); } }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
            </IconButton>}>
            <PlanningReviewColumnMenu column={column} editable={editable} review={review} canMoveLeft={index > 0} canMoveRight={index < visibleMovable.length - 1}
                onMove={direction => reorder(column, direction)} onHide={() => { setOpenMenu(null); setColumnVisible(column.id, false); }}
                onError={setFormError} onClose={() => { setOpenMenu(null); setFormError(''); }} onTrack={trackedAction} />
        </ReviewColumnPopover>;
        // A boundary-opened Add popover anchors on a zero-width span at this cell's right edge, so it scrolls and clips with the cell.
        const boundary = column.id !== 'key' && <ReviewColumnPopover open={openMenu === 'add' && addAfter === column.id && interactive} onClose={closeAdd} label="Add review column" error={formError} anchorClassName="planning-review-boundary-popover"
            trigger={<span className="planning-review-boundary-anchor" aria-hidden="true" />}>{addContent}</ReviewColumnPopover>;
        const position = sort.findIndex(item => item.columnId === column.id);
        const heading = <button type="button" className="planning-review-heading" tabIndex={docked ? -1 : undefined} aria-hidden={docked ? true : undefined} onClick={event => changeSort(column, event.shiftKey)}>{column.label}{position >= 0 && <span> {sort.length > 1 ? position + 1 : ''}{sort[position].direction === 'desc' ? '↓' : '↑'}</span>}</button>;
        return <th key={column.id} aria-label={column.label} data-column-id={column.id} className={`planning-review-${column.id}${column.custom ? ' planning-review-custom' : ''} planning-review-${column.type === 'number' ? 'numeric' : 'text'}${movable(column)}${hotBoundary === column.id ? ' planning-review-boundary-hot' : ''}${dropColumn === column.id ? ' planning-review-drop' : ''}`}
            onDragOver={event => { if (editable && draggedColumn.current && !['key', 'summary'].includes(column.id)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropColumn(column.id); } }}
            onDrop={event => { event.preventDefault(); const source = draggedColumn.current; moveColumn(source, column.id, event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.offsetWidth / 2); draggedColumn.current = null; setDropColumn(null); setDragging(false); }}>
            <span className="planning-review-head">{heading}{grip}{menu}</span>{boundary}</th>;
    })}</tr></thead>;
    };
    const footer = <tfoot><tr><th className="planning-review-selection planning-review-text"><span aria-hidden="true">Σ</span><span className="planning-review-sr-only">Total</span></th>{columns.map(column => <td key={column.id} className={`planning-review-${column.id}${column.custom ? ' planning-review-custom' : ''} planning-review-${column.type === 'number' ? 'numeric' : 'text'}${movable(column)}`}>{column.id === 'key' ? '' : totals[column.id] ?? ''}</td>)}</tr></tfoot>;
    // The header the user can see: the docked clone while docked, otherwise the real one. Boundaries must fall inside the scroller.
    const liveHeader = () => {
        const host = dock?.header && dockedHeader.current ? dockedHeader.current : scroller.current;
        const row = host?.querySelector('thead tr');
        const bounds = host?.getBoundingClientRect();
        return row && bounds ? { row, left: bounds.left, right: bounds.right } : null;
    };
    const dockedTable = (kind, content, ref) => <div ref={ref} aria-hidden={kind === 'footer' ? true : undefined}
        onScroll={event => { scroller.current.scrollLeft = event.currentTarget.scrollLeft; }}
        onWheel={event => { if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) { scroller.current.scrollLeft += event.deltaX; } }} className={`planning-review-docked-${kind}`} style={{ left: dock.left, top: kind === 'header' ? dock.top : undefined, bottom: kind === 'footer' ? 0 : undefined, width: dock.width }}>
        <table className={`planning-review-table planning-review-docked-table${keyHidden ? ' planning-review-key-hidden' : ''}`} role="presentation" style={{ width: dock.widths.reduce((sum, width) => sum + width, 0) }}>
            <colgroup>{dock.widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>{content}
        </table>
    </div>;
    return <section className="planning-review-region" aria-label="Planning Sprint review">
        {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
        <PlanningReviewBoundaryPlus getLive={liveHeader} suspended={dragging || Boolean(openMenu) || !editable} onHover={setHotBoundary}
            onOpen={afterId => { setAddAfter(afterId); setOpenMenu('add'); setFormError(''); trackedAction('add_column_opened'); }} />
        {!review.capabilities?.canSave && !review.loading && <p className="planning-review-guidance">{review.capabilities?.reason === 'database_required' ? 'Review saving requires the application database.' : review.capabilities?.reason || 'Review saving is unavailable in this deployment.'}</p>}
        {review.error && <p className="planning-review-guidance" role="alert">{review.error}</p>}
        {(review.conflict || review.unconfirmed) && <div className="planning-review-recovery"><span>Your draft stays local until you choose a recovery action.</span><button type="button" className="planning-action-button" disabled={review.loading || review.saving} onClick={() => { void review.loadCurrent(); trackedAction('load_current_review'); }}>Load current and discard draft</button><button type="button" className="planning-action-button" disabled={review.loading || review.saving} onClick={() => { void review.reapply(); trackedAction('reapply_review'); }}>Refresh and reapply draft</button></div>}
        {formError && !openMenu && <p role="alert" className="planning-review-guidance">{formError}</p>}
        <div ref={scroller} className="planning-review-scroll" tabIndex={0} aria-label="Planning review spreadsheet">
            <table className={`planning-review-table${keyHidden ? ' planning-review-key-hidden' : ''}${dock?.header ? ' planning-review-header-docked' : ''}${dock?.footer ? ' planning-review-footer-docked' : ''}`}>{header()}
            <tbody ref={tbodyRef}>{displayed.map(row => <tr key={`${row.rowKind}:${row.id || row.key}`} data-review-row={`${row.rowKind}:${row.id || row.key}`} data-issue-key={row.synthetic ? undefined : row.key} className={row.synthetic ? 'planning-review-synthetic' : hasZeroStoryPoints(row) ? 'planning-review-zero-sp' : ''}>
                <td className="planning-review-selection"><Selection row={row} selectedKeys={selectedStoryKeys} onToggleStory={onToggleStory} onSelectStories={onSelectStories} /></td>
                {columns.map(column => <td key={column.id} className={`planning-review-${column.id}${column.custom ? ' planning-review-custom' : ''} planning-review-${column.type === 'number' ? 'numeric' : 'text'}${movable(column)}`}>
                    {column.custom ? <CustomCell row={row} column={column} review={review} editing={editing === row.id} setEditing={setEditing} onHold={onHoldRow} focusNew={newColumnId === column.id && row === displayed.find(item => !item.synthetic && item.issueId)} />
                        : column.id === 'key' ? (row.synthetic ? row.rowKind === 'requirement' ? 'Not created' : '—' : <TrackedExternalLink href={`${jiraUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(row.key)}`} className="task-key-link" target="_blank" rel="noopener noreferrer" analyticsMeta={buildJiraBrowseLinkAnalytics({ issueKind: row.rowKind, sourceSurface: 'planning' })}>{row.key}</TrackedExternalLink>)
                        : column.id === 'summary' ? summaryCell(row)
                        : column.id === 'priority' ? field(row, 'priority', <span>{renderPriorityIcon?.(row.priority)} {row.priority || '—'}</span>)
                        : column.id === 'accepted' ? row.accepted ?? ''
                        : column.id === 'storyPoints' ? (row.rowKind === 'requirement' ? '—' : row.rowKind === 'story' ? field(row, 'storyPoints', row.storyPoints ?? 0) : row.storyPoints ?? 0)
                        : column.id === 'teamsInScope' ? <TrimmedValue value={reviewValue(row, column, review.cells) || '—'} />
                        : column.id === 'team' ? field(row, 'team', row.team?.name || 'Unknown Team')
                        : column.id === 'epic' ? (row.epicKey ? <TrackedExternalLink href={`${jiraUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(row.epicKey)}`} className="task-key-link" target="_blank" rel="noopener noreferrer" analyticsMeta={buildJiraBrowseLinkAnalytics({ issueKind: 'epic', sourceSurface: 'planning' })}>{row.epic || row.epicKey}</TrackedExternalLink> : row.epic || '—')
                        : column.id === 'capacity' ? (row.synthetic ? '—' : field(row, 'inclusion', excludedEpicSet.has(String(row.rowKind === 'epic' ? row.key : row.epicKey || '').toUpperCase()) ? 'Excluded' : 'Included'))
                        : column.id === 'projectTrack' ? field(row, 'projectTrack', row.projectTrack || '—')
                        : column.id === 'assignee' ? (row.synthetic ? '—' : field(row, 'assignee', row.assignee || 'Unassigned'))
                        : column.id === 'status' ? (row.rowKind === 'requirement' ? 'Awaiting creation' : field(row, 'status', <StatusPill label={row.status || '—'} className={getIssueStatusClassName(row.status)} status={row.status} />)) : reviewValue(row, column, review.cells) || '—'}
                </td>)}

            </tr>)}</tbody>{footer}</table>
        </div>
        {dock?.header && createPortal(dockedTable('header', header(true), dockedHeader), document.body)}
        {dock?.footer && createPortal(dockedTable('footer', footer, dockedFooter), document.body)}
        {!rows.length && <p className="planning-review-guidance">No rows in this scope.</p>}
    </section>;
}
