import * as React from 'react';

// The EPM burst, sized for inline controls. Same images and classes as LoadingState.
export default function LoadingMark({ size = 'xs', className = '' }) {
    return (
        <span className={`loading-mark loading-mark-${size} ${className}`.trim()} aria-hidden="true">
            <img className="loading-mark-spinner" src="epm-burst.svg" alt="" />
            <img className="loading-mark-signature" src="epm-burst.svg" alt="" />
        </span>
    );
}
