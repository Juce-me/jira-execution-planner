import * as React from 'react';

export default function PlanningCapacityBar({
    capacityEnabled,
    totalCapacityAdjusted,
    estimatedCapacityAdjusted,
    excludedCapacityAdjusted,
    selectedCount,
    selectedSP,
    capacitySummary,
}) {
    if (capacityEnabled && totalCapacityAdjusted > 0) {
        const scale = Math.max(totalCapacityAdjusted, selectedSP) * 1.15;
        const toPct = (v) => Math.min(100, (v / scale) * 100);
        const selectedPct = toPct(selectedSP);
        const planningPct = toPct(estimatedCapacityAdjusted);
        const teamCapPct = toPct(totalCapacityAdjusted);
        const showPlanningMarker = Math.abs(estimatedCapacityAdjusted - totalCapacityAdjusted) > 0.05;
        const isOver = capacitySummary.status === 'over';
        const isUnder = capacitySummary.status === 'under';
        const varianceOverPct = isOver ? selectedPct - teamCapPct : 0;
        return (
            <div className="capacity-bar-graph">
                <div className="capacity-bar-track">
                    {/* Excluded zone */}
                    {excludedCapacityAdjusted > 0 && (
                        <div className="capacity-bar-excluded-zone" style={{ left: `${planningPct}%`, width: `${teamCapPct - planningPct}%` }} />
                    )}
                    {/* Variance overshoot zone (always visible when over) */}
                    {varianceOverPct > 0 && (
                        <div className="capacity-bar-variance-zone visible" style={{ left: `${teamCapPct}%`, width: `${varianceOverPct}%` }} />
                    )}
                    {/* Under-capacity gap zone (visible when under) */}
                    {isUnder && (
                        <div className="capacity-bar-variance-zone under-zone" style={{ left: `${selectedPct}%`, width: `${teamCapPct - selectedPct}%` }} />
                    )}
                    {/* Selected fill - clip at teamCap when over so variance zone is visible */}
                    <div className={`capacity-bar-fill ${isOver ? 'over' : isUnder ? 'under' : ''}${(isOver ? teamCapPct : selectedPct) < 20 ? ' narrow' : ''}`} style={{ width: `${isOver ? teamCapPct : selectedPct}%` }} data-tooltip={`Total story points from ${selectedCount} selected tasks.`}>
                        <span className="capacity-bar-fill-label">{selectedCount} tasks · {selectedSP.toFixed(1)} SP</span>
                    </div>
                    {/* Planning marker */}
                    {showPlanningMarker && (
                        <div className="capacity-bar-marker planning" style={{ left: `${planningPct}%` }} data-tooltip="Team capacity minus excluded mandatory activities (perf review, dev lead management, etc.).">
                            <div className="capacity-bar-marker-line dashed" />
                            <div className="capacity-bar-marker-label">Planning<br/>{estimatedCapacityAdjusted.toFixed(1)}</div>
                        </div>
                    )}
                    {/* Team cap marker */}
                    <div className="capacity-bar-marker teamcap" style={{ left: `${teamCapPct}%` }} data-tooltip="Estimated total team capacity for the quarter.">
                        <div className="capacity-bar-marker-line" />
                        <div className="capacity-bar-marker-label">Team Cap<br/>{totalCapacityAdjusted.toFixed(1)}</div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="planning-stats">
            <div className="planning-stat">
                <span className="planning-stat-label">Selected:</span>
                <span className="planning-stat-value">{selectedCount} · {selectedSP.toFixed(1)} SP</span>
            </div>
        </div>
    );
}
