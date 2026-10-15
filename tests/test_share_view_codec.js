// Contract tests for the shareable view link codec (docs/plans/SUPPORT-shareable-view-links-design-194.md:
// "Link contract", "Semantics" and "Encoding").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'frontend', 'src');
const CORPUS_PATH = path.join(__dirname, 'fixtures', 'share-view-query-corpus-example-sanitized.json');
const VIEW_VALIDATION_PATH = path.join(__dirname, '..', 'backend', 'config', 'view_validation.py');

// Bundle an entry for the browser and run it in a fresh vm context, the way
// test_auth_resume_state.js does. `sandbox` adds globals (a fixed Date for the Lead Times default).
function bundle(options, sandbox = {}) {
    const source = esbuild.buildSync({
        bundle: true, write: false, format: 'cjs', platform: 'browser', ...options,
    }).outputFiles[0].text;
    const context = { module: { exports: {} }, exports: {}, console, ...sandbox };
    vm.runInContext(source, vm.createContext(context));
    return context.module.exports;
}
const loadModule = (relative, sandbox) => bundle({ entryPoints: [path.join(SRC, relative)] }, sandbox);
const readSource = (relative) => fs.readFileSync(path.join(SRC, relative), 'utf8');
const readCorpus = () => JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
const stashPattern = () => new RegExp(`^(?:${readCorpus().pattern})$`);

