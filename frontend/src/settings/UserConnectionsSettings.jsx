import * as React from 'react';

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

export default function UserConnectionsSettings({ backendUrl }) {
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
            setProfileEmail(authEmail);
            setEmail(connectedEmail || authEmail);
        }).catch((loadError) => {
            if (cancelled) return;
            setConnection({ connected: false });
            setError(errorMessage(loadError));
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
        try {
            const nextConnection = await connectHomeTokenConnection(backendUrl, {
                email,
                apiToken,
            });
            setConnection(nextConnection || { connected: false });
            setEmail(String(nextConnection?.credentialSubject || email || profileEmail || '').trim());
            setApiToken('');
            setMessage('Connection saved.');
        } catch (connectError) {
            setApiToken('');
            setError(errorMessage(connectError));
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        setSaving(true);
        setMessage('');
        setError('');
        try {
            await deleteHomeTokenConnection(backendUrl);
            setConnection({ connected: false });
            setApiToken('');
            setEmail(profileEmail || '');
            setMessage('Connection revoked.');
        } catch (revokeError) {
            setApiToken('');
            setError(errorMessage(revokeError));
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
