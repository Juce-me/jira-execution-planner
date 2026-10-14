# Shareable View Links Implementation Plan: Server login stash and log hygiene (Tasks 1 and 2)

> **Status:** Proposed 2026-10-14. Slice of [EXEC-shareable-view-links-194.md](EXEC-shareable-view-links-194.md). Read the master's Global Constraints, Review Focus and Execution status before starting, and record each task's status and commit SHA in the master's Execution status table. Slices are grouped by area, not by execution order; the master's table gives the order.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`SUPPORT-shareable-view-links-design-194.md`](SUPPORT-shareable-view-links-design-194.md)

**Tasks in this slice:** Task 1 (server login stash and shared corpus fixture) and Task 2 (log hygiene and privacy notice, operator gate G1).

---

### Task 1: Server login stash and shared corpus fixture

**Owner note:** Depends on Task 0. Blocks Task 3 (its codec test loads the corpus fixture created here) and Task 2 (same flows and files; its privacy text describes this stash). Backend only. Documentation for this behavior (ontology, OAuth setup, architecture) lands in Task 13.

**Files:**
- Create: `backend/auth/share_view_stash.py`
- Create: `tests/fixtures/share-view-query-corpus-example-sanitized.json`
- Create: `tests/test_share_view_stash.py`
- Modify: `jira_server.py` (import block; `redirect_unauthenticated_oauth_dashboard_entry`)
- Modify: `backend/routes/auth_routes.py` (import block; `auth_entry_page`; `api_atlassian_callback`; `api_auth_logout`)
- Modify: `tests/oauth_test_helpers.py` (import block; new `forbid_jira_http`)
- Modify: `tests/test_codebase_structure_budgets.py` (`LEGACY_ENTRYPOINT_LINE_BUDGETS["jira_server.py"]`)
- Test: `tests/test_auth_entry_page.py` (`TestAuthEntryPage`), `tests/test_auth_routes.py` (`TestAuthRoutes`), `tests/test_db_oauth_cutover.py` (`DbOauthCutoverTests`), `tests/test_share_view_stash.py`

**Interfaces:**
- Consumes: none.
- Produces, in `backend/auth/share_view_stash.py` (binding names):
  ```
  SHARE_VIEW_STASH_KEY = 'pending_share_view'; SHARE_VIEW_MAX_QUERY_BYTES = 1536; SHARE_VIEW_TTL_SECONDS = 900; SHARE_VIEW_MAX_COOKIE_BYTES = 3300
  SHARE_VIEW_QUERY_PATTERN: str                                      # equals fixture["pattern"]
  stash_share_view_query(request, session, *, now=None) -> None      # never raises
  pop_share_view_target(session, *, now=None) -> str                 # '/' or '/?<q>'
  clear_share_view_stash(session) -> None
  ```
  The session value is `{'q': <query without '?'>, 't': <int epoch seconds>}` under `'pending_share_view'`.
- Produces: `tests/fixtures/share-view-query-corpus-example-sanitized.json` = `{"pattern": str, "maxQueryBytes": 1536, "accepts": [str], "rejects": [{"query": str, "why": str}]}` (queries without a leading `?`). Task 3 asserts that its encoder outputs match `pattern` and that every `accepts` entry decodes to `ok`.
- Produces: `forbid_jira_http(testcase)` in `tests/oauth_test_helpers.py` (fails the test if a flow reaches `jira_server.current_jira_request` or `HTTP_SESSION.post|put|delete|request`; the design's negative test for both server flows).

**Corpus contract (read before Task 3):**
- `rejects` holds only queries that the stash pattern rejects AND that the codec must report as an invalid link: every raw character outside `[A-Za-z0-9._~%&=,:-]` (quotes, `+`, `/`, `\`, `@`, `#`, raw CR/LF/NUL/DEL, non-ASCII, bidi, line separator) and a malformed `v`. Percent-encoded controls (`%00`, `%0A`, `%7F`), a malformed `%`, a second `=`, a key outside the stash key grammar (`__proto__`, 17 characters), `&&`, `v` not first and the over-cap cases are rejected by the stash too, but the codec drops the key, ignores the pair or reports `none` for them (design, "Encoding" items 4 and 5). They live in `STASH_ONLY_REJECTS` and the generated cap cases in `tests/test_share_view_stash.py`, not in the fixture.
- `accepts` was built by hand from the design's encoding rules: keys in the design's table order, defaults omitted, `v mode group sprint` always present. `teams=all` is not listed because the encoder omits a value equal to its default. Task 3's codec test must assert every entry decodes to `ok`; if Task 3's encoder emits a different canonical order, regenerate the entries in the fixture, keeping the pattern, the 12-UUID-Team link and the `%2C %3A %25 %2B %27 %C3%A9` ids (review focus RF4).

**Forbidden regressions for this task:**
- No new route, no new `EndpointPolicy`, exactly one `@app.before_request` in `jira_server.py`: the helper calls stay inside `redirect_unauthenticated_oauth_dashboard_entry`.
- Basic mode and the non-DB OAuth profile keep working; Basic mode never writes or consumes a stash.
- Existing login, callback and logout behavior (status codes, JSON errors, session keys, the DB browser-session lifecycle, the local token store) is unchanged; the existing tests in the three route test modules pass unmodified.
- The redirect target is only ever `/` or the literal `'/?' + q` after re-validation; never built from request parameters or `urllib` (design V2).
- A plain or invalid entry never touches an existing stash; a failed callback keeps it; the session cookie stays under 4,093 bytes with a maximum stash (design V8).
- `jira_server.py` stays within its pin: it grows by four lines and the pin is ratcheted in this commit (Step 9).

- [ ] **Step 1: Write the failing unit tests and the corpus fixture**

Create `tests/fixtures/share-view-query-corpus-example-sanitized.json` (synthetic ids only; the `-example-sanitized.json` suffix is what keeps it out of `tests/fixtures/.gitignore`):

```json
{
  "pattern": "v=[1-9][0-9]{0,2}(?:&[A-Za-z][A-Za-z0-9]{0,15}=(?:[A-Za-z0-9_.~:,-]|%(?![01][0-9A-Fa-f]|7[Ff])[0-9A-Fa-f]{2})*){0,40}",
  "maxQueryBytes": 1536,
  "accepts": [
    "v=1&mode=catch-up&group=default&sprint=4182",
    "v=1&mode=catch-up&group=grp-4f2a1c&sprint=4182&teams=7f88c5cc-36b1-5bbe-b163-9bb375d42fc4,39070dcb-6fde-5128-a434-3dd9560f077c,13d3c0b4-815a-5a78-b746-3a7e8565b635",
    "v=1&mode=catch-up&group=grp-4f2a1c&sprint=4182&teams=7f88c5cc-36b1-5bbe-b163-9bb375d42fc4,39070dcb-6fde-5128-a434-3dd9560f077c,13d3c0b4-815a-5a78-b746-3a7e8565b635,92e36a80-042d-5027-9eb7-67896736b45e,3e1cf4c2-1d40-571d-95cc-5b652fc8c670,f98953c0-58f4-56d4-97da-6a0b90ed1893,53510729-582e-5e95-8e2a-834cf275d8ba,416c294a-2d83-576c-8383-132f04d7e56d,d460599d-a3e2-5ae6-9978-b46bd015e796,5129901e-7dab-5d1c-83b8-9e99ad09a040,f7c56327-73dc-56ae-9d17-38439e8a3900,99ea0da3-eeaf-5be0-9b41-81f6cf593e63",
    "v=1&mode=catch-up&group=grp-4f2a1c&sprint=4182&teams=7f88c5cc-36b1-5bbe-b163-9bb375d42fc4,39070dcb-6fde-5128-a434-3dd9560f077c,13d3c0b4-815a-5a78-b746-3a7e8565b635,92e36a80-042d-5027-9eb7-67896736b45e,3e1cf4c2-1d40-571d-95cc-5b652fc8c670,f98953c0-58f4-56d4-97da-6a0b90ed1893,53510729-582e-5e95-8e2a-834cf275d8ba,416c294a-2d83-576c-8383-132f04d7e56d,d460599d-a3e2-5ae6-9978-b46bd015e796,5129901e-7dab-5d1c-83b8-9e99ad09a040,f7c56327-73dc-56ae-9d17-38439e8a3900,99ea0da3-eeaf-5be0-9b41-81f6cf593e63&status=only:In%20Progress,To%20Do&priority=only:Blocker,Critical&track=none&lanes=tech&initiatives=0&sort=track-flexible&alerts=blocked,missing,followup,backlog,missingTeam,missingLabels,needsStories,waiting,empty&alertTeam=blocked:92e36a80-042d-5027-9eb7-67896736b45e",
    "v=1&mode=catch-up&group=default&sprint=4182&status=all&alerts=off",
    "v=1&mode=catch-up&group=default&sprint=4182&status=hide:Ready%2C%20set,Won%27t%20Do&alerts=none",
    "v=1&mode=catch-up&group=default&sprint=4182&status=only:Termin%C3%A9,%E5%AE%8C%E4%BA%86",
    "v=1&mode=catch-up&group=default&sprint=4182&find=50%25%20off%20%26%20more%3Dyes%2B%20%28x%29%2A",
    "v=1&mode=catch-up&group=default&sprint=4182&find=Release%202.0%2E",
    "v=1&mode=catch-up&group=dept%2Fa&sprint=4182&teams=team%3A%3Aorbit,a%2Cb,50%25,c%2B%2B,Won%27t,Caf%C3%A9",
    "v=1&mode=catch-up&group=default&sprint=4182&alerts=followup&alertTeam=followupEpics:Unknown%20Team",
    "v=1&mode=catch-up&group=default&sprint=4182&epic=PROJ-101",
    "v=1&mode=planning&group=default&sprint=4182&initiatives=0&sort=status&layout=list&story=PROJ-102",
    "v=1&mode=planning&group=default&sprint=4182&find=checkout&status=only:In%20Progress&rows=stories",
    "v=1&mode=board&group=default&sprint=4182&scope=all_work&find=checkout",
    "v=1&mode=statistics&group=default&sprint=4182&stats=cohort&from=2026Q3&to=2026Q4",
    "v=1&mode=statistics&group=default&sprint=4182&teams=3e1cf4c2-1d40-571d-95cc-5b652fc8c670&stats=burnout",
    "v=1&mode=statistics&group=default&sprint=4182&stats=projectTrack&from=4180&to=4182"
  ],
  "rejects": [
    {
      "query": "v=1&find=a+b",
      "why": "raw plus"
    },
    {
      "query": "v=1&find=a b",
      "why": "raw space"
    },
    {
      "query": "v=1&find=a\"b",
      "why": "double quote"
    },
    {
      "query": "v=1&find=a'b",
      "why": "single quote"
    },
    {
      "query": "v=1&find=a<b",
      "why": "less-than"
    },
    {
      "query": "v=1&find=a>b",
      "why": "greater-than"
    },
    {
      "query": "v=1&find=a\\b",
      "why": "backslash"
    },
    {
      "query": "v=1&find=a/b",
      "why": "raw slash"
    },
    {
      "query": "v=1&epic=../x",
      "why": "path traversal"
    },
    {
      "query": "v=1&group=//evil.example",
      "why": "protocol-relative authority"
    },
    {
      "query": "v=1&group=https://evil.example/",
      "why": "absolute URL"
    },
    {
      "query": "v=1&find=a@b",
      "why": "at sign"
    },
    {
      "query": "v=1&find=a#b",
      "why": "fragment delimiter"
    },
    {
      "query": "v=1&find=a;b",
      "why": "semicolon"
    },
    {
      "query": "v=1&find=a(b",
      "why": "raw open parenthesis (must be %28)"
    },
    {
      "query": "v=1&find=a)b",
      "why": "raw close parenthesis (must be %29)"
    },
    {
      "query": "v=1&find=a!b",
      "why": "raw exclamation mark (must be %21)"
    },
    {
      "query": "v=1&find=a*b",
      "why": "raw asterisk (must be %2A)"
    },
    {
      "query": "v=1&find=a$b",
      "why": "dollar"
    },
    {
      "query": "v=1&find=a|b",
      "why": "pipe"
    },
    {
      "query": "v=1&find=a{b",
      "why": "open brace"
    },
    {
      "query": "v=1&find=a}b",
      "why": "close brace"
    },
    {
      "query": "v=1&find=a[b",
      "why": "open bracket"
    },
    {
      "query": "v=1&find=a^b",
      "why": "caret"
    },
    {
      "query": "v=1&find=a`b",
      "why": "backtick"
    },
    {
      "query": "v=1&find=a?b",
      "why": "raw question mark"
    },
    {
      "query": "v=1&mode=board\n",
      "why": "trailing LF (Python $ would accept it)"
    },
    {
      "query": "v=1&mode=board\r\n",
      "why": "trailing CRLF"
    },
    {
      "query": "v=1&find=a\nb",
      "why": "LF inside a value"
    },
    {
      "query": "v=1&find=a\rb",
      "why": "CR inside a value"
    },
    {
      "query": "v=1&find=a\u0000b",
      "why": "raw NUL"
    },
    {
      "query": "v=1&find=a\u007fb",
      "why": "raw DEL"
    },
    {
      "query": "v=1&find=Termin\u00e9",
      "why": "raw non-ASCII letter"
    },
    {
      "query": "v=1&find=\u5b8c\u4e86",
      "why": "raw CJK"
    },
    {
      "query": "v=1&find=a\u202eb",
      "why": "raw bidi override"
    },
    {
      "query": "v=1&find=a\u2028b",
      "why": "raw line separator"
    },
    {
      "query": "v=1&find=\ud83d\ude00",
      "why": "raw emoji"
    },
    {
      "query": "v=01",
      "why": "version with leading zero"
    },
    {
      "query": "v=1.0",
      "why": "version with a dot"
    },
    {
      "query": "v=",
      "why": "empty version"
    }
  ]
}
```

Create `tests/test_share_view_stash.py`:

```python
import hashlib
import json
import re
import time
import unittest
from pathlib import Path
from urllib.parse import urlsplit

