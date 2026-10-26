"""Tests for backend.response_compression: gzip for JSON and static responses."""

import gzip
import json
import os
import random
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask, Response, jsonify, send_file, send_from_directory

import jira_server
from backend import response_compression
from backend.response_compression import (
    COMPRESSIBLE_TYPES,
    EXCLUDED_PATH_PREFIXES,
    EXCLUDED_PATH_SUFFIXES,
    GZIP_LEVEL,
    MAX_MEMOIZED_ASSETS,
    MIN_COMPRESS_BYTES,
    register_response_compression,
)
from backend.routes import analytics_routes, scenario_draft_routes


GZIP = {'Accept-Encoding': 'gzip'}
CLIENTS = {
    'gzip': GZIP,
    'identity': {'Accept-Encoding': 'identity'},
    'gzip;q=0': {'Accept-Encoding': 'gzip;q=0'},
}
DIST_DIR = Path(__file__).resolve().parent.parent / 'frontend' / 'dist'


def lane_payload(issue_count):
    """Synthetic Catch Up lane JSON: no real Jira data, realistic repeated structure."""
    rng = random.Random(20261026)
    statuses = ['To Do', 'In Progress', 'In Review', 'Done']
    return {
        'issues': [
            {
                'key': f'ENG-{1000 + index}',
                'id': str(10000 + index * 7),
                'fields': {
                    'summary': f'Synthetic story {index} used only for the compression payload',
                    'status': {'name': statuses[index % 4], 'id': str(3 + index % 4)},
                    'priority': {'name': 'Medium', 'id': '3'},
                    'issuetype': {'name': 'Story', 'id': '10001'},
                    'assignee': {
                        'displayName': f'Person {index % 12}',
                        'accountId': f'account-{index % 12:04d}',
                    },
                    'labels': ['team-alpha', 'quarter-four'],
                    'customfield_10004': float(rng.randint(1, 8)),
                    'updated': f'2026-10-{1 + index % 26:02d}T{index % 24:02d}:{rng.randint(0, 59):02d}:00.000+0000',
                    'parent': {'key': f'ENG-{500 + index // 5}', 'summary': f'Synthetic epic {index // 5}'},
                    'project': {'key': 'ENG', 'name': 'Synthetic project'},
                },
            }
            for index in range(issue_count)
        ],
        'total': issue_count,
    }


class BufferedClient:
    """Test client that reads each response through and closes it, so file handles do not leak."""

    def __init__(self, client):
        self._client = client

    def get(self, *args, **kwargs):
        kwargs.setdefault('buffered', True)
        return self._client.get(*args, **kwargs)

    def head(self, *args, **kwargs):
        kwargs.setdefault('buffered', True)
        return self._client.head(*args, **kwargs)


def vary_tokens(response):
    return {
        token.strip().lower()
        for line in response.headers.getlist('Vary')
        for token in line.split(',')
        if token.strip()
    }


