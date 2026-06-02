import * as React from 'react';

export default function EpmProjectCollapseAllButton({
    label,
    onClick,
    pressed,
}) {
    return (
        <button
            className="group-gear-button epm-project-collapse-all-button"
            onClick={onClick}
            title={label}
            aria-label={label}
            aria-pressed={pressed}
            type="button"
        >
            <svg className="epm-project-collapse-all-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <g className="epm-project-collapse-all-stack">
                    <rect x="4.25" y="4.35" width="9.6" height="3.5" rx="1.1"/>
                    <rect x="4.25" y="10.25" width="9.6" height="3.5" rx="1.1"/>
                    <rect x="4.25" y="16.15" width="9.6" height="3.5" rx="1.1"/>
                </g>
                {pressed ? (
                    <g className="epm-project-collapse-all-arrows">
                        <path d="M18 10.15V4.85"/>
                        <path d="M15.6 7.25 18 4.85l2.4 2.4"/>
                        <path d="M18 13.85v5.3"/>
                        <path d="M15.6 16.75 18 19.15l2.4-2.4"/>
                    </g>
                ) : (
                    <g className="epm-project-collapse-all-arrows">
                        <path d="M18 4.85v5.3"/>
                        <path d="M15.6 7.75 18 10.15l2.4-2.4"/>
                        <path d="M18 19.15v-5.3"/>
                        <path d="M15.6 16.25 18 13.85l2.4 2.4"/>
                    </g>
                )}
            </svg>
        </button>
    );
}
