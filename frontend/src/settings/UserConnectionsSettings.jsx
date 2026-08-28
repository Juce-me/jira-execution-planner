import * as React from 'react';

import { trackEvent } from '../analytics/analytics.js';
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

export default function UserConnectionsSettings({ backendUrl, onConnectionChange }) {
    const [connection, setConnection] = React.useState({ connected: false });
    const [profileEmail, setProfileEmail] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [apiToken, setApiToken] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const status = connectionStatus(connection);

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setMessage('');
        setError('');
        Promise.all([
            fetchHomeTokenConnection(backendUrl).catch(() => ({ connected: false })),
            fetchAuthStatus(backendUrl).catch(() => ({})),
        ]).then(([connectionPayload, authStatus]) => {
            if (cancelled) return;
            const nextConnection = connectionPayload || { connected: false };
            const authEmail = String(authStatus?.email || authStatus?.profile?.email || '').trim();
            const connectedEmail = String(nextConnection?.credentialSubject || '').trim();
            setConnection(nextConnection);
            onConnectionChange?.(nextConnection);
            setProfileEmail(authEmail);
            setEmail(connectedEmail || authEmail);
            trackConnectionAction('status', nextConnection?.connected ? 'success' : 'failure');
        }).catch((loadError) => {
            if (cancelled) return;
            setConnection({ connected: false });
            setError(errorMessage(loadError));
            trackConnectionAction('status', 'failure');
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [backendUrl, onConnectionChange]);

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
            onConnectionChange?.(nextConnection || { connected: false });
            setEmail(String(nextConnection?.credentialSubject || email || profileEmail || '').trim());
            setApiToken('');
            setMessage('Connection saved.');
            trackConnectionAction(connection?.connected ? 'reconnect_result' : 'connect_result', 'success');
        } catch (connectError) {
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
            onConnectionChange?.(normalizedConnection);
            setApiToken('');
            setEmail(profileEmail || '');
            setMessage('Connection revoked.');
            trackConnectionAction('revoke_result', 'success');
        } catch (revokeError) {
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
