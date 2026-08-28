import * as React from 'react';
import { trackAuthRequiredLock } from '../analytics/analytics.js';
import {
    AUTH_REQUIRED_EVENT,
    readPendingAuthenticationRequired,
    sanitizeLoginUrl,
} from '../api/authRequired.js';

export default function AuthRequiredGate({ children }) {
    const recoveryLinkRef = React.useRef(null);
    const initialAuthRequiredRef = React.useRef(readPendingAuthenticationRequired());
    const previousLockedRef = React.useRef(Boolean(initialAuthRequiredRef.current));
    const authRequired = React.useSyncExternalStore(
        React.useCallback((notify) => {
            window.addEventListener(AUTH_REQUIRED_EVENT, notify);
            return () => window.removeEventListener(AUTH_REQUIRED_EVENT, notify);
        }, []),
        readPendingAuthenticationRequired,
        readPendingAuthenticationRequired,
    );

    React.useEffect(() => {
        if (authRequired && !previousLockedRef.current) {
            trackAuthRequiredLock();
        }
        previousLockedRef.current = Boolean(authRequired);
    }, [authRequired]);

    React.useEffect(() => {
        if (!authRequired) return undefined;
        recoveryLinkRef.current?.focus();
        const blockKeyboard = (event) => {
            const recoveryLink = event.target?.closest?.('.auth-required-action');
            if (recoveryLink && event.key === 'Enter') return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        window.addEventListener('keydown', blockKeyboard, true);
        document.addEventListener('keydown', blockKeyboard, true);
        return () => {
            window.removeEventListener('keydown', blockKeyboard, true);
            document.removeEventListener('keydown', blockKeyboard, true);
        };
    }, [authRequired]);

    const loginUrl = sanitizeLoginUrl(authRequired?.loginUrl);
    return (
        <>
            <div inert={authRequired ? '' : undefined} aria-hidden={authRequired ? 'true' : undefined}>
                {children}
            </div>
            {authRequired && (
                <div className="auth-required-backdrop">
                    <section
                        className="auth-required-dialog"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="auth-required-title"
                        aria-describedby="auth-required-description"
                    >
                        <h1 id="auth-required-title">Sign in required</h1>
                        <p id="auth-required-description">Your session can no longer access this application. Sign in again to continue.</p>
                        <a className="auth-required-action" href={loginUrl} ref={recoveryLinkRef}>Sign in again</a>
                    </section>
                </div>
            )}
        </>
    );
}