// Objects built inside the vm carry that realm's prototypes; compare them through JSON.
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function deepFreeze(value) {
    if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

// A Date whose no-argument constructor is a fixed local time.
function fixedDate(...parts) {
    const fixed = new Date(...parts).getTime();
    return class extends Date {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
    };
}

const defaults = loadModule('shareView/viewDefaults.js');
const codec = loadModule('shareView/codec.js');
const { encodeShareView, decodeShareView, stripShareViewParams, SHARE_VIEW_MAX_QUERY } = codec;

const decode = (search) => plain(decodeShareView(search));
const encode = (state) => plain(encodeShareView(state));

const BASE = { version: 1, mode: 'catch-up', group: 'dept/a', sprint: '4182' };
const head = (mode = 'catch-up') => `v=1&mode=${mode}&group=dept%2Fa&sprint=4182`;
const ok = (patch = {}, reported = []) => ({ kind: 'ok', state: { version: 1, mode: 'catch-up', ...patch }, reported });
const invalid = (reason) => ({ kind: 'invalid', reason });
const NONE = { kind: 'none' };
const NEWER = { kind: 'newer' };
// One decode row per input, all expecting the same dropped category.
const drops = (category, searches, patch = {}) => searches.map((search) => [search, ok(patch, [category])]);

const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UUIDS = Array.from({ length: 12 }, (_, index) => uuid(index + 1));
const EMOJI = String.fromCodePoint(0x1F600);
const LONE_SURROGATE = String.fromCharCode(0xD800);
const BIDI_OVERRIDE = String.fromCharCode(0x202E);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const C1_CONTROL = String.fromCharCode(0x85);
const BELL = String.fromCharCode(7);
const E_ACUTE = String.fromCharCode(0xE9);
const KANJI = String.fromCharCode(0x5B8C, 0x4E86);

// ---- Contract surface ------------------------------------------------------------------------

test('exports match the binding interface', () => {
    assert.equal(SHARE_VIEW_MAX_QUERY, 1536);
    assert.equal(defaults.SHARE_VIEW_VERSION, 1);
    assert.deepEqual(plain(defaults.SHARE_VIEW_MODES), ['catch-up', 'planning', 'board', 'statistics']);
    assert.deepEqual(plain(defaults.SHARE_VIEW_ALERT_KEYS), [
        'missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done',
    ]);
    assert.deepEqual(plain(defaults.SHARE_VIEW_ALERT_ANCHORS), [...plain(defaults.SHARE_VIEW_ALERT_KEYS), 'followupEpics']);
    // `find` is checked in its own section at the end of this file.
    const keysByMode = Object.fromEntries(Object.entries(plain(defaults.SHARE_VIEW_KEYS_BY_MODE)).map(([mode, keys]) => [mode, keys.filter((key) => key !== 'find')]));
    assert.deepEqual(keysByMode, {
        'catch-up': ['teams', 'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'alerts', 'alertTeam', 'focus'],
        planning: ['teams', 'status', 'priority', 'track', 'lanes', 'layout', 'rows', 'initiatives', 'sort', 'focus'],
        board: ['scope'],
        statistics: ['teams', 'stats', 'from', 'to'],
    });
    const { find, ...categories } = plain(defaults.SHARE_VIEW_CATEGORY_BY_KEY);
    assert.deepEqual(categories, {
        group: 'group', sprint: 'sprint',
        mode: 'mode', scope: 'mode', layout: 'mode', rows: 'mode', stats: 'mode', from: 'mode', to: 'mode',
        teams: 'teams',
        status: 'filters', priority: 'filters', track: 'filters', lanes: 'filters', initiatives: 'filters', sort: 'filters',
        alerts: 'focus', alertTeam: 'focus', epic: 'focus', story: 'focus',
    });
    for (const frozen of [
        defaults.SHARE_VIEW_DEFAULTS, defaults.SHARE_VIEW_MODES, defaults.SHARE_VIEW_KEYS_BY_MODE, defaults.SHARE_VIEW_ALERT_KEYS,
        defaults.SHARE_VIEW_ALERT_ANCHORS, defaults.SHARE_VIEW_CATEGORY_BY_KEY, codec.SHARE_VIEW_QUERY_KEYS,
    ]) assert.equal(Object.isFrozen(frozen), true);
});

test('query keys: v first, one per category entry, and never a GA4 site-search key', () => {
    const keys = plain(codec.SHARE_VIEW_QUERY_KEYS);
    assert.equal(keys[0], 'v');
    assert.deepEqual([...keys.slice(1)].sort(), Object.keys(plain(defaults.SHARE_VIEW_CATEGORY_BY_KEY)).sort());
    assert.equal(new Set(keys).size, keys.length);
    for (const forbidden of ['q', 's', 'search', 'query', 'keyword']) assert.equal(keys.includes(forbidden), false, forbidden);
});

// ---- Decode vectors (from the design review; search = location.search) ----------------------

const A255 = 'a'.repeat(255);
const FILLER_1536 = `v=1&x=${'a'.repeat(1536 - 'v=1&x='.length)}`;
const FORTY_PAIRS = Array.from({ length: 40 }, (_, index) => `k${index}=1`).join('&');
const NAMES_20 = Array.from({ length: 20 }, (_, index) => `s${index}`);

const DECODE_VECTORS = [
    // envelope: ok, newer, invalid, none
    ['?v=1&mode=board', ok({ mode: 'board' })],
    ['v=1&mode=board', ok({ mode: 'board' })],
    ['?v=1', ok()],
    ['?v=2&mode=board', NEWER],
    ['?v=999', NEWER],
    ...['?v=01', '?v=1.0', '?v=', '?v=0', '?v=1000'].map((search) => [search, invalid('bad_version')]),
    ...['?mode=board&v=1', '?x=1', '', '?', '??v=1', '?perf=1&v=1'].map((search) => [search, NONE]),
    // mode
    ...drops('mode', ['?v=1&mode=Board', '?v=1&mode=scenario', '?v=1&mode=epm', '?v=1&mode=catch%2Dup']),
    ['?v=1&mode=planning', ok({ mode: 'planning' })],
    ['?v=1&mode=statistics', ok({ mode: 'statistics' })],
    ['?v=1&mode=board&mode=planning', ok({ mode: 'board' })],
    ['?v=1&mode=Board&mode=planning', ok({}, ['mode'])],
    ['?v=1&mode=board&v=2', ok({ mode: 'board' })],
    // group
    ['?v=1&group=dept%2Fa', ok({ group: 'dept/a' })],
    ...drops('group', ['?v=1&group=', '?v=1&group=%20', '?v=1&group=%E0%A4%A', '?v=1&group=a:b', `?v=1&group=${'a'.repeat(256)}`]),
    [`?v=1&group=${A255}`, ok({ group: A255 })],
    // sprint
    ['?v=1&sprint=4182', ok({ sprint: '4182' })],
    ['?v=1&sprint=123456789012', ok({ sprint: '123456789012' })],
    ...drops('sprint', ['?v=1&sprint=0042', '?v=1&sprint=12a', '?v=1&sprint=1e3', '?v=1&sprint=1234567890123']),
    // scope
    ['?v=1&scope=all_work', ok({ scope: 'all_work' })],
    ['?v=1&scope=component', ok({ scope: 'component' })],
    ...drops('mode', ['?v=1&scope=all-work', '?v=1&scope=']),
    // teams
    ['?v=1&teams=all', ok({ teams: ['all'] })],
    ['?v=1&teams=a%2Cb,c', ok({ teams: ['a,b', 'c'] })],
    ['?v=1&teams=a,a', ok({ teams: ['a'] })],
    ...drops('teams', ['?v=1&teams=', '?v=1&teams=a,,b', '?v=1&teams=all,t1', '?v=1&teams=t1,all', '?v=1&teams=team::orbit']),
    ['?v=1&teams=team%3A%3Aorbit', ok({ teams: ['team::orbit'] })],
    [`?v=1&teams=${UUIDS.join(',')}`, ok({ teams: UUIDS })],
    ...drops('teams', [`?v=1&teams=${[...UUIDS, uuid(13)].join(',')}`]),
    // status and priority
    ['?v=1&status=all', ok({ status: null })],
    ['?v=1&status=only:In%20Progress,To%20Do', ok({ status: { only: ['In Progress', 'To Do'] } })],
    ['?v=1&status=hide:Ready%2C%20set', ok({ status: { hidden: ['Ready, set'] } })],
    ...drops('filters', ['?v=1&status=only:', '?v=1&status=only', '?v=1&status=hide:a:b', '?v=1&status=SHOW:x', '?v=1&status=only:a,,b']),
    ['?v=1&status=only:a,a', ok({ status: { only: ['a'] } })],
    [`?v=1&status=only:${'a'.repeat(100)}`, ok({ status: { only: ['a'.repeat(100)] } })],
    ...drops('filters', [`?v=1&status=only:${'a'.repeat(101)}`, `?v=1&status=only:${[...NAMES_20, 's20'].join(',')}`]),
    [`?v=1&status=only:${NAMES_20.join(',')}`, ok({ status: { only: NAMES_20 } })],
    ['?v=1&priority=only:High', ok({ priority: { only: ['High'] } })],
    ['?v=1&priority=hide:Trivial,Low', ok({ priority: { hidden: ['Trivial', 'Low'] } })],
    ['?v=1&priority=all', ok({ priority: null })],
    // track
    ['?v=1&track=none', ok({ track: [] })],
    ['?v=1&track=all', ok()],
    ['?v=1&track=committed', ok({ track: ['committed'] })],
    ['?v=1&track=flexible,committed,flexible', ok({ track: ['flexible', 'committed'] })],
    ...drops('filters', ['?v=1&track=Committed', '?v=1&track=', '?v=1&track=all,committed', '?v=1&track=none,committed']),
    // lanes
    ['?v=1&lanes=tech', ok({ lanes: { product: false, tech: true } })],
    ['?v=1&lanes=product', ok({ lanes: { product: true, tech: false } })],
    ['?v=1&lanes=product,tech', ok({ lanes: { product: true, tech: true } })],
    ['?v=1&lanes=tech,product', ok({ lanes: { product: true, tech: true } })],
    ...drops('filters', ['?v=1&lanes=', '?v=1&lanes=Tech']),
    // initiatives
    ['?v=1&initiatives=0', ok({ initiatives: false })],
    ['?v=1&initiatives=1', ok({ initiatives: true })],
    ...drops('filters', ['?v=1&initiatives=true']),
    // sort
    ['?v=1&sort=track-flexible', ok({ sort: 'track-flexible' })],
    ['?v=1&sort=priority', ok({ sort: 'priority' })],
    ...drops('filters', ['?v=1&sort=Priority', '?v=1&sort=__proto__', '?v=1&sort=constructor']),
    // layout and rows
    ['?v=1&layout=table&rows=stories', ok({ layout: 'table', rows: 'story' })],
    ['?v=1&layout=list&rows=epics', ok({ layout: 'list', rows: 'epic' })],
    ...drops('mode', ['?v=1&layout=grid', '?v=1&rows=story']),
    // stats and ranges
    ['?v=1&stats=burnout', ok({ stats: 'burnout' })],
    ...drops('mode', ['?v=1&stats=burndown']),
    ['?v=1&stats=cohort&from=2026Q3&to=2026Q4', ok({ stats: 'cohort', from: '2026Q3', to: '2026Q4' })],
    ...drops('mode', ['?v=1&stats=cohort&from=2026q3', '?v=1&stats=cohort&from=2026Q5'], { stats: 'cohort' }),
    ['?v=1&stats=projectTrack&from=4182&to=4182', ok({ stats: 'projectTrack', from: '4182', to: '4182' })],
    // alerts and alertTeam
    ['?v=1&alerts=off', ok({ alerts: 'off' })],
    ['?v=1&alerts=none', ok({ alerts: 'none' })],
    ['?v=1&alerts=blocked,missing', ok({ alerts: ['blocked', 'missing'] })],
    ['?v=1&alerts=blocked,blocked', ok({ alerts: ['blocked'] })],
    ...drops('focus', ['?v=1&alerts=blocked,bogus', '?v=1&alerts=Blocked', '?v=1&alerts=', '?v=1&alerts=off,blocked']),
    ['?v=1&alertTeam=blocked:t1', ok({ alertTeam: { anchor: 'blocked', id: 't1' } })],
    ['?v=1&alertTeam=followupEpics:Unknown%20Team', ok({ alertTeam: { anchor: 'followupEpics', id: 'Unknown Team' } })],
    ...drops('focus', ['?v=1&alertTeam=blocked', '?v=1&alertTeam=nope:x', '?v=1&alertTeam=blocked:', '?v=1&alertTeam=blocked:a:b']),
    // epic and story
    ['?v=1&epic=PROJ-1', ok({ focus: { kind: 'epic', key: 'PROJ-1' } })],
    ['?v=1&story=PROJ-12', ok({ focus: { kind: 'story', key: 'PROJ-12' } })],
    ...drops('focus', ['?v=1&story=proj-1', '?v=1&epic=A-1', '?v=1&epic=PROJ-1%22%5D']),
    ['?v=1&epic=../x', invalid('bad_character')],
    ['?v=1&story=PROJ-1&epic=PROJ-2', ok({ focus: { kind: 'story', key: 'PROJ-1' } }, ['focus'])],
    ['?v=1&epic=PROJ-2&story=PROJ-1', ok({ focus: { kind: 'epic', key: 'PROJ-2' } }, ['focus'])],
    ['?v=1&epic=bad&story=PROJ-1', ok({ focus: { kind: 'story', key: 'PROJ-1' } }, ['focus'])],
    ['?v=1&epic=PROJ-1&epic=PROJ-2', ok({ focus: { kind: 'epic', key: 'PROJ-1' } })],
    ['?v=1&alertTeam=blocked:t1&epic=PROJ-1', ok({ alertTeam: { anchor: 'blocked', id: 't1' }, focus: { kind: 'epic', key: 'PROJ-1' } })],
    // unknown keys, prototype keys, empty pairs, reported categories in link order
    ['?v=1&__proto__=x&constructor=y&mode=board', ok({ mode: 'board' })],
    ['?v=1&toString=x&hasOwnProperty=y&valueOf=z', ok()],
    ['?v=1&&mode=planning&', ok({ mode: 'planning' })],
    ['?v=1&novalue&mode=planning', ok({ mode: 'planning' })],
    ['?v=1&utm_source=chat&mode=planning', ok({ mode: 'planning' })],
    ['?v=1&Mode=board', ok()],
    ['?v=1&sort=bad&group=&mode=bad&sort=sprint', ok({}, ['filters', 'group', 'mode'])],
    // length, alphabet, pair count, fragment
    [FILLER_1536, ok()],
    [`${FILLER_1536}a`, invalid('too_long')],
    [`?v=1&${FORTY_PAIRS}`, ok()],
    [`?v=1&${FORTY_PAIRS}&k40=1`, invalid('too_many_pairs')],
    [`?v=2&${FORTY_PAIRS}`, NEWER],
    [`?v=2&${FORTY_PAIRS}&k40=1`, invalid('too_many_pairs')],
    [`?v=1&${FORTY_PAIRS}&&&`, ok()],
    ['?v=1&mode=board#top', invalid('bad_character')],
    ['?v=1&mode=board\n', invalid('bad_character')],
    [`?v=1&group=caf${E_ACUTE}`, invalid('bad_character')],
    ['?v=1&group=a+b', invalid('bad_character')],
];

test('decode: every reviewed vector', () => {
    for (const [search, expected] of DECODE_VECTORS) assert.deepEqual(decode(search), expected, search.slice(0, 120));
});

test('decode: non-string input is not a link', () => {
    for (const value of [undefined, null, 5, {}, []]) assert.deepEqual(decode(value), NONE);
});

test('decode: control, bidi and separator characters are dropped from atoms', () => {
    for (const bad of [BELL, C1_CONTROL, LINE_SEPARATOR, BIDI_OVERRIDE, '\n']) {
        const encoded = encodeURIComponent(`a${bad}b`);
        assert.deepEqual(decode(`?v=1&status=only:${encoded}`), ok({}, ['filters']), JSON.stringify(bad));
        assert.deepEqual(decode(`?v=1&group=${encoded}`), ok({}, ['group']), JSON.stringify(bad));
        assert.deepEqual(decode(`?v=1&teams=${encoded}`), ok({}, ['teams']), JSON.stringify(bad));
    }
});

test('decode: unknown and prototype keys never reach the state, and nothing throws on junk', () => {
    const result = decodeShareView('?v=1&__proto__=x&constructor=y&polluted=1&mode=board');
    assert.deepEqual(Object.keys(result.state).sort(), ['mode', 'version']);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    const known = new Set(['version', 'mode', 'focus', ...Object.keys(plain(defaults.SHARE_VIEW_CATEGORY_BY_KEY))]);
    const alphabet = ['v=1', '&', '=', ',', ':', '%', '%2C', '%E0', '%00', '-', '.', '~', 'a', 'Z', '0', 'mode', 'group', 'teams', 'status', 'only', 'all', '__proto__', 'epic', 'PROJ-1', 'alerts', 'off'];
    let seed = 7;
    const pick = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return alphabet[seed % alphabet.length]; };
    for (let run = 0; run < 2000; run += 1) {
        const search = `?v=1&${Array.from({ length: 1 + (run % 24) }, pick).join('')}`;
        const decoded = decodeShareView(search);
        assert.ok(['ok', 'invalid'].includes(decoded.kind), search);
        if (decoded.kind === 'ok') for (const key of Object.keys(decoded.state)) assert.ok(known.has(key), `${search}: ${key}`);
    }
});

test('decode: %2C stays inside an atom while a raw comma splits (the platform parser cannot tell them apart)', () => {
    assert.equal(new URLSearchParams('teams=a%2Cb,c').get('teams'), 'a,b,c');
    assert.deepEqual(decode('?v=1&teams=a%2Cb,c').state.teams, ['a,b', 'c']);
    assert.equal(new URLSearchParams('group=a+b').get('group'), 'a b');
    assert.equal(decode('?v=1&group=a+b').kind, 'invalid');
});

// ---- Encode vectors --------------------------------------------------------------------------

// [vector, state patch over BASE, query tail after the head, expected dropped keys]
const ENCODE_VECTORS = [
    ['status {hidden:[Killed]} is the default and is omitted', { status: { hidden: ['Killed'] } }, '', []],
    ['status null is the neutral all', { status: null }, '&status=all', []],
    ['status only', { status: { only: ['In Progress', 'To Do'] } }, '&status=only:In%20Progress,To%20Do', []],
    ['status hidden with comma and quote', { status: { hidden: ['Ready, set', "Won't Do"] } }, '&status=hide:Ready%2C%20set,Won%27t%20Do', []],
    ['status only, non-ASCII', { status: { only: [`Termin${E_ACUTE}`, KANJI] } }, '&status=only:Termin%C3%A9,%E5%AE%8C%E4%BA%86', []],
    ['status hidden Killed plus another is not the default', { status: { hidden: ['Killed', 'Done'] } }, '&status=hide:Killed,Done', []],
    ['status only Killed is not the default', { status: { only: ['Killed'] } }, '&status=only:Killed', []],
    ['priority null is the default', { priority: null }, '', []],
    ['priority hidden', { priority: { hidden: ['Trivial', 'Low'] } }, '&priority=hide:Trivial,Low', []],
    ['team with a double colon', { teams: ['team::orbit'] }, '&teams=team%3A%3Aorbit', []],
    ['group with a slash is in the head', { group: 'dept/a' }, '', []],
    ['alertTeam for a group named Unknown Team', { alertTeam: { anchor: 'blocked', id: 'Unknown Team' } }, '&alertTeam=blocked:Unknown%20Team', []],
    ['unknown state keys are ignored', { bogus: 1, constructor: 2 }, '', []],
    ['teams all is the default', { teams: ['all'] }, '', []],
    ['teams containing all is the default, never an explicit list', { teams: ['t1', 'all'] }, '', []],
    ['teams explicit list is never collapsed', { teams: ['t1', 't2'] }, '&teams=t1,t2', []],
    ['teams are deduplicated', { teams: ['t1', 't1'] }, '&teams=t1', []],
    ['track undefined is the default', { track: undefined }, '', []],
    ['track none', { track: [] }, '&track=none', []],
    ['track one', { track: ['flexible'] }, '&track=flexible', []],
    ['lanes both on is the default', { lanes: { product: true, tech: true } }, '', []],
    ['lanes tech only', { lanes: { product: false, tech: true } }, '&lanes=tech', []],
    ['lanes product only', { lanes: { product: true, tech: false } }, '&lanes=product', []],
    ['initiatives null is the default', { initiatives: null }, '', []],
    ['initiatives off', { initiatives: false }, '&initiatives=0', []],
    ['initiatives on', { initiatives: true }, '&initiatives=1', []],
    ['sort priority is the default', { sort: 'priority' }, '', []],
    ['sort status', { sort: 'status' }, '&sort=status', []],
    ['alerts all ten expanded is the default', { alerts: [...defaults.SHARE_VIEW_ALERT_KEYS] }, '', []],
    ['alerts none', { alerts: 'none' }, '&alerts=none', []],
    ['alerts empty list is none', { alerts: [] }, '&alerts=none', []],
    ['alerts off', { alerts: 'off' }, '&alerts=off', []],
    ['alerts subset keeps order', { alerts: ['done', 'blocked'] }, '&alerts=done,blocked', []],
    ['focus epic', { focus: { kind: 'epic', key: 'PROJ-1' } }, '&epic=PROJ-1', []],
    ['focus story', { focus: { kind: 'story', key: 'PROJ-12' } }, '&story=PROJ-12', []],
    ['a query ending in a dot ends in %2E', { teams: ['v2.'] }, '&teams=v2%2E', []],
    ['a dot that does not end the query stays a dot', { teams: ['a.'], sort: 'status' }, '&teams=a.&sort=status', []],
    ['keys are written in the documented order', {
        sort: 'status', initiatives: true, lanes: { product: false, tech: true }, track: [], priority: null, status: null, teams: ['t1'],
    }, '&teams=t1&status=all&track=none&lanes=tech&initiatives=1&sort=status', []],
];

test('encode: every reviewed vector, without mutating its input', () => {
    for (const [name, patch, tail, dropped] of ENCODE_VECTORS) {
        const state = deepFreeze({ ...BASE, ...patch });
        const before = plain(state);
        assert.deepEqual(encode(state), { ok: true, query: head() + tail, dropped }, name);
        assert.deepEqual(plain(state), before, name);
    }
});

test('encode: atoms use only the unreserved alphabet plus uppercase percent escapes', () => {
    const everything = [...'!"#$%&\'()*+,/:;<=>?@[]^`{|}~ -_.'].join('');
    const result = encode({ ...BASE, group: `g${everything}`, teams: [`t${everything}`] });
    assert.equal(result.ok, true);
    assert.match(result.query, /^[A-Za-z0-9._~%&=,:-]+$/);
    assert.doesNotMatch(result.query, /%[0-9A-F]?[a-f]/);
    for (const char of '!\'()*') assert.equal(result.query.includes(char), false, char);
    assert.deepEqual(decode(`?${result.query}`).state.teams, [`t${everything}`]);
    assert.equal(decode(`?${result.query}`).state.group, `g${everything}`);
});

test('encode: the length budgets computed in the design review', () => {
    assert.equal(encode({ ...BASE, group: 'engineering-dept-alpha', teams: UUIDS }).query.length, 508);
    assert.equal(`teams=${UUIDS.join(',')}`.length, 449);
    const nine = defaults.SHARE_VIEW_ALERT_KEYS.filter((key) => key !== 'empty');
    assert.equal(`&alerts=${nine.join(',')}`.length, 92);
});

// ---- Round trips: decode(encode(x)) equals x for every key -----------------------------------

// Each state holds only non-default values (a Lead Times range is always written), so the decoded
// state equals it exactly.
const EVERY_KEY = [
    ['catch-up teams', { teams: ['t1', 'team::orbit'] }],
    ['catch-up status only', { status: { only: ['In Progress'] } }],
    ['catch-up status hidden', { status: { hidden: ['Killed', 'Done'] } }],
    ['catch-up status all', { status: null }],
    ['catch-up priority only', { priority: { only: ['Blocker', 'Critical'] } }],
    ['catch-up priority hidden', { priority: { hidden: ['Trivial'] } }],
    ['catch-up track none', { track: [] }],
    ['catch-up track committed', { track: ['committed'] }],
    ['catch-up track both', { track: ['committed', 'flexible'] }],
    ['catch-up lanes product', { lanes: { product: true, tech: false } }],
    ['catch-up lanes tech', { lanes: { product: false, tech: true } }],
    ['catch-up initiatives on', { initiatives: true }],
    ['catch-up initiatives off', { initiatives: false }],
    ...defaults.SHARE_VIEW_SORTS.filter((sort) => sort !== 'priority').map((sort) => [`catch-up sort ${sort}`, { sort }]),
    ['catch-up alerts off', { alerts: 'off' }],
    ['catch-up alerts none', { alerts: 'none' }],
    ['catch-up alerts subset', { alerts: ['blocked', 'missing', 'followup'] }],
    ['catch-up alertTeam', { alerts: ['blocked'], alertTeam: { anchor: 'blocked', id: uuid(7) } }],
    ['catch-up alertTeam followupEpics', { alertTeam: { anchor: 'followupEpics', id: 'unknown' } }],
    ['catch-up epic focus', { focus: { kind: 'epic', key: 'PROJ-1' } }],
    ['catch-up story focus', { focus: { kind: 'story', key: 'PROJ_X2-4096' } }],
    ['planning layout list', { mode: 'planning', layout: 'list' }],
    ['planning rows story', { mode: 'planning', rows: 'story' }],
    ['planning list initiatives and sort', { mode: 'planning', layout: 'list', initiatives: false, sort: 'track-committed' }],
    ['planning epic focus', { mode: 'planning', focus: { kind: 'epic', key: 'PROJ-1' } }],
    ['planning teams and facets', { mode: 'planning', teams: ['t1'], status: null, priority: { only: ['Major'] }, track: ['flexible'], lanes: { product: false, tech: true } }],
    ['board scope component', { mode: 'board', scope: 'component' }],
    ['board scope all_work', { mode: 'board', scope: 'all_work' }],
    ...defaults.SHARE_VIEW_STATS_VIEWS.filter((stats) => stats !== 'teams').map((stats) => [`statistics ${stats}`, { mode: 'statistics', stats }]),
    ['statistics teams view with teams', { mode: 'statistics', teams: ['t1', 't2'] }],
    ['statistics burnout with teams', { mode: 'statistics', stats: 'burnout', teams: ['t1'] }],
    ['statistics cohort range', { mode: 'statistics', stats: 'cohort', teams: ['t1'], from: '2025Q4', to: '2026Q2' }],
    ['statistics projectTrack range', { mode: 'statistics', stats: 'projectTrack', from: '4100', to: '4182' }],
    ['statistics excludedCapacity range', { mode: 'statistics', stats: 'excludedCapacity', from: '4182', to: '4190' }],
    ['statistics monoCrossShare range', { mode: 'statistics', stats: 'monoCrossShare', from: '4000', to: '4182' }],
];

const withMode = (patch) => ({ ...BASE, ...patch });

function assertRoundTrip(label, state) {
    const first = encode(state);
    assert.equal(first.ok, true, label);
    assert.deepEqual(first.dropped, [], label);
    assert.ok(first.query.length <= SHARE_VIEW_MAX_QUERY, label);
    const decoded = plain(decodeShareView(`?${first.query}`));
    assert.equal(decoded.kind, 'ok', label);
    assert.deepEqual(decoded.reported, [], label);
    assert.deepEqual(decoded.state, plain(state), label);
    assert.equal(encode(decoded.state).query, first.query, `${label}: encode(decode(q)) is a fixed point`);
    return first.query;
}

const FULL_STATES = {
    catchUp: withMode({
        group: uuid(99),
        teams: UUIDS,
        status: { only: ['To Do', 'Analysis', 'Accepted', 'Pending', 'Blocked', 'In Progress', 'In Review', 'Release', 'Done', 'Incomplete', 'Postponed', "Won't Do"] },
        priority: { hidden: ['Trivial', 'Low'] },
        track: ['committed'],
        lanes: { product: false, tech: true },
        initiatives: true,
        sort: 'track-flexible',
        alerts: defaults.SHARE_VIEW_ALERT_KEYS.filter((key) => key !== 'empty'),
        alertTeam: { anchor: 'blocked', id: uuid(5) },
    }),
    planningTable: withMode({
        mode: 'planning', group: uuid(99), teams: UUIDS, status: { hidden: ['Killed', 'Done'] }, priority: { only: ['Blocker'] },
        track: [], lanes: { product: true, tech: false }, rows: 'story', focus: { kind: 'story', key: 'PROJ-12' },
    }),
    planningList: withMode({
        mode: 'planning', group: uuid(99), teams: UUIDS, status: null, priority: { hidden: ['Low'] },
        track: ['flexible'], lanes: { product: false, tech: true }, layout: 'list', initiatives: true, sort: 'status', focus: { kind: 'epic', key: 'PROJ-1' },
    }),
    board: withMode({ mode: 'board', group: uuid(99), scope: 'all_work' }),
    statistics: withMode({ mode: 'statistics', group: uuid(99), stats: 'cohort', teams: UUIDS, from: '2025Q3', to: '2026Q4' }),
};

test('round trip: every key, one at a time', () => {
    for (const [label, patch] of EVERY_KEY) assertRoundTrip(label, withMode(patch));
});

test('round trip: worst-case full Catch Up, Planning, Board and Statistics states', () => {
    const lengths = Object.entries(FULL_STATES).map(([label, state]) => assertRoundTrip(label, state).length);
    assert.ok(lengths[0] > 800 && lengths[0] <= SHARE_VIEW_MAX_QUERY, `catch-up worst case is ${lengths[0]} chars`);
});

test('Lead Times always writes its range, even the default one, and the link round trips', () => {
    const cohort = { ...BASE, mode: 'statistics', stats: 'cohort' };
    const { from, to } = plain(defaults.SHARE_VIEW_DEFAULTS.quarterRange());
    assert.equal(encode({ ...cohort, from, to }).query, `${head('statistics')}&stats=cohort&from=${from}&to=${to}`);
    assertRoundTrip('the default range', { ...cohort, from, to });
    for (const quarter of ['2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1', '2026Q2', '2026Q3', '2026Q4']) {
        assertRoundTrip(`the single quarter ${quarter}`, { ...cohort, from: quarter, to: quarter });
    }
    assertRoundTrip('a range with Teams', { ...cohort, from: '2025Q3', to: '2026Q2', teams: ['t1'] });
});

test('the same Lead Times state encodes to the same link under any clock', () => {
    const encoders = [fixedDate(2026, 7, 15, 12), fixedDate(2026, 9, 15, 12)]
        .map((fixed) => loadModule('shareView/codec.js', { Date: fixed }).encodeShareView);
    // A state with no range writes none: the encoder never fills one in from the clock.
    for (const range of [{}, { from: '2026Q3', to: '2026Q3' }, { from: '2026Q4', to: '2026Q4' }, { from: '2025Q1', to: '2026Q2' }]) {
        const state = { ...BASE, mode: 'statistics', stats: 'cohort', ...range };
        const queries = encoders.map((run) => plain(run(state)).query);
        assert.deepEqual(queries, [queries[0], queries[0]]);
        assert.equal(queries[0], `${head('statistics')}&stats=cohort${range.from ? `&from=${range.from}&to=${range.to}` : ''}`);
    }
});

test('a Sprint range equal to the link Sprint is omitted and any other is written', () => {
    for (const stats of ['excludedCapacity', 'monoCrossShare', 'projectTrack']) {
        const view = { ...BASE, mode: 'statistics', stats };
        const base = `${head('statistics')}&stats=${stats}`;
        assert.equal(encode({ ...view, from: '4182', to: '4182' }).query, base, stats);
        assert.equal(encode({ ...view, from: '4100', to: '4182' }).query, `${base}&from=4100&to=4182`, stats);
        assert.equal(encode({ ...view, from: '4182', to: '4190' }).query, `${base}&from=4182&to=4190`, stats);
    }
    assert.deepEqual(plain(defaults.SHARE_VIEW_DEFAULTS.sprintRange('4182')), { from: '4182', to: '4182' });
});

// A deterministic property run: random valid states built from awkward text round trip.
function mulberry32(seed) {
    let state = seed;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const AWKWARD_PIECES = ['a', 'B', '7', ' ', ',', ':', '%', '+', "'", '"', '(', ')', '*', '!', '.', '~', '-', '_', '/', '&', '=', '#', `caf${E_ACUTE}`, KANJI, EMOJI];

test('round trip: 400 random states built from awkward text', () => {
    const random = mulberry32(194);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const text = (max) => {
        let value = '';
        for (let index = Math.floor(random() * max) + 1; index > 0; index -= 1) value += pick(AWKWARD_PIECES);
        return value.trim() ? value : 'x';
    };
    const unique = (make, count) => [...new Set(Array.from({ length: count }, make))];
    for (let run = 0; run < 400; run += 1) {
        const state = {
            ...BASE,
            group: text(40),
            teams: unique(() => `t${text(8)}`, 1 + Math.floor(random() * 6)),
            status: pick([null, { only: unique(() => text(10), 3) }, { hidden: unique(() => text(10), 3) }]),
            priority: pick([undefined, { only: ['Blocker', 'Low'] }, { hidden: unique(() => text(6), 2) }]),
            track: pick([undefined, [], ['committed'], ['flexible', 'committed']]),
            alerts: pick([undefined, 'off', 'none', ['blocked', 'done']]),
            alertTeam: pick([undefined, { anchor: pick(defaults.SHARE_VIEW_ALERT_ANCHORS), id: text(20) }]),
        };
        if (state.alerts === 'off') delete state.alertTeam;
        for (const key of Object.keys(state)) if (state[key] === undefined) delete state[key];
        const result = encodeShareView(state);
        assert.equal(result.ok, true, JSON.stringify(state));
        const decoded = plain(decodeShareView(`?${result.query}`));
        assert.deepEqual(decoded.state, plain(state), JSON.stringify(state));
        assert.deepEqual(decoded.reported, []);
        assert.equal(plain(encodeShareView(decoded.state)).query, result.query);
    }
});

// ---- Applicability and defaults --------------------------------------------------------------

test('encode: keys outside the mode are neither written nor dropped', () => {
    const extras = {
        teams: ['t1'], status: null, priority: { only: ['Low'] }, track: [], lanes: { product: false, tech: true }, initiatives: true,
        sort: 'status', alerts: 'off', focus: { kind: 'epic', key: 'PROJ-1' }, layout: 'list', rows: 'story', stats: 'burnout', from: '4100', to: '4182',
        scope: 'component',
    };
    const only = (mode, keys) => {
        const state = { ...BASE, mode };
        keys.forEach((key) => { state[key] = extras[key]; });
        return state;
    };
    assert.deepEqual(encode(only('board', Object.keys(extras))), { ok: true, query: `${head('board')}&scope=component`, dropped: [] });
    assert.equal(encode(only('catch-up', Object.keys(extras))).query,
        `${head()}&teams=t1&status=all&priority=only:Low&track=none&lanes=tech&initiatives=1&sort=status&alerts=off&epic=PROJ-1`);
    assert.equal(encode({ ...only('statistics', Object.keys(extras)), stats: 'teams' }).query, `${head('statistics')}&teams=t1`);
    assert.equal(encode(only('statistics', Object.keys(extras))).query, `${head('statistics')}&stats=burnout&teams=t1`);
});

test('encode: Planning keys follow the layout and Statistics keys follow the view', () => {
    const planning = { ...BASE, mode: 'planning', rows: 'story', initiatives: true, sort: 'status' };
    assert.equal(encode(planning).query, `${head('planning')}&rows=stories`);
    assert.equal(encode({ ...planning, layout: 'table' }).query, `${head('planning')}&rows=stories`);
    assert.equal(encode({ ...planning, layout: 'list' }).query, `${head('planning')}&layout=list&initiatives=1&sort=status`);
    const stats = { ...BASE, mode: 'statistics', teams: ['t1'], from: '4100', to: '4182' };
    assert.equal(encode({ ...stats, stats: 'teams' }).query, `${head('statistics')}&teams=t1`);
    assert.equal(encode({ ...stats, stats: 'priority' }).query, `${head('statistics')}&stats=priority&teams=t1`);
    assert.equal(encode({ ...stats, stats: 'excludedCapacity' }).query, `${head('statistics')}&stats=excludedCapacity&from=4100&to=4182`);
    assert.equal(encode({ ...stats, stats: 'cohort', from: '2026Q1', to: '2026Q2' }).query,
        `${head('statistics')}&stats=cohort&from=2026Q1&to=2026Q2&teams=t1`);
});

test('encode: a link with only the always-written keys is the minimal link', () => {
    for (const mode of defaults.SHARE_VIEW_MODES) assert.deepEqual(encode({ ...BASE, mode }), { ok: true, query: head(mode), dropped: [] });
});

// ---- Invalid state, unrepresentable values, over the cap -------------------------------------

const INVALID_STATES = [
    ['null', null], ['an array', []], ['a string', 'v=1'], ['a number', 1],
    ['no version', { mode: 'catch-up', group: 'g', sprint: '1' }],
    ['version 2', { ...BASE, version: 2 }],
    ['version as text', { ...BASE, version: '1' }],
    ['scenario mode', { ...BASE, mode: 'scenario' }],
    ['epm mode', { ...BASE, mode: 'epm' }],
    ['no mode', { version: 1, group: 'g', sprint: '1' }],
    ['no group', { ...BASE, group: undefined }],
    ['empty group', { ...BASE, group: '' }],
    ['blank group', { ...BASE, group: '   ' }],
    ['group over 255 code points', { ...BASE, group: 'a'.repeat(256) }],
    ['group with a control character', { ...BASE, group: `a${BELL}` }],
    ['group with a bidi override', { ...BASE, group: `a${BIDI_OVERRIDE}` }],
    ['group with a lone surrogate', { ...BASE, group: `a${LONE_SURROGATE}` }],
    ['group that is not text', { ...BASE, group: 5 }],
    ['no sprint', { ...BASE, sprint: undefined }],
    ['sprint with a leading zero', { ...BASE, sprint: '0042' }],
    ['sprint as a number', { ...BASE, sprint: 4182 }],
    ['sprint over 12 digits', { ...BASE, sprint: '1234567890123' }],
];

test('encode: an invalid required key is invalid_state', () => {
    for (const [name, state] of INVALID_STATES) assert.deepEqual(encode(state), { ok: false, reason: 'invalid_state' }, name);
});

// [mode, state patch, dropped keys]: each value the decoder would report is left out and named.
const UNREPRESENTABLE = [
    ['catch-up', { teams: [] }, ['teams']],
    ['catch-up', { teams: 't1' }, ['teams']],
    ['catch-up', { teams: UUIDS.concat(uuid(13)) }, ['teams']],
    ['catch-up', { teams: [`t${BELL}`] }, ['teams']],
    ['catch-up', { teams: [`t${LONE_SURROGATE}`] }, ['teams']],
    ['catch-up', { status: { only: [] } }, ['status']],
    ['catch-up', { status: { only: ['a'], hidden: ['b'] } }, ['status']],
    ['catch-up', { status: { other: ['a'] } }, ['status']],
    ['catch-up', { status: 'all' }, ['status']],
    ['catch-up', { status: { only: Array.from({ length: 21 }, (_, index) => `s${index}`) } }, ['status']],
    ['catch-up', { status: { only: ['a'.repeat(101)] } }, ['status']],
    ['catch-up', { status: { hidden: [`a${BELL}`] } }, ['status']],
    ['catch-up', { priority: { only: [] } }, ['priority']],
    ['catch-up', { track: ['Committed'] }, ['track']],
    ['catch-up', { track: 'none' }, ['track']],
    ['catch-up', { track: null }, ['track']],
    ['catch-up', { lanes: { product: false, tech: false } }, ['lanes']],
    ['catch-up', { lanes: { product: true } }, ['lanes']],
    ['catch-up', { initiatives: 'yes' }, ['initiatives']],
    ['catch-up', { sort: 'Priority' }, ['sort']],
    ['catch-up', { alerts: ['bogus'] }, ['alerts']],
    ['catch-up', { alerts: 'maybe' }, ['alerts']],
    ['catch-up', { alertTeam: { anchor: 'nope', id: 'x' } }, ['alertTeam']],
    ['catch-up', { alertTeam: { anchor: 'blocked', id: '' } }, ['alertTeam']],
    ['catch-up', { alerts: 'off', alertTeam: { anchor: 'blocked', id: 't1' } }, ['alertTeam']],
    ['catch-up', { focus: { kind: 'epic', key: 'a-1' } }, ['focus']],
    ['catch-up', { focus: { kind: 'sprint', key: 'PROJ-1' } }, ['focus']],
    ['catch-up', { alertTeam: { anchor: 'blocked', id: 't1' }, focus: { kind: 'epic', key: 'PROJ-1' } }, ['focus']],
    ['planning', { layout: 'grid' }, ['layout']],
    ['planning', { rows: 'epics' }, ['rows']],
    ['board', { scope: 'all-work' }, ['scope']],
    ['statistics', { stats: 'burndown' }, ['stats']],
    ['statistics', { stats: 'cohort', from: '2026Q3' }, ['from']],
    ['statistics', { stats: 'cohort', from: '4100', to: '4182' }, ['from', 'to']],
    ['statistics', { stats: 'projectTrack', from: '2026Q3', to: '2026Q4' }, ['from', 'to']],
    ['statistics', { stats: 'projectTrack', from: '04100', to: '4182' }, ['from', 'to']],
];

test('encode: values the decoder would report are omitted and named, never written', () => {
    for (const [mode, patch, dropped] of UNREPRESENTABLE) {
        const label = `${mode} ${JSON.stringify(patch)}`;
        const result = encode({ ...BASE, mode, ...patch });
        assert.equal(result.ok, true, label);
        assert.deepEqual(result.dropped, dropped, label);
        const decoded = decode(`?${result.query}`);
        assert.equal(decoded.kind, 'ok', label);
        assert.deepEqual(decoded.reported, [], `${label}: the link must decode with nothing reported`);
        for (const key of dropped) assert.equal(Object.hasOwn(decoded.state, key), false, `${label}: ${key}`);
    }
});

test('encode: junk values never throw and never produce a link the decoder would report on', () => {
    const junk = [
        undefined, null, 0, 1, NaN, '', ' ', 'x', 'all', [], [1], [null], ['a'], {}, { only: 1 }, { hidden: ['a'] }, { product: 'x' },
        { product: true, tech: true }, true, () => 1, { anchor: 'blocked' }, { kind: 'epic' }, { kind: 'story', key: 'PROJ-1' }, 'ab'.repeat(300),
    ];
    const keys = ['scope', 'teams', 'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'layout', 'rows', 'stats', 'from', 'to', 'alerts', 'alertTeam', 'focus'];
    const random = mulberry32(7);
    for (let run = 0; run < 3000; run += 1) {
        const state = { ...BASE, mode: defaults.SHARE_VIEW_MODES[Math.floor(random() * 4)] };
        for (const key of keys) if (random() < 0.35) state[key] = junk[Math.floor(random() * junk.length)];
        const result = encode(state);
        if (!result.ok) {
            assert.ok(['too_long', 'invalid_state'].includes(result.reason), JSON.stringify(result));
            continue;
        }
        assert.deepEqual(decode(`?${result.query}`).reported, [], result.query);
        assert.equal(decode(`?${result.query}`).kind, 'ok', result.query);
    }
});

// A Catch Up state whose query is exactly `length` characters: a padded group id sets the length.
const fillerAtoms = (count) => Array.from({ length: count }, (_, index) => `${String(index).padStart(3, '0')}${'x'.repeat(97)}`);
function coreOfLength(length) {
    const core = { ...BASE, group: 'g', status: { only: fillerAtoms(14) } };
    const short = encodeShareView(core).query.length;
    return { ...core, group: 'g'.repeat(1 + length - short) };
}
const without = (state, keys) => {
    const copy = { ...state };
    keys.forEach((key) => delete copy[key]);
    return copy;
};

test('over the cap: the encoder drops the focus keys, alerts, initiatives, sort in that order', () => {
    const droppable = { alertTeam: { anchor: 'blocked', id: 't1' }, alerts: ['blocked'], initiatives: true, sort: 'track-flexible' };
    // Dropped-key text: &alertTeam=blocked:t1 21, &alerts=blocked 15, &initiatives=1 14, &sort=track-flexible 20.
    const tiers = [
        [1480, ['alertTeam']],
        [1495, ['alertTeam', 'alerts']],
        [1510, ['alertTeam', 'alerts', 'initiatives']],
        [1530, ['alertTeam', 'alerts', 'initiatives', 'sort']],
    ];
    for (const [length, dropped] of tiers) {
        const core = coreOfLength(length);
        assert.equal(encode(core).query.length, length, 'the core has the intended length');
        const state = { ...core, ...droppable };
        const result = encode(state);
        assert.deepEqual(result, { ok: true, query: encode(without(state, dropped)).query, dropped }, `core ${length}`);
        assert.ok(result.query.length <= SHARE_VIEW_MAX_QUERY, `core ${length}`);
        assert.equal(plain(decodeShareView(`?${result.query}`)).kind, 'ok');
    }
});

test('over the cap: an Epic or Story focus goes before alerts, and only as much is dropped as needed', () => {
    const state = (length) => ({ ...coreOfLength(length), focus: { kind: 'epic', key: 'PROJ-1' }, alerts: ['blocked'] });
    assert.deepEqual(encode(state(1520)).dropped, ['focus']);
    assert.match(encode(state(1520)).query, /&alerts=blocked$/);
    assert.deepEqual(encode(state(1530)).dropped, ['focus', 'alerts']);
    assert.doesNotMatch(encode(state(1530)).query, /epic=|alerts=/);
});

test('over the cap: a link that fits is untouched at exactly 1536 characters', () => {
    const core = coreOfLength(1536);
    assert.deepEqual(encode(core), { ok: true, query: encode(core).query, dropped: [] });
    assert.equal(encode(core).query.length, 1536);
});

test('over the cap: scope keys are never dropped and nothing is truncated (too_long)', () => {
    const result = encode({ ...coreOfLength(1537), sort: 'status', alerts: 'none', initiatives: true, focus: { kind: 'story', key: 'PROJ-1' } });
    assert.deepEqual(result, { ok: false, reason: 'too_long' });
    assert.equal(Object.hasOwn(result, 'query'), false);
    // Scope keys alone can exceed the cap: twelve long Team ids.
    const teams = Array.from({ length: 12 }, (_, index) => `${index}${'t'.repeat(150)}`);
    assert.deepEqual(encode({ ...BASE, teams }), { ok: false, reason: 'too_long' });
});

test('over the cap: the surviving link keeps every scope key', () => {
    const state = { ...coreOfLength(1500), teams: ['t1'], alerts: ['blocked'], sort: 'track-flexible' };
    const result = encode(state);
    assert.deepEqual(result.dropped, ['alerts']);
    const decoded = decode(`?${result.query}`);
    assert.deepEqual(decoded.state.teams, ['t1']);
    assert.equal(decoded.state.group, state.group);
    assert.deepEqual(decoded.state.status, state.status);
    assert.equal(decoded.state.sort, 'track-flexible');
});

// ---- RF4: awkward ids round trip and still pass the stash pattern ----------------------------

const AWKWARD_IDS = ['a,b', 'team::orbit', '100%', 'x+y', "it's", `Caf${E_ACUTE} ${KANJI}`, 'two words', 'a=b&c', 'dot.', 'wild*(card)!'];
const AWKWARD_STATE = {
    ...BASE,
    group: `Dept, A: 100% + Ops's Caf${E_ACUTE} ${KANJI}`,
    teams: AWKWARD_IDS,
    status: { only: AWKWARD_IDS.slice(0, 5) },
    priority: { hidden: AWKWARD_IDS.slice(5) },
    alerts: ['blocked'],
    alertTeam: { anchor: 'blocked', id: AWKWARD_IDS[1] },
};

test('RF4: ids with comma, colon, percent, plus, quote, space and non-ASCII round trip and match the stash pattern', () => {
    assert.match(assertRoundTrip('awkward ids', AWKWARD_STATE), stashPattern());
});

// ---- strip -----------------------------------------------------------------------------------

test('strip: removes every link key and keeps other params verbatim', () => {
    assert.equal(stripShareViewParams('?v=1&mode=board&group=a&sprint=1'), '');
    assert.equal(stripShareViewParams('?v=1&mode=board&perf=1'), '?perf=1');
    assert.equal(stripShareViewParams('?perf=1&v=1&x=a%2Bb&status=all&epic=PROJ-1'), '?perf=1&x=a%2Bb');
    assert.equal(stripShareViewParams('?a=b'), '?a=b');
    assert.equal(stripShareViewParams('?a=1&&b=2'), '?a=1&&b=2');
    assert.equal(stripShareViewParams(''), '');
    assert.equal(stripShareViewParams('?'), '?');
    assert.equal(stripShareViewParams('?v=1&&perf=1&'), '?perf=1');
    assert.equal(stripShareViewParams('?Mode=board&q=x'), '?Mode=board&q=x');
    assert.equal(stripShareViewParams('?v&mode'), '');
    assert.equal(stripShareViewParams(undefined), '');
    for (const key of codec.SHARE_VIEW_QUERY_KEYS) assert.equal(stripShareViewParams(`?${key}=1&keep=2`), '?keep=2', key);
});

// ---- V11: no ids, names or tokens in the link ------------------------------------------------

// The literal set of names backend/config/view_validation.py refuses in a saved view payload. If a
// refactor moves or reshapes it, this read fails with a message instead of the test going vacuous.
function forbiddenViewPayloadKeys() {
    const source = fs.readFileSync(VIEW_VALIDATION_PATH, 'utf8');
    const start = source.indexOf('FORBIDDEN_VIEW_PAYLOAD_KEYS = (');
    const end = start < 0 ? -1 : source.indexOf('\n)\n', start);
    const open = end < 0 ? -1 : source.indexOf('{', start);
    const close = open < 0 || open > end ? -1 : source.indexOf('}', open);
    if (close < 0 || close > end) {
        throw new Error('backend/config/view_validation.py: the literal { ... } block of FORBIDDEN_VIEW_PAYLOAD_KEYS was not found; update this test to read its new definition');
    }
    const names = [...source.slice(open, close).matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const anchor of ['workspaceId', 'accountId', 'cloudId', 'siteUrl', 'userId', 'password', 'secret', 'credential', 'service_integration_tokens']) {
        if (!names.includes(anchor)) {
            throw new Error(`backend/config/view_validation.py: ${anchor} is missing from the FORBIDDEN_VIEW_PAYLOAD_KEYS block this test read; update this test if the block moved`);
        }
    }
    return names;
}

test('V11: no id, name or token key can appear in a link (parity with FORBIDDEN_VIEW_PAYLOAD_KEYS)', () => {
    const forbidden = forbiddenViewPayloadKeys();
    const names = forbidden.map((name) => name.toLowerCase());
    for (const key of plain(codec.SHARE_VIEW_QUERY_KEYS)) {
        assert.equal(names.includes(key.toLowerCase()), false, `link key ${key} is a forbidden payload key`);
        for (const part of ['token', 'secret', 'password', 'credential', 'workspace', 'cloud', 'site', 'account', 'user']) {
            assert.equal(key.toLowerCase().includes(part), false, `link key ${key} contains ${part}`);
        }
    }
    const extras = Object.fromEntries(forbidden.map((name) => [name, `x-${name}`]));
    for (const [label, state] of Object.entries(FULL_STATES)) {
        const written = `?${encode(state).query}`.toLowerCase();
        for (const name of names) assert.equal(written.includes(`?${name}=`) || written.includes(`&${name}=`), false, `${label} writes ${name}`);
        // A state that carries every forbidden name as an extra property still encodes to the same link.
        assert.deepEqual(encode({ ...state, ...extras }), encode(state), `${label} with forbidden names as extra state keys`);
    }
});

// ---- Shared corpus (tests/fixtures/share-view-query-corpus-example-sanitized.json) -----------

// Every encoder output this file can produce: the encode vectors, every key, the full states,
// the awkward ids, and a link at the cap.
function allEncoderQueries() {
    const states = [
        ...ENCODE_VECTORS.map(([, patch]) => ({ ...BASE, ...patch })),
        ...EVERY_KEY.map(([, patch]) => withMode(patch)),
        ...Object.values(FULL_STATES),
        AWKWARD_STATE,
        { ...BASE, group: uuid(99), teams: UUIDS },
        coreOfLength(1536),
    ];
    return states.map((state) => {
        const result = encode(state);
        assert.equal(result.ok, true, JSON.stringify(state).slice(0, 160));
        return result.query;
    });
}

test('corpus: the codec cap equals the stash cap and every encoder output matches the stash pattern', () => {
    assert.equal(readCorpus().maxQueryBytes, SHARE_VIEW_MAX_QUERY);
    const queries = allEncoderQueries();
    assert.ok(queries.length > 60, `only ${queries.length} encoder outputs were produced`);
    for (const query of queries) assert.match(query, stashPattern(), query.slice(0, 160));
});

test('corpus: queries the stash accepts are never invalid links', () => {
    const fixture = readCorpus();
    assert.ok(fixture.accepts.length > 0);
    for (const query of fixture.accepts) {
        assert.match(query, stashPattern(), query.slice(0, 160));
        const { kind } = decode(`?${query}`);
        assert.ok(kind === 'ok' || kind === 'newer', `${query.slice(0, 160)} decodes to ${kind}`);
    }
});

// What the decoder does with a query the stash refuses, by class:
//   no leading `v=`                                  kind 'none'
//   a character outside [A-Za-z0-9._~%&=,:-] (raw    kind 'invalid'
//     LF or CR, plus, quotes, hash, backslash, slash,
//     at sign, bidi, non-ASCII), more than 1,536
//     characters, 41 further pairs, a bad version
//   a percent-encoded control (%00-%1F, %7F) in a     kind 'ok' with that key dropped and its category
//     known key                                       reported (the stash is stricter than the decoder)
//   anything else (an unknown or malformed key)       kind 'ok'; no hostile text reaches the state
function expectedRejectKind(query) {
    if (!query.startsWith('v=')) return 'none';
    if (query.length > SHARE_VIEW_MAX_QUERY || /[^A-Za-z0-9._~%&=,:-]/.test(query)) return 'invalid';
    if (query.split('&').filter(Boolean).length - 1 > 40) return 'invalid';
    if (!/^v=[1-9][0-9]{0,2}(&|$)/.test(query)) return 'invalid';
    return 'ok';
}

const hasControl = (text) => Array.from(text).some((char) => char.codePointAt(0) < 0x20 || (char.codePointAt(0) >= 0x7F && char.codePointAt(0) <= 0x9F));

function textsIn(value) {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') return Object.values(value).flatMap(textsIn);
    return [];
}

test('corpus: every query the stash rejects is not applied by the decoder', () => {
    const fixture = readCorpus();
    assert.ok(fixture.rejects.length >= 10, 'the corpus needs a real set of rejected queries');
    const kinds = new Set();
    for (const { query, why } of fixture.rejects) {
        const label = `${why}: ${JSON.stringify(query.slice(0, 100))}`;
        const result = decode(`?${query}`);
        const expected = expectedRejectKind(query);
        kinds.add(expected);
        assert.equal(result.kind, expected, label);
        if (result.kind !== 'ok') continue;
        for (const text of textsIn(result.state)) assert.equal(hasControl(text), false, label);
        for (const pair of query.split('&').slice(1)) {
            const name = pair.slice(0, pair.indexOf('='));
            if (Object.hasOwn(defaults.SHARE_VIEW_CATEGORY_BY_KEY, name) && /%(?:[01][0-9A-Fa-f]|7[Ff])/.test(pair)) {
                assert.ok(result.reported.includes(defaults.SHARE_VIEW_CATEGORY_BY_KEY[name]), `${label}: ${name} reported`);
            }
        }
    }
    assert.ok(kinds.has('invalid'), 'the corpus needs at least one query the decoder rejects outright');
});

// ---- Owner pins: a changed owner default fails here instead of drifting ----------------------

// Reference identity and value checks run inside one bundle so both sides are the same module instance.
// The bundle runs under a fixed clock (mid-August 2026, quarter 2026Q3) so the quarter check cannot flake.
const OWNERS = bundle({
    stdin: {
        resolveDir: SRC,
        loader: 'js',
        contents: `
            import { SHARE_VIEW_DEFAULTS, SHARE_VIEW_SORTS, SHARE_VIEW_TRACK_IDS, SHARE_VIEW_PRIORITY_IDS } from './shareView/viewDefaults.js';
            import { DEFAULT_ENG_STATUS_FILTER } from './eng/engCatchUpFilters.js';
            import { DEFAULT_ENG_EPIC_SORT, ENG_EPIC_SORT_OPTIONS, resetEngFilters } from './eng/engTaskUtils.js';
            import { PROJECT_TRACK_COMMITTED, PROJECT_TRACK_FLEXIBLE } from './eng/engProjectTrack.js';
            import { PRIORITY_AXIS } from './stats/statsConstants.js';
            import { getCurrentQuarterLabel } from './cohort/cohortUtils.js';
            import { buildDefaultExcludedCapacityRange } from './stats/excludedCapacityStats.js';

            const reset = {};
            const record = (name) => (value) => { reset[name] = value; };
            resetEngFilters({
                setSearchInput: record('searchInput'),
                setSearchQuery: record('searchQuery'),
                setSelectedTeams: record('selectedTeams'),
                setEngStatusFilter: record('status'),
                setEngPriorityFilter: record('priority'),
                setEngProjectTrackFilter: record('track'),
                defaultEngStatusFilter: DEFAULT_ENG_STATUS_FILTER,
                setShowTech: record('showTech'),
                setShowProduct: record('showProduct'),
                setGroupByInitiativeChoice: record('initiatives'),
                setBurnoutTaskFilter() {}, setShowTeamDropdown() {}, setShowGroupDropdown() {}, setShowSprintDropdown() {},
                trackFilterChanged() {}, visibleCountBucket: 0,
            });
            const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
            const quarter = getCurrentQuarterLabel();
            const range = buildDefaultExcludedCapacityRange([{ id: '4182' }, { id: '4190' }], '4190');
            export const facts = {
                statusIsTheOwnerConstant: SHARE_VIEW_DEFAULTS.status === DEFAULT_ENG_STATUS_FILTER,
                sortIsTheOwnerConstant: SHARE_VIEW_DEFAULTS.sort === DEFAULT_ENG_EPIC_SORT,
                sortsAreTheOwnerOptions: same(SHARE_VIEW_SORTS, ENG_EPIC_SORT_OPTIONS.map((option) => option.value)),
                trackIdsAreTheOwnerConstants: same(SHARE_VIEW_TRACK_IDS, [PROJECT_TRACK_COMMITTED, PROJECT_TRACK_FLEXIBLE]),
                priorityIdsAreThePriorityAxis: same(SHARE_VIEW_PRIORITY_IDS, PRIORITY_AXIS),
                quarterRangeIsTheCurrentQuarter: quarter === '2026Q3' && same(SHARE_VIEW_DEFAULTS.quarterRange(), { from: quarter, to: quarter }),
                sprintRangeIsTheOwnerRange: same(SHARE_VIEW_DEFAULTS.sprintRange('4190'), { from: range.startSprintId, to: range.endSprintId }),
                resetSelectsTheDefaultTeams: same(reset.selectedTeams, SHARE_VIEW_DEFAULTS.teams),
                resetUsesTheDefaultPriority: 'priority' in reset && reset.priority === SHARE_VIEW_DEFAULTS.priority,
                resetUsesTheDefaultTrack: 'track' in reset && reset.track === SHARE_VIEW_DEFAULTS.track,
                resetUsesTheDefaultLanes: reset.showTech === SHARE_VIEW_DEFAULTS.lanes.tech && reset.showProduct === SHARE_VIEW_DEFAULTS.lanes.product,
                resetUsesTheDefaultInitiatives: 'initiatives' in reset && reset.initiatives === SHARE_VIEW_DEFAULTS.initiatives,
            };
        `,
    },
}, { Date: fixedDate(2026, 7, 15, 12) });

test('owner pins: defaults are the owner modules\' constants and the reset path\'s values', () => {
    const facts = plain(OWNERS.facts);
    assert.equal(Object.keys(facts).length, 12);
    for (const [name, value] of Object.entries(facts)) assert.equal(value, true, name);
    assert.deepEqual(plain(defaults.SHARE_VIEW_DEFAULTS.status), { hidden: ['Killed'] });
    assert.deepEqual(plain(defaults.SHARE_VIEW_PRIORITY_IDS), ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial']);
    assert.deepEqual(plain(defaults.SHARE_VIEW_SORTS), ['priority', 'status', 'track-committed', 'track-flexible']);
});

test('owner pins: the link modes are the app\'s derived ENG modes without Scenario, Catch Up is the default', async () => {
    const { deriveActiveEngMode } = await import('../frontend/src/eng/engModeState.js');
    const derived = new Set();
    for (let bits = 0; bits < 16; bits += 1) {
        derived.add(deriveActiveEngMode({ showScenario: Boolean(bits & 1), showStats: Boolean(bits & 2), showPlanning: Boolean(bits & 4), showBoard: Boolean(bits & 8) }));
    }
    assert.deepEqual([...derived].sort(), [...plain(defaults.SHARE_VIEW_MODES), 'scenario'].sort());
    assert.equal(deriveActiveEngMode({}), defaults.SHARE_VIEW_DEFAULTS.mode);
});

const quoted = (text) => [...text.matchAll(/'([^']+)'/g)].map((match) => match[1]);

test('owner pins: dashboard.jsx literals that have no exported constant (Stats view, layout, Board scope, alert flags)', () => {
    const dashboard = readSource('dashboard.jsx');
    const stats = /const resolveStatsView = \(value\) => \(([^)]*)\) \? value : '([^']*)';/.exec(dashboard);
    assert.ok(stats, 'dashboard.jsx resolveStatsView changed: update SHARE_VIEW_STATS_KEYS_BY_VIEW in viewDefaults.js');
    assert.deepEqual([...stats[1].matchAll(/value === '([^']+)'/g)].map((match) => match[1]), plain(defaults.SHARE_VIEW_STATS_VIEWS));
    assert.equal(stats[2], defaults.SHARE_VIEW_DEFAULTS.stats);

    const layout = /useState\(savedPrefsRef\.current\.planningLayout === '([^']+)' \? '\1' : '([^']+)'\)/.exec(dashboard);
    assert.ok(layout, 'dashboard.jsx planningLayout changed: update SHARE_VIEW_PLANNING_LAYOUTS and the layout default');
    assert.deepEqual([layout[1], layout[2]].sort(), [...plain(defaults.SHARE_VIEW_PLANNING_LAYOUTS)].sort());
    assert.equal(layout[2], defaults.SHARE_VIEW_DEFAULTS.layout);

    const scopes = /const boardScopeRequested = [^\n]*\[((?:'[a-z_]+'(?:, )?)+)\]\.includes\(boardStrictScope\)/.exec(dashboard);
    assert.ok(scopes, 'dashboard.jsx boardScopeRequested changed: update SHARE_VIEW_BOARD_SCOPES');
    assert.deepEqual(quoted(scopes[1]), plain(defaults.SHARE_VIEW_BOARD_SCOPES));
    const scope = /const \[boardStrictScope, setBoardStrictScope\] = useState\('([^']*)'\)/.exec(dashboard);
    assert.ok(scope, 'dashboard.jsx boardStrictScope changed: update the scope default');
    assert.equal(scope[1], defaults.SHARE_VIEW_DEFAULTS.scope);

    // Each alert category's expand flag defaults to true, so "panel shown, all ten expanded" is the default.
    const flags = {
        missing: 'showMissingAlert', blocked: 'showBlockedAlert', followup: 'showPostponedAlert', backlog: 'showBacklogAlert',
        missingTeam: 'showMissingTeamAlert', missingLabels: 'showMissingLabelsAlert', needsStories: 'showNeedsStoriesAlert',
        waiting: 'showWaitingAlert', empty: 'showEmptyEpicAlert', done: 'showDoneEpicAlert',
    };
    assert.deepEqual(Object.keys(flags), plain(defaults.SHARE_VIEW_ALERT_KEYS));
    for (const flag of [...Object.values(flags), 'showAlertsPanel']) {
        const declaration = new RegExp(`const \\[${flag}, set\\w+\\] = useState\\(([^;]*)\\);`).exec(dashboard);
        assert.ok(declaration, `dashboard.jsx no longer declares ${flag}`);
        assert.match(declaration[1], /\?\? true$/, `${flag} no longer defaults to true: update SHARE_VIEW_DEFAULTS.alerts`);
    }
    assert.equal(defaults.SHARE_VIEW_DEFAULTS.alerts.length, 10);
});

// The row mode as the table declares it: a plain initial value today, and the lazy initializer Task 8
// puts there so a link can seed it. Either way the value after `||` is the default.
const PLANNING_ROW_MODE = /const \[mode, setMode\] = React\.useState\((?:\(\) => takeInitialPlanningRowMode\(\) \|\| )?'([^']+)'\);/;

