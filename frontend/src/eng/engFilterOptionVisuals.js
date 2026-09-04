import { BOARD_COLUMN_COLOURS } from '../settings/groupBoardModel.js';

export function resolveEngFilterOptionVisual({ facetId, option, boardColumns } = {}) {
    if (facetId === 'status') {
        const owner = Array.isArray(boardColumns)
            ? boardColumns.find((column) => Array.isArray(column?.statuses) && column.statuses.includes(option?.label))
            : null;
        return {
            kind: 'status_label',
            configuredColour: BOARD_COLUMN_COLOURS.includes(owner?.colour) ? owner.colour : null,
        };
    }
    if (facetId === 'priority') return { kind: 'priority', value: option?.label };
    if (facetId === 'track') return { kind: 'project_track', value: option?.label };
    return null;
}
