"""Jira request helpers shared by the Flask server."""

import json
import random
import threading
import time

import requests


RETRYABLE_JIRA_STATUS_CODES = {429, 500, 502, 503, 504}


def _noop_log(*_parts):
    return None


class SyntheticJiraResponse:
    """Small response-like object for fast-fail and retry exhaustion paths."""
    def __init__(self, status_code, payload):
        self.status_code = int(status_code)
        self._payload = payload if isinstance(payload, dict) else {'message': str(payload)}
        self.text = json.dumps(self._payload)

    def json(self):
        return self._payload


class JiraCircuitBreaker:
    def __init__(self, failure_threshold=5, open_seconds=30.0):
        self.failure_threshold = max(1, int(failure_threshold))
        self.open_seconds = max(1.0, float(open_seconds))
        self._lock = threading.RLock()
        self._state = 'closed'
        self._failure_count = 0
        self._opened_until = 0.0

    def before_request(self, now):
        with self._lock:
            if self._state == 'open':
                if now >= self._opened_until:
                    self._state = 'half-open'
                    return True, {'state': self._state, 'failureCount': self._failure_count}
                return False, {
                    'state': 'open',
                    'failureCount': self._failure_count,
                    'retryAfterSeconds': max(0.0, round(self._opened_until - now, 3))
                }
            return True, {'state': self._state, 'failureCount': self._failure_count}

    def record_success(self):
        with self._lock:
            self._state = 'closed'
            self._failure_count = 0
            self._opened_until = 0.0

    def record_failure(self, now):
        with self._lock:
            if self._state == 'half-open':
                self._state = 'open'
                self._failure_count = max(1, self._failure_count)
                self._opened_until = now + self.open_seconds
                return {'state': self._state, 'failureCount': self._failure_count, 'openedForSeconds': self.open_seconds}

            self._failure_count += 1
            if self._failure_count >= self.failure_threshold:
                self._state = 'open'
                self._opened_until = now + self.open_seconds
            return {'state': self._state, 'failureCount': self._failure_count, 'openedForSeconds': self.open_seconds if self._state == 'open' else 0.0}

    def force_open(self, now=None):
        now_value = time.monotonic() if now is None else float(now)
        with self._lock:
            self._state = 'open'
            self._failure_count = max(self._failure_count, self.failure_threshold)
            self._opened_until = now_value + self.open_seconds

    def reset(self):
        with self._lock:
            self._state = 'closed'
            self._failure_count = 0
            self._opened_until = 0.0


def _build_jira_unavailable_response(message, attempts=0, elapsed_seconds=0.0, upstream_status=None, circuit=None,
                                     response_cls=None):
    payload = {
        'error': 'Jira temporarily unavailable',
        'message': message,
        'attempts': int(attempts),
        'retryElapsedSeconds': round(float(elapsed_seconds), 2)
    }
    if upstream_status is not None:
        payload['upstreamStatus'] = int(upstream_status)
    if circuit:
        payload['circuit'] = circuit
    response_cls = response_cls or SyntheticJiraResponse
    return response_cls(503, payload)


