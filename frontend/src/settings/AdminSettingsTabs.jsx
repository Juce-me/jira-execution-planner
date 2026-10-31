import * as React from 'react';

import { adminTabIdsFor, effectiveAdminTab } from './settingsTabIds.js';

const ADMIN_TABS = [
    ['project', 'Project config'],
    ['scope', 'Scope projects'],
    ['source', 'Jira source'],
    ['mapping', 'Field mapping'],
    ['capacity', 'Capacity'],
    ['priorityWeights', 'Priority weights'],
    ['access', 'Access'],
    ['performance', 'Performance'],
];

export default function AdminSettingsTabs({ activeTab: requestedTab, onSelect, onKeyDown, performanceAvailable = false, accessAvailable = true, workConfigMode = 'legacy' }) {
    const activeTab = effectiveAdminTab(workConfigMode, requestedTab);
    const visible = adminTabIdsFor(workConfigMode, { accessAvailable, performanceAvailable });
    return (
        <div
            className="group-modal-tabs epm-settings-tabs"
            role="tablist"
            aria-label="Admin settings sections"
            onKeyDown={onKeyDown}
        >
            {ADMIN_TABS.filter(([id]) => visible.includes(id)).map(([id, label]) => (
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
