import * as React from 'react';
import SegmentedControl from '../ui/SegmentedControl.jsx';

export default function EngModeControl({
    activeMode,
    isCompletedSprintSelected,
    onChange,
    scenarioAvailable = true,
    selectedSprint,
}) {
    return (
        <SegmentedControl
            className="eng-mode-control"
            ariaLabel="ENG view mode"
            value={activeMode}
            onChange={onChange}
            containerProps={{ 'data-onboarding-target': 'eng-mode-control' }}
            options={[
                { value: 'catch-up', label: 'Catch Up', title: 'Return to default state' },
                {
                    value: 'planning',
                    label: 'Planning',
                    disabled: !selectedSprint || isCompletedSprintSelected,
                    title: 'Show sprint planning panel',
                },
                {
                    value: 'board',
                    label: 'Board',
                    title: 'Show the group board',
                },
                {
                    value: 'statistics',
                    label: 'Statistics',
                    title: 'Show sprint statistics',
                },
                // Locked Scenario (non-admin, workspace switch off) has no entry at all.
                ...(scenarioAvailable ? [{
                    value: 'scenario',
                    label: 'Scenario',
                    disabled: !selectedSprint || isCompletedSprintSelected,
                    title: 'Show scenario planner'
                }] : [])
            ]}
        />
    );
}
