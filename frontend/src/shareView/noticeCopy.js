import { SHARE_VIEW_CATEGORY_BY_KEY } from './viewDefaults.js';

// Notice categories in display order. A label names what was not applied, never a value.
const CATEGORY_LABELS = new Map([
    ['group', 'Department group'],
    ['sprint', 'Sprint'],
    ['mode', 'view mode'],
    ['teams', 'Teams'],
    ['filters', 'filters'],
    ['focus', 'highlighted item'],
]);

function labelList(categories) {
    const labels = [...CATEGORY_LABELS].filter(([category]) => categories.includes(category)).map(([, label]) => label);
    return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : (labels[0] || '');
}

// The encoder reports dropped state keys; `focus` is the state slot that the epic and story query keys fill.
export function shareViewDroppedCategories(dropped) {
    const categories = new Set();
    for (const key of Array.isArray(dropped) ? dropped : []) {
        const category = key === 'focus' ? 'focus' : Object.hasOwn(SHARE_VIEW_CATEGORY_BY_KEY, key) ? SHARE_VIEW_CATEGORY_BY_KEY[key] : null;
        if (category) categories.add(category);
    }
    return [...categories];
}

// Apply result from the store: { kind: 'dropped' | 'partial' | 'invalid' | 'newer', categories }.
export function shareViewNoticeMessage(notice) {
    const categories = Array.isArray(notice?.categories) ? notice.categories : [];
    switch (notice?.kind) {
        case 'newer':
            return 'This link was made with a newer version of the app, so it was not applied. Update the app and open the link again.';
        case 'invalid':
            return 'This link is not valid, so it was not applied. Ask the sender to copy it again.';
        case 'dropped': {
            const scope = labelList(categories.filter(category => category === 'group' || category === 'sprint'));
            if (!scope) return 'This link could not be applied right now, so your view was left as it was.';
            return `This link was not applied: its ${scope} ${categories.includes('group') && categories.includes('sprint') ? 'are' : 'is'} not available to you.`;
        }
        case 'partial': {
            const list = labelList(categories);
            return `Part of this link was not applied${list ? `: ${list}` : ''}. Everything else was applied.`;
        }
        default:
            return '';
    }
}

// Share's own outcomes: `copied` (written to the clipboard), `manual` (clipboard unavailable or refused;
// the notice also shows the URL) and `refused` (the encoder produced no link; nothing was copied).
export function shareViewCopyMessage({ type, reason, dropped }) {
    const left = labelList(shareViewDroppedCategories(dropped));
    if (type === 'copied') return left ? `Link copied, without some details to keep it short: ${left}.` : '';
    if (type === 'manual') return `The browser did not allow copying. Select the link below and copy it.${left ? ` Left out to keep it short: ${left}.` : ''}`;
    return reason === 'too_long'
        ? 'This view has too many selections to fit in one link, so nothing was copied.'
        : 'This view cannot be shared as a link right now, so nothing was copied.';
}
