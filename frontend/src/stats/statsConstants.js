export const PRIORITY_AXIS = ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial'];

export const PRIORITY_LABEL_BY_KEY = {
    blocker: 'Blocker',
    critical: 'Critical',
    major: 'Major',
    minor: 'Minor',
    low: 'Low',
    trivial: 'Trivial'
};

export const PRIORITY_ALIASES = {
    highest: 'blocker',
    high: 'major',
    medium: 'minor',
    lowest: 'trivial'
};

// 12 categorical, maximally-distinguishable colors. Ordered so consecutive
// indices contrast strongly, which keeps adjacent series/legend entries distinct.
export const RADAR_PALETTE = [
    '#0ea5e9', // sky blue
    '#eab308', // lemon
    '#84cc16', // lime
    '#db2777', // magenta
    '#d97706', // amber
    '#9333ea', // purple
    '#1e3a8a', // deep blue
    '#4d7c0f', // olive
    '#0891b2', // cyan
    '#78716c', // stone gray
    '#0d9488', // teal
    '#4f46e5'  // indigo
];
