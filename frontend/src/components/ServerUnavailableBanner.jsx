import * as React from 'react';

export default function ServerUnavailableBanner({
    message,
    status = 'unavailable',
    perimeterExpired = false,
    onRetry,
}) {
    if (!message) return null;
    const busy = status === 'checking' || status === 'waiting_for_save' || status === 'restoring';
    const requiresManualRetry = status === 'manual_required';
    const requiresPerimeterReload = perimeterExpired && requiresManualRetry;
    return (
        <div className="server-unavailable-banner" role="alert">
            <div>
                <div className="server-unavailable-title">{perimeterExpired ? 'Sign-in session expired' : 'Server is not responding'}</div>
                <p>{requiresPerimeterReload ? 'Your sign-in session expired. Reload the page to sign in again; unsaved changes are kept.' : message}</p>
                {requiresManualRetry && !perimeterExpired && <p>Automatic recovery already ran for this outage. Retry explicitly when the server is ready.</p>}
            </div>
            <button type="button" onClick={onRetry} disabled={busy}>
                {status === 'checking' ? 'Checking connection…' : status === 'waiting_for_save' ? 'Waiting for save…' : status === 'restoring' ? 'Reloading…' : requiresPerimeterReload ? 'Reload page' : 'Retry connection'}
            </button>
        </div>
    );
}
