// Harness entry for work_structure_one_lane.spec.js: mounts the REAL ENG components and the REAL data hook
// with model props injected through `window.__oneLane`. The dashboard composition does not pass the work
// model yet, so this is the narrowest honest way to exercise them in a browser. Synthetic data only.
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import EngFilterBar from '../../frontend/src/eng/EngFilterBar.jsx';
import PlanningProjectSplitBar from '../../frontend/src/eng/PlanningProjectSplitBar.jsx';
import EngAlertsPanel from '../../frontend/src/eng/EngAlertsPanel.jsx';
import { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } from '../../frontend/src/eng/engCatchUpFilters.js';
import { resolveEntityNames } from '../../frontend/src/eng/engWorkModel.js';
import { buildSelectedProjectStats, buildExcludedProjectStats, buildSelectedPlanningTasksList } from '../../frontend/src/eng/planningSelectionStats.js';
import { buildSelectedProjectEntries } from '../../frontend/src/eng/planningCapacityUtils.js';
import { classifyCapacityIssue } from '../../frontend/src/capacityClassification.mjs';
import { useEngSprintData } from '../../frontend/src/eng/useEngSprintData.js';

const task = (key, sp, epicKey) => ({
    key, fields: { customfield_10004: sp, epicKey, projectKey: 'PLAN', teamId: 'team-a', teamName: 'Team A', status: { name: 'To Do' }, priority: { name: 'Medium' } },
});
const normalize = value => String(value || '').trim().toUpperCase();

function AlertsHarness({ workModel }) {
    const epic = { key: 'PLAN-I1', summary: 'Synthetic parent', status: { name: 'To Do' }, teamName: 'Team A', teamId: 'team-a' };
    const group = [{ id: 'team-a', name: 'Team A', items: [epic] }];
    const noop = () => {};
    const alertProps = {
        analysisEpicTeams: [], backlogEpicTeams: group, backlogEpics: [epic], blockedAlertTeams: [], blockedTasks: [],
        buildKeyListLink: () => '', consolidatedMissingStories: [], dismissAlertItem: noop, doneEpicTeams: [], doneStoryEpics: [],
        emptyEpicTeams: group, emptyEpics: [epic], emptyEpicsForAlert: [epic], futureRoutedEpics: [], getBlockedAlertStatusLabel: () => '',
        getFuturePlanningNeedsStoriesReasonText: () => '', handleAlertStoryClick: noop, handleStoryRequirementClick: noop,
        dismissStoryRequirement: noop, isFutureSprintSelected: true, storyReadinessSprintState: 'future', jiraUrl: '',
        missingAlertTeams: [], missingLabelEpicTeams: group, missingLabelEpics: [epic], missingTeamEpicTeams: group, missingTeamEpics: [epic],
        needsStoriesEntries: [], needsStoriesEpics: [], needsStoriesTeams: [], postponedAlertTeams: [], postponedEpicTeams: [], postponedTasks: [],
        waitingForStoriesEpics: [],
        setShowBacklogAlert: noop, setShowBlockedAlert: noop, setShowDoneEpicAlert: noop, setShowEmptyEpicAlert: noop, setShowMissingAlert: noop,
        setShowMissingLabelsAlert: noop, setShowMissingTeamAlert: noop, setShowNeedsStoriesAlert: noop, setShowPostponedAlert: noop, setShowWaitingAlert: noop,
        showBacklogAlert: true, showBlockedAlert: true, showDoneEpicAlert: true, showEmptyEpicAlert: true, showMissingAlert: true,
        showMissingLabelsAlert: true, showMissingTeamAlert: true, showNeedsStoriesAlert: true, showPostponedAlert: true, showWaitingAlert: true,
    };
    return (
        <EngAlertsPanel
            workModel={workModel} selectedView="eng" alertItemCount={4}
            alertCounts={{ backlog: 1, missingTeam: 1, missingLabels: 1, empty: 1 }}
            showAlertsPanel setShowAlertsPanel={noop} collapsed={false} alertProps={alertProps}
        />
    );
}

