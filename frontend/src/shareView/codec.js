// Codec for shareable view links: ShareViewState <-> the `?v=1&...` query (design: "Link contract"
// and "Encoding"). Pure: no DOM, no React, no I/O. Decode never uses the platform query-string
// parser: it reads %2C and a literal comma as the same character and turns `+` into a space. It
// splits on raw `&`, `,` and `:` itself and percent-decodes each atom on its own.
import {
    SHARE_VIEW_ALERT_ANCHORS,
    SHARE_VIEW_ALERT_KEYS,
    SHARE_VIEW_BOARD_ASSIGNEE_IDS,
    SHARE_VIEW_BOARD_PROJECT_IDS,
    SHARE_VIEW_BOARD_SCOPES,
    SHARE_VIEW_CATEGORY_BY_KEY,
    SHARE_VIEW_DEFAULTS,
    SHARE_VIEW_KEYS_BY_MODE,
    SHARE_VIEW_MODES,
    SHARE_VIEW_PLANNING_KEYS_BY_LAYOUT,
    SHARE_VIEW_PLANNING_LAYOUTS,
    SHARE_VIEW_PLANNING_ROWS,
    SHARE_VIEW_PRIORITY_IDS,
    SHARE_VIEW_SORTS,
    SHARE_VIEW_STATS_KEYS_BY_VIEW,
    SHARE_VIEW_STATS_VIEWS,
    SHARE_VIEW_TRACK_IDS,
    SHARE_VIEW_VERSION,
} from './viewDefaults.js';

export const SHARE_VIEW_MAX_QUERY = 1536;

// Every key a link can carry, in the order the encoder writes them.
export const SHARE_VIEW_QUERY_KEYS = Object.freeze([
    'v', 'mode', 'group', 'sprint', 'scope', 'layout', 'rows', 'stats', 'from', 'to', 'teams', 'find',
    'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'bpriority', 'bprojects', 'bassignee', 'btrack', 'bcolumn',
    'alerts', 'alertTeam', 'epic', 'story',
]);

const MAX_FURTHER_PAIRS = 40;
const MAX_ID = 255;
const MAX_TEAMS = 12;
const MAX_FACET_ATOMS = 20;
const MAX_FACET_ATOM = 100;
const MAX_FIND = 100;

const QUERY_ALPHABET = /^[A-Za-z0-9._~%&=,:-]*$/;
const ATOM = /^[A-Za-z0-9._~%-]+$/;
const VERSION = /^[1-9][0-9]{0,2}$/;
const SPRINT_ID = /^[1-9][0-9]{0,11}$/;
const QUARTER = /^[0-9]{4}Q[1-4]$/;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,63}-[0-9]{1,10}$/;

const ROW_TOKENS = Object.freeze({ epic: 'epics', story: 'stories' });

const codePoints = (text) => Array.from(text).length;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => item === b[index]);

// C0, DEL and C1 controls, the Arabic letter mark, bidi marks, embeddings and overrides, the line
// and paragraph separators, and the bidi isolates. Link text never carries any of them.
function hasUnsafeText(text) {
    for (const char of text) {
        const code = char.codePointAt(0);
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x61c || (code >= 0x200e && code <= 0x200f)
            || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
    }
    return false;
}

// ---- Decode ----------------------------------------------------------------------------------

// A parser returns the state value, INVALID (drop the key and report its category) or OMIT (valid,
// and equal to the default, so no state key is set).
const INVALID = Object.freeze({});
const OMIT = Object.freeze({});

// One percent-encoded atom to its text, or null. Ids are matched exactly, so the text is not trimmed.
function decodeAtom(raw) {
    if (!ATOM.test(raw)) return null;
    let text;
    try {
        text = decodeURIComponent(raw);
    } catch {
        return null;
    }
    return hasUnsafeText(text) || !text.trim() ? null : text;
}

const parseAtom = (max) => (raw) => {
    const text = decodeAtom(raw);
    return text === null || codePoints(text) > max ? INVALID : text;
};

