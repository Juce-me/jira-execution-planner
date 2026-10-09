import * as React from 'react';
import { analyticsToken } from '../analytics/dashboardAnalytics.js';

// Pure precedence chain for the ENG mode SegmentedControl: scenario beats statistics beats
// planning beats board beats the catch-up default. Missing/undefined flags behave like false.
export function deriveActiveEngMode({ showScenario, showStats, showPlanning, showBoard } = {}) {
    if (showScenario) return 'scenario';
    if (showStats) return 'statistics';
    if (showPlanning) return 'planning';
    if (showBoard) return 'board';
    return 'catch-up';
}

// Owns the four mutual-exclusion effects between Planning/Stats/Scenario/Board and derives the
// active mode plus an applyEngMode setter usable as the SegmentedControl's onChange prop.
export function useEngModeState({
    showPlanning, setShowPlanning,
    showStats, setShowStats,
    showScenario, setShowScenario,
    showBoard, setShowBoard,
    trackSelectContent,
    onEnterCatchUp,
}) {
    React.useEffect(() => {
        if (showPlanning) {
            setShowStats(false);
            setShowScenario(false);
            setShowBoard(false);
        }
    }, [showPlanning]);

    React.useEffect(() => {
        if (showStats) {
            setShowPlanning(false);
            setShowScenario(false);
            setShowBoard(false);
        }
    }, [showStats]);

    React.useEffect(() => {
        if (showScenario) {
            setShowPlanning(false);
            setShowStats(false);
            setShowBoard(false);
        }
    }, [showScenario]);

    React.useEffect(() => {
        if (showBoard) {
            setShowPlanning(false);
            setShowStats(false);
            setShowScenario(false);
        }
    }, [showBoard]);

    const activeEngMode = deriveActiveEngMode({ showScenario, showStats, showPlanning, showBoard });

    const applyEngMode = React.useCallback((mode) => {
        const nextMode = String(mode || 'catch-up');
        trackSelectContent('eng_mode', nextMode, { from_mode: analyticsToken(activeEngMode), dashboard_view: 'eng' });
        // Same batch as the mode change, so the alert effect and readiness each load once when Catch Up opens.
        if (nextMode === 'catch-up') onEnterCatchUp?.();
        setShowPlanning(nextMode === 'planning');
        setShowStats(nextMode === 'statistics');
        setShowScenario(nextMode === 'scenario');
        setShowBoard(nextMode === 'board');
    }, [activeEngMode, trackSelectContent, onEnterCatchUp, setShowPlanning, setShowStats, setShowScenario, setShowBoard]);

    return { activeEngMode, applyEngMode };
}
