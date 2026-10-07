import { resolveStatusColumnColour } from '../issues/statusColumnColours.js';

export function resolveEngFilterOptionVisual({ facetId, option, boardColumns } = {}) {
    if (facetId === 'status') {
        return {
            kind: 'status_label',
            configuredColour: resolveStatusColumnColour(boardColumns, option?.label),
        };
    }
    if (facetId === 'priority') return { kind: 'priority', value: option?.label };
    if (facetId === 'track') return { kind: 'project_track', value: option?.label };
    return null;
}