// Raw `,` splits a list; an empty item, an invalid atom, or too many distinct atoms invalidates it.
function decodeList(raw, max, maxItems) {
    const items = raw.split(',').map(decodeAtom);
    if (items.some((item) => item === null || codePoints(item) > max)) return null;
    const unique = [...new Set(items)];
    return unique.length > maxItems ? null : unique;
}

const parseToken = (vocabulary) => (raw) => (vocabulary.includes(raw) ? raw : INVALID);

function parseTeams(raw) {
    if (raw === 'all') return ['all'];
    const ids = decodeList(raw, MAX_ID, MAX_TEAMS);
    return ids && !ids.includes('all') ? ids : INVALID;
}

function parseFind(raw) {
    if (raw === '') return '';
    const text = decodeAtom(raw);
    const trimmed = text === null ? null : text.trim();
    return trimmed === null || codePoints(trimmed) > MAX_FIND ? INVALID : trimmed;
}

// `all` is the neutral null; otherwise `only:` or `hide:`, split at the first raw colon.
function parseFacet(raw) {
    if (raw === 'all') return null;
    const colon = raw.indexOf(':');
    const form = colon < 0 ? '' : raw.slice(0, colon);
    if (form !== 'only' && form !== 'hide') return INVALID;
    const atoms = decodeList(raw.slice(colon + 1), MAX_FACET_ATOM, MAX_FACET_ATOMS);
    if (!atoms) return INVALID;
    return form === 'only' ? { only: atoms } : { hidden: atoms };
}

// `all` is the default (key absent), `none` is "No Project Track only" (an empty list).
function parseTrack(raw) {
    if (raw === 'all') return OMIT;
    if (raw === 'none') return [];
    const ids = [...new Set(raw.split(','))];
    return ids.every((id) => SHARE_VIEW_TRACK_IDS.includes(id)) ? ids : INVALID;
}

// A Board facet list: only ids from the Board's own vocabulary.
const parseVocabList = (vocabulary) => (raw) => {
    const ids = decodeList(raw, MAX_FACET_ATOM, MAX_FACET_ATOMS);
    return ids && ids.every((id) => vocabulary.includes(id)) ? ids : INVALID;
};

function parseLanes(raw) {
    const lanes = [...new Set(raw.split(','))];
    if (!lanes.every((lane) => lane === 'product' || lane === 'tech')) return INVALID;
    return { product: lanes.includes('product'), tech: lanes.includes('tech') };
}

function parseRows(raw) {
    const row = SHARE_VIEW_PLANNING_ROWS.find((candidate) => ROW_TOKENS[candidate] === raw);
    return row === undefined ? INVALID : row;
}

// A Lead Times quarter or a Sprint id. Which one a view takes, and the order, window and catalog
// checks, belong to the resolver; the codec only checks the shape.
const parseRangeEnd = (raw) => (QUARTER.test(raw) || SPRINT_ID.test(raw) ? raw : INVALID);

function parseAlerts(raw) {
    if (raw === 'off' || raw === 'none') return raw;
    const keys = [...new Set(raw.split(','))];
    return keys.every((key) => SHARE_VIEW_ALERT_KEYS.includes(key)) ? keys : INVALID;
}

function parseAlertTeam(raw) {
    const colon = raw.indexOf(':');
    if (colon < 0) return INVALID;
    const anchor = raw.slice(0, colon);
    const id = decodeAtom(raw.slice(colon + 1));
    return SHARE_VIEW_ALERT_ANCHORS.includes(anchor) && id !== null && codePoints(id) <= MAX_ID ? { anchor, id } : INVALID;
}

const parseIssueKey = (kind) => (raw) => (ISSUE_KEY.test(raw) ? { kind, key: raw } : INVALID);

