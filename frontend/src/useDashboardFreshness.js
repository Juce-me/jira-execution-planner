import React from 'react';
import { createDashboardFreshnessController, isFreshnessEligible } from './dashboardFreshnessController.js';
import { installFreshnessListeners } from './dashboardFreshnessListeners.js';
import { LONG_ABSENCE_MS } from './api/authRefreshContract.js';
import { readPendingAuthenticationRequired } from './api/authRequired.js';

export function useDashboardFreshness(options = {}) {
    const currentRef = React.useRef(options);
    currentRef.current = options;
    const ownersRef = React.useRef(null);
    const automaticRefreshRef = React.useRef(null);
    const lifecycleRef = React.useRef({ sessionEpoch: 0, authReady: null, inFlight: false, connectionOwned: false, terminalAuth: Boolean(readPendingAuthenticationRequired()) });
    const controllerRef = React.useRef(null);
    const previousEnvironmentRef = React.useRef(null);
    const [state, setState] = React.useState(null);
    const readEnvironmentRef = React.useRef(null);
    readEnvironmentRef.current = () => {
        const current = currentRef.current;
        const doc = current.doc || globalThis.document;
        const ownerEnvironment = (ownersRef.current?.readEnvironment || current.readEnvironment)?.() || {};
        const lifecycle = lifecycleRef.current;
        const bootstrapReady = ownerEnvironment.bootstrapReady ?? current.bootstrapReady ?? false;
        return { ...ownerEnvironment,
            focused: Boolean(doc?.visibilityState === 'visible' && doc?.hasFocus?.()),
            bootstrapReady,
            sessionEpoch: lifecycle.sessionEpoch,
            authReady: !lifecycle.inFlight && (lifecycle.authReady ?? ownerEnvironment.authReady ?? current.authReady ?? bootstrapReady),
            terminalAuth: Boolean(lifecycle.terminalAuth || current.terminalAuth || ownerEnvironment.terminalAuth || readPendingAuthenticationRequired()),
            connectionOwned: Boolean(lifecycle.connectionOwned || current.connectionOwned || ownerEnvironment.connectionOwned),
        };
    };
    const readAdapter = surface => {
        const owners = ownersRef.current;
        const resolved = owners?.resolveFreshnessSurface ? owners.resolveFreshnessSurface() : surface;
        return owners?.readAdapter?.(resolved) || null;
    };
    const create = () => createDashboardFreshnessController({ readEnvironment: () => readEnvironmentRef.current(), readAdapter, notify: setState });
    if (!controllerRef.current) controllerRef.current = create();
    React.useEffect(() => {
        // Effects may be cleaned up and installed again by React StrictMode.
        if (!controllerRef.current) controllerRef.current = create();
        const controller = controllerRef.current;
        const lifecycle = lifecycleRef.current;
        const current = currentRef.current;
        const listeners = installFreshnessListeners(current.win || window, current.doc || document, {
            update: controller.update, request: controller.request,
            now: Date.now,
            shouldCheckBfcache: () => {
                const env = readEnvironmentRef.current();
                const sources = readAdapter(env.surface)?.sources() || [];
                return sources.some(source => { const check = controller.getState().checks[source]; return check?.checkKind !== 'forced' || Date.now() - check.lastCheckedAtMs > LONG_ABSENCE_MS; });
            },
            onAuthActivity: detail => {
                if (!['refreshing', 'settled', 'failed'].includes(detail.status)) return;
                lifecycle.inFlight = detail.status === 'refreshing';
                lifecycle.authReady = detail.status !== 'refreshing';
            },
            onSessionRefresh: () => { lifecycle.sessionEpoch += 1; lifecycle.authReady = true; },
            onTerminalAuth: () => { lifecycle.terminalAuth = true; },
            onConnectionChange: unavailable => { lifecycle.connectionOwned = unavailable; },
        });
        setState(controller.getState());
        return () => { listeners.dispose(); controller.dispose(); controllerRef.current = null; };
    }, []);
    React.useEffect(() => {
        if (!controllerRef.current) controllerRef.current = create();
        const environment = readEnvironmentRef.current();
        const next = { eligible: isFreshnessEligible(environment, { starting: true }), contextKey: environment.contextKey, surface: environment.surface, sessionEpoch: environment.sessionEpoch };
        const previous = previousEnvironmentRef.current;
        if (previous && Object.keys(next).some(key => previous[key] !== next[key])) void controllerRef.current.update().catch(() => {});
        previousEnvironmentRef.current = next;
    });
    return { state: state || controllerRef.current.getState(), ownersRef, automaticRefreshRef,
        ownsSurface: surface => Boolean(readAdapter(surface)),
        supersedeManual: options => controllerRef.current?.supersedeManual(options),
        acceptChecks: options => controllerRef.current?.acceptChecks(options),
    };
}
