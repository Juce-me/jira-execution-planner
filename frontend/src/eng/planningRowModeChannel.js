// The Planning table owns its Epics/Stories rows as local state that resets to Epics on every mount (reload, Sprint switch,
// Table layout); the assignee capacity strip renders in another subtree. This channel carries the signals between them
// (#323): the mounted table publishes the mode it shows (null once unmounted), whether that mode was chosen (a click on the
// control or a link's rows) rather than the mount default, and its quiet setter; the strip asks that setter for Stories.
// Nothing is stored beyond the mounted table's mode, and no path here emits analytics.
let mode = null;
let chosen = false;
let switchRows = null;
const listeners = new Set();

export const getPlanningRowMode = () => mode;

export function publishPlanningRowMode(next, { setter = null, chosen: isChosen = false } = {}) {
    const previous = mode;
    mode = next || null;
    chosen = Boolean(mode && isChosen);
    switchRows = mode ? setter : null;
    if (mode !== previous) listeners.forEach(listener => listener(mode, previous));
}

export function subscribePlanningRowMode(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function requestPlanningStories() {
    if (mode === 'epic' && switchRows) switchRows('story');
}

// One strip's side of the loop "Epics selected -> strip collapsed; expanding the strip -> Stories selected". `setOpen`
// reports whether the strip is shown expanded; `byUser` marks the header toggle's own expansion, which asks for Stories.
// When the strip is open and the table shows Epics for any other reason, a chosen Epics (a click, a link) collapses the
// strip and the mount default yields to the open strip (Stories). Each case acts once; asking for Stories never collapses
// and a collapse never switches the rows, so the two rules cannot trigger each other.
export function createStripRowModeSync({ collapse }) {
    let open = false;
    const settle = () => {
        if (mode !== 'epic') return;
        if (chosen) { open = false; collapse(); } else requestPlanningStories();
    };
    return {
        connect: () => subscribePlanningRowMode(next => { if (open && next === 'epic') settle(); }),
        setOpen(next, { byUser = false } = {}) {
            const was = open;
            open = Boolean(next);
            if (!open || was) return;
            if (byUser) requestPlanningStories();
            else settle();
        },
    };
}

export function resetPlanningRowModeForTests() {
    mode = null;
    chosen = false;
    switchRows = null;
    listeners.clear();
}
