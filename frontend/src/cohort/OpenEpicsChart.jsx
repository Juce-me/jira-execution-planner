import * as React from 'react';

function OpenEpicsChart({ title, items, jiraBaseUrl }) {
    const rows = Array.isArray(items) ? items : [];

    if (!rows.length) {
        return (
            <div className="cohort-open-chart">
                <div className="cohort-open-title">{title}</div>
                <div className="cohort-empty">No open epics in this scope.</div>
            </div>
        );
    }

    const maxDays = rows.reduce((acc, item) => Math.max(acc, Number(item?.daysOpen) || 0), 0) || 1;

    return (
        <div className="cohort-open-chart">
            <div className="cohort-open-title">{title}</div>
            <div className="cohort-open-bars">
                {rows.map((item) => {
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
                                    </a>
                                ) : (
                                    <>
                                        <span className="cohort-open-key">{item.key || 'Epic'}</span>
                                        <span className="cohort-open-summary">{item.summary || 'No summary'}</span>
                                    </>
                                )}
                                <div className="cohort-open-meta">
                                    {item.projectKey || 'N/A'} · {item.teamName || 'Unknown Team'} · {item.assigneeName || 'Unassigned'}
                                </div>
                            </div>
                            <div className="cohort-open-track">
                                <div className="cohort-open-fill" style={{ width: `${width}%` }} />
                                <span className="cohort-open-value">{daysOpen}d</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default React.memo(OpenEpicsChart);
