import * as React from 'react';

const EPM_ACCESS_STATUS = {
    available: { label: 'Available', className: 'success' },
    scope_missing: { label: 'Permission needed', className: 'warning' },
    empty: { label: 'No goals found', className: 'warning' },
    denied: { label: 'No access', className: 'warning' },
    unavailable: { label: 'Unavailable', className: 'warning' },
};

const EPM_ACCESS_COPY = {
    scope_missing: 'Atlassian Home read permission has not been granted yet.',
    empty: 'No accessible Atlassian Home goal matches the configured EPM scope. Check the scope in Settings > EPM.',
    denied: 'Atlassian Home did not grant access to the configured EPM scope.',
    unavailable: 'Atlassian Home could not be checked right now. Try again later.',
};

// The saved preference and its access state. Checking the box is never evidence of consent or access:
// the status and the scope-update link come only from the saved value, the config and the access read.
function epmViewStatus(savedEnabled, access) {
    if (!savedEnabled) return { label: 'Off', className: 'muted' };
    return EPM_ACCESS_STATUS[access?.state] || { label: 'Checking', className: 'muted' };
}

export default function UserConnectionsSettings({ epmViewPreference = null }) {
    const epmSavedEnabled = epmViewPreference?.savedEnabled === true;
    const epmAccess = epmViewPreference?.access || null;
    const epmStatus = epmViewStatus(epmSavedEnabled, epmAccess);
    const epmCopy = epmSavedEnabled ? EPM_ACCESS_COPY[epmAccess?.state] || '' : '';
    const epmScopeUrl = epmSavedEnabled && epmAccess?.state !== 'available'
        ? (epmAccess?.loginUrl || epmViewPreference?.loginUrl || '')
        : '';

    return (
        <div className="group-modal-body user-connections-settings">
            <div className="group-pane-list">
                {epmViewPreference && (
                    <section className="group-projects-subsection user-connection-card" aria-labelledby="epm-view-title">
                        <div className="user-connection-header">
                            <div id="epm-view-title" className="group-pane-title">EPM view</div>
                            <span className={`user-connection-status ${epmStatus.className}`}>{epmStatus.label}</span>
                        </div>
                        <div className="group-preference-row">
                            <label className="group-visible-control">
                                <input
                                    id="epm-view-enabled"
                                    type="checkbox"
                                    checked={epmViewPreference.checked === true}
                                    disabled={epmViewPreference.saving === true}
                                    aria-describedby="epm-view-enabled-helper"
                                    onChange={(event) => epmViewPreference.onChange(event.target.checked)}
                                />
                                <span>Enable EPM view</span>
                            </label>
                            <span id="epm-view-enabled-helper" className="group-visible-helper">
                                Reads Atlassian Home goals and projects with your Atlassian sign-in. Turning it off keeps your saved EPM scope and connections.
                            </span>
                        </div>
                        {epmCopy && <div className="group-modal-meta" role="status">{epmCopy}</div>}
                        {epmScopeUrl && (
                            <div className="group-modal-meta">
                                <a href={epmScopeUrl}>Update Atlassian permissions</a>
                            </div>
                        )}
                        {epmViewPreference.error && <div className="group-modal-warning" role="alert">{epmViewPreference.error}</div>}
                    </section>
                )}
            </div>
        </div>
    );
}
