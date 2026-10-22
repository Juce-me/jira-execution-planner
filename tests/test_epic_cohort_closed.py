import unittest
from datetime import date

from backend.services import eng_board
from backend.services import epic_cohort_closed as closed

START = date(2026, 1, 1)
END = date(2026, 3, 31)
CLOSED_IN = 'status in ("Done","Killed","Incomplete")'


def raw_epic(key, status='Done', resolution='2026-03-10', stamp='10:00:00'):
    return {
        'key': key,
        'fields': {
            'status': {'name': status},
            'resolutiondate': f'{resolution}T{stamp}.000+0000' if resolution else None,
        },
    }


def normalizer(changelog_dates=None, truncated=False):
    changelog_dates = changelog_dates or {}

    def normalize(rows):
        issues = []
        for row in rows:
            fields = row['fields']
            raw = fields.get('resolutiondate')
            terminal = raw[:10] if raw else changelog_dates.get(row['key'])
            issues.append({'key': row['key'], 'status': fields['status']['name'], 'terminalDate': terminal})
        return issues, truncated

    return normalize


class FakeSearch:
    """Routes a JQL to canned rows and pages them like the adapter's search_pages."""

    def __init__(self, routes, page_size=2):
        self.routes = routes
        self.page_size = page_size
        self.calls = []

    def __call__(self, jql, *, stop_when=None):
        self.calls.append(jql)
        for needle, rows, final_stop in self.routes:
            if needle not in jql:
                continue
            if isinstance(rows, Exception):
                raise rows
            collected = []
            for index in range(0, len(rows), self.page_size):
                collected.extend(rows[index:index + self.page_size])
                if stop_when and stop_when(collected):
                    return collected, 'max_rows'
            return collected, final_stop
        raise AssertionError(f'unrouted jql: {jql}')


def make_pair(mode, start=START, end=END):
    def build(batch, since):
        scope = f'component in ({", ".join(chr(34) + name + chr(34) for name in batch)})' if batch else 'team = "T1"'
        return closed.build_closed_epic_jqls(
            '"P"', scope, mode=mode, start_date=start if mode == 'closed' else None,
            end_date=end if mode == 'closed' else None, unresolved_since=since,
        )
    return build


def run_fetch(mode, search, *, ceiling=200, batches=((),), normalize=None, warnings=None):
    return closed.fetch_closed_epics(
        search, normalize or normalizer(), mode=mode,
        start_date=START if mode == 'closed' else None, end_date=END if mode == 'closed' else None,
        batches=list(batches), make_pair=make_pair(mode), ceiling=ceiling,
        warnings=warnings if warnings is not None else [],
    )


class TestClosedJqls(unittest.TestCase):
    def test_closed_jqls_use_closed_statuses_only(self):
        for mode in ('closed', 'last_n'):
            pair = closed.build_closed_epic_jqls(
                '"P"', 'component = "X"', mode=mode,
                start_date=START if mode == 'closed' else None, end_date=END if mode == 'closed' else None,
            )
            for pass_name, jql in pair.items():
                with self.subTest(mode=mode, pass_name=pass_name):
                    self.assertIn(CLOSED_IN, jql)
                    self.assertNotIn('Postponed', jql)
                    self.assertTrue(jql.startswith('issuetype = Epic AND project in ("P") AND component = "X"'))

    def test_closed_window_is_widened_one_day_each_side(self):
        resolved = closed.build_closed_epic_jqls(
            '"P"', 'component = "X"', mode='closed', start_date=START, end_date=END)['resolved']
        self.assertIn('resolutiondate >= "2025-12-31"', resolved)
        self.assertIn('resolutiondate < "2026-04-02"', resolved)

    def test_last_n_resolved_orders_desc_and_unresolved_has_no_order(self):
        pair = closed.build_closed_epic_jqls('"P"', 'component = "X"', mode='last_n', start_date=None, end_date=None)
        self.assertTrue(pair['resolved'].endswith('AND resolutiondate is not EMPTY ORDER BY resolutiondate DESC'))
        self.assertIn('resolutiondate is EMPTY', pair['unresolved'])
        self.assertNotIn('ORDER BY', pair['unresolved'])

    def test_unresolved_status_history_bound_for_closed_and_last_n(self):
        closed_pair = closed.build_closed_epic_jqls(
            '"P"', 'component = "X"', mode='closed', start_date=START, end_date=END)
        for status in closed.CLOSED_EPIC_STATUSES:
            self.assertIn(f'status CHANGED TO "{status}" DURING ("2025-12-31","2026-04-02")', closed_pair['unresolved'])
        bounded = closed.build_closed_epic_jqls(
            '"P"', 'component = "X"', mode='last_n', start_date=None, end_date=None,
            unresolved_since=date(2026, 3, 8))
        for status in closed.CLOSED_EPIC_STATUSES:
            self.assertIn(f'status CHANGED TO "{status}" AFTER "2026-03-08"', bounded['unresolved'])
        unbounded = closed.build_closed_epic_jqls(
            '"P"', 'component = "X"', mode='last_n', start_date=None, end_date=None)
        self.assertNotIn('CHANGED', unbounded['unresolved'])


