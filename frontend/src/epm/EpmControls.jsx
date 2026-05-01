import * as React from 'react';
import ControlField from '../ui/ControlField.jsx';
import SegmentedControl from '../ui/SegmentedControl.jsx';
import { getEpmProjectDisplayName, getEpmProjectIdentity } from './epmProjectUtils.mjs';

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
}) {
    if (selectedView !== 'epm') return null;

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

    return (
        <>
            {renderEpmTabs()}
            {renderEpmProjectPicker()}
        </>
    );
}
