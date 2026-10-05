import * as React from 'react';
import { parseScenarioDate } from './scenarioUtils.js';
import { buildScenarioSprintBounds, buildScenarioIssues, buildScenarioEffectiveIssues, buildScenarioSearchMatchSet, buildScenarioFilteredIssues, buildScenarioExcludedIssueKeys, buildScenarioIssueByKey, buildScenarioBaseEnd, buildScenarioFocusIssueKeys, buildScenarioFocusContextKeys, buildScenarioTimelineIssues, buildScenarioTimelineWithSegments, buildScenarioAssigneeConflicts, buildScenarioDepViolations, buildScenarioDepViolatedKeys } from './scenarioLayout.js';

export function useScenarioDerived({
    scenarioState,
    EMPTY_ARRAY,
    EMPTY_OBJECT,
    jiraUrl,
    searchQuery,
    normalizeEpicKey,
    excludedEpicSet,
}) {
    const {
        scenarioData,
        scenarioEpicFocus,
        scenarioRangeOverride,
        scenarioOverrides,
        scenarioEditMode,
        scenarioViewRangeRef,
    } = scenarioState;
    const matchesScenarioSearch = (issue, query) => {
        if (!query) return true;
        const assigneeValue = issue?.assignee?.displayName || issue?.assignee?.name || issue?.assignee;
        const teamValue = issue?.team?.name || issue?.team;
        const tokens = [
            issue?.summary,
            issue?.key,
            issue?.epicKey,
            issue?.epicSummary,
            teamValue,
            assigneeValue
        ]
            .filter(Boolean)
            .map(value => String(value).toLowerCase());
        return tokens.some(value => value.includes(query));
    };

    const scenarioRawIssues = scenarioData?.issues || EMPTY_ARRAY;
    const scenarioConfig = scenarioData?.config || EMPTY_OBJECT;
    const scenarioSummary = scenarioData?.summary || EMPTY_OBJECT;
    const scenarioBaseUrl = scenarioData?.jira_base_url || jiraUrl || '';
    const scenarioDependencies = scenarioData?.dependencies || EMPTY_ARRAY;
    const scenarioCapacityByTeam = scenarioData?.capacity_by_team || EMPTY_OBJECT;
    const scenarioSprintBounds = React.useMemo(() => buildScenarioSprintBounds({ scenarioData }), [scenarioData]);

    // Apply virtual assignment for DevLead Management tasks
    const scenarioIssues = React.useMemo(
        () => buildScenarioIssues({ scenarioRawIssues, scenarioCapacityByTeam }),
        [scenarioRawIssues, scenarioCapacityByTeam]
    );
    const scenarioEffectiveIssues = React.useMemo(
        () => buildScenarioEffectiveIssues({ scenarioIssues, scenarioOverrides }),
        [scenarioIssues, scenarioOverrides]
    );
    const scenarioSearchQuery = React.useMemo(
        () => (searchQuery || '').trim().toLowerCase(),
        [searchQuery]
    );
    const scenarioSearchMatchSet = React.useMemo(
        () => buildScenarioSearchMatchSet({ scenarioEffectiveIssues, scenarioSearchQuery, matchesScenarioSearch }),
        [scenarioEffectiveIssues, scenarioSearchQuery]
    );
    const scenarioFilteredIssues = React.useMemo(
        () => buildScenarioFilteredIssues({ scenarioEffectiveIssues, scenarioSearchQuery, scenarioSearchMatchSet }),
        [scenarioEffectiveIssues, scenarioSearchQuery, scenarioSearchMatchSet]
    );
    const scenarioExcludedIssueKeys = React.useMemo(
        () => buildScenarioExcludedIssueKeys({ scenarioEffectiveIssues, excludedEpicSet, normalizeEpicKey }),
        [scenarioEffectiveIssues, excludedEpicSet]
    );
    const scenarioFocusKeys = scenarioData?.focus_set?.focused_issue_keys || EMPTY_ARRAY;
    const scenarioContextKeys = scenarioData?.focus_set?.context_issue_keys || EMPTY_ARRAY;
    const scenarioFocusSet = React.useMemo(
        () => new Set(scenarioFocusKeys),
        [scenarioFocusKeys]
    );
    const scenarioContextSet = React.useMemo(
        () => new Set(scenarioContextKeys),
        [scenarioContextKeys]
    );
    const scenarioIssueByKey = React.useMemo(() => buildScenarioIssueByKey({ scenarioEffectiveIssues }), [scenarioEffectiveIssues]);
    const scenarioBaseStart = parseScenarioDate(scenarioConfig.start_date);
    const scenarioDeadline = parseScenarioDate(scenarioConfig.quarter_end_date);
    const scenarioBaseEnd = React.useMemo(
        () => buildScenarioBaseEnd({ scenarioDeadline, scenarioEffectiveIssues }),
        [scenarioDeadline, scenarioEffectiveIssues]
    );
    const scenarioViewStart = scenarioRangeOverride?.start || scenarioBaseStart;
    const scenarioViewEnd = scenarioRangeOverride?.end || scenarioBaseEnd;
    scenarioViewRangeRef.current = { start: scenarioViewStart, end: scenarioViewEnd };
    const scenarioFocusEpicKey = scenarioEpicFocus?.key || null;
    const scenarioFocusIssueKeys = React.useMemo(
        () => buildScenarioFocusIssueKeys({ scenarioEffectiveIssues, scenarioFocusEpicKey }),
        [scenarioEffectiveIssues, scenarioFocusEpicKey]
    );
    const scenarioFocusContextKeys = React.useMemo(
        () => buildScenarioFocusContextKeys({ scenarioDependencies, scenarioFocusIssueKeys, scenarioFocusEpicKey }),
        [scenarioDependencies, scenarioFocusIssueKeys, scenarioFocusEpicKey]
    );
    const scenarioTimelineIssues = React.useMemo(
        () => buildScenarioTimelineIssues({ scenarioEffectiveIssues, scenarioFilteredIssues, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioFocusContextKeys }),
        [scenarioEffectiveIssues, scenarioFilteredIssues, scenarioEpicFocus, scenarioFocusIssueKeys, scenarioFocusContextKeys]
    );
    const scenarioTimelineWithSegments = React.useMemo(
        () => buildScenarioTimelineWithSegments({ scenarioTimelineIssues, scenarioExcludedIssueKeys, scenarioSprintBounds, scenarioViewStart, scenarioDeadline }),
        [scenarioTimelineIssues, scenarioExcludedIssueKeys, scenarioSprintBounds, scenarioViewStart, scenarioDeadline]
    );
    const scenarioTimelineIssueKeys = React.useMemo(() => {
        return new Set(scenarioTimelineWithSegments.map(issue => issue.key));
    }, [scenarioTimelineWithSegments]);
    const scenarioAssigneeConflicts = React.useMemo(
        () => buildScenarioAssigneeConflicts({ scenarioTimelineIssues, excludedEpicSet, normalizeEpicKey }),
        [scenarioTimelineIssues, excludedEpicSet]
    );
    const scenarioDepViolations = React.useMemo(
        () => buildScenarioDepViolations({ scenarioEditMode, scenarioDependencies, scenarioIssueByKey }),
        [scenarioEditMode, scenarioDependencies, scenarioIssueByKey]
    );
    const scenarioDepViolatedKeys = React.useMemo(() => buildScenarioDepViolatedKeys({ scenarioDepViolations }), [scenarioDepViolations]);
    return {
        scenarioSummary,
        scenarioBaseUrl,
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
        scenarioDepViolations,
        scenarioDepViolatedKeys,
    };
}
