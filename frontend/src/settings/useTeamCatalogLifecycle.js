import * as React from 'react';

import { AUTH_REQUIRED_EVENT, isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    fetchAllTeams as requestAllTeams,
    fetchTeamCatalog as requestTeamCatalog,
    saveTeamCatalog as requestSaveTeamCatalog,
} from '../api/jiraCatalogApi.js';
import { mergeTeamCatalog } from './groupConfigUtils.js';
import {
    buildTeamMembershipOwnerKey,
    isTeamMembershipCurrent,
    shouldForceAfterOrdinaryTeamRead,
    shouldRetainTeamMembershipAfterFailure,
} from './teamAvailability.js';

const emptyMembership = () => ({
    generation: 0,
    modalGeneration: 0,
    sprintId: '',
    identity: '',
    browserContextId: '',
    scopeDigest: '',
    status: 'unknown',
    snapshot: [],
    validated: false,
    lifecycleKey: '',
});

export default function useTeamCatalogLifecycle({
    backendUrl,
    showSettings,
    selectedSprintInfo,
    sprintCatalogIdentity,
    sprintCatalogGeneration,
    sprintBrowserContextId,
    sharedConfigRevision,
    authResumeStagedRevision,
    setGroupDraftError,
}) {
    const [teamCatalogState, setTeamCatalogState] = React.useState({ catalog: {}, meta: {} });
    const teamCatalogStateRef = React.useRef({ catalog: {}, meta: {} });
    const [loadingTeams, setLoadingTeams] = React.useState(false);
    const [teamCatalogReady, setTeamCatalogReady] = React.useState(false);
    const [teamMembershipState, setTeamMembershipState] = React.useState(emptyMembership);
    const initializationGenerationRef = React.useRef(0);
    const modalGenerationRef = React.useRef(0);
    const modalOpenRef = React.useRef(false);
    if (modalOpenRef.current !== showSettings) {
        modalOpenRef.current = showSettings;
        modalGenerationRef.current += 1;
    }
    const currentLifecycleKey = [
        modalGenerationRef.current,
        showSettings ? 'open' : 'closed',
        selectedSprintInfo?.id || '',
        sprintCatalogIdentity || '',
        sprintCatalogGeneration || '',
        sprintBrowserContextId || '',
        sharedConfigRevision || '',
        authResumeStagedRevision || '',
    ].map(String).join('\u001f');
    const lifecycleKeyRef = React.useRef(currentLifecycleKey);
    lifecycleKeyRef.current = currentLifecycleKey;
    const directoryReadGenerationRef = React.useRef(0);
    const hydrationInFlightRef = React.useRef(null);

    const retireMembershipOwner = React.useCallback((ownerKey = null) => {
        const active = hydrationInFlightRef.current;
        if (!active || (ownerKey && active.ownerKey !== ownerKey)) return;
        hydrationInFlightRef.current = null;
        active.abortController?.abort();
        if (active.wallTimer) window.clearTimeout(active.wallTimer);
    }, []);

    const invalidateMembership = React.useCallback(() => {
        initializationGenerationRef.current += 1;
        retireMembershipOwner();
        setLoadingTeams(false);
        setTeamCatalogReady(false);
        setTeamMembershipState(current => ({
            ...emptyMembership(),
            generation: initializationGenerationRef.current,
            modalGeneration: modalGenerationRef.current,
            status: 'unknown',
            validated: false,
        }));
    }, [retireMembershipOwner]);

    const loadTeamCatalog = async ({ shouldApplyResult = () => true } = {}) => {
        const readGeneration = directoryReadGenerationRef.current + 1;
        directoryReadGenerationRef.current = readGeneration;
        const shouldApplyDirectory = () => (
            directoryReadGenerationRef.current === readGeneration && shouldApplyResult()
        );
        try {
            const response = await requestTeamCatalog(backendUrl);
            if (!response.ok) throw new Error(`Team catalog error ${response.status}`);
            const data = await response.json();
            if (shouldApplyDirectory()) {
                const nextDirectory = { catalog: data.catalog || {}, meta: data.meta || {} };
                teamCatalogStateRef.current = nextDirectory;
                setTeamCatalogState(nextDirectory);
            }
            return data;
        } catch (error) {
            if (isAuthenticationRequiredError(error)) return null;
            console.warn('Failed to load team catalog:', error);
            if (shouldApplyDirectory()) setGroupDraftError('Failed to load the team cache. Refresh teams to try again.');
            return null;
        }
    };

    const saveTeamCatalog = async (catalog, meta, merge = false, { shouldApplyResult = () => true } = {}) => {
        try {
            const response = await requestSaveTeamCatalog(backendUrl, { catalog, meta, merge });
            if (!response.ok) throw new Error(`Team catalog save error ${response.status}`);
            const data = await response.json();
            if (shouldApplyResult()) {
                directoryReadGenerationRef.current += 1;
                const nextDirectory = { catalog: data.catalog || {}, meta: data.meta || {} };
                teamCatalogStateRef.current = nextDirectory;
                setTeamCatalogState(nextDirectory);
            }
            return data;
        } catch (error) {
            if (isAuthenticationRequiredError(error)) return null;
            console.warn('Failed to save team catalog:', error);
            return null;
        }
    };

    const fetchAllTeamsFromJira = async ({ refresh = true, generation = null, signal = null } = {}) => {
        if (!selectedSprintInfo) {
            setGroupDraftError('Wait for sprint loading to finish before refreshing teams.');
            return false;
        }
        const sprintId = String(selectedSprintInfo.id);
        const requestGeneration = generation ?? initializationGenerationRef.current;
        const modalGeneration = modalGenerationRef.current;
        const lifecycleKey = currentLifecycleKey;
        const ownerKey = buildTeamMembershipOwnerKey({ sprintId, modalGeneration, requestGeneration });
        const membershipDocument = {
            generation: requestGeneration,
            modalGeneration,
            sprintId,
            identity: teamMembershipState.identity,
            browserContextId: String(sprintBrowserContextId || ''),
            scopeDigest: teamMembershipState.scopeDigest,
        };
        const hadValidatedMembership = teamMembershipState.lifecycleKey === lifecycleKey
            && isTeamMembershipCurrent(teamMembershipState, membershipDocument);
        const shouldApplyResult = () => (
            initializationGenerationRef.current === requestGeneration
            && modalGenerationRef.current === modalGeneration
            && lifecycleKeyRef.current === lifecycleKey
            && String(selectedSprintInfo?.id || '') === sprintId
            && String(sprintBrowserContextId || '') === membershipDocument.browserContextId
        );
        let inFlightHydration = hydrationInFlightRef.current;
        if (inFlightHydration && inFlightHydration.ownerKey !== ownerKey) {
            retireMembershipOwner(inFlightHydration.ownerKey);
            inFlightHydration = null;
        }
        if (inFlightHydration?.ownerKey === ownerKey) {
            if (refresh && inFlightHydration.mode === 'ordinary') {
                if (!inFlightHydration.queuedForcePromise) {
                    inFlightHydration.queuedForcePromise = inFlightHydration.promise.then((result) => {
                        const lifecycleCurrent = shouldApplyResult();
                        if (!shouldForceAfterOrdinaryTeamRead({
                            lifecycleCurrent,
                            pendingAttemptObserved: inFlightHydration.pendingAttemptObserved,
                        })) return lifecycleCurrent ? result : false;
                        return fetchAllTeamsFromJira({ refresh: true, generation: requestGeneration });
                    });
                }
                return inFlightHydration.queuedForcePromise;
            }
            return inFlightHydration.promise;
        }

        const ownerAbortController = new AbortController();
        const abortFromCaller = () => ownerAbortController.abort();
        if (signal?.aborted) ownerAbortController.abort();
        else signal?.addEventListener('abort', abortFromCaller, { once: true });
        const owner = {
            ownerKey,
            mode: refresh ? 'forced' : 'ordinary',
            promise: null,
            queuedForcePromise: null,
            pendingAttemptObserved: false,
            abortController: ownerAbortController,
            wallExpired: false,
            wallTimer: null,
        };
        owner.wallTimer = window.setTimeout(() => {
            owner.wallExpired = true;
            ownerAbortController.abort();
        }, 15000);
        hydrationInFlightRef.current = owner;
        const hydrationPromise = (async () => {
            if (shouldApplyResult()) {
                setLoadingTeams(true);
                setGroupDraftError('');
                setTeamMembershipState(current => ({
                    ...current,
                    generation: requestGeneration,
                    sprintId,
                    status: hadValidatedMembership ? 'refreshing' : 'loading',
                    lifecycleKey,
                }));
            }
            try {
                let response = await requestAllTeams(backendUrl, {
                    sprint: sprintId,
                    refresh,
                    signal: ownerAbortController.signal,
                });
                let data = await response.json().catch(() => ({}));
                owner.pendingAttemptObserved = Boolean(
                    data.cache?.refreshStatus === 'pending'
                    && data.cache?.refreshAttemptId
                    && data.cache?.identity
                );
                const expectedCatalogIdentity = owner.pendingAttemptObserved ? String(data.cache.identity) : '';
                const expectedScopeDigest = owner.pendingAttemptObserved ? String(data.cache.scopeDigest || '') : '';
                const expectedBrowserContextId = owner.pendingAttemptObserved ? String(data.cache.browserContextId || '') : '';
                const completionStartedAt = Date.now();
                let completionReads = 0;
                while (
                    data.cache?.refreshStatus === 'pending'
                    && data.cache?.refreshAttemptId
                    && completionReads < 5
                    && Date.now() - completionStartedAt < 15000
                ) {
                    await new Promise((resolve, reject) => {
                        let abort = null;
                        const timer = window.setTimeout(() => {
                            if (abort) ownerAbortController.signal.removeEventListener('abort', abort);
                            resolve();
                        }, 1000);
                        abort = () => {
                            window.clearTimeout(timer);
                            reject(new DOMException('Aborted', 'AbortError'));
                        };
                        if (ownerAbortController.signal.aborted) abort();
                        else ownerAbortController.signal.addEventListener('abort', abort, { once: true });
                    });
                    if (!shouldApplyResult()) return false;
                    const completionController = new AbortController();
                    const timeout = window.setTimeout(() => completionController.abort(), 2000);
                    const abortCompletion = () => completionController.abort();
                    ownerAbortController.signal.addEventListener('abort', abortCompletion, { once: true });
                    let completionTimedOut = false;
                    try {
                        response = await requestAllTeams(backendUrl, {
                            sprint: sprintId,
                            completionAttemptId: data.cache.refreshAttemptId,
                            catalogIdentity: data.cache.identity,
                            signal: completionController.signal,
                        });
                        data = await response.json().catch(() => ({}));
                        if (
                            String(data.cache?.identity || '') !== expectedCatalogIdentity
                            || String(data.cache?.scopeDigest || '') !== expectedScopeDigest
                            || String(data.cache?.browserContextId || '') !== expectedBrowserContextId
                        ) {
                            const error = new Error('Team catalog identity changed.');
                            error.code = 'team_catalog_identity_changed';
                            throw error;
                        }
                    } catch (error) {
                        if (error?.name === 'AbortError' && !ownerAbortController.signal.aborted) completionTimedOut = true;
                        else throw error;
                    } finally {
                        window.clearTimeout(timeout);
                        ownerAbortController.signal.removeEventListener('abort', abortCompletion);
                    }
                    completionReads += 1;
                    if (completionTimedOut) continue;
                }
                if (data.cache?.refreshStatus === 'pending' && data.cache?.refreshAttemptId) {
                    const error = new Error('Team refresh is taking longer than expected. Retry.');
                    error.code = 'team_completion_exhausted';
                    error.cache = data.cache;
                    throw error;
                }
                if (!response.ok) {
                    const error = new Error(data.error || `HTTP ${response.status}`);
                    error.status = response.status;
                    error.code = data.error || '';
                    error.cache = data.cache || null;
                    throw error;
                }

                const fetchedTeams = data.teams || [];
                if (!shouldApplyResult()) return false;
                const responseIdentity = String(data.cache?.identity || '');
                const responseScopeDigest = String(data.cache?.scopeDigest || '');
                const responseBrowserContextId = String(data.cache?.browserContextId || '');
                if (data.cache?.backend === 'postgresql' && (
                    !responseIdentity || !responseScopeDigest || !responseBrowserContextId
                )) throw new Error('Team catalog response is missing identity metadata.');
                setTeamMembershipState(current => ({
                    ...current,
                    generation: requestGeneration,
                    modalGeneration,
                    sprintId,
                    identity: responseIdentity,
                    browserContextId: responseBrowserContextId,
                    scopeDigest: responseScopeDigest,
                    status: data.cache?.state === 'refreshing'
                        ? 'refreshing'
                        : (data.cache?.state === 'failed' ? 'error' : 'ready'),
                    snapshot: fetchedTeams,
                    validated: true,
                    lifecycleKey,
                }));
                if (data.cache?.state === 'failed') setGroupDraftError('Team refresh failed. Retry.');
                directoryReadGenerationRef.current += 1;
                const nextDirectory = {
                    catalog: mergeTeamCatalog(teamCatalogStateRef.current.catalog, fetchedTeams),
                    meta: teamCatalogStateRef.current.meta || {},
                };
                teamCatalogStateRef.current = nextDirectory;
                setTeamCatalogState(nextDirectory);
                if (data.cache?.backend === 'postgresql') {
                    setTeamCatalogReady(true);
                    void loadTeamCatalog({ shouldApplyResult });
                    return true;
                }
                const savedCatalog = await saveTeamCatalog(nextDirectory.catalog, {
                    updatedAt: new Date().toISOString(),
                    sprintId,
                    sprintName: selectedSprintInfo?.name ? String(selectedSprintInfo.name) : '',
                    source: 'sprint',
                }, false, { shouldApplyResult });
                if (!savedCatalog || !shouldApplyResult()) {
                    if (!savedCatalog) throw new Error('The refreshed teams could not be saved.');
                    return false;
                }
                setTeamCatalogReady(true);
                return true;
            } catch (caughtError) {
                if (isAuthenticationRequiredError(caughtError)) return false;
                let error = caughtError;
                if (error?.name === 'AbortError') {
                    if (!owner.wallExpired || !shouldApplyResult()) return false;
                    error = Object.assign(new Error('Team refresh is taking longer than expected. Retry.'), {
                        code: 'team_completion_exhausted',
                    });
                }
                if (!shouldApplyResult()) return false;
                console.error('Error fetching teams from Jira:', error);
                const retainValidatedMembership = shouldRetainTeamMembershipAfterFailure({
                    membership: teamMembershipState,
                    failureCode: error?.code,
                    failureCache: error?.cache,
                });
                setGroupDraftError(error?.code === 'team_completion_exhausted'
                    ? 'Team refresh is taking longer than expected. Retry.'
                    : 'Team refresh failed. Retry.');
                setTeamMembershipState(current => ({
                    ...current,
                    generation: requestGeneration,
                    modalGeneration,
                    sprintId,
                    identity: String(error.cache?.identity || current.identity || ''),
                    browserContextId: String(error.cache?.browserContextId || current.browserContextId || ''),
                    scopeDigest: String(error.cache?.scopeDigest || current.scopeDigest || ''),
                    status: error?.code === 'team_completion_exhausted' ? 'exhausted' : 'error',
                    snapshot: retainValidatedMembership ? current.snapshot : [],
                    validated: retainValidatedMembership,
                    lifecycleKey,
                }));
                setTeamCatalogReady(retainValidatedMembership && hadValidatedMembership);
                return false;
            } finally {
                signal?.removeEventListener('abort', abortFromCaller);
                if (owner.wallTimer) window.clearTimeout(owner.wallTimer);
                if (hydrationInFlightRef.current?.ownerKey === ownerKey) hydrationInFlightRef.current = null;
                if (shouldApplyResult()) setLoadingTeams(false);
            }
        })();
        owner.promise = hydrationPromise;
        return hydrationPromise;
    };

    React.useEffect(() => {
        const modalGeneration = modalGenerationRef.current;
        if (!showSettings) return undefined;
        setTeamCatalogReady(false);
        void loadTeamCatalog({ shouldApplyResult: () => modalGenerationRef.current === modalGeneration });
        return () => {
            retireMembershipOwner();
        };
    }, [showSettings]);

    React.useEffect(() => {
        if (!showSettings) return undefined;
        if (!selectedSprintInfo) {
            setTeamCatalogReady(false);
            setTeamMembershipState(current => ({
                ...current,
                sprintId: '',
                identity: '',
                browserContextId: '',
                scopeDigest: '',
                status: 'unknown',
                snapshot: [],
                validated: false,
            }));
            return undefined;
        }
        const generation = initializationGenerationRef.current + 1;
        initializationGenerationRef.current = generation;
        retireMembershipOwner();
        setTeamCatalogReady(false);
        setTeamMembershipState({
            generation,
            modalGeneration: modalGenerationRef.current,
            sprintId: String(selectedSprintInfo.id),
            identity: '',
            browserContextId: String(sprintBrowserContextId || ''),
            scopeDigest: '',
            status: 'loading',
            snapshot: [],
            validated: false,
            lifecycleKey: currentLifecycleKey,
        });
        void fetchAllTeamsFromJira({ refresh: false, generation });
        return () => retireMembershipOwner();
    }, [
        showSettings,
        selectedSprintInfo?.id,
        sprintCatalogIdentity,
        sprintCatalogGeneration,
        sprintBrowserContextId,
        sharedConfigRevision,
        authResumeStagedRevision,
    ]);

    React.useEffect(() => {
        const handleAuthRequired = () => invalidateMembership();
        window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
        return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    }, [invalidateMembership]);

    const membershipIsCurrent = showSettings && teamMembershipState.lifecycleKey === currentLifecycleKey;
    const currentTeamMembershipState = membershipIsCurrent ? teamMembershipState : {
        ...emptyMembership(),
        generation: teamMembershipState.generation,
        modalGeneration: modalGenerationRef.current,
        lifecycleKey: currentLifecycleKey,
    };
    return {
        teamCatalogState,
        loadingTeams: membershipIsCurrent && loadingTeams,
        teamCatalogReady: membershipIsCurrent && teamCatalogReady,
        teamMembershipState: currentTeamMembershipState,
        fetchAllTeamsFromJira,
        invalidateTeamMembership: invalidateMembership,
    };
}
