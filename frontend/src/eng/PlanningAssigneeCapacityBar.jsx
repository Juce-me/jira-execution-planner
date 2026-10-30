import * as React from 'react';
import StackedBar from '../stats/StackedBar.jsx';
import { usePlanningAssigneeCapacityView } from './PlanningAssigneeCapacity.jsx';
import { buildAssigneeColorMap, buildUnderbar, formatHundredths, resolveAssigneeColor, UNDERBAR_UNASSIGNED_KEY } from './planningAssigneeCapacityModel.js';

const sp = hundredths => formatHundredths(hundredths);
const formatValue = value => `${sp(Math.round(value * 100))} SP`;

// Per-person capacity bar under the one-Team card's bar: the shared StackedBar, unmodified, like ProjectTrackTotalsBar.
// Reads the same view as the table (context) and appears only after the strip was expanded once. `barCapacity` is the
// Product/Tech-adjusted capacity the card's bar uses (null without a capacity ticket).
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
        let note = '';
        if (model.source === 'jira') {
            if (model.denominatorHundredths > model.rawHundredths) note = `Jira capacity ${sp(model.rawHundredths)}; the bar spans the allocated ${sp(model.denominatorHundredths)}.`;
            else if (Number.isFinite(barCapacity) && Math.abs(barCapacity * 100 - model.rawHundredths) > 5) note = `Jira capacity ${sp(model.rawHundredths)}; the team bar shows ${sp(Math.round(barCapacity * 100))} after the Product/Tech split.`;
        }
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
    return <div data-assignee-bar>
        <StackedBar rows={chart.rows} segmentOrder={chart.order} resolveColor={chart.color} resolveLabel={chart.label}
            formatValue={formatValue} formatReadout={chart.readout} ariaLabel="Assignee capacity by person" />
    </div>;
}

export default React.memo(PlanningAssigneeCapacityBar);
