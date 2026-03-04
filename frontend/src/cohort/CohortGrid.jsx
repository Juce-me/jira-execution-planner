import * as React from 'react';

function getHeatLevel(count, maxValue) {
    if (!count || !maxValue) return 0;
    const ratio = count / maxValue;
    if (ratio >= 0.8) return 4;
    if (ratio >= 0.55) return 3;
    if (ratio >= 0.3) return 2;
    return 1;
}

function CohortGrid({ model, selectedRowKey, onSelectRow }) {
    const [tooltip, setTooltip] = React.useState(null);
    const wrapRef = React.useRef(null);

    if (!model || !Array.isArray(model.rows) || model.rows.length === 0) {
        return <div className="cohort-empty">No cohort records for current filters.</div>;
    }

    const handleCellHover = (event, row, cell, column) => {
        if (!cell || !cell.count) {
            setTooltip(null);
            return;
        }
        const rect = wrapRef.current?.getBoundingClientRect();
        if (!rect) return;
        const left = Math.min(Math.max(8, event.clientX - rect.left + 10), rect.width - 260);
        const top = Math.max(8, event.clientY - rect.top + 10);
        setTooltip({
            left,
            top,
            row,
            cell,
            column
        });
    };

    return (
        <div className="cohort-grid-wrap" ref={wrapRef} onMouseLeave={() => setTooltip(null)}>
            <table className="cohort-grid">
                <thead>
                    <tr>
                        <th className="cohort-row-head">Created</th>
                        <th className="cohort-row-total">Created</th>
                        <th className="cohort-row-total">Open</th>
                        {model.columns.map((column) => (
                            <th key={column.key}>{column.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {model.rows.map((row) => {
                        const rowSelected = selectedRowKey === row.key;
                        return (
                            <tr
                                key={row.key}
                                className={rowSelected ? 'selected' : ''}
                                onClick={() => onSelectRow(row.key)}
                            >
                                <td className="cohort-row-title">{row.label}</td>
                                <td className="cohort-row-metric">{row.totalCreated}</td>
                                <td className="cohort-row-metric">{row.openCount}</td>
                                {row.cells.map((cell) => {
                                    const column = model.columns[cell.index];
                                    const level = getHeatLevel(cell.count, model.maxCellCount);
                                    return (
                                        <td
                                            key={`${row.key}-${column.key}`}
                                            className={`cohort-cell level-${level} ${cell.count ? 'has-value' : ''}`}
                                            onMouseMove={(event) => handleCellHover(event, row, cell, column)}
                                            onMouseEnter={(event) => handleCellHover(event, row, cell, column)}
                                        >
                                            {cell.count || ''}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {tooltip && (
                <div className="cohort-grid-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
                    <div className="cohort-grid-tooltip-title">{tooltip.row.label} · {tooltip.column.label}</div>
                    <div className="cohort-grid-tooltip-meta">Resolved epics: <strong>{tooltip.cell.count}</strong></div>
                    {(tooltip.cell.samples || []).map((sample) => (
                        <div key={`${sample.key}-${sample.terminalDate}`} className="cohort-grid-tooltip-item">
                            <strong>{sample.key}</strong>
                            <span>{sample.summary || 'No summary'}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default React.memo(CohortGrid);
