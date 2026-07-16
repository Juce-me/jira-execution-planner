import * as React from 'react';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import { buildJiraCohortStatusSearchUrl } from '../jiraExportUtils.mjs';

export default function LeadTimesWorkflowStatusCard({
    jiraUrl,
    cohortStartQuarter,
    cohortEndQuarter,
    cohortSummary,
    cohortWorkflowStatusTotal
}) {
    const jiraLink = React.useMemo(() => {
        if (!cohortWorkflowStatusTotal) return '';
        return buildJiraCohortStatusSearchUrl({
            jiraUrl,
            startQuarter: cohortStartQuarter,
            endQuarter: cohortEndQuarter,
            statuses: ['In Progress', 'Postponed', 'Awaiting Validation'],
            issueType: 'Epic',
        });
    }, [jiraUrl, cohortStartQuarter, cohortEndQuarter, cohortWorkflowStatusTotal]);

    return (
        <div className="stats-card">
            <h4>Workflow Status</h4>
            <div className="stat-value">{cohortWorkflowStatusTotal}</div>
            <div className="stats-note">
                {cohortSummary.inProgress || 0} in progress · {cohortSummary.postponed} postponed · {cohortSummary.awaitingValidation || 0} awaiting validation
            </div>
            {jiraLink && (
                <TrackedExternalLink
                    className="stats-card-link"
                    href={jiraLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View in progress, postponed, and awaiting validation epics in Jira"
                    aria-label="Open in progress, postponed, and awaiting validation epics in Jira"
                    analyticsMeta={buildJiraIssueListLinkAnalytics({
                        issueKind: 'epic',
                        issueCount: cohortWorkflowStatusTotal,
                        sourceSurface: 'lead_times'
                    })}
                >
                    Open in Jira
                </TrackedExternalLink>
            )}
        </div>
    );
}
