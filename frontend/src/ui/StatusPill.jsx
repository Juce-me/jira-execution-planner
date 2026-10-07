import React from 'react';
import { useStatusColourStyle } from '../issues/StatusColourContext.jsx';

// Renders the shared status pill. By default it is a passive <span>. When
// `interactive` is set (ENG Catch Up / Planning status transitions), it renders a
// native <button> with the exact same `.status-pill` classes so it looks identical
// to the span pill (button reset lives in styles/eng/status-transitions.css). EPM
// and every other passive caller keeps the unchanged <span>. The pill adds no tooltip
// of its own: repeating the visible text is noise. Callers whose text can be clipped
// pass `title` explicitly. `status` opts the pill into the Department Board column colour
// (see issues/StatusColourContext.jsx); it is never forwarded to the DOM.
export default function StatusPill({
    label,
    className = '',
    title,
    children,
    interactive = false,
    onClick,
    status,
    style,
    ...props
}) {
    const inherited = useStatusColourStyle()(status);
    const mergedStyle = inherited ? { ...style, ...inherited } : style;
    const content = children ?? label;
    const classes = ['status-pill', className]
        .filter(Boolean)
        .join(' ');

    if (interactive) {
        return (
            <button type="button" className={classes} title={title} onClick={onClick} {...props} style={mergedStyle}>
                {content}
            </button>
        );
    }

    return (
        <span className={classes} title={title} {...props} style={mergedStyle}>
            {content}
        </span>
    );
}
