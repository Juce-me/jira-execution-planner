# Shareable View Links Implementation Plan: View defaults and link codec (Task 3)

> **Status:** Task 3 implemented; the operator approved the pair-cap validation correction on 2026-10-15. Slice of [EXEC-shareable-view-links-194.md](EXEC-shareable-view-links-194.md). Read the master's Global Constraints, Review Focus and Execution status before starting. Statuses and commit SHAs are recorded once, in the master's Task 14 Step 9; keep plan files unmodified between tasks so every Step 0 sees a clean tree. Slices are grouped by area, not by execution order; the master's table gives the order.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`SUPPORT-shareable-view-links-design-194.md`](SUPPORT-shareable-view-links-design-194.md)

**Tasks in this slice:** Task 3 (view defaults and link codec).

---

### Task 3: View defaults and link codec

**Owner note:** Depends on Task 1 (the committed corpus fixture `tests/fixtures/share-view-query-corpus-example-sanitized.json`, and `tests/test_share_view_stash.py`, which this task extends with one test class). Blocks Task 4 (the resolver imports the defaults, the vocabularies and the shape `decodeShareView` returns), Task 5 (the entry calls `decodeShareView` and `stripShareViewParams`) and Task 12 (the Share control calls `encodeShareView`). The commit also carries the regenerated `frontend/dist`: the build id hashes every file under `frontend/src`, so adding the two modules changes `dashboard.js` and the lazy-views manifest even though the app does not import them yet.

**Files:**
- Create: `frontend/src/shareView/viewDefaults.js`
- Create: `frontend/src/shareView/codec.js`
- Test (create): `tests/test_share_view_codec.js`
- Test (modify; created by Task 1): `tests/test_share_view_stash.py`, one import line plus the new class `ShareViewLinkKeyTests` placed before the module footer
- Generated in the same commit, never hand-edited: `frontend/dist/dashboard.js` (modified) and `frontend/dist/lazy-views-<64 hex>.json` (the old manifest replaced by a new one)
- Read only, no edits (no owner module needs even a one-word `export`): `tests/fixtures/share-view-query-corpus-example-sanitized.json` (Task 1), `backend/config/view_validation.py` (read as text by the JavaScript V11 test, imported by the Python one) and the owner modules in the "Owner inventory" table below (`frontend/src/eng/engCatchUpFilters.js`, `engTaskUtils.js`, `engProjectTrack.js`, `engModeState.js`, `PlanningReviewTable.jsx`, `planningReviewTableModel.js`, `frontend/src/stats/statsConstants.js`, `excludedCapacityStats.js`, `frontend/src/cohort/cohortUtils.js`, `frontend/src/dashboard.jsx`)