class SmallAppCase(unittest.TestCase):
    """A small Flask app with register_response_compression and the routes the rules need."""

    def setUp(self):
        response_compression._MEMOIZED_ASSETS.clear()
        self.addCleanup(response_compression._MEMOIZED_ASSETS.clear)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dist = Path(tmp.name)
        self.consumed = {'gen-json': 0, 'gen-ndjson': 0, 'gen-sse': 0}
        self.big_body = json.dumps(lane_payload(20), separators=(',', ':')).encode()
        self.assertGreater(len(self.big_body), 5 * 1024)

        (self.dist / 'app.js').write_text('const synthetic = "' + 'abc123 ' * 900 + '";\n')
        (self.dist / 'cold.js').write_text('const cold = "' + 'xyz789 ' * 900 + '";\n')
        (self.dist / 'tiny.js').write_text('const tiny = 1;\n')
        (self.dist / 'big.js.map').write_text('{"version":3,"mappings":"' + 'AAAA,' * 1200 + '"}')
        (self.dist / 'image.png').write_bytes(bytes(range(256)) * 12)
        (self.dist / 'plain.js').write_text('const plain = "' + 'p' * 3000 + '";\n')

        app = Flask(__name__)
        self.app = app
        register_response_compression(app)
        big_body = self.big_body
        consumed = self.consumed
        dist = self.dist

        @app.route('/json')
        def json_route():
            response = Response(big_body, mimetype='application/json')
            response.add_etag()
            return response

        @app.route('/small')
        def small():
            return jsonify({'ok': True})

        @app.route('/lane')
        def lane():
            return jsonify(lane_payload(250))

        def generator(name, chunk):
            def run():
                for _ in range(3):
                    consumed[name] += 1
                    yield chunk
            return run()

        @app.route('/gen-json')
        def gen_json():
            return Response(generator('gen-json', b'{"a":"' + b'x' * 2000 + b'"}\n'), mimetype='application/json')

        @app.route('/gen-ndjson')
        def gen_ndjson():
            return Response(generator('gen-ndjson', b'{"a":"' + b'x' * 2000 + b'"}\n'), mimetype='application/x-ndjson')

        @app.route('/gen-sse')
        def gen_sse():
            return Response(generator('gen-sse', b'event: tick\ndata: ' + b'x' * 2000 + b'\n\n'), mimetype='text/event-stream')

        @app.route('/file.js')
        def file_js():
            return send_file(dist / 'plain.js', mimetype='text/javascript')

        @app.route('/encoded')
        def encoded():
            response = Response(big_body, mimetype='application/json')
            response.headers['Content-Encoding'] = 'br'
            return response

        @app.route('/no-transform')
        def no_transform():
            response = Response(big_body, mimetype='application/json')
            response.headers['Cache-Control'] = 'no-transform'
            return response

        @app.route('/partial')
        def partial():
            response = Response(big_body, status=206, mimetype='application/json')
            response.headers['Content-Range'] = f'bytes 0-{len(big_body) - 1}/{len(big_body)}'
            return response

        @app.route('/missing')
        def missing():
            return Response(big_body, status=404, mimetype='application/json')

        @app.route('/api/auth/token')
        def auth_token():
            return Response(big_body, mimetype='application/json')

        @app.route('/image.png')
        def image():
            return Response(bytes(range(256)) * 12, mimetype='image/png')

        @app.route('/blob')
        def blob():
            return Response(big_body, mimetype='application/octet-stream')

        @app.route('/double-vary')
        def double_vary():
            response = Response(big_body, mimetype='application/json')
            response.headers.add('Vary', 'Origin')
            response.headers.add('Vary', 'Cookie')
            return response

        @app.route('/timing')
        def timing():
            response = Response(big_body, mimetype='application/json')
            response.headers['Server-Timing'] = 'total;dur=12.5'
            return response

        @app.route('/frontend/dist/<path:filename>')
        def dist_route(filename):
            response = send_from_directory(dist, filename)
            if filename.endswith('.map'):
                response.mimetype = 'application/json'
            return response

        self.client = BufferedClient(app.test_client())
        self.plain_json = self.client.get('/json').data


class ConstantsTests(unittest.TestCase):
    def test_interface_constants(self):
        self.assertEqual(1024, MIN_COMPRESS_BYTES)
        self.assertEqual(6, GZIP_LEVEL)
        self.assertEqual(32, MAX_MEMOIZED_ASSETS)
        self.assertEqual(frozenset({
            'application/json', 'text/javascript', 'application/javascript',
            'text/css', 'text/html', 'image/svg+xml',
        }), COMPRESSIBLE_TYPES)
        self.assertEqual(('/api/auth/',), EXCLUDED_PATH_PREFIXES)
        self.assertEqual(('.map',), EXCLUDED_PATH_SUFFIXES)

    def test_registered_first_so_it_runs_last(self):
        # Flask runs after_request handlers in reverse registration order.
        first = jira_server.app.after_request_funcs[None][0]
        self.assertEqual('backend.response_compression', first.__module__)


