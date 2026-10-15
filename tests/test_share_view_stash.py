import ast
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
MODULE_PATH = Path(__file__).resolve().parents[1] / 'backend' / 'auth' / 'share_view_stash.py'
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

    def test_module_imports_nothing_beyond_what_it_needs(self):
        # The stash runs on unauthenticated requests: it must never reach Jira, Home/Townsquare or token code.
        source = MODULE_PATH.read_text(encoding='utf-8')
        imported = set()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split('.')[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add('.' * node.level + (node.module or '').split('.')[0])
        self.assertEqual(imported - {'re', 'time', 'contextlib', 'flask'}, set())
        self.assertNotIn('__import__', source)

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