**Interfaces:**
- Consumes (Task 1): `tests/fixtures/share-view-query-corpus-example-sanitized.json` = `{"pattern": str, "maxQueryBytes": 1536, "accepts": [str], "rejects": [{"query": str, "why": str}]}`, queries without a leading `?`. The tests need: `pattern` compiles with `new RegExp('^(?:' + pattern + ')$')`; `maxQueryBytes` is 1536; at least one `accepts` entry; at least ten `rejects` entries, at least one of which the decoder rejects outright (a raw character outside `[A-Za-z0-9._~%&=,:-]`, more than 1,536 characters, 41 further pairs or a bad version). If the fixture does not meet that, stop and report to the lead; do not edit it in this task.
- Consumes (Task 1, edited in Step 1): `tests/test_share_view_stash.py`. The new class uses `re`, `unittest` and `Path`, which that file already imports, and two anchors in it, each of which must occur exactly once: the end of its `from backend.auth.share_view_stash import (...)` block (`    stash_share_view_query,` then `)`) and its module footer (`if __name__ == '__main__':` then `    unittest.main()`). If either is missing or repeated, stop and report that Task 1 changed; do not guess a new anchor.
- Consumes (existing exports, imported by `viewDefaults.js`, not modified): `DEFAULT_ENG_STATUS_FILTER` (`engCatchUpFilters.js`), `DEFAULT_ENG_EPIC_SORT` and `ENG_EPIC_SORT_OPTIONS` (`engTaskUtils.js`), `PROJECT_TRACK_COMMITTED` and `PROJECT_TRACK_FLEXIBLE` (`engProjectTrack.js`), `PRIORITY_AXIS` (`statsConstants.js`), `getCurrentQuarterLabel` (`cohortUtils.js`), `buildDefaultExcludedCapacityRange` (`excludedCapacityStats.js`).
- Consumes (read as text by the JavaScript V11 test, not imported): `backend/config/view_validation.py`, the literal `{ ... }` block of `FORBIDDEN_VIEW_PAYLOAD_KEYS` (24 names at `a6a085fc`, `authConnections` to `siteUrl`). The test fails with a clear message when the block cannot be found or no longer lists `workspaceId`, `accountId`, `cloudId`, `siteUrl`, `userId`, `password`, `secret`, `credential` and `service_integration_tokens`, so a refactor of that file cannot silently void it.
- Consumes (imported by the Python V11 class): `FORBIDDEN_VIEW_PAYLOAD_KEYS` from `backend.config.view_validation`, the real set: the 24 literal names plus the imported `SENSITIVE_TOKEN_KEYS` and the two Home probe name sets (`access_token`, `authorization`, `email` and similar). The class compares names the way that module does, `re.sub(r'[^a-z0-9]', '', value.lower())`, on both sides.
- Produces, `frontend/src/shareView/viewDefaults.js` (binding names first, then seven vocabularies and two narrowing tables that Task 4 may import instead of repeating):
  ```
  SHARE_VIEW_VERSION = 1
  SHARE_VIEW_MODES            // frozen ['catch-up','planning','board','statistics']
  SHARE_VIEW_DEFAULTS         // frozen, see below
  SHARE_VIEW_KEYS_BY_MODE     // frozen: mode -> the optional ShareViewState keys that apply
  SHARE_VIEW_ALERT_KEYS       // the ten: missing blocked followup backlog missingTeam missingLabels needsStories waiting empty done
  SHARE_VIEW_ALERT_ANCHORS    // the ten plus 'followupEpics'
  SHARE_VIEW_CATEGORY_BY_KEY  // query key -> notice category (group sprint mode teams filters focus)
  SHARE_VIEW_BOARD_SCOPES ['component','all_work'];  SHARE_VIEW_PLANNING_LAYOUTS ['list','table'];  SHARE_VIEW_PLANNING_ROWS ['epic','story']
  SHARE_VIEW_SORTS (the ENG epic sort values);  SHARE_VIEW_TRACK_IDS ['committed','flexible'];  SHARE_VIEW_PRIORITY_IDS (the six canonical labels)
  SHARE_VIEW_STATS_VIEWS (the seven);  SHARE_VIEW_STATS_KEYS_BY_VIEW (view -> which of teams/from/to it honors);  SHARE_VIEW_PLANNING_KEYS_BY_LAYOUT (table -> rows; list -> initiatives, sort)
  ```
  `SHARE_VIEW_DEFAULTS` holds: `mode: 'catch-up'`, `scope: ''`, `teams: ['all']`, `find: ''`, `status: DEFAULT_ENG_STATUS_FILTER` (`{hidden:['Killed']}`), `priority: null`, `track: undefined`, `lanes: {product:true, tech:true}`, `initiatives: null`, `sort: DEFAULT_ENG_EPIC_SORT`, `layout: 'table'`, `rows: 'epic'`, `stats: 'teams'`, `alerts: SHARE_VIEW_ALERT_KEYS` (panel shown, all ten expanded), and two functions because those defaults depend on today or on the link's own Sprint: `quarterRange() -> {from, to}` (the current quarter twice; the apply uses it for a Lead Times link that carries no range, the encoder never does) and `sprintRange(sprintId) -> {from, to}` (the Sprint twice; the encoder omits a Sprint range equal to it).
- Produces, `frontend/src/shareView/codec.js`:
  ```
  SHARE_VIEW_MAX_QUERY = 1536
  SHARE_VIEW_QUERY_KEYS   // frozen, v first, then in the order the encoder writes them:
                          // v mode group sprint scope layout rows stats from to teams find status priority track lanes initiatives sort alerts alertTeam epic story
  encodeShareView(state) -> { ok: true, query, dropped: string[] } | { ok: false, reason: 'invalid_state' | 'too_long' }
  decodeShareView(search) -> { kind: 'none' } | { kind: 'newer' }
                           | { kind: 'invalid', reason: 'too_long' | 'bad_character' | 'bad_version' | 'too_many_pairs' }
                           | { kind: 'ok', state, reported: string[] }
  stripShareViewParams(search) -> string
  ```