class CompressionRuleTests(SmallAppCase):
    def test_large_json_is_gzipped_and_round_trips(self):
        response = self.client.get('/json', headers=GZIP)

        self.assertEqual('gzip', response.headers['Content-Encoding'])
        self.assertEqual(str(len(response.data)), response.headers['Content-Length'])
        self.assertEqual(self.plain_json, gzip.decompress(response.data))
        self.assertIn('accept-encoding', vary_tokens(response))
        self.assertLess(len(response.data), len(self.plain_json))

    def test_missing_identity_and_q0_clients_get_the_plain_body_with_vary(self):
        for label, headers in ((None, {}), ('identity', CLIENTS['identity']), ('gzip;q=0', CLIENTS['gzip;q=0'])):
            with self.subTest(label):
                response = self.client.get('/json', headers=headers)
                self.assertNotIn('Content-Encoding', response.headers)
                self.assertEqual(self.plain_json, response.data)
                self.assertIn('accept-encoding', vary_tokens(response))
        for accept in ('*', 'gzip, br'):
            with self.subTest(accept):
                response = self.client.get('/json', headers={'Accept-Encoding': accept})
                self.assertEqual('gzip', response.headers['Content-Encoding'])
                self.assertEqual(self.plain_json, gzip.decompress(response.data))
                self.assertIn('accept-encoding', vary_tokens(response))

    def test_small_body_is_left_alone(self):
        response = self.client.get('/small', headers=GZIP)
        self.assertLess(len(response.data), MIN_COMPRESS_BYTES)
        self.assertNotIn('Content-Encoding', response.headers)
        self.assertEqual({'ok': True}, response.get_json())

        static = self.client.get('/frontend/dist/tiny.js', headers=GZIP)
        self.assertLess(len(static.data), MIN_COMPRESS_BYTES)
        self.assertNotIn('Content-Encoding', static.headers)
        self.assertFalse(static.headers['ETag'].startswith('W/'))

    def test_generator_responses_are_never_buffered_or_encoded(self):
        for route, name in (('/gen-json', 'gen-json'), ('/gen-ndjson', 'gen-ndjson'), ('/gen-sse', 'gen-sse')):
            with self.subTest(route):
                response = self.client.get(route, headers=GZIP, buffered=False)
                # The test client itself pulls at most one chunk to find the status line;
                # a buffering handler would already have consumed all three.
                self.assertLessEqual(self.consumed[name], 1)
                self.assertNotIn('Content-Encoding', response.headers)
                body = b''.join(response.response)
                self.assertEqual(3, self.consumed[name])
                self.assertEqual(3, body.count(b'x' * 2000))
        # send_file responses are is_streamed too, but direct_passthrough: those are compressed.
        file_response = self.client.get('/file.js', headers=GZIP)
        self.assertEqual('gzip', file_response.headers['Content-Encoding'])
        self.assertEqual((self.dist / 'plain.js').read_bytes(), gzip.decompress(file_response.data))

    def test_encoded_no_transform_range_head_and_error_responses_are_skipped(self):
        for route in ('/encoded', '/no-transform', '/partial', '/missing'):
            with self.subTest(route):
                response = self.client.get(route, headers=GZIP)
                self.assertEqual(self.big_body, response.data)
                self.assertNotEqual('gzip', response.headers.get('Content-Encoding'))
        self.assertEqual('br', self.client.get('/encoded', headers=GZIP).headers['Content-Encoding'])
        self.assertEqual(206, self.client.get('/partial', headers=GZIP).status_code)
        self.assertEqual(404, self.client.get('/missing', headers=GZIP).status_code)
        # HEAD is processed exactly like GET, so a HEAD of a response GET leaves alone is left alone too.
        for route in ('/encoded', '/no-transform', '/partial', '/missing'):
            with self.subTest('HEAD ' + route):
                head = self.client.head(route, headers=GZIP)
                get = self.client.get(route, headers=GZIP)
                self.assertEqual(get.headers.get('Content-Encoding'), head.headers.get('Content-Encoding'))
                self.assertNotEqual('gzip', head.headers.get('Content-Encoding'))
                self.assertEqual(str(len(self.big_body)), head.headers['Content-Length'])
                self.assertEqual(b'', head.data)

    def test_auth_routes_source_maps_and_non_allowlisted_types_are_skipped(self):
        for route in ('/api/auth/token', '/frontend/dist/big.js.map', '/image.png', '/blob'):
            with self.subTest(route):
                response = self.client.get(route, headers=GZIP)
                self.assertEqual(200, response.status_code)
                self.assertGreater(len(response.data), MIN_COMPRESS_BYTES)
                self.assertNotIn('Content-Encoding', response.headers)
        source_map = self.client.get('/frontend/dist/big.js.map', headers=GZIP)
        self.assertEqual('application/json', source_map.mimetype)
        self.assertEqual((self.dist / 'big.js.map').read_bytes(), source_map.data)
        self.assertFalse(source_map.headers['ETag'].startswith('W/'))
        self.assertEqual('bytes', source_map.headers['Accept-Ranges'])