def resilient_jira_get(url, *, params=None, headers=None, timeout=30, session=None, breaker=None,
                       now_fn=None, sleep_fn=None, rand_fn=None,
                       max_attempts=None, max_elapsed_seconds=None,
                       base_delay_seconds=None, max_delay_seconds=None,
                       log_debug_fn=None, log_info_fn=None, log_warning_fn=None, log_error_fn=None,
                       unavailable_response_fn=None, retryable_status_codes=None):
    """GET with bounded retries + circuit breaker for Jira upstream calls."""
    if session is None:
        raise ValueError('session is required')
    if breaker is None:
        raise ValueError('breaker is required')
    now_fn = now_fn or time.monotonic
    sleep_fn = sleep_fn or time.sleep
    rand_fn = rand_fn or random.random
    log_debug_fn = log_debug_fn or _noop_log
    log_info_fn = log_info_fn or _noop_log
    log_warning_fn = log_warning_fn or _noop_log
    log_error_fn = log_error_fn or _noop_log
    unavailable_response_fn = unavailable_response_fn or _build_jira_unavailable_response
    retryable_status_codes = RETRYABLE_JIRA_STATUS_CODES if retryable_status_codes is None else retryable_status_codes
    max_attempts = max(1, int(max_attempts if max_attempts is not None else 4))
    max_elapsed_seconds = float(max_elapsed_seconds if max_elapsed_seconds is not None else 10)
    base_delay_seconds = float(base_delay_seconds if base_delay_seconds is not None else 0.5)
    max_delay_seconds = float(max_delay_seconds if max_delay_seconds is not None else 3)

    started_at = now_fn()
    allowed, breaker_state = breaker.before_request(started_at)
    if not allowed:
        log_warning_fn(
            f'Jira circuit open; fast-failing request retry_after_s={breaker_state.get("retryAfterSeconds", 0)}'
        )
        return unavailable_response_fn(
            'Jira is temporarily unavailable. Please retry shortly.',
            attempts=0,
            elapsed_seconds=0.0,
            circuit=breaker_state
        )

    last_status = None
    attempts = 0

    while attempts < max_attempts:
        attempts += 1
        attempt_started = now_fn()
        try:
            response = session.get(url, params=params, headers=headers, timeout=timeout)
            latency_ms = round((now_fn() - attempt_started) * 1000, 1)
            last_status = getattr(response, 'status_code', None)
            if last_status not in retryable_status_codes:
                breaker.record_success()
                log_debug_fn(f'Jira GET ok status={last_status} attempt={attempts} latency_ms={latency_ms}')
                return response
            log_warning_fn(f'Jira GET retryable status={last_status} attempt={attempts} latency_ms={latency_ms}')
        except (requests.Timeout, requests.ConnectionError) as exc:
            latency_ms = round((now_fn() - attempt_started) * 1000, 1)
            log_warning_fn(f'Jira GET transient exception type={type(exc).__name__} attempt={attempts} latency_ms={latency_ms}')
        except Exception:
            # Unknown exceptions are not retried; keep existing behavior predictable.
            breaker.record_failure(now_fn())
            raise

        elapsed = now_fn() - started_at
        if attempts >= max_attempts or elapsed >= max_elapsed_seconds:
            state = breaker.record_failure(now_fn())
            message = (
                f'Jira server may be unavailable. Retried for {int(round(elapsed))} seconds and failed.'
                if elapsed >= max_elapsed_seconds else
                'Jira request failed after retry attempts.'
            )
            if state.get('state') == 'open':
                log_error_fn(f'Jira circuit opened after failed request failures={state.get("failureCount")}')
            return unavailable_response_fn(
                message,
                attempts=attempts,
                elapsed_seconds=elapsed,
                upstream_status=last_status,
                circuit=state
            )

        delay = min(max_delay_seconds, base_delay_seconds * (2 ** (attempts - 1)))
        jitter = min(0.25, delay * 0.25) * rand_fn()
        total_delay = delay + jitter
        if elapsed + total_delay > max_elapsed_seconds:
            total_delay = max(0.0, max_elapsed_seconds - elapsed)
        if total_delay <= 0:
            continue
        log_info_fn(f'Jira GET retry scheduled attempt={attempts + 1} sleep_s={round(total_delay, 2)}')
        sleep_fn(total_delay)

    # Defensive fallback (loop should return above)
    state = breaker.record_failure(now_fn())
    return unavailable_response_fn(
        f'Jira request failed after {attempts} attempts.',
        attempts=attempts,
        elapsed_seconds=(now_fn() - started_at),
        upstream_status=last_status,
        circuit=state
    )


def build_jira_search_params(payload):
    params = {}

    def to_csv(value):
        if isinstance(value, list):
            return ','.join(value)
        return value

    for key in ('jql', 'startAt', 'maxResults', 'expand', 'fields', 'fieldsByKeys', 'nextPageToken'):
        if key in payload and payload[key] is not None:
            params[key] = to_csv(payload[key])
    return params


def jira_search_request(jira_url, headers, payload, *, request_fn=None):
    """Call Jira search endpoint using query parameters for /search/jql."""
    url = f'{jira_url}/rest/api/3/search/jql'
    request_fn = request_fn or resilient_jira_get
    return request_fn(
        url,
        params=build_jira_search_params(payload),
        headers=headers,
        timeout=30
    )
