export function shouldUseEpmSprint(tab) {
    return String(tab || '').trim().toLowerCase() === 'active';
}

export function getEpmSprintHelper(tab) {
    return shouldUseEpmSprint(tab) ? '' : 'Active only';
}
