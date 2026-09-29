import json
import re
import unittest
import threading
from types import SimpleNamespace
from unittest.mock import patch

from backend.routes import eng_board_routes
from backend.services import eng_board
from backend.services.eng_board_stream import (
    EngBoardRequestBudget, EngBoardRequestTransport, EngBoardStreamWriter,
)
from tests.test_eng_board_routes import FakeResponse, board_snapshot, db_context, epic, child


class EngBoardProgressiveLoadingTests(unittest.TestCase):
    def test_parent_candidates_filtered_before_admitted_epic_limit(self):
        calls = []
        parent_count = 1001
        def search(payload, **kwargs):
            jql = payload['jql']
            calls.append(jql)
            if 'component in' in jql:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
            if 'issuetype = Epic' in jql:
                # Oracle: only ABC-2 passes the existing parent eligibility query.
                keys = re.findall(r'"(ABC-\d+)"', jql)
                rows = [epic('ABC-2', 'To Do')] if 'ABC-2' in keys else []
                return FakeResponse({'issues': rows, 'isLast': True})
            if 'cf[30101]' in jql:
                offset = int(payload.get('nextPageToken', '0'))
                rows = [child(f'ABC-{10000 + i}', f'ABC-{2 + i}')
                        for i in range(offset, min(offset + 100, parent_count))]
                last = offset + 100 >= parent_count
                return FakeResponse({'issues': rows, 'isLast': last,
                                     **({} if last else {'nextPageToken': str(offset + 100)})})
            return FakeResponse({'issues': [], 'isLast': True})
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search),
                board_snapshot(teams=('team-a',)), EngBoardRequestTransport())]
        self.assertEqual('complete', frames[-1]['type'])
        self.assertEqual('success', frames[-1]['outcome'])
        self.assertEqual(2, frames[-1]['epicCount'])
        self.assertEqual(0, frames[-1]['childCount'])
        self.assertEqual(26, sum('issuetype = Epic' in q and 'component in' not in q for q in calls))

    def test_true_admitted_parent_overflow_keeps_epic_limit(self):
        parent_count = eng_board.MAX_EPICS + 1
        parent_lookups = []

        def search(payload, **kwargs):
            jql = payload['jql']
            if 'issuetype = Epic' in jql:
                keys = re.findall(r'"(ABC-\d+)"', jql)
                parent_lookups.append(tuple(keys))
                return FakeResponse({'issues': [epic(key, 'To Do') for key in keys], 'isLast': True})
            if 'cf[30101]' in jql:
                offset = int(payload.get('nextPageToken', '0'))
                rows = [child(f'ABC-{20000 + i}', f'ABC-{2 + i}')
                        for i in range(offset, min(offset + 100, parent_count))]
                last = offset + 100 >= parent_count
                return FakeResponse({'issues': rows, 'isLast': last,
                                     **({} if last else {'nextPageToken': str(offset + 100)})})
            return FakeResponse({'issues': [], 'isLast': True})

        with self.assertLogs(eng_board_routes.LOGGER, level='WARNING') as logs, patch.object(
            eng_board_routes, '_assert_current', return_value=db_context(),
        ):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search),
                board_snapshot(components=(), teams=('team-a',)), EngBoardRequestTransport())]

        self.assertEqual('error', frames[-1]['type'])
        self.assertEqual('scope_too_large', frames[-1]['code'])
        self.assertFalse(any(frame.get('outcome') == 'success' for frame in frames))
        self.assertFalse(any(frame['type'] in {'progress', 'column', 'column_error'} for frame in frames))
        evidence = '\n'.join(logs.output)
        self.assertIn('code=board_scope_too_large', evidence)
        self.assertIn('phase=index', evidence)
        self.assertIn('limit=unique_keys', evidence)
        self.assertIn('observed=1001', evidence)
        candidates = [frame for frame in frames
                      if frame['type'] == 'index' and frame.get('membership') == 'candidate']
        self.assertTrue(candidates, 'the admitted prefix must be visible before true overflow')
        self.assertEqual(eng_board.MAX_EPICS, len(candidates[-1]['epics']))
        self.assertEqual(26, len(parent_lookups))
        self.assertTrue(all(len(batch) <= eng_board.MAX_BATCH_SIZE for batch in parent_lookups))

    def test_exact_team_parent_epic_limit_completes_authoritatively(self):
        parent_count = eng_board.MAX_EPICS
        parent_lookups = []

        def search(payload, **kwargs):
            jql = payload['jql']
            if 'issuetype = Epic' in jql:
                keys = re.findall(r'"(ABC-\d+)"', jql)
                parent_lookups.append(tuple(keys))
                return FakeResponse({
                    'issues': [epic(key, 'To Do') for key in keys], 'isLast': True,
                })
            if 'cf[30101]' in jql:
                offset = int(payload.get('nextPageToken', '0'))
                rows = [child(f'WORK-{i + 1:04d}', f'ABC-{i + 1:04d}')
                        for i in range(offset, min(offset + 100, parent_count))]
                last = offset + 100 >= parent_count
                return FakeResponse({
                    'issues': rows, 'isLast': last,
                    **({} if last else {'nextPageToken': str(offset + 100)}),
                })
            return FakeResponse({'issues': [], 'isLast': True})

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search),
                board_snapshot(components=(), teams=('team-a',)), EngBoardRequestTransport())]

        candidates = [frame for frame in frames
                      if frame['type'] == 'index' and frame.get('membership') == 'candidate']
        authoritative = [frame for frame in frames
                         if frame['type'] == 'index' and frame.get('membership') == 'authoritative']
        self.assertTrue(candidates)
        self.assertEqual(1, len(authoritative))
        self.assertEqual(parent_count, len(authoritative[0]['epics']))
        self.assertEqual(('complete', 'success', parent_count), (
            frames[-1]['type'], frames[-1]['outcome'], frames[-1]['epicCount'],
        ))
        self.assertEqual(25, len(parent_lookups))
        self.assertTrue(all(len(batch) <= eng_board.MAX_BATCH_SIZE for batch in parent_lookups))

    def test_cumulative_candidates_fit_generation_budget(self):
        page_size = 10
        summaries = 'x' * 4096
        component_pages = []

        def search(payload, **kwargs):
            jql = payload['jql']
            if 'component in' in jql:
                offset = int(payload.get('nextPageToken', '0'))
                component_pages.append(offset)
                rows = []
                for index in range(offset, offset + page_size):
                    row = epic(f'ABC-{index + 1}', 'To Do')
                    row['fields']['summary'] = summaries
                    rows.append(row)
                last = offset + page_size == eng_board.MAX_EPICS
                return FakeResponse({'issues': rows, 'isLast': last,
                                     **({} if last else {'nextPageToken': str(offset + page_size)})})
            # Team discovery and child hydration are deliberately empty.
            return FakeResponse({'issues': [], 'isLast': True})

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            lines = list(eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search),
                board_snapshot(teams=('team-a',)), EngBoardRequestTransport()))
        frames = [json.loads(line) for line in lines]
        candidate_pairs = [(line, frame) for line, frame in zip(lines, frames)
                           if frame['type'] == 'index' and frame['membership'] == 'candidate']
        candidates = [line for line, _frame in candidate_pairs]
        indexes = [frame for frame in frames if frame['type'] == 'index']

        self.assertEqual(list(range(0, eng_board.MAX_EPICS, page_size)), component_pages)
        self.assertEqual('success', frames[-1]['outcome'])
        self.assertEqual(eng_board.MAX_EPICS, frames[-1]['epicCount'])
        self.assertEqual(0, frames[-1]['childCount'])
        self.assertTrue(candidates)
        self.assertTrue(all(frame['membership'] == 'candidate' for frame in indexes[:-1]))
        self.assertEqual('authoritative', indexes[-1]['membership'])
        candidate_key_sets = [set(row['key'] for row in frame['epics'])
                              for _line, frame in candidate_pairs]
        self.assertTrue(all(left <= right for left, right in zip(
            candidate_key_sets, candidate_key_sets[1:],
        )))
        self.assertEqual(eng_board.MAX_EPICS, len(indexes[-1]['epics']))
        self.assertLessEqual(sum(map(len, candidates)), 8 * 1024 * 1024)
        self.assertLessEqual(sum(map(len, lines)), 32 * 1024 * 1024)
        self.assertLessEqual(max(map(len, lines)), 8 * 1024 * 1024 + 1)

    def test_injected_candidate_schedule_bounds_multibyte_cumulative_frames(self):
        rows = []
        updates = []
        for offset in range(0, eng_board.MAX_EPICS, 10):
            for index in range(offset, offset + 10):
                row = epic(f'ABC-{index + 1}', 'To Do')
                row['fields']['summary'] = '🚀' * 1024
                rows.append(row)
            updates.append({
                'phase': 'component', 'epics': tuple(rows),
                'phaseComplete': offset == eng_board.MAX_EPICS - 10,
                'final': offset == eng_board.MAX_EPICS - 10,
            })

        server = SimpleNamespace(current_jira_search=lambda *_args, **_kwargs: FakeResponse({
            'issues': [], 'isLast': True,
        }))
        projection_sizes = []
        real_project_board = eng_board.project_board

        def observe_projection(epics, *args, **kwargs):
            projection_sizes.append(len(epics))
            return real_project_board(epics, *args, **kwargs)

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()), \
             patch.object(eng_board, 'project_board', side_effect=observe_projection):
            lines = list(eng_board_routes._frame_stream(
                server, board_snapshot(), EngBoardRequestTransport(),
                _candidate_updates=updates,
            ))

        frames = [json.loads(line) for line in lines]
        candidate_lines = [line for line, frame in zip(lines, frames)
                           if frame['type'] == 'index'
                           and frame.get('membership') == 'candidate']
        indexes = [frame for frame in frames if frame['type'] == 'index']
        self.assertEqual(
            [10, 20, 40, 80, 160, 320, 640, 1000],
            [len(frame['epics']) for frame in indexes],
        )
        self.assertLessEqual(sum(map(len, candidate_lines)), 8 * 1024 * 1024)
        self.assertLessEqual(sum(map(len, lines)), 32 * 1024 * 1024)
        self.assertEqual(100, projection_sizes.count(10))
        self.assertFalse(set(projection_sizes).intersection({20, 40, 80, 160, 320, 640}))
        self.assertGreaterEqual(projection_sizes.count(1000), 2)
        self.assertEqual(('complete', 'success', 1000), (
            frames[-1]['type'], frames[-1]['outcome'], frames[-1]['epicCount'],
        ))

    def test_candidate_policy_suppresses_duplicates_and_shares_phase_allocation(self):
        rows = [epic(f'ABC-{index}', 'To Do') for index in range(1, 6)]
        updates = (
            {'phase': 'component', 'epics': rows[:1]},
            {'phase': 'component', 'epics': rows[:1]},
            {'phase': 'component', 'epics': rows[:2], 'phaseComplete': True},
            {'phase': 'team', 'epics': rows[:3]},
            {'phase': 'team', 'epics': rows[:3]},
            {'phase': 'team', 'epics': rows[:4]},
            {'phase': 'team', 'epics': rows, 'phaseComplete': True, 'final': True},
        )
        server = SimpleNamespace(current_jira_search=lambda *_args, **_kwargs: FakeResponse({
            'issues': [], 'isLast': True,
        }))
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                server, board_snapshot(), EngBoardRequestTransport(),
                _candidate_updates=updates,
            )]

        indexes = [frame for frame in frames if frame['type'] == 'index']
        self.assertEqual([1, 2, 3, 5], [len(frame['epics']) for frame in indexes])
        self.assertEqual(['candidate', 'candidate', 'candidate', 'authoritative'], [
            frame['membership'] for frame in indexes
        ])

    def test_exhausted_candidate_allocation_skips_optional_updates_but_keeps_final_union(self):
        rows = []
        for index in range(3):
            row = epic(f'ABC-{index + 1}', 'To Do')
            row['fields']['summary'] = '🚀' * 1000
            rows.append(row)
        updates = (
            {'phase': 'component', 'epics': rows[:1], 'phaseComplete': True},
            {'phase': 'team', 'epics': rows[:2]},
            {'phase': 'team', 'epics': rows, 'phaseComplete': True, 'final': True},
        )
        server = SimpleNamespace(current_jira_search=lambda *_args, **_kwargs: FakeResponse({
            'issues': [], 'isLast': True,
        }))
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()), \
             patch.object(eng_board_routes, '_CANDIDATE_INDEX_BYTES', 5000):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                server, board_snapshot(), EngBoardRequestTransport(),
                _candidate_updates=updates,
            )]

        indexes = [frame for frame in frames if frame['type'] == 'index']
        self.assertEqual([1, 3], [len(frame['epics']) for frame in indexes])
        self.assertEqual(['candidate', 'authoritative'], [frame['membership'] for frame in indexes])
        self.assertEqual('success', frames[-1]['outcome'])

    def test_retainable_discovery_failure_offers_latest_suppressed_union(self):
        rows = [epic(f'ABC-{index}', 'To Do') for index in range(1, 4)]

        def updates():
            yield {'phase': 'component', 'epics': rows[:1]}
            yield {'phase': 'component', 'epics': rows[:2]}
            yield {'phase': 'component', 'epics': rows}
            raise eng_board_routes.EngBoardRequestDeadline('deadline_exceeded')

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=lambda *_args, **_kwargs: None),
                board_snapshot(), EngBoardRequestTransport(),
                _candidate_updates=updates(),
            )]

        candidates = [frame for frame in frames if frame['type'] == 'index']
        self.assertEqual([1, 2, 3], [len(frame['epics']) for frame in candidates])
        self.assertEqual(('error', 'deadline_exceeded'), (
            frames[-1]['type'], frames[-1]['code'],
        ))

    def test_candidate_policy_validates_in_place_updates_without_mutating_prior_frames(self):
        row = epic('ABC-1', 'To Do')

        def updates():
            yield {'phase': 'component', 'epics': [row]}
            row['fields']['summary'] = 'mutated after validation'
            yield {
                'phase': 'component', 'epics': [row],
                'phaseComplete': True, 'final': True,
            }

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=lambda *_args, **_kwargs: FakeResponse({
                    'issues': [], 'isLast': True,
                })),
                board_snapshot(), EngBoardRequestTransport(),
                _candidate_updates=updates(),
            )]

        indexes = [frame for frame in frames if frame['type'] == 'index']
        self.assertEqual(['candidate', 'authoritative'], [
            frame['membership'] for frame in indexes
        ])
        self.assertEqual('ABC-1 summary', indexes[0]['epics'][0]['summary'])
        self.assertEqual('mutated after validation', indexes[1]['epics'][0]['summary'])
        self.assertEqual('success', frames[-1]['outcome'])

    def test_team_parent_first_batch_is_visible_while_second_lookup_is_held_then_fails(self):
        second_lookup_started = threading.Event()
        release = threading.Event()
        published = threading.Event()
        observed = []
        lookup_calls = []
        parent_keys = [f'ABC-{index + 2:04d}' for index in range(80)]

        def search(payload, **kwargs):
            jql = payload['jql']
            if 'cf[30101]' in jql:
                return FakeResponse({
                    'issues': [child(f'ABC-{10000 + i}', key) for i, key in enumerate(parent_keys)],
                    'isLast': True,
                })
            if 'issuetype = Epic' in jql:
                keys = re.findall(r'"(ABC-\d+)"', jql)
                lookup_calls.append(tuple(keys))
                if parent_keys[40] in keys:
                    second_lookup_started.set()
                    release.wait(2)
                    raise eng_board_routes.EngBoardRequestDeadline('deadline_exceeded')
                return FakeResponse({'issues': [epic(key, 'To Do') for key in keys], 'isLast': True})
            return FakeResponse({'issues': [], 'isLast': True})

        stream = eng_board_routes._frame_stream(
            SimpleNamespace(current_jira_search=search),
            board_snapshot(components=(), teams=('team-a',)), EngBoardRequestTransport())

        def consume():
            try:
                for line in stream:
                    frame = json.loads(line)
                    observed.append(frame)
                    if frame['type'] == 'index' and frame.get('membership') == 'candidate':
                        published.set()
            finally:
                stream.close()

        worker = threading.Thread(target=consume, daemon=True)
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            worker.start()
            try:
                self.assertTrue(second_lookup_started.wait(1), 'second parent lookup did not start')
                self.assertTrue(published.wait(0.25), 'first eligible parent batch was not published')
            finally:
                release.set()
                worker.join(3)

        self.assertFalse(worker.is_alive())
        candidates = [frame for frame in observed
                      if frame['type'] == 'index' and frame.get('membership') == 'candidate']
        self.assertEqual(parent_keys[:40], [row['key'] for row in candidates[0]['epics']])
        self.assertEqual(('error', 'deadline_exceeded'), (observed[-1]['type'], observed[-1]['code']))
        self.assertEqual(2, len(lookup_calls))
        self.assertTrue(all(len(batch) <= eng_board.MAX_BATCH_SIZE for batch in lookup_calls))
        self.assertFalse(any(frame['type'] in {'column', 'column_error'} for frame in observed))
        self.assertFalse(any(frame.get('outcome') == 'success' for frame in observed))

    def test_component_overlap_and_ineligible_team_parents_do_not_inflate_admission(self):
        parent_queries = []

        def search(payload, **kwargs):
            jql = payload['jql']
            if 'component in' in jql:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
            if 'cf[30101]' in jql:
                # ABC-1 overlaps Component membership. ABC-3 is a discovered
                # parent but is filtered out by the existing eligible-Epic JQL.
                return FakeResponse({'issues': [
                    child('ABC-101', 'ABC-1'), child('ABC-102', 'ABC-2'),
                    child('ABC-103', 'ABC-3'),
                ], 'isLast': True})
            if 'issuetype = Epic' in jql:
                parent_queries.append(jql)
                return FakeResponse({
                    'issues': [epic('ABC-2', 'To Do')] if 'ABC-2' in jql else [],
                    'isLast': True,
                })
            return FakeResponse({'issues': [], 'isLast': True})

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search),
                board_snapshot(teams=('team-a',)), EngBoardRequestTransport())]

        self.assertEqual('success', frames[-1]['outcome'])
        self.assertEqual(2, frames[-1]['epicCount'])
        authoritative = [frame for frame in frames
                         if frame['type'] == 'index' and frame['membership'] == 'authoritative']
        self.assertEqual(['ABC-1', 'ABC-2'], [row['key'] for row in authoritative[-1]['epics']])
        self.assertTrue(parent_queries)
        self.assertTrue(all('ABC-1' not in query.split('key in (', 1)[-1]
                            for query in parent_queries))

    def test_non_string_team_relationship_and_epic_keys_fail_before_candidate(self):
        cases = (
            ('parent_bool', None, {'key': True}, True, 'invalid_page'),
            ('epic_link_number', 123, {'key': 'ABC-2'}, 123, 'invalid_page'),
            ('returned_epic_number', None, {'key': '123'}, 123, 'board_data_invalid'),
        )
        for name, epic_link, parent, returned_key, error_code in cases:
            with self.subTest(name=name):
                def search(payload, **kwargs):
                    if 'cf[30101]' in payload['jql']:
                        fields = {'parent': parent, 'customfield_10014': epic_link}
                        return FakeResponse({
                            'issues': [{'key': 'WORK-1', 'fields': fields}], 'isLast': True,
                        })
                    row = epic(returned_key, 'To Do')
                    row['key'] = returned_key
                    return FakeResponse({'issues': [row], 'isLast': True})

                snapshot = board_snapshot(
                    components=(), teams=('team-a',),
                    epic_link_field_id='customfield_10014' if epic_link is not None else None,
                )
                with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
                    frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                        SimpleNamespace(current_jira_search=search), snapshot,
                        EngBoardRequestTransport())]

                self.assertEqual(('error', error_code), (
                    frames[-1]['type'], frames[-1]['code'],
                ))
                self.assertFalse(any(frame['type'] == 'index' for frame in frames))

    def test_component_first_page_is_visible_while_second_page_is_held(self):
        second_page_started = threading.Event()
        release = threading.Event()
        published = threading.Event()
        observed = []
        page_calls = []

        def search(payload, **kwargs):
            jql = payload['jql']
            if 'component in' not in jql:
                return FakeResponse({'issues': [], 'isLast': True})
            token = payload.get('nextPageToken')
            page_calls.append(dict(payload))
            if token:
                second_page_started.set()
                release.wait(2)
                return FakeResponse({'issues': [epic('ABC-2', 'To Do')], 'isLast': True})
            return FakeResponse({
                'issues': [epic('ABC-1', 'To Do')], 'isLast': False, 'nextPageToken': 'page-2',
            })

        stream = eng_board_routes._frame_stream(
            SimpleNamespace(current_jira_search=search), board_snapshot(), EngBoardRequestTransport())

        def consume():
            try:
                for line in stream:
                    frame = json.loads(line)
                    observed.append(frame)
                    if frame['type'] == 'index' and frame.get('membership') == 'candidate':
                        published.set()
            finally:
                stream.close()

        worker = threading.Thread(target=consume, daemon=True)
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            worker.start()
            try:
                self.assertTrue(second_page_started.wait(1), 'second Component page did not start')
                self.assertTrue(published.wait(0.25), 'first Component page was not published')
                pre_release = [frame for frame in observed
                               if frame['type'] == 'index'
                               and frame.get('membership') == 'candidate']
                self.assertTrue(pre_release)
                self.assertEqual(['ABC-1'], [row['key'] for row in pre_release[-1]['epics']])
            finally:
                release.set()
                worker.join(3)

        self.assertFalse(worker.is_alive())
        self.assertEqual([None, 'page-2'], [payload.get('nextPageToken') for payload in page_calls])
        self.assertEqual(2, len(page_calls))
        self.assertTrue(all(eng_board.encoded_search_bytes(
            payload['jql'], payload['fields'], payload.get('nextPageToken'),
        ) <= eng_board.MAX_ENCODED_REQUEST_BYTES for payload in page_calls))
        self.assertEqual('success', observed[-1]['outcome'])

    def test_component_deadline_retains_first_page_candidate(self):
        clock = [0.0]
        calls = []

        def search(payload, **kwargs):
            if 'component in' not in payload['jql']:
                return FakeResponse({'issues': [], 'isLast': True})
            calls.append(payload.get('nextPageToken'))
            if payload.get('nextPageToken'):
                raise AssertionError('deadline must stop the second page before dispatch')
            clock[0] = 31.0
            return FakeResponse({
                'issues': [epic('ABC-1', 'To Do')], 'isLast': False, 'nextPageToken': 'page-2',
            })

        transport = EngBoardRequestTransport(
            budget=EngBoardRequestBudget.start(now_fn=lambda: clock[0]))
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), board_snapshot(), transport)]

        candidates = [frame for frame in frames
                      if frame['type'] == 'index' and frame.get('membership') == 'candidate']
        self.assertEqual([None], calls)
        self.assertTrue(candidates, 'the validated page-1 Epic must survive the deadline')
        self.assertEqual(['ABC-1'], [row['key'] for row in candidates[-1]['epics']])
        self.assertEqual(('error', 'deadline_exceeded'), (frames[-1]['type'], frames[-1]['code']))

    def test_byte_limit_emits_parseable_terminal(self):
        large = epic('ABC-1', 'To Do')
        large['fields']['summary'] = 'x' * 4096

        def search(payload, **kwargs):
            if 'issuetype = Epic' in payload['jql']:
                return FakeResponse({'issues': [large], 'isLast': True})
            return FakeResponse({'issues': [], 'isLast': True})

        real_writer = EngBoardStreamWriter
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()), patch.object(
            eng_board_routes, 'EngBoardStreamWriter',
            side_effect=lambda: real_writer(max_frame_bytes=1024, max_generation_bytes=8192),
        ):
            try:
                lines = list(eng_board_routes._frame_stream(
                    SimpleNamespace(current_jira_search=search), board_snapshot(),
                    EngBoardRequestTransport()))
            except Exception as error:
                self.fail(f'writer exception escaped instead of a parseable terminal: {type(error).__name__}')

        frames = [json.loads(line.decode('utf-8')) for line in lines]
        self.assertEqual(['start', 'error'], [frame['type'] for frame in frames])
        self.assertEqual(list(range(len(frames))), [frame['sequence'] for frame in frames])
        self.assertEqual(1, sum(frame['type'] == 'error' for frame in frames))
        self.assertEqual(('error', 'scope_too_large'), (frames[-1]['type'], frames[-1]['code']))
        self.assertLessEqual(len(lines[-1]), 1024)

    def test_generation_overflow_preserves_the_last_reserved_terminal(self):
        snapshot = board_snapshot()
        generation_id = 'generation-boundary'
        start_line = EngBoardStreamWriter().prepare(
            eng_board_routes._start_frame(snapshot, generation_id)
        )
        generation_limit = len(start_line) + 1024
        real_writer = EngBoardStreamWriter
        server = SimpleNamespace(current_jira_search=lambda *_args, **_kwargs: FakeResponse({
            'issues': [], 'isLast': True,
        }))

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()), patch.object(
            eng_board_routes, 'EngBoardStreamWriter',
            side_effect=lambda: real_writer(max_generation_bytes=generation_limit),
        ):
            lines = list(eng_board_routes._frame_stream(
                server, snapshot, EngBoardRequestTransport(), generation_id=generation_id,
            ))

        frames = [json.loads(line) for line in lines]
        self.assertEqual(['start', 'error'], [frame['type'] for frame in frames])
        self.assertEqual([0, 1], [frame['sequence'] for frame in frames])
        self.assertEqual('scope_too_large', frames[-1]['code'])
        self.assertLessEqual(len(lines[-1]), 1024)
        self.assertLessEqual(sum(map(len, lines)), generation_limit)

    def test_required_column_overflow_stops_children_and_emits_scope_terminal(self):
        large_child = child('ABC-11', 'ABC-1')
        large_child['fields']['summary'] = 'x' * 4096

        def search(payload, **_kwargs):
            if 'issuetype = Epic' in payload['jql']:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
            return FakeResponse({'issues': [large_child], 'isLast': True})

        real_writer = EngBoardStreamWriter
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()), patch.object(
            eng_board_routes, 'EngBoardStreamWriter',
            side_effect=lambda: real_writer(max_frame_bytes=1024, max_generation_bytes=8192),
        ):
            lines = list(eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), board_snapshot(),
                EngBoardRequestTransport(),
            ))

        frames = [json.loads(line) for line in lines]
        self.assertEqual(list(range(len(frames))), [frame['sequence'] for frame in frames])
        self.assertEqual('start', frames[0]['type'])
        self.assertEqual('index', frames[1]['type'])
        self.assertFalse(any(frame['type'] == 'column' for frame in frames))
        self.assertEqual(('error', 'scope_too_large'), (
            frames[-1]['type'], frames[-1]['code'],
        ))
        self.assertLessEqual(len(lines[-1]), 1024)

    def test_large_component_index_is_batched_before_authoritative_frame(self):
        components = tuple(f'Component {index:03d} ' + ('x' * 48) for index in range(150))
        queries = []

        def search(payload, **kwargs):
            queries.append(payload)
            if 'issuetype = Epic' in payload['jql']:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
            return FakeResponse({'issues': [], 'isLast': True})

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), board_snapshot(components=components),
                EngBoardRequestTransport(),
            )]

        index_queries = [query for query in queries if 'issuetype = Epic' in query['jql']]
        self.assertGreater(len(index_queries), 1)
        for query in index_queries:
            self.assertLessEqual(
                eng_board.encoded_search_bytes(query['jql'], query['fields']),
                eng_board.MAX_ENCODED_REQUEST_BYTES,
            )
        indexes = [frame for frame in frames if frame['type'] == 'index']
        self.assertEqual(2, len(indexes))
        self.assertEqual('candidate', indexes[0]['membership'])
        self.assertEqual('authoritative', indexes[-1]['membership'])
        self.assertEqual(['ABC-1'], [row['key'] for row in indexes[-1]['epics']])
        self.assertEqual('success', frames[-1]['outcome'])

    def test_repeated_component_epic_refreshes_final_representation_without_extra_candidate(self):
        components = tuple(f'Component {index:03d} ' + ('x' * 48) for index in range(150))
        index_calls = 0

        def search(payload, **_kwargs):
            nonlocal index_calls
            if 'issuetype = Epic' not in payload['jql']:
                return FakeResponse({'issues': [], 'isLast': True})
            index_calls += 1
            row = epic('ABC-1', 'To Do')
            row['fields']['summary'] = f'validated representation {index_calls}'
            return FakeResponse({'issues': [row], 'isLast': True})

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search),
                board_snapshot(components=components), EngBoardRequestTransport(),
            )]

        self.assertGreater(index_calls, 1)
        indexes = [frame for frame in frames if frame['type'] == 'index']
        self.assertEqual(['candidate', 'authoritative'], [
            frame['membership'] for frame in indexes
        ])
        self.assertEqual('validated representation 1', indexes[0]['epics'][0]['summary'])
        self.assertEqual(
            f'validated representation {index_calls}', indexes[1]['epics'][0]['summary'],
        )
        self.assertEqual('success', frames[-1]['outcome'])

    def test_distinct_component_batches_publish_second_candidate_before_next_request(self):
        components = ('First', 'Second', 'Third')
        third_request_started = threading.Event()
        release = threading.Event()
        second_candidate_published = threading.Event()
        observed = []
        index_calls = 0

        def search(payload, **_kwargs):
            nonlocal index_calls
            if 'issuetype = Epic' not in payload['jql']:
                return FakeResponse({'issues': [], 'isLast': True})
            index_calls += 1
            if index_calls == 3:
                third_request_started.set()
                release.wait(2)
            return FakeResponse({
                'issues': [epic(f'ABC-{index_calls}', 'To Do')], 'isLast': True,
            })

        stream = eng_board_routes._frame_stream(
            SimpleNamespace(current_jira_search=search),
            board_snapshot(components=components), EngBoardRequestTransport(),
        )

        def consume():
            try:
                for line in stream:
                    frame = json.loads(line)
                    observed.append(frame)
                    if (frame['type'] == 'index'
                            and frame.get('membership') == 'candidate'
                            and len(frame['epics']) == 2):
                        second_candidate_published.set()
            finally:
                stream.close()

        worker = threading.Thread(target=consume, daemon=True)
        with patch.object(eng_board, 'MAX_BATCH_SIZE', 1), patch.object(
            eng_board_routes, '_assert_current', return_value=db_context(),
        ):
            worker.start()
            try:
                self.assertTrue(third_request_started.wait(1), 'third Component request did not start')
                self.assertTrue(
                    second_candidate_published.wait(0.25),
                    'second candidate was not published before the next request',
                )
            finally:
                release.set()
                worker.join(3)

        self.assertFalse(worker.is_alive())
        indexes = [frame for frame in observed if frame['type'] == 'index']
        self.assertEqual(['candidate', 'candidate', 'authoritative'], [
            frame['membership'] for frame in indexes
        ])
        self.assertEqual(['ABC-1', 'ABC-2', 'ABC-3'], [
            row['key'] for row in indexes[-1]['epics']
        ])
        self.assertEqual('success', observed[-1]['outcome'])

    def test_component_epics_are_visible_before_team_discovery_deadline(self):
        clock = [0.0]
        def search(payload, **kwargs):
            if 'issuetype = Epic' in payload['jql']:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
            clock[0] = 31.0
            return FakeResponse({'issues': [], 'isLast': False, 'nextPageToken': 'next'})
        transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(now_fn=lambda: clock[0]))
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), board_snapshot(teams=('team-a',)), transport,
            )]
        self.assertEqual('deadline_exceeded', frames[-1]['code'])
        indexes = [frame for frame in frames if frame['type'] == 'index']
        self.assertTrue(indexes, 'Component Epics disappeared behind the team discovery deadline')
        self.assertEqual('ABC-1', indexes[0]['epics'][0]['key'])
        self.assertEqual('candidate', indexes[0]['membership'])

    def test_story_progress_arrives_before_second_page_finishes(self):
        release = threading.Event()
        second_started = threading.Event()
        def search(payload, **kwargs):
            if 'issuetype = Epic' in payload['jql']:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
            if payload.get('nextPageToken'):
                second_started.set()
                release.wait(5)
                return FakeResponse({'issues': [child('ABC-12', 'ABC-1')], 'isLast': True})
            return FakeResponse({'issues': [child('ABC-11', 'ABC-1')], 'isLast': False, 'nextPageToken': 'next'})
        frames = eng_board_routes._frame_stream(
            SimpleNamespace(current_jira_search=search), board_snapshot(), EngBoardRequestTransport(),
        )
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            try:
                self.assertEqual('start', json.loads(next(frames))['type'])
                self.assertEqual('index', json.loads(next(frames))['type'])
                progress = json.loads(next(frames))
                self.assertEqual('progress', progress['type'])
                self.assertEqual(1, progress['loadedChildren'])
                self.assertEqual({'In Progress': 1}, progress['byEpic'][0]['statusCounts'])
                self.assertTrue(second_started.wait(1))
            finally:
                release.set()
            remaining = [json.loads(line) for line in frames]
        self.assertEqual('success', remaining[-1]['outcome'])
        self.assertEqual(2, remaining[-1]['childCount'])
        last_progress = [row for row in remaining if row['type'] == 'progress'][-1]
        self.assertEqual(2, last_progress['loadedChildren'])
        self.assertEqual({'In Progress': 2}, last_progress['byEpic'][0]['statusCounts'])

    def test_discovery_paging_survives_page_tokens_that_scale_with_the_jql(self):
        pages = []

        def search(payload):
            if 'issuetype = Epic' in payload['jql']:
                return {'issues': [], 'isLast': True}
            pages.append(payload)
            if len(pages) > 1:
                return {'issues': [], 'isLast': True}
            # Jira Cloud returns a continuation token that scales with the JQL
            # text; observed between 1.35x and 1.5x of the query length.
            return {
                'issues': [child(f'ABC-{900 + index}', 'ABC-1') for index in range(100)],
                'isLast': False, 'nextPageToken': 'T' * round(len(payload['jql']) * 1.5),
            }

        eng_board.discover_team_epics(
            search, projects=(('ABC', 'product'),), issue_type_ids=('10001',),
            team_ids=('team-a',),
            existing_epics=[epic(f'ABC-{index}', 'To Do') for index in range(160)],
            epic_fields=eng_board.EPIC_FIELDS, terminal_statuses=('Done',),
            epic_link_field_id='customfield_10014',
        )
        self.assertEqual(2, len(pages))

    def test_paged_search_bytes_budgets_for_a_jql_proportional_page_token(self):
        jql = 'project in ("ABC") AND issuetype = Epic AND ' + ' AND '.join(
            f'labels = "value-{index}"' for index in range(50)
        )
        fields = ('summary', 'status')
        self.assertGreaterEqual(
            eng_board.paged_search_bytes(jql, fields),
            eng_board.encoded_search_bytes(jql, fields, 'T' * round(len(jql) * 1.5)),
        )

    def test_batch_splitters_keep_their_continuation_requests_within_budget(self):
        def child_jql(keys):
            return eng_board.build_child_jql(
                (('ABCDEFGH', 'product'),), ('10001',), keys,
                epic_link_field_id='customfield_10014',
            )

        keys = [f'ABCDEFGH-{100000 + index}' for index in range(400)]
        fields = eng_board.CHILD_BASE_FIELDS
        for batch in eng_board.split_epic_batches(keys, child_jql, fields):
            self.assertLessEqual(
                eng_board.paged_search_bytes(child_jql(list(batch)), fields),
                eng_board.MAX_ENCODED_REQUEST_BYTES,
            )

        def component_jql(batch):
            return eng_board.build_epic_index_jql(
                (('ABCDEFGH', 'product'),), batch, ('Done',), 28,
            )

        components = [f'Platform Component Number {index:03d}' for index in range(60)]
        for batch in eng_board.split_component_batches(components, component_jql, fields):
            self.assertLessEqual(
                eng_board.paged_search_bytes(component_jql(list(batch)), fields),
                eng_board.MAX_ENCODED_REQUEST_BYTES,
            )

    def test_slow_consumer_keeps_progress_queue_bounded_and_final_children_complete(self):
        import queue
        from backend.services.eng_board_stream import EngBoardChildScheduler
        all_pages_published = threading.Event()
        queues = []
        real_queue = queue.Queue
        class ObservedQueue(real_queue):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.peak = 0
                self.published = 0
                queues.append(self)
            def put_nowait(self, item):
                super().put_nowait(item)
                self.peak = max(self.peak, self.qsize())
                self.published += 1
                if self.published == 5:
                    all_pages_published.set()
        original_results = EngBoardChildScheduler.results
        def delayed_results(scheduler, **kwargs):
            self.assertTrue(all_pages_published.wait(2), 'Producer blocked on slow consumer')
            yield from original_results(scheduler, **kwargs)
        def search(payload, **kwargs):
            if 'issuetype = Epic' in payload['jql']:
                return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
            page = int(payload.get('nextPageToken', '0'))
            return FakeResponse({
                'issues': [child(f'ABC-{100 + page}', 'ABC-1')], 'isLast': page == 4,
                **({'nextPageToken': str(page + 1)} if page < 4 else {}),
            })
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()), patch.object(
            eng_board_routes.queue, 'Queue', ObservedQueue,
        ), patch.object(EngBoardChildScheduler, 'results', delayed_results):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), board_snapshot(), EngBoardRequestTransport(),
            )]
        self.assertEqual(2, queues[0].maxsize)
        self.assertEqual(2, queues[0].peak)
        self.assertEqual('success', frames[-1]['outcome'])
        self.assertEqual(5, frames[-1]['childCount'])
        progress = [frame for frame in frames if frame['type'] == 'progress']
        self.assertEqual(2, len(progress))
        self.assertEqual(5, progress[-1]['loadedChildren'])
