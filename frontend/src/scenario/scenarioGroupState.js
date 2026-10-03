export const SCENARIO_GROUP_STATE_KEYS = Object.freeze([
    "scenarioData",
    "scenarioError",
    "scenarioLaneMode",
    "scenarioCollapsedLanes",
    "scenarioEpicFocus",
    "scenarioRangeOverride",
    "scenarioScrollTop",
    "scenarioScrollLeft",
    "scenarioViewportHeight",
    "scenarioHoverKey",
    "scenarioFlashKey",
    "scenarioLayout",
    "scenarioEdgeRender",
    "scenarioTooltip"
]);

export function buildDefaultScenarioGroupState(initialLaneMode) {
    return {
        scenarioData: null,
        scenarioError: '',
        scenarioLaneMode: initialLaneMode ?? 'team',
        scenarioCollapsedLanes: {},
        scenarioEpicFocus: null,
        scenarioRangeOverride: null,
        scenarioScrollTop: 0,
        scenarioScrollLeft: 0,
        scenarioViewportHeight: 0,
        scenarioHoverKey: null,
        scenarioFlashKey: null,
        scenarioLayout: { width: 0, height: 0 },
        scenarioEdgeRender: { width: 0, height: 0, paths: [] },
        scenarioTooltip: {
            visible: false,
            x: 0,
            y: 0,
            summary: '',
            key: '',
            sp: null,
            note: '',
            assignee: null,
            team: null
        }
    };
}

export function applyScenarioGroupState(setters, snapshot) {
    const nextState = snapshot || {};
    setters.setScenarioData(nextState.scenarioData || null);
    setters.setScenarioError(nextState.scenarioError || '');
    setters.setScenarioLaneMode(nextState.scenarioLaneMode || 'team');
    setters.setScenarioCollapsedLanes(nextState.scenarioCollapsedLanes || {});
    setters.setScenarioEpicFocus(nextState.scenarioEpicFocus || null);
    setters.setScenarioRangeOverride(nextState.scenarioRangeOverride || null);
    setters.setScenarioScrollTop(nextState.scenarioScrollTop || 0);
    setters.setScenarioScrollLeft(nextState.scenarioScrollLeft || 0);
    setters.setScenarioViewportHeight(nextState.scenarioViewportHeight || 0);
    setters.setScenarioHoverKey(nextState.scenarioHoverKey || null);
    setters.setScenarioFlashKey(nextState.scenarioFlashKey || null);
    setters.setScenarioLayout(nextState.scenarioLayout || { width: 0, height: 0 });
    setters.setScenarioEdgeRender(nextState.scenarioEdgeRender || { width: 0, height: 0, paths: [] });
    setters.setScenarioTooltip(nextState.scenarioTooltip || {
        visible: false,
        x: 0,
        y: 0,
        summary: '',
        key: '',
        sp: null,
        note: '',
        assignee: null,
        team: null
    });
    setters.setScenarioLoading(false);
}

export function resetScenarioTransientRefs(refs) {
    refs.scenarioIssueRefMap.current.clear();
    refs.scenarioEdgeUpdatePendingRef.current = false;
    refs.scenarioFocusRestoreRef.current = null;
    refs.scenarioSkipAutoCollapseRef.current = false;
    refs.scenarioTeamCollapseInitRef.current = false;
    if (refs.scenarioEdgeFrameRef.current) {
        window.cancelAnimationFrame(refs.scenarioEdgeFrameRef.current);
        refs.scenarioEdgeFrameRef.current = null;
    }
    if (refs.scenarioScrollFrameRef.current) {
        window.cancelAnimationFrame(refs.scenarioScrollFrameRef.current);
        refs.scenarioScrollFrameRef.current = null;
    }
    if (refs.scenarioResizeFrameRef.current) {
        window.cancelAnimationFrame(refs.scenarioResizeFrameRef.current);
        refs.scenarioResizeFrameRef.current = null;
    }
    refs.scenarioPendingScrollRef.current = null;
}
