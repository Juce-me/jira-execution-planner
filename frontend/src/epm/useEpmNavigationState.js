import * as React from 'react';

import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { fetchEpmAccess } from '../api/epmApi.js';
import { isEpmNavigationVisible, normalizeEpmAccess, normalizeEpmCapabilities } from '../dashboardRuntime.js';

const DENIED_ACCESS = { state: 'denied', homeReadAvailable: false, loginUrl: '', message: '' };
const UNAVAILABLE_ACCESS = { state: 'unavailable', homeReadAvailable: false, loginUrl: '', message: '' };

const sameCapabilities = (a, b) => Boolean(a) && a.basicCompatibility === b.basicCompatibility
    && a.viewEnabled === b.viewEnabled && a.homeReadAvailable === b.homeReadAvailable && a.loginUrl === b.loginUrl;

// Owns the EPM capability fields of the config response, the one bounded EPM access read and the single
// navigation rule. Access is read only for an enabled user whose Home scopes are verified (never for Basic,
// disabled or missing-scope users); a refresh keeps the held decision until the new one arrives.
export function useEpmNavigationState({ backendUrl }) {
    const [capabilities, setCapabilities] = React.useState(null);
    const [access, setAccess] = React.useState(null);
    const [refreshNonce, setRefreshNonce] = React.useState(0);
    const requestIdRef = React.useRef(0);

    const applyEpmCapabilityConfig = React.useCallback((config) => {
        const next = normalizeEpmCapabilities(config);
        setCapabilities((previous) => (sameCapabilities(previous, next) ? previous : next));
    }, []);
    const refreshEpmAccess = React.useCallback(() => setRefreshNonce((value) => value + 1), []);
    // A Home read answered home_access_denied: retire any in-flight access decision and hide navigation.
    const invalidateHomeAvailability = React.useCallback(() => {
        requestIdRef.current += 1;
        setAccess(DENIED_ACCESS);
    }, []);

    const reads = Boolean(capabilities) && !capabilities.basicCompatibility
        && capabilities.viewEnabled && capabilities.homeReadAvailable;
    React.useEffect(() => {
        requestIdRef.current += 1;
        if (!reads) {
            setAccess(null);
            return undefined;
        }
        const requestId = requestIdRef.current;
        void (async () => {
            let next;
            try {
                next = normalizeEpmAccess(await fetchEpmAccess(backendUrl)) || UNAVAILABLE_ACCESS;
            } catch (error) {
                if (isAuthenticationRequiredError(error)) return;
                next = UNAVAILABLE_ACCESS;
            }
            if (requestIdRef.current === requestId) setAccess(next);
        })();
        return () => { requestIdRef.current += 1; };
    }, [backendUrl, reads, refreshNonce]);

    const showEpmNavigation = isEpmNavigationVisible(capabilities, access);
    // Ready once the capability fields arrived and, when an access read is owed, its decision settled.
    const epmReadReady = Boolean(capabilities) && (!reads || access !== null);
    return {
        applyEpmCapabilityConfig, epmAccess: access, epmCapabilities: capabilities, epmReadReady,
        invalidateHomeAvailability, refreshEpmAccess, showEpmNavigation,
    };
}
