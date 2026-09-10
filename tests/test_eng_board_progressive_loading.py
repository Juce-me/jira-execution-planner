import json
import unittest
import threading
from types import SimpleNamespace
from unittest.mock import patch

from backend.routes import eng_board_routes
from backend.services import eng_board
from backend.services.eng_board_stream import EngBoardRequestBudget, EngBoardRequestTransport
from tests.test_eng_board_routes import FakeResponse, board_snapshot, db_context, epic, child


class EngBoardProgressiveLoadingTests(unittest.TestCase):
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

    def test_discovery_excludes_known_parents_but_keeps_null_fallback(self):
        for legacy in (None, 'customfield_10014'):
            queries = []
            def search(payload):
                queries.append(payload)
                return {'issues': [], 'isLast': True}
            rows = eng_board.discover_team_epics(
                search, projects=(('ABC', 'product'),), issue_type_ids=('10001',),
                team_ids=('team-a',), existing_epics=[epic('ABC-1', 'To Do')],
                epic_fields=eng_board.EPIC_FIELDS, terminal_statuses=('Done',),
                epic_link_field_id=legacy,
            )
            self.assertEqual(1, len(rows))
            jql = queries[0]['jql']
            self.assertIn('(parent NOT IN ("ABC-1") OR parent IS EMPTY)', jql)
            if legacy:
                self.assertIn('cf[10014] NOT IN ("ABC-1") OR (cf[10014] IS EMPTY AND', jql)
            self.assertLess(eng_board.encoded_search_bytes(jql, queries[0]['fields']),
                            eng_board.MAX_ENCODED_REQUEST_BYTES - 1024)

    def test_discovery_exclusion_leaves_token_headroom_for_large_indexes(self):
        queries = []
        eng_board.discover_team_epics(
            lambda payload: queries.append(payload) or {'issues': [], 'isLast': True},
            projects=(('ABC', 'product'),), issue_type_ids=('10001',), team_ids=('team-a',),
            existing_epics=[epic(f'ABC-{index}', 'To Do') for index in range(1000)],
            epic_fields=eng_board.EPIC_FIELDS, terminal_statuses=('Done',),
        )
        self.assertLessEqual(eng_board.encoded_search_bytes(queries[0]['jql'], queries[0]['fields']),
                             eng_board.MAX_ENCODED_REQUEST_BYTES - 1024)

    def test_synthetic_discovery_exclusion_reduces_pages_without_changing_union(self):
        def measure(disable_exclusion):
            discovery_pages = 0
            def search(payload):
                nonlocal discovery_pages
                if 'issuetype = Epic' in payload['jql']:
                    return {'issues': [epic('ABC-2', 'To Do')], 'isLast': True}
                discovery_pages += 1
                excluded = 'parent NOT IN ("ABC-1")' in payload['jql']
                if excluded or payload.get('nextPageToken') == 'last':
                    return {'issues': [child('ABC-999', 'ABC-2')], 'isLast': True}
                return {
                    'issues': [child(f'ABC-{100 + index}', 'ABC-1') for index in range(100)],
                    'isLast': False, 'nextPageToken': 'last',
                }
            # Baseline disables only exclusion construction; component membership
            # still reaches the real discovery/union/paging implementation.
            if disable_exclusion:
                context = patch.object(eng_board, 'MAX_ENCODED_REQUEST_BYTES', 1024)
            else:
                from contextlib import nullcontext
                context = nullcontext()
            with context:
                result = eng_board.discover_team_epics(
                    search, projects=(('ABC', 'product'),), issue_type_ids=('10001',),
                    team_ids=('team-a',), existing_epics=[epic('ABC-1', 'To Do')],
                    epic_fields=eng_board.EPIC_FIELDS, terminal_statuses=('Done',),
                )
            return sorted(row['key'] for row in result), discovery_pages
        baseline, baseline_pages = measure(True)
        optimized, optimized_pages = measure(False)
        self.assertEqual(['ABC-1', 'ABC-2'], baseline)
        self.assertEqual(baseline, optimized)
        self.assertEqual((2, 1), (baseline_pages, optimized_pages))

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
