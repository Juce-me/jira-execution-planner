import { useState, useRef, useMemo } from 'react';
import { createUndoStack } from './scenarioUtils.js';

export function useScenarioState({ initialLaneMode }) {
    const [scenarioCurrentUserIdentity, setScenarioCurrentUserIdentity] = useState({
        userId: '',
        displayName: ''
    });
    const [scenarioLoading, setScenarioLoading] = useState(false);
    const [scenarioError, setScenarioError] = useState('');
    const [scenarioData, setScenarioData] = useState(null);
    const [scenarioLaneMode, setScenarioLaneMode] = useState(initialLaneMode);
    const [scenarioShowConflictsOnly, setScenarioShowConflictsOnly] = useState(false);
    const scenarioTimelineRef = useRef(null);
    const [scenarioLayout, setScenarioLayout] = useState({ width: 0, height: 0 });
    const [scenarioCollapsedLanes, setScenarioCollapsedLanes] = useState({});
    const [scenarioCollapsedCards, setScenarioCollapsedCards] = useState({});
    const [scenarioSummaryHidden, setScenarioSummaryHidden] = useState(true);
    const [scenarioHoverKey, setScenarioHoverKey] = useState(null);
    const [scenarioFlashKey, setScenarioFlashKey] = useState(null);
    const [scenarioScrollTop, setScenarioScrollTop] = useState(0);
    const [scenarioScrollLeft, setScenarioScrollLeft] = useState(0);
    const [scenarioViewportHeight, setScenarioViewportHeight] = useState(0);
    const [scenarioEpicFocus, setScenarioEpicFocus] = useState(null);
    const [scenarioRangeOverride, setScenarioRangeOverride] = useState(null);
    const scenarioFocusRestoreRef = useRef(null);
    const scenarioSkipAutoCollapseRef = useRef(false);
    const scenarioTeamCollapseInitRef = useRef(false);
    const scenarioHistoryButtonRef = useRef(null);
    const scenarioHistoryPanelRef = useRef(null);
    const scenarioHistoryTitleRef = useRef(null);
    const [scenarioOverrides, setScenarioOverrides] = useState({});
    const scenarioActiveDraftIdRef = useRef('');
    const scenarioScopeKeyRef = useRef('');
    const [scenarioDraftMeta, setScenarioDraftMeta] = useState({
        activeDraft: null,
        versions: [],
        loadedVersionNumber: null,
        baseDraftRevision: null,
        savedOverrides: {},
        scopePayload: {},
        scopeKey: '',
        dirtyState: 'clean',
        pendingScopeChange: null,
        historyOpen: false,
        loadingHistory: false,
        loadingVersionNumber: null,
        loadingActiveDraft: false,
        saving: false,
        rollingBackVersionNumber: null,
        reloadingFromJira: false,
        pendingHistoryAction: null,
        pendingActiveDraftReload: false,
        pendingReloadFromJira: false,
        writebackPreviewing: false,
        writebackChecking: false,
        writebackPreview: null,
        writebackBlocked: null,
        staleDraft: null,
        conflict: null,
        message: '',
        error: ''
    });
    const [scenarioDraftEvents, setScenarioDraftEvents] = useState([]);
    const [scenarioDraftPresence, setScenarioDraftPresence] = useState([]);
    const [scenarioDraftLocks, setScenarioDraftLocks] = useState([]);
    const [scenarioDraftRealtimeStatus, setScenarioDraftRealtimeStatus] = useState({
        mode: 'idle',
        paused: false,
        message: ''
    });
    const [scenarioDraftLastEventNumber, setScenarioDraftLastEventNumber] = useState(0);
    const [scenarioEditMode, setScenarioEditMode] = useState(false);
    const scenarioUndoStackRef = useRef(createUndoStack());
    const [scenarioUndoVersion, setScenarioUndoVersion] = useState(0);
    const [scenarioDragState, setScenarioDragState] = useState(null);
    const scenarioDragStateRef = useRef(null);
    const scenarioDragFrameRef = useRef(null);
    const scenarioDragLockRefreshRef = useRef(null);
    const scenarioRealtimeCsrfRef = useRef('');
    const scenarioHistoryRefreshControllerRef = useRef(null);
    const scenarioHistoryActionControllerRef = useRef(null);
    const scenarioViewRangeRef = useRef({ start: null, end: null });
    const scenarioWasDraggedRef = useRef(false);
    const scenarioEdgeUpdatePendingRef = useRef(false);
    const scenarioEdgeFrameRef = useRef(null);
    const scenarioScrollFrameRef = useRef(null);
    const scenarioResizeFrameRef = useRef(null);
    const scenarioPendingScrollRef = useRef(null);
    const [scenarioTooltip, setScenarioTooltip] = useState({
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
    const scenarioTooltipRef = useRef(null);
    const scenarioTooltipAnchorRef = useRef(null);
    const scenarioIssueRefMap = useRef(new Map());
    const [scenarioEdgeRender, setScenarioEdgeRender] = useState({ width: 0, height: 0, paths: [] });
    const scenarioRefreshNonceRef = useRef(0);
    const scenarioGroupValues = useMemo(() => ({
        scenarioData,
        scenarioError,
        scenarioLaneMode,
        scenarioCollapsedLanes,
        scenarioEpicFocus,
        scenarioRangeOverride,
        scenarioScrollTop,
        scenarioScrollLeft,
        scenarioViewportHeight,
        scenarioHoverKey,
        scenarioFlashKey,
        scenarioLayout,
        scenarioEdgeRender,
        scenarioTooltip,
    }), [scenarioData, scenarioError, scenarioLaneMode, scenarioCollapsedLanes, scenarioEpicFocus, scenarioRangeOverride, scenarioScrollTop, scenarioScrollLeft, scenarioViewportHeight, scenarioHoverKey, scenarioFlashKey, scenarioLayout, scenarioEdgeRender, scenarioTooltip]);
    return {
        scenarioCurrentUserIdentity,
        setScenarioCurrentUserIdentity,
        scenarioLoading,
        setScenarioLoading,
        scenarioError,
        setScenarioError,
        scenarioData,
        setScenarioData,
        scenarioLaneMode,
        setScenarioLaneMode,
        scenarioShowConflictsOnly,
        setScenarioShowConflictsOnly,
        scenarioTimelineRef,
        scenarioLayout,
        setScenarioLayout,
        scenarioCollapsedLanes,
        setScenarioCollapsedLanes,
        scenarioCollapsedCards,
        setScenarioCollapsedCards,
        scenarioSummaryHidden,
        setScenarioSummaryHidden,
        scenarioHoverKey,
        setScenarioHoverKey,
        scenarioFlashKey,
        setScenarioFlashKey,
        scenarioScrollTop,
        setScenarioScrollTop,
        scenarioScrollLeft,
        setScenarioScrollLeft,
        scenarioViewportHeight,
        setScenarioViewportHeight,
        scenarioEpicFocus,
        setScenarioEpicFocus,
        scenarioRangeOverride,
        setScenarioRangeOverride,
        scenarioFocusRestoreRef,
        scenarioSkipAutoCollapseRef,
        scenarioTeamCollapseInitRef,
        scenarioHistoryButtonRef,
        scenarioHistoryPanelRef,
        scenarioHistoryTitleRef,
        scenarioOverrides,
        setScenarioOverrides,
        scenarioActiveDraftIdRef,
        scenarioScopeKeyRef,
        scenarioDraftMeta,
        setScenarioDraftMeta,
        scenarioDraftEvents,
        setScenarioDraftEvents,
        scenarioDraftPresence,
        setScenarioDraftPresence,
        scenarioDraftLocks,
        setScenarioDraftLocks,
        scenarioDraftRealtimeStatus,
        setScenarioDraftRealtimeStatus,
        scenarioDraftLastEventNumber,
        setScenarioDraftLastEventNumber,
        scenarioEditMode,
        setScenarioEditMode,
        scenarioUndoStackRef,
        scenarioUndoVersion,
        setScenarioUndoVersion,
        scenarioDragState,
        setScenarioDragState,
        scenarioDragStateRef,
        scenarioDragFrameRef,
        scenarioDragLockRefreshRef,
        scenarioRealtimeCsrfRef,
        scenarioHistoryRefreshControllerRef,
        scenarioHistoryActionControllerRef,
        scenarioViewRangeRef,
        scenarioWasDraggedRef,
        scenarioEdgeUpdatePendingRef,
        scenarioEdgeFrameRef,
        scenarioScrollFrameRef,
        scenarioResizeFrameRef,
        scenarioPendingScrollRef,
        scenarioTooltip,
        setScenarioTooltip,
        scenarioTooltipRef,
        scenarioTooltipAnchorRef,
        scenarioIssueRefMap,
        scenarioEdgeRender,
        setScenarioEdgeRender,
        scenarioRefreshNonceRef,
        scenarioGroupValues,
    };
}
