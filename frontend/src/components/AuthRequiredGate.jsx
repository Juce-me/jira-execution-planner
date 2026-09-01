import * as React from 'react';
import { trackAuthRequiredLock } from '../analytics/analytics.js';
import {
    AUTH_REQUIRED_EVENT,
    readPendingAuthenticationRequired,
    sanitizeLoginUrl,
} from '../api/authRequired.js';
import {
    claimAuthRecovery,
    consumeAuthRecoverySuccess,
    getAuthRecoveryStores,
    readLiveAuthRecoveryLease,
} from '../api/authRecoveryCoordinator.js';

export default function AuthRequiredGate({ children }) {
    const recoveryLinkRef = React.useRef(null);
    const navigationStartedRef = React.useRef(false);
    const claimPendingRef = React.useRef(false);
    const initialAuthRequiredRef = React.useRef(readPendingAuthenticationRequired());
    const previousLockedRef = React.useRef(Boolean(initialAuthRequiredRef.current));
    const [claimPending, setClaimPending] = React.useState(false);
    const [recoveryRole, setRecoveryRole] = React.useState('');
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

    const reconcilePersistedState = React.useCallback((stores) => {
        if (!authRequired || claimPendingRef.current || navigationStartedRef.current) return false;
        const liveLease = readLiveAuthRecoveryLease(stores.sharedStorage);
        setRecoveryRole(liveLease ? 'follower' : '');
        const success = consumeAuthRecoverySuccess(
            stores.sharedStorage,
            stores.tabStorage,
            { requestStartedAt: authRequired.requestStartedAt },
        );
        if (!success) return false;
        navigationStartedRef.current = true;
        window.location.assign('/');
        return true;
    }, [authRequired]);

    React.useEffect(() => {
        if (!authRequired) return undefined;
        const stores = getAuthRecoveryStores(window);
        if (!stores) return undefined;
        const reconcile = () => reconcilePersistedState(stores);
        window.addEventListener('storage', reconcile);
        reconcile();
        return () => window.removeEventListener('storage', reconcile);
    }, [authRequired, reconcilePersistedState]);

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
    const handleRecoveryClick = async (event) => {
        event.preventDefault();
        if (navigationStartedRef.current || claimPendingRef.current) return;
        claimPendingRef.current = true;
        setClaimPending(true);
        const stores = getAuthRecoveryStores(window);
        if (!stores) {
            claimPendingRef.current = false;
            setClaimPending(false);
            navigationStartedRef.current = true;
            window.location.assign(loginUrl);
            return;
        }
        const result = await claimAuthRecovery(stores.sharedStorage, stores.tabStorage, {
            requestStartedAt: authRequired.requestStartedAt,
        });
        claimPendingRef.current = false;
        setClaimPending(false);
        if (reconcilePersistedState(stores) || navigationStartedRef.current) return;
        if (result.role === 'follower') {
            setRecoveryRole('follower');
            return;
        }
        navigationStartedRef.current = true;
        window.location.assign(result.role === 'resume' ? '/' : loginUrl);
    };
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
                        <p id="auth-required-description">
                            {recoveryRole === 'follower'
                                ? 'Sign-in is continuing in another tab. This tab will resume automatically.'
                                : 'Your session can no longer access this application. Sign in again to continue.'}
                        </p>
                        <a
                            className="auth-required-action"
                            href={loginUrl}
                            ref={recoveryLinkRef}
                            aria-disabled={claimPending ? 'true' : undefined}
                            onClick={handleRecoveryClick}
                        >
                            Sign in again
                        </a>
                    </section>
                </div>
            )}
        </>
    );
}