class TestSelectClosedEpics(unittest.TestCase):
    def issue(self, key, status='Done', terminal='2026-02-10'):
        return {'key': key, 'status': status, 'terminalDate': terminal}

    def test_select_closed_epics_excludes_postponed_and_open_statuses(self):
        issues = [self.issue('A-1'), self.issue('A-2', 'Postponed'), self.issue('A-3', 'open', None),
                  self.issue('A-4', 'In Progress'), self.issue('A-5', 'Killed'), self.issue('A-6', 'Incomplete')]
        kept, _ = closed.select_closed_epics(issues, mode='closed', start_date=START, end_date=END, ceiling=200)
        self.assertEqual(sorted(item['key'] for item in kept), ['A-1', 'A-5', 'A-6'])

    def test_select_closed_epics_post_filters_on_terminal_date(self):
        issues = [self.issue('A-1', terminal='2025-12-31'), self.issue('A-2', terminal='2026-01-01'),
                  self.issue('A-3', terminal='2026-03-31'), self.issue('A-4', terminal='2026-04-01'),
                  self.issue('A-5', terminal=None)]
        kept, _ = closed.select_closed_epics(issues, mode='closed', start_date=START, end_date=END, ceiling=200)
        self.assertEqual(sorted(item['key'] for item in kept), ['A-2', 'A-3'])

    def test_closed_mode_is_never_trimmed_by_the_ceiling(self):
        issues = [self.issue(f'A-{index}') for index in range(10)]
        kept, trimmed = closed.select_closed_epics(issues, mode='closed', start_date=START, end_date=END, ceiling=3)
        self.assertEqual(len(kept), 10)
        self.assertFalse(trimmed)

    def test_last_n_orders_by_parsed_day_desc_then_key_asc_codepoint(self):
        issues = [self.issue('a-1', terminal='2026-02-10'), self.issue('Z-1', terminal='2026-02-10'),
                  self.issue('B-1', terminal='2026-02-11'), self.issue('C-1', terminal='2026-02-09')]
        kept, trimmed = closed.select_closed_epics(issues, mode='last_n', start_date=None, end_date=None, ceiling=3)
        self.assertEqual([item['key'] for item in kept], ['B-1', 'Z-1', 'a-1'])
        self.assertTrue(trimmed)


