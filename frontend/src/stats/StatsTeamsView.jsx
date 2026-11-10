import * as React from 'react';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import { lowerEntityWord } from '../eng/engWorkModel.js';
import { roleLabels } from './statsScope.js';

function StatsTeamsView({
    open,
    statsTeamRows,
    statsBarColumns,
    statsGraphMode,
    buildStatLink,
    computeRate,
    formatPercent,
    getRateClass,
    words = roleLabels(null),
    // DELIVERY: Product/Tech come from the Initiative's Allocation, so a No Allocation column follows Tech and no
    // Product/Tech/No Allocation cell links to a project-based Jira search (it would not match the counts).
    noAllocation = false
}) {
    const childWords = lowerEntityWord(words.children);
    const sideLink = noAllocation ? () => '' : buildStatLink;
    const emptyMetrics = { done: 0, incomplete: 0, killed: 0 };
    // Four column groups exceed a desktop panel; the DELIVERY table scrolls horizontally (tap/swipe) inside its own frame.
    const frame = table => (noAllocation ? <div data-allocation="delivery">{table}</div> : table);
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
            {frame(<table className="stats-table">
                <thead>
                    <tr className="stats-group-row">
                        <th className="dimension"></th>
                        <th className="stats-col total" colSpan="4">Total</th>
                        <th className="stats-col product" colSpan="4">Product</th>
                        <th className="stats-col tech" colSpan="4">Tech</th>
                        {noAllocation && <th className="stats-col none" colSpan="4">No Allocation</th>}
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
                        {noAllocation && (
                            <>
                                <th className="metric stats-col none">Done</th>
                                <th className="metric stats-col none">Incomplete</th>
                                <th className="metric stats-col none">Absolute</th>
                                <th className="metric stats-col none">Weighted</th>
                            </>
                        )}
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
                        const productDoneLink = sideLink(team.product.done, {
                            teamId: team.id,
                            projectName: 'PRODUCT ROADMAPS',
                            statuses: ['Done'],
                            issueType: 'Story',
                            capacityType: 'product'
                        });
                        const productIncompleteLink = sideLink(team.product.incomplete, {
                            teamId: team.id,
                            projectName: 'PRODUCT ROADMAPS',
                            excludeStatuses: ['Done', 'Killed'],
                            issueType: 'Story',
                            capacityType: 'product'
                        });
                        const techDoneLink = sideLink(team.tech.done, {
                            teamId: team.id,
                            projectName: 'TECHNICAL ROADMAP',
                            statuses: ['Done'],
                            issueType: 'Story',
                            capacityType: 'tech'
                        });
                        const techIncompleteLink = sideLink(team.tech.incomplete, {
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
                                        renderStatsLink(totalDoneLink, team.straight.done, `View done ${childWords} for this team in Jira`, `Open done ${childWords} in Jira`)
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col total">
                                <div className="postponed-cell">
                                    <span>{team.straight.incomplete}</span>
                                    {totalIncompleteLink && (
                                        renderStatsLink(totalIncompleteLink, team.straight.incomplete, `View incomplete ${childWords} for this team in Jira`, `Open incomplete ${childWords} in Jira`)
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col total">{formatPercent(team.straightRate)}</td>
                            <td className="metric stats-col total">{formatPercent(team.weightedRate)}</td>
                            <td className="metric stats-col product">
                                <div className="postponed-cell">
                                    <span>{team.product.done}</span>
                                    {productDoneLink && (
                                        renderStatsLink(productDoneLink, team.product.done, `View done product ${childWords} for this team in Jira`, `Open done product ${childWords} in Jira`)
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col product">
                                <div className="postponed-cell">
                                    <span>{team.product.incomplete}</span>
                                    {productIncompleteLink && (
                                        renderStatsLink(productIncompleteLink, team.product.incomplete, `View incomplete product ${childWords} for this team in Jira`, `Open incomplete product ${childWords} in Jira`)
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col product">{formatPercent(computeRate(team.product))}</td>
                            <td className="metric stats-col product">{formatPercent(computeRate(team.weightedProduct))}</td>
                            <td className="metric stats-col tech">
                                <div className="postponed-cell">
                                    <span>{team.tech.done}</span>
                                    {techDoneLink && (
                                        renderStatsLink(techDoneLink, team.tech.done, `View done tech ${childWords} for this team in Jira`, `Open done tech ${childWords} in Jira`)
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col tech">
                                <div className="postponed-cell">
                                    <span>{team.tech.incomplete}</span>
                                    {techIncompleteLink && (
                                        renderStatsLink(techIncompleteLink, team.tech.incomplete, `View incomplete tech ${childWords} for this team in Jira`, `Open incomplete tech ${childWords} in Jira`)
                                    )}
                                </div>
                            </td>
                            <td className="metric stats-col tech">{formatPercent(computeRate(team.tech))}</td>
                            <td className="metric stats-col tech">{formatPercent(computeRate(team.weightedTech))}</td>
                            {noAllocation && (
                                <>
                                    <td className="metric stats-col none"><div className="postponed-cell"><span>{(team.none || emptyMetrics).done}</span></div></td>
                                    <td className="metric stats-col none"><div className="postponed-cell"><span>{(team.none || emptyMetrics).incomplete}</span></div></td>
                                    <td className="metric stats-col none">{formatPercent(computeRate(team.none))}</td>
                                    <td className="metric stats-col none">{formatPercent(computeRate(team.weightedNone))}</td>
                                </>
                            )}
                        </tr>
                        );
                    })}
                </tbody>
            </table>)}
        </div>
    );
}

export default React.memo(StatsTeamsView);
