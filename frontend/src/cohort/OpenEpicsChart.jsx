import * as React from 'react';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';

const DEFAULT_VISIBLE_ROWS = 30;

function normalizePositiveInteger(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(1, Math.floor(numeric));
}

function OpenEpicsChart({
    title,
    description,
    items,
    jiraBaseUrl,
    jiraSearchUrl,
    jiraSearchLabel,
    jiraSearchAnalyticsMeta,
    emptyMessage,
    variant,
    initialVisibleCount = DEFAULT_VISIBLE_ROWS,
    loadMoreCount = DEFAULT_VISIBLE_ROWS
}) {
    const rows = Array.isArray(items) ? items : [];
    const fallbackEmpty = emptyMessage || 'No open epics in this scope.';
    const fillClass = `cohort-open-fill${variant ? ` cohort-open-fill--${variant}` : ''}`;
    const initialCount = normalizePositiveInteger(initialVisibleCount, rows.length || DEFAULT_VISIBLE_ROWS);
    const incrementCount = normalizePositiveInteger(loadMoreCount, DEFAULT_VISIBLE_ROWS);
    const [visibleCount, setVisibleCount] = React.useState(() => Math.min(rows.length, initialCount));

    React.useEffect(() => {
        setVisibleCount(Math.min(rows.length, initialCount));
    }, [rows.length, initialCount, title]);

    const normalizedJiraSearchUrl = String(jiraSearchUrl || '').trim();
    const normalizedJiraSearchLabel = jiraSearchLabel || (variant === 'completed'
        ? 'Open all completed epics in Jira'
        : 'Open all open epics in Jira');
    const heading = (
        <div className="cohort-open-heading">
            <div className="cohort-open-heading-text">
                <span className="cohort-open-title">{title}</span>
                {description && <span className="cohort-open-description">{description}</span>}
            </div>
            {normalizedJiraSearchUrl && (
                <TrackedExternalLink
                    className="cohort-open-jira-button"
                    href={normalizedJiraSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={normalizedJiraSearchLabel}
                    aria-label={normalizedJiraSearchLabel}
                    analyticsMeta={jiraSearchAnalyticsMeta}
                >
                    Jira
                </TrackedExternalLink>
            )}
        </div>
    );

    if (!rows.length) {
        return (
            <div className="cohort-open-chart">
                {heading}
                <div className="cohort-empty">{fallbackEmpty}</div>
            </div>
        );
    }

    const visibleRows = rows.slice(0, visibleCount);
    const hasMoreRows = visibleCount < rows.length;
    const remainingCount = Math.max(0, rows.length - visibleCount);
    const nextCount = Math.min(incrementCount, remainingCount);
    const itemLabel = variant === 'completed' ? 'completed epics' : 'open epics';
    const maxDays = rows.reduce((acc, item) => Math.max(acc, Number(item?.daysOpen) || 0), 0) || 1;

    return (
        <div className="cohort-open-chart">
            {heading}
            <div className="cohort-open-bars">
                {visibleRows.map((item) => {
                    const daysOpen = Number(item?.daysOpen || 0);
                    const width = Math.max(3, (daysOpen / maxDays) * 100);
                    const issueKey = String(item?.key || '').trim();
                    const issueLink = jiraBaseUrl && issueKey ? `${jiraBaseUrl}/browse/${issueKey}` : '';
                    return (
                        <div key={item.key || `${item.summary}-${daysOpen}`} className="cohort-open-row">
                            <div className="cohort-open-row-head">
                                {issueLink ? (
                                    <a
                                        className="cohort-open-link"
                                        href={issueLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`Open ${issueKey} in Jira`}
                                    >
                                        <span className="cohort-open-key">{issueKey || 'Epic'}</span>
                                        <span className="cohort-open-summary">{item.summary || 'No summary'}</span>
                                        <span className="cohort-open-status">{item.status || 'Open'}</span>
                                    </a>
                                ) : (
                                    <>
                                        <span className="cohort-open-key">{item.key || 'Epic'}</span>
                                        <span className="cohort-open-summary">{item.summary || 'No summary'}</span>
                                        <span className="cohort-open-status">{item.status || 'Open'}</span>
                                    </>
                                )}
                                <div className="cohort-open-meta">
                                    {item.projectKey || 'N/A'} · {item.teamName || 'Unknown Team'} · {item.assigneeName || 'Unassigned'}
                                </div>
                            </div>
                            <div className="cohort-open-track">
                                <div className={fillClass} style={{ width: `${width}%` }} />
                                <span className="cohort-open-value">{daysOpen}d</span>
                            </div>
                        </div>
                    );
                })}
            </div>
            {hasMoreRows && (
                <button
                    className="cohort-open-more"
                    type="button"
                    onClick={() => setVisibleCount(count => Math.min(rows.length, count + incrementCount))}
                >
                    Load {nextCount} more from {rows.length} {itemLabel}
                </button>
            )}
        </div>
    );
}

export default React.memo(OpenEpicsChart);
