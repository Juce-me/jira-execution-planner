const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Server-renders the REAL ENG alerts panel with one team group in each of its eleven group lists (the Postponed card has two: Stories and
// future-routed Epics). `ids` and `names` override a list's group id and display name by prop name, `moreGroups` appends groups with the given ids
// to a list (adjacent groups sit 0.6rem apart), `collapsed` names the categories whose card starts collapsed.
const DEFAULT_IDS = {
    missingAlertTeams: 't1', blockedAlertTeams: 't2', postponedAlertTeams: 't3', postponedEpicTeams: 't3', backlogEpicTeams: 't4', missingTeamEpicTeams: 't5',
    missingLabelEpicTeams: 't6', needsStoriesTeams: 't7', analysisEpicTeams: 't8', emptyEpicTeams: 't9', doneEpicTeams: 't10',
};
const COLLAPSIBLE = {
    missing: 'showMissingAlert', blocked: 'showBlockedAlert', followup: 'showPostponedAlert', backlog: 'showBacklogAlert', missingTeam: 'showMissingTeamAlert',
    missingLabels: 'showMissingLabelsAlert', needsStories: 'showNeedsStoriesAlert', waiting: 'showWaitingAlert', empty: 'showEmptyEpicAlert', done: 'showDoneEpicAlert',
};
const SETTERS = ['setShowBacklogAlert', 'setShowBlockedAlert', 'setShowDoneEpicAlert', 'setShowEmptyEpicAlert', 'setShowMissingAlert', 'setShowMissingLabelsAlert',
    'setShowMissingTeamAlert', 'setShowNeedsStoriesAlert', 'setShowPostponedAlert', 'setShowWaitingAlert', 'dismissAlertItem', 'dismissStoryRequirement',
    'handleAlertStoryClick', 'handleStoryRequirementClick'];

let panel;
function loadPanel() {
    if (!panel) {
        const entry = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx');
        const code = esbuild.buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' } }).outputFiles[0].text;
        const loaded = { exports: {} };
        new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
        panel = loaded.exports.default;
    }
    return panel;
}

function renderAlertsPanel({ collapsed = [], ids = {}, names = {}, moreGroups = {} } = {}) {
    const id = { ...DEFAULT_IDS, ...ids };
    const epic = (key, teamId) => ({ key, summary: `Synthetic epic ${key}`, status: { name: 'To Do' }, cleanupStoryCount: 0, teamId, teamName: teamId });
    const story = key => ({ key, fields: { summary: `Synthetic story ${key}` } });
    const group = (listName, items) => ({ id: id[listName], name: names[listName] ?? `Team ${id[listName]}`, items });
    const groups = (listName, items) => [group(listName, items), ...(moreGroups[listName] || []).map(extra => ({ id: extra, name: `Team ${extra}`, items }))];
    const alertProps = {
        consolidatedMissingStories: [{ task: story('S-1'), missingFields: ['Story Points'] }],
        missingAlertTeams: groups('missingAlertTeams', [{ task: story('S-1'), missingFields: ['Story Points'] }]),
        blockedTasks: [story('S-2')], blockedAlertTeams: groups('blockedAlertTeams', [story('S-2')]),
        postponedTasks: [story('S-3')], postponedAlertTeams: groups('postponedAlertTeams', [story('S-3')]),
        futureRoutedEpics: [epic('E-3', id.postponedEpicTeams)], postponedEpicTeams: groups('postponedEpicTeams', [epic('E-3', id.postponedEpicTeams)]),
        backlogEpics: [epic('E-4', 'a')], backlogEpicTeams: groups('backlogEpicTeams', [epic('E-4', 'a')]),
        missingTeamEpics: [epic('E-5', 'a')], missingTeamEpicTeams: groups('missingTeamEpicTeams', [epic('E-5', 'a')]),
        missingLabelEpics: [epic('E-6', 'a')], missingLabelEpicTeams: groups('missingLabelEpicTeams', [epic('E-6', 'a')]),
        needsStoriesEntries: [{ id: 'n1' }], needsStoriesEpics: [epic('E-7', 'a')], needsStoriesTeams: groups('needsStoriesTeams', [{ id: 'n1', epic: epic('E-7', 'a'), reason: 'none' }]),
        waitingForStoriesEpics: [epic('E-8', 'a')], analysisEpicTeams: groups('analysisEpicTeams', [epic('E-8', 'a')]),
        emptyEpics: [epic('E-9', 'a')], emptyEpicsForAlert: [epic('E-9', 'a')], emptyEpicTeams: groups('emptyEpicTeams', [epic('E-9', 'a')]),
        doneStoryEpics: [epic('E-10', 'a')], doneEpicTeams: groups('doneEpicTeams', [epic('E-10', 'a')]),
        buildKeyListLink: () => '#', buildTeamStatusLink: () => '#', getBlockedAlertStatusLabel: () => '', getFuturePlanningNeedsStoriesReasonText: () => '',
        isFutureSprintSelected: false, storyReadinessSprintState: 'active', jiraUrl: 'https://jira.example.test',
    };
    for (const name of SETTERS) alertProps[name] = () => {};
    for (const [category, flag] of Object.entries(COLLAPSIBLE)) alertProps[flag] = !collapsed.includes(category);
    return renderToStaticMarkup(React.createElement(loadPanel(), {
        selectedView: 'eng', alertItemCount: 11, alertCounts: {}, showAlertsPanel: true, setShowAlertsPanel: () => {}, collapsed: false, alertProps,
    }));
}

module.exports = { renderAlertsPanel };
