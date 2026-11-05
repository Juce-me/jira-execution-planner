import * as React from 'react';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import { DEFAULT_MAX_JQL_KEYS, buildJiraClosedEpicsSearchUrl, buildJiraCohortIssueSearchUrl } from '../jiraExportUtils.mjs';
import OpenEpicsChart from './OpenEpicsChart.jsx';
import { lowerEntityWord } from '../eng/engWorkModel.js';
import { roleLabels } from '../stats/statsScope.js';

// `word` is the lowercase plural role word of the viewed configuration ('epics' for Legacy).
const completedDescriptions = word => ({
    created: 'Created within the selected Lead Times quarter range and reached a terminal status, with lead time shown.',
    closed: 'Closed within the selected Lead Times quarter range (Done, Killed or Incomplete), with lead time shown.',
    last_n: `The most recently closed ${word} that pass the current filters, with lead time shown.`
});

function buildStatusList(rows) {
    return Array.from(new Set((rows || []).map(item => String(item?.status || '').trim()).filter(Boolean)));
}

function buildCohortSearchUrl({
    rows,
    jiraUrl,
    cohortStartQuarter,
    cohortEndQuarter,
    cohortGroupBy,
    cohortSelectedRow,
    cohortProjectFilter,
    activeGroupMissingComponents,
    burnoutScopedTeamIds,
    issueType,
    issueTypeId
}) {
    return buildJiraCohortIssueSearchUrl({
        jiraUrl,
        startQuarter: cohortStartQuarter,
        endQuarter: cohortEndQuarter,
        groupBy: cohortGroupBy,
        rowKey: cohortSelectedRow,
        statuses: buildStatusList(rows),
        issueType,
        issueTypeId,
        projectKey: cohortProjectFilter,
        components: activeGroupMissingComponents,
        teamIds: burnoutScopedTeamIds
    });
}

export default function LeadTimesEpicCharts({
    cohortMode = 'created',
    roles = null,
    cohortOpenBars,
    cohortCompletedBars,
    cohortSelectedRowLabel,
    jiraUrl,
    cohortStartQuarter,
    cohortEndQuarter,
    cohortGroupBy,
    cohortSelectedRow,
    cohortProjectFilter,
    activeGroupMissingComponents,
    burnoutScopedTeamIds,
    issueType = 'Epic',
    issueTypeId = null
}) {
    const { parent, parents } = roles || roleLabels(null);
    const word = lowerEntityWord(parents);
    const COMPLETED_DESCRIPTIONS = completedDescriptions(word);
    const searchFilters = {
        jiraUrl,
        cohortStartQuarter,
        cohortEndQuarter,
        cohortGroupBy,
        cohortSelectedRow,
        cohortProjectFilter,
        activeGroupMissingComponents,
        burnoutScopedTeamIds,
        issueType,
        issueTypeId
    };
    const openJiraSearchUrl = React.useMemo(
        () => buildCohortSearchUrl({ ...searchFilters, rows: cohortOpenBars }),
        [cohortOpenBars, jiraUrl, cohortStartQuarter, cohortEndQuarter, cohortGroupBy, cohortSelectedRow, cohortProjectFilter, activeGroupMissingComponents, burnoutScopedTeamIds, issueType, issueTypeId]
    );
    // Created describes its set by a created-date JQL; the closed modes link exactly the Epics the chart lists.
    const completedJiraSearchUrl = React.useMemo(
        () => (cohortMode === 'created'
            ? buildCohortSearchUrl({ ...searchFilters, rows: cohortCompletedBars })
            : buildJiraClosedEpicsSearchUrl(jiraUrl, cohortCompletedBars.map((item) => item.key))),
        [cohortMode, cohortCompletedBars, jiraUrl, cohortStartQuarter, cohortEndQuarter, cohortGroupBy, cohortSelectedRow, cohortProjectFilter, activeGroupMissingComponents, burnoutScopedTeamIds, issueType, issueTypeId]
    );

    return (
        <>
            {cohortMode === 'created' && (
            <div className="cohort-section">
                <OpenEpicsChart
                    title={cohortSelectedRowLabel ? `Open ${parents} (${cohortSelectedRowLabel})` : `Open ${parents} (All Cohorts)`}
                    description={cohortSelectedRowLabel ? '' : 'Created within the selected Lead Times quarter range and still non-terminal today.'}
                    items={cohortOpenBars}
                    itemWord={word}
                    itemName={parent}
                    jiraBaseUrl={jiraUrl}
                    jiraSearchUrl={openJiraSearchUrl}
                    jiraSearchLabel={`Open all open ${word} in Jira`}
                    jiraSearchAnalyticsMeta={buildJiraIssueListLinkAnalytics({
                        issueKind: 'epic',
                        issueCount: cohortOpenBars.length,
                        sourceSurface: 'lead_times'
                    })}
                />
            </div>
            )}
            <div className="cohort-section">
                <OpenEpicsChart
                    title={cohortSelectedRowLabel ? `Completed ${parents} — Lead Time (${cohortSelectedRowLabel})` : `Completed ${parents} — Lead Time (All Cohorts)`}
                    description={cohortSelectedRowLabel ? '' : COMPLETED_DESCRIPTIONS[cohortMode] || COMPLETED_DESCRIPTIONS.created}
                    items={cohortCompletedBars}
                    itemWord={word}
                    itemName={parent}
                    jiraBaseUrl={jiraUrl}
                    jiraSearchUrl={completedJiraSearchUrl}
                    jiraSearchLabel={`Open all completed ${word} in Jira`}
                    jiraSearchAnalyticsMeta={buildJiraIssueListLinkAnalytics({
                        issueKind: 'epic',
                        issueCount: cohortCompletedBars.length,
                        sourceSurface: 'lead_times'
                    })}
                    emptyMessage={`No completed ${word} in this scope.`}
                    variant="completed"
                />
                {cohortMode !== 'created' && cohortCompletedBars.length > DEFAULT_MAX_JQL_KEYS && (
                    <div className="stats-note">{`Too many ${word} to open in Jira as one list (limit ${DEFAULT_MAX_JQL_KEYS}).`}</div>
                )}
            </div>
        </>
    );
}