class TestFetchClosedEpics(unittest.TestCase):
    def test_resolved_runs_before_unresolved(self):
        search = FakeSearch([('resolutiondate >=', [raw_epic('R-1')], 'done'), ('resolutiondate is EMPTY', [], 'done')])
        run_fetch('closed', search, batches=[('X',), ('Y',)])
        kinds = ['resolved' if 'resolutiondate >=' in jql else 'unresolved' for jql in search.calls]
        self.assertEqual(kinds, ['resolved', 'resolved', 'unresolved', 'unresolved'])

    def test_closed_merges_resolved_and_unresolved_and_dedupes(self):
        search = FakeSearch([
            ('resolutiondate >=', [raw_epic('R-1'), raw_epic('R-2', resolution='2025-06-01')], 'done'),
            ('resolutiondate is EMPTY', [raw_epic('U-1', resolution=None), raw_epic('R-1')], 'done'),
        ])
        result = run_fetch('closed', search, normalize=normalizer({'U-1': '2026-02-02'}))
        self.assertEqual(sorted(item['key'] for item in result['issues']), ['R-1', 'U-1'])
        self.assertIsNone(result['windowFull'])
        self.assertFalse(result['truncated'])

    def test_closed_unresolved_bound_is_range_start_minus_one_day(self):
        search = FakeSearch([('resolutiondate >=', [], 'done'), ('resolutiondate is EMPTY', [], 'done')])
        run_fetch('closed', search)
        unresolved = [jql for jql in search.calls if 'resolutiondate is EMPTY' in jql][0]
        self.assertEqual(unresolved.count('DURING ("2025-12-31","2026-04-02")'), 3)

    def test_last_n_unresolved_bound_uses_ceiling_th_resolution_day(self):
        rows = [raw_epic('K-1', resolution='2026-03-10'), raw_epic('K-2', resolution='2026-03-09'),
                raw_epic('K-3', resolution='2026-03-08')]
        search = FakeSearch([('resolutiondate is not EMPTY', rows, 'done'), ('resolutiondate is EMPTY', [], 'done')],
                            page_size=1)
        run_fetch('last_n', search, ceiling=2)
        unresolved = [jql for jql in search.calls if 'resolutiondate is EMPTY' in jql][0]
        self.assertIn('AFTER "2026-03-08"', unresolved)

    def test_last_n_without_a_full_window_leaves_unresolved_unbounded(self):
        search = FakeSearch([('resolutiondate is not EMPTY', [raw_epic('K-1')], 'done'),
                             ('resolutiondate is EMPTY', [], 'done')])
        result = run_fetch('last_n', search, ceiling=5)
        unresolved = [jql for jql in search.calls if 'resolutiondate is EMPTY' in jql][0]
        self.assertNotIn('CHANGED', unresolved)
        self.assertIs(result['windowFull'], False)

    def test_last_n_window_completes_the_boundary_day(self):
        # Jira returns newest first, so on the boundary day K-5 (latest time) precedes K-1: without completion
        # the kept set would depend on the time of day at which the fetch stopped.
        rows = [raw_epic(f'K-{n}', resolution='2026-03-10', stamp=f'{10 + n:02d}:00:00') for n in (5, 4, 3, 2, 1)]
        rows.append(raw_epic('K-9', resolution='2026-03-09'))
        search = FakeSearch([('resolutiondate is not EMPTY', rows, 'done'), ('resolutiondate is EMPTY', [], 'done')],
                            page_size=2)
        result = run_fetch('last_n', search, ceiling=3)
        self.assertEqual([item['key'] for item in result['issues']], ['K-1', 'K-2', 'K-3'])
        self.assertTrue(result['windowFull'])

    def test_last_n_trimmed_and_window_full_flags_and_full_window_is_not_truncated(self):
        rows = [raw_epic('K-1', resolution='2026-03-10'), raw_epic('K-2', resolution='2026-03-09'),
                raw_epic('K-3', resolution='2026-03-08')]
        for ceiling, expected_full in ((2, True), (5, False)):
            with self.subTest(ceiling=ceiling):
                search = FakeSearch([('resolutiondate is not EMPTY', rows, 'done'),
                                     ('resolutiondate is EMPTY', [], 'done')], page_size=1)
                result = run_fetch('last_n', search, ceiling=ceiling)
                self.assertIs(result['windowFull'], expected_full)
                self.assertFalse(result['truncated'])
                self.assertEqual(result['warnings'], [])

    def test_non_200_pass_raises_search_error_and_nothing_is_returned(self):
        failure = closed.EpicCohortSearchError(response='failed-response')
        search = FakeSearch([('resolutiondate >=', [raw_epic('R-1')], 'done'), ('resolutiondate is EMPTY', failure, 'done')])
        with self.assertRaises(closed.EpicCohortSearchError) as raised:
            run_fetch('closed', search)
        self.assertEqual(raised.exception.response, 'failed-response')

    def test_page_cap_sets_truncated_across_passes_and_batches(self):
        search = FakeSearch([('resolutiondate >=', [raw_epic('R-1')], 'page_cap'), ('resolutiondate is EMPTY', [], 'done')])
        warnings = []
        result = run_fetch('closed', search, batches=[('X',), ('Y',)], warnings=warnings)
        self.assertTrue(result['truncated'])
        self.assertIn(f'result truncated at {closed.MAX_TOTAL_PAGES} pages', warnings)

    def test_normalizer_truncation_is_carried(self):
        search = FakeSearch([('resolutiondate >=', [raw_epic('R-1')], 'done'), ('resolutiondate is EMPTY', [], 'done')])
        result = run_fetch('closed', search, normalize=normalizer(truncated=True))
        self.assertTrue(result['truncated'])


