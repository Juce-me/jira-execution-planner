import { BOARD_COLUMN_COLOURS } from '../settings/groupBoardModel.js';

// Colour of the Department Board column that holds `status`, or null. Unmapped means untouched:
// this is not the Board placement rule, which sends an unlisted status to the first column.
export function resolveStatusColumnColour(columns, status) {
    const owner = Array.isArray(columns)
        ? columns.find((column) => Array.isArray(column?.statuses) && column.statuses.includes(status))
        : null;
    return BOARD_COLUMN_COLOURS.includes(owner?.colour) ? owner.colour : null;
}

// The same soft tint the filter-bar Status popover uses (filter-bar.css), with dark text.
const STYLE_BY_COLOUR = new Map(BOARD_COLUMN_COLOURS.map((colour) => [
    colour,
    Object.freeze({
        background: `color-mix(in srgb, ${colour} 28%, var(--bg-secondary))`,
        color: 'var(--text-primary)',
    }),
]));

export function buildStatusStyle(colour) {
    return STYLE_BY_COLOUR.get(colour);
}