- Produces, `tests/test_share_view_stash.py`: the class `ShareViewLinkKeyTests` with one test, `test_no_link_key_is_a_forbidden_view_payload_key`, the Python half of design verification V11. It reads `frontend/src/shareView/codec.js` as text, extracts the `SHARE_VIEW_QUERY_KEYS` array literal and fails, naming the file, if it cannot find it or finds fewer than 20 keys.
- Decoded-state contract (binding for Tasks 4, 5 and 12):
  - `search` is `location.search`, a leading `?` is optional. A query that does not start with `v=` is `{kind:'none'}` (so `?mode=board&v=1` is not a link). Over 1,536 characters, a character outside `[A-Za-z0-9._~%&=,:-]`, a `v` that is not `^[1-9][0-9]{0,2}$` or more than 40 further pairs is `invalid`; only an envelope within those limits with `v` above 1 is `newer`.
  - In an `ok` result `state.version` is 1 and `state.mode` is always one of the four modes (a missing `mode` is `catch-up`; an invalid one is `catch-up` and is reported as `mode`). Every other key is present only when it was valid. An absent key means its default in `SHARE_VIEW_DEFAULTS` (a Lead Times link made by this encoder always carries `from` and `to`, so the default quarter only serves hand-made links), except `group` and `sprint`, whose absence means unresolved (the resolver returns `group_unresolved` or `sprint_unresolved`). So `state.group` and `state.sprint` can be missing even though the shared `ShareViewState` type lists them.
  - Value shapes: `teams` is `['all']` or at most 12 distinct ids; `status` and `priority` are `null`, `{only:[...]}` or `{hidden:[...]}` with at most 20 distinct atoms, kept exactly as written (case and spaces preserved: the resolver matches case-insensitively, and `priority` ids are not checked against the six labels here); `track` is absent (`track=all`), `[]` (`track=none`) or a subset of `['committed','flexible']` matched case-sensitively; `lanes` is `{product, tech}` (never both false); `initiatives` is a boolean; `rows` is `'epic'` or `'story'`; `alerts` is `'off'`, `'none'` or distinct category keys; `alertTeam` is `{anchor, id}`; `find` is trimmed, at most 100 code points, `''` for `find=`; `from` and `to` are each a Lead Times quarter or a Sprint id, nothing more (pairing, order, the 16-quarter window, the view's own shape and the catalog are Task 4's).
  - `epic` and `story` share the one `focus` slot: the first valid one in link order wins and the other adds `focus` to `reported`. `alertTeam` and `focus` can both be present; `resolveShareViewFocus` keeps at most one and reports `focus`.
  - `reported` lists each notice category once, in link order, for known keys that were present but invalid. Unknown keys and later duplicates of a key are ignored silently. `state` is a plain object whose property names come only from a fixed key table, never from the link, so `__proto__` and `constructor` cannot reach it.
