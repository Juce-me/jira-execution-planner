import * as React from 'react';
import IconButton from '../ui/IconButton.jsx';
import { trackShareViewAction } from '../analytics/dashboardAnalytics.js';
import { shareViewCopyMessage, shareViewNoticeMessage } from './noticeCopy.js';

const COPIED_MS = 2000;
const LABEL = 'Copy view link';

// The same Share control serves header view copies and explicit Epic copies. It copies the captured URL; when the
// clipboard is unavailable or refuses the write, the notice shows the URL in a read-only field.
export default function ShareViewButton({ surface, share, sourceSurface, activeControlSurface, epicKey, scopeKey }) {
    const [copied, setCopied] = React.useState(false);
    const [local, setLocal] = React.useState(null);
    const timerRef = React.useRef(null);
    const active = surface === activeControlSurface;
    const owner = share.copyOwner;
    const copyGeneration = React.useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
    const ownedGenerationRef = React.useRef(null);
    const ownsFeedback = ownedGenerationRef.current === copyGeneration;

    const identity = JSON.stringify([surface, scopeKey, sourceSurface, epicKey, share.shareDisabled]);
    const destination = epicKey ? `Epic ${epicKey} link copied` : 'View link copied';
    const label = epicKey ? `Copy link to Epic ${epicKey}` : LABEL;
    const attemptRef = React.useRef({ generation: 0, active, identity, mounted: true });
    if (attemptRef.current.active !== active || attemptRef.current.identity !== identity) {
        attemptRef.current.identity = identity;
        attemptRef.current.active = active;
        attemptRef.current.generation += 1;
    }
    React.useEffect(() => {
        attemptRef.current.mounted = true;
        return () => {
            attemptRef.current.mounted = false;
            attemptRef.current.generation += 1;
            window.clearTimeout(timerRef.current);
        };
    }, []);
    React.useEffect(() => {
        window.clearTimeout(timerRef.current);
        setCopied(false);
        setLocal(null);
    }, [active, identity]);

    React.useEffect(() => {
        if (ownsFeedback) return;
        window.clearTimeout(timerRef.current);
        setCopied(false);
        setLocal(null);
    }, [copyGeneration, ownsFeedback]);

    const report = (result) => trackShareViewAction({ workflowAction: 'copy_link', result, sourceSurface });
    const copy = async () => {
        if (share.shareDisabled || !active) return;
        const generation = ++attemptRef.current.generation;
        const ownerGeneration = owner.begin();
        ownedGenerationRef.current = ownerGeneration;
        window.clearTimeout(timerRef.current);
        setCopied(false);
        setLocal(null);
        const isCurrent = () => attemptRef.current.mounted && attemptRef.current.active
            && attemptRef.current.generation === generation && owner.getSnapshot() === ownerGeneration;
        const captured = epicKey ? share.captureShareUrl({ kind: 'epic', key: epicKey }) : share.captureShareUrl();
        if (!captured.ok) {
            if (captured.reason === 'disabled') return;
            setLocal({ message: shareViewCopyMessage({ type: 'refused', reason: captured.reason }) });
            report('failure');
            return;
        }
        try {
            await navigator.clipboard.writeText(captured.url);
        } catch {
            report('failure');
            if (!isCurrent()) return;
            setCopied(false);
            setLocal({ message: shareViewCopyMessage({ type: 'manual', dropped: captured.dropped }), url: captured.url });
            return;
        }
        report('success');
        if (!isCurrent()) return;
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => { if (isCurrent()) { setCopied(false); if (!captured.dropped.length) setLocal(null); } }, COPIED_MS);
        setCopied(true);
        const message = shareViewCopyMessage({ type: 'copied', dropped: captured.dropped });
        setLocal({ message: message ? message.replace('Link copied', destination) : `${destination}.` });
    };

    const currentLocal = ownsFeedback ? local : null;
    const notice = currentLocal || (!epicKey && share.notice ? { message: shareViewNoticeMessage(share.notice) } : null);
    return (
        <div data-share-view={surface} data-share-feedback={currentLocal ? 'active' : undefined}>
            <IconButton
                size={epicKey ? 'sm' : undefined}
                variant="secondary compact"
                className="header-icon-button"
                onClick={copy}
                disabled={share.shareDisabled}
                title={share.shareDisabled ? 'Sharing is available once the view has loaded' : epicKey ? 'Copy link to this Epic' : LABEL}
                aria-label={label}
                data-share-view-control=""
            >
                {copied && ownsFeedback ? (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="copied">
                        <path d="M5 12.25l4.5 4.5L19 7.25" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="link">
                        <g transform="rotate(-45 12 12)" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9.5 7.5H7a4.5 4.5 0 0 0 0 9h2.5"/>
                            <path d="M14.5 7.5H17a4.5 4.5 0 0 1 0 9h-2.5"/>
                            <path d="M9.5 12h5"/>
                        </g>
                    </svg>
                )}
            </IconButton>
            {/* The app's only visually hidden utility, defined with the Planning review styles. */}
            <span className="planning-review-sr-only" role="status">{copied && ownsFeedback ? destination : ''}</span>
            {active && notice?.message && (
                <div className="server-unavailable-banner connection-recovery-notice" role="status">
                    <div>
                        <p>{notice.message}</p>
                        {notice.url && (
                            <input
                                className="search-input"
                                type="text"
                                readOnly
                                autoFocus
                                value={notice.url}
                                aria-label="Link to copy"
                                onFocus={(event) => event.target.select()}
                            />
                        )}
                    </div>
                    <div className="connection-recovery-notice-actions">
                        <button type="button" onClick={currentLocal ? () => setLocal(null) : () => share.dismissNotice()}>Dismiss</button>
                    </div>
                </div>
            )}
        </div>
    );
}
