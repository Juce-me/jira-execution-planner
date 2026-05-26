import * as React from 'react';

function StatsDeliverySummary({
    statsGraphMode,
    setStatsGraphMode,
    statsTotals,
    computeRate,
    formatPercent
}) {
    return (
        <div className="stats-summary">
            <div
                className={`stats-card selectable ${statsGraphMode === 'absolute' ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setStatsGraphMode('absolute')}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setStatsGraphMode('absolute');
                    }
                }}
                aria-pressed={statsGraphMode === 'absolute'}
            >
                <h4>Delivery Rate</h4>
                <div className="stat-value">
                    {formatPercent(computeRate(statsTotals.straight))}
                </div>
                <div className="stats-note">Absolute rate</div>
            </div>
            <div
                className={`stats-card selectable ${statsGraphMode === 'weighted' ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setStatsGraphMode('weighted')}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setStatsGraphMode('weighted');
                    }
                }}
                aria-pressed={statsGraphMode === 'weighted'}
            >
                <h4>Weighted Rate</h4>
                <div className="stat-value">
                    {formatPercent(computeRate(statsTotals.weighted))}
                </div>
                <div className="stats-note">Priority-weighted</div>
            </div>
            <div className="stats-card">
                <h4>Totals</h4>
                <div className="stat-value">{statsTotals.straight.done + statsTotals.straight.incomplete + statsTotals.straight.killed}</div>
                <div className="stats-note">
                    {statsTotals.straight.done} done · {statsTotals.straight.incomplete} incomplete · {statsTotals.straight.killed} killed
                </div>
            </div>
            <div className="stats-card">
                <h4>Source</h4>
                <div className="stat-value">Sprint tasks</div>
                <div className="stats-note">Derived from the loaded sprint list</div>
            </div>
        </div>
    );
}

export default React.memo(StatsDeliverySummary);
