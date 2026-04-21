export function shouldUseEpmSprint(tab) {
    return String(tab || '').trim().toLowerCase() === 'active';
}

export function getEpmSprintHelper(tab) {
    return shouldUseEpmSprint(tab) ? '' : 'Active only';
}

export function filterEpmProjectsForTab(projects, tab) {
    const normalizedTab = String(tab || 'active').trim().toLowerCase();
    return Array.isArray(projects)
        ? projects.filter((project) => String(project?.tabBucket || '').trim().toLowerCase() === normalizedTab)
        : [];
}

export function getEpmProjectDisplayName(project) {
    return String(
        project?.displayName ||
        project?.customName ||
        project?.name ||
        project?.homeProjectId ||
        ''
    ).trim();
}
