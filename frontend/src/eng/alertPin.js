export const PIN_HEIGHT = 40;

const trimmed = value => String(value ?? '').trim();

export function createAlertPin({ kind, identity, sectionId, key, title, note } = {}) {
    return {
        kind,
        identity: trimmed(identity),
        sectionId: trimmed(sectionId),
        key: trimmed(key),
        title: trimmed(title),
        note: trimmed(note),
    };
}

const keysOf = list => (Array.isArray(list) ? list : []).map(item => trimmed(item?.key)).filter(Boolean);

export function alertIdentitiesBySection(collections = {}) {
    const {
        consolidatedMissingStories,
        blockedTasks,
        postponedTasks,
        futureRoutedEpics,
        backlogEpics,
        missingTeamEpics,
        missingLabelEpics,
        needsStoriesEntries,
        waitingForStoriesEpics,
        emptyEpicsForAlert,
        doneStoryEpics,
    } = collections;
    return {
        'eng-alert-missing': (Array.isArray(consolidatedMissingStories) ? consolidatedMissingStories : [])
            .map(entry => trimmed(entry?.task?.key)).filter(Boolean),
        'eng-alert-blocked': keysOf(blockedTasks),
        'eng-alert-followup': [...keysOf(postponedTasks), ...keysOf(futureRoutedEpics)],
        'eng-alert-backlog': keysOf(backlogEpics),
        'eng-alert-missing-team': keysOf(missingTeamEpics),
        'eng-alert-missing-labels': keysOf(missingLabelEpics),
        'eng-alert-needs-stories': (Array.isArray(needsStoriesEntries) ? needsStoriesEntries : [])
            .map(entry => trimmed(entry?.id)).filter(Boolean),
        'eng-alert-waiting': keysOf(waitingForStoriesEpics),
        'eng-alert-empty': keysOf(emptyEpicsForAlert),
        'eng-alert-done': keysOf(doneStoryEpics),
    };
}

// The single place the close decision is made. Only the pin's own section is consulted.
export function resolvePinClose(pin, identitiesBySection = {}, { loading = false } = {}) {
    if (loading) return { dismiss: true, celebrate: false, scroll: 'block-or-top' };
    const identities = identitiesBySection?.[pin?.sectionId] || [];
    const live = identities.includes(pin?.identity);
    const siblings = identities.filter(identity => identity !== pin?.identity).length;
    const last = siblings === 0;
    return { dismiss: live, celebrate: last, scroll: last ? 'top' : 'block' };
}

export function pinScopeKey({ groupId, sprintId } = {}) {
    return JSON.stringify([trimmed(groupId), trimmed(sprintId)]);
}

export function scrollTargetTop({ elementTop, scrollY, stickyBottom, guard = 12 }) {
    return Math.max(0, scrollY + elementTop - (stickyBottom + guard));
}

// Where a centered reveal must land instead so the target clears the sticky stack; null when centering already clears it.
export function clearCenteredTarget({ elementTop, elementHeight, scrollY, viewportHeight, stickyBottom, guard = 12 }) {
    if ((viewportHeight - elementHeight) / 2 >= stickyBottom + guard) return null;
    return scrollTargetTop({ elementTop, scrollY, stickyBottom, guard });
}

// An alert target's scroll top below the sticky stack at its landing position: the compact header only once the main header has scrolled away,
// the filter bar, and the pin when it stays. Epic headers and Planning sit below the alerts and never cover them. When the compact header would
// toggle between the two landings, the compact-hidden one is used, so the target is never under it (it lands up to `compactHeight` lower).
export function alertLandingTop({ elementDocTop, headerBottom, compactHeight = 0, filterBarHeight = 0, pinHeight = 0, guard = 12 }) {
    const landing = compact => Math.max(0, elementDocTop - (compact + filterBarHeight + pinHeight + guard));
    return landing(0) < headerBottom ? landing(0) : landing(compactHeight);
}
