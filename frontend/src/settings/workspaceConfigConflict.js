export const rebaseWorkspaceConfigSave = (payload, conflict) => ({
    ...(payload || {}),
    baseRevision: Number(conflict?.currentRevision || 0),
});

const SECTION_LABELS = [
    ['projects', 'Scope projects'],
    ['priorityWeights', 'Priority weights'],
    ['board', 'Jira board'],
    ['capacity', 'Capacity'],
    ['fieldConfigs', 'Field mapping'],
    ['issueTypes', 'Issue types'],
    ['epm', 'EPM settings'],
];

export const committedWorkspaceSectionLabels = (committed = {}) => SECTION_LABELS
    .filter(([key]) => Boolean(committed?.[key]))
    .map(([, label]) => label);

export const workspaceConfigConflictMessages = (conflict) => {
    if (!conflict) return [];
    const saved = conflict.savedSections || [];
    const pending = conflict.pendingSections || [];
    return [
        'Shared settings changed while you were editing. Your changes are still unsaved.',
        saved.length ? `Already saved: ${saved.join(', ')}.` : 'No shared sections were saved.',
        pending.length ? `Still unsaved: ${pending.join(', ')}.` : '',
    ].filter(Boolean);
};
