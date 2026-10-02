import React from 'react';

// Renders the shared status pill. By default it is a passive <span>. When
// `interactive` is set (ENG Catch Up / Planning status transitions), it renders a
// native <button> with the exact same `.status-pill` classes so it looks identical
// to the span pill (button reset lives in styles/eng/status-transitions.css). EPM
// and every other passive caller keeps the unchanged <span>. The pill adds no tooltip
// of its own: repeating the visible text is noise. Callers whose text can be clipped
// pass `title` explicitly.
export default function StatusPill({
    label,
    className = '',
    title,
    children,
    interactive = false,
    onClick,
    ...props
}) {
    const content = children ?? label;
    const classes = ['status-pill', className]
        .filter(Boolean)
        .join(' ');

    if (interactive) {
        return (
            <button type="button" className={classes} title={title} onClick={onClick} {...props}>
                {content}
            </button>
        );
    }

    return (
        <span className={classes} title={title} {...props}>
            {content}
        </span>
    );
}
