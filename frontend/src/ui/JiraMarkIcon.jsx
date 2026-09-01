import * as React from 'react';

export default function JiraMarkIcon({ className = '' }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
        >
            <path className="jira-export-icon-mark jira-export-icon-mark-secondary" d="M11.8 3.2 3 12l8.8 8.8 3-3L9 12l5.8-5.8-3-3z" />
            <path className="jira-export-icon-mark" d="M12.2 3.2 21 12l-8.8 8.8-3-3L15 12 9.2 6.2l3-3z" />
        </svg>
    );
}
