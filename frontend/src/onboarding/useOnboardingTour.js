import * as React from 'react';
import {
    deriveTourNavigationState,
    reconcileCurrentStepId,
    reconcileTourSessionState,
} from './onboardingSteps.js';
import { trackOnboardingAnalytics } from './onboardingAnalytics.js';
import { AUTH_REQUIRED_EVENT, isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    ONBOARDING_MODULE_IDS,
    activateOnboardingModule,
    allOnboardingModulesComplete,
    closeOnboardingModuleSession,
    createOnboardingModuleSession,
    isOnboardingModuleComplete,
    nextOnboardingModuleRequest,
    normalizeCompletedOnboardingModules,
    resetOnboardingModuleRequest,
} from './onboardingModules.js';
import { ONBOARDING_STEPS_BY_MODULE } from './onboardingSteps.js';

const ONBOARDING_PREFERENCE_RETRY_ERROR = 'Saved onboarding preference could not be verified. Please retry.';
const ONBOARDING_PREFERENCE_SAVE_ERROR = 'Failed to save onboarding preference. Please retry.';
const DEFAULT_CAN_START_MODULE = () => true;

export function isOnboardingModuleStartAllowed(canStartModule, moduleId) {
    return typeof canStartModule !== 'function' || canStartModule(moduleId) !== false;
}

export function shouldAutomaticallyStartOnboarding({
    bootstrapReady = false,
    completedModules = [],
    run = false,
    automaticStarted = false,
    replayPending = false,
    activeSurface = 'catch-up',
} = {}) {
    return Boolean(bootstrapReady
        && activeSurface === 'catch-up'
        && !isOnboardingModuleComplete(completedModules, 'catch-up')
        && !run
        && !automaticStarted
        && !replayPending);
}

function normalizeCompletionPayload(payload) {
    return Array.isArray(payload?.completedOnboardingModules)
        ? normalizeCompletedOnboardingModules(payload.completedOnboardingModules)
        : [];
}

export function resolveOnboardingCompletionTransition(state = {}, payload, moduleId) {
    const savedModules = normalizeCompletionPayload(payload);
    if (!isOnboardingModuleComplete(savedModules, moduleId)) {
        throw new Error(ONBOARDING_PREFERENCE_RETRY_ERROR);
    }
    return {
        ...state,
        run: false,
        requestNonce: 0,
        moduleRequest: null,
        completedModules: savedModules,
        onboardingDone: allOnboardingModulesComplete(savedModules),
    };
}

export function resolveOnboardingCompletionSettlement(
    payload,
    moduleId,
    { completionGeneration, currentGeneration } = {},
) {
    const transition = resolveOnboardingCompletionTransition({}, payload, moduleId);
    return {
        saved: true,
        shouldClose: completionGeneration === currentGeneration,
        moduleId,
        completedModules: transition.completedModules,
        onboardingDone: transition.onboardingDone,
    };
}

export function shouldCloseOnboardingTourAfterSettlement(settlement) {
    return settlement !== false && settlement?.shouldClose !== false;
}

export function shouldCloseOnboardingModuleForSurface({
    effectiveOpen = false,
    activeModule = '',
    activeSurface = '',
    moduleRequest = null,
} = {}) {
    if (!effectiveOpen || !activeModule) return false;
    const expectedSurface = activeModule === 'configuration' ? 'settings' : activeModule;
    if (activeSurface === expectedSurface) return false;
    const requestedModule = String(moduleRequest?.moduleId || '');
    const requestedSurface = requestedModule === 'configuration' ? 'settings' : requestedModule;
    return !requestedSurface || requestedSurface !== activeSurface;
}

export function resolveOnboardingReplayTransition(state = {}, payload) {
    if (!Array.isArray(payload?.completedOnboardingModules)
        || payload.completedOnboardingModules.length
        || payload?.onboardingDone !== false) {
        throw new Error(ONBOARDING_PREFERENCE_RETRY_ERROR);
    }
    return {
        ...resetOnboardingModuleRequest({
            ...state,
            completedModules: [],
        }),
        onboardingDone: false,
    };
}