// Query key -> ShareViewState key and parser. `epic` and `story` share the one `focus` slot.
const SPEC = Object.freeze({
    mode: { key: 'mode', parse: parseToken(SHARE_VIEW_MODES) },
    group: { key: 'group', parse: parseAtom(MAX_ID) },
    sprint: { key: 'sprint', parse: (raw) => (SPRINT_ID.test(raw) ? raw : INVALID) },
    scope: { key: 'scope', parse: parseToken(SHARE_VIEW_BOARD_SCOPES) },
    teams: { key: 'teams', parse: parseTeams },
    find: { key: 'find', parse: parseFind },
    status: { key: 'status', parse: parseFacet },
    priority: { key: 'priority', parse: parseFacet },
    track: { key: 'track', parse: parseTrack },
    lanes: { key: 'lanes', parse: parseLanes },
    initiatives: { key: 'initiatives', parse: (raw) => (raw === '1' ? true : raw === '0' ? false : INVALID) },
    sort: { key: 'sort', parse: parseToken(SHARE_VIEW_SORTS) },
    bpriority: { key: 'bpriority', parse: parseVocabList(SHARE_VIEW_PRIORITY_IDS) },
    bprojects: { key: 'bprojects', parse: parseVocabList(SHARE_VIEW_BOARD_PROJECT_IDS) },
    bassignee: { key: 'bassignee', parse: parseVocabList(SHARE_VIEW_BOARD_ASSIGNEE_IDS) },
    btrack: { key: 'btrack', parse: parseTrack },
    bcolumn: { key: 'bcolumn', parse: parseAtom(MAX_ID) },
    layout: { key: 'layout', parse: parseToken(SHARE_VIEW_PLANNING_LAYOUTS) },
    rows: { key: 'rows', parse: parseRows },
    stats: { key: 'stats', parse: parseToken(SHARE_VIEW_STATS_VIEWS) },
    from: { key: 'from', parse: parseRangeEnd },
    to: { key: 'to', parse: parseRangeEnd },
    alerts: { key: 'alerts', parse: parseAlerts },
    alertTeam: { key: 'alertTeam', parse: parseAlertTeam },
    epic: { key: 'focus', parse: parseIssueKey('epic') },
    story: { key: 'focus', parse: parseIssueKey('story') },
});

const invalidLink = (reason) => ({ kind: 'invalid', reason });

// search = location.search (a leading `?` is optional). Returns one of
//   { kind: 'none' }                  not a link: the query does not start with `v=`
//   { kind: 'newer' }                 `v` is an integer above 1
//   { kind: 'invalid', reason }       the whole link is unusable (length, alphabet, version, pair count)
//   { kind: 'ok', state, reported }   `state` holds only valid keys, always `version` and `mode`;
//                                     `reported` lists the notice categories of known keys that were
//                                     present but invalid (or lost the `focus` slot)
export function decodeShareView(search) {
    const query = typeof search === 'string' && search.startsWith('?') ? search.slice(1) : search;
    if (typeof query !== 'string' || !query.startsWith('v=')) return { kind: 'none' };
    if (query.length > SHARE_VIEW_MAX_QUERY) return invalidLink('too_long');
    if (!QUERY_ALPHABET.test(query)) return invalidLink('bad_character');
    const [versionPair, ...rest] = query.split('&');
    const version = versionPair.slice(2);
    if (!VERSION.test(version)) return invalidLink('bad_version');
    const pairs = rest.filter(Boolean);
    if (pairs.length > MAX_FURTHER_PAIRS) return invalidLink('too_many_pairs');
    if (Number(version) !== SHARE_VIEW_VERSION) return { kind: 'newer' };

    const state = { version: SHARE_VIEW_VERSION, mode: SHARE_VIEW_DEFAULTS.mode };
    const reported = [];
    const report = (category) => { if (!reported.includes(category)) reported.push(category); };
    const seen = new Set();
    for (const pair of pairs) {
        const equals = pair.indexOf('=');
        const name = equals < 0 ? '' : pair.slice(0, equals);
        if (!Object.hasOwn(SPEC, name) || seen.has(name)) continue;
        seen.add(name);
        const raw = pair.slice(equals + 1);
        const { key, parse } = SPEC[name];
        const value = raw.includes('=') ? INVALID : parse(raw);
        if (value === OMIT) continue;
        if (value === INVALID || (key === 'focus' && state.focus !== undefined)) {
            report(SHARE_VIEW_CATEGORY_BY_KEY[name]);
            continue;
        }
        state[key] = value;
    }
    return { kind: 'ok', state, reported };
}

