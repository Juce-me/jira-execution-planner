import * as React from 'react';
import { parseScenarioDate, normalizeScenarioSummary, SCENARIO_BAR_GAP } from './scenarioUtils.js';
import { buildLaneIssues } from './scenarioLaneUtils.js';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';
import { collectJiraExportKeysFromScenarioIssues } from '../jiraExportUtils.mjs';
import { useEffect } from 'react';
import { buildScenarioLaneInfo, buildScenarioLateItems, buildScenarioCriticalPathItems, buildScenarioUnschedulableItems, buildScenarioTicks, buildScenarioQuarterMarkers, buildScenarioLaneStacking, buildScenarioVisibleExportIssues, buildScenarioLaneMeta, buildScenarioLaneAssigneeGroups, buildScenarioPositions, buildScenarioEdgeCandidates, buildScenarioEdgeIndex, buildScenarioEpicBars, buildScenarioEpicEdges, buildScenarioVisibleLanes, buildScenarioActiveEdges, buildScenarioUpstreamSet, buildScenarioDownstreamSet, buildScenarioBlockedSet, buildScenarioFocusEdges } from './scenarioLayout.js';

export function useScenarioLayout({
    scenarioState,
    perfEnabled,
    perfCountersRef,
    showScenario,
    normalizeEpicKey,
    isAllTeamsSelected,
    excludedEpicSet,
    scenarioSummary,
    scenarioDependencies,
    scenarioCapacityByTeam,
    scenarioIssues,
    scenarioSearchQuery,
    scenarioSearchMatchSet,
    scenarioExcludedIssueKeys,
    scenarioFocusSet,
    scenarioContextSet,
    scenarioIssueByKey,
    scenarioDeadline,
    scenarioViewStart,
    scenarioViewEnd,
    scenarioFocusIssueKeys,
    scenarioFocusContextKeys,
    scenarioTimelineIssues,
    scenarioTimelineWithSegments,
    scenarioTimelineIssueKeys,
    scenarioAssigneeConflicts,
}) {
    const {
        scenarioData,
        scenarioLaneMode,
        setScenarioLaneMode,
        scenarioShowConflictsOnly,
        scenarioTimelineRef,
        scenarioLayout,
        setScenarioLayout,
        scenarioCollapsedLanes,
        setScenarioCollapsedLanes,
        scenarioHoverKey,
        setScenarioFlashKey,
        scenarioScrollTop,
        setScenarioScrollTop,
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
        scenarioEdgeUpdatePendingRef,
        scenarioEdgeFrameRef,
        scenarioScrollFrameRef,
        scenarioResizeFrameRef,
        scenarioPendingScrollRef,
        setScenarioTooltip,
        scenarioTooltipRef,
        scenarioTooltipAnchorRef,
        scenarioIssueRefMap,
        setScenarioEdgeRender,
    } = scenarioState;
    let scheduleScenarioEdgeUpdate;

    const registerScenarioIssueRef = (issueKey) => (node) => {
        const map = scenarioIssueRefMap.current;
        if (node) {
            map.set(issueKey, node);
        } else {
            map.delete(issueKey);
        }
    };

    const scenarioLaneForIssue = (issue) => {
        if (scenarioEpicFocus?.key) {
            return scenarioEpicFocus.key;
        }
        if (scenarioLaneMode === 'epic') {
            return issue.epicKey || 'No Epic';
        }
        if (scenarioLaneMode === 'assignee') {
            return issue.assignee || 'Unassigned';
        }
        return issue.team || 'Unassigned';
    };
    const scenarioLaneInfo = React.useMemo(
        () => buildScenarioLaneInfo({ scenarioTimelineIssues, scenarioLaneMode, scenarioCapacityByTeam, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioExcludedIssueKeys, scenarioAssigneeConflicts, scenarioLaneForIssue }),
        [scenarioTimelineIssues, scenarioLaneMode, scenarioCapacityByTeam, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioExcludedIssueKeys, scenarioAssigneeConflicts]
    );
    const scenarioSearchFilterEnabled = Boolean(scenarioSearchQuery && !scenarioEpicFocus);
    const scenarioLateItems = React.useMemo(
        () => buildScenarioLateItems({ scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet }),
        [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]
    );
    const scenarioDeadlineAtRisk = scenarioLateItems.length > 0;
    const scenarioCriticalPathItems = React.useMemo(
        () => buildScenarioCriticalPathItems({ scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet }),
        [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]
    );
    const scenarioUnschedulableItems = React.useMemo(
        () => buildScenarioUnschedulableItems({ scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet }),
        [scenarioSummary, scenarioExcludedIssueKeys, scenarioSearchFilterEnabled, scenarioSearchMatchSet]
    );
    const scenarioLanes = React.useMemo(() => {
        const lanes = Array.from(scenarioLaneInfo.keys());
        return lanes.sort((a, b) => a.localeCompare(b));
    }, [scenarioLaneInfo]);
    const scenarioIssuesByLane = React.useMemo(() => {
        return buildLaneIssues(scenarioTimelineWithSegments, scenarioLaneMode, scenarioLaneForIssue);
    }, [scenarioTimelineWithSegments, scenarioLaneMode, scenarioEpicFocus]);
    const scenarioTicks = React.useMemo(() => buildScenarioTicks({ scenarioViewStart, scenarioViewEnd }), [scenarioViewStart, scenarioViewEnd]);
    const scenarioQuarterMarkers = React.useMemo(
        () => buildScenarioQuarterMarkers({ scenarioViewStart, scenarioViewEnd, scenarioDeadline }),
        [scenarioViewStart, scenarioViewEnd, scenarioDeadline]
    );
    const SCENARIO_LANE_HEIGHT = 52;
    const scenarioBarGap = scenarioEpicFocus ? 16 : SCENARIO_BAR_GAP;
    const scenarioLaneStacking = React.useMemo(() => {
        // Early return if no lanes to process
        if (!scenarioLanes || scenarioLanes.length === 0) {
            return {
                rowIndexByKey: new Map(),
                laneRowCounts: new Map(),
                laneVisibleRows: new Map(),
                laneHiddenCounts: new Map(),
                laneRowAssignees: new Map()
            };
        }

        if (perfEnabled) {
            perfCountersRef.current.laneStacking += 1;
            performance.mark('scenarioLaneStacking:start');
        }
        const scenarioLaneStackingResult = buildScenarioLaneStacking({ scenarioLanes, scenarioIssuesByLane, scenarioViewStart, scenarioCollapsedLanes, scenarioLaneMode, scenarioCapacityByTeam, scenarioExcludedIssueKeys, scenarioEpicFocus, excludedEpicSet, normalizeEpicKey });
        if (perfEnabled) {
            performance.mark('scenarioLaneStacking:end');
            performance.measure(
                'scenarioLaneStacking',
                'scenarioLaneStacking:start',
                'scenarioLaneStacking:end'
            );
            performance.clearMarks('scenarioLaneStacking:start');
            performance.clearMarks('scenarioLaneStacking:end');
            performance.clearMeasures('scenarioLaneStacking');
        }
        return scenarioLaneStackingResult;
    }, [
        scenarioLanes,
        scenarioIssuesByLane,
        scenarioViewStart,
        scenarioCollapsedLanes,
        scenarioLaneMode,
        scenarioCapacityByTeam,
        scenarioExcludedIssueKeys,
        isAllTeamsSelected,
        scenarioEpicFocus,
        perfEnabled
    ]);
    const scenarioVisibleExportIssues = React.useMemo(
        () => buildScenarioVisibleExportIssues({ scenarioTimelineWithSegments, scenarioShowConflictsOnly, scenarioAssigneeConflicts, scenarioLaneStacking, scenarioLaneForIssue }),
        [
        scenarioTimelineWithSegments,
        scenarioShowConflictsOnly,
        scenarioAssigneeConflicts,
        scenarioLaneStacking,
        scenarioLaneMode,
        scenarioEpicFocus
    ]
    );
    const scenarioJiraEpicKeys = React.useMemo(
        () => collectJiraExportKeysFromScenarioIssues(scenarioVisibleExportIssues, 'epics'),
        [scenarioVisibleExportIssues]
    );
    const scenarioJiraStoryKeys = React.useMemo(
        () => collectJiraExportKeysFromScenarioIssues(scenarioVisibleExportIssues, 'stories'),
        [scenarioVisibleExportIssues]
    );
    const scenarioLaneMeta = React.useMemo(
        () => buildScenarioLaneMeta({ scenarioLanes, scenarioLaneStacking, scenarioCollapsedLanes, scenarioEpicFocus, scenarioBarGap }),
        [scenarioLanes, scenarioLaneStacking, scenarioCollapsedLanes, scenarioEpicFocus, scenarioBarGap]
    );
    const scenarioLaneAssigneeGroups = React.useMemo(
        () => buildScenarioLaneAssigneeGroups({ scenarioLaneMode, scenarioLanes, scenarioLaneStacking }),
        [scenarioLaneMode, scenarioLanes, scenarioLaneStacking]
    );
    const areScenarioCollapsedLanesEqual = (a, b) => {
        if (a === b) return true;
        const aKeys = Object.keys(a || {});
        const bKeys = Object.keys(b || {});
        if (aKeys.length !== bKeys.length) return false;
        for (let i = 0; i < aKeys.length; i += 1) {
            const key = aKeys[i];
            if (a[key] !== b[key]) return false;
        }
        return true;
    };

    useEffect(() => {
        if (!showScenario) return;
        if (!scenarioIssues.length && !scenarioLanes.length) return;
        if (scenarioSkipAutoCollapseRef.current) {
            scenarioSkipAutoCollapseRef.current = false;
            return;
        }
        if (scenarioLaneMode === 'team' && isAllTeamsSelected) {
            if (!scenarioTeamCollapseInitRef.current) {
                const next = {};
                scenarioLanes.forEach(lane => {
                    next[lane] = true;
                });
                setScenarioCollapsedLanes(prev => (areScenarioCollapsedLanesEqual(prev, next) ? prev : next));
                scenarioTeamCollapseInitRef.current = true;
            }
            return;
        }
        scenarioTeamCollapseInitRef.current = false;
        if (scenarioLaneMode !== 'epic') {
            setScenarioCollapsedLanes(prev => (Object.keys(prev || {}).length ? {} : prev));
            return;
        }
        const next = {};
        scenarioLanes.forEach(lane => {
            next[lane] = true;
        });
        scenarioIssues.forEach(issue => {
            if (scenarioFocusSet.size === 0 || scenarioFocusSet.has(issue.key) || scenarioContextSet.has(issue.key)) {
                next[scenarioLaneForIssue(issue)] = false;
            }
        });
        setScenarioCollapsedLanes(prev => (areScenarioCollapsedLanesEqual(prev, next) ? prev : next));
    }, [
        showScenario,
        scenarioLaneMode,
        scenarioLanes,
        scenarioIssues,
        scenarioFocusSet,
        scenarioContextSet,
        isAllTeamsSelected
    ]);

    useEffect(() => {
        scenarioTeamCollapseInitRef.current = false;
    }, [scenarioData]);

    useEffect(() => {
        if (!showScenario || !scenarioTimelineRef.current) return;
        const container = scenarioTimelineRef.current;
        const readLayout = () => {
            if (perfEnabled) {
                perfCountersRef.current.layoutReads += 1;
            }
            const track = container.querySelector('.scenario-lane-track');
            const containerStyles = window.getComputedStyle(container);
            const labelWidthValue = parseFloat(containerStyles.getPropertyValue('--scenario-label-width')) || 190;
            const laneEl = container.querySelector('.scenario-lane');
            let gapValue = 0;
            if (laneEl) {
                const laneStyles = window.getComputedStyle(laneEl);
                gapValue = parseFloat(laneStyles.columnGap || laneStyles.gap || '0') || 0;
            }
            const labelWidth = labelWidthValue + gapValue;
            const trackWidth = track ? track.clientWidth : Math.max(0, container.clientWidth - labelWidth);
            let height = scenarioLaneMeta.totalHeight || scenarioLanes.length * SCENARIO_LANE_HEIGHT;
            setScenarioLayout(prev => {
                if (prev.width === trackWidth && prev.height === height && prev.labelWidth === labelWidth) {
                    return prev;
                }
                return {
                    width: trackWidth,
                    height,
                    labelWidth
                };
            });
            scheduleScenarioEdgeUpdate();
        };
        const readScroll = () => {
            if (perfEnabled) {
                perfCountersRef.current.scrollReads += 1;
            }
            const nextTop = container.scrollTop || 0;
            const nextLeft = container.scrollLeft || 0;
            const nextHeight = container.clientHeight || 0;
            setScenarioScrollTop(prev => (prev === nextTop ? prev : nextTop));
            setScenarioScrollLeft(prev => (prev === nextLeft ? prev : nextLeft));
            setScenarioViewportHeight(prev => (prev === nextHeight ? prev : nextHeight));
            scheduleScenarioEdgeUpdate();
        };
        const scheduleLayout = () => {
            if (scenarioResizeFrameRef.current) return;
            scenarioResizeFrameRef.current = window.requestAnimationFrame(() => {
                scenarioResizeFrameRef.current = null;
                if (!scenarioTimelineRef.current) return;
                readLayout();
            });
        };
        const scheduleScroll = () => {
            if (scenarioScrollFrameRef.current) return;
            scenarioScrollFrameRef.current = window.requestAnimationFrame(() => {
                scenarioScrollFrameRef.current = null;
                if (!scenarioTimelineRef.current) return;
                readScroll();
            });
        };
        scheduleLayout();
        scheduleScroll();
        container.addEventListener('scroll', scheduleScroll, { passive: true });
        window.addEventListener('resize', scheduleLayout);
        window.addEventListener('resize', scheduleScroll);
        return () => {
            container.removeEventListener('scroll', scheduleScroll);
            window.removeEventListener('resize', scheduleLayout);
            window.removeEventListener('resize', scheduleScroll);
            if (scenarioScrollFrameRef.current) {
                window.cancelAnimationFrame(scenarioScrollFrameRef.current);
                scenarioScrollFrameRef.current = null;
            }
            if (scenarioResizeFrameRef.current) {
                window.cancelAnimationFrame(scenarioResizeFrameRef.current);
                scenarioResizeFrameRef.current = null;
            }
        };
    }, [showScenario, scenarioLanes.length, scenarioData, scenarioLaneMode, scenarioIssuesByLane, scenarioLaneMeta, scheduleScenarioEdgeUpdate, perfEnabled]);

    const scenarioPositions = React.useMemo(() => {
        if (!scenarioViewStart || !scenarioViewEnd) return {};
        if (!scenarioLayout.width) return {};
        // Debug: Log Accepted tasks positioning to diagnose left-of-TODAY bug
        if (process.env.NODE_ENV === 'development') {
            const acceptedTasks = scenarioTimelineIssues.filter(i => i.status === 'Accepted');
            if (acceptedTasks.length > 0) {
                console.debug('[Scenario] Accepted tasks:', acceptedTasks.map(i => ({
                    key: i.key,
                    start: i.start,
                    end: i.end,
                    scheduledReason: i.scheduledReason
                })));
                console.debug('[Scenario] View range:', {
                    start: scenarioViewStart,
                    end: scenarioViewEnd,
                    today: new Date()
                });
            }
        }

        return buildScenarioPositions({ scenarioTimelineWithSegments, scenarioViewStart, scenarioViewEnd, scenarioLayout, scenarioLaneMeta, scenarioBarGap, scenarioLaneStacking, scenarioLaneForIssue });
    }, [
        scenarioTimelineWithSegments,
        scenarioViewStart,
        scenarioViewEnd,
        scenarioLayout,
        scenarioLanes,
        scenarioLaneMeta,
        scenarioBarGap,
        scenarioLaneStacking
    ]);

    const scenarioEdgeCandidates = React.useMemo(
        () => buildScenarioEdgeCandidates({ scenarioDependencies, scenarioTimelineIssueKeys }),
        [scenarioDependencies, scenarioTimelineIssueKeys]
    );

    const scenarioEdgeIndex = React.useMemo(() => buildScenarioEdgeIndex({ scenarioEdgeCandidates }), [scenarioEdgeCandidates]);

    const scenarioEpicBars = React.useMemo(
        () => buildScenarioEpicBars({ scenarioIssuesByLane, scenarioLanes, scenarioLaneMode, scenarioViewStart, scenarioViewEnd, scenarioLayout, scenarioLaneMeta, scenarioIssueByKey, scenarioEpicFocus, excludedEpicSet, SCENARIO_LANE_HEIGHT, normalizeEpicKey }),
        [scenarioIssuesByLane, scenarioLanes, scenarioLaneMode, scenarioViewStart, scenarioViewEnd, scenarioLayout, scenarioLaneMeta, scenarioIssueByKey, scenarioEpicFocus, excludedEpicSet]
    );

    const scenarioEpicEdges = React.useMemo(
        () => buildScenarioEpicEdges({ scenarioDependencies, scenarioLaneMeta, scenarioLaneMode, scenarioIssueByKey, scenarioEpicFocus }),
        [scenarioDependencies, scenarioLaneMeta, scenarioLaneMode, scenarioIssueByKey]
    );


    const scenarioTodayLeft = React.useMemo(() => {
        if (!scenarioViewStart || !scenarioViewEnd) return null;
        if (!scenarioLayout.width) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today
        const totalMs = Math.max(1, scenarioViewEnd - scenarioViewStart);
        const ratio = (today - scenarioViewStart) / totalMs;
        // Only show if today is within the visible range
        if (ratio < 0 || ratio > 1) return null;
        return scenarioLayout.labelWidth + scenarioLayout.width * ratio;
    }, [scenarioViewStart, scenarioViewEnd, scenarioLayout]);

    const scenarioVisibleLanes = React.useMemo(
        () => buildScenarioVisibleLanes({ scenarioLanes, scenarioLaneMeta, scenarioScrollTop, scenarioViewportHeight }),
        [scenarioLanes, scenarioLaneMeta, scenarioScrollTop, scenarioViewportHeight]
    );

    const scenarioActiveEdges = React.useMemo(
        () => buildScenarioActiveEdges({ scenarioEdgeCandidates, scenarioHoverKey }),
        [scenarioEdgeCandidates, scenarioHoverKey]
    );

    const scenarioUpstreamSet = React.useMemo(
        () => buildScenarioUpstreamSet({ scenarioHoverKey, scenarioEdgeIndex }),
        [scenarioHoverKey, scenarioEdgeIndex]
    );

    const scenarioDownstreamSet = React.useMemo(
        () => buildScenarioDownstreamSet({ scenarioHoverKey, scenarioEdgeIndex }),
        [scenarioHoverKey, scenarioEdgeIndex]
    );

    const scenarioBlockedSet = React.useMemo(() => buildScenarioBlockedSet({ scenarioDependencies }), [scenarioDependencies]);

    const scenarioBaselineEdges = React.useMemo(() => {
        return scenarioEdgeCandidates;
    }, [scenarioEdgeCandidates]);

    const scenarioFocusEdges = React.useMemo(
        () => buildScenarioFocusEdges({ scenarioEpicFocus, scenarioEdgeCandidates, scenarioFocusIssueKeys, scenarioFocusContextKeys }),
        [scenarioEpicFocus, scenarioEdgeCandidates, scenarioFocusIssueKeys, scenarioFocusContextKeys]
    );

    const toggleScenarioLane = (lane) => {
        setScenarioCollapsedLanes(prev => ({
            ...prev,
            [lane]: !prev?.[lane]
        }));
    };


    const areScenarioEdgeRendersEqual = (prev, next) => {
        if (prev.width !== next.width || prev.height !== next.height) return false;
        if (prev.paths.length !== next.paths.length) return false;
        for (let i = 0; i < prev.paths.length; i += 1) {
            const a = prev.paths[i];
            const b = next.paths[i];
            if (a.id !== b.id) return false;
            if (a.d !== b.d) return false;
            if (a.isActive !== b.isActive) return false;
            if (a.isFaded !== b.isFaded) return false;
            if (a.isContextEdge !== b.isContextEdge) return false;
            if (a.type !== b.type) return false;
        }
        return true;
    };

    const computeScenarioTooltipPosition = (anchor) => {
        const fallback = { width: 240, height: 56 };
        const tooltipNode = scenarioTooltipRef.current;
        const measured = tooltipNode?.getBoundingClientRect?.();
        const tooltipWidth = measured?.width || fallback.width;
        const tooltipHeight = measured?.height || fallback.height;
        const rect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
        if (!rect) {
            return { x: 0, y: 0 };
        }
        const padding = 12;
        const offset = 10;
        let x = rect.right + offset;
        let y = rect.top - tooltipHeight - offset;
        if (y < padding) {
            y = rect.bottom + offset;
        }
        if (x + tooltipWidth > window.innerWidth - padding) {
            x = rect.left - tooltipWidth - offset;
        }
        if (x < padding) {
            x = padding;
        }
        if (y + tooltipHeight > window.innerHeight - padding) {
            y = Math.max(padding, window.innerHeight - padding - tooltipHeight);
        }
        return { x, y };
    };

    const showScenarioTooltip = (event, payload) => {
        if (!payload) return;
        const anchor = event?.currentTarget;
        scenarioTooltipAnchorRef.current = anchor || null;
        const anchorRect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
        const position = computeScenarioTooltipPosition(anchorRect || {
            left: event.clientX,
            right: event.clientX,
            top: event.clientY,
            bottom: event.clientY,
            width: 0,
            height: 0
        });
        setScenarioTooltip({
            ...payload,
            visible: true,
            x: position.x,
            y: position.y
        });
    };

    const showScenarioTooltipFromElement = (element, payload) => {
        if (!element || !payload) return;
        scenarioTooltipAnchorRef.current = element;
        const rect = element.getBoundingClientRect();
        const position = computeScenarioTooltipPosition(rect);
        setScenarioTooltip({
            ...payload,
            visible: true,
            x: position.x,
            y: position.y
        });
    };

    const moveScenarioTooltip = () => {
        const anchor = scenarioTooltipAnchorRef.current;
        if (!anchor) return;
        setScenarioTooltip(prev => {
            if (!prev.visible) return prev;
            const position = computeScenarioTooltipPosition(anchor);
            if (position.x === prev.x && position.y === prev.y) return prev;
            return {
                ...prev,
                x: position.x,
                y: position.y
            };
        });
    };

    const hideScenarioTooltip = () => {
        scenarioTooltipAnchorRef.current = null;
        setScenarioTooltip(prev => (prev.visible ? { ...prev, visible: false } : prev));
    };

    const computeScenarioEdgePaths = React.useCallback(() => {
        if (perfEnabled) {
            perfCountersRef.current.edgeComputes += 1;
            performance.mark('scenarioEdgeCompute:start');
        }
        const container = scenarioTimelineRef.current;
        if (!container) {
            return { width: 0, height: 0, paths: [] };
        }
        const containerRect = container.getBoundingClientRect();
        const scrollLeft = container.scrollLeft || 0;
        const scrollTop = container.scrollTop || 0;
        const visibleRects = new Map();
        const visibleKeys = new Set();
        scenarioIssueRefMap.current.forEach((node, key) => {
            if (!node || !node.getBoundingClientRect) return;
            const rect = node.getBoundingClientRect();
            visibleRects.set(key, {
                x: rect.left - containerRect.left + scrollLeft,
                y: rect.top - containerRect.top + scrollTop,
                width: rect.width,
                height: rect.height
            });
            visibleKeys.add(key);
        });

        const lanes = container.querySelector('.scenario-lanes');
        const track = container.querySelector('.scenario-lane-track');
        const lanesRect = lanes ? lanes.getBoundingClientRect() : null;
        const trackRect = track ? track.getBoundingClientRect() : null;
        const lanesTop = lanesRect ? lanesRect.top - containerRect.top + scrollTop : 0;
        const trackLeft = trackRect ? trackRect.left - containerRect.left + scrollLeft : (scenarioLayout.labelWidth || 0);

        const getFallbackRect = (issueKey) => {
            const pos = scenarioPositions[issueKey];
            if (!pos) return null;
            return {
                x: trackLeft + pos.xStart,
                y: lanesTop + pos.y,
                width: Math.max(2, pos.xEnd - pos.xStart),
                height: pos.height
            };
        };

        const baseEdges = scenarioHoverKey
            ? (scenarioEpicFocus ? scenarioFocusEdges : scenarioEdgeCandidates)
            : (scenarioEpicFocus ? scenarioFocusEdges : scenarioBaselineEdges);
        const edgeMap = new Map();
        baseEdges.forEach(edge => {
            edgeMap.set(`${edge.from}-${edge.to}-${edge.type || 'link'}`, edge);
        });
        if (scenarioHoverKey) {
            scenarioActiveEdges.forEach(edge => {
                edgeMap.set(`${edge.from}-${edge.to}-${edge.type || 'link'}`, edge);
            });
        }

        const paths = [];
        edgeMap.forEach((edge) => {
            const fromVisible = visibleKeys.has(edge.from);
            const toVisible = visibleKeys.has(edge.to);
            if (!fromVisible && !toVisible) return;
            const fromRect = visibleRects.get(edge.from) || getFallbackRect(edge.from);
            const toRect = visibleRects.get(edge.to) || getFallbackRect(edge.to);
            // Active Sprint anchor + dependency visualization: Edges must never render when endpoints are missing
            // This prevents edges from "shooting to the end" or landing on wrong bar positions
            if (!fromRect || !toRect) {
                if (process.env.NODE_ENV === 'development') {
                    console.debug(`[Scenario] Skipped edge ${edge.from} → ${edge.to}: missing rect`, {
                        fromRect: !!fromRect,
                        toRect: !!toRect,
                        fromInPositions: !!scenarioPositions[edge.from],
                        toInPositions: !!scenarioPositions[edge.to]
                    });
                }
                return;
            }
            const fromInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.from);
            const toInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.to);
            if (scenarioEpicFocus && !fromInFocus && !toInFocus) {
                return;
            }

            const startX = fromRect.x + fromRect.width;
            const endX = toRect.x;

            // Timeline dependency waterflow: Only show edges that flow forward in time
            // On a timeline, backward arrows (right-to-left) make no sense
            // Skip edges where prerequisite is scheduled AFTER dependent (backward in time)
            if (endX <= startX) {
                // Dependent is to the LEFT of or same position as prerequisite (backward/parallel)
                // This happens with circular dependencies in Jira data
                // Skip to avoid visual clutter and maintain left-to-right waterflow
                if (process.env.NODE_ENV === 'development') {
                    console.debug(`[Scenario] Skipped backward edge ${edge.from} → ${edge.to}: endX=${endX.toFixed(0)} <= startX=${startX.toFixed(0)}`);
                }
                return;
            }
            const startY = fromRect.y + fromRect.height / 2;
            const endY = toRect.y + toRect.height / 2;
            const dx = endX - startX;
            let c1x;
            let c2x;
            if (dx >= 0) {
                const curve = Math.min(140, Math.max(20, dx * 0.5));
                const safeCurve = Math.min(curve, Math.max(10, dx));
                c1x = startX + safeCurve;
                c2x = endX - safeCurve;
            } else {
                const overlap = Math.abs(dx);
                const curve = Math.min(200, Math.max(60, overlap * 0.8));
                const midX = Math.min(container.scrollWidth || container.clientWidth, startX + curve);
                c1x = midX;
                c2x = midX;
            }
            const isActive = scenarioHoverKey && (edge.from === scenarioHoverKey || edge.to === scenarioHoverKey);
            const isFaded = scenarioHoverKey && !isActive;
            const isContextEdge = !isActive && scenarioEpicFocus && ((fromInFocus && !toInFocus) || (!fromInFocus && toInFocus));
            paths.push({
                id: `${edge.from}-${edge.to}-${edge.type || 'link'}`,
                from: edge.from,
                to: edge.to,
                d: `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`,
                type: edge.type,
                isActive,
                isFaded,
                isContextEdge
            });
        });
        const result = {
            width: container.scrollWidth || container.clientWidth,
            height: container.scrollHeight || container.clientHeight,
            paths
        };
        if (perfEnabled) {
            performance.mark('scenarioEdgeCompute:end');
            performance.measure(
                'scenarioEdgeCompute',
                'scenarioEdgeCompute:start',
                'scenarioEdgeCompute:end'
            );
            performance.clearMarks('scenarioEdgeCompute:start');
            performance.clearMarks('scenarioEdgeCompute:end');
            performance.clearMeasures('scenarioEdgeCompute');
        }
        return result;
    }, [
        scenarioTimelineIssueKeys,
        scenarioEpicFocus,
        scenarioEdgeCandidates,
        scenarioFocusEdges,
        scenarioBaselineEdges,
        scenarioActiveEdges,
        scenarioHoverKey,
        scenarioFocusIssueKeys,
        scenarioPositions,
        scenarioLayout.labelWidth,
        perfEnabled
    ]);

    const clearScenarioEpicFocus = () => {
        if (!scenarioEpicFocus) return;
        const restore = scenarioFocusRestoreRef.current;
        setScenarioEpicFocus(null);
        hideScenarioTooltip();
        setScenarioRangeOverride(restore?.rangeOverride || null);
        if (restore?.laneMode === 'epic') {
            scenarioSkipAutoCollapseRef.current = true;
        }
        if (restore?.laneMode && restore.laneMode !== scenarioLaneMode) {
            setScenarioLaneMode(restore.laneMode);
        }
        if (restore?.collapsedLanes) {
            setScenarioCollapsedLanes(restore.collapsedLanes);
        }
        if (scenarioTimelineRef.current && typeof restore?.scrollTop === 'number') {
            scenarioTimelineRef.current.scrollTo({ top: restore.scrollTop, behavior: 'auto' });
        }
        scenarioFocusRestoreRef.current = null;
    };

    const focusScenarioEpic = (epicKey, epicSummary) => {
        if (!epicKey) return;
        if (scenarioEpicFocus?.key === epicKey) {
            clearScenarioEpicFocus();
            return;
        }
        if (!scenarioEpicFocus) {
            scenarioFocusRestoreRef.current = {
                laneMode: scenarioLaneMode,
                collapsedLanes: { ...scenarioCollapsedLanes },
                scrollTop: scenarioTimelineRef.current?.scrollTop || 0,
                rangeOverride: scenarioRangeOverride
            };
        }
        const cleanedSummary = normalizeScenarioSummary(epicSummary) || epicKey;
        setScenarioEpicFocus({ key: epicKey, summary: cleanedSummary });
        if (scenarioLaneMode !== 'epic') {
            setScenarioLaneMode('epic');
        }
        const DAY_MS = 24 * 60 * 60 * 1000;
        let minStart = null;
        let maxEnd = null;
        scenarioIssues.forEach(issue => {
            if (issue.epicKey !== epicKey) return;
            const start = parseScenarioDate(issue.start);
            const end = parseScenarioDate(issue.end);
            if (!start || !end) return;
            if (!minStart || start < minStart) minStart = start;
            if (!maxEnd || end > maxEnd) maxEnd = end;
        });
        if (minStart && maxEnd) {
            const span = Math.max(1, maxEnd - minStart);
            const padding = Math.max(DAY_MS * 2, span * 0.06);
            setScenarioRangeOverride({
                start: new Date(minStart.getTime() - padding),
                end: new Date(maxEnd.getTime() + padding)
            });
        } else {
            setScenarioRangeOverride(null);
        }
    };

    scheduleScenarioEdgeUpdate = React.useCallback(() => {
        if (!showScenario) return;
        if (document.hidden) return;
        if (perfEnabled) {
            perfCountersRef.current.edgeRequests += 1;
        }
        if (scenarioEdgeFrameRef.current) return;
        if (scenarioEdgeUpdatePendingRef.current) return;
        scenarioEdgeUpdatePendingRef.current = true;
        scenarioEdgeFrameRef.current = window.requestAnimationFrame(() => {
            scenarioEdgeFrameRef.current = null;
            scenarioEdgeUpdatePendingRef.current = false;
            if (perfEnabled) {
                perfCountersRef.current.edgeFrames += 1;
            }
            const nextRender = computeScenarioEdgePaths();
            setScenarioEdgeRender(prev => (areScenarioEdgeRendersEqual(prev, nextRender) ? prev : nextRender));
        });
    }, [computeScenarioEdgePaths, showScenario, perfEnabled]);

    useEffect(() => {
        scheduleScenarioEdgeUpdate();
    }, [
        scenarioLaneMode,
        scenarioCollapsedLanes,
        scenarioRangeOverride,
        scenarioEpicFocus,
        scenarioLayout.width,
        scenarioLayout.height,
        scenarioLaneStacking,
        scheduleScenarioEdgeUpdate
    ]);

    useEffect(() => {
        if (!showScenario) return;
        scheduleScenarioEdgeUpdate();
    }, [showScenario, scenarioPositions, scenarioVisibleLanes, scheduleScenarioEdgeUpdate]);

    useEffect(() => {
        scheduleScenarioEdgeUpdate();
    }, [
        scenarioHoverKey,
        scenarioBaselineEdges,
        scenarioFocusEdges,
        scenarioActiveEdges,
        scenarioTimelineIssueKeys,
        scheduleScenarioEdgeUpdate
    ]);

    const scrollToScenarioIssue = (issueKey) => {
        if (scenarioEpicFocus) {
            scenarioPendingScrollRef.current = issueKey;
            clearScenarioEpicFocus();
            return;
        }
        const issue = scenarioIssueByKey.get(issueKey);
        if (!issue || !scenarioTimelineRef.current) return;

        // First, scroll the main window to bring timeline into view
        const container = scenarioTimelineRef.current;
        const containerTop = container.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: containerTop - 100, behavior: 'smooth' });

        const lane = scenarioLaneForIssue(issue);
        if (scenarioLaneMode === 'epic') {
            setScenarioCollapsedLanes(prev => ({ ...prev, [lane]: false }));
        }
        const position = scenarioPositions[issueKey];
        if (!position) return;

        // Then scroll within the timeline to the specific task
        const axis = container.querySelector('.scenario-axis');
        const axisOffset = axis ? axis.offsetHeight : 0;
        const targetTop = Math.max(0, position.y + axisOffset - container.clientHeight / 2);

        // Delay the timeline scroll slightly to allow page scroll to start
        window.setTimeout(() => {
            container.scrollTo({ top: targetTop, behavior: 'smooth' });
        }, 100);

        setScenarioFlashKey(issueKey);
        window.setTimeout(() => {
            setScenarioFlashKey(current => (current === issueKey ? null : current));
        }, 1400);
    };

    useEffect(() => {
        if (scenarioEpicFocus) return;
        const pendingKey = scenarioPendingScrollRef.current;
        if (!pendingKey) return;
        if (!scenarioPositions[pendingKey]) return;
        scenarioPendingScrollRef.current = null;
        scrollToScenarioIssue(pendingKey);
    }, [scenarioEpicFocus, scenarioPositions]);

    useEffect(() => {
        if (!scenarioEpicFocus || !scenarioTimelineRef.current) return;
        const laneMeta = scenarioLaneMeta.meta.get(scenarioEpicFocus.key);
        if (!laneMeta) return;
        const container = scenarioTimelineRef.current;
        const axis = container.querySelector('.scenario-axis');
        const axisOffset = axis ? axis.offsetHeight : 0;
        const targetTop = Math.max(0, laneMeta.offset - axisOffset);
        container.scrollTo({ top: targetTop, behavior: 'auto' });
    }, [scenarioEpicFocus, scenarioLaneMeta]);

    useEffect(() => {
        if (!scenarioEpicFocus) return;
        const handleKey = (event) => {
            if (readPendingAuthenticationRequired()) return;
            if (event.key === 'Escape') {
                clearScenarioEpicFocus();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('keydown', handleKey);
        };
    }, [scenarioEpicFocus]);
    return {
        registerScenarioIssueRef,
        scenarioLaneInfo,
        scenarioLateItems,
        scenarioDeadlineAtRisk,
        scenarioCriticalPathItems,
        scenarioUnschedulableItems,
        scenarioIssuesByLane,
        scenarioTicks,
        scenarioQuarterMarkers,
        SCENARIO_LANE_HEIGHT,
        scenarioBarGap,
        scenarioJiraEpicKeys,
        scenarioJiraStoryKeys,
        scenarioLaneMeta,
        scenarioLaneAssigneeGroups,
        scenarioPositions,
        scenarioEpicBars,
        scenarioEpicEdges,
        scenarioTodayLeft,
        scenarioVisibleLanes,
        scenarioUpstreamSet,
        scenarioDownstreamSet,
        scenarioBlockedSet,
        toggleScenarioLane,
        showScenarioTooltip,
        showScenarioTooltipFromElement,
        moveScenarioTooltip,
        hideScenarioTooltip,
        clearScenarioEpicFocus,
        focusScenarioEpic,
        scrollToScenarioIssue,
    };
}
