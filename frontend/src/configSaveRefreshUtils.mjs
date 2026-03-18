export function getConfigSaveRefreshTarget({ selectedSprint, showScenario }) {
    if (!selectedSprint) {
        return 'none';
    }
    return showScenario ? 'scenario' : 'tasks';
}
