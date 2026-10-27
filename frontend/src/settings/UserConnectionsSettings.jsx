import * as React from 'react';

import { trackEvent } from '../analytics/analytics.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    connectHomeTokenConnection,
    deleteHomeTokenConnection,
    fetchAuthStatus,
    fetchHomeTokenConnection,
} from '../api/authApi.js';

function connectionStatus(connection) {
    if (!connection?.connected) {
        return { label: 'Not connected', className: 'muted' };
    }
    if (connection.needsReconnect || connection.status !== 'active') {
        return { label: 'Reconnect required', className: 'warning' };
    }
    return { label: 'Connected', className: 'success' };
}

function errorMessage(error) {
    return error?.message || 'Connection update failed.';
}

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

function trackConnectionAction(workflowAction, result) {
    try {
        trackEvent('connection_action', {
            feature_name: 'settings',
            connection_type: 'home_townsquare',
            workflow_action: workflowAction,
            ...(result ? { result } : {}),
            source_surface: 'settings'
        });
    } catch (err) {
        console.warn('Analytics event skipped:', err.message);
    }
}

export default function UserConnectionsSettings({ backendUrl, epmViewPreference = null }) {
    const [connection, setConnection] = React.useState({ connected: false });
    const [profileEmail, setProfileEmail] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [apiToken, setApiToken] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const status = connectionStatus(connection);
    const epmSavedEnabled = epmViewPreference?.savedEnabled === true;
    const epmAccess = epmViewPreference?.access || null;
    const epmStatus = epmViewStatus(epmSavedEnabled, epmAccess);
    const epmCopy = epmSavedEnabled ? EPM_ACCESS_COPY[epmAccess?.state] || '' : '';
    const epmScopeUrl = epmSavedEnabled && epmAccess?.state !== 'available'
        ? (epmAccess?.loginUrl || epmViewPreference?.loginUrl || '')
        : '';

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setMessage('');
        setError('');
        Promise.allSettled([
            fetchHomeTokenConnection(backendUrl),
            fetchAuthStatus(backendUrl),
        ]).then(([connectionResult, authResult]) => {
            if (cancelled) return;
            const authFailure = [connectionResult, authResult].find(result => (
                result.status === 'rejected' && isAuthenticationRequiredError(result.reason)
            ));
            if (authFailure) return;
            const connectionPayload = connectionResult.status === 'fulfilled' ? connectionResult.value : null;
            const authStatus = authResult.status === 'fulfilled' ? authResult.value : null;
            if (connectionResult.status === 'rejected') {
                setError(errorMessage(connectionResult.reason));
                trackConnectionAction('status', 'failure');
                return;
            }
            const nextConnection = connectionPayload || { connected: false };
            const authEmail = String(authStatus?.email || authStatus?.profile?.email || '').trim();
            const connectedEmail = String(nextConnection?.credentialSubject || '').trim();
            setConnection(nextConnection);
            setProfileEmail(authEmail);
            setEmail(connectedEmail || authEmail);
            trackConnectionAction('status', nextConnection?.connected ? 'success' : 'failure');
            if (authResult.status === 'rejected') setError(errorMessage(authResult.reason));
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [backendUrl]);

    const connect = async () => {
        setSaving(true);
        setMessage('');
        setError('');
        trackConnectionAction(connection?.connected ? 'reconnect' : 'connect');
        try {
            const nextConnection = await connectHomeTokenConnection(backendUrl, {
                email,
                apiToken,
            });
            setConnection(nextConnection || { connected: false });
            setEmail(String(nextConnection?.credentialSubject || email || profileEmail || '').trim());
            setApiToken('');
            setMessage('Connection saved.');
            trackConnectionAction(connection?.connected ? 'reconnect_result' : 'connect_result', 'success');
        } catch (connectError) {
            if (isAuthenticationRequiredError(connectError)) return;
            setApiToken('');
            setError(errorMessage(connectError));
            trackConnectionAction(connection?.connected ? 'reconnect_result' : 'connect_result', 'failure');
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        setSaving(true);
        setMessage('');
        setError('');
        trackConnectionAction('revoke');
        try {
            const nextConnection = await deleteHomeTokenConnection(backendUrl);
            const normalizedConnection = nextConnection || { connected: false };
            setConnection(normalizedConnection);
            setApiToken('');
            setEmail(profileEmail || '');
            setMessage('Connection revoked.');
            trackConnectionAction('revoke_result', 'success');
        } catch (revokeError) {
            if (isAuthenticationRequiredError(revokeError)) return;
            setApiToken('');
            setError(errorMessage(revokeError));
            trackConnectionAction('revoke_result', 'failure');
        } finally {
            setSaving(false);
        }
    };

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
                <section className="group-projects-subsection user-connection-card" aria-labelledby="home-token-title">
                    <div className="user-connection-header">
                        <div>
                            <div id="home-token-title" className="group-pane-title">Jira Home write access</div>
                            {connection?.credentialSubject && (
                                <div className="group-modal-meta">{connection.credentialSubject}</div>
                            )}
                        </div>
                        <span className={`user-connection-status ${status.className}`}>{status.label}</span>
                    </div>

                    {loading ? (
                        <div className="group-modal-meta">Loading connection...</div>
                    ) : (
                        <>
                            <div className="settings-two-col-grid user-connection-form">
                                <label className="group-projects-subsection" htmlFor="home-token-email">
                                    <div className="team-selector-label">Email</div>
                                    <input
                                        id="home-token-email"
                                        type="email"
                                        className="team-search-input"
                                        value={email}
                                        onChange={(event) => setEmail(event.target.value)}
                                        autoComplete="email"
                                    />
                                </label>
                                <label className="group-projects-subsection" htmlFor="home-token-api-token">
                                    <div className="team-selector-label">API token</div>
                                    <input
                                        id="home-token-api-token"
                                        type="password"
                                        className="team-search-input"
                                        value={apiToken}
                                        onChange={(event) => setApiToken(event.target.value)}
                                        autoComplete="off"
                                        aria-label="Atlassian API token"
                                    />
                                </label>
                            </div>
                            <div className="group-modal-actions user-connection-actions">
                                <button
                                    className="compact"
                                    type="button"
                                    onClick={connect}
                                    disabled={saving || !email.trim() || !apiToken}
                                >
                                    {saving ? 'Saving...' : connection?.connected ? 'Reconnect' : 'Connect'}
                                </button>
                                {connection?.connected && (
                                    <button
                                        className="secondary compact danger lift-hover"
                                        type="button"
                                        onClick={revoke}
                                        disabled={saving}
                                    >
                                        Revoke
                                    </button>
                                )}
                            </div>
                            {message && <div className="group-modal-meta" role="status">{message}</div>}
                            {error && <div className="group-modal-warning" role="alert">{error}</div>}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
