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
    const frameRef = React.useRef(null);
    const tableRef = React.useRef(null);
    const [scale, setScale] = React.useState(1);
    const [scaledHeight, setScaledHeight] = React.useState(null);

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

    React.useLayoutEffect(() => {
        const measure = () => {
            const frame = frameRef.current;
            const table = tableRef.current;
            if (!frame || !table) return;
            if (wrapRef.current) {
                wrapRef.current.scrollLeft = 0;
            }
            const frameWidth = frame.clientWidth;
            const naturalWidth = table.scrollWidth;
            const naturalHeight = table.offsetHeight;
            if (!frameWidth || !naturalWidth || !naturalHeight) {
                setScale(1);
                setScaledHeight(null);
                return;
            }
            const safeFrameWidth = Math.max(0, frameWidth - 2);
            const nextScale = Math.min(1, safeFrameWidth / naturalWidth);
            setScale(nextScale);
            setScaledHeight(nextScale < 1 ? Math.ceil(naturalHeight * nextScale) : null);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('resize', measure);
        };
    }, [model]);

    const tooltipStatusCounts = tooltip?.cell?.statusCounts || {};
    const resolvedSegments = [
        { key: 'done', label: 'Done', count: Number(tooltipStatusCounts.done || 0) },
        { key: 'incomplete', label: 'Incomplete', count: Number(tooltipStatusCounts.incomplete || 0) },
        { key: 'killed', label: 'Killed', count: Number(tooltipStatusCounts.killed || 0) },
        { key: 'postponed', label: 'Postponed', count: Number(tooltipStatusCounts.postponed || 0) }
    ].filter((item) => item.count > 0);

    return (
        <div className="cohort-grid-wrap" ref={wrapRef} onMouseLeave={() => setTooltip(null)}>
            <div
                className={`cohort-grid-scale-frame ${scale < 1 ? 'is-scaled' : ''}`}
                ref={frameRef}
                style={scaledHeight ? { height: `${scaledHeight}px` } : undefined}
            >
                <div
                    className="cohort-grid-scale"
                    style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
                >
                    <table className="cohort-grid" ref={tableRef}>
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
                </div>
            </div>
            {tooltip && (
                <div className="cohort-grid-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
                    <div className="cohort-grid-tooltip-title">{tooltip.row.label} · {tooltip.column.label}</div>
                    <div className="cohort-grid-tooltip-meta">Resolved epics: <strong>{tooltip.cell.count}</strong></div>
                    {resolvedSegments.map((segment) => (
                        <div key={segment.key} className="cohort-grid-tooltip-item">
                            <strong>{segment.label}</strong>
                            <span>{segment.count}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default React.memo(CohortGrid);