export function classifyOnboardingPersistenceError(error) {
    if (isAuthenticationRequiredError(error)) {
        return { authRequired: true, message: '' };
    }
    return {
        authRequired: false,
        message: error?.message || ONBOARDING_PREFERENCE_SAVE_ERROR,
    };
}

export function updateOnboardingStepUnlock(currentKey, action = {}) {
    if (action.type === 'clear') return null;
    if (action.type !== 'unlock' || action.activeProgression !== 'menu-preview') return currentKey;
    const sessionId = Number(action.sessionId) || 0;
    const stepId = String(action.stepId || '');
    if (!sessionId
        || sessionId !== action.activeSessionId
        || !stepId
        || stepId !== action.activeStepId) return currentKey;
    if (currentKey?.sessionId === sessionId && currentKey?.stepId === stepId) return currentKey;
    return { sessionId, stepId };
}

export function useOnboardingController({
    bootstrapReady = false,
    activeSurface = 'catch-up',
    completedModules,
    setCompletedModules,
    completeModule,
    resetModules,
    prepareCatchUp,
    closeSettings,
    trackSettingsAction,
    canStartModule = DEFAULT_CAN_START_MODULE,
} = {}) {
    const [run, setRun] = React.useState(false);
    const [sourceSurface, setSourceSurface] = React.useState('first_run');
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState('');
    const [moduleRequest, setModuleRequest] = React.useState(null);
    const automaticStartedRef = React.useRef(false);
    const inFlightRef = React.useRef(false);
    const replayPendingRef = React.useRef(false);
    const moduleRequestNonceRef = React.useRef(0);
    const normalizedCompletedModules = React.useMemo(
        () => normalizeCompletedOnboardingModules(completedModules),
        [completedModules],
    );

    const resetModuleRequests = React.useCallback(() => {
        moduleRequestNonceRef.current = 0;
        setModuleRequest(null);
    }, []);

    const openModule = React.useCallback((moduleId, source) => {
        if (!isOnboardingModuleStartAllowed(canStartModule, moduleId)) return false;
        const normalizedSource = source === 'settings' ? 'settings' : 'first_run';
        const current = {
            run,
            completedModules: normalizedCompletedModules,
            requestNonce: moduleRequestNonceRef.current,
            moduleRequest,
        };
        const next = nextOnboardingModuleRequest(current, moduleId);
        if (next === current) return false;
        moduleRequestNonceRef.current = next.requestNonce;
        setModuleRequest(next.moduleRequest);
        setError('');
        setSourceSurface(normalizedSource);
        setRun(true);
        trackOnboardingAnalytics(trackSettingsAction, 'started', normalizedSource, moduleId);
        return true;
    }, [canStartModule, moduleRequest, normalizedCompletedModules, run, trackSettingsAction]);

    React.useEffect(() => {
        if (!shouldAutomaticallyStartOnboarding({
            bootstrapReady,
            completedModules: normalizedCompletedModules,
            run,
            automaticStarted: automaticStartedRef.current,
            replayPending: replayPendingRef.current,
            activeSurface,
        })) return;
        automaticStartedRef.current = openModule('catch-up', 'first_run');
    }, [activeSurface, bootstrapReady, normalizedCompletedModules, openModule, run]);

    React.useEffect(() => {
        if (isOnboardingModuleComplete(normalizedCompletedModules, 'catch-up')) {
            automaticStartedRef.current = false;
        }
    }, [normalizedCompletedModules]);

    const persistModule = React.useCallback(async (moduleId, outcome) => {
        if (inFlightRef.current || !ONBOARDING_MODULE_IDS.includes(moduleId)) return false;
        if (typeof completeModule !== 'function') return false;
        const completionGeneration = moduleRequestNonceRef.current;
        inFlightRef.current = true;
        setPending(true);
        setError('');
        try {
            const payload = await completeModule(moduleId);
            const settlement = resolveOnboardingCompletionSettlement(
                payload,
                moduleId,
                {
                    completionGeneration,
                    currentGeneration: moduleRequestNonceRef.current,
                },
            );
            setCompletedModules?.(settlement);
            if (settlement.shouldClose) {
                setRun(false);
                moduleRequestNonceRef.current = 0;
                setModuleRequest(null);
            }
            trackOnboardingAnalytics(trackSettingsAction, outcome, sourceSurface, moduleId);
            return settlement;
        } catch (saveError) {
            const classified = classifyOnboardingPersistenceError(saveError);
            if (classified.authRequired) return false;
            setError(classified.message);
            return false;
        } finally {
            inFlightRef.current = false;
            setPending(false);
        }
    }, [completeModule, setCompletedModules, sourceSurface, trackSettingsAction]);

    const skip = React.useCallback((moduleId = 'catch-up') => (
        persistModule(moduleId, 'skipped')
    ), [persistModule]);
    const finish = React.useCallback((moduleId = 'catch-up') => (
        persistModule(moduleId, 'completed')
    ), [persistModule]);
    const replay = React.useCallback(async () => {
        if (inFlightRef.current || typeof resetModules !== 'function') return false;
        replayPendingRef.current = true;
        inFlightRef.current = true;
        setPending(true);
        setError('');
        let transition;
        try {
            const payload = await resetModules();
            transition = resolveOnboardingReplayTransition({
                run,
                completedModules: normalizedCompletedModules,
                requestNonce: moduleRequestNonceRef.current,
                moduleRequest,
            }, payload);
            setCompletedModules?.(transition);
        } catch (saveError) {
            const classified = classifyOnboardingPersistenceError(saveError);
            if (!classified.authRequired) setError(classified.message);
            replayPendingRef.current = false;
            return false;
        } finally {
            inFlightRef.current = false;
            setPending(false);
        }
        closeSettings?.();
        prepareCatchUp?.();
        if (isOnboardingModuleStartAllowed(canStartModule, 'catch-up')) {
            moduleRequestNonceRef.current = transition.requestNonce;
            setModuleRequest(transition.moduleRequest);
            setSourceSurface('settings');
            setRun(transition.run);
            trackOnboardingAnalytics(trackSettingsAction, 'started', 'settings', 'catch-up');
        } else {
            resetModuleRequests();
            setRun(false);
        }
        replayPendingRef.current = false;
        return true;
    }, [canStartModule, closeSettings, moduleRequest, normalizedCompletedModules, prepareCatchUp, resetModuleRequests, resetModules, run, setCompletedModules, trackSettingsAction]);

    const requestModule = React.useCallback((moduleId) => {
        return openModule(moduleId, sourceSurface);
    }, [openModule, sourceSurface]);

    const clearModuleRequest = React.useCallback((requestNonce) => {
        setModuleRequest((current) => (
            current?.requestNonce === requestNonce ? null : current
        ));
    }, []);

    const interrupt = React.useCallback((moduleId) => {
        if (!ONBOARDING_MODULE_IDS.includes(moduleId)) return false;
        if (moduleId === 'catch-up') automaticStartedRef.current = false;
        setError('');
        setRun(false);
        resetModuleRequests();
        return true;
    }, [resetModuleRequests]);

    React.useEffect(() => {
        const reset = () => resetModuleRequests();
        window.addEventListener(AUTH_REQUIRED_EVENT, reset);
        return () => window.removeEventListener(AUTH_REQUIRED_EVENT, reset);
    }, [resetModuleRequests]);

    return {
        run,
        sourceSurface,
        pending,
        error,
        moduleRequest,
        requestModule,
        clearModuleRequest,
        interrupt,
        skip,
        finish,
        replay,
    };
}

