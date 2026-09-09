const storyPointsHighlightTimers = new WeakMap();

function findStoryPointsInput(taskKey) {
    const normalizedKey = String(taskKey || '');
    const task = Array.from(document.querySelectorAll('[data-issue-key]'))
        .find(element => element.getAttribute('data-issue-key') === normalizedKey);
    return task?.querySelector('input.story-points-editor') || null;
}

function activateStoryPointsInput(taskKey) {
    const input = findStoryPointsInput(taskKey);
    if (!input) return false;
    const previousTimer = storyPointsHighlightTimers.get(input);
    if (previousTimer) window.clearTimeout(previousTimer);
    input.classList.remove('story-points-alert-highlight');
    void input.offsetWidth;
    input.classList.add('story-points-alert-highlight');
    input.focus({ preventScroll: true });
    input.select();
    storyPointsHighlightTimers.set(input, window.setTimeout(() => {
        input.classList.remove('story-points-alert-highlight');
        storyPointsHighlightTimers.delete(input);
    }, 2200));
    return true;
}

export function navigateToAlertStory({
    taskKey,
    editStoryPoints = false,
    revealStory,
    clearFilters,
    onMissing,
    schedule = callback => window.requestAnimationFrame(() => window.requestAnimationFrame(callback)),
}) {
    const revealAndActivate = () => {
        if (!revealStory?.(taskKey)) return false;
        return !editStoryPoints || activateStoryPointsInput(taskKey);
    };
    if (revealAndActivate()) return true;
    clearFilters?.();
    schedule(() => {
        if (!revealAndActivate()) onMissing?.(taskKey);
    });
    return false;
}
