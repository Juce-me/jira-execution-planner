export const seconds = value => Number.isFinite(value) ? `${(value / 1000).toFixed(2)}s` : 'Unknown';
export const secondsShort = value => Number.isFinite(value) ? `${(value / 1000).toFixed(1)}s` : 'Unknown';
export const count = value => Number.isFinite(value) ? value : 'Unknown';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function sizeLabel(value) {
    if (!Number.isFinite(value)) return 'Unknown';
    return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
}

// `weekStart` is the UTC Monday as YYYY-MM-DD.
export function weekLabel(weekStart) {
    const [, month, day] = String(weekStart).split('-').map(Number);
    return MONTHS[month - 1] ? `${MONTHS[month - 1]} ${day}` : 'Unknown';
}

// A UTC stamp such as "Wed 21 Oct · 09:35"; the column says UTC so the zone is stated once.
export function loadTime(recordedAt) {
    const date = new Date(recordedAt);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    const pad = value => String(value).padStart(2, '0');
    return `${DAYS[date.getUTCDay()]} ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} · ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// The Monday (UTC) of the week a recorded load belongs to, matching the server's grouping.
export function weekStartOf(recordedAt) {
    const date = new Date(recordedAt);
    if (Number.isNaN(date.getTime())) return null;
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7)));
    return monday.toISOString().slice(0, 10);
}
