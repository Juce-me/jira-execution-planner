import * as React from 'react';
import StackedBar from './StackedBar.jsx';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import { buildJiraIssueSearchUrl } from '../jiraExportUtils.mjs';
import { NO_TRACK_LABEL } from './projectTrackStats.js';

// Per-assignee (Epic mode) / per-team (Team mode) breakdown: one stacked bar per row,
// each split by track, rows already sorted by total in the Task 2 helper.
export default function ProjectTrackBreakdownChart({ data, resolveColor, jiraUrl }) {
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    const rows = (Array.isArray(data?.rows) ? data.rows : []).map((row) => ({
        id: row.id,
        label: row.label,
        total: row.total,
        segments: tracks.map((track) => ({
            key: track,
            value: row.byTrack?.[track] || 0,
            epicKeys: row.epicKeysByTrack?.[track] || []
        }))
    }));

    const resolveSegmentLink = ({ row, segmentKey, segment }) => {
        if (segmentKey !== NO_TRACK_LABEL || !segment.epicKeys?.length) return null;
        const href = buildJiraIssueSearchUrl(jiraUrl, segment.epicKeys);
        if (!href) return null;
        return {
            href,
            title: `Open ${row.label}'s no-track epics in Jira`,
            ariaLabel: `Open ${row.label}'s no-track epics in Jira`,
            analyticsMeta: buildJiraIssueListLinkAnalytics({
                issueKind: 'epic',
                issueCount: segment.epicKeys.length,
                sourceSurface: 'stats'
            })
        };
    };

    return (
        <StackedBar
            rows={rows}
            segmentOrder={tracks}
            resolveColor={resolveColor}
            resolveSegmentLink={resolveSegmentLink}
            ariaLabel="Story points by track per row"
            emptyText="No story points in the selected sprint range."
        />
    );
}
