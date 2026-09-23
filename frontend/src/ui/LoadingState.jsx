import * as React from 'react';

export default function LoadingState({ title, message, className = '', ariaLabel }) {
    const classes = ['loading-state', className].filter(Boolean).join(' ');

    return (
        <div className={classes} role="status" aria-live="polite" aria-label={ariaLabel}>
            <div className="loading-mark" aria-hidden="true">
                <img className="loading-mark-spinner" src="epm-burst.svg" alt="" />
                <img className="loading-mark-signature" src="epm-burst.svg" alt="" />
            </div>
            <div className="loading-state-copy">
                <h2>{title}</h2>
                {message && <p>{message}</p>}
            </div>
        </div>
    );
}
