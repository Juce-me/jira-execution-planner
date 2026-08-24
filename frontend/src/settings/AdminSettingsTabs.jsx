import * as React from 'react';

const ADMIN_TABS = [
    ['scope', 'Scope projects'],
    ['source', 'Jira source'],
    ['mapping', 'Field mapping'],
    ['capacity', 'Capacity'],
    ['priorityWeights', 'Priority weights'],
    ['access', 'Access'],
];

export default function AdminSettingsTabs({ activeTab, onSelect, onKeyDown }) {
    return (
        <div
            className="group-modal-tabs epm-settings-tabs"
            role="tablist"
            aria-label="Admin settings sections"
            onKeyDown={onKeyDown}
        >
            {ADMIN_TABS.map(([id, label]) => (
                <button
                    className={`group-modal-tab ${activeTab === id ? 'active' : ''}`}
                    onClick={() => onSelect(id)}
                    role="tab"
                    aria-selected={activeTab === id}
                    aria-controls={`admin-settings-${id}-panel`}
                    id={`admin-settings-${id}-tab`}
                    type="button"
                    key={id}
                >{label}</button>
            ))}
        </div>
    );
}
