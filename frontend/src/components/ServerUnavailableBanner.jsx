import * as React from 'react';

export default function ServerUnavailableBanner({
    message,
    onRetry,
}) {
    if (!message) return null;
    return (
        <div className="server-unavailable-banner" role="alert">
            <div>
                <div className="server-unavailable-title">Server is not responding</div>
                <p>{message}</p>
            </div>
            <button type="button" onClick={onRetry}>
                Retry connection
            </button>
        </div>
    );
}
