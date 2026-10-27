"""EPM-only strict Jira read helpers.

The shared Jira iterator (`backend.jira_client.fetch_issues_by_jql`) stops at the first non-200 page and
returns what it has, which for EPM would turn an auth, permission or throttling failure into a partial or
empty (and cacheable) rollup. `strict_search_request` wraps the search callable the iterator receives so
every page status is checked before the iterator can break. Scenario and every other caller keep the
shared behavior; only the EPM OAuth paths pass this adapter.
"""

from __future__ import annotations

import threading

from backend.auth.jira_auth import AuthError

JIRA_ACCESS_DENIED = "jira_access_denied"
JIRA_RATE_LIMITED = "jira_rate_limited"
JIRA_READ_FAILED = "jira_read_failed"
JIRA_READ_ERROR_CATEGORIES = (JIRA_ACCESS_DENIED, JIRA_RATE_LIMITED, JIRA_READ_FAILED)
JIRA_MAX_RETRY_AFTER_SECONDS = 30


class JiraReadError(Exception):
    """Typed strict Jira failure. Carries no response body or provider text."""

    def __init__(self, category, *, status=None, retry_after=None):
        super().__init__(f"Jira read failed ({category})")
        self.category = category
        self.status = status
        self.retry_after = retry_after


class EpmRequestCancelled(Exception):
    """Raised before further resource work once a sibling worker already failed."""


class RequestCancellation:
    """Request-scoped cancellation signal (set once; checked before pages and before cache admission)."""

    def __init__(self):
        self._event = threading.Event()

    def cancel(self):
        self._event.set()

    def is_set(self):
        return self._event.is_set()

    def raise_if_cancelled(self):
        if self._event.is_set():
            raise EpmRequestCancelled()


def clamp_retry_after(value):
    try:
        seconds = int(float(value))
    except (TypeError, ValueError):
        return JIRA_MAX_RETRY_AFTER_SECONDS
    return max(1, min(JIRA_MAX_RETRY_AFTER_SECONDS, seconds))


def raise_for_jira_status(response):
    """Map one Jira response to a typed failure. 401 is base auth loss (the existing AuthError recovery)."""
    status = getattr(response, "status_code", None)
    if status == 200:
        return response
    if status == 401:
        raise AuthError("auth_required", "Atlassian authentication is required.")
    if status == 403:
        raise JiraReadError(JIRA_ACCESS_DENIED, status=403)
    if status == 429:
        headers = getattr(response, "headers", None) or {}
        raise JiraReadError(JIRA_RATE_LIMITED, status=429, retry_after=clamp_retry_after(headers.get("Retry-After")))
    raise JiraReadError(JIRA_READ_FAILED, status=status if isinstance(status, int) else None)


def strict_search_request(search_request, cancellation=None):
    """Wrap a Jira search callable so every page is status-checked and shape-checked.

    The shared iterator passes `search_request(payload, context=...)`; a failure raises here, so no
    partial page list is ever returned to the EPM caller.
    """

    def strict_request(payload, *, context=None, **kwargs):
        if cancellation is not None:
            cancellation.raise_if_cancelled()
        try:
            response = search_request(payload, context=context, **kwargs)
        except OSError:  # requests' connection/timeout errors; no provider text is kept
            raise JiraReadError(JIRA_READ_FAILED) from None
        raise_for_jira_status(response)
        try:
            document = response.json()
        except ValueError:
            raise JiraReadError(JIRA_READ_FAILED, status=200) from None
        if document is not None and not isinstance(document, dict):
            raise JiraReadError(JIRA_READ_FAILED, status=200)
        return response

    return strict_request
