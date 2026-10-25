import * as React from 'react';
import IconButton from '../ui/IconButton.jsx';

// A static snapshot of the alert the user opened: no status pill, pills or actions. The back button reuses the
// unframed hint-dismiss control (design-system "Inherited-view hint and its dismiss").
export default function AlertPinBar({ pin, style, onBack, onClose }) {
    return (
        <div className="alert-story alert-story--pinned" data-alert-pin style={style}>
            <IconButton size="sm" className="planning-review-column-action" aria-label="Back to alerts" onClick={onBack}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
            </IconButton>
            <div className="alert-story-main">
                <span className="epic-key">{pin.key}</span>{' '}{pin.title}
            </div>
            <div className="alert-story-note">{pin.note}</div>
            <button className="task-remove alert-remove" title="Dismiss from alerts" type="button" onClick={onClose}>×</button>
        </div>
    );
}
