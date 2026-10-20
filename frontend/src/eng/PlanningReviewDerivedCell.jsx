import * as React from 'react';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import { reviewValue } from './planningReviewTableModel.js';

// A read-only derived cell: a Story column's sum on Epic and "No Epic" rows, or the parent Epic's value on Story rows.
// Unlike CustomCell it renders synthetic rows too (the "No Epic" row shows its own sum) and never offers an editor.
// Blank while a source is not loaded, during a manual refresh, or when nothing is stored.
export default function PlanningReviewDerivedCell({ row, column, review, derivedContext }) {
    const value = reviewValue(row, column, review.cells, undefined, derivedContext);
    if (value == null || value === '') return null;
    if (column.type === 'number') return value;
    return <EpicHeaderValueReadout value={value}>
        {({ discoveryProps }) => <span {...discoveryProps} className="planning-review-truncated-value">{value}</span>}
    </EpicHeaderValueReadout>;
}