function FiltersHarness({ workModel }) {
    const tasks = [task('PLAN-E1', 8, 'PLAN-I1')];
    const model = React.useMemo(() => buildEngCatchUpFacetModel({ tasks, isTechTask: () => false, names: resolveEntityNames(workModel) }), [workModel]);
    const resolved = React.useMemo(() => resolveEngCatchUpFilters({ model }), [model]);
    return (
        <EngFilterBar
            facets={resolved.facets} selection={resolved.selection} counts={resolved.counts} scopeTotal={resolved.scopeTotal}
            subject={resolved.subject} readoutCount={tasks.length} readoutUnit={resolved.readoutUnit} onChange={() => {}} onClearAll={() => {}}
        />
    );
}

function SplitHarness({ workModel, pair, compact }) {
    const tasks = [task('PLAN-E1', 8, 'PLAN-I1')];
    const excluded = new Set(pair === 'excluded' ? ['PLAN-I1'] : []);
    const adHoc = new Set(pair === 'ad_hoc' ? ['PLAN-I1'] : []);
    const planning = buildSelectedPlanningTasksList(tasks, excluded, normalize);
    const stats = buildSelectedProjectStats(planning, new Set(), adHoc, workModel);
    const entries = buildSelectedProjectEntries({ showPlanning: true, selectedProjectStats: stats, capacityEnabled: false, projectCapacity: {} });
    const adHocSp = planning.reduce((sum, item) => sum + (classifyCapacityIssue(item, { techProjectKeys: new Set(), adHocEpicSet: adHoc, workModel }).capacityType === 'ad_hoc' ? 8 : 0), 0);
    return (
        <PlanningProjectSplitBar
            workModel={workModel} compact={compact} selectedProjectEntries={entries} adHocProductSP={adHocSp}
            excludedProjectStats={buildExcludedProjectStats(tasks, excluded, new Set(), normalize, workModel)}
        />
    );
}

const roots = new Map();
window.__oneLane = {
    mount(kind, props) {
        const host = document.getElementById(kind);
        roots.get(kind)?.unmount();
        const root = createRoot(host);
        roots.set(kind, root);
        const Component = { alerts: AlertsHarness, filters: FiltersHarness, split: SplitHarness }[kind];
        root.render(<Component {...props} />);
    },
    // The real hook, rendered once inside a detached React root (it owns state); hand-driving the returned closures
    // counts the requests it really makes.
    sprintData(workModel) {
        const sprintLoadRef = { current: { sprintId: null, product: false, tech: false } };
        const lastLoadedSprintRef = { current: null };
        const state = { techLoaded: [], techTasks: [], productTasks: [] };
        const noop = () => {};
        const props = {
            workModel, backendUrl: '', selectedSprint: '1', activeGroupId: 'g', activeGroupTeamIds: ['t'], activeGroupTeamSet: new Set(['t']),
            pageLoadRefreshRef: { current: false }, sprintLoadRef, lastLoadedSprintRef, registerSprintFetch: () => new AbortController(),
            cleanupSprintFetch: noop, isFutureSprintSelected: true, loadedProductTasks: [], loadedTechTasks: [],
            setLoading: noop, setError: noop, setEpicDetails: noop, setProductTasks: value => state.productTasks.push(value), setTechTasks: value => state.techTasks.push(value),
            setLoadedProductTasks: noop, setLoadedTechTasks: value => state.techTasks.push(value), setTasksFetched: noop,
            setTechLoaded: value => state.techLoaded.push(value), setProductTasksLoading: noop, setTechTasksLoading: noop,
            setProductEpicsInScope: noop, setTechEpicsInScope: noop, setReadyToCloseProductTasks: noop, setReadyToCloseTechTasks: noop,
            setReadyToCloseProductEpicsInScope: noop, setReadyToCloseTechEpicsInScope: noop,
        };
        let api;
        function Probe() { const result = useEngSprintData(props); if (!api) api = result; return null; }
        flushSync(() => createRoot(document.createElement('div')).render(<Probe />));
        return { api, state, lastLoadedSprintRef };
    },
};