import flask

from backend.auth.share_view_stash import (
    SHARE_VIEW_MAX_COOKIE_BYTES,
    SHARE_VIEW_MAX_QUERY_BYTES,
    SHARE_VIEW_QUERY_PATTERN,
    SHARE_VIEW_STASH_KEY,
    SHARE_VIEW_TTL_SECONDS,
    clear_share_view_stash,
    pop_share_view_target,
    stash_share_view_query,
)


CORPUS_PATH = Path(__file__).resolve().parent / 'fixtures' / 'share-view-query-corpus-example-sanitized.json'
CORPUS = json.loads(CORPUS_PATH.read_text(encoding='utf-8'))
NOW = 1_700_000_000
LINK = 'v=1&mode=board&group=default&sprint=4182'

# Queries the stash pattern rejects that the Node codec does not report as an invalid link (it drops or
# ignores the key, or the query is not a link), so they cannot live in the shared corpus, whose "rejects"
# must all decode as invalid.
STASH_ONLY_REJECTS = [
    'v=1&find=a%00b',
    'v=1&find=a%0Ab',
    'v=1&find=a%0db',
    'v=1&find=a%1Fb',
    'v=1&find=a%7Fb',
    'v=1&find=a%7fb',
    'v=1&find=%',
    'v=1&find=%G1',
    'v=1&find=%A',
    'v=1&find=%%41',
    'v=1&find=a=b',
    'v=1&abcdefghijklmnopq=x',
    'v=1&1abc=x',
    'v=1&__proto__=x',
    'v=1&=x',
    'v=1&a-b=x',
    'v=1&&mode=board',
    'v=1&mode=board&',
    'v=1&mode',
    'mode=board&v=1',
    'x=1',
    'V=1',
    'v=0',
    'v=1234',
    '',
]


def _make_app():
    app = flask.Flask(__name__)
    app.secret_key = 'test-secret'
    return app


def _filler(length):
    """Deterministic high-entropy text for padding a session toward the cookie budget."""
    chunks, seed = [], b'share-view-stash'
    while sum(len(chunk) for chunk in chunks) < length:
        seed = hashlib.sha256(seed).digest()
        chunks.append(seed.hex())
    return ''.join(chunks)[:length]


class ShareViewStashTestCase(unittest.TestCase):
    def setUp(self):
        self.app = _make_app()

    def stash(self, query, *, method='GET', session_data=None, now=NOW):
        """Run stash_share_view_query in a request context and return the resulting session."""
        with self.app.test_request_context('/', method=method, query_string=query):
            for key, value in (session_data or {}).items():
                flask.session[key] = value
            stash_share_view_query(flask.request, flask.session, now=now)
            return dict(flask.session)

    def pop(self, stored, *, now=NOW):
        with self.app.test_request_context('/'):
            if stored is not None:
                flask.session[SHARE_VIEW_STASH_KEY] = stored
            target = pop_share_view_target(flask.session, now=now)
            self.assertNotIn(SHARE_VIEW_STASH_KEY, flask.session)
            return target

    def signed_size(self, data):
        with self.app.test_request_context('/'):
            serializer = flask.current_app.session_interface.get_signing_serializer(flask.current_app)
            return len(serializer.dumps(data))


