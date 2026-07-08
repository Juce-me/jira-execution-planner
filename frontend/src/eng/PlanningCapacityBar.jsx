import * as React from 'react';
import { computeCapacityBarLayout } from './planningCapacityUtils.js';

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
        const { selectedPct, planningPct, teamCapPct, isOver, isUnder, varianceOverPct, fillPct, showPlanningMarker } = computeCapacityBarLayout({
            totalCapacityAdjusted,
            estimatedCapacityAdjusted,
            selectedSP,
            capacityStatus: capacitySummary.status,
        });
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
                    <div className={`capacity-bar-fill ${isOver ? 'over' : isUnder ? 'under' : ''}${fillPct < 20 ? ' narrow' : ''}`} style={{ width: `${fillPct}%` }} data-tooltip={`Total story points from ${selectedCount} selected tasks.`}>
                        {!isOver && (
                            <span className="capacity-bar-fill-label">{selectedCount} tasks · {selectedSP.toFixed(1)} SP</span>
                        )}
                    </div>
                    {/* When over capacity the selected-total readout sits above the overflow
                        band's right-top (the selected point), not pinned to the Team Cap line. */}
                    {isOver && (
                        <span className="capacity-bar-fill-label capacity-bar-over-label" style={{ right: `${100 - selectedPct}%` }}>{selectedCount} tasks · {selectedSP.toFixed(1)} SP</span>
                    )}
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
