const STORY_POINTS_LEXEME = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

// Rounds decimal text half-up to hundredths on its digits, so 1.005 -> 1.01 where binary floats give 1.
function roundStoryPointsText(text) {
    const [whole, fraction = ''] = text.split('.');
    let hundredths = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
    if (fraction.length > 2 && fraction[2] >= '5') hundredths += 1n;
    const cents = String(hundredths % 100n).padStart(2, '0').replace(/0+$/, '');
    return `${hundredths / 100n}${cents ? `.${cents}` : ''}`;
}

export function parseStoryPointsDraft(draft) {
    const text = typeof draft === 'string' ? draft.trim() : '';
    if (!STORY_POINTS_LEXEME.test(text)) return { valid: false, value: null };
    const value = Number(roundStoryPointsText(text));
    return Number.isFinite(value) && value >= 0
        ? { valid: true, value }
        : { valid: false, value: null };
}

// A Story's own points: up to two decimals, trailing zeros trimmed (0.75, 1, 0.5).
export function formatStoryPointsValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    const text = String(value);
    return STORY_POINTS_LEXEME.test(text) ? roundStoryPointsText(text) : text;
}

export function unicodeLength(value) {
    return Array.from(String(value || '').trim()).length;
}

export function hasIssueUserSearchThreshold(query) {
    return unicodeLength(query) >= 3;
}

function normalizedPerson(person) {
    const accountId = typeof person?.accountId === 'string' ? person.accountId.trim() : '';
    const displayName = typeof person?.displayName === 'string' ? person.displayName.trim() : '';
    if (!accountId || !displayName) return null;
    return {
        accountId,
        displayName,
        ...(typeof person.emailAddress === 'string' && person.emailAddress ? { emailAddress: person.emailAddress } : {}),
        ...(typeof person.eligibility === 'string' ? { eligibility: person.eligibility } : {}),
    };
}

export function matchesIssueUserQuery(person, query) {
    const text = String(query || '').trim().toLocaleLowerCase();
    return [person?.displayName, person?.emailAddress].some(value => String(value || '').toLocaleLowerCase().includes(text));
}

export function normalizeIssueUserSuggestions(me, options, maximum = 5, query = '') {
    const result = [];
    const seen = new Set();
    const append = person => {
        const normalized = normalizedPerson(person);
        if (!normalized || !matchesIssueUserQuery(normalized, query) || seen.has(normalized.accountId) || result.length >= maximum) return;
        seen.add(normalized.accountId);
        result.push(normalized);
    };
    append(me);
    (Array.isArray(options) ? options : []).forEach(append);
    return result;
}
