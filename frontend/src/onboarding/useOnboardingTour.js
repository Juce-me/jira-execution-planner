import * as React from 'react';
import {
    deriveTourNavigationState,
    reconcileCurrentStepId,
    reconcileTourSessionState,
} from './onboardingSteps.js';
import { trackOnboardingAnalytics } from './onboardingAnalytics.js';
import { AUTH_REQUIRED_EVENT, isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    acknowledgeUnavailableOnboardingModule,
    activateOnboardingModule,
    allRequiredOnboardingModulesComplete,
    completeOnboardingModule,
    createOnboardingModuleSession,
    resumeOnboardingAfterSurfaceExit,
} from './onboardingModules.js';
import { ONBOARDING_STEPS_BY_MODULE } from './onboardingSteps.js';

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
    onboardingDone = true,
    setOnboardingDone,
    savePreference,
    prepareCatchUp,
    closeSettings,
    trackSettingsAction,
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

    const resetModuleRequests = React.useCallback(() => {
        moduleRequestNonceRef.current = 0;
        setModuleRequest(null);
    }, []);

    const open = React.useCallback((source) => {
        const normalizedSource = source === 'settings' ? 'settings' : 'first_run';
        resetModuleRequests();
        prepareCatchUp?.();
        setError('');
        setSourceSurface(normalizedSource);
        setRun(true);
        trackOnboardingAnalytics(trackSettingsAction, 'started', normalizedSource);
    }, [prepareCatchUp, resetModuleRequests, trackSettingsAction]);

    React.useEffect(() => {
        if (!bootstrapReady || onboardingDone !== false || run || automaticStartedRef.current || replayPendingRef.current) return;
        automaticStartedRef.current = true;
        open('first_run');
    }, [bootstrapReady, onboardingDone, open, run]);

    React.useEffect(() => {
        if (onboardingDone !== false) automaticStartedRef.current = false;
    }, [onboardingDone]);

    const persist = React.useCallback(async (nextDone, outcome) => {
        if (inFlightRef.current || typeof savePreference !== 'function') return false;
        inFlightRef.current = true;
        setPending(true);
        setError('');
        try {
            const payload = await savePreference(nextDone);
            if (payload?.onboardingDone !== nextDone) {
                throw new Error('Saved onboarding preference could not be verified. Please retry.');
            }
            setOnboardingDone?.(nextDone);
            if (nextDone) {
                setRun(false);
                trackOnboardingAnalytics(trackSettingsAction, outcome, sourceSurface);
            }
            return true;
        } catch (saveError) {
            if (isAuthenticationRequiredError(saveError)) return false;
            setError(saveError?.message || 'Failed to save onboarding preference. Please retry.');
            return false;
        } finally {
            inFlightRef.current = false;
            setPending(false);
        }
    }, [savePreference, setOnboardingDone, sourceSurface, trackSettingsAction]);

    const skip = React.useCallback(() => {
        resetModuleRequests();
        return persist(true, 'skipped');
    }, [persist, resetModuleRequests]);
    const finish = React.useCallback(() => {
        resetModuleRequests();
        return persist(true, 'completed');
    }, [persist, resetModuleRequests]);
    const replay = React.useCallback(async () => {
        replayPendingRef.current = true;
        const saved = await persist(false, '');
        if (!saved) {
            replayPendingRef.current = false;
            return false;
        }
        closeSettings?.();
        open('settings');
        replayPendingRef.current = false;
        return true;
    }, [closeSettings, open, persist]);

    const requestModule = React.useCallback((moduleId) => {
        if (!run) return false;
        const requestNonce = moduleRequestNonceRef.current + 1;
        moduleRequestNonceRef.current = requestNonce;
        setModuleRequest({ moduleId: String(moduleId || ''), requestNonce });
        return true;
    }, [run]);

    const clearModuleRequest = React.useCallback((requestNonce) => {
        setModuleRequest((current) => (
            current?.requestNonce === requestNonce ? null : current
        ));
    }, []);

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
        skip,
        finish,
        replay,
    };
}