class ShareViewStashContractTests(ShareViewStashTestCase):
    def test_binding_constants_match_the_design(self):
        self.assertEqual(SHARE_VIEW_STASH_KEY, 'pending_share_view')
        self.assertEqual(SHARE_VIEW_MAX_QUERY_BYTES, 1536)
        self.assertEqual(SHARE_VIEW_TTL_SECONDS, 900)
        self.assertEqual(SHARE_VIEW_MAX_COOKIE_BYTES, 3300)

    def test_pattern_and_cap_equal_the_shared_corpus(self):
        self.assertEqual(SHARE_VIEW_QUERY_PATTERN, CORPUS['pattern'])
        self.assertEqual(SHARE_VIEW_MAX_QUERY_BYTES, CORPUS['maxQueryBytes'])
        self.assertGreaterEqual(len(CORPUS['accepts']), 12)
        self.assertGreaterEqual(len(CORPUS['rejects']), 30)

    def test_every_corpus_accept_is_stashed_verbatim(self):
        for query in CORPUS['accepts']:
            with self.subTest(query=query):
                self.assertLessEqual(len(query), SHARE_VIEW_MAX_QUERY_BYTES)
                self.assertEqual(self.stash(query)[SHARE_VIEW_STASH_KEY], {'q': query, 't': NOW})

    def test_every_corpus_reject_and_stash_only_reject_is_not_stashed(self):
        hostile = [entry['query'] for entry in CORPUS['rejects']] + STASH_ONLY_REJECTS
        for query in hostile:
            with self.subTest(query=query):
                self.assertNotIn(SHARE_VIEW_STASH_KEY, self.stash(query))

    def test_corpus_covers_the_ids_that_need_percent_encoding(self):
        joined = '\n'.join(CORPUS['accepts'])
        for encoded in ('%2C', '%3A', '%25', '%2B', '%27', '%C3%A9'):
            self.assertIn(encoded, joined)
        uuid_teams = [
            query for query in CORPUS['accepts']
            if len(re.findall(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', query)) >= 12
        ]
        self.assertTrue(uuid_teams, 'the corpus needs a link with 12 UUID-shaped Teams')

    def test_caps_are_enforced_at_their_exact_boundaries(self):
        pad = 'v=1&find='
        cases = [
            (pad + 'a' * (SHARE_VIEW_MAX_QUERY_BYTES - len(pad)), True),
            (pad + 'a' * (SHARE_VIEW_MAX_QUERY_BYTES - len(pad) + 1), False),
            ('v=1' + ''.join(f'&k{i}=x' for i in range(40)), True),
            ('v=1' + ''.join(f'&k{i}=x' for i in range(41)), False),
            ('v=1&' + 'k' * 16 + '=x', True),
            ('v=1&' + 'k' * 17 + '=x', False),
            ('v=999', True),
            ('v=1000', False),
        ]
        for query, expected in cases:
            with self.subTest(length=len(query), stored=expected):
                self.assertEqual(SHARE_VIEW_STASH_KEY in self.stash(query), expected)

    def test_python_dollar_would_accept_a_trailing_newline_so_fullmatch_is_required(self):
        query = 'v=1&mode=board\n'
        self.assertIsNotNone(re.match('(?:' + SHARE_VIEW_QUERY_PATTERN + ')$', query))
        self.assertNotIn(SHARE_VIEW_STASH_KEY, self.stash(query))


class ShareViewStashWriteTests(ShareViewStashTestCase):
    def test_only_get_writes(self):
        for method in ('HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'):
            with self.subTest(method=method):
                self.assertNotIn(SHARE_VIEW_STASH_KEY, self.stash(LINK, method=method))
        self.assertIn(SHARE_VIEW_STASH_KEY, self.stash(LINK, method='GET'))

    def test_invalid_or_plain_query_leaves_an_existing_stash_untouched(self):
        existing = {'q': LINK, 't': NOW - 5}
        for query in ('', 'v=1&find=a+b', 'mode=board&v=1', 'v=1&find=a%0Ab'):
            with self.subTest(query=query):
                session = self.stash(query, session_data={SHARE_VIEW_STASH_KEY: existing})
                self.assertEqual(session[SHARE_VIEW_STASH_KEY], existing)

    def test_newer_link_replaces_older_link(self):
        newer = 'v=1&mode=planning&group=other&sprint=4183'
        session = self.stash(newer, session_data={SHARE_VIEW_STASH_KEY: {'q': LINK, 't': NOW - 5}})
        self.assertEqual(session[SHARE_VIEW_STASH_KEY], {'q': newer, 't': NOW})

    def test_timestamp_uses_the_injected_clock_and_other_session_keys_are_kept(self):
        session = self.stash(LINK, session_data={'oauth_state': 'state-1'}, now=NOW + 0.9)
        self.assertEqual(session['oauth_state'], 'state-1')
        self.assertEqual(session[SHARE_VIEW_STASH_KEY]['t'], NOW)

    def test_helper_never_raises(self):
        class ExplodingRequest:
            method = 'GET'

            @property
            def query_string(self):
                raise RuntimeError('boom')

        class ExplodingSession(dict):
            def __setitem__(self, key, value):
                raise RuntimeError('boom')

        class UnusableSession(ExplodingSession):
            def pop(self, *args):
                raise RuntimeError('boom')

        with self.app.test_request_context('/', query_string=LINK):
            self.assertIsNone(stash_share_view_query(ExplodingRequest(), flask.session))
            self.assertIsNone(stash_share_view_query(flask.request, ExplodingSession(), now=NOW))
            self.assertIsNone(stash_share_view_query(flask.request, UnusableSession(), now=NOW))
        self.assertIsNone(stash_share_view_query(None, {}))

    def test_cookie_guard_pops_the_stash_above_the_budget_and_keeps_the_rest(self):
        stash_value = {'q': LINK, 't': NOW}

        def with_filler(length):
            return {'filler': _filler(length), SHARE_VIEW_STASH_KEY: stash_value}

        low, high = 0, 6000
        while low < high:
            middle = (low + high + 1) // 2
            if self.signed_size(with_filler(middle)) <= SHARE_VIEW_MAX_COOKIE_BYTES:
                low = middle
            else:
                high = middle - 1
        fits = low
        over = next(
            length for length in range(fits + 1, fits + 200)
            if self.signed_size(with_filler(length)) > SHARE_VIEW_MAX_COOKIE_BYTES
        )
        self.assertLessEqual(self.signed_size(with_filler(fits)), SHARE_VIEW_MAX_COOKIE_BYTES)

        kept = self.stash(LINK, session_data={'filler': _filler(fits)})
        self.assertEqual(kept[SHARE_VIEW_STASH_KEY], stash_value)
        dropped = self.stash(LINK, session_data={'filler': _filler(over)})
        self.assertNotIn(SHARE_VIEW_STASH_KEY, dropped)
        self.assertEqual(dropped['filler'], _filler(over))

    def test_cookie_guard_pops_a_replaced_stash_too(self):
        session = self.stash(
            LINK,
            session_data={'filler': _filler(6000), SHARE_VIEW_STASH_KEY: {'q': 'v=1&mode=planning', 't': NOW - 1}},
        )
        self.assertNotIn(SHARE_VIEW_STASH_KEY, session)


class ShareViewStashPopTests(ShareViewStashTestCase):
    def test_ttl_boundary_899_900_901_seconds(self):
        self.assertEqual(self.pop({'q': LINK, 't': NOW - 899}), '/?' + LINK)
        self.assertEqual(self.pop({'q': LINK, 't': NOW - 900}), '/?' + LINK)
        self.assertEqual(self.pop({'q': LINK, 't': NOW - 901}), '/')

    def test_fresh_and_default_clock(self):
        self.assertEqual(self.pop({'q': LINK, 't': NOW}), '/?' + LINK)
        with self.app.test_request_context('/'):
            flask.session[SHARE_VIEW_STASH_KEY] = {'q': LINK, 't': int(time.time())}
            self.assertEqual(pop_share_view_target(flask.session), '/?' + LINK)

    def test_future_timestamp_is_rejected(self):
        self.assertEqual(self.pop({'q': LINK, 't': NOW + 1}), '/')

    def test_missing_stash_returns_root(self):
        self.assertEqual(self.pop(None), '/')

    def test_pop_never_raises_for_an_unusable_session(self):
        class UnusableSession(dict):
            def pop(self, *args):
                raise RuntimeError('boom')

        self.assertEqual(pop_share_view_target(UnusableSession(), now=NOW), '/')

    def test_corrupt_stash_shapes_return_root_and_are_removed(self):
        corrupt = [
            'v=1&mode=board',
            ['q', 't'],
            7,
            True,
            {},
            {'q': LINK},
            {'t': NOW},
            {'q': LINK, 't': 'soon'},
            {'q': LINK, 't': None},
            {'q': LINK, 't': float('nan')},
            {'q': LINK, 't': float('inf')},
            {'q': LINK, 't': float('-inf')},
            {'q': 7, 't': NOW},
            {'q': None, 't': NOW},
            {'q': ['v=1'], 't': NOW},
        ]
        for stored in corrupt:
            with self.subTest(stored=stored):
                self.assertEqual(self.pop(stored), '/')

    def test_hostile_queries_in_a_fresh_stash_return_root(self):
        hostile = [entry['query'] for entry in CORPUS['rejects']] + STASH_ONLY_REJECTS + [
            '//evil.example/?v=1',
            'https://evil.example/',
            '/\\x',
            'v=1\r\nSet-Cookie: pwn=1',
            'v=1&mode=board' + 'a' * SHARE_VIEW_MAX_QUERY_BYTES,
        ]
        for query in hostile:
            with self.subTest(query=query):
                self.assertEqual(self.pop({'q': query, 't': NOW}), '/')

    def test_target_is_the_literal_root_query_and_never_leaves_the_origin(self):
        for query in CORPUS['accepts']:
            with self.subTest(query=query):
                target = self.pop({'q': query, 't': NOW})
                self.assertEqual(target, '/?' + query)
                parts = urlsplit(target)
                self.assertEqual((parts.scheme, parts.netloc, parts.fragment, parts.path), ('', '', '', '/'))
                self.assertEqual(parts.query, query)
        for target in (self.pop({'q': 'v=1', 't': NOW - 2000}), self.pop(None)):
            parts = urlsplit(target)
            self.assertEqual((target, parts.scheme, parts.netloc, parts.fragment), ('/', '', '', ''))


class ShareViewStashClearTests(ShareViewStashTestCase):
    def test_clear_removes_the_stash_and_keeps_other_keys(self):
        with self.app.test_request_context('/'):
            flask.session[SHARE_VIEW_STASH_KEY] = {'q': LINK, 't': NOW}
            flask.session['oauth_state'] = 'state-1'
            clear_share_view_stash(flask.session)
            self.assertEqual(dict(flask.session), {'oauth_state': 'state-1'})

    def test_clear_without_a_stash_does_not_modify_the_session(self):
        with self.app.test_request_context('/'):
            flask.session['oauth_state'] = 'state-1'
            flask.session.modified = False
            clear_share_view_stash(flask.session)
            self.assertFalse(flask.session.modified)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run it and confirm it fails**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_share_view_stash
```
Expected: `ModuleNotFoundError: No module named 'backend.auth.share_view_stash'` and `FAILED (errors=1)`.

- [ ] **Step 3: Implement the stash module**

Create `backend/auth/share_view_stash.py`:

```python
"""Carry a shareable-view query through the login hop in the signed session cookie."""

import re
import time
from contextlib import suppress

from flask import after_this_request, current_app

SHARE_VIEW_STASH_KEY = 'pending_share_view'
SHARE_VIEW_MAX_QUERY_BYTES = 1536
SHARE_VIEW_TTL_SECONDS = 900
SHARE_VIEW_MAX_COOKIE_BYTES = 3300
# Must equal "pattern" in tests/fixtures/share-view-query-corpus-example-sanitized.json.
SHARE_VIEW_QUERY_PATTERN = (
    r'v=[1-9][0-9]{0,2}'
    r'(?:&[A-Za-z][A-Za-z0-9]{0,15}='
    r'(?:[A-Za-z0-9_.~:,-]|%(?![01][0-9A-Fa-f]|7[Ff])[0-9A-Fa-f]{2})*){0,40}'
)
_SHARE_VIEW_QUERY_RE = re.compile(SHARE_VIEW_QUERY_PATTERN)


def _is_valid_query(query):
    # fullmatch, never `$`: Python's `$` also accepts a trailing newline.
    return (
        isinstance(query, str)
        and len(query) <= SHARE_VIEW_MAX_QUERY_BYTES
        and query.isascii()
        and _SHARE_VIEW_QUERY_RE.fullmatch(query) is not None
    )


def _no_store(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


def stash_share_view_query(request, session, *, now=None):
    """Hold a validated GET query in the session until the login hop completes. Never raises."""
    try:
        raw = request.query_string
        if request.method != 'GET' or not raw.isascii():
            return
        query = raw.decode('ascii')
        if not _is_valid_query(query):
            return
        session[SHARE_VIEW_STASH_KEY] = {'q': query, 't': int(time.time() if now is None else now)}
        serializer = current_app.session_interface.get_signing_serializer(current_app)
        if len(serializer.dumps(dict(session))) > SHARE_VIEW_MAX_COOKIE_BYTES:
            session.pop(SHARE_VIEW_STASH_KEY, None)
            return
        after_this_request(_no_store)
    except Exception:
        with suppress(Exception):
            session.pop(SHARE_VIEW_STASH_KEY, None)


def pop_share_view_target(session, *, now=None):
    """Pop the stash and return '/?<query>' when it is valid and fresh, else '/'. Never raises."""
    try:
        stored = session.pop(SHARE_VIEW_STASH_KEY, None)
        age = (time.time() if now is None else now) - stored['t']
        if 0 <= age <= SHARE_VIEW_TTL_SECONDS and _is_valid_query(stored['q']):
            return '/?' + stored['q']
    except Exception:
        pass
    return '/'


def clear_share_view_stash(session):
    session.pop(SHARE_VIEW_STASH_KEY, None)
```

`Cache-Control: no-store` is attached with `flask.after_this_request` only when a stash was actually stored, which keeps the binding return type `None` and keeps `jira_server.py` at four added lines.

- [ ] **Step 4: Run and confirm pass**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_share_view_stash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -W error -c "import backend.auth.share_view_stash"
```
Expected: `Ran 24 tests` and `OK`; the second command prints nothing.

- [ ] **Step 5: Write the failing route tests (entry hook, `/login`, callback, logout, DB profile)**

Edit `tests/oauth_test_helpers.py`.

Replace this (the import block):

```python
import threading
import time

from flask import session

import jira_server
```

With this:

```python
import threading
import time
from unittest.mock import patch

from flask import session

import jira_server
```

Replace this (the head of `push_oauth_request`):

```python
def push_oauth_request(app, path="/", session_id="session-1", **overrides):
```

With this:

```python
def forbid_jira_http(testcase):
    """Fail the test if the flow under test reaches Jira: no current_jira_request and no HTTP verb."""
    for target, name in (
        (jira_server, "current_jira_request"),
        (jira_server.HTTP_SESSION, "post"),
        (jira_server.HTTP_SESSION, "put"),
        (jira_server.HTTP_SESSION, "delete"),
        (jira_server.HTTP_SESSION, "request"),
    ):
        patcher = patch.object(target, name, side_effect=AssertionError(f"{name} must not be called"))
        patcher.start()
        testcase.addCleanup(patcher.stop)


def push_oauth_request(app, path="/", session_id="session-1", **overrides):
```

Edit `tests/test_auth_entry_page.py`.

Replace this (the import block):

```python
import unittest
from pathlib import Path
from unittest.mock import patch

import jira_server
```

With this:

```python
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

import jira_server
from tests.oauth_test_helpers import forbid_jira_http, install_oauth_session
```

Replace this (the last line of the file, the end of `test_dashboard_auth_shell_refreshes_on_initial_load`):

```python
        self.assertNotIn('location.reload', refresh_source)
```

With this (the same line followed by twelve new tests):

```python
        self.assertNotIn('location.reload', refresh_source)

    PENDING_VIEW_KEY = 'pending_share_view'
    SHARE_LINK = 'v=1&mode=board&group=default&sprint=4182&find=50%25%20off'

    def _stash(self):
        with self.client.session_transaction() as flask_session:
            return flask_session.get(self.PENDING_VIEW_KEY)

    def _set_stash(self, query, age_seconds=5):
        with self.client.session_transaction() as flask_session:
            flask_session[self.PENDING_VIEW_KEY] = {'q': query, 't': int(time.time()) - age_seconds}

    def _database_profile_patches(self):
        return (
            patch.object(jira_server, 'database_storage_enabled', return_value=True),
            patch.object(jira_server, 'db_oauth_browser_session_data', return_value={'connectionId': 'connection'}),
            patch.object(jira_server, 'current_request_auth_context', return_value=object()),
            patch.object(jira_server, 'oauth_session_data', return_value={}),
        )

    def test_unauthenticated_link_entry_stashes_the_query_and_redirects_to_login(self):
        forbid_jira_http(self)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/?' + self.SHARE_LINK)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/login')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        stash = self._stash()
        self.assertEqual(stash['q'], self.SHARE_LINK)
        self.assertLessEqual(abs(stash['t'] - int(time.time())), 5)

    def test_expired_session_link_entry_keeps_its_reason_and_stashes_the_query(self):
        with self.client.session_transaction() as flask_session:
            flask_session['atlassian_oauth_session_id'] = 'expired-session'
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/jira-dashboard.html?' + self.SHARE_LINK)
        self.assertEqual(response.headers['Location'], '/login?reason=session_expired')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(self._stash()['q'], self.SHARE_LINK)

    def test_only_get_stashes_the_link(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            responses = [
                self.client.head('/?' + self.SHARE_LINK),
                self.client.options('/?' + self.SHARE_LINK),
            ]
        for response in responses:
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.headers['Location'], '/login')
            self.assertEqual(response.headers.getlist('Set-Cookie'), [])
        self.assertIsNone(self._stash())

    def test_plain_or_invalid_entry_does_not_touch_an_existing_stash(self):
        self._set_stash(self.SHARE_LINK)
        before = self._stash()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            for query in ('', '?other=1', '?mode=board&v=1', '?v=1&find=a+b', '?v=1&find=a%0Ab'):
                with self.subTest(query=query):
                    response = self.client.get('/' + query)
                    self.assertEqual(response.headers['Location'], '/login')
                    self.assertEqual(response.headers.getlist('Set-Cookie'), [])
                    self.assertNotIn('Cache-Control', response.headers)
                    self.assertEqual(self._stash(), before)

    def test_newer_link_replaces_the_older_stash(self):
        newer = 'v=1&mode=planning&group=other&sprint=4183'
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            self.client.get('/?' + self.SHARE_LINK)
            self.client.get('/?' + newer)
        self.assertEqual(self._stash()['q'], newer)

    def test_authenticated_entry_clears_a_stale_stash(self):
        install_oauth_session(self.client)
        self._set_stash(self.SHARE_LINK, age_seconds=3600)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/?' + self.SHARE_LINK)
        response.close()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self._stash())

    def test_authenticated_database_entry_clears_a_stale_stash(self):
        self._set_stash(self.SHARE_LINK, age_seconds=3600)
        patches = self._database_profile_patches()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patches[0], patches[1], patches[2], patches[3]:
            response = self.client.get('/jira-dashboard.html?' + self.SHARE_LINK)
        response.close()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self._stash())

    def test_authenticated_entry_without_a_stash_sets_no_cookie(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/?' + self.SHARE_LINK)
        response.close()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.getlist('Set-Cookie'), [])

    def test_authenticated_login_visit_redirects_to_the_stashed_link_and_pops_it(self):
        profiles = {
            'local': (
                patch.object(jira_server, 'database_storage_enabled', return_value=False),
                patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}),
            ),
            'database': self._database_profile_patches(),
        }
        for name, patches in profiles.items():
            with self.subTest(profile=name):
                self._set_stash(self.SHARE_LINK)
                with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
                    for active in patches:
                        active.start()
                    try:
                        response = self.client.get('/login')
                    finally:
                        for active in patches:
                            active.stop()
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response.headers['Location'], '/?' + self.SHARE_LINK)
                self.assertIsNone(self._stash())

    def test_authenticated_login_visit_without_a_usable_stash_redirects_to_root(self):
        hostile = [
            ('//evil.example/?v=1', 5),
            ('v=1\r\nSet-Cookie: pwn=1', 5),
            (self.SHARE_LINK, 3600),
        ]
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False), \
             patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}):
            for query, age in hostile:
                with self.subTest(query=query, age=age):
                    self._set_stash(query, age_seconds=age)
                    response = self.client.get('/login')
                    parts = urlsplit(response.headers['Location'])
                    self.assertEqual(response.headers['Location'], '/')
                    self.assertEqual((parts.scheme, parts.netloc, parts.fragment), ('', '', ''))
                    self.assertIsNone(self._stash())
            response = self.client.get('/login')
            self.assertEqual(response.headers['Location'], '/')

    def test_login_pages_that_show_the_sign_in_action_keep_the_stash(self):
        self._set_stash(self.SHARE_LINK)
        before = self._stash()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            for path in ('/login', '/login?reason=session_expired', '/login?reason=missing_scope'):
                with self.subTest(path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(self._stash(), before)

    def test_terminal_recovery_login_visit_keeps_the_stash_for_an_authenticated_session(self):
        self._set_stash(self.SHARE_LINK)
        before = self._stash()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False), \
             patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}):
            response = self.client.get('/login?reason=session_expired')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._stash(), before)
```

Edit `tests/test_auth_routes.py`.

Replace this (the import block):

```python
import os
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import threading
import tempfile
from urllib.parse import parse_qs, urlparse

from backend import app as app_module
from backend.auth.context import RequestAuthContext
from backend.auth.csrf import CSRF_SESSION_KEY, validate_csrf_token
from backend.routes import auth_routes
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE
```

With this:

```python
import os
import secrets
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import threading
import tempfile
from urllib.parse import parse_qs, urlparse

from backend import app as app_module
from backend.auth.context import RequestAuthContext
from backend.auth.csrf import CSRF_SESSION_KEY, issue_csrf_token, validate_csrf_token
from backend.routes import auth_routes
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, forbid_jira_http
```

Replace this (the last lines of the file, the end of `test_callback_rejects_disallowed_local_token_store_before_saving_tokens`):

```python
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'local_token_store_not_allowed')
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})
```

With this (the same lines followed by nine new tests, V2, V8 and the full login-return chain):

```python
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'local_token_store_not_allowed')
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})

    PENDING_VIEW_KEY = 'pending_share_view'
    SHARE_LINK = 'v=1&mode=board&group=default&sprint=4182&find=50%25%20off'
    CALLBACK_URL = '/api/auth/atlassian/callback?state=state-123&code=abc'

    def _oauth_flow(self, **overrides):
        """Patch the OAuth configuration and the Atlassian exchange so the real routes run offline."""
        values = dict(
            JIRA_AUTH_MODE='atlassian_oauth',
            APP_ENVIRONMENT_KEY='local',
            OAUTH_LOCAL_TOKEN_STORE_ALLOWED=True,
            ATLASSIAN_CLIENT_ID='client-123',
            ATLASSIAN_CLIENT_SECRET='secret-123',
            ATLASSIAN_REDIRECT_URI='http://localhost:5050/api/auth/atlassian/callback',
            FLASK_SECRET_KEY='test-secret',
            JIRA_URL='https://example.atlassian.net',
            database_storage_enabled=lambda: False,
            exchange_authorization_code=lambda config, code, verifier: {
                'access_token': 'access-123',
                'refresh_token': 'refresh-123',
                'expires_in': 3600,
            },
            fetch_current_user=lambda token: {'account_id': 'account-123', 'account_status': 'active'},
            fetch_accessible_resources=lambda token: [{
                'id': 'cloud-123',
                'url': 'https://example.atlassian.net/',
                'name': 'Example Jira',
            }],
        )
        values.update(overrides)
        return patch.multiple(jira_server, **values)

    def _prime_callback(self, stash=None):
        with self.client.session_transaction() as flask_session:
            flask_session['oauth_state'] = 'state-123'
            flask_session['oauth_pkce_verifier'] = 'verifier-123'
            if stash is not None:
                flask_session[self.PENDING_VIEW_KEY] = stash

    def _fresh_stash(self, query, age_seconds=5):
        return {'q': query, 't': int(time.time()) - age_seconds}

    def _stash(self):
        with self.client.session_transaction() as flask_session:
            return flask_session.get(self.PENDING_VIEW_KEY)

    def test_callback_redirects_to_the_stashed_share_view_and_pops_it(self):
        forbid_jira_http(self)
        self._prime_callback(self._fresh_stash(self.SHARE_LINK))
        with self._oauth_flow():
            response = self.client.get(self.CALLBACK_URL)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/?' + self.SHARE_LINK)
        parts = urlparse(response.headers['Location'])
        self.assertEqual((parts.scheme, parts.netloc, parts.path, parts.fragment), ('', '', '/', ''))
        with self.client.session_transaction() as flask_session:
            self.assertNotIn(self.PENDING_VIEW_KEY, flask_session)
            self.assertIsNotNone(flask_session.get('atlassian_oauth_session_id'))
            self.assertNotIn('oauth_state', flask_session)

    def test_callback_without_a_stash_redirects_to_root(self):
        self._prime_callback()
        with self._oauth_flow():
            response = self.client.get(self.CALLBACK_URL)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/')

    def test_callback_target_ignores_request_parameters(self):
        hostile_url = self.CALLBACK_URL + '&next=//evil.example&redirect=https://evil.example&v=1&find=x'
        self._prime_callback(self._fresh_stash(self.SHARE_LINK))
        with self._oauth_flow():
            with_stash = self.client.get(hostile_url)
        self._prime_callback()
        with self._oauth_flow():
            without_stash = self.client.get(hostile_url)
        self.assertEqual(with_stash.headers['Location'], '/?' + self.SHARE_LINK)
        self.assertEqual(without_stash.headers['Location'], '/')

    def test_failed_callback_keeps_the_stash_and_a_retry_applies_it(self):
        def reject_exchange(config, code, verifier):
            raise jira_server.AuthError('auth_required', 'Authentication failed.')

        stash = self._fresh_stash(self.SHARE_LINK)
        failures = (
            ('invalid_state', self.CALLBACK_URL.replace('state-123', 'wrong'), {}, 400, 'invalid_oauth_state'),
            ('authorization_denied', '/api/auth/atlassian/callback?state=state-123&error=access_denied', {}, 400, 'oauth_authorization_failed'),
            ('missing_code', '/api/auth/atlassian/callback?state=state-123', {}, 400, 'missing_oauth_code'),
            ('failed_exchange', self.CALLBACK_URL, {'exchange_authorization_code': reject_exchange}, 401, 'auth_required'),
        )
        for name, url, overrides, status, error in failures:
            with self.subTest(failure=name):
                self._prime_callback(stash)
                with self._oauth_flow(**overrides):
                    response = self.client.get(url)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.get_json()['error'], error)
                self.assertEqual(self._stash(), stash)
        with self.subTest(failure='missing_verifier'):
            self._prime_callback(stash)
            with self.client.session_transaction() as flask_session:
                flask_session.pop('oauth_pkce_verifier')
            with self._oauth_flow():
                response = self.client.get(self.CALLBACK_URL)
            self.assertEqual(response.get_json()['error'], 'missing_pkce_verifier')
            self.assertEqual(self._stash(), stash)

        self._prime_callback()
        with self._oauth_flow():
            retry = self.client.get(self.CALLBACK_URL)
        self.assertEqual(retry.status_code, 302)
        self.assertEqual(retry.headers['Location'], '/?' + self.SHARE_LINK)
        self.assertIsNone(self._stash())

    def test_hostile_stale_or_corrupt_stash_values_always_redirect_to_root(self):
        fresh = int(time.time())
        hostile = [
            {'q': '//evil.example/?v=1', 't': fresh},
            {'q': 'https://evil.example/', 't': fresh},
            {'q': '/\\x', 't': fresh},
            {'q': 'v=1\r\nSet-Cookie: pwn=1', 't': fresh},
            {'q': 'v=1&find=Terminé', 't': fresh},
            {'q': 'v=1&find=a%0Ab', 't': fresh},
            {'q': 'v=1&mode=board' + 'a' * 1600, 't': fresh},
            {'q': self.SHARE_LINK, 't': fresh - 3600},
            {'q': self.SHARE_LINK},
            {'q': self.SHARE_LINK, 't': 'soon'},
            {'q': 7, 't': fresh},
            'v=1&mode=board',
            ['v=1&mode=board'],
            7,
        ]
        real_redirect = jira_server.redirect
        for stored in hostile:
            with self.subTest(stored=stored):
                self._prime_callback(stored)
                with patch.object(jira_server, 'redirect', wraps=real_redirect) as redirect_spy, \
                     self._oauth_flow():
                    response = self.client.get(self.CALLBACK_URL)
                parts = urlparse(response.headers['Location'])
                self.assertEqual(response.headers['Location'], '/')
                self.assertEqual((parts.scheme, parts.netloc, parts.fragment), ('', '', ''))
                redirect_spy.assert_called_once_with('/')
                self.assertIsNone(self._stash())

    def test_logout_clears_the_pending_share_view(self):
        self._prime_callback(self._fresh_stash(self.SHARE_LINK))
        response = self.client.post(
            '/api/auth/logout',
            headers={'X-Requested-With': 'jira-execution-planner'},
        )
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as flask_session:
            self.assertNotIn(self.PENDING_VIEW_KEY, flask_session)
            self.assertNotIn('oauth_state', flask_session)

    def test_basic_mode_never_stashes_or_consumes_a_share_view(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            entry = self.client.get('/?' + self.SHARE_LINK)
            entry.close()
            self.assertEqual(entry.status_code, 200)
            self.assertEqual(entry.headers.getlist('Set-Cookie'), [])
            self.assertIsNone(self._stash())

            stash = self._fresh_stash(self.SHARE_LINK)
            with self.client.session_transaction() as flask_session:
                flask_session[self.PENDING_VIEW_KEY] = stash
            login = self.client.get('/login')
            self.assertEqual(login.status_code, 302)
            self.assertEqual(login.headers['Location'], '/')
            self.assertEqual(self._stash(), stash)

    def test_full_login_return_chain_applies_the_link_once(self):
        forbid_jira_http(self)
        with self._oauth_flow():
            entry = self.client.get('/?' + self.SHARE_LINK)
            login_page = self.client.get(entry.headers['Location'])
            authorize = self.client.get('/api/auth/atlassian/login')
            state = parse_qs(urlparse(authorize.headers['Location']).query)['state'][0]
            callback = self.client.get('/api/auth/atlassian/callback?state=%s&code=abc' % state)
            replay = self.client.get('/api/auth/atlassian/callback?state=%s&code=abc' % state)
            dashboard = self.client.get(callback.headers['Location'])
            dashboard.close()
        self.assertEqual((entry.status_code, entry.headers['Location']), (302, '/login'))
        self.assertEqual(login_page.status_code, 200)
        self.assertEqual(authorize.status_code, 302)
        self.assertEqual((callback.status_code, callback.headers['Location']), (302, '/?' + self.SHARE_LINK))
        self.assertEqual((replay.status_code, replay.get_json()['error']), (400, 'invalid_oauth_state'))
        self.assertEqual(dashboard.status_code, 200)
        self.assertIsNone(self._stash())

    def test_pending_share_view_cookie_stays_under_the_browser_limit_through_the_login_hop(self):
        """V8: a maximum stash on top of every session key still fits one cookie (limit 4093 bytes)."""
        browser_session_id = '8b1c2d3e-4f50-4a6b-9c7d-0e1f2a3b4c5d'
        https = {'base_url': 'https://localhost'}
        with self.client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {'db_browser_session_id': browser_session_id}
            flask_session['atlassian_oauth_session_id'] = browser_session_id
            for _ in range(8):
                issue_csrf_token(flask_session, {})
        longest = 'v=1&find=' + secrets.token_urlsafe(1200)[:1527]
        too_long = longest + 'a'
        self.assertEqual((len(longest), len(too_long)), (1536, 1537))

        with patch.dict(jira_server.app.config, {'SESSION_COOKIE_SECURE': True}), self._oauth_flow():
            entry = self.client.get('/?' + longest, **https)
            login = self.client.get('/api/auth/atlassian/login', **https)

        for response in (entry, login):
            headers = response.headers.getlist('Set-Cookie')
            self.assertEqual(len(headers), 1)
            self.assertIn('; Secure', headers[0])
            self.assertLessEqual(len(headers[0]), 4093)
        with self.client.session_transaction() as flask_session:
            self.assertEqual(flask_session[self.PENDING_VIEW_KEY]['q'], longest)
            self.assertEqual(len(flask_session['csrf_token_hashes']), 8)
            self.assertTrue(flask_session['oauth_state'])
            self.assertTrue(flask_session['oauth_pkce_verifier'])
        self.assertIn('state=' + flask_session['oauth_state'], login.headers['Location'])

        refused = jira_server.app.test_client()
        with self._oauth_flow():
            response = refused.get('/?' + too_long)
        self.assertEqual(response.headers.getlist('Set-Cookie'), [])
        with refused.session_transaction() as flask_session:
            self.assertNotIn(self.PENDING_VIEW_KEY, flask_session)
```

Edit `tests/test_db_oauth_cutover.py`.

Replace this (the helper import):

```python
from tests.oauth_test_helpers import install_oauth_session
```

With this:

```python
from tests.oauth_test_helpers import forbid_jira_http, install_oauth_session
```

Replace this (the head of `_store_callback_through_route`):

```python
        refresh_token='refresh-123',
        account_id='account-123',
    ):
        client = client or self.client
        with client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'
```

With this (an optional `pending_share_view` argument):

```python
        refresh_token='refresh-123',
        account_id='account-123',
        pending_share_view=None,
    ):
        client = client or self.client
        with client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'
            if pending_share_view is not None:
                session['pending_share_view'] = pending_share_view
```

Replace this (the end of `_store_callback_through_route`):

```python
                browser_session_id=session_payload.get('db_browser_session_id'),
                session_payload=session_payload,
            )
```

With this (the helper also returns the callback's `Location`):

```python
                browser_session_id=session_payload.get('db_browser_session_id'),
                session_payload=session_payload,
                location=response.headers['Location'],
            )
```

Replace this (the end of the last test and the module footer):

```python
        run_probe.assert_not_called()


if __name__ == '__main__':
    unittest.main()
```

With this (the same lines with six new tests inserted before the footer):

```python
        run_probe.assert_not_called()

    SHARE_LINK = 'v=1&mode=board&group=default&sprint=4182&find=50%25%20off'

    def _pending_share_view(self, age_seconds=5):
        return {'q': self.SHARE_LINK, 't': int(time.time()) - age_seconds}

    def _pending_share_view_in_session(self, client=None):
        with (client or self.client).session_transaction() as session:
            return session.get('pending_share_view')

    def test_callback_applies_the_pending_share_view_and_keeps_the_db_session(self):
        forbid_jira_http(self)
        result = self._store_callback_through_route(pending_share_view=self._pending_share_view())

        self.assertEqual(result.location, '/?' + self.SHARE_LINK)
        with self.client.session_transaction() as session:
            self.assertNotIn('pending_share_view', session)
            self.assertNotIn('oauth_state', session)
            self.assertNotIn('atlassian_oauth_session_id', session)
            self.assertEqual(session['db_oauth_session'], {'db_browser_session_id': result.browser_session_id})
        with self._db_route_mode():
            status = self.client.get('/api/auth/status')
        self.assertTrue(status.get_json()['authenticated'])

    def test_callback_without_a_pending_share_view_redirects_to_root(self):
        self.assertEqual(self._store_callback_through_route().location, '/')

    def test_callback_failures_retain_the_pending_share_view_for_a_retry(self):
        """Every failed callback keeps the stash, including the one that deletes the DB browser session."""
        stash = self._pending_share_view()
        cases = (
            ('invalid_state', 'state-1', 'verifier-1', '/api/auth/atlassian/callback?state=wrong&code=abc', 'invalid_oauth_state'),
            ('authorization_denial', 'state-2', 'verifier-2', '/api/auth/atlassian/callback?state=state-2&error=access_denied', 'oauth_authorization_failed'),
            ('missing_code', 'state-3', 'verifier-3', '/api/auth/atlassian/callback?state=state-3', 'missing_oauth_code'),
            ('missing_pkce', 'state-4', None, '/api/auth/atlassian/callback?state=state-4&code=abc', 'missing_pkce_verifier'),
        )
        for name, state_value, verifier, path, expected_error in cases:
            with self.subTest(name=name):
                with self.client.session_transaction() as session:
                    session['oauth_state'] = state_value
                    session['pending_share_view'] = stash
                    if verifier is None:
                        session.pop('oauth_pkce_verifier', None)
                    else:
                        session['oauth_pkce_verifier'] = verifier
                with self._db_route_mode():
                    response = self.client.get(path)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()['error'], expected_error)
                self.assertEqual(self._pending_share_view_in_session(), stash)

        signed_in = self._store_callback_through_route()
        with self.client.session_transaction() as session:
            session['oauth_state'] = 'state-failure'
            session['oauth_pkce_verifier'] = 'verifier-failure'
            session['pending_share_view'] = stash
        with self._db_route_mode(), patch.object(
            jira_server,
            'exchange_authorization_code',
            side_effect=jira_server.AuthError('auth_required', 'Authentication failed.'),
        ):
            failed = self.client.get('/api/auth/atlassian/callback?state=state-failure&code=abc')
        self.assertEqual(failed.status_code, 401)
        with self.client.session_transaction() as session:
            self.assertNotIn('db_oauth_session', session)
            self.assertEqual(session['pending_share_view'], stash)
        with self.factory() as session:
            self.assertIsNone(session.get(models.BrowserSession, signed_in.browser_session_id))

        retry = self._store_callback_through_route()
        self.assertEqual(retry.location, '/?' + self.SHARE_LINK)
        self.assertIsNone(self._pending_share_view_in_session())

    def test_link_survives_the_whole_database_login_hop(self):
        with self._db_route_mode():
            entry = self.client.get('/?' + self.SHARE_LINK)
        self.assertEqual((entry.status_code, entry.headers['Location']), (302, '/login'))
        self.assertEqual(entry.headers['Cache-Control'], 'no-store')
        self.assertEqual(self._pending_share_view_in_session()['q'], self.SHARE_LINK)

        result = self._store_callback_through_route()
        self.assertEqual(result.location, '/?' + self.SHARE_LINK)
        with self._db_route_mode():
            dashboard = self.client.get(result.location)
            dashboard.close()
        self.assertEqual(dashboard.status_code, 200)
        with self.client.session_transaction() as session:
            self.assertNotIn('pending_share_view', session)
            self.assertEqual(session['db_oauth_session'], {'db_browser_session_id': result.browser_session_id})

    def test_authenticated_database_session_consumes_or_clears_the_pending_share_view(self):
        result = self._store_callback_through_route()

        with self.client.session_transaction() as session:
            session['pending_share_view'] = self._pending_share_view()
        with self._db_route_mode():
            login = self.client.get('/login')
        self.assertEqual((login.status_code, login.headers['Location']), (302, '/?' + self.SHARE_LINK))
        self.assertIsNone(self._pending_share_view_in_session())

        with self.client.session_transaction() as session:
            session['pending_share_view'] = self._pending_share_view(age_seconds=3600)
        with self._db_route_mode():
            dashboard = self.client.get('/jira-dashboard.html?' + self.SHARE_LINK)
            dashboard.close()
        self.assertEqual(dashboard.status_code, 200)
        with self.client.session_transaction() as session:
            self.assertNotIn('pending_share_view', session)
            self.assertEqual(session['db_oauth_session'], {'db_browser_session_id': result.browser_session_id})

    def test_logout_clears_the_pending_share_view_with_the_database_session(self):
        result = self._store_callback_through_route()
        with self.client.session_transaction() as session:
            session['pending_share_view'] = self._pending_share_view()

        with self._db_route_mode():
            response = self.client.post(
                '/api/auth/logout',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as session:
            self.assertNotIn('pending_share_view', session)
            self.assertNotIn('db_oauth_session', session)
        with self.factory() as session:
            self.assertIsNone(session.get(models.BrowserSession, result.browser_session_id))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 6: Run them and confirm they fail**

The module from Step 3 exists, the route wiring does not yet. Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_share_view_stash tests.test_auth_entry_page tests.test_auth_routes tests.test_db_oauth_cutover
```
Expected: `Ran 118 tests` and `FAILED (failures=31, errors=4)`. Every failing entry belongs to a new test (10 in `TestAuthEntryPage`, 20 in `TestAuthRoutes`, 5 in `DbOauthCutoverTests`; subtests count separately); none of the 24 stash unit tests and none of the existing tests fails. Representative messages:
- `AssertionError: '/' != '/?v=1&mode=board&group=default&sprint=4182&find=50%25%20off'` (the callback and `/login` ignore the stash);
- `AssertionError: {'q': 'v=1&mode=board&group=default&sprint=4182&find=50%25%20off', 't': ...} is not None` (the stash is never consumed or cleared);
- `TypeError: 'NoneType' object is not subscriptable` (the entry hook never writes a stash).

- [ ] **Step 7: Wire the stash into the entry hook and the auth routes**

Edit `jira_server.py`.

Replace this (one line in the `backend.auth` import block):

```python
from backend.auth.service_integrations import register_service_integration_cache_invalidator
```

With this:

```python
from backend.auth.service_integrations import register_service_integration_cache_invalidator
from backend.auth.share_view_stash import clear_share_view_stash, stash_share_view_query
```

Replace this (the tail of `redirect_unauthenticated_oauth_dashboard_entry`, the only `@app.before_request` function):

```python
            current_request_auth_context()
            return None
        except AuthError:
            pass
    data = oauth_session_data()
    if data.get('access_token') and data.get('cloudid'):
        return None
    return redirect('/login?reason=session_expired' if session.get('atlassian_oauth_session_id') else '/login')
```

With this:

```python
            current_request_auth_context()
            clear_share_view_stash(session)
            return None
        except AuthError:
            pass
    data = oauth_session_data()
    if data.get('access_token') and data.get('cloudid'):
        clear_share_view_stash(session)
        return None
    stash_share_view_query(request, session)
    return redirect('/login?reason=session_expired' if session.get('atlassian_oauth_session_id') else '/login')
```

Edit `backend/routes/auth_routes.py`.

Replace this (two lines in the import block):

```python
from backend.auth.jira_auth import ensure_oauth_token
from backend.auth.scope_policy import missing_context_oauth_scopes
```

With this:

```python
from backend.auth.jira_auth import ensure_oauth_token
from backend.auth.scope_policy import missing_context_oauth_scopes
from backend.auth.share_view_stash import clear_share_view_stash, pop_share_view_target
```

Replace this (the DB-session branch of `auth_entry_page`; first authenticated `/login` redirect):

```python
            current_request_auth_context()
            return redirect('/')
        except AuthError:
            pass
```

With this:

```python
            current_request_auth_context()
            return redirect(pop_share_view_target(session))
        except AuthError:
            pass
```

Replace this (the local-session branch of `auth_entry_page`; second authenticated `/login` redirect):

```python
    if not terminal_recovery and data.get('access_token') and data.get('cloudid'):
        return redirect('/')
```

With this:

```python
    if not terminal_recovery and data.get('access_token') and data.get('cloudid'):
        return redirect(pop_share_view_target(session))
```

Replace this (the end of `api_atlassian_callback`; the success exit, not the failure branches):

```python
        return auth_error_response(error, 401 if error.code != 'jira_site_not_accessible' else 403)
    return redirect('/')
```

With this:

```python
        return auth_error_response(error, 401 if error.code != 'jira_site_not_accessible' else 403)
    return redirect(pop_share_view_target(session))
```

Replace this (the end of `api_auth_logout`):

```python
    session.pop('oauth_state', None)
    session.pop('oauth_pkce_verifier', None)
    return jsonify({'ok': True})
```

With this:

```python
    session.pop('oauth_state', None)
    session.pop('oauth_pkce_verifier', None)
    clear_share_view_stash(session)
    return jsonify({'ok': True})
```

Do not change any other line of these two files. The first `redirect('/')` in `auth_entry_page` (non-OAuth mode) stays: Basic mode is inert by design.

- [ ] **Step 8: Run and confirm pass**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_share_view_stash tests.test_auth_entry_page tests.test_auth_routes tests.test_db_oauth_cutover
git diff --stat -- jira_server.py backend/routes/auth_routes.py
```
Expected: `Ran 118 tests` and `OK`; the diffstat shows `backend/routes/auth_routes.py | 8 +++++---` and `jira_server.py | 4 ++++`.

- [ ] **Step 9: Ratchet the `jira_server.py` line pin (same commit)**

Measure and run the budget test, which must fail first:
```bash
wc -l < jira_server.py
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets
```
Expected: `6491`, then `FAILED (failures=1)` with `jira_server.py: 6491 lines exceeds budget 6487`.

Edit `tests/test_codebase_structure_budgets.py`.

Replace this (the last comment line and the entry in `LEGACY_ENTRYPOINT_LINE_BUDGETS`):

```python
    # Merge of origin/main into feature/217-sprint-review-table: both lines above are additive; the merged file is 6487 lines.
    "jira_server.py": 6487,
```

With this:

```python
    # Merge of origin/main into feature/217-sprint-review-table: both lines above are additive; the merged file is 6487 lines.
    # feature/194-shareable-dashboard-view: the single dashboard-entry before_request calls the share-view stash
    # helper in backend/auth/share_view_stash.py (one import, two clears on authenticated entry, one stash call: +4).
    "jira_server.py": 6491,
```

Run again:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets
```
Expected: `Ran 2 tests` and `OK`. The `dashboard.jsx` pin and `scripts/extraction_lint/owner_budgets.json` are untouched (no frontend change in this task).

- [ ] **Step 10: Run the task's regression gate**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest discover -s tests
```
Expected: the first command (the module list `make test-security` runs; use `make test-security` itself in a checkout that has `.venv`) prints `Ran 82 tests` and `OK`. The full suite shows the Task 0 baseline plus exactly 51 new tests (24 + 12 + 9 + 6), the same skips and no new failure or error; a failure that is already in the Task 0 baseline stays out of scope.

`make test-security` and `tests/test_endpoint_policy_inventory.py` are not affected: this task adds no route, no `EndpointPolicy` and no second `@app.before_request` (`test_only_dashboard_entry_redirect_remains_as_jira_server_before_request` pins the single hook), so both pass without edits. If either needs a change, stop: the implementation drifted from the design.

- [ ] **Step 11: Commit**

```bash
git add backend/auth/share_view_stash.py backend/routes/auth_routes.py jira_server.py \
  tests/fixtures/share-view-query-corpus-example-sanitized.json tests/oauth_test_helpers.py \
  tests/test_auth_entry_page.py tests/test_auth_routes.py tests/test_codebase_structure_budgets.py \
  tests/test_db_oauth_cutover.py tests/test_share_view_stash.py
git diff --cached --check
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Carry shareable view links through the OAuth login hop" -m "A link opened while signed out lost its query at the login redirect. The validated query (at most 1,536 bytes, strict pattern shared with the frontend codec through a sanitized corpus fixture) now rides in the signed session cookie and is applied only as the literal '/?' + query after sign-in, within 15 minutes. It is written on GET at the final unauthenticated branch, consumed at the callback success and the two authenticated /login redirects, cleared on logout and authenticated entry, kept by a failed callback, and dropped by a 3,300-byte cookie guard so oauth_state is never lost. jira_server.py grows by four lines and its pin moves to 6,491."
git show --stat HEAD
git status --short
```
Expected: `git add` exits 0 and `git diff --cached --check` prints nothing; `git show --stat HEAD` lists exactly ten paths (new: the module, the fixture, `tests/test_share_view_stash.py`; modified: `jira_server.py`, `backend/routes/auth_routes.py`, `tests/oauth_test_helpers.py`, `tests/test_auth_entry_page.py`, `tests/test_auth_routes.py`, `tests/test_db_oauth_cutover.py`, `tests/test_codebase_structure_budgets.py`) with about 1,130 insertions and 7 deletions and no `| 0` row; `git status --short` prints nothing. If `git add` fails, stop, run `git status`, and re-stage explicitly before committing.

---

### Task 2: Log hygiene and privacy notice

> **OPERATOR GATE G1.** Execute this task only after the operator confirms design Open item 3 (the container access-log format change). The access-log change and the `find` key stand or fall together. If the operator declines, follow "If the operator declines" at the end of this task and remove `find` from the schema in Task 3.

**Owner note:** Depends on Task 1 (the privacy text describes its pending-link cookie; both tasks edit `jira_server.py`). Blocks nothing in code.

**Files:**
- Modify: `scripts/docker-entrypoint.sh` (the `exec gunicorn` argument list)
- Modify: `jira_server.py` (`SENSITIVE_CALLBACK_QUERY_RE`, `redact_sensitive_log_text`; line count unchanged)
- Modify: `docs/PRIVACY.md` (section "Data the software can process"; section "Storage and security")
- Test: `tests/test_container_packaging.py` (`ContainerPackagingTests`), `tests/test_logging_migration.py` (`TestLoggingMigration`)

**Interfaces:**
- Consumes: Task 1's pending-link cookie behavior (described in the privacy text; no code interface).
- Produces: no code interface.

**Forbidden regressions for this task:**
- The container still runs optional migrations, then the preflight, then `exec gunicorn` with the same bind, workers, threads and timeout; access and error logs still go to stdout and stderr.
- OAuth callback query redaction behaves exactly as before (`test_werkzeug_logs_redact_oauth_callback_query` passes unmodified); the callback `code` and `state` are never logged.
- Ordinary dashboard requests (`/`, `/?perf=1`, `?v=1` on an asset or API path) stay readable in the development log.
- A decoded newline or other control character in a request path never starts a second access-log line: the path is rendered with `%(U)r` and the Basic-auth user name, the other field that could carry a newline, is not logged.
- `jira_server.py` stays at 6,491 lines (no pin change in this task).

**gunicorn 23 format identifiers (read from the installed `gunicorn/glogging.py`, `gunicorn/config.py` `AccessLogFormat` and `gunicorn/http/message.py`):** `h` remote address, `l` `-`, `u` HTTP Basic user name, `t` date in brackets, `m` request method, `U` URL path without the query string, `H` protocol, `s` status, `b` response length or `-`, `a` user agent; `r` is `METHOD RAW_URI PROTOCOL` and carries the query string, `q` is the query string, `f` is the Referer. `U` is the percent-DECODED `PATH_INFO` (`util.unquote_to_wsgi_str`), so a request to `/%0A...` would put a raw newline into the log; `u` is a client-supplied Basic-auth name with the same flaw. The format therefore drops `l` and `u` and renders the path with `%(U)r` (`repr` escapes the newline). `m` and `H` are validated tokens and `a` cannot hold CR, LF or NUL (gunicorn's parser rejects them: `RFC9110_5_5_INVALID_AND_DANGEROUS`). An unknown identifier renders as `-` without an error, which is why Step 1 renders real lines instead of only searching the text.

- [ ] **Step 1: Write the failing packaging tests**

Edit `tests/test_container_packaging.py`.

Replace this (the head of the last test):

```python
    def test_container_workflow_builds_image_without_deploying(self):
```

With this (a constant, two helpers and four new tests inserted before it):

```python
    EXPECTED_ACCESS_LOG_FORMAT = '%(h)s %(t)s "%(m)s %(U)r %(H)s" %(s)s %(b)s "%(a)s"'

    def entrypoint_access_log_format(self):
        entrypoint = (ROOT / "scripts" / "docker-entrypoint.sh").read_text(encoding="utf8")
        match = re.search(r"--access-logformat '([^']*)'", entrypoint)
        self.assertIsNotNone(match, "the entrypoint must pass a single-quoted --access-logformat to gunicorn")
        return match.group(1)

    def render_access_log_line(self, raw_uri, path_info, query_string=""):
        """Render one line with gunicorn's own atoms() and SafeAtoms, as gunicorn's access log does."""
        from datetime import timedelta
        from types import SimpleNamespace

        from gunicorn.glogging import Logger, SafeAtoms

        referer = "https://planner.example/?v=1&mode=board&find=secret-text"
        environ = {
            "REMOTE_ADDR": "10.0.0.7",
            "REQUEST_METHOD": "GET",
            "RAW_URI": raw_uri,
            "SERVER_PROTOCOL": "HTTP/1.1",
            "PATH_INFO": path_info,
            "QUERY_STRING": query_string,
            "HTTP_REFERER": referer,
            "HTTP_USER_AGENT": "unit-test",
        }
        response = SimpleNamespace(status="200 OK", sent=512, headers=[])
        request = SimpleNamespace(headers=[("Referer", referer)])
        # A mistyped atom renders as "-" instead of failing, so the tests compare the rendered text.
        atoms = Logger.__new__(Logger).atoms(response, request, environ, timedelta(milliseconds=5))
        return self.entrypoint_access_log_format() % SafeAtoms(atoms)

    def test_entrypoint_access_log_format_is_the_reviewed_one(self):
        self.assertEqual(self.entrypoint_access_log_format(), self.EXPECTED_ACCESS_LOG_FORMAT)

    def test_entrypoint_access_log_format_has_no_query_referer_or_raw_client_atoms(self):
        access_format = self.entrypoint_access_log_format()

        for atom, reason in (
            ("%(r)s", "the request line carries the query string"),
            ("%(q)s", "the query string"),
            ("%(f)s", "the Referer carries the full link URL"),
            ("%(l)s", "dropped together with the user name"),
            ("%(u)s", "the Basic-auth user name is client-controlled and can hold a newline"),
            ("%(U)s", "the decoded path is client-controlled and can hold a newline"),
        ):
            with self.subTest(atom=atom):
                self.assertNotIn(atom, access_format, reason)
        self.assertIn("%(U)r", access_format)  # repr escapes a decoded newline

    def test_entrypoint_access_log_line_has_the_path_but_no_query_or_referer(self):
        line = self.render_access_log_line(
            raw_uri="/api/auth/status?v=1&mode=board&find=secret-text",
            path_info="/api/auth/status",
            query_string="v=1&mode=board&find=secret-text",
        )

        self.assertRegex(line, r"""^10\.0\.0\.7 \[[^\]]+\] "GET '/api/auth/status' HTTP/1\.1" 200 512 "unit-test"$""")
        self.assertNotIn("secret-text", line)

    def test_entrypoint_access_log_line_stays_one_line_for_a_decoded_newline_in_the_path(self):
        from gunicorn import util

        raw_uri = "/%0A10.0.0.9%20-%20%5B14/Oct/2026%5D%20%22GET%20/admin%22%20200%20-"
        path_info = util.unquote_to_wsgi_str(raw_uri)  # how gunicorn derives PATH_INFO
        self.assertIn("\n", path_info)

        line = self.render_access_log_line(raw_uri=raw_uri, path_info=path_info)

        self.assertEqual(len(line.splitlines()), 1)
        self.assertIn("'/\\n10.0.0.9 - [14/Oct/2026]", line)

    def test_container_workflow_builds_image_without_deploying(self):
```

- [ ] **Step 2: Run them and confirm they fail**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_container_packaging
```
Expected: `FAILED (failures=4)`; every failure reads `AssertionError: unexpectedly None : the entrypoint must pass a single-quoted --access-logformat to gunicorn`.

- [ ] **Step 3: Implement the access-log format**

Edit `scripts/docker-entrypoint.sh`.

Replace this (two lines of the `exec gunicorn` list):

```sh
  --access-logfile - \
  --error-logfile - \
```

With this:

```sh
  --access-logfile - \
  --access-logformat '%(h)s %(t)s "%(m)s %(U)r %(H)s" %(s)s %(b)s "%(a)s"' \
  --error-logfile - \
```

The format is gunicorn's default with `%(l)s %(u)s` and the Referer field removed and `"%(r)s"` replaced by `"%(m)s %(U)r %(H)s"`: method, escaped path without its query, protocol. The path now appears single-quoted inside the request field (`"GET '/x' HTTP/1.1"`), and the line has three fields fewer than the Apache combined format. The shell keeps the single-quoted value as one argument.

- [ ] **Step 4: Run and confirm pass**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_container_packaging
```
Expected: `Ran 12 tests` and `OK`.

- [ ] **Step 5: Prove the script's own arguments reach gunicorn intact**

Run:
```bash
sh -n scripts/docker-entrypoint.sh
sed -n '/^exec gunicorn/,$p' scripts/docker-entrypoint.sh | sed 's/^exec gunicorn/printf "[%s]\\n"/' | sh
sed -n '/^exec gunicorn/,$p' scripts/docker-entrypoint.sh | sed "s|^exec gunicorn|$PY -m gunicorn --print-config|" | env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' sh | grep -E '^(access_log_format|accesslog|errorlog) '
```
Expected: `sh -n` prints nothing. The second command prints each argument on its own line, including `[--access-logformat]` followed by `[%(h)s %(t)s "%(m)s %(U)r %(H)s" %(s)s %(b)s "%(a)s"]` and ending with `[jira_server:app]`. The third prints the format as gunicorn resolves it, plus `accesslog = -` and `errorlog = -`:
```text
access_log_format                  = %(h)s %(t)s "%(m)s %(U)r %(H)s" %(s)s %(b)s "%(a)s"
accesslog                          = -
errorlog                           = -
```
`--print-config` imports `jira_server` and exits; it starts no server.

- [ ] **Step 6: Write the failing log-redaction tests**

Edit `tests/test_logging_migration.py`.

Replace this (the end of the last test and the module footer):

```python
        self.assertNotIn('state-secret', output)
        self.assertNotIn('code-secret', output)


if __name__ == '__main__':
    unittest.main()
```

With this (three new tests inserted before the footer):

```python
        self.assertNotIn('state-secret', output)
        self.assertNotIn('code-secret', output)

    @unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
    def test_werkzeug_logs_redact_share_view_link_query(self):
        werkzeug_logger = logging.getLogger('werkzeug')
        request_lines = (
            'GET /?v=1&mode=board&find=secret-text HTTP/1.1',
            'GET /jira-dashboard.html?v=1&mode=board&find=secret-text HTTP/1.1',
            'HEAD /?v=1&find=say%20"hi"%20secret-text HTTP/1.1',
        )

        for request_line in request_lines:
            with self.subTest(request_line=request_line):
                with self.assertLogs('werkzeug', level='INFO') as captured:
                    werkzeug_logger.info('127.0.0.1 - - [14/Oct/2026 12:00:00] "%s" 200 -', request_line)

                output = '\n'.join(captured.output)
                self.assertRegex(output, r'"(GET|HEAD) /(jira-dashboard\.html)?\?\[redacted\] HTTP/1\.1" 200 -')
                self.assertNotIn('secret-text', output)
                self.assertNotIn('mode=board', output)

    @unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
    def test_development_server_request_line_for_a_share_view_link_is_redacted(self):
        # Werkzeug decodes %22 to a literal quote in the logged path, so the redaction must not stop at one.
        from werkzeug.serving import WSGIRequestHandler

        handler = WSGIRequestHandler.__new__(WSGIRequestHandler)
        handler.client_address = ('127.0.0.1', 50000)
        handler.command = 'GET'
        handler.request_version = 'HTTP/1.1'
        handler.path = '/?v=1&mode=board&find=say%20%22hi%22%20secret-text'

        with self.assertLogs('werkzeug', level='INFO') as captured:
            handler.log_request(200, 512)

        output = '\n'.join(captured.output)
        self.assertIn('"GET /?[redacted] HTTP/1.1" 200 512', output)
        self.assertNotIn('secret-text', output)

    @unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
    def test_werkzeug_logs_keep_ordinary_dashboard_requests_readable(self):
        werkzeug_logger = logging.getLogger('werkzeug')
        request_lines = (
            'GET / HTTP/1.1',
            'GET /?perf=1 HTTP/1.1',
            'GET /?mode=board&v=1 HTTP/1.1',
            'GET /api/tasks/?v=1 HTTP/1.1',
            'GET /frontend/dist/dashboard.js?v=1 HTTP/1.1',
        )

        for request_line in request_lines:
            with self.subTest(request_line=request_line):
                with self.assertLogs('werkzeug', level='INFO') as captured:
                    werkzeug_logger.info('127.0.0.1 - - [14/Oct/2026 12:00:00] "%s" 200 -', request_line)

                self.assertIn('"%s" 200 -' % request_line, '\n'.join(captured.output))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 7: Run them and confirm they fail**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_logging_migration
```
Expected: `FAILED (failures=4)` (three subtests of `test_werkzeug_logs_redact_share_view_link_query` and `test_development_server_request_line_for_a_share_view_link_is_redacted`); the message names the unredacted line, for example `... not found in 'INFO:werkzeug:127.0.0.1 - - [14/Oct/2026 12:00:00] "GET /?v=1&mode=board&find=secret-text HTTP/1.1" 200 -'`. The existing callback test and the keep-readable test pass.

- [ ] **Step 8: Implement the redaction**

Edit `jira_server.py`.

Replace this (`SENSITIVE_CALLBACK_QUERY_RE`):

```python
SENSITIVE_CALLBACK_QUERY_RE = re.compile(
    r'(/api/auth/atlassian/callback)\?[^ \t\r\n"]+'
)
```

With this:

```python
SENSITIVE_CALLBACK_QUERY_RE = re.compile(
    r'(/api/auth/atlassian/callback)\?[^ \t\r\n"]+|((?<= )/(?:jira-dashboard\.html)?)\?(?=v=\d)[^ \t\r\n]+'
)
```

Replace this (the last line of `redact_sensitive_log_text`):

```python
    return SENSITIVE_CALLBACK_QUERY_RE.sub(r'\1?[redacted]', value)
```

With this:

```python
    return SENSITIVE_CALLBACK_QUERY_RE.sub(r'\1\2?[redacted]', value)
```

The second branch redacts only a root-path request whose query starts with `v=<digit>` and, unlike the callback branch, runs to the next ASCII whitespace instead of stopping at a quote: Werkzeug decodes `%22` to a literal `"` in the logged path, so stopping at a quote would leak the search text that follows it.

- [ ] **Step 9: Run and confirm pass, and confirm the line pin is untouched**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_logging_migration tests.test_codebase_structure_budgets
wc -l < jira_server.py
```
Expected: `Ran 11 tests` and `OK`; `6491`.

- [ ] **Step 10: Update `docs/PRIVACY.md`**

Edit `docs/PRIVACY.md` (two edits).

Edit A states what a link and the pending-link cookie contain.

Replace this (the end of the "Data the software can process" list and the next paragraph's first line):

```text
  `localStorage`, an analytics login-deduplication marker in `sessionStorage`,
  and authentication/session and CSRF state in a cookie.

The software uses this data to authenticate users, authorize application
```

With this:

```text
  `localStorage`, an analytics login-deduplication marker in `sessionStorage`,
  and authentication/session and CSRF state in a cookie.

A signed-in user can copy a shareable link to the current dashboard view. The
link is a plain URL on the same instance whose query string lists the selectors
that recreate the view: the Department group and Sprint identifiers, selected
Team identifiers, filter selections such as status and priority names, alert
categories, the text typed into the search box, and optionally one Epic or
Story key. It contains no tokens or credentials, and opening it does not change
any Jira data. Anyone who receives the link can read that text, and it remains
wherever the link is pasted and in browser history. When a signed-out user
opens a link, the software keeps the link's query text in the signed (not
encrypted) session cookie so the view can be applied after sign-in. It removes
that value when sign-in finishes, when the user signs out, or when the user
opens the dashboard while signed in, ignores it once it is more than 15 minutes
old, and does not store the link anywhere else.

The software uses this data to authenticate users, authorize application
```

Edit B states the access-log change.

Replace this (the end of the caches paragraph in "Storage and security" and the next heading):

```text
configuration files. Cache expiration does not determine how long database
records, logs, configuration files, or backups are retained.

## External services
```

With this:

```text
configuration files. Cache expiration does not determine how long database
records, logs, configuration files, or backups are retained.

The container entrypoint writes the Gunicorn access log with the client
address, time, request method, URL path, protocol, status, response size, and
user agent. It does not record query strings, the `Referer` header, or an HTTP
Basic user name, so shareable-link contents (including search text) and OAuth
callback parameters are not written to that log. The development server started
with `python jira_server.py` redacts the query of the OAuth callback and of
shareable links from its request log. A proxy, load balancer, or log pipeline
that the deployment operator places in front of the application may still
record full request URLs and `Referer` headers under its own configuration.

## External services
```

Leave `Effective date` unchanged; whether to bump it on publication is the operator's decision. Verify:
```bash
rg -n "shareable link|Referer" docs/PRIVACY.md
awk 'length($0) > 80' docs/PRIVACY.md
git diff --stat -- docs/PRIVACY.md
```
Expected: four matches (one in edit A, three in edit B); `awk` prints nothing; the diffstat reports 24 insertions for `docs/PRIVACY.md`.

- [ ] **Step 11: Run the task's regression gate**

Run:
```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_container_packaging tests.test_logging_migration tests.test_codebase_structure_budgets tests.test_cloud_sql_iam
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest discover -s tests
```
Expected: the first command prints `Ran 50 tests` and `OK` (`test_cloud_sql_iam` also reads the entrypoint; it must pass unmodified). The full suite shows the post-Task-1 total plus exactly 7 new tests (4 + 3), the same skips and no new failure.

- [ ] **Step 12: Commit**

```bash
git add scripts/docker-entrypoint.sh jira_server.py docs/PRIVACY.md tests/test_container_packaging.py tests/test_logging_migration.py
git diff --cached --check
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Keep link queries and Referer out of request logs" -m "Search text in a shareable link must not reach logs. The container access log now records the method, the path without its query and the protocol, with the decoded path escaped (%(U)r) so a newline in a request path cannot forge a second line; the Referer, the Basic-auth user name and the unused ident field are gone. That also stops logging the OAuth callback code and state there. The development-server redaction covers root-path requests whose query starts with v=<digit>. The privacy notice lists the pending-link cookie value, the link contents and the log change."
git show --stat HEAD
git status --short
```
Expected: `git diff --cached --check` prints nothing; `git show --stat HEAD` lists exactly five paths (about 154 insertions and 2 deletions: the entrypoint +1, `tests/test_container_packaging.py` +72, `tests/test_logging_migration.py` +55, `docs/PRIVACY.md` +24, `jira_server.py` +2/-2); `git status --short` prints nothing.

#### If the operator declines (gate G1)

The decline path, step by step:

1. **Skip the access-log format and the redaction extension.** Do not run Steps 1 to 9 and Step 11. Leave `scripts/docker-entrypoint.sh`, `jira_server.py`, `tests/test_container_packaging.py` and `tests/test_logging_migration.py` unchanged.
2. **Still apply the privacy notice, without the search-text clause.** The pending-link cookie from Task 1 exists whether or not `find` ships. In Step 10 apply edit A' below instead of edit A and skip edit B (no access-log paragraph). The verification commands of Step 10 then print one `rg` match, nothing from `awk`, and 13 insertions for `docs/PRIVACY.md`.
3. **Remove `find` in Task 3.** Task 3's "If the operator declines Task 2" section removes `find` from the schema; apply it.
4. Commit only `docs/PRIVACY.md` with the commands below and record `declined` for Task 2 in the plan's Execution status table.

Edit A': replace the same "Replace this" block of edit A with this (no search-text clause, no access-log paragraph):

```text
  `localStorage`, an analytics login-deduplication marker in `sessionStorage`,
  and authentication/session and CSRF state in a cookie.

A signed-in user can copy a shareable link to the current dashboard view. The
link is a plain URL on the same instance whose query string lists the selectors
that recreate the view: the Department group and Sprint identifiers, selected
Team identifiers, filter selections such as status and priority names, alert
categories, and optionally one Epic or Story key. It contains no tokens or
credentials, and opening it does not change any Jira data. Anyone who receives
the link can read that text, and it remains wherever the link is pasted and in
browser history. When a signed-out user opens a link, the software keeps the
link's query text in the signed (not encrypted) session cookie so the view can
be applied after sign-in. It removes that value when sign-in finishes, when the
user signs out, or when the user opens the dashboard while signed in, ignores it
once it is more than 15 minutes old, and does not store the link anywhere else.

The software uses this data to authenticate users, authorize application
```

```bash
git add docs/PRIVACY.md
git diff --cached --check
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Document the pending shareable link cookie in the privacy notice" -m "A link opened while signed out is kept in the signed session cookie until sign-in finishes. The notice lists that value and the link contents."
git show --stat HEAD
git status --short
```

---

## Notes for the executor

Decisions already settled while this slice was drafted; none changes a binding name in the master.

1. The corpus `rejects` holds only entries the codec reports as invalid (raw-alphabet violations and a malformed `v`). Queries only the stash rejects (percent-encoded controls, malformed percent sequences, a key with an underscore, 41 further pairs, the generated cap cases) live in `tests/test_share_view_stash.py`, because the decoder is deliberately less strict than the stash (defense in depth).
2. `accepts` is hand-built in the design's key order with defaults omitted. Task 3 asserts each entry decodes to `ok` and may regenerate entries if its encoder's canonical order differs.
3. `stash_share_view_query` keeps its `None` return; `Cache-Control: no-store` is attached with `flask.after_this_request` only when a stash was stored, which keeps `jira_server.py` at four added lines.
4. `jira_server.py` is pinned at 6,487 lines. The import and three call lines make 6,491; Task 1 Step 9 ratchets the pin with a one-line reason. Task 2's regex edit is line-neutral.
5. Files beyond the design's list: `tests/oauth_test_helpers.py` (one shared `forbid_jira_http`) and `tests/test_codebase_structure_budgets.py`. The chain tests live in the three existing auth test modules plus `tests/test_share_view_stash.py`; there is no `tests/test_share_view_login_return.py`.
6. Gate G1: if the operator declines, skip the access-log format and the redaction extension, still apply the `docs/PRIVACY.md` edit without the search-text clause (the pending-link cookie needs its notice), and apply Task 3's decline edits, which remove `find`. The `Effective date` in `docs/PRIVACY.md` is left for the operator to bump at publication.
7. The access-log format drops `%(l)s %(u)s` and renders the path with `%(U)r`: gunicorn's `%(U)s` is the percent-decoded path, so a `%0A` path would forge a second log line. Step 5 proves the script's own arguments reach gunicorn intact.
8. The full Python suite has two load-sensitive `test_local_postgresql_runner` signal tests that failed on the base in the drafting environment and pass alone. Record them in Task 0 and do not treat them as regressions. CI runs Python 3.10 and 3.11, which the drafting run did not execute; the new Python parses under 3.10 syntax.
