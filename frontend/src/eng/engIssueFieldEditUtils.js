const STORY_POINTS_LEXEME = /^(?:0|[1-9]\d*)(?:\.\d)?$/;

export function parseStoryPointsDraft(draft) {
    const text = typeof draft === 'string' ? draft.trim() : '';
    if (!STORY_POINTS_LEXEME.test(text)) return { valid: false, value: null };
    const value = Number(text);
    return Number.isFinite(value) && value >= 0
        ? { valid: true, value }
        : { valid: false, value: null };
}

export function formatStoryPointsValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
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

export function normalizeIssueUserSuggestions(me, options, maximum = 5) {
    const result = [];
    const seen = new Set();
    const append = person => {
        const normalized = normalizedPerson(person);
        if (!normalized || seen.has(normalized.accountId) || result.length >= maximum) return;
        seen.add(normalized.accountId);
        result.push(normalized);
    };
    append(me);
    (Array.isArray(options) ? options : []).forEach(append);
    return result;
}
