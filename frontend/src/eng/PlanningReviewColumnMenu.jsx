import * as React from 'react';

// `aligned` keeps a hidden checkbox gutter so plain actions line up with a toggle row in the same menu; without a toggle there is no gutter.
function MenuOption({ label, locked, pressed, aligned, onClick }) {
    const gutter = pressed !== undefined || aligned;
    return <button type="button" className={`pop-opt${locked ? ' is-locked' : ''}${gutter ? '' : ' pop-opt-plain'}`} aria-disabled={locked || undefined} aria-pressed={pressed} onClick={() => { if (!locked) onClick(); }}>
        {gutter && <span className="box" aria-hidden="true" style={pressed === undefined ? { visibility: 'hidden' } : undefined} />}<span className="pop-opt-content"><span className="pop-opt-label">{label}</span></span>
    </button>;
}

function RenameField({ column, review, onError, onFinish, onRenamed }) {
    const settled = React.useRef(false);
    const settle = (value, refocus) => {
        if (settled.current) return;
        settled.current = true;
        if (value !== null && value.trim() !== column.label) {
            const renamed = review.changeSchema({ action: 'rename', columnId: column.id, label: value.trim() });
            onError(renamed ? '' : 'Enter a column name of 1–80 characters.');
            if (renamed) onRenamed?.();
        }
        onFinish(refocus);
    };
    return <input autoFocus className="planning-review-column-name planning-review-column-rename" aria-label={`Name for ${column.label}`} maxLength={80} defaultValue={column.label}
        onBlur={event => settle(event.target.value, false)}
        onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); settle(event.currentTarget.value, true); }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); settle(null, true); }
        }} />;
}

// Per-column actions, opened from the header cell. Every column but the pinned Summary can be hidden; the pinned Key only hides;
// review (custom) columns can also be renamed, totalled and archived.
export default function PlanningReviewColumnMenu({ column, editable, review, canMoveLeft, canMoveRight, onMove, onHide, onError, onClose, onTrack }) {
    const rootRef = React.useRef(null);
    const [renaming, setRenaming] = React.useState(false);
    const [confirming, setConfirming] = React.useState(false);
    const focusDialog = () => rootRef.current?.closest('[role="dialog"]')?.focus({ preventScroll: true });
    const archive = () => {
        // The controller refuses (and explains in review.error) while the column still has draft cells.
        if (review.changeSchema({ action: 'archive', columnId: column.id, archived: true })) onTrack('column_archived');
        onClose();
    };
    const total = column.aggregation === 'sum';
    const aligned = column.custom && column.type === 'number';   // only a number review column has the Show total toggle
    return <div ref={rootRef}>
        {column.custom && <div className="pop-subject">Shared review column</div>}
        {column.custom && <div className="pop-group"><div className="pop-list">
            {renaming
                ? <div className="planning-review-column-row"><RenameField column={column} review={review} onError={onError} onRenamed={() => onTrack('column_renamed')} onFinish={refocus => { setRenaming(false); if (refocus) focusDialog(); }} /></div>
                : <MenuOption label="Rename" aligned={aligned} locked={!editable} onClick={() => setRenaming(true)} />}
            {column.type === 'number' && <MenuOption label="Show total" pressed={total} locked={!editable}
                onClick={() => { if (review.changeSchema({ action: 'aggregation', columnId: column.id, aggregation: total ? 'none' : 'sum' })) onTrack('column_aggregation_changed'); }} />}
        </div></div>}
        {column.id !== 'key' && <div className="pop-group"><div className="pop-list">
            <MenuOption label="Move left" aligned={aligned} locked={!editable || !canMoveLeft} onClick={() => onMove(-1)} />
            <MenuOption label="Move right" aligned={aligned} locked={!editable || !canMoveRight} onClick={() => onMove(1)} />
        </div></div>}
        {(column.optional || column.custom) && <div className="pop-group"><div className="pop-list">
            <MenuOption label="Hide column" aligned={aligned} locked={!editable} onClick={onHide} />
            {column.custom && (confirming
                ? <div className="planning-review-column-row planning-review-column-confirm">
                    <span>Archive “{column.label}”? It leaves this table for everyone and cannot be restored here.</span>
                    <span className="planning-review-column-confirm-actions">
                        <button type="button" className="planning-action-button" onClick={archive}>Archive</button>
                        <button type="button" className="planning-action-button" onClick={() => { setConfirming(false); focusDialog(); }}>Cancel</button>
                    </span>
                </div>
                : <MenuOption label="Archive column…" aligned={aligned} locked={!editable} onClick={() => setConfirming(true)} />)}
        </div></div>}
    </div>;
}
