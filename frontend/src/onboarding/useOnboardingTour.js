import * as React from 'react';
import {
    deriveTourNavigationState,
    reconcileCurrentStepId,
} from './onboardingSteps.js';

export default function useOnboardingTour({
    steps = [],
    run = false,
    onboardingDone = true,
    onSkip,
    onFinish,
} = {}) {
    const [currentStepId, setCurrentStepId] = React.useState(() => steps[0]?.id || '');
    const previousStepsRef = React.useRef(steps);
    const previousRunRef = React.useRef(false);

    const resolvedStepId = reconcileCurrentStepId({
        previousSteps: previousStepsRef.current,
        nextSteps: steps,
        currentStepId,
    });
    const foundIndex = steps.findIndex((step) => step.id === resolvedStepId);
    const currentIndex = foundIndex < 0 ? 0 : foundIndex;
    const navigation = deriveTourNavigationState({
        run,
        onboardingDone,
        currentIndex,
        totalSteps: steps.length,
    });

    React.useEffect(() => {
        const runStarted = run && !previousRunRef.current;
        previousRunRef.current = run;
        if (runStarted) {
            setCurrentStepId(steps[0]?.id || '');
        } else if (resolvedStepId !== currentStepId) {
            setCurrentStepId(resolvedStepId);
        }
        previousStepsRef.current = steps;
    }, [currentStepId, resolvedStepId, run, steps]);

    const goBack = React.useCallback(() => {
        if (!navigation.canGoBack) return;
        setCurrentStepId(steps[navigation.index - 1].id);
    }, [navigation.canGoBack, navigation.index, steps]);

    const goNext = React.useCallback(() => {
        if (!navigation.canGoNext) return;
        setCurrentStepId(steps[navigation.index + 1].id);
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