export default function useOnboardingTour({
    steps = [],
    run = false,
    onboardingDone = true,
    onSkip,
    onFinish,
    activeSurface = 'catch-up',
    moduleRequest = null,
    onModuleRequestConsumed,
} = {}) {
    const [sessionState, setSessionState] = React.useState(() => ({
        sessionOpen: false,
        currentStepId: steps[0]?.id || '',
    }));
    const previousStepsRef = React.useRef(steps);
    const [moduleSession, setModuleSession] = React.useState(createOnboardingModuleSession);
    const consumedModuleRequestRef = React.useRef(0);
    const sessionCounterRef = React.useRef(0);
    const sessionOpenRef = React.useRef(false);
    const [unlockedStepKey, setUnlockedStepKey] = React.useState(null);
    const activeSteps = moduleSession.activeModule === 'catch-up'
        ? steps
        : (ONBOARDING_STEPS_BY_MODULE[moduleSession.activeModule] || []);
    const effectiveOpen = Boolean(run && !onboardingDone && steps.length);
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
        onboardingDone,
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
        if (effectiveOpen) return;
        consumedModuleRequestRef.current = 0;
        clearStepUnlock();
        setModuleSession(createOnboardingModuleSession());
    }, [clearStepUnlock, effectiveOpen]);

    React.useEffect(() => {
        const requestNonce = Number(moduleRequest?.requestNonce) || 0;
        const moduleId = String(moduleRequest?.moduleId || '');
        const expectedSurface = moduleId === 'configuration' ? 'settings' : moduleId;
        if (!effectiveOpen
            || !requestNonce
            || requestNonce <= consumedModuleRequestRef.current
            || activeSurface !== expectedSurface) return;

        consumedModuleRequestRef.current = requestNonce;
        clearStepUnlock();
        const currentCatchUpStep = steps.find((step) => step.id === effectiveState.currentStepId);
        const currentIndex = steps.indexOf(currentCatchUpStep);
        const resumeStepId = currentIndex >= 0 ? (steps[currentIndex + 1]?.id || 'complete') : 'complete';
        setModuleSession((state) => {
            return activateOnboardingModule(state, { moduleId, requestNonce, resumeStepId });
        });
        if (!moduleSession.completedModules.includes(moduleId)) {
            const contextualStepId = ONBOARDING_STEPS_BY_MODULE[moduleId]?.[0]?.id || '';
            if (contextualStepId) {
                setSessionState((state) => ({ ...state, currentStepId: contextualStepId }));
            }
        }
        onModuleRequestConsumed?.(requestNonce);
    }, [activeSurface, clearStepUnlock, effectiveOpen, effectiveState.currentStepId, moduleRequest, moduleSession.completedModules, onModuleRequestConsumed, steps]);

    React.useEffect(() => {
        if (!effectiveOpen || moduleSession.activeModule !== 'configuration') return;
        if (activeSurface === 'settings') return;
        clearStepUnlock();
        setModuleSession((state) => ({
            ...state,
            activeModule: 'catch-up',
            resumeStepId: '',
            suspendedSurface: '',
        }));
        setSessionState((state) => ({ ...state, currentStepId: 'launch-configuration' }));
    }, [activeSurface, clearStepUnlock, effectiveOpen, moduleSession.activeModule]);

    React.useEffect(() => {
        if (!moduleSession.suspendedSurface) return;
        const resumed = resumeOnboardingAfterSurfaceExit(moduleSession, activeSurface);
        if (resumed !== moduleSession) setModuleSession(resumed);
    }, [activeSurface, moduleSession]);

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

    const acknowledgeUnavailableModule = React.useCallback(() => {
        const step = activeSteps[navigation.index];
        if (step?.progression !== 'module-launch' || !step.moduleId) return;
        setModuleSession((state) => acknowledgeUnavailableOnboardingModule(state, step.moduleId));
        goNext();
    }, [activeSteps, goNext, navigation.index]);

    const completeCurrentModule = React.useCallback(() => {
        const moduleId = moduleSession.activeModule;
        if (moduleId === 'catch-up') return;
        const resumeStepId = moduleSession.resumeStepId || 'complete';
        clearStepUnlock();
        setModuleSession((state) => completeOnboardingModule(state, {
            moduleId,
            surface: activeSurface,
        }));
        setSessionState((state) => ({ ...state, currentStepId: resumeStepId }));
    }, [activeSurface, clearStepUnlock, moduleSession.activeModule, moduleSession.resumeStepId]);

    const resetSession = React.useCallback(() => {
        consumedModuleRequestRef.current = 0;
        clearStepUnlock();
        setModuleSession(createOnboardingModuleSession());
    }, [clearStepUnlock]);

    const skip = React.useCallback(() => {
        if (navigation.isOpen) {
            resetSession();
            onSkip?.();
        }
    }, [navigation.isOpen, onSkip, resetSession]);

    const finish = React.useCallback(() => {
        if (navigation.isOpen && navigation.isLast && allRequiredOnboardingModulesComplete(moduleSession)) {
            resetSession();
            onFinish?.();
        }
    }, [moduleSession, navigation.isLast, navigation.isOpen, onFinish, resetSession]);

    return {
        ...navigation,
        steps: activeSteps,
        currentStep,
        currentStepId: currentStep?.id || '',
        sessionId,
        stepUnlocked,
        moduleSession,
        suspended: Boolean(moduleSession.suspendedSurface),
        allRequiredModulesComplete: allRequiredOnboardingModulesComplete(moduleSession),
        goBack,
        goNext,
        acknowledgeUnavailableModule,
        completeCurrentModule,
        resetSession,
        unlockStep,
        clearStepUnlock,
        goToStep,
        skip,
        finish,
    };
}
