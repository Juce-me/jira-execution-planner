import * as React from 'react';
import IconButton from '../ui/IconButton.jsx';

const ICON_PATHS = {
    total: <path d="M12 3H4.5l4 5-4 5H12" />,
    rename: <><path d="M3 13l.6-3L10.8 2.8l2.4 2.4L6 12.4z" /><path d="M9.2 4.4l2.4 2.4" /></>,
    archive: <><rect x="2" y="3" width="12" height="3" rx="0.5" /><path d="M3 6v7h10V6M6.5 9h3" /></>,
};

function ColumnAction({ icon, label, title = label, ...props }) {
    return <IconButton size="sm" className="planning-review-column-action" aria-label={label} title={title} {...props}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[icon]}</svg>
    </IconButton>;
}

function RenameField({ column, review, onError, onFinish }) {
    const settled = React.useRef(false);
    const settle = (value, refocus) => {
        if (settled.current) return;
        settled.current = true;
        if (value !== null && value.trim() !== column.label) {
            const renamed = review.changeSchema({ action: 'rename', columnId: column.id, label: value.trim() });
            onError(renamed ? '' : 'Enter a column name of 1–80 characters.');
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

export default function PlanningReviewColumnsMenu({ mode, columns, archivedColumns, hidden, editable, review, onVisibilityChange, onError, onArchived }) {
    const rootRef = React.useRef(null);
    const [renaming, setRenaming] = React.useState(null);
    const [confirming, setConfirming] = React.useState(null);
    const focusDialog = () => rootRef.current?.closest('[role="dialog"]')?.focus({ preventScroll: true });
    const jiraColumns = columns.filter(column => !column.custom);
    const reviewColumns = columns.filter(column => column.custom);
    const toggle = column => <button key={column.id} type="button" className="pop-opt" aria-pressed={!hidden.has(column.id)} disabled={!editable} onClick={() => onVisibilityChange(column.id, hidden.has(column.id))}>
        <span className="box" aria-hidden="true" /><span className="pop-opt-content"><span className="pop-opt-label" title={column.label}>{column.label}</span></span>
    </button>;
    const archive = column => {
        setConfirming(null); focusDialog();
        review.changeSchema({ action: 'archive', columnId: column.id, archived: true });
        onArchived();
    };
    const reviewRow = column => {
        if (renaming === column.id) return <div className="planning-review-column-row" key={column.id}>
            <RenameField column={column} review={review} onError={onError} onFinish={refocus => { setRenaming(null); if (refocus) focusDialog(); }} />
        </div>;
        if (confirming === column.id) return <div className="planning-review-column-row planning-review-column-confirm" key={column.id}>
            <span>Archive “{column.label}”? It leaves this table for everyone and cannot be restored here.</span>
            <span className="planning-review-column-confirm-actions">
                <button type="button" className="planning-action-button" onClick={() => archive(column)}>Archive</button>
                <button type="button" className="planning-action-button" onClick={() => { setConfirming(null); focusDialog(); }}>Cancel</button>
            </span>
        </div>;
        return <div className="planning-review-column-row" key={column.id}>
            {toggle(column)}
            <span className="planning-review-column-actions">
                {column.type === 'number' && <ColumnAction icon="total" label={`Total for ${column.label}`} title="Show a total in the footer" aria-pressed={column.aggregation === 'sum'} disabled={!editable}
                    onClick={() => review.changeSchema({ action: 'aggregation', columnId: column.id, aggregation: column.aggregation === 'sum' ? 'none' : 'sum' })} />}
                <ColumnAction icon="rename" label={`Rename ${column.label}`} disabled={!editable} onClick={() => setRenaming(column.id)} />
                <ColumnAction icon="archive" label={`Archive ${column.label}`} disabled={!editable} onClick={() => setConfirming(column.id)} />
            </span>
        </div>;
    };
    return <div className="planning-review-columns" ref={rootRef}>
        <div className="pop-subject">Columns · {mode === 'epic' ? 'Epics' : 'Stories'}</div>
        {jiraColumns.length > 0 && <div className="pop-group">
            <div className="pop-head"><span className="pop-facet">Jira fields</span></div>
            <div className="pop-list" role="group" aria-label="Jira fields">{jiraColumns.map(toggle)}</div>
        </div>}
        {(reviewColumns.length > 0 || archivedColumns.length > 0) && <div className="pop-group">
            <div className="pop-head"><span className="pop-facet">Review columns · shared</span></div>
            <div className="pop-list" role="group" aria-label="Review columns">
                {reviewColumns.map(reviewRow)}
                {archivedColumns.map(column => <div className="planning-review-column-archived" key={column.id}>{column.label} · archived</div>)}
            </div>
        </div>}
    </div>;
}
