import * as React from 'react';
import StackedBar from '../stats/StackedBar.jsx';
import { usePlanningAssigneeCapacityView } from './PlanningAssigneeCapacity.jsx';
import { buildAssigneeColorMap, buildUnderbar, formatHundredths, resolveAssigneeColor, UNDERBAR_UNASSIGNED_KEY } from './planningAssigneeCapacityModel.js';

const sp = hundredths => formatHundredths(hundredths);
const formatValue = value => sp(Math.round(value * 100));

// The thin per-person strip inside the capacity track. Reads the same view as the table (context) and appears
// only after the strip was expanded once. `barCapacity` is the Product/Tech-adjusted value the bar above shows.
function PlanningAssigneeCapacityBar({ barCapacity }) {
    const context = usePlanningAssigneeCapacityView();
    const opened = context?.opened, oneTeam = context?.oneTeam, view = context?.view, rawCapacity = context?.rawCapacity;
    const model = React.useMemo(() => (opened && oneTeam ? buildUnderbar(view, rawCapacity) : null), [opened, oneTeam, view, rawCapacity]);
    const colorMap = React.useMemo(() => buildAssigneeColorMap(view?.rows), [view]);
    const chart = React.useMemo(() => {
        if (!model) return null;
        const byKey = new Map(model.people.map(person => [person.key, person]));
        const segments = model.people.map(person => ({ key: person.key, value: person.capacityHundredths / 100 }));
        if (model.unassigned) segments.push({ key: UNDERBAR_UNASSIGNED_KEY, value: model.unassigned.totalHundredths / 100 });
        const differs = model.source === 'jira' && Number.isFinite(barCapacity) && Math.abs(barCapacity * 100 - model.denominatorHundredths) > 5;
        const note = differs ? `Jira capacity ${sp(model.denominatorHundredths)}; the bar shows ${formatValue(barCapacity)} after the Product/Tech split.` : '';
        return {
            rows: [{ id: 'assignee-capacity', label: 'Assignee capacity', total: model.denominatorHundredths / 100, segments }],
            order: segments.map(segment => segment.key),
            label: key => (key === UNDERBAR_UNASSIGNED_KEY ? model.unassigned.name : byKey.get(key)?.name || key),
            color: key => (key === UNDERBAR_UNASSIGNED_KEY ? 'var(--warn)' : resolveAssigneeColor(key, colorMap)),
            readout: ({ segmentKey }) => {
                const lines = segmentKey === UNDERBAR_UNASSIGNED_KEY
                    ? [model.unassigned.name, `Total ${sp(model.unassigned.totalHundredths)} · Selected ${sp(model.unassigned.selectedHundredths)}`]
                    : (person => [person.name, `Capacity ${sp(person.capacityHundredths)} · Selected ${sp(person.selectedHundredths)}`, `Total ${sp(person.totalHundredths)}`])(byKey.get(segmentKey));
                if (note) lines.push(note);
                return lines.map((line, index) => <React.Fragment key={index}>{index > 0 && <br />}{index === 0 ? <strong>{line}</strong> : line}</React.Fragment>);
            },
        };
    }, [model, barCapacity]);
    if (!chart) return null;
    return <div className="planning-assignee-underbar" data-assignee-underbar>
        <StackedBar rows={chart.rows} segmentOrder={chart.order} resolveColor={chart.color} resolveLabel={chart.label}
            formatValue={formatValue} formatReadout={chart.readout} variant="strip" ariaLabel="Assignee capacity by person" />
    </div>;
}

export default React.memo(PlanningAssigneeCapacityBar);