// ---- Encode ----------------------------------------------------------------------------------

// encodeURIComponent plus `!'()*`, so the output is only [A-Za-z0-9._~-] and uppercase %XX. A lone
// surrogate throws URIError, which makes the atom unencodable.
function encodeAtom(value, max) {
    if (typeof value !== 'string' || !value.trim() || hasUnsafeText(value) || codePoints(value) > max) return null;
    try {
        return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    } catch {
        return null;
    }
}

function encodeAtoms(values, max, maxItems) {
    if (!Array.isArray(values)) return null;
    const unique = [...new Set(values)];
    if (!unique.length || unique.length > maxItems) return null;
    const atoms = unique.map((value) => encodeAtom(value, max));
    return atoms.includes(null) ? null : atoms.join(',');
}

function facetParts(value) {
    if (!isRecord(value) || Object.keys(value).length !== 1) return null;
    if (Array.isArray(value.only)) return ['only', value.only];
    if (Array.isArray(value.hidden)) return ['hide', value.hidden];
    return null;
}

function encodeFacet(value, fallback) {
    if (value === null) return fallback === null ? undefined : 'all';
    const parts = facetParts(value);
    if (!parts) return null;
    const fallbackParts = fallback === null ? null : facetParts(fallback);
    if (fallbackParts && parts[0] === fallbackParts[0] && sameList(parts[1], fallbackParts[1])) return undefined;
    const atoms = encodeAtoms(parts[1], MAX_FACET_ATOM, MAX_FACET_ATOMS);
    return atoms === null ? null : `${parts[0]}:${atoms}`;
}

const encodeToken = (vocabulary, fallback) => (value) => {
    if (value === fallback) return undefined;
    return vocabulary.includes(value) ? value : null;
};
const encodeScope = encodeToken(SHARE_VIEW_BOARD_SCOPES, SHARE_VIEW_DEFAULTS.scope);
const encodeSort = encodeToken(SHARE_VIEW_SORTS, SHARE_VIEW_DEFAULTS.sort);
const encodeLayout = encodeToken(SHARE_VIEW_PLANNING_LAYOUTS, SHARE_VIEW_DEFAULTS.layout);
const encodeStats = encodeToken(SHARE_VIEW_STATS_VIEWS, SHARE_VIEW_DEFAULTS.stats);

function encodeTeams(value) {
    if (!Array.isArray(value) || !value.length) return null;
    // `all` in the sender's selection is the default; an explicit list is never collapsed to it.
    return value.includes('all') ? undefined : encodeAtoms(value, MAX_ID, MAX_TEAMS);
}

function encodeFind(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text === SHARE_VIEW_DEFAULTS.find ? undefined : encodeAtom(text, MAX_FIND);
}

function encodeTrack(value) {
    if (!Array.isArray(value)) return null;
    const ids = [...new Set(value)];
    if (!ids.every((id) => SHARE_VIEW_TRACK_IDS.includes(id))) return null;
    return ids.length ? ids.join(',') : 'none';
}

const encodeVocabList = (vocabulary) => (value) => {
    if (!Array.isArray(value) || !value.length || !value.every((id) => vocabulary.includes(id))) return null;
    return encodeAtoms(value, MAX_FACET_ATOM, MAX_FACET_ATOMS);
};

function encodeLanes(value) {
    const { product, tech } = SHARE_VIEW_DEFAULTS.lanes;
    if (!isRecord(value) || typeof value.product !== 'boolean' || typeof value.tech !== 'boolean') return null;
    if (value.product === product && value.tech === tech) return undefined;
    if (!value.product && !value.tech) return null;
    return value.product ? 'product' : 'tech';
}

function encodeInitiatives(value) {
    if (value === SHARE_VIEW_DEFAULTS.initiatives) return undefined;
    return typeof value === 'boolean' ? (value ? '1' : '0') : null;
}

