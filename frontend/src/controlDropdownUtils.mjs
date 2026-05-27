export function getNextExclusiveDropdownState(kind, isOpen) {
    const next = {
        sprint: false,
        group: false,
        team: false,
        project: false,
        subGoal: false,
        sort: false
    };
    if (!kind) {
        return next;
    }
    next[kind] = !isOpen;
    return next;
}