test('owner pins: the Planning table row mode defaults to epic and has a story mode', () => {
    const mode = PLANNING_ROW_MODE.exec(readSource('eng/PlanningReviewTable.jsx'));
    assert.ok(mode, 'PlanningReviewTable.jsx row mode state changed: update SHARE_VIEW_DEFAULTS.rows');
    assert.equal(mode[1], defaults.SHARE_VIEW_DEFAULTS.rows);
    // The pin reads the same default from the lazy form Task 8 introduces, and from a changed one.
    assert.equal(PLANNING_ROW_MODE.exec("const [mode, setMode] = React.useState(() => takeInitialPlanningRowMode() || 'epic');")[1], 'epic');
    assert.equal(PLANNING_ROW_MODE.exec("const [mode, setMode] = React.useState(() => takeInitialPlanningRowMode() || 'story');")[1], 'story');
    const model = readSource('eng/planningReviewTableModel.js');
    assert.match(model, /buildPlanningReviewRows\(\{[^}]*mode = 'epic'/);
    assert.match(model, /if \(mode === 'story'\)/);
    assert.deepEqual(plain(defaults.SHARE_VIEW_PLANNING_ROWS), ['epic', 'story']);
});

// ---- Source guards ---------------------------------------------------------------------------

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('source guard: the codec never uses URLSearchParams and imports no DOM or React module', () => {
    const source = withoutComments(readSource('shareView/codec.js'));
    assert.doesNotMatch(source, /URLSearchParams/);
    assert.doesNotMatch(source, /\b(window|document|location|history|navigator)\b/);
    assert.doesNotMatch(source, /from 'react'|from "react"/);
    assert.match(source, /Object\.hasOwn\(SPEC, name\)/);
});

test('source guard: viewDefaults imports its owner constants and uses them instead of repeating them', () => {
    const source = readSource('shareView/viewDefaults.js');
    for (const [name, owner] of [
        ['DEFAULT_ENG_STATUS_FILTER', '../eng/engCatchUpFilters.js'],
        ['DEFAULT_ENG_EPIC_SORT', '../eng/engTaskUtils.js'],
        ['ENG_EPIC_SORT_OPTIONS', '../eng/engTaskUtils.js'],
        ['PROJECT_TRACK_COMMITTED', '../eng/engProjectTrack.js'],
        ['PROJECT_TRACK_FLEXIBLE', '../eng/engProjectTrack.js'],
        ['PRIORITY_AXIS', '../stats/statsConstants.js'],
        ['getCurrentQuarterLabel', '../cohort/cohortUtils.js'],
        ['buildDefaultExcludedCapacityRange', '../stats/excludedCapacityStats.js'],
    ]) {
        assert.match(source, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '${owner.replace(/[./]/g, '\\$&')}'`), `${name} import`);
        assert.ok(source.split(name).length - 1 >= 2, `${name} is imported but not used`);
    }
});

// ---- find: the search key --------------------------------------------------------------------

test('find: its place in the key tables', () => {
    assert.deepEqual(plain(defaults.SHARE_VIEW_KEYS_BY_MODE['catch-up']).slice(0, 2), ['teams', 'find']);
    assert.deepEqual(plain(defaults.SHARE_VIEW_KEYS_BY_MODE.planning).slice(0, 2), ['teams', 'find']);
    assert.deepEqual(plain(defaults.SHARE_VIEW_KEYS_BY_MODE.board), ['scope', 'find']);
    assert.equal(defaults.SHARE_VIEW_CATEGORY_BY_KEY.find, 'filters');
    assert.equal(defaults.SHARE_VIEW_DEFAULTS.find, '');
    assert.equal(plain(codec.SHARE_VIEW_QUERY_KEYS).includes('find'), true);
});

const A100 = 'a'.repeat(100);
const FIND_DECODE_VECTORS = [
    ['?v=1&find=', ok({ find: '' })],
    ['?v=1&find=a%2Bb', ok({ find: 'a+b' })],
    ['?v=1&find=a+b', invalid('bad_character')],
    ...drops('filters', [
        '?v=1&find=%00', `?v=1&find=${'a'.repeat(101)}`, '?v=1&find=a=b', '?v=1&find=a,b', '?v=1&find=a:b', '?v=1&find=%20',
        `?v=1&find=${'%F0%9F%98%80'.repeat(101)}`,
    ]),
    [`?v=1&find=${A100}`, ok({ find: A100 })],
    ['?v=1&find=%20abc%20', ok({ find: 'abc' })],
    ['?v=1&find=%F0%9F%98%80', ok({ find: EMOJI })],
    [`?v=1&find=${'%F0%9F%98%80'.repeat(100)}`, ok({ find: EMOJI.repeat(100) })],
    [`?v=1&find=${'a'.repeat(10000)}`, invalid('too_long')],
];

test('find: decode vectors', () => {
    for (const [search, expected] of FIND_DECODE_VECTORS) assert.deepEqual(decode(search), expected, search.slice(0, 120));
    for (const bad of [BELL, C1_CONTROL, LINE_SEPARATOR, BIDI_OVERRIDE, '\n']) {
        assert.deepEqual(decode(`?v=1&find=${encodeURIComponent(`a${bad}b`)}`), ok({}, ['filters']), JSON.stringify(bad));
    }
    assert.equal(new URLSearchParams('find=a+b').get('find'), 'a b');
});

const FIND_ENCODE_VECTORS = [
    ['find with every reserved character', { find: '50% off & more=yes+ (x)*' }, '&find=50%25%20off%20%26%20more%3Dyes%2B%20%28x%29%2A', []],
    ['find with ! and apostrophe', { find: "it's here!" }, '&find=it%27s%20here%21', []],
    ['find is trimmed', { find: '  abc  ' }, '&find=abc', []],
    ['find empty is the default', { find: '' }, '', []],
    ['find blank is the default', { find: '   ' }, '', []],
    ['find with a lone surrogate omits the key', { find: `ab${LONE_SURROGATE}` }, '', ['find']],
    ['find ending in a dot ends in %2E', { find: 'v2.' }, '&find=v2%2E', []],
    ['find is written after teams and before status', { status: null, find: 'x', teams: ['t1'] }, '&teams=t1&find=x&status=all', []],
    ['find over 100 code points is omitted and named', { find: 'a'.repeat(101) }, '', ['find']],
    ['find with a control character is omitted and named', { find: `a${BELL}` }, '', ['find']],
    ['find with a bidi override is omitted and named', { find: `a${BIDI_OVERRIDE}` }, '', ['find']],
    ['find that is not text is omitted and named', { find: 7 }, '', ['find']],
];

test('find: encode vectors, and a Board link carries only scope and find', () => {
    for (const [name, patch, tail, dropped] of FIND_ENCODE_VECTORS) {
        assert.deepEqual(encode({ ...BASE, ...patch }), { ok: true, query: head() + tail, dropped }, name);
    }
    assert.deepEqual(encode({ ...BASE, mode: 'board', scope: 'all_work', find: 'x y', status: null }),
        { ok: true, query: `${head('board')}&scope=all_work&find=x%20y`, dropped: [] });
});

test('find: round trips, including the worst-case full states, and the stash pattern', () => {
    const queries = [
        assertRoundTrip('catch-up find', withMode({ find: 'payments & billing (EU)' })),
        assertRoundTrip('board find', withMode({ mode: 'board', find: 'x y' })),
        assertRoundTrip('planning find', withMode({ mode: 'planning', teams: ['t1'], find: 'x', status: null })),
        assertRoundTrip('full catch-up', { ...FULL_STATES.catchUp, find: 'payments & billing (EU) 50% off' }),
        assertRoundTrip('full planning table', { ...FULL_STATES.planningTable, find: 'x' }),
        assertRoundTrip('full planning list', { ...FULL_STATES.planningList, find: 'x' }),
        assertRoundTrip('full board', { ...FULL_STATES.board, find: 'a b c' }),
        assertRoundTrip('awkward find text', { ...AWKWARD_STATE, find: `50% off, a:b + 'c' (d)* caf${E_ACUTE}` }),
        assertRoundTrip('a hundred emoji', withMode({ find: EMOJI.repeat(100) })),
    ];
    for (const query of queries) assert.match(query, stashPattern(), query.slice(0, 160));
});

test('find: over the cap it is dropped first and only if needed', () => {
    const state = (length) => ({ ...coreOfLength(length), find: 'x', alertTeam: { anchor: 'blocked', id: 't1' } });
    // &find=x is 7 characters and &alertTeam=blocked:t1 is 21: at 1512 the find alone is enough, at 1520 it is not.
    assert.deepEqual(encode(state(1512)).dropped, ['find']);
    assert.match(encode(state(1512)).query, /alertTeam=blocked:t1$/);
    assert.deepEqual(encode(state(1520)).dropped, ['find', 'alertTeam']);
    assert.deepEqual(encode({ ...coreOfLength(1537), find: 'x' }), { ok: false, reason: 'too_long' });
    assert.deepEqual(encode({ ...BASE, find: 'x'.repeat(100) }).dropped, []);
});

test('find: strip removes it, and a reset clears search to its default', () => {
    assert.equal(stripShareViewParams('?perf=1&v=1&find=q'), '?perf=1');
    const resets = bundle({
        stdin: {
            resolveDir: SRC,
            loader: 'js',
            contents: `
                import { SHARE_VIEW_DEFAULTS } from './shareView/viewDefaults.js';
                import { resetEngFilters } from './eng/engTaskUtils.js';
                const reset = {};
                const record = (name) => (value) => { reset[name] = value; };
                resetEngFilters({
                    setSearchInput: record('input'), setSearchQuery: record('query'), setSelectedTeams() {}, setEngStatusFilter() {},
                    setEngPriorityFilter() {}, setEngProjectTrackFilter() {}, defaultEngStatusFilter: null, setShowTech() {},
                    setShowProduct() {}, setGroupByInitiativeChoice() {}, setBurnoutTaskFilter() {}, setShowTeamDropdown() {},
                    setShowGroupDropdown() {}, setShowSprintDropdown() {}, trackFilterChanged() {}, visibleCountBucket: 0,
                });
                export const facts = { searchQuery: reset.query === SHARE_VIEW_DEFAULTS.find, searchInput: reset.input === SHARE_VIEW_DEFAULTS.find };
            `,
        },
    });
    assert.deepEqual(plain(resets.facts), { searchQuery: true, searchInput: true });
});
