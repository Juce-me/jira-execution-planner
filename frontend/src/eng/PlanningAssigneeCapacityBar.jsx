import * as React from 'react';
import StackedBar from '../stats/StackedBar.jsx';
import { usePlanningAssigneeCapacityView } from './PlanningAssigneeCapacity.jsx';
import { buildAssigneeColorMap, buildUnderbar, formatHundredths, resolveAssigneeColor, underbarOnBarAxis, UNDERBAR_UNASSIGNED_KEY } from './planningAssigneeCapacityModel.js';

const sp = hundredths => formatHundredths(hundredths);
const formatValue = value => sp(Math.round(value * 100));

// The strip's data on the amber bar's axis, or null (no provider, several Teams, or the document not loaded yet).
// `barCapacity` is the Product/Tech-adjusted totalCapacityAdjusted. With one Team it equals the raw Jira number times
// the Product/Tech multiplier, so the multiplier is derived here instead of threading it through the dashboard.
export function useAssigneeUnderbar(barCapacity) {
    const context = usePlanningAssigneeCapacityView();
    const loaded = context?.loaded, oneTeam = context?.oneTeam, view = context?.view, rawCapacity = context?.rawCapacity;
    return React.useMemo(() => {
        const model = loaded && oneTeam ? buildUnderbar(view, rawCapacity) : null;
        if (!model) return null;
        const multiplier = Number(rawCapacity) > 0 && barCapacity > 0 ? barCapacity / Number(rawCapacity) : 1;
        return { model, multiplier, colorMap: buildAssigneeColorMap(view?.rows), ...underbarOnBarAxis(model, barCapacity, multiplier) };
    }, [loaded, oneTeam, view, rawCapacity, barCapacity]);
}

// The thin per-person strip inside the capacity track, on the bar's own `axis`: the wrapper covers the whole track and
// takes the pointer, so the readout follows the segment under the pointer's x (a header-only readout past the last
// segment). `showOverflow` is false while the bar draws its own over-capacity zone; compact mode draws no label.
function PlanningAssigneeCapacityBar({ underbar, axis, teamCapPct, selectedCount, selectedSP, showOverflow, compact }) {
    const chart = React.useMemo(() => {
        const { model, multiplier, colorMap, people, unassignedValue, overflowHundredths } = underbar;
        const byKey = new Map(people.map(person => [person.key, person]));
        const segments = people.map(person => ({ key: person.key, value: person.value }));
        if (model.unassigned) segments.push({ key: UNDERBAR_UNASSIGNED_KEY, value: unassignedValue });
        const header = `Selected ${selectedCount} tasks · ${selectedSP.toFixed(1)} SP`;
        const split = Math.abs(multiplier - 1) > 0.001 ? ` · ${Math.round(multiplier * 100)}% share` : '';
        const source = `Team capacity: Jira${split}`;
        const overflowLine = showOverflow ? `+${sp(overflowHundredths)} SP over Team Cap` : '';
        const segmentLines = segmentKey => {
            if (segmentKey === null) return [header];
            const body = segmentKey === UNDERBAR_UNASSIGNED_KEY
                ? [model.unassigned.name, `Total ${sp(model.unassigned.totalHundredths)} · Selected ${sp(model.unassigned.selectedHundredths)}`]
                : (person => [person.name, `Capacity ${sp(person.capacityHundredths)} · Selected ${sp(person.selectedHundredths)}`, `Total ${sp(person.totalHundredths)}`])(byKey.get(segmentKey));
            return [header, ...body, overflowLine, source].filter(Boolean);
        };
        return {
            rows: [{ id: 'assignee-capacity', label: 'Assignee capacity', total: axis, segments }],
            order: segments.map(segment => segment.key),
            label: key => (key === UNDERBAR_UNASSIGNED_KEY ? model.unassigned.name : byKey.get(key)?.name || key),
            color: key => (key === UNDERBAR_UNASSIGNED_KEY ? 'var(--warn)' : resolveAssigneeColor(key, colorMap)),
            lineCount: ({ segmentKey }) => segmentLines(segmentKey).length,
            readout: ({ segmentKey }) => segmentLines(segmentKey).map((line, index) => (
                <React.Fragment key={index}>{index > 0 && <br />}{index < (segmentKey === null ? 1 : 2) ? <strong>{line}</strong> : line}</React.Fragment>
            )),
        };
    }, [underbar, axis, selectedCount, selectedSP, showOverflow]);
    return <div className="planning-assignee-underbar" data-assignee-underbar>
        <StackedBar rows={chart.rows} segmentOrder={chart.order} resolveColor={chart.color} resolveLabel={chart.label}
            formatValue={formatValue} formatReadout={chart.readout} readoutLineCount={chart.lineCount} variant="strip" ariaLabel="Assignee capacity by person" />
        {showOverflow && <div className="planning-assignee-overflow" data-assignee-overflow style={{ left: `${teamCapPct}%`, width: `${(underbar.overflow / axis) * 100}%` }}>
            {!compact && <span className="capacity-bar-fill-label">+{sp(underbar.overflowHundredths)} SP over</span>}
        </div>}
    </div>;
}

export default React.memo(PlanningAssigneeCapacityBar);
