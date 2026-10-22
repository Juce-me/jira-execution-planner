"""Closed-mode Lead Times cohort: query building, scope batching, selection and orchestration.

Pure module: Jira search and Epic normalization are injected by the caller (``jira_server.py``),
so every rule here is testable without Jira. The closed modes are ``closed`` (Epics whose terminal
date falls in a quarter range) and ``last_n`` (a bounded window of the most recently closed Epics).
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Callable, Sequence

from backend.services import eng_board

CLOSED_EPIC_STATUSES = ('Done', 'Killed', 'Incomplete')
MAX_TOTAL_PAGES = 80
# A fixed-width stand-in for the bound date that is only known after the resolved passes: the byte
# budget must cover the longest JQL the request will actually send.
SIZING_SINCE = date(2999, 12, 31)

_DEFAULT_WINDOW = 200
_MIN_WINDOW = 60


def last_n_window(raw) -> int:
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return _DEFAULT_WINDOW
    return max(_MIN_WINDOW, value)


LAST_N_WINDOW = last_n_window(os.getenv('EPIC_COHORT_LAST_N_WINDOW'))


class EpicCohortScopeError(ValueError):
    """The Component or Team scope cannot be sent as a Jira search request."""


class EpicCohortSearchError(Exception):
    """A Jira search pass failed; ``response`` is the failed Jira response."""

    def __init__(self, response=None):
        super().__init__('Jira search failed')
        self.response = response


def _quote(value) -> str:
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'


def _status_history_bound(clauses: Sequence[str]) -> str:
    return ' AND (' + ' OR '.join(clauses) + ')'


def build_closed_epic_jqls(project_clause: str, scope_clause: str, *, mode: str,
                           start_date: date | None, end_date: date | None,
                           unresolved_since: date | None = None) -> dict[str, str]:
    """Return the ``resolved`` and ``unresolved`` JQL for one scope batch.

    ``closed`` widens the resolved window by one day on each side (JQL dates use the requesting user's
    timezone, terminal dates the response offset); the caller post-filters on the computed terminal date.
    """
    if mode not in ('closed', 'last_n'):
        raise ValueError(f'unsupported closed mode: {mode}')
    base = f'issuetype = Epic AND project in ({project_clause})'
    if scope_clause:
        base += f' AND {scope_clause}'
    base += ' AND status in (' + ','.join(_quote(status) for status in CLOSED_EPIC_STATUSES) + ')'

    if mode == 'closed':
        low = _quote((start_date - timedelta(days=1)).isoformat())
        high = _quote((end_date + timedelta(days=2)).isoformat())
        resolved = f'{base} AND resolutiondate >= {low} AND resolutiondate < {high}'
        bound = _status_history_bound(
            [f'status CHANGED TO {_quote(status)} DURING ({low},{high})' for status in CLOSED_EPIC_STATUSES])
        return {'resolved': resolved, 'unresolved': f'{base} AND resolutiondate is EMPTY{bound}'}

    resolved = f'{base} AND resolutiondate is not EMPTY ORDER BY resolutiondate DESC'
    unresolved = f'{base} AND resolutiondate is EMPTY'
    if unresolved_since is not None:
        since = _quote(unresolved_since.isoformat())
        unresolved += _status_history_bound(
            [f'status CHANGED TO {_quote(status)} AFTER {since}' for status in CLOSED_EPIC_STATUSES])
    return {'resolved': resolved, 'unresolved': unresolved}


def scope_batches(components: Sequence[str],
                  build_pair: Callable[[Sequence[str], date | None], dict[str, str]],
                  fields: Sequence[str]) -> list[tuple[str, ...]]:
    """Batch Components under the paged-search byte budget (MRT031), sizing the longer JQL of each pair.

    An empty ``components`` is the Teams scope: one empty batch, checked against the same budget.
    """
    def longest(batch: Sequence[str]) -> str:
        return max(build_pair(batch, SIZING_SINCE).values(), key=len)

    try:
        if not components:
            if eng_board.paged_search_bytes(longest(()), fields) > eng_board.MAX_ENCODED_REQUEST_BYTES:
                raise EpicCohortScopeError('scope is too large for one Jira search request')
            return [()]
        return [tuple(batch) for batch in eng_board.split_component_batches(components, longest, fields)]
    except eng_board.EngBoardError as exc:
        raise EpicCohortScopeError('scope is too large for one Jira search request') from exc


def select_closed_epics(issues: list[dict], *, mode: str, start_date: date | None, end_date: date | None,
                        ceiling: int) -> tuple[list[dict], bool]:
    """Keep closed Epics with a terminal date; ``closed`` filters to the range, ``last_n`` ranks and trims.

    Ranking is terminal day descending, then Epic key ascending in codepoint order. ``closed`` is never
    trimmed. Returns ``(kept, trimmed)``.
    """
    candidates: list[tuple[date, dict]] = []
    for issue in issues:
        if issue.get('status') not in CLOSED_EPIC_STATUSES:
            continue
        try:
            day = date.fromisoformat(issue.get('terminalDate'))
        except (TypeError, ValueError):
            continue
        candidates.append((day, issue))

    if mode == 'closed':
        candidates = [(day, issue) for day, issue in candidates if start_date <= day <= end_date]
    candidates.sort(key=lambda pair: pair[1].get('key') or '')
    candidates.sort(key=lambda pair: pair[0], reverse=True)

    trimmed = False
    if mode == 'last_n' and len(candidates) > ceiling:
        candidates = candidates[:ceiling]
        trimmed = True
    return [issue for _, issue in candidates], trimmed


def _resolution_day(row: dict) -> str:
    return ((row.get('fields') or {}).get('resolutiondate') or '')[:10]


def fetch_closed_epics(search_pages: Callable, normalize: Callable[[list[dict]], tuple[list[dict], bool]], *,
                       mode: str, start_date: date | None, end_date: date | None,
                       batches: Sequence[Sequence[str]],
                       make_pair: Callable[[Sequence[str], date | None], dict[str, str]],
                       ceiling: int, warnings: list[str]) -> dict:
    """Run every batch's resolved pass, then the bounded unresolved passes, normalize and select.

    ``search_pages(jql, *, stop_when=None) -> (rows, stop)`` returns the raw Jira Epics and why it
    stopped (``'done'``, ``'max_rows'`` when ``stop_when`` fired, or ``'page_cap'`` when the shared page
    budget ran out); it raises ``EpicCohortSearchError`` on any non-200, which propagates: a failed pass
    must never look like an empty one.
    """
    def window_complete(rows: list[dict]) -> bool:
        # Past the ceiling, keep reading until the resolution day moves on, so the cut falls on a day
        # boundary and the kept set is the first N by day then key, not by time of day.
        return len(rows) > ceiling and _resolution_day(rows[-1]) != _resolution_day(rows[ceiling - 1])

    page_capped = False
    resolved: dict[str, dict] = {}
    for batch in batches:
        rows, stop = search_pages(make_pair(batch, None)['resolved'],
                                  stop_when=window_complete if mode == 'last_n' else None)
        page_capped = page_capped or stop == 'page_cap'
        for row in rows:
            resolved.setdefault(row.get('key'), row)

    unresolved_since = None
    window_full = None
    if mode == 'last_n':
        ordered = sorted(sorted(resolved.values(), key=lambda row: row.get('key') or ''),
                         key=_resolution_day, reverse=True)
        window_full = len(ordered) > ceiling
        if window_full:
            try:
                unresolved_since = date.fromisoformat(_resolution_day(ordered[ceiling - 1])) - timedelta(days=1)
            except ValueError:
                unresolved_since = None

    merged = dict(resolved)
    for batch in batches:
        rows, stop = search_pages(make_pair(batch, unresolved_since)['unresolved'])
        page_capped = page_capped or stop == 'page_cap'
        for row in rows:
            merged.setdefault(row.get('key'), row)

    if page_capped:
        warnings.append(f'result truncated at {MAX_TOTAL_PAGES} pages')
    issues, normalizer_truncated = normalize(list(merged.values()))
    kept, trimmed = select_closed_epics(issues, mode=mode, start_date=start_date, end_date=end_date,
                                        ceiling=ceiling)
    if mode == 'last_n':
        window_full = bool(window_full or trimmed)
    return {
        'issues': kept,
        'windowFull': window_full,
        'truncated': bool(page_capped or normalizer_truncated),
        'warnings': warnings,
    }
