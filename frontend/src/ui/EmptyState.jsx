import * as React from 'react';

export default function EmptyState({ title, children, className = '' }) {
    const classes = ['empty-state', className].filter(Boolean).join(' ');

    return (
        <div className={classes}>
            <h2>{title}</h2>
            {children}
        </div>
    );
}
