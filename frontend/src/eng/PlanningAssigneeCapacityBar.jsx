import * as React from 'react';
import StackedBar from '../stats/StackedBar.jsx';
import { usePlanningAssigneeCapacityView } from './PlanningAssigneeCapacity.jsx';
import { buildAssigneeColorMap, buildUnderbar, capacityBalanceText, formatHundredths, resolveAssigneeColor, UNDERBAR_UNASSIGNED_KEY } from './planningAssigneeCapacityModel.js';

const sp = hundredths => formatHundredths(hundredths);
const formatValue = value => sp(Math.round(value * 100));

// The strip's data, or null (no provider, several Teams, the document not loaded yet, or nothing selected).
// `barCapacity` is the Product/Tech-adjusted totalCapacityAdjusted. With one Team it equals the raw team number times the
// Product/Tech share, derived here only for the readout's source line; segments are the table's Planned capacity and
// Estimated effort and are never scaled.
export function useAssigneeUnderbar(barCapacity) {
    const context = usePlanningAssigneeCapacityView();
    const loaded = context?.loaded, oneTeam = context?.oneTeam, view = context?.view, rawCapacity = context?.rawCapacity, capacitySource = context?.capacitySource;
    return React.useMemo(() => {
        const model = loaded && oneTeam ? buildUnderbar(view) : null;
        if (!model) return null;
        const share = Number(rawCapacity) > 0 && barCapacity > 0 ? barCapacity / Number(rawCapacity) : 1;
        return { model, share, capacitySource, colorMap: buildAssigneeColorMap(view?.rows) };
    }, [loaded, oneTeam, view, rawCapacity, capacitySource, barCapacity]);
}

const percentOf = (part, whole) => `${whole > 0 ? Math.round((part / whole) * 100) : 0}% of Selected`;

// The thin per-person strip inside the capacity track, on the bar's own `axis` (which includes the strip's total): each
// person is max(Planned capacity, Estimated effort) wide in two layers of their colour, tinted capacity and solid effort
// (underbarLayers decides which lies on top), then Unassigned effort. The wrapper covers the whole track and takes the
// pointer, so the readout follows the segment under the pointer's x (a header-only readout past the last segment).
function PlanningAssigneeCapacityBar({ underbar, axis, selectedCount, selectedSP }) {
    const chart = React.useMemo(() => {
        const { model, share, capacitySource, colorMap } = underbar;
        const byKey = new Map(model.people.map(person => [person.key, person]));
        const segments = model.people.map(person => ({
            key: person.key, value: person.widthHundredths / 100, tint: person.base === 'tint',
            overlay: person.overlay ? { value: person.overlay.hundredths / 100, tint: person.overlay.tone === 'tint' } : null,
        }));
        if (model.unassigned) segments.push({ key: UNDERBAR_UNASSIGNED_KEY, value: model.unassigned.selectedHundredths / 100 });
        const header = `Selected ${selectedCount} tasks · ${selectedSP.toFixed(1)} SP`;
        const split = Math.abs(share - 1) > 0.001 ? ` · ${Math.round(share * 100)}% share` : '';
        // The team number's source: the Jira ticket, or the stored "Team capacity (not in Jira)".
        const source = `${capacitySource === 'planned' ? 'Team capacity (not in Jira)' : 'Team capacity: Jira'}${split}`;
        const segmentLines = segmentKey => {
            if (segmentKey === null) return [header];
            if (segmentKey === UNDERBAR_UNASSIGNED_KEY) return [header, model.unassigned.name, `Selected ${sp(model.unassigned.selectedHundredths)}`, percentOf(model.unassigned.selectedHundredths, model.selectedHundredths), source];
            const person = byKey.get(segmentKey);
            const capacity = person.capacityHundredths > 0 ? person.capacityHundredths : null;
            return [header, person.name, `Estimated effort ${sp(person.selectedHundredths)}`,
                ...(capacity ? [`Planned capacity ${sp(capacity)}`, capacityBalanceText(capacity, person.selectedHundredths)] : []), source];
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
    }, [underbar, axis, selectedCount, selectedSP]);
    return <div className="planning-assignee-underbar" data-assignee-underbar>
        <StackedBar rows={chart.rows} segmentOrder={chart.order} resolveColor={chart.color} resolveLabel={chart.label}
            formatValue={formatValue} formatReadout={chart.readout} readoutLineCount={chart.lineCount} variant="strip" ariaLabel="Planned capacity and effort by person" />
    </div>;
}

export default React.memo(PlanningAssigneeCapacityBar);
