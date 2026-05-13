import * as React from 'react';
import ControlField from '../ui/ControlField.jsx';
import SegmentedControl from '../ui/SegmentedControl.jsx';
import {
    getEpmSubGoalDisplayParts,
    getEpmProjectDisplayName,
    getEpmProjectIdentity,
    getNextEpmSubGoalSelection,
    normalizeEpmScopeSubGoalKeys,
} from './epmProjectUtils.mjs';

const epmTabOptions = [
    { value: 'active', label: 'Active' },
    { value: 'backlog', label: 'Backlog' },
    { value: 'archived', label: 'Archived' }
];

export function EpmControls({
    selectedView,
    epmTab,
    setEpmTab,
    surface = 'main',
    showProjectPicker = true,
    epmProjectsLoading,
    visibleEpmProjects,
    selectedEpmProject,
    filteredEpmProjects,
    showEpmProjectDropdown,
    activeControlSurface,
    applyExclusiveDropdownState,
    epmProjectDropdownRefs,
    epmProjectSearch,
    setEpmProjectSearch,
    setEpmSelectedProjectId,
    setShowEpmProjectDropdown,
    savedEpmSubGoalKeys = [],
    epmSubGoalOptions = [],
    selectedEpmSubGoalKeys = [],
    setEpmSelectedSubGoalKeys,
    showEpmSubGoalDropdown,
    setShowEpmSubGoalDropdown,
    epmSubGoalFilterDropdownRefs,
}) {
    if (selectedView !== 'epm') return null;
    const savedSubGoalKeys = normalizeEpmScopeSubGoalKeys({ subGoalKeys: savedEpmSubGoalKeys });
    const selectedSubGoalKeys = normalizeEpmScopeSubGoalKeys({ subGoalKeys: selectedEpmSubGoalKeys })
        .filter(key => savedSubGoalKeys.includes(key));

    const renderEpmTabs = () => (
        <SegmentedControl
            className="epm-state-control"
            ariaLabel="EPM project state"
            value={epmTab}
            onChange={setEpmTab}
            options={epmTabOptions}
        />
    );

    const renderEpmProjectPicker = () => {
        if (!showProjectPicker) return null;
        const isDisabled = epmProjectsLoading || visibleEpmProjects.length === 0;
        const selectedProjectName = selectedEpmProject
            ? getEpmProjectDisplayName(selectedEpmProject)
            : 'All projects';
        return (
            <ControlField label="Project">
                <div className="sprint-dropdown epm-project-dropdown" ref={(node) => { epmProjectDropdownRefs.current[surface] = node; }}>
                    <div
                        className={`sprint-dropdown-toggle ${showEpmProjectDropdown ? 'open' : ''}`}
                        role="button"
                        aria-label="Select Project"
                        tabIndex={isDisabled ? -1 : 0}
                        onClick={() => {
                            if (isDisabled) return;
                            applyExclusiveDropdownState('project', showEpmProjectDropdown);
                        }}
                        onKeyDown={(event) => {
                            if (isDisabled) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                applyExclusiveDropdownState('project', showEpmProjectDropdown);
                            }
                        }}
                        aria-disabled={isDisabled}
                    >
                        <span>{epmProjectsLoading ? 'Loading...' : selectedProjectName}</span>
                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                            <path d="M6 9L1 4h10z"/>
                        </svg>
                    </div>
                    {showEpmProjectDropdown && surface === activeControlSurface && (
                        <div className="sprint-dropdown-panel">
                            <input
                                type="text"
                                className="sprint-dropdown-search"
                                placeholder="Filter..."
                                value={epmProjectSearch}
                                onChange={(event) => setEpmProjectSearch(event.target.value)}
                                aria-label="Filter Projects"
                            />
                            <div className="sprint-dropdown-list">
                                <div
                                    className="sprint-dropdown-option"
                                    data-project-id=""
                                    onClick={() => {
                                        setEpmSelectedProjectId('');
                                        setShowEpmProjectDropdown(false);
                                        setEpmProjectSearch('');
                                    }}
                                >
                                    All projects
                                </div>
                                {filteredEpmProjects.length === 0 ? (
                                    <div className="sprint-dropdown-option">No projects available</div>
                                ) : (
                                    filteredEpmProjects.map((project) => {
                                        const projectId = getEpmProjectIdentity(project);
                                        return (
                                            <div
                                                key={projectId}
                                                className="sprint-dropdown-option"
                                                data-project-id={projectId}
                                                onClick={() => {
                                                    setEpmSelectedProjectId(projectId);
                                                    setShowEpmProjectDropdown(false);
                                                    setEpmProjectSearch('');
                                                }}
                                            >
                                                {getEpmProjectDisplayName(project)}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </ControlField>
        );
    };

    const renderEpmSubGoalPicker = () => {
        if (savedSubGoalKeys.length <= 1) return null;
        const selectedSet = new Set(selectedSubGoalKeys);
        const narrowed = selectedSubGoalKeys.length > 0 && selectedSubGoalKeys.length < savedSubGoalKeys.length;
        const optionByKey = new Map((epmSubGoalOptions || []).map((goal) => [
            String(goal?.key || '').trim().toUpperCase(),
            goal,
        ]));
        (visibleEpmProjects || []).forEach((project) => {
            (Array.isArray(project?.subGoals) ? project.subGoals : []).forEach((goal) => {
                const key = String(goal?.key || '').trim().toUpperCase();
                if (key && !optionByKey.has(key)) {
                    optionByKey.set(key, goal);
                }
            });
        });
        const getSubGoalDisplay = (key) => getEpmSubGoalDisplayParts(optionByKey.get(key), key);
        const selectedSubGoalDisplay = selectedSubGoalKeys.length === 1 ? getSubGoalDisplay(selectedSubGoalKeys[0]) : null;
        const label = selectedSubGoalDisplay
            ? selectedSubGoalDisplay.name
            : narrowed
                ? `${selectedSubGoalKeys.length} sub-goals`
                : 'All sub-goals';
        return (
            <ControlField label="Sub-goals">
                <div className="sprint-dropdown epm-subgoal-dropdown" ref={(node) => { epmSubGoalFilterDropdownRefs.current[surface] = node; }}>
                    <div
                        className={`sprint-dropdown-toggle ${showEpmSubGoalDropdown ? 'open' : ''}`}
                        role="button"
                        aria-label="Filter EPM sub-goals"
                        tabIndex={0}
                        onClick={() => applyExclusiveDropdownState('subGoal', showEpmSubGoalDropdown)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                applyExclusiveDropdownState('subGoal', showEpmSubGoalDropdown);
                            }
                        }}
                    >
                        <span>{label}</span>
                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                            <path d="M6 9L1 4h10z"/>
                        </svg>
                    </div>
                    {showEpmSubGoalDropdown && surface === activeControlSurface && (
                        <div className="sprint-dropdown-panel">
                            <div className="sprint-dropdown-list">
                                <div
                                    className="sprint-dropdown-option epm-subgoal-all-option"
                                    data-sub-goal-key=""
                                    onClick={() => {
                                        setEpmSelectedSubGoalKeys([]);
                                        setShowEpmSubGoalDropdown(false);
                                    }}
                                >
                                    All sub-goals
                                </div>
                                {savedSubGoalKeys.map((key) => {
                                    const checked = selectedSet.has(key) || !narrowed;
                                    const display = getSubGoalDisplay(key);
                                    return (
                                        <div
                                            key={key}
                                            className="sprint-dropdown-option"
                                            data-sub-goal-key={key}
                                            onClick={() => {
                                                setEpmSelectedSubGoalKeys(getNextEpmSubGoalSelection(savedSubGoalKeys, selectedSubGoalKeys, key));
                                            }}
                                        >
                                            <input type="checkbox" readOnly checked={checked} tabIndex={-1} />
                                            <span className="epm-subgoal-option-copy">
                                                <span className="epm-subgoal-option-name">{display.name}</span>
                                                {display.key && display.name !== display.key && (
                                                    <span className="epm-subgoal-option-key">{display.key}</span>
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </ControlField>
        );
    };

    return (
        <>
            {renderEpmSubGoalPicker()}
            {renderEpmProjectPicker()}
            {renderEpmTabs()}
        </>
    );
}