function encodeRows(value) {
    if (value === SHARE_VIEW_DEFAULTS.rows) return undefined;
    return SHARE_VIEW_PLANNING_ROWS.includes(value) ? ROW_TOKENS[value] : null;
}

function encodeAlerts(value) {
    if (value === 'off' || value === 'none') return value;
    if (!Array.isArray(value)) return null;
    const keys = [...new Set(value)];
    if (!keys.every((key) => SHARE_VIEW_ALERT_KEYS.includes(key))) return null;
    if (keys.length === SHARE_VIEW_DEFAULTS.alerts.length) return undefined;
    return keys.length ? keys.join(',') : 'none';
}

function encodeAlertTeam(value, state) {
    if (!isRecord(value) || state.alerts === 'off' || !SHARE_VIEW_ALERT_ANCHORS.includes(value.anchor)) return null;
    const id = encodeAtom(value.id, MAX_ID);
    return id === null ? null : `${value.anchor}:${id}`;
}

// `from` and `to` travel together, in the shape the view takes: quarters for Lead Times, Sprint ids
// for the source-only views. Lead Times always writes its range: its default is the current quarter,
// which moves with the clock, and a link must not change meaning with the date it is opened on. A
// Sprint range equal to the default (the link's own Sprint) is omitted, because that default is stable.
function encodeRange(state) {
    const { from, to } = state;
    const quarters = state.stats === 'cohort';
    const shape = quarters ? QUARTER : SPRINT_ID;
    if (typeof from !== 'string' || typeof to !== 'string' || !shape.test(from) || !shape.test(to)) return null;
    if (!quarters) {
        const fallback = SHARE_VIEW_DEFAULTS.sprintRange(state.sprint);
        if (from === fallback.from && to === fallback.to) return undefined;
    }
    return [['from', from], ['to', to]];
}

const one = (name, text) => (text === undefined || text === null ? text : [[name, text]]);

// ShareViewState key -> its pairs: undefined (absent or equal to the default), null (cannot be
// represented) or a list of [query key, value] pairs. Listed in the order they are written.
const ENCODERS = Object.freeze({
    scope: (state) => one('scope', encodeScope(state.scope)),
    layout: (state) => one('layout', encodeLayout(state.layout)),
    rows: (state) => one('rows', encodeRows(state.rows)),
    stats: (state) => one('stats', encodeStats(state.stats)),
    range: encodeRange,
    teams: (state) => one('teams', encodeTeams(state.teams)),
    find: (state) => one('find', encodeFind(state.find)),
    status: (state) => one('status', encodeFacet(state.status, SHARE_VIEW_DEFAULTS.status)),
    priority: (state) => one('priority', encodeFacet(state.priority, SHARE_VIEW_DEFAULTS.priority)),
    track: (state) => one('track', encodeTrack(state.track)),
    lanes: (state) => one('lanes', encodeLanes(state.lanes)),
    initiatives: (state) => one('initiatives', encodeInitiatives(state.initiatives)),
    sort: (state) => one('sort', encodeSort(state.sort)),
    bpriority: (state) => one('bpriority', encodeVocabList(SHARE_VIEW_PRIORITY_IDS)(state.bpriority)),
    bprojects: (state) => one('bprojects', encodeVocabList(SHARE_VIEW_BOARD_PROJECT_IDS)(state.bprojects)),
    bassignee: (state) => one('bassignee', encodeVocabList(SHARE_VIEW_BOARD_ASSIGNEE_IDS)(state.bassignee)),
    btrack: (state) => one('btrack', encodeTrack(state.btrack)),
    bcolumn: (state) => one('bcolumn', encodeAtom(state.bcolumn, MAX_ID)),
    alerts: (state) => one('alerts', encodeAlerts(state.alerts)),
    alertTeam: (state) => one('alertTeam', encodeAlertTeam(state.alertTeam, state)),
    focus: (state) => {
        const { focus } = state;
        return isRecord(focus) && (focus.kind === 'epic' || focus.kind === 'story') && ISSUE_KEY.test(focus.key)
            ? [[focus.kind, focus.key]]
            : null;
    },
});

