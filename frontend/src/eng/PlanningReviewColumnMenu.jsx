import * as React from 'react';

function MenuOption({ label, locked, onClick }) {
    return <button type="button" className={`pop-opt${locked ? ' is-locked' : ''}`} aria-disabled={locked || undefined} onClick={() => { if (!locked) onClick(); }}>
        <span className="box" aria-hidden="true" style={{ visibility: 'hidden' }} /><span className="pop-opt-content"><span className="pop-opt-label">{label}</span></span>
    </button>;
}

// Per-column actions, opened from the header cell. Required Jira columns can only move; optional and review columns can also be hidden.
export default function PlanningReviewColumnMenu({ column, editable, canMoveLeft, canMoveRight, onMove, onHide }) {
    return <>
        <div className="pop-subject">{column.label}</div>
        <div className="pop-group"><div className="pop-list">
            <MenuOption label="Move left" locked={!editable || !canMoveLeft} onClick={() => onMove(-1)} />
            <MenuOption label="Move right" locked={!editable || !canMoveRight} onClick={() => onMove(1)} />
        </div></div>
        {(column.optional || column.custom) && <div className="pop-group"><div className="pop-list">
            <MenuOption label="Hide column" locked={!editable} onClick={onHide} />
        </div></div>}
        <p className="planning-review-guidance">Shift-click a heading to sort by several columns.</p>
    </>;
}
