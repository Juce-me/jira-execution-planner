import * as React from 'react';

const EMPTY_BREAKDOWN = { todoPending: 0, accepted: 0, postponed: 0 };

// DELIVERY-only No Allocation cells of the Planned Teams Effort table, between Tech and Total. They reuse the
// table's cell markup and carry no Jira links (No Allocation has no Jira project). `header` renders the column titles;
// otherwise `breakdown` (a Team entry's or the totals' `none`, absent when the Team has no such work) is shown.
export default function CapacityNoAllocationCells({ header = false, breakdown, total = false, formatValue, getMetricClass }) {
    if (header) {
        return (
            <>
                <div className="capacity-cell metric">To Do / Pending</div>
                <div className="capacity-cell metric">Postponed</div>
                <div className="capacity-cell metric divider-right">Accepted</div>
            </>
        );
    }
    const value = breakdown || EMPTY_BREAKDOWN;
    const suffix = total ? ' capacity-total' : '';
    return (
        <>
            <div className={`capacity-cell metric${suffix}`}>
                <div className="postponed-cell">
                    <span className={getMetricClass(value.todoPending, 'todo', value.accepted)}>{formatValue(value.todoPending)}</span>
                </div>
            </div>
            <div className={`capacity-cell metric${suffix}`}>
                <div className="postponed-cell">
                    <span className="metric-value">{formatValue(value.postponed)}</span>
                </div>
            </div>
            <div className={`capacity-cell metric divider-right${suffix}`}>
                <div className="postponed-cell">
                    <span className={getMetricClass(value.accepted, 'accepted')}>{formatValue(value.accepted)}</span>
                </div>
            </div>
        </>
    );
}
