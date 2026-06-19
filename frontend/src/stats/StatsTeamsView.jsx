import * as React from 'react';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';

function StatsTeamsView({
    open,
    statsTeamRows,
    statsBarColumns,
    statsGraphMode,
    buildStatLink,
    computeRate,
    formatPercent,
    getRateClass
}) {
    const renderStatsLink = (href, count, title, ariaLabel) => (
        <TrackedExternalLink
            className="stats-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            aria-label={ariaLabel}
            analyticsMeta={buildJiraIssueListLinkAnalytics({
                issueKind: 'story',
                issueCount: count,
                sourceSurface: 'stats'
            })}
        >
            ↗
        </TrackedExternalLink>
    );

    return (
        <div className={`stats-view ${open ? 'open' : ''}`}>
            <div className="stats-bars" style={{ '--stats-bar-columns': statsBarColumns }}>
                {statsTeamRows.map(team => {
                    const graphRate = statsGraphMode === 'weighted' ? team.weightedRate : team.straightRate;
                    return (
                        <div key={team.id} className="stats-bar">
                            <div className="stats-bar-value">{formatPercent(graphRate)}</div>
                            <div className="stats-bar-track">
                                <div
                                    className={`stats-bar-fill ${getRateClass(graphRate)}`}
                                    style={{ height: `${Math.min(100, graphRate * 100)}%` }}
                                />
                            </div>
                            <div className="stats-bar-label">{team.name}</div>
                        </div>
                    );
                })}
            </div>
            <table className="stats-table">
                <thead>
                    <tr className="stats-group-row">
                        <th className="dimension"></th>
                        <th className="stats-col total" colSpan="4">Total</th>
                        <th className="stats-col product" colSpan="4">Product</th>
                        <th className="stats-col tech" colSpan="4">Tech</th>
                    </tr>
                    <tr>
                        <th className="dimension">Team</th>
                        <th className="metric stats-col total">Done</th>
                        <th className="metric stats-col total">Incomplete</th>
                        <th className="metric stats-col total">Absolute</th>
                        <th className="metric stats-col total">Weighted</th>
                        <th className="metric stats-col product">Done</th>
                        <th className="metric stats-col product">Incomplete</th>
                        <th className="metric stats-col product">Absolute</th>
                        <th className="metric stats-col product">Weighted</th>
                        <th className="metric stats-col tech">Done</th>
                        <th className="metric stats-col tech">Incomplete</th>
                        <th className="metric stats-col tech">Absolute</th>
                        <th className="metric stats-col tech">Weighted</th>
                    </tr>
                </thead>
                <tbody>
                    {statsTeamRows.map(team => {
                        const totalDoneLink = buildStatLink(team.straight.done, {
                            teamId: team.id,
                            projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'],
                            statuses: ['Done'],
                            issueType: 'Story'
                        });
                        const totalIncompleteLink = buildStatLink(team.straight.incomplete, {
                            teamId: team.id,
                            projectNames: ['PRODUCT ROADMAPS', 'TECHNICAL ROADMAP'],
                            excludeStatuses: ['Done', 'Killed'],
                            issueType: 'Story'
                        });
                        const productDoneLink = buildStatLink(team.product.done, {
                            teamId: team.id,
                            projectName: 'PRODUCT ROADMAPS',
                            statuses: ['Done'],
                            issueType: 'Story',
                            capacityType: 'product'
                        });
                        const productIncompleteLink = buildStatLink(team.product.incomplete, {
                            teamId: team.id,
                            projectName: 'PRODUCT ROADMAPS',
                            excludeStatuses: ['Done', 'Killed'],
                            issueType: 'Story',
                            capacityType: 'product'
                        });
                        const techDoneLink = buildStatLink(team.tech.done, {
                            teamId: team.id,
                            projectName: 'TECHNICAL ROADMAP',
                            statuses: ['Done'],
                            issueType: 'Story',
                            capacityType: 'tech'
                        });
                        const techIncompleteLink = buildStatLink(team.tech.incomplete, {
                            teamId: team.id,
                            projectName: 'TECHNICAL ROADMAP',
                            excludeStatuses: ['Done', 'Killed'],
                            issueType: 'Story',
                            capacityType: 'tech'
                        });

                        return (
                        <tr key={team.id}>
                            <td className="dimension">{team.name}</td>
                            <td className="metric stats-col total">
                                <div className="postponed-cell">
                                    <span>{team.straight.done}</span>
                                    {totalDoneLink && (
                                        renderStatsLink(totalDoneLink, team.straight.done, 'View done stories for this team in Jira', 'Open done stories in Jira')
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col total">
                                <div className="postponed-cell">
                                    <span>{team.straight.incomplete}</span>
                                    {totalIncompleteLink && (
                                        renderStatsLink(totalIncompleteLink, team.straight.incomplete, 'View incomplete stories for this team in Jira', 'Open incomplete stories in Jira')
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col total">{formatPercent(team.straightRate)}</td>
                            <td className="metric stats-col total">{formatPercent(team.weightedRate)}</td>
                            <td className="metric stats-col product">
                                <div className="postponed-cell">
                                    <span>{team.product.done}</span>
                                    {productDoneLink && (
                                        renderStatsLink(productDoneLink, team.product.done, 'View done product stories for this team in Jira', 'Open done product stories in Jira')
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col product">
                                <div className="postponed-cell">
                                    <span>{team.product.incomplete}</span>
                                    {productIncompleteLink && (
                                        renderStatsLink(productIncompleteLink, team.product.incomplete, 'View incomplete product stories for this team in Jira', 'Open incomplete product stories in Jira')
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col product">{formatPercent(computeRate(team.product))}</td>
                            <td className="metric stats-col product">{formatPercent(computeRate(team.weightedProduct))}</td>
                            <td className="metric stats-col tech">
                                <div className="postponed-cell">
                                    <span>{team.tech.done}</span>
                                    {techDoneLink && (
                                        renderStatsLink(techDoneLink, team.tech.done, 'View done tech stories for this team in Jira', 'Open done tech stories in Jira')
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col tech">
                                <div className="postponed-cell">
                                    <span>{team.tech.incomplete}</span>
                                    {techIncompleteLink && (
                                        renderStatsLink(techIncompleteLink, team.tech.incomplete, 'View incomplete tech stories for this team in Jira', 'Open incomplete tech stories in Jira')
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col tech">{formatPercent(computeRate(team.tech))}</td>
                            <td className="metric stats-col tech">{formatPercent(computeRate(team.weightedTech))}</td>
                        </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default React.memo(StatsTeamsView);