class TestScopeBatches(unittest.TestCase):
    FIELDS = ['summary', 'created', 'status', 'resolutiondate', 'assignee', 'project']

    def test_scope_batches_sizes_the_longer_jql_with_placeholder_bound(self):
        seen = []

        def build_pair(batch, since):
            seen.append(since)
            names = ','.join(f'"{name}"' for name in batch)
            return {'resolved': f'issuetype = Epic AND component in ({names})',
                    'unresolved': f'issuetype = Epic AND component in ({names}) AND resolutiondate is EMPTY'}

        batches = closed.scope_batches(['Alpha', 'Beta'], build_pair, self.FIELDS)
        self.assertEqual(batches, [('Alpha', 'Beta')])
        self.assertTrue(seen)
        self.assertTrue(all(value == closed.SIZING_SINCE for value in seen))

    def test_scope_batches_splits_a_large_component_set_under_the_byte_budget(self):
        components = [f'Component-{index:03d}-' + 'x' * 140 for index in range(120)]

        def build_pair(batch, since):
            names = ', '.join(f'"{name}"' for name in batch)
            jql = f'issuetype = Epic AND component in ({names}) AND status in ("Done","Killed","Incomplete")'
            return {'resolved': jql, 'unresolved': jql + ' AND resolutiondate is EMPTY'}

        batches = closed.scope_batches(components, build_pair, self.FIELDS)
        self.assertGreater(len(batches), 1)
        self.assertEqual([name for batch in batches for name in batch], components)
        for batch in batches:
            longest = max(build_pair(batch, closed.SIZING_SINCE).values(), key=len)
            self.assertLessEqual(eng_board.paged_search_bytes(longest, self.FIELDS), eng_board.MAX_ENCODED_REQUEST_BYTES)

    def test_scope_batches_teams_scope_returns_single_empty_batch(self):
        pair = {'resolved': 'issuetype = Epic', 'unresolved': 'issuetype = Epic AND resolutiondate is EMPTY'}
        self.assertEqual(closed.scope_batches([], lambda batch, since: pair, self.FIELDS), [()])

    def test_scope_batches_raises_for_oversize_teams_or_component(self):
        huge = 'issuetype = Epic AND text ~ "' + 'x' * 20000 + '"'
        pair = {'resolved': huge, 'unresolved': huge}
        with self.assertRaises(closed.EpicCohortScopeError):
            closed.scope_batches([], lambda batch, since: pair, self.FIELDS)
        with self.assertRaises(closed.EpicCohortScopeError):
            closed.scope_batches(['One'], lambda batch, since: pair, self.FIELDS)


class TestWindowCeiling(unittest.TestCase):
    def test_ceiling_clamp_minimum_is_60(self):
        self.assertEqual(closed.last_n_window('10'), 60)
        self.assertEqual(closed.last_n_window('0'), 60)
        self.assertEqual(closed.last_n_window('120'), 120)
        self.assertEqual(closed.last_n_window('200'), 200)
        self.assertEqual(closed.last_n_window('garbage'), 200)
        self.assertEqual(closed.last_n_window(None), 200)


if __name__ == '__main__':
    unittest.main()