export default function useOnboardingTour({
    steps = [],
    run = false,
    completedModules,
    onSkip,
    onFinish,
    activeSurface = 'catch-up',
    moduleRequest = null,
    onModuleRequestConsumed,
    onModuleInterrupted,
} = {}) {
    const [sessionState, setSessionState] = React.useState(() => ({
        sessionOpen: false,
        currentStepId: steps[0]?.id || '',
    }));
    const previousStepsRef = React.useRef(steps);
    const normalizedCompletedModules = React.useMemo(
        () => normalizeCompletedOnboardingModules(completedModules),
        [completedModules],
    );
    const [moduleSession, setModuleSession] = React.useState(() => (
        createOnboardingModuleSession(normalizedCompletedModules)
    ));
    const consumedModuleRequestRef = React.useRef(0);
    const sessionCounterRef = React.useRef(0);
    const sessionOpenRef = React.useRef(false);
    const [unlockedStepKey, setUnlockedStepKey] = React.useState(null);
    const activeSteps = moduleSession.activeModule
        ? (moduleSession.activeModule === 'catch-up'
            ? steps
            : (ONBOARDING_STEPS_BY_MODULE[moduleSession.activeModule] || []))
        : [];
    const activeModuleComplete = isOnboardingModuleComplete(
        normalizedCompletedModules,
        moduleSession.activeModule,
    );
    const effectiveOpen = Boolean(run && moduleSession.activeModule && !activeModuleComplete && activeSteps.length);
    let effectiveState = reconcileTourSessionState(sessionState, { isOpen: effectiveOpen, steps: activeSteps });
    if (effectiveState.sessionOpen) {
        const reconciledStepId = reconcileCurrentStepId({
            previousSteps: previousStepsRef.current,
            nextSteps: activeSteps,
            currentStepId: effectiveState.currentStepId,
        });
        if (reconciledStepId !== effectiveState.currentStepId) {
            effectiveState = { ...effectiveState, currentStepId: reconciledStepId };
        }
    }
    if (effectiveState !== sessionState) setSessionState(effectiveState);

    const resolvedStepId = effectiveState.currentStepId;
    const foundIndex = activeSteps.findIndex((step) => step.id === resolvedStepId);
    const currentIndex = foundIndex < 0 ? 0 : foundIndex;
    const navigation = deriveTourNavigationState({
        run,
        onboardingDone: !moduleSession.activeModule || activeModuleComplete,
        currentIndex,
        totalSteps: activeSteps.length,
    });
    if (navigation.isOpen && !sessionOpenRef.current) {
        sessionCounterRef.current += 1;
        sessionOpenRef.current = true;
    } else if (!navigation.isOpen) {
        sessionOpenRef.current = false;
    }
    const sessionId = sessionCounterRef.current;
    const currentStep = activeSteps[navigation.index] || null;
    const stepUnlocked = Boolean(unlockedStepKey
        && unlockedStepKey.sessionId === sessionId
        && unlockedStepKey.stepId === currentStep?.id);
    const clearStepUnlock = React.useCallback(() => {
        setUnlockedStepKey((current) => updateOnboardingStepUnlock(current, { type: 'clear' }));
    }, []);
    const unlockStep = React.useCallback((key = {}) => {
        setUnlockedStepKey((current) => updateOnboardingStepUnlock(current, {
            type: 'unlock',
            sessionId: key.sessionId,
            stepId: key.stepId,
            activeSessionId: sessionId,
            activeStepId: currentStep?.id || '',
            activeProgression: currentStep?.progression || '',
        }));
    }, [currentStep, sessionId]);

    React.useLayoutEffect(() => {
        previousStepsRef.current = activeSteps;
    }, [activeSteps]);

    React.useEffect(() => {
        if (run) return;
        consumedModuleRequestRef.current = 0;
        clearStepUnlock();
        setModuleSession(createOnboardingModuleSession(normalizedCompletedModules));
    }, [clearStepUnlock, run]);

    React.useEffect(() => {
        const requestNonce = Number(moduleRequest?.requestNonce) || 0;
        const moduleId = String(moduleRequest?.moduleId || '');
        const expectedSurface = moduleId === 'configuration' ? 'settings' : moduleId;
        if (!run
            || !requestNonce
            || requestNonce <= consumedModuleRequestRef.current
            || isOnboardingModuleComplete(normalizedCompletedModules, moduleId)
            || activeSurface !== expectedSurface) return;

        consumedModuleRequestRef.current = requestNonce;
        clearStepUnlock();
        setModuleSession((state) => {
            return activateOnboardingModule({
                ...state,
                completedModules: normalizedCompletedModules,
            }, { moduleId, requestNonce });
        });
        const moduleSteps = moduleId === 'catch-up' ? steps : (ONBOARDING_STEPS_BY_MODULE[moduleId] || []);
        const firstStepId = moduleSteps[0]?.id || '';
        if (firstStepId) {
            setSessionState({ sessionOpen: false, currentStepId: firstStepId });
        }
        onModuleRequestConsumed?.(requestNonce);
    }, [activeSurface, clearStepUnlock, moduleRequest, normalizedCompletedModules, onModuleRequestConsumed, run, steps]);

    React.useEffect(() => {
        const activeModule = moduleSession.activeModule;
        if (!shouldCloseOnboardingModuleForSurface({
            effectiveOpen,
            activeModule,
            activeSurface,
            moduleRequest,
        })) return;
        clearStepUnlock();
        setModuleSession((state) => closeOnboardingModuleSession(state));
        setSessionState((state) => ({ ...state, sessionOpen: false }));
        onModuleInterrupted?.(activeModule);
    }, [activeSurface, clearStepUnlock, effectiveOpen, moduleRequest, moduleSession.activeModule, onModuleInterrupted]);

    const goBack = React.useCallback(() => {
        if (!navigation.canGoBack) return;
        clearStepUnlock();
        setSessionState((state) => ({ ...state, currentStepId: activeSteps[navigation.index - 1].id }));
    }, [activeSteps, clearStepUnlock, navigation.canGoBack, navigation.index]);

    const goNext = React.useCallback(() => {
        if (!navigation.canGoNext || (currentStep?.progression === 'menu-preview' && !stepUnlocked)) return;
        clearStepUnlock();
        setSessionState((state) => ({ ...state, currentStepId: activeSteps[navigation.index + 1].id }));
    }, [activeSteps, clearStepUnlock, currentStep, navigation.canGoNext, navigation.index, stepUnlocked]);

    const goToStep = React.useCallback((stepId) => {
        if (!effectiveState.sessionOpen
            || !activeSteps.some((step) => step.id === stepId)
            || effectiveState.currentStepId === stepId) return;
        clearStepUnlock();
        setSessionState((state) => {
            if (!state.sessionOpen || !activeSteps.some((step) => step.id === stepId)) return state;
            return state.currentStepId === stepId ? state : { ...state, currentStepId: stepId };
        });
    }, [activeSteps, clearStepUnlock, effectiveState.currentStepId, effectiveState.sessionOpen]);

    const resetSession = React.useCallback(() => {
        consumedModuleRequestRef.current = 0;
        clearStepUnlock();
        setModuleSession(createOnboardingModuleSession(normalizedCompletedModules));
        setSessionState((state) => ({ ...state, sessionOpen: false }));
    }, [clearStepUnlock, normalizedCompletedModules]);

    const skip = React.useCallback(async () => {
        if (!navigation.isOpen) return false;
        const moduleId = moduleSession.activeModule;
        const settlement = await onSkip?.(moduleId);
        if (!shouldCloseOnboardingTourAfterSettlement(settlement)) return settlement !== false;
        resetSession();
        return true;
    }, [moduleSession.activeModule, navigation.isOpen, onSkip, resetSession]);

    const finish = React.useCallback(async () => {
        if (!navigation.isOpen || !navigation.isLast) return false;
        const moduleId = moduleSession.activeModule;
        const settlement = await onFinish?.(moduleId);
        if (!shouldCloseOnboardingTourAfterSettlement(settlement)) return settlement !== false;
        resetSession();
        return true;
    }, [moduleSession.activeModule, navigation.isLast, navigation.isOpen, onFinish, resetSession]);

    return {
        ...navigation,
        steps: activeSteps,
        currentStep,
        currentStepId: currentStep?.id || '',
        sessionId,
        stepUnlocked,
        moduleSession,
        suspended: false,
        goBack,
        goNext,
        resetSession,
        unlockStep,
        clearStepUnlock,
        goToStep,
        skip,
        finish,
    };
}