// The ShareViewState keys a mode writes, narrowed by the Planning layout and the Statistics view.
function applicableKeys(state) {
    const keys = new Set(SHARE_VIEW_KEYS_BY_MODE[state.mode]);
    if (state.mode === 'planning') {
        const other = state.layout === 'list' ? 'table' : 'list';
        SHARE_VIEW_PLANNING_KEYS_BY_LAYOUT[other].forEach((key) => keys.delete(key));
    }
    if (state.mode === 'statistics') {
        const view = SHARE_VIEW_STATS_VIEWS.includes(state.stats) ? state.stats : SHARE_VIEW_DEFAULTS.stats;
        ['teams', 'from', 'to'].forEach((key) => { if (!SHARE_VIEW_STATS_KEYS_BY_VIEW[view].includes(key)) keys.delete(key); });
    }
    return keys;
}

// Over the cap, drop in this order and never the scope keys (group, sprint, scope, teams, facets).
const DROP_ORDER = Object.freeze([['find'], ['focus', 'alertTeam'], ['alerts'], ['initiatives'], ['sort']]);

// Returns { ok: true, query, dropped } or { ok: false, reason: 'invalid_state' | 'too_long' }. The
// query has no leading `?` and starts with `v=1`; `dropped` names the optional state keys left out
// because they could not be written or because the link was over the cap. Nothing is truncated.
export function encodeShareView(state) {
    if (!isRecord(state) || state.version !== SHARE_VIEW_VERSION || !SHARE_VIEW_MODES.includes(state.mode)) {
        return { ok: false, reason: 'invalid_state' };
    }
    const group = encodeAtom(state.group, MAX_ID);
    if (group === null || typeof state.sprint !== 'string' || !SPRINT_ID.test(state.sprint)) {
        return { ok: false, reason: 'invalid_state' };
    }

    const keys = applicableKeys(state);
    const pairs = new Map();
    const dropped = [];
    for (const name of Object.keys(ENCODERS)) {
        const stateKeys = name === 'range' ? ['from', 'to'] : [name];
        if (!stateKeys.some((key) => keys.has(key))) continue;
        const present = stateKeys.filter((key) => state[key] !== undefined);
        if (!present.length) continue;
        // A link carries at most one focus target: an alert team group wins over an Epic or Story.
        const encoded = name === 'focus' && pairs.has('alertTeam') ? null : ENCODERS[name](state);
        if (encoded === null) dropped.push(...present);
        else if (encoded !== undefined) pairs.set(name, encoded);
    }

    const compose = () => {
        const query = [['v', SHARE_VIEW_VERSION], ['mode', state.mode], ['group', group], ['sprint', state.sprint], ...[...pairs.values()].flat()]
            .map(([name, value]) => `${name}=${value}`)
            .join('&');
        // Chat autolinkers strip a trailing dot.
        return query.endsWith('.') ? `${query.slice(0, -1)}%2E` : query;
    };
    let query = compose();
    for (const step of DROP_ORDER) {
        if (query.length <= SHARE_VIEW_MAX_QUERY) break;
        step.forEach((name) => { if (pairs.delete(name)) dropped.push(name); });
        query = compose();
    }
    return query.length > SHARE_VIEW_MAX_QUERY ? { ok: false, reason: 'too_long' } : { ok: true, query, dropped };
}

// ---- Strip -----------------------------------------------------------------------------------

const nameOf = (pair) => {
    const equals = pair.indexOf('=');
    return equals < 0 ? pair : pair.slice(0, equals);
};

// The search without any link key (including `v`); other params keep their raw text and order. The
// input is returned unchanged when it carries no link key.
export function stripShareViewParams(search) {
    if (typeof search !== 'string') return '';
    const pairs = (search.startsWith('?') ? search.slice(1) : search).split('&').filter(Boolean);
    const kept = pairs.filter((pair) => !SHARE_VIEW_QUERY_KEYS.includes(nameOf(pair)));
    if (kept.length === pairs.length) return search;
    return kept.length ? `?${kept.join('&')}` : '';
}