- Encoder contract (for Task 12):
  - Input is a `ShareViewState`; `version` 1, a valid `mode`, a `group` of at most 255 code points and digit-only `sprint` are required, otherwise `{ok:false, reason:'invalid_state'}`. `v mode group sprint` are always written; every other key is written only when it applies to the mode and differs from `SHARE_VIEW_DEFAULTS`, with one exception: for `stats=cohort`, `from` and `to` are always written, even when they equal the default (the current quarter), because that default moves with the clock and a link must not change meaning with the date it is opened on. The encoder never reads the clock; a cohort state without a range writes none, so the capture must supply both (the app's `cohortStartQuarter` and `cohortEndQuarter` always hold a value). A Sprint range equal to the link's own Sprint is still omitted. Planning `rows` applies to the table and `initiatives` and `sort` to the list; Statistics `teams` applies to `teams`, `priority`, `burnout`, `cohort`, and `from` and `to` to `cohort` (quarters) and `excludedCapacity`, `monoCrossShare`, `projectTrack` (Sprint ids).
  - A `teams` selection that contains `all` is the default and is omitted; an explicit list is never collapsed to `all`, and `teams=all` is never written (the decoder still accepts it).
  - `dropped` names optional state keys that were NOT written, either because the value cannot be written as a valid link (outside its vocabulary or cap, a control or bidi character, a lone surrogate, `alertTeam` with `alerts: 'off'`, an alert team together with an Epic or Story focus) or because the link was over the cap (order: `find`, then `focus` and `alertTeam`, then `alerts`, `initiatives`, `sort`; never `group`, `sprint`, `scope`, `teams`, the facets, `lanes`, `layout`, `rows`, `stats`, `from`, `to`). The names are state keys: `focus` stands for `epic` and `story`. Still over after the last drop: `{ok:false, reason:'too_long'}` with no `query` property, so nothing is ever truncated.
  - The query has no leading `?` and starts with `v=1`; the Share control builds the URL as `<origin>/?<query>`. A query that would end in `.` ends in `%2E`. The result never contains a value the decoder would report on (the tests prove this for 3,000 junk states).

**Forbidden regressions for this task:**
- Decode never uses `URLSearchParams` (source guard in the test), and the search key is `find`: `q`, `s`, `search`, `query` and `keyword` are never written.
- The encoder never reads the clock: a Lead Times link means the same on any date because `from` and `to` are always written for `stats=cohort`.
- No owner module is edited (every default constant was already exported, or is pinned by a test, see "Owner inventory"); `dashboard.jsx` and `jira_server.py` keep their line counts, so no budget pin moves.
- The new modules touch no DOM, React, storage, network or analytics, and the app does not import them yet: startup, bundle contents and every existing view are unchanged; `frontend/dist` changes only by the build id.
- Design rules implemented here, copied from the design: query cap 1,536 characters; `v` first, then at most 40 further pairs; first duplicate wins; keys are case-sensitive and checked with `Object.hasOwn` on a frozen spec; atoms are `encodeURIComponent` plus `!'()*` as `%21 %27 %28 %29 %2A`; an omitted key means its default constant; `v mode group sprint` always written; over the cap drop `find`, the focus keys, `alerts`, `initiatives`, `sort` and never scope keys; never truncate.
- Review Focus RF4 is pinned by the test named `RF4: ids with comma, colon, percent, plus, quote, space and non-ASCII round trip and match the stash pattern`; the over-cap half of RF5 by `over the cap: scope keys are never dropped and nothing is truncated (too_long)`.
- Design Verification row V11 (no ids, names or tokens in the link) is pinned by the test named `V11: no id, name or token key can appear in a link (parity with FORBIDDEN_VIEW_PAYLOAD_KEYS)`: no link key equals a forbidden name (case-insensitively) or contains `token`, `secret`, `password`, `credential`, `workspace`, `cloud`, `site`, `account` or `user`; the worst-case full Catch Up, Planning, Board and Statistics links write none of those names as a key; and a state that carries every forbidden name as an extra property encodes to the same link. The Python class `ShareViewLinkKeyTests` in `tests/test_share_view_stash.py` repeats the key check against the real `FORBIDDEN_VIEW_PAYLOAD_KEYS`, which also unions the imported token and Home probe name sets: after normalizing both sides with `re.sub(r'[^a-z0-9]', '', value.lower())`, no `SHARE_VIEW_QUERY_KEYS` entry may collide with a forbidden name.

- [ ] **Step 1: Confirm the preconditions and write the failing test**

Run:
```bash
git branch --show-current
git status --short
for f in tests/fixtures/share-view-query-corpus-example-sanitized.json tests/test_share_view_stash.py frontend/src/eng/engCatchUpFilters.js frontend/src/eng/engTaskUtils.js frontend/src/eng/engProjectTrack.js frontend/src/eng/engModeState.js frontend/src/eng/PlanningReviewTable.jsx frontend/src/eng/planningReviewTableModel.js frontend/src/stats/statsConstants.js frontend/src/stats/excludedCapacityStats.js frontend/src/cohort/cohortUtils.js frontend/src/dashboard.jsx backend/config/view_validation.py scripts/extraction_lint/run.sh; do [ -e "$f" ] && echo "ok       $f" || echo "MISSING  $f"; done
ls frontend/src/shareView 2>&1 | head -1
[ -d node_modules ] && [ ! -L node_modules ] && echo "node_modules is this worktree's own install"
```
Expected: the branch is `feature/194-shareable-dashboard-view`; `git status --short` prints nothing; every path prints `ok` (a `MISSING` line means Task 1 has not landed or the plan is stale: stop and report); `ls` reports `No such file or directory`; the last line prints. The `node_modules` line matters for Step 6: a build that resolves `node_modules` from an ancestor checkout fails the CI dist check.

Create `tests/test_share_view_codec.js` with exactly this content. It bundles the new modules and the owner modules through esbuild into a `vm` context like `tests/test_auth_resume_state.js`, reads the Task 1 fixture and `backend/config/view_validation.py`, and holds every reviewed decode and encode vector, the round trips, the over-cap rules, the V11 forbidden-key parity check, the owner pins and the source guards.

```js
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
```

Then add the Python half of V11 to Task 1's test module, `tests/test_share_view_stash.py`, with two edits. The class reads `frontend/src/shareView/codec.js` as text, so it fails until Step 3 creates that file.

Edit `tests/test_share_view_stash.py`.

Replace this (the end of the import block from the stash module):

```python
    stash_share_view_query,
)
```

With this:

```python
    stash_share_view_query,
)
from backend.config.view_validation import FORBIDDEN_VIEW_PAYLOAD_KEYS
```

Replace this (the module footer):

```python
if __name__ == '__main__':
    unittest.main()
```

With this (the new class, then the same footer):

```python
class ShareViewLinkKeyTests(unittest.TestCase):
    """No id, name or token key can appear in a link (design verification V11).

    tests/test_share_view_codec.js checks the literal set in backend/config/view_validation.py; this
    checks the real FORBIDDEN_VIEW_PAYLOAD_KEYS, which also unions the token and Home probe name sets.
    """

    CODEC_PATH = Path(__file__).resolve().parents[1] / 'frontend' / 'src' / 'shareView' / 'codec.js'

    @staticmethod
    def normalize(value):
        return re.sub(r'[^a-z0-9]', '', value.lower())

    def link_keys(self):
        source = self.CODEC_PATH.read_text(encoding='utf-8')
        match = re.search(r'SHARE_VIEW_QUERY_KEYS\s*=\s*Object\.freeze\(\[(.*?)\]\)', source, re.S)
        if match is None:
            self.fail('frontend/src/shareView/codec.js: the SHARE_VIEW_QUERY_KEYS array literal was not found; update this test to read its new definition')
        keys = re.findall(r"'([^']+)'", match.group(1))
        self.assertGreaterEqual(len(keys), 20, f'only {len(keys)} link keys were read from codec.js')
        return keys

    def test_no_link_key_is_a_forbidden_view_payload_key(self):
        forbidden = {self.normalize(name) for name in FORBIDDEN_VIEW_PAYLOAD_KEYS}
        # The real union set: the literal names plus the token and Home probe name sets it imports.
        self.assertTrue(
            {'workspaceid', 'accountid', 'accesstoken', 'authorization', 'email'} <= forbidden,
            'FORBIDDEN_VIEW_PAYLOAD_KEYS no longer unions the literal, token and Home probe name sets',
        )
        collisions = sorted(key for key in self.link_keys() if self.normalize(key) in forbidden)
        self.assertEqual(collisions, [], f'link keys that are forbidden view payload keys: {collisions}')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run it and confirm it fails**

Run:
```bash
fnm exec --using 20 node --test tests/test_share_view_codec.js
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_share_view_stash.ShareViewLinkKeyTests
```
Expected: the first command fails to load the test file because the modules do not exist yet: the output contains `Could not resolve` for `.../frontend/src/shareView/viewDefaults.js`, then `not ok 1 - .../tests/test_share_view_codec.js`, `# tests 1` and `# fail 1`. The second prints a traceback ending in `FileNotFoundError` for `.../frontend/src/shareView/codec.js`, then `Ran 1 test` and `FAILED (errors=1)`. The red state must come from the missing module, not from a syntax or import error in either test file.

- [ ] **Step 3: Implement**

Create `frontend/src/shareView/viewDefaults.js` with exactly this content:

```js
// Defaults and closed vocabularies for shareable view links (design: "Link contract" and
// "Semantics"). An omitted link key means the constant kept here, never the recipient's saved
// preference, so the encoder and the apply read the same values. A constant that already has an
// owner module is imported from it; the few owner literals that are not exported are pinned by
// tests/test_share_view_codec.js, so a change at the owner fails a test instead of drifting.
import { DEFAULT_ENG_STATUS_FILTER } from '../eng/engCatchUpFilters.js';
import { DEFAULT_ENG_EPIC_SORT, ENG_EPIC_SORT_OPTIONS } from '../eng/engTaskUtils.js';
import { PROJECT_TRACK_COMMITTED, PROJECT_TRACK_FLEXIBLE } from '../eng/engProjectTrack.js';
import { PRIORITY_AXIS } from '../stats/statsConstants.js';
import { getCurrentQuarterLabel } from '../cohort/cohortUtils.js';
import { buildDefaultExcludedCapacityRange } from '../stats/excludedCapacityStats.js';

export const SHARE_VIEW_VERSION = 1;

// ENG modes a link can carry. Scenario and EPM are out of v1 (design: Non-goals).
export const SHARE_VIEW_MODES = Object.freeze(['catch-up', 'planning', 'board', 'statistics']);

// Board scope tokens; the empty string is the ordinary sprint scope (dashboard.jsx boardStrictScope).
export const SHARE_VIEW_BOARD_SCOPES = Object.freeze(['component', 'all_work']);

export const SHARE_VIEW_PLANNING_LAYOUTS = Object.freeze(['list', 'table']);

// The Planning table's own row modes; the link spells them `epics` and `stories`.
export const SHARE_VIEW_PLANNING_ROWS = Object.freeze(['epic', 'story']);

export const SHARE_VIEW_SORTS = Object.freeze(ENG_EPIC_SORT_OPTIONS.map((option) => option.value));

// Project Track facet option ids (the Epic's recognized values).
export const SHARE_VIEW_TRACK_IDS = Object.freeze([PROJECT_TRACK_COMMITTED, PROJECT_TRACK_FLEXIBLE]);

// The six canonical priority labels; the only ids a `priority` facet atom may resolve to.
export const SHARE_VIEW_PRIORITY_IDS = Object.freeze([...PRIORITY_AXIS]);

// Statistics views and the optional keys each one honors: `teams` for the four task-loading
// views, `from` and `to` for Lead Times quarters (`cohort`) and the three source-only sprint views.
export const SHARE_VIEW_STATS_KEYS_BY_VIEW = Object.freeze({
    teams: Object.freeze(['teams']),
    priority: Object.freeze(['teams']),
    burnout: Object.freeze(['teams']),
    cohort: Object.freeze(['teams', 'from', 'to']),
    excludedCapacity: Object.freeze(['from', 'to']),
    monoCrossShare: Object.freeze(['from', 'to']),
    projectTrack: Object.freeze(['from', 'to']),
});
export const SHARE_VIEW_STATS_VIEWS = Object.freeze(Object.keys(SHARE_VIEW_STATS_KEYS_BY_VIEW));

// Catch Up alert categories; the keys name the ten expand flags, in the panel's order.
export const SHARE_VIEW_ALERT_KEYS = Object.freeze([
    'missing', 'blocked', 'followup', 'backlog', 'missingTeam',
    'missingLabels', 'needsStories', 'waiting', 'empty', 'done',
]);
// `followupEpics` is the second list inside the `followup` card.
export const SHARE_VIEW_ALERT_ANCHORS = Object.freeze([...SHARE_VIEW_ALERT_KEYS, 'followupEpics']);

// Defaults of every optional key. Absent state key = this value. `from` and `to` depend on today
// (Lead Times) or on the link's own Sprint (source-only views), so those two are the owner functions.
// The encoder never relies on `quarterRange`: a Lead Times link always carries its range, so it keeps
// its meaning whatever the date. Only the apply uses it, for a link that has no range.
export const SHARE_VIEW_DEFAULTS = Object.freeze({
    mode: 'catch-up',
    scope: '',
    teams: Object.freeze(['all']),
    find: '',
    status: DEFAULT_ENG_STATUS_FILTER,
    priority: null,
    track: undefined,
    lanes: Object.freeze({ product: true, tech: true }),
    initiatives: null,
    sort: DEFAULT_ENG_EPIC_SORT,
    layout: 'table',
    rows: 'epic',
    stats: 'teams',
    // Panel shown with every category expanded.
    alerts: SHARE_VIEW_ALERT_KEYS,
    quarterRange: () => {
        const quarter = getCurrentQuarterLabel();
        return { from: quarter, to: quarter };
    },
    sprintRange: (sprintId) => {
        const range = buildDefaultExcludedCapacityRange([{ id: sprintId }], sprintId);
        return { from: range.startSprintId, to: range.endSprintId };
    },
});

// Optional ShareViewState keys that apply to each mode. `version`, `mode`, `group` and `sprint`
// apply to every mode and are always written, so they are not listed. Two narrowings follow the
// design's per-view columns: Planning `rows` applies to the table and `initiatives` and `sort` to
// the list; Statistics keys follow SHARE_VIEW_STATS_KEYS_BY_VIEW.
export const SHARE_VIEW_KEYS_BY_MODE = Object.freeze({
    'catch-up': Object.freeze(['teams', 'find', 'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'alerts', 'alertTeam', 'focus']),
    planning: Object.freeze(['teams', 'find', 'status', 'priority', 'track', 'lanes', 'layout', 'rows', 'initiatives', 'sort', 'focus']),
    board: Object.freeze(['scope', 'find']),
    statistics: Object.freeze(['teams', 'stats', 'from', 'to']),
});
export const SHARE_VIEW_PLANNING_KEYS_BY_LAYOUT = Object.freeze({
    table: Object.freeze(['rows']),
    list: Object.freeze(['initiatives', 'sort']),
});

// Query key -> notice category (design: Notice). `epic` and `story` fill the one `focus` slot.
export const SHARE_VIEW_CATEGORY_BY_KEY = Object.freeze({
    group: 'group',
    sprint: 'sprint',
    mode: 'mode',
    scope: 'mode',
    layout: 'mode',
    rows: 'mode',
    stats: 'mode',
    from: 'mode',
    to: 'mode',
    teams: 'teams',
    find: 'filters',
    status: 'filters',
    priority: 'filters',
    track: 'filters',
    lanes: 'filters',
    initiatives: 'filters',
    sort: 'filters',
    alerts: 'focus',
    alertTeam: 'focus',
    epic: 'focus',
    story: 'focus',
});
```

Create `frontend/src/shareView/codec.js` with exactly this content:

```js
// Codec for shareable view links: ShareViewState <-> the `?v=1&...` query (design: "Link contract"
// and "Encoding"). Pure: no DOM, no React, no I/O. Decode never uses the platform query-string
// parser: it reads %2C and a literal comma as the same character and turns `+` into a space. It
// splits on raw `&`, `,` and `:` itself and percent-decodes each atom on its own.
import {
    SHARE_VIEW_ALERT_ANCHORS,
    SHARE_VIEW_ALERT_KEYS,
    SHARE_VIEW_BOARD_SCOPES,
    SHARE_VIEW_CATEGORY_BY_KEY,
    SHARE_VIEW_DEFAULTS,
    SHARE_VIEW_KEYS_BY_MODE,
    SHARE_VIEW_MODES,
    SHARE_VIEW_PLANNING_KEYS_BY_LAYOUT,
    SHARE_VIEW_PLANNING_LAYOUTS,
    SHARE_VIEW_PLANNING_ROWS,
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
    'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'alerts', 'alertTeam', 'epic', 'story',
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
```

- [ ] **Step 4: Run and confirm pass**

Run:
```bash
fnm exec --using 20 node --test tests/test_share_view_codec.js
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_share_view_stash.ShareViewLinkKeyTests
```
Expected: `# tests 45`, `# pass 45`, `# fail 0` from the first command and `Ran 1 test` and `OK` from the second. A Node warning `MODULE_TYPELESS_PACKAGE_JSON` for `engModeState.js` is the same one `tests/test_eng_mode_state.js` already prints and is harmless. If the owner pins fail, the message names the owner literal that changed and the constant to update in `viewDefaults.js`; fix `viewDefaults.js`, not the pin.

Mutation proof for the V11 checks: add a forbidden name to the link schema, see both checks fail, then undo it.

Edit `frontend/src/shareView/codec.js`.

Replace this:

```js
    'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'alerts', 'alertTeam', 'epic', 'story',
]);
```

With this:

```js
    'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'alerts', 'alertTeam', 'epic', 'story', 'accountId',
]);
```

Run the two commands above again. Expected: the Node run reports `# fail 2` (the V11 test and the query-keys test) and the Python class reports `FAILED (failures=1)` with `link keys that are forbidden view payload keys: ['accountId']`. Undo the mutation (replace the second block with the first) and run both commands once more: `# fail 0` and `OK`.

- [ ] **Step 5: Run the task's regression gate**

Run:
```bash
fnm exec --using 20 npm run test:frontend:unit
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_share_view_stash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets
fnm exec --using 20 bash scripts/extraction_lint/run.sh; echo "exit $?"
tmp/lint/node_modules/.bin/eslint --no-config-lookup -c tmp/lint/eslint.config.mjs --max-warnings 0 frontend/src/shareView && echo "shareView: 0 problems"
```
Expected: the first prints `# fail 0` and a `# tests` count equal to the Task 0 baseline plus 45; the second prints `Ran 26 tests ... OK` (Task 1's 25 tests plus the new class; if Task 1's count differs, expect its count plus one); the third prints `Ran 2 tests ... OK`; the fourth prints `owner budgets: 0 problems`, an ESLint summary with no more warnings than the ratchet (106; 104 at `a6a085fc`, and the new files add none) and then the hook-interface summary, and its `exit` equals the one Task 0 recorded for this gate: `exit 0` on a clean base, or `exit 1` with exactly the four `ENFORCED owner budget` lines naming `frontend/src/eng/EpicBlock.jsx` and `frontend/src/settings/GroupBoardSettings.jsx` that `a6a085fc` already produces before any task of this plan (this task adds none); the fifth prints `shareView: 0 problems`. Read each summary line; a failure unrelated to this task is a baseline failure to report, not to fix here.

- [ ] **Step 6: Regenerate the compiled frontend and verify the diff**

Run:
```bash
ls frontend/dist | grep lazy-views
fnm exec --using 20 npm run build
git status --short -- frontend/dist
git diff --stat -- frontend/dist
```
Expected: `npm run build` prints `Dashboard built: <new 64 hex id>` (the CSS build summary follows). `git status --short -- frontend/dist` lists exactly three entries: ` M frontend/dist/dashboard.js`, ` D frontend/dist/lazy-views-<old id>.json` (the file the first command printed; `50d9b0fe44fafd11b3d9f6ab3b8b045312fdd74ee09038f6610963f63371678c` at `a6a085fc`) and `?? frontend/dist/lazy-views-<new id>.json`; `git diff --stat` lists `frontend/dist/dashboard.js | 2 +-` and the deleted old manifest, `2 files changed, 1 insertion(+), 19 deletions(-)` in total (the new manifest is untracked until Step 7). Any other path under `frontend/dist` (a `chunks/` file, a `.map`) means `node_modules` did not come from `npm ci` in this worktree: stop, run `npm ci`, rebuild, and do not commit the stray output. Never edit `frontend/dist` by hand.

- [ ] **Step 7: Commit**

Run:
```bash
git add frontend/src/shareView/viewDefaults.js frontend/src/shareView/codec.js tests/test_share_view_codec.js tests/test_share_view_stash.py
git add -A -- frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add shareable view link codec and defaults" -m "Share links need one definition of a link: its keys, defaults and encoding. This adds the pure codec and the defaults it will share with the apply, tested against the reviewed decode and encode vectors, round trips and the login-stash corpus, plus a check that no link key is a forbidden view payload key. The compiled frontend is regenerated because the build id hashes every frontend source file."
git show --stat HEAD
git status --short
fnm exec --using 20 npm run build && git status --short && make verify-dist-clean && echo "dist is reproducible"
```
Expected: `git show --stat HEAD` lists six paths: `frontend/dist/dashboard.js` (one line changed), the lazy-views manifest (a rename, or one delete plus one add), `frontend/src/shareView/codec.js` (about 444 lines), `frontend/src/shareView/viewDefaults.js` (about 123 lines), `tests/test_share_view_codec.js` (about 1,140 lines) and `tests/test_share_view_stash.py` (34 lines added, none removed), "6 files changed" when measured at `a6a085fc`. `git status --short` prints nothing, the second build leaves `git status --short` empty and prints `dist is reproducible`. Read `git show --stat HEAD` before going on; if a path is missing or `| 0` appears for a file you edited, re-stage and amend before anything else.

## Owner inventory (every default and vocabulary, with where it lives)

Verified against `a6a085fc`. Line numbers are hints; the pins match text and behavior, not lines.

| Link default or vocabulary | Owner | Exported constant? | In `viewDefaults.js` | Pinned in `tests/test_share_view_codec.js` by |
| --- | --- | --- | --- | --- |
| status `{hidden:['Killed']}` | `frontend/src/eng/engCatchUpFilters.js:37` `DEFAULT_ENG_STATUS_FILTER` | yes | imported | reference identity, plus an import-and-use guard |
| sort default and the four sorts | `frontend/src/eng/engTaskUtils.js:210` `DEFAULT_ENG_EPIC_SORT`, `:212` `ENG_EPIC_SORT_OPTIONS` | yes | imported | identity and equality, import-and-use guard |
| Project Track ids | `frontend/src/eng/engProjectTrack.js:1-2` | yes | imported | equality |
| six priority labels | `frontend/src/stats/statsConstants.js:1` `PRIORITY_AXIS` | yes | imported (copied) | equality |
| Lead Times default quarter | `frontend/src/cohort/cohortUtils.js:18` `getCurrentQuarterLabel` | function | called by `quarterRange()`, which only the apply uses (the encoder always writes a Lead Times range) | equality, under a fixed clock |
| Sprint range default | `frontend/src/stats/excludedCapacityStats.js:198` `buildDefaultExcludedCapacityRange` | function | called by `sprintRange(id)` with a one-entry catalog | equality |
| priority `null`, track `undefined`, lanes both on, initiatives `null`, teams `['all']`, find `''` | inline in `resetEngFacetFilters` (`engTaskUtils.js:123`) and `resetEngFilters` (`:138`); initial state `dashboard.jsx:327-329`, `:774`, `:786`, `:789-791` | no | defined | behavior: the test calls the exported `resetEngFilters` with recording setters and compares what it sets |
| modes and the Catch Up default | `frontend/src/eng/engModeState.js:6` `deriveActiveEngMode` (exported function) | function | defined | behavior over all 16 flag combinations |
| Statistics views and default `teams` | `frontend/src/dashboard.jsx:821`, an arrow function `resolveStatsView` inside `App()`: a one-word `export` is impossible | no | defined | source pin: regex on the declaration |
| Planning layout and default `table` | `frontend/src/dashboard.jsx:762` | no | defined | source pin |
| Board scopes and default `''` | `frontend/src/dashboard.jsx:917` and `:772` | no | defined | source pin |
| alerts: panel shown, ten expanded | `frontend/src/dashboard.jsx:947-957`, eleven `useState(... ?? true)` declarations | no | defined as `SHARE_VIEW_ALERT_KEYS` | source pin: each declaration ends in `?? true` |
| Planning rows default `epic` | `frontend/src/eng/PlanningReviewTable.jsx:98` (`React.useState('epic')` today; `React.useState(() => takeInitialPlanningRowMode() \|\| 'epic')` after Task 8); `planningReviewTableModel.js:64,73` | no | defined | source pin that accepts both forms and reads the default after `\|\|` |

No owner module is edited. If a later change moves or rewrites one of the source-pinned declarations (Tasks 6, 9, 11 and 12 edit `dashboard.jsx` and must leave these alone; so must the dashboard decomposition plan), the pin fails with a message naming the `viewDefaults.js` value to update; that is the intent. The one declaration this plan itself rewrites is the Planning row mode in `PlanningReviewTable.jsx`: Task 8 turns `React.useState('epic')` into the lazy initializer `React.useState(() => takeInitialPlanningRowMode() || 'epic')`, so the owner pin for it accepts the plain form and that lazy form and keeps asserting that the default is `epic` and that a `story` mode exists; it stays green through Task 8 and fails only if the default changes or the declaration takes some other shape.

## Notes for the executor

Settled decisions for this slice; none changes a binding name in the master.

1. Decoding is deliberately less strict than the stash: percent-encoded controls decode to `ok` with the key dropped and its category reported. The corpus test states each rejected vector's class and asserts the safety property (hostile text never reaches the state).
2. `dropped` also lists optional keys that cannot be written as a valid link (a `find` over 100 code points or with a lone surrogate), so the Share notice never hides a missing key.
3. A decoded state always has `version` and `mode` but may lack `group` and `sprint`; the resolver treats their absence as unresolved.
4. `teams=all` is decoded but never written, because the default is omitted. `stats=cohort` always writes `from` and `to`; the encoder never reads the clock.
5. There are no null-prototype containers: keys come only from a frozen table (`Object.hasOwn`), seen keys are tracked in a `Set`, and only table-defined properties are assigned, so prototype pollution is impossible and `assert.deepStrictEqual` keeps working in later tasks.
6. Source and tests build invisible characters with `String.fromCharCode` and `String.fromCodePoint`. Do not paste literal bidi controls into a source file and do not write backslash-u escapes for them (editing tools may convert them).
7. Beyond the binding names the module exports the vocabularies and two narrowing tables; the resolver does not need them.
8. The build id hashes every file under `frontend/src`, so this commit carries the regenerated `frontend/dist`.

## Approved Task 3 review correction (2026-10-15)

The operator approved checking the 40-further-pair cap before returning `newer`, with regression vectors for `v=2` plus 40 pairs (`newer`) and 41 pairs (`invalid`, `too_many_pairs`). The supplied codec and test blocks above include the correction. The separate corrective commit and the earlier pause-record commit are approved history exceptions recorded in the master; they do not replace a feature-task commit.
