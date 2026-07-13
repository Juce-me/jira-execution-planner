import * as React from 'react';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import { buildJiraCohortIssueSearchUrl } from '../jiraExportUtils.mjs';
import OpenEpicsChart from './OpenEpicsChart.jsx';

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
    cohortAssigneeFilter
}) {
    return buildJiraCohortIssueSearchUrl({
        jiraUrl,
        startQuarter: cohortStartQuarter,
        endQuarter: cohortEndQuarter,
        groupBy: cohortGroupBy,
        rowKey: cohortSelectedRow,
        statuses: buildStatusList(rows),
        issueType: 'Epic',
        projectKey: cohortProjectFilter,
        components: activeGroupMissingComponents,
        teamIds: burnoutScopedTeamIds,
        assigneeKey: cohortAssigneeFilter
    });
}

export default function LeadTimesEpicCharts({
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
    cohortAssigneeFilter
}) {
    const searchFilters = {
        jiraUrl,
        cohortStartQuarter,
        cohortEndQuarter,
        cohortGroupBy,
        cohortSelectedRow,
        cohortProjectFilter,
        activeGroupMissingComponents,
        burnoutScopedTeamIds,
        cohortAssigneeFilter
    };
    const openJiraSearchUrl = React.useMemo(
        () => buildCohortSearchUrl({ ...searchFilters, rows: cohortOpenBars }),
        [cohortOpenBars, jiraUrl, cohortStartQuarter, cohortEndQuarter, cohortGroupBy, cohortSelectedRow, cohortProjectFilter, activeGroupMissingComponents, burnoutScopedTeamIds, cohortAssigneeFilter]
    );
    const completedJiraSearchUrl = React.useMemo(
        () => buildCohortSearchUrl({ ...searchFilters, rows: cohortCompletedBars }),
        [cohortCompletedBars, jiraUrl, cohortStartQuarter, cohortEndQuarter, cohortGroupBy, cohortSelectedRow, cohortProjectFilter, activeGroupMissingComponents, burnoutScopedTeamIds, cohortAssigneeFilter]
    );

    return (
        <>
            <div className="cohort-section">
                <OpenEpicsChart
                    title={cohortSelectedRowLabel ? `Open Epics (${cohortSelectedRowLabel})` : 'Open Epics (All Cohorts)'}
                    description={cohortSelectedRowLabel ? '' : 'Created within the selected Lead Times quarter range and still non-terminal today.'}
                    items={cohortOpenBars}
                    jiraBaseUrl={jiraUrl}
                    jiraSearchUrl={openJiraSearchUrl}
                    jiraSearchLabel="Open all open epics in Jira"
                    jiraSearchAnalyticsMeta={buildJiraIssueListLinkAnalytics({
                        issueKind: 'epic',
                        issueCount: cohortOpenBars.length,
                        sourceSurface: 'lead_times'
                    })}
                />
            </div>
            <div className="cohort-section">
                <OpenEpicsChart
                    title={cohortSelectedRowLabel ? `Completed Epics — Lead Time (${cohortSelectedRowLabel})` : 'Completed Epics — Lead Time (All Cohorts)'}
                    description={cohortSelectedRowLabel ? '' : 'Created within the selected Lead Times quarter range and reached a terminal status, with lead time shown.'}
                    items={cohortCompletedBars}
                    jiraBaseUrl={jiraUrl}
                    jiraSearchUrl={completedJiraSearchUrl}
                    jiraSearchLabel="Open all completed epics in Jira"
                    jiraSearchAnalyticsMeta={buildJiraIssueListLinkAnalytics({
                        issueKind: 'epic',
                        issueCount: cohortCompletedBars.length,
                        sourceSurface: 'lead_times'
                    })}
                    emptyMessage="No completed epics in this scope."
                    variant="completed"
                />
            </div>
        </>
    );
}
