import * as React from 'react';

export default function ServerUnavailableBanner({
    message,
    status = 'unavailable',
    onRetry,
}) {
    if (!message) return null;
    const busy = status === 'checking' || status === 'waiting_for_save' || status === 'restoring';
    const requiresManualRetry = status === 'manual_required';
    return (
        <div className="server-unavailable-banner" role="alert">
            <div>
                <div className="server-unavailable-title">Server is not responding</div>
                <p>{message}</p>
                {requiresManualRetry && <p>Automatic recovery already ran for this outage. Retry explicitly when the server is ready.</p>}
            </div>
            <button type="button" onClick={onRetry} disabled={busy}>
                {status === 'checking' ? 'Checking connection…' : status === 'waiting_for_save' ? 'Waiting for save…' : status === 'restoring' ? 'Reloading…' : 'Retry connection'}
            </button>
        </div>
    );
}