class StaticAssetTests(SmallAppCase):
    def test_static_asset_is_compressed_once_and_memoized(self):
        real_compress = gzip.compress
        calls = []
        delay = {'seconds': 0.05}

        def counting(data, *args, **kwargs):
            calls.append(len(data))
            time.sleep(delay['seconds'])  # widens the window for the concurrent-request check
            return real_compress(data, *args, **kwargs)

        with patch.object(gzip, 'compress', counting):
            first = self.client.get('/frontend/dist/app.js', headers=GZIP)
            second = self.client.get('/frontend/dist/app.js', headers=GZIP)
            self.assertEqual('gzip', first.headers['Content-Encoding'])
            self.assertEqual(first.data, second.data)
            self.assertEqual((self.dist / 'app.js').read_bytes(), gzip.decompress(second.data))
            self.assertEqual(1, len(calls))

            # Eight threads asking for one cold asset at once compress it once.
            barrier = threading.Barrier(8)
            results = [None] * 8

            def worker(index):
                client = BufferedClient(self.app.test_client())
                barrier.wait()
                results[index] = client.get('/frontend/dist/cold.js', headers=GZIP)

            threads = [threading.Thread(target=worker, args=(index,)) for index in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(2, len(calls))
            self.assertEqual({'gzip'}, {result.headers['Content-Encoding'] for result in results})
            self.assertEqual(1, len({result.data for result in results}))

            # A changed file (new mtime and size) is a new ETag, so one more compression.
            path = self.dist / 'app.js'
            path.write_text(path.read_text() + '// changed\n')
            os.utime(path, (time.time() + 60, time.time() + 60))
            changed = self.client.get('/frontend/dist/app.js', headers=GZIP)
            self.assertEqual(3, len(calls))
            self.assertEqual(path.read_bytes(), gzip.decompress(changed.data))
            self.assertNotEqual(first.headers['ETag'], changed.headers['ETag'])

            # The cache is bounded and evicts the oldest entry.
            response_compression._MEMOIZED_ASSETS.clear()
            del calls[:]
            delay['seconds'] = 0
            for index in range(MAX_MEMOIZED_ASSETS + 8):
                (self.dist / f'bulk{index}.js').write_text(f'const bulk{index} = "' + 'q' * 2000 + '";\n')
                self.client.get(f'/frontend/dist/bulk{index}.js', headers=GZIP)
            self.assertEqual(MAX_MEMOIZED_ASSETS + 8, len(calls))
            self.assertEqual(MAX_MEMOIZED_ASSETS, len(response_compression._MEMOIZED_ASSETS))
            self.client.get(f'/frontend/dist/bulk{MAX_MEMOIZED_ASSETS + 7}.js', headers=GZIP)
            self.assertEqual(MAX_MEMOIZED_ASSETS + 8, len(calls))
            self.client.get('/frontend/dist/bulk0.js', headers=GZIP)
            self.assertEqual(MAX_MEMOIZED_ASSETS + 9, len(calls))
            self.assertEqual(MAX_MEMOIZED_ASSETS, len(response_compression._MEMOIZED_ASSETS))

    def test_json_responses_are_never_memoized(self):
        self.client.get('/json', headers=GZIP)
        self.assertEqual(0, len(response_compression._MEMOIZED_ASSETS))

    def test_static_conditional_request_returns_304_with_matching_validators(self):
        first = self.client.get('/frontend/dist/app.js', headers=GZIP)
        etag = first.headers['ETag']
        self.assertTrue(etag.startswith('W/'))
        self.assertNotIn('Accept-Ranges', first.headers)

        second = self.client.get('/frontend/dist/app.js', headers={**GZIP, 'If-None-Match': etag})

        self.assertEqual(304, second.status_code)
        self.assertEqual(b'', second.data)
        self.assertEqual(etag, second.headers['ETag'])
        self.assertEqual(first.headers.getlist('Vary'), second.headers.getlist('Vary'))

    def test_head_describes_the_same_representation_as_get_for_every_client(self):
        for label, headers in CLIENTS.items():
            for route in ('/frontend/dist/app.js', '/json'):
                with self.subTest(client=label, route=route):
                    get = self.client.get(route, headers=headers)
                    head = self.client.head(route, headers=headers)
                    self.assertEqual(200, head.status_code)
                    for name in ('ETag', 'Content-Encoding', 'Content-Type', 'Content-Length'):
                        self.assertEqual(get.headers.get(name), head.headers.get(name), name)
                        if name != 'Content-Encoding':
                            self.assertIsNotNone(head.headers.get(name), name)
                    self.assertEqual(get.headers.getlist('Vary'), head.headers.getlist('Vary'))
                    self.assertIn('accept-encoding', vary_tokens(head))
                    self.assertEqual(b'', head.data)
                    self.assertEqual(label == 'gzip', head.headers.get('Content-Encoding') == 'gzip')

    def test_every_304_carries_the_validators_of_its_200_for_every_client(self):
        for label, headers in CLIENTS.items():
            with self.subTest(client=label):
                ok = self.client.get('/frontend/dist/app.js', headers=headers)
                etag = ok.headers['ETag']
                self.assertEqual(label == 'gzip', etag.startswith('W/'))
                self.assertIn('accept-encoding', vary_tokens(ok))
                for method in (self.client.get, self.client.head):
                    not_modified = method('/frontend/dist/app.js', headers={**headers, 'If-None-Match': etag})
                    self.assertEqual(304, not_modified.status_code)
                    self.assertEqual(b'', not_modified.data)
                    self.assertEqual(etag, not_modified.headers['ETag'])
                    self.assertEqual(label == 'gzip', not_modified.headers['ETag'].startswith('W/'))
                    self.assertIn('accept-encoding', vary_tokens(not_modified))

    def test_json_etag_is_weak_only_when_the_body_is_encoded(self):
        plain = self.client.get('/json')
        encoded = self.client.get('/json', headers=GZIP)
        self.assertFalse(plain.headers['ETag'].startswith('W/'))
        self.assertEqual('W/' + plain.headers['ETag'], encoded.headers['ETag'])


class HeaderMergeTests(SmallAppCase):
    def test_every_vary_line_merges_and_handler_headers_survive(self):
        response = self.client.get('/double-vary', headers=GZIP)
        self.assertEqual('gzip', response.headers['Content-Encoding'])
        self.assertEqual({'origin', 'cookie', 'accept-encoding'}, vary_tokens(response))
        joined = ','.join(response.headers.getlist('Vary')).lower()
        self.assertEqual(1, joined.count('accept-encoding'))

        timing = self.client.get('/timing', headers=GZIP)
        self.assertEqual('gzip', timing.headers['Content-Encoding'])
        self.assertEqual('total;dur=12.5', timing.headers['Server-Timing'])


class RealAppTests(unittest.TestCase):
    def setUp(self):
        response_compression._MEMOIZED_ASSETS.clear()
        self.addCleanup(response_compression._MEMOIZED_ASSETS.clear)
        patcher = patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic')
        patcher.start()
        self.addCleanup(patcher.stop)
        jira_server.app.config['TESTING'] = True
        self.client = BufferedClient(jira_server.app.test_client())

    def test_real_board_stream_and_scenario_sse_routes_ignore_gzip(self):
        # The Board NDJSON half lives in tests/test_eng_board_routes.py; this is the SSE half.
        events = [
            {'eventType': 'draft.saved', 'eventNumber': number, 'payload': {'note': 'x' * 1500}}
            for number in (1, 2, 3)
        ]
        page = {'events': events, 'nextSince': 3, 'isLast': True}
        path = '/api/scenario/drafts/draft-1/events/stream?since=0'
        with patch.dict(os.environ, {'SCENARIO_DRAFT_SSE_ENABLED': 'true'}, clear=False), \
             patch.object(jira_server, 'database_storage_enabled', return_value=True), \
             patch.object(jira_server, 'scenario_draft_request_auth_context', return_value=object()), \
             patch.object(scenario_draft_routes, 'get_events_page', return_value=page):
            plain = self.client.get(path)
            gzipped = self.client.get(path, headers=GZIP)

        self.assertEqual(200, plain.status_code, plain.get_data(as_text=True))
        self.assertIn('text/event-stream', plain.content_type)
        self.assertGreater(len(plain.data), MIN_COMPRESS_BYTES)
        self.assertNotIn('Content-Encoding', gzipped.headers)
        self.assertEqual(plain.data, gzipped.data)

    def test_existing_headers_survive_and_every_vary_line_merges(self):
        status = self.client.get('/api/auth/status', headers=GZIP)
        self.assertEqual(200, status.status_code)
        self.assertEqual('no-store', status.headers['Cache-Control'])
        self.assertTrue(status.headers['Content-Security-Policy'].startswith("default-src 'self'"))
        self.assertNotIn('Content-Encoding', status.headers)

        class BigConfig:
            def validate_startup(self):
                return self

            def context_payload(self, _context):
                return lane_payload(30)

        with patch.object(analytics_routes, 'load_analytics_config', return_value=BigConfig()):
            response = self.client.get(
                '/api/analytics/context',
                headers={**GZIP, 'Origin': 'http://localhost:5050'},
            )
        self.assertEqual(200, response.status_code)
        self.assertEqual('gzip', response.headers['Content-Encoding'])
        self.assertEqual('no-store', response.headers['Cache-Control'])
        self.assertIn("default-src 'self'", response.headers['Content-Security-Policy'])
        self.assertEqual('nosniff', response.headers['X-Content-Type-Options'])
        self.assertTrue({'origin', 'accept-encoding'} <= vary_tokens(response), response.headers.getlist('Vary'))
        decoded = gzip.decompress(response.data)
        self.assertEqual(str(len(response.data)), response.headers['Content-Length'])
        self.assertIn(b'ENG-1000', decoded)

        health = self.client.get('/health', headers={**GZIP, 'Origin': 'http://localhost:5050'})
        self.assertNotIn('Content-Encoding', health.headers)
        self.assertTrue({'origin', 'accept-encoding'} <= vary_tokens(health))

    def test_real_dist_assets_compress_below_their_ratio_gates(self):
        chunks = sorted(
            (DIST_DIR / 'chunks').glob('chunk-*.js'),
            key=lambda path: path.stat().st_size,
            reverse=True,
        )
        self.assertTrue(chunks, 'frontend/dist/chunks has no chunk-*.js')
        gates = (
            (DIST_DIR / 'dashboard.js', 0.35),
            (DIST_DIR / 'dashboard.css', 0.20),
            (chunks[0], 0.40),
        )
        for path, ratio in gates:
            with self.subTest(path.name):
                self.assertTrue(path.is_file(), path)
                url = '/frontend/dist/' + path.relative_to(DIST_DIR).as_posix()
                raw = path.read_bytes()
                response = self.client.get(url, headers=GZIP)
                self.assertEqual(200, response.status_code)
                self.assertEqual('gzip', response.headers['Content-Encoding'])
                self.assertEqual(str(len(response.data)), response.headers['Content-Length'])
                self.assertTrue(response.headers['ETag'].startswith('W/'))
                self.assertEqual('no-cache', response.headers['Cache-Control'])
                self.assertIn('accept-encoding', vary_tokens(response))
                self.assertEqual(raw, gzip.decompress(response.data))
                self.assertLessEqual(len(response.data) / len(raw), ratio)

    def test_real_source_maps_are_never_compressed(self):
        source_map = DIST_DIR / 'dashboard.js.map'
        self.assertTrue(source_map.is_file())
        response = self.client.get('/frontend/dist/dashboard.js.map', headers=GZIP)
        self.assertEqual(200, response.status_code)
        self.assertNotIn('Content-Encoding', response.headers)
        self.assertEqual(source_map.stat().st_size, len(response.data))


class LanePayloadTests(SmallAppCase):
    def test_synthetic_lane_json_compresses_below_ten_percent(self):
        plain = self.client.get('/lane')
        encoded = self.client.get('/lane', headers=GZIP)

        self.assertGreater(len(plain.data), 100 * 1024)
        self.assertEqual('gzip', encoded.headers['Content-Encoding'])
        self.assertEqual(plain.data, gzip.decompress(encoded.data))
        self.assertLessEqual(len(encoded.data) / len(plain.data), 0.10)


if __name__ == '__main__':
    unittest.main()
