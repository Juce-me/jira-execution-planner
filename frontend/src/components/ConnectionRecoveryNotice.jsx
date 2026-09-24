import * as React from 'react';

export default function ConnectionRecoveryNotice({ notice, onRecover, onDiscard, onDismiss, onReloadDiscard }) {
    if (!notice) return null;
    const actionable = notice.kind === 'blocked_scope' || notice.kind === 'failed';
    return (
        <div className="server-unavailable-banner connection-recovery-notice" role="status">
            <p>{notice.message}</p>
            <div className="connection-recovery-notice-actions">
                {actionable && <button type="button" onClick={onRecover}>Recover</button>}
                {actionable && <button type="button" onClick={onDiscard}>Discard recovery copy</button>}
                {notice.kind === 'discard_required' && (
                    <button type="button" onClick={onReloadDiscard}>Reload and discard</button>
                )}
                {notice.kind === 'settings_discarded' && <button type="button" onClick={onDismiss}>Dismiss</button>}
            </div>
        </div>
    );
}
