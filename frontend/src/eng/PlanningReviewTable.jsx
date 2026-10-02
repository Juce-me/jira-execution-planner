import * as React from 'react';
import { createPortal } from 'react-dom';
import useIssueFieldPopover from '../issues/useIssueFieldPopover.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import { buildJiraBrowseLinkAnalytics } from '../analytics/externalLinks.js';
import { reviewCellKey, newReviewColumnId, formatReviewDisplay, DEFAULT_REVIEW_HIDDEN_COLUMNS } from './planningReviewTableModel.js';
import SegmentedControl from '../ui/SegmentedControl.jsx';
import StatusPill from '../ui/StatusPill.jsx';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import PlanningReviewColumnsMenu from './PlanningReviewColumnsMenu.jsx';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import { buildPlanningReviewRows, buildPlanningReviewColumns, hasZeroStoryPoints, reviewSelectionState, reviewValue, sortPlanningReviewRows, planningReviewTotals } from './planningReviewTableModel.js';

function ReviewColumnPopover({ open, onClose, label, trigger, children, error }) {
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
    return <span className="planning-review-popover-anchor" ref={wrapperRef}>
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

function CustomCell({ row, column, review, editing, setEditing, focusNew }) {
    const stored = reviewValue(row, { ...column, custom: true }, review.cells);
    const value = column.type === 'number' ? formatReviewDisplay(stored) : stored;
    const persistedInput = review.drafts?.[reviewCellKey(row.rowKind, row.issueId, column.id)]?.input;
    const [draft, setDraft] = React.useState(persistedInput ?? value ?? '');
    const [error, setError] = React.useState('');
    const ref = React.useRef(null);
    const initialInput = React.useRef(persistedInput ?? value ?? '');
    const cancelBlur = React.useRef(false);
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
    return <><input ref={ref} className={`planning-review-input ${error ? 'invalid' : ''}`} type="text" inputMode={column.type === 'number' ? 'decimal' : 'text'} aria-label={`${column.label} for ${row.key}`} aria-invalid={Boolean(error)} maxLength={column.type === 'text' ? 500 : 16} value={draft} disabled={!review.capabilities?.canSave || review.saving} onFocus={() => { initialInput.current = draft; setEditing(row.id); }} onChange={event => { setDraft(event.target.value); const result = review.setCell(row, column, event.target.value); setError(result.error || ''); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { if (commit()) ref.current.blur(); } else if (event.key === 'Escape') { cancelBlur.current = true; review.setCell(row, column, initialInput.current); setDraft(initialInput.current); setError(''); setEditing(null); ref.current.blur(); } }} />{error && <span className="planning-review-validation" role="alert">{error}</span>}</>;
}

export function PlanningReviewScopeDialog({ review }) {
    if (!review?.pendingScopeChange) return null;
    return <div className="planning-review-dialog-backdrop"><div className="planning-review-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-review-leave-heading">
        <h3 id="planning-review-leave-heading">Save this Sprint review?</h3><p>Your review has unsaved changes. Save or discard them before changing Sprint.</p>
        {review.error && <p role="alert">{review.error}</p>}
        <div className="planning-review-dialog-actions"><button type="button" className="planning-action-button" disabled={review.saving || !review.capabilities?.canSave || review.unconfirmed || Boolean(review.conflict)} onClick={() => review.resolveScopeChange('save')}>Save review</button><button type="button" className="planning-action-button" disabled={review.saving} onClick={() => review.resolveScopeChange('discard')}>Discard</button><button type="button" className="planning-action-button" disabled={review.saving} onClick={() => review.resolveScopeChange('stay')}>Stay</button></div>
    </div></div>;
}

export default function PlanningReviewTable({ epicGroups = [], visibleTasks = [], selectedStoryKeys = new Set(), onToggleStory, onSelectStories, jiraUrl = '', review, getTeamInfo, admittedTeamCount, admittedProjectCount, renderPriorityIcon, renderFieldEditor, onReviewAction, toolbarHost, excludedEpicSet = new Set() }) {
    const [mode, setMode] = React.useState('epic');
    const hidden = new Set(review.layouts?.[mode]?.hidden ?? DEFAULT_REVIEW_HIDDEN_COLUMNS);
    const draggedColumn = React.useRef(null);
    const [dropColumn, setDropColumn] = React.useState(null);
    const [sort, setSort] = React.useState([]);
    const [editing, setEditing] = React.useState(null);
    const [addOpen, setAddOpen] = React.useState(false);
    const [columnsOpen, setColumnsOpen] = React.useState(false);
    const [optionsOpen, setOptionsOpen] = React.useState(false);
    const [name, setName] = React.useState('');
    const [type, setType] = React.useState('number');
    const [formError, setFormError] = React.useState('');
    const [newColumnId, setNewColumnId] = React.useState('');
    const stableOrder = React.useRef(null);
    const rows = React.useMemo(() => buildPlanningReviewRows({ epicGroups, visibleTasks, mode, getTeamInfo }).map(row => ({ ...row, capacity: row.synthetic ? '' : excludedEpicSet.has(String(row.rowKind === 'epic' ? row.key : row.epicKey || '').toUpperCase()) ? 'Excluded' : 'Included' })), [epicGroups, visibleTasks, mode, getTeamInfo, excludedEpicSet]);
    const scroller = React.useRef(null);
    const dockedHeader = React.useRef(null), dockedFooter = React.useRef(null);
    const [dock, setDock] = React.useState(null);
    const allColumns = buildPlanningReviewColumns({ rows, mode, customColumns: review.columns, admittedTeamCount, admittedProjectCount, layout: review.layouts?.[mode] });
    const layoutColumns = buildPlanningReviewColumns({ rows, mode, customColumns: review.columns, admittedTeamCount: 2, admittedProjectCount: 2, layout: review.layouts?.[mode] });
    const columns = allColumns.filter(column => column.required || !hidden.has(column.id));
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
        window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, { passive: true });
        node.addEventListener('scroll', schedule, { passive: true }); measure();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule); node.removeEventListener('scroll', schedule); };
    }, [columnSignature]);
    React.useLayoutEffect(() => {
        for (const ref of [dockedHeader, dockedFooter]) if (ref.current) ref.current.scrollLeft = scroller.current.scrollLeft;
    }, [dock]);

    const sorted = sortPlanningReviewRows(rows, sort, columns, review.cells);
    if (!editing) stableOrder.current = sorted.map(row => row.id);
    const displayed = editing && stableOrder.current ? [...rows].sort((a, b) => stableOrder.current.indexOf(a.id) - stableOrder.current.indexOf(b.id)) : sorted;
    const totals = planningReviewTotals(rows, columns, review.cells);
    const editable = review.capabilities?.canSave && !review.saving;
    const trackedAction = (action, params = {}) => onReviewAction?.(action, { mode, ...params });
    const field = (row, fieldName, fallback) => !row.synthetic && renderFieldEditor ? (renderFieldEditor({ row, field: fieldName, value: fallback }) ?? fallback) : fallback;
    const changeMode = next => { if (editing) document.activeElement?.blur(); setEditing(null); setMode(next); setNewColumnId(''); trackedAction('row_mode_changed', { mode: next }); };
    const changeSort = (column, additive) => {
        const current = sort.find(item => item.columnId === column.id);
        const criterion = { columnId: column.id, direction: current?.direction === 'asc' ? 'desc' : 'asc' };
        const next = additive ? [...sort.filter(item => item.columnId !== column.id), criterion] : [criterion];
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
        review.changeSchema({ action: 'layout', rowKind: mode, order: [...layoutColumns.filter(item => !['key', 'summary'].includes(item.id)).map(item => item.id), id], hidden: nextHidden });
        setNewColumnId(id); setName(''); setFormError(''); setAddOpen(false); trackedAction('column_added');
    };
    const updateLayout = (order, nextHidden = [...hidden]) => review.changeSchema({ action: 'layout', rowKind: mode, order, hidden: nextHidden });
    const setColumnVisible = (columnId, visible) => {
        const next = new Set(hidden);
        if (visible) next.delete(columnId); else next.add(columnId);
        updateLayout(movableIds(), [...next]);
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
    const toolbar = (
        <div className="planning-review-toolbar">
            <div className="stats-control-group"><SegmentedControl className="eng-mode-control" ariaLabel="Planning review rows" options={[{ value: 'epic', label: 'Epics' }, { value: 'story', label: 'Stories' }]} value={mode} onChange={changeMode} /></div>
            <ReviewColumnPopover open={addOpen} onClose={() => { setAddOpen(false); setFormError(''); }} label="Add review column" error={formError}
                trigger={<button type="button" className="planning-action-button" aria-label="+ Add column" disabled={!editable} onClick={() => { setAddOpen(!addOpen); setColumnsOpen(false); setOptionsOpen(false); trackedAction('add_column_opened'); }}>+ Column</button>}>
                <form className="planning-review-add" onSubmit={addColumn}>
                    <input data-autofocus required maxLength={80} className="planning-review-column-name" aria-label="Column name" placeholder="Column name" value={name} onChange={event => setName(event.target.value)} />
                    <div className="planning-review-add-row">
                        <SegmentedControl className="eng-mode-control" ariaLabel="Column type" options={[{ value: 'number', label: 'Number' }, { value: 'text', label: 'Text' }]} value={type} onChange={setType} />
                        <button type="submit" className="planning-action-button" disabled={!editable}>Add column</button>
                    </div>
                </form>
            </ReviewColumnPopover>
            <ReviewColumnPopover open={columnsOpen} onClose={() => { setColumnsOpen(false); setFormError(''); }} label="Review column management" error={formError}
                trigger={<button type="button" className="planning-action-button" aria-expanded={columnsOpen} onClick={() => { setColumnsOpen(!columnsOpen); setAddOpen(false); setOptionsOpen(false); trackedAction('columns_opened'); }}>Columns</button>}>
                <PlanningReviewColumnsMenu mode={mode} columns={allColumns.filter(column => !column.required)} archivedColumns={review.columns.filter(column => column.rowKind === mode && column.archived)} hidden={hidden} editable={editable} review={review}
                    onVisibilityChange={setColumnVisible} onError={setFormError} onArchived={() => trackedAction('column_archived')} />
            </ReviewColumnPopover>
            <button type="button" className="planning-action-button" aria-label="Save review" disabled={!editable || !review.dirty || review.loading || review.unconfirmed || Boolean(review.conflict)} onClick={async () => { const saved = await review.save(); trackedAction('save_review', { result: saved ? 'success' : 'failure' }); }}>{review.saving ? 'Saving…' : 'Save'}</button>
            <span className="planning-review-state" role="status">{review.loading ? 'Loading…' : review.saving ? 'Saving…' : review.dirty ? 'Unsaved' : ''}</span>
            <ReviewColumnPopover open={optionsOpen} onClose={() => setOptionsOpen(false)} label="Review options"
                trigger={<button type="button" className="planning-action-button planning-review-options-trigger" aria-label="Review options" onClick={() => { setOptionsOpen(!optionsOpen); setAddOpen(false); setColumnsOpen(false); if (!optionsOpen) trackedAction('review_options_opened'); }}><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/></svg></button>}>
                <div className="planning-review-options">
                    <button type="button" className="planning-action-button" data-review-popover-close disabled={review.loading || review.saving} onClick={() => { void review.refresh(); trackedAction('refresh_review'); }}>Refresh review</button>
                    {review.dirty && <button type="button" className="planning-action-button" data-review-popover-close disabled={review.saving} onClick={() => { review.discard(); trackedAction('discard_review'); }}>Discard draft</button>}
                    {sort.length > 0 && <button type="button" className="planning-action-button" data-review-popover-close onClick={() => setSort([])}>Clear sorting</button>}
                    <p className="planning-review-guidance">Drag handles to reorder columns. Click a heading to sort; Shift-click adds another sort. Save shares column changes and review values.</p>
                </div>
            </ReviewColumnPopover>
        </div>
    );
    const movable = column => ['key', 'summary'].includes(column.id) ? '' : ' planning-review-movable';
    const header = (floating = false) => <thead><tr><th className="planning-review-selection planning-review-text"><span className="planning-review-sr-only">Select</span></th>{columns.map(column => {
        const docked = !floating && dock?.header;
        // The grip sits in a right-hand gutter outside the content box, so headings, values and totals share their alignment edge.
        const grip = !['key', 'summary'].includes(column.id) && <button type="button" className="planning-review-drag" tabIndex={docked ? -1 : undefined} aria-hidden={docked ? true : undefined} draggable={editable} disabled={!editable} aria-label={`Move ${column.label} column`} title="Drag to move column"
            onDragStart={event => { draggedColumn.current = column.id; event.dataTransfer.setData('text/plain', column.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { draggedColumn.current = null; setDropColumn(null); }}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); reorder(column, event.key === 'ArrowLeft' ? -1 : 1); } }}>⠿</button>;
        const heading = <button type="button" className="planning-review-heading" tabIndex={docked ? -1 : undefined} aria-hidden={docked ? true : undefined} onClick={event => changeSort(column, event.shiftKey)}>{column.label}{sort.some(item => item.columnId === column.id) && <span> {sort.findIndex(item => item.columnId === column.id) + 1}{sort.find(item => item.columnId === column.id)?.direction === 'desc' ? '↓' : '↑'}</span>}</button>;
        return <th key={column.id} aria-label={column.label} className={`planning-review-${column.id}${column.custom ? ' planning-review-custom' : ''} planning-review-${column.type === 'number' ? 'numeric' : 'text'}${movable(column)}${dropColumn === column.id ? ' planning-review-drop' : ''}`}
            onDragOver={event => { if (editable && draggedColumn.current && !['key', 'summary'].includes(column.id)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropColumn(column.id); } }}
            onDrop={event => { event.preventDefault(); const source = draggedColumn.current; moveColumn(source, column.id, event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.offsetWidth / 2); draggedColumn.current = null; setDropColumn(null); }}>
            <span className="planning-review-head">{heading}{grip}</span></th>;
    })}</tr></thead>;
    const footer = <tfoot><tr><th className="planning-review-selection planning-review-text"><span aria-hidden="true">Σ</span><span className="planning-review-sr-only">Total</span></th>{columns.map(column => <td key={column.id} className={`planning-review-${column.id}${column.custom ? ' planning-review-custom' : ''} planning-review-${column.type === 'number' ? 'numeric' : 'text'}${movable(column)}`}>{column.id === 'key' ? (review.dirty ? 'Draft' : '') : totals[column.id] ?? ''}</td>)}</tr></tfoot>;
    const dockedTable = (kind, content, ref) => <div ref={ref} aria-hidden={kind === 'footer' ? true : undefined}
        onScroll={event => { scroller.current.scrollLeft = event.currentTarget.scrollLeft; }}
        onWheel={event => { if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) { scroller.current.scrollLeft += event.deltaX; } }} className={`planning-review-docked-${kind}`} style={{ left: dock.left, top: kind === 'header' ? dock.top : undefined, bottom: kind === 'footer' ? 0 : undefined, width: dock.width }}>
        <table className="planning-review-table planning-review-docked-table" role="presentation" style={{ width: dock.widths.reduce((sum, width) => sum + width, 0) }}>
            <colgroup>{dock.widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>{content}
        </table>
    </div>;
    return <section className="planning-review-region" aria-label="Planning Sprint review">
        {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
        {!review.capabilities?.canSave && !review.loading && <p className="planning-review-guidance">{review.capabilities?.reason === 'database_required' ? 'Review saving requires the application database.' : review.capabilities?.reason || 'Review saving is unavailable in this deployment.'}</p>}
        {review.error && <p className="planning-review-guidance" role="alert">{review.error}</p>}
        {(review.conflict || review.unconfirmed) && <div className="planning-review-recovery"><span>Your draft stays local until you choose a recovery action.</span><button type="button" className="planning-action-button" disabled={review.loading || review.saving} onClick={() => { void review.loadCurrent(); trackedAction('load_current_review'); }}>Load current and discard draft</button><button type="button" className="planning-action-button" disabled={review.loading || review.saving} onClick={() => { void review.reapply(); trackedAction('reapply_review'); }}>Refresh and reapply draft</button></div>}
        {formError && !addOpen && !columnsOpen && <p role="alert" className="planning-review-guidance">{formError}</p>}
        <div ref={scroller} className="planning-review-scroll" tabIndex={0} aria-label="Planning review spreadsheet">
            <table className={`planning-review-table${dock?.header ? ' planning-review-header-docked' : ''}${dock?.footer ? ' planning-review-footer-docked' : ''}`}>{header()}
            <tbody>{displayed.map(row => <tr key={`${row.rowKind}:${row.id || row.key}`} className={row.synthetic ? 'planning-review-synthetic' : hasZeroStoryPoints(row) ? 'planning-review-zero-sp' : ''}>
                <td className="planning-review-selection"><Selection row={row} selectedKeys={selectedStoryKeys} onToggleStory={onToggleStory} onSelectStories={onSelectStories} /></td>
                {columns.map(column => <td key={column.id} className={`planning-review-${column.id}${column.custom ? ' planning-review-custom' : ''} planning-review-${column.type === 'number' ? 'numeric' : 'text'}${movable(column)}`}>
                    {column.custom ? <CustomCell row={row} column={column} review={review} editing={editing === row.id} setEditing={setEditing} focusNew={newColumnId === column.id && row === displayed.find(item => !item.synthetic && item.issueId)} />
                        : column.id === 'key' ? (row.synthetic ? row.rowKind === 'requirement' ? 'Not created' : '—' : <TrackedExternalLink href={`${jiraUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(row.key)}`} target="_blank" rel="noopener noreferrer" analyticsMeta={buildJiraBrowseLinkAnalytics({ issueKind: row.rowKind, sourceSurface: 'planning' })}>{row.key}</TrackedExternalLink>)
                        : column.id === 'summary' ? <><TrimmedValue value={row.summary}>{field(row, 'summary', row.summary)}</TrimmedValue>{row.rowKind === 'epic' && row.requirements?.length > 0 && <span className="planning-review-requirement">{row.requirements.length} uncreated {row.requirements.length === 1 ? 'Story' : 'Stories'}</span>}{row.rowKind === 'story' && !row.epicKey && <span className="planning-review-requirement">No Epic</span>}</>
                        : column.id === 'priority' ? field(row, 'priority', <span>{renderPriorityIcon?.(row.priority)} {row.priority || '—'}</span>)
                        : column.id === 'storyPoints' ? (row.rowKind === 'requirement' ? '—' : row.rowKind === 'story' ? field(row, 'storyPoints', row.storyPoints ?? 0) : row.storyPoints ?? 0)
                        : column.id === 'teamsInScope' ? <TrimmedValue value={reviewValue(row, column, review.cells) || '—'} />
                        : column.id === 'team' ? field(row, 'team', row.team?.name || 'Unknown Team')
                        : column.id === 'epic' ? (row.epicKey ? <TrackedExternalLink href={`${jiraUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(row.epicKey)}`} target="_blank" rel="noopener noreferrer" analyticsMeta={buildJiraBrowseLinkAnalytics({ issueKind: 'epic', sourceSurface: 'planning' })}>{row.epic || row.epicKey}</TrackedExternalLink> : row.epic || '—')
                        : column.id === 'capacity' ? (row.synthetic ? '—' : field(row, 'inclusion', excludedEpicSet.has(String(row.rowKind === 'epic' ? row.key : row.epicKey || '').toUpperCase()) ? 'Excluded' : 'Included'))
                        : column.id === 'projectTrack' ? field(row, 'projectTrack', row.projectTrack || '—')
                        : column.id === 'assignee' ? (row.synthetic ? '—' : field(row, 'assignee', row.assignee || 'Unassigned'))
                        : column.id === 'status' ? (row.rowKind === 'requirement' ? 'Awaiting creation' : field(row, 'status', <StatusPill label={row.status || '—'} className={getIssueStatusClassName(row.status)} />)) : reviewValue(row, column, review.cells) || '—'}
                </td>)}

            </tr>)}</tbody>{footer}</table>
        </div>
        {dock?.header && createPortal(dockedTable('header', header(true), dockedHeader), document.body)}
        {dock?.footer && createPortal(dockedTable('footer', footer, dockedFooter), document.body)}
        {!rows.length && <p className="planning-review-guidance">No rows in this scope.</p>}
    </section>;
}
