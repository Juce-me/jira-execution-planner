import * as React from 'react';
import IconButton from '../ui/IconButton.jsx';
import { trackShareViewAction } from '../analytics/dashboardAnalytics.js';
import { shareViewCopyMessage, shareViewNoticeMessage } from './noticeCopy.js';

const COPIED_MS = 2000;
const LABEL = 'Copy link to this view';

// The Share control, rendered on both header surfaces. It copies the captured URL; when the
// clipboard is unavailable or refuses the write, the notice shows the URL in a read-only field.
export default function ShareViewButton({ surface, share, sourceSurface, activeControlSurface }) {
    const [copied, setCopied] = React.useState(false);
    const [local, setLocal] = React.useState(null);
    const timerRef = React.useRef(null);
    const active = surface === activeControlSurface;

    const attemptRef = React.useRef({ generation: 0, active, mounted: true });
    if (attemptRef.current.active !== active) {
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
        if (!active) {
            window.clearTimeout(timerRef.current);
            setCopied(false);
            setLocal(null);
        }
    }, [active]);

    const report = (result) => trackShareViewAction({ workflowAction: 'copy_link', result, sourceSurface });
    const copy = async () => {
        if (share.shareDisabled || !active) return;
        const generation = ++attemptRef.current.generation;
        window.clearTimeout(timerRef.current);
        setCopied(false);
        const isCurrent = () => attemptRef.current.mounted && attemptRef.current.active
            && attemptRef.current.generation === generation;
        const captured = share.captureShareUrl();
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
        timerRef.current = window.setTimeout(() => { if (isCurrent()) setCopied(false); }, COPIED_MS);
        setCopied(true);
        const message = shareViewCopyMessage({ type: 'copied', dropped: captured.dropped });
        setLocal(message ? { message } : null);
    };

    const notice = local || (share.notice ? { message: shareViewNoticeMessage(share.notice) } : null);
    return (
        <div data-share-view={surface}>
            <IconButton
                variant="secondary compact"
                className="header-icon-button"
                onClick={copy}
                disabled={share.shareDisabled}
                title={share.shareDisabled ? 'Sharing is available once the view has loaded' : LABEL}
                aria-label={LABEL}
                data-share-view-control=""
            >
                {copied ? (
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
            <span className="planning-review-sr-only" role="status">{copied ? 'Link copied' : ''}</span>
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
                        <button type="button" onClick={local ? () => setLocal(null) : () => share.dismissNotice()}>Dismiss</button>
                    </div>
                </div>
            )}
        </div>
    );
}
