import React from 'react';

export default function StatusPill({
    label,
    className = '',
    title,
    children,
    ...props
}) {
    const content = children ?? label;
    const classes = ['status-pill', className]
        .filter(Boolean)
        .join(' ');

    return (
        <span className={classes} title={title || label} {...props}>
            {content}
        </span>
    );
}
