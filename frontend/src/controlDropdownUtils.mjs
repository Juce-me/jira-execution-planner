export function getNextExclusiveDropdownState(kind, isOpen) {
    const next = {
        sprint: false,
        group: false,
        team: false
    };
    if (!kind) {
        return next;
    }
    next[kind] = !isOpen;
    return next;
}
