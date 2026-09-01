import * as React from 'react';
import SegmentedControl from '../ui/SegmentedControl.jsx';

export default function EngModeControl({
    activeMode,
    isCompletedSprintSelected,
    isFutureSprintSelected,
    onChange,
    selectedSprint,
}) {
    return (
        <SegmentedControl
            className="eng-mode-control"
            ariaLabel="ENG view mode"
            value={activeMode}
            onChange={onChange}
            options={[
                { value: 'catch-up', label: 'Catch Up', title: 'Return to default state' },
                {
                    value: 'planning',
                    label: 'Planning',
                    disabled: !selectedSprint || isCompletedSprintSelected,
                    title: 'Show sprint planning panel',
                    domProps: { 'data-onboarding-target': 'planning-launcher' },
                },
                {
                    value: 'board',
                    label: 'Board',
                    title: 'Show the group board',
                    domProps: { 'data-onboarding-target': 'board-launcher' },
                },
                {
                    value: 'statistics',
                    label: 'Statistics',
                    disabled: isFutureSprintSelected,
                    title: 'Show sprint statistics',
                    domProps: { 'data-onboarding-target': 'statistics-launcher' },
                },
                {
                    value: 'scenario',
                    label: 'Scenario',
                    disabled: !selectedSprint || isCompletedSprintSelected,
                    title: 'Show scenario planner'
                }
            ]}
        />
    );
}
