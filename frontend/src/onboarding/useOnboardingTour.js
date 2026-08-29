import * as React from 'react';
import {
    deriveTourNavigationState,
    reconcileCurrentStepId,
    reconcileTourSessionState,
} from './onboardingSteps.js';
import { trackOnboardingAnalytics } from './onboardingAnalytics.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';

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
    const automaticStartedRef = React.useRef(false);
    const inFlightRef = React.useRef(false);
    const replayPendingRef = React.useRef(false);

    const open = React.useCallback((source) => {
        const normalizedSource = source === 'settings' ? 'settings' : 'first_run';
        prepareCatchUp?.();
        setError('');
        setSourceSurface(normalizedSource);
        setRun(true);
        trackOnboardingAnalytics(trackSettingsAction, 'started', normalizedSource);
    }, [prepareCatchUp, trackSettingsAction]);

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

    const skip = React.useCallback(() => persist(true, 'skipped'), [persist]);
    const finish = React.useCallback(() => persist(true, 'completed'), [persist]);
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

    return {
        run,
        sourceSurface,
        pending,
        error,
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
} = {}) {
    const [sessionState, setSessionState] = React.useState(() => ({
        sessionOpen: false,
        currentStepId: steps[0]?.id || '',
    }));
    const previousStepsRef = React.useRef(steps);
    const effectiveOpen = Boolean(run && !onboardingDone && steps.length);
    let effectiveState = reconcileTourSessionState(sessionState, { isOpen: effectiveOpen, steps });
    if (effectiveState.sessionOpen) {
        const reconciledStepId = reconcileCurrentStepId({
            previousSteps: previousStepsRef.current,
            nextSteps: steps,
            currentStepId: effectiveState.currentStepId,
        });
        if (reconciledStepId !== effectiveState.currentStepId) {
            effectiveState = { ...effectiveState, currentStepId: reconciledStepId };
        }
    }
    if (effectiveState !== sessionState) setSessionState(effectiveState);

    const resolvedStepId = effectiveState.currentStepId;
    const foundIndex = steps.findIndex((step) => step.id === resolvedStepId);
    const currentIndex = foundIndex < 0 ? 0 : foundIndex;
    const navigation = deriveTourNavigationState({
        run,
        onboardingDone,
        currentIndex,
        totalSteps: steps.length,
    });

    React.useLayoutEffect(() => {
        previousStepsRef.current = steps;
    }, [steps]);

    const goBack = React.useCallback(() => {
        if (!navigation.canGoBack) return;
        setSessionState((state) => ({ ...state, currentStepId: steps[navigation.index - 1].id }));
    }, [navigation.canGoBack, navigation.index, steps]);

    const goNext = React.useCallback(() => {
        if (!navigation.canGoNext) return;
        setSessionState((state) => ({ ...state, currentStepId: steps[navigation.index + 1].id }));
    }, [navigation.canGoNext, navigation.index, steps]);

    const skip = React.useCallback(() => {
        if (navigation.isOpen) onSkip?.();
    }, [navigation.isOpen, onSkip]);

    const finish = React.useCallback(() => {
        if (navigation.isOpen && navigation.isLast) onFinish?.();
    }, [navigation.isLast, navigation.isOpen, onFinish]);

    return {
        ...navigation,
        currentStep: steps[navigation.index] || null,
        currentStepId: steps[navigation.index]?.id || '',
        goBack,
        goNext,
        skip,
        finish,
    };
}
