export const DEFAULT_EPM_LABEL_PREFIX = 'rnd_project_';

export const createEmptyEpmConfigDraft = () => ({
    version: 2,
    labelPrefix: DEFAULT_EPM_LABEL_PREFIX,
    scope: { rootGoalKey: '', subGoalKeys: [] },
    projects: {}
});
