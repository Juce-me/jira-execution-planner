"""Opt-in observation of existing task loads; never changes Jira transport."""

from contextvars import ContextVar
from functools import wraps
from threading import Lock
import time

from flask import make_response, request

from backend.services.load_performance import collection_enabled


_observer = ContextVar('task_load_performance', default=None)


class RequestObserver:
    def __init__(self):
        self.lock = Lock()
        self.requests = self.pages = self.retries = 0
        self.cache_state = 'miss'
        self.completeness = 'unknown'

    def attempt(self, retry=False):
        with self.lock:
            self.requests += 1
            self.retries += int(retry)

    def page(self):
        with self.lock:
            self.pages += 1

    def snapshot(self):
        with self.lock:
            return {'jiraRequests': self.requests, 'jiraPages': self.pages,
                    'jiraRetries': self.retries, 'cacheState': self.cache_state,
                    'completeness': self.completeness}


def current_observer():
    return _observer.get()


def submit_with_performance(pool, function, *args, **kwargs):
    """Carry only the observer to workers, never the Flask request context."""
    observer = current_observer()
    if observer is None:
        return pool.submit(function, *args, **kwargs)

    def run():
        token = _observer.set(observer)
        try:
            return function(*args, **kwargs)
        finally:
            _observer.reset(token)
    return pool.submit(run)


def mark_task_cache_hit(completeness):
    observer = current_observer()
    if observer is not None:
        observer.cache_state = 'hit'
        observer.completeness = completeness if completeness in ('complete', 'capped') else 'unknown'


def measure_task_load(function):
    @wraps(function)
    def measured(*args, **kwargs):
        if (not collection_enabled()
                or request.args.get('debugTimings', '').strip().lower() not in ('1', 'true', 'yes')):
            return function(*args, **kwargs)
        observer = RequestObserver()
        token = _observer.set(observer)
        started = time.perf_counter()
        try:
            response = make_response(function(*args, **kwargs))
            data = response.get_json(silent=True)
            if isinstance(data, dict):
                if len(data.get('issues') or []) >= 250:
                    observer.completeness = 'capped'
                data['loadMetrics'] = observer.snapshot()
                # Work on serialized response data, not the shared task-cache object.
                from flask import current_app
                response.set_data(current_app.json.dumps(data))
            existing = response.headers.get('Server-Timing', '')
            total = f'total;dur={round((time.perf_counter() - started) * 1000, 1)}'
            response.headers['Server-Timing'] = ', '.join(part for part in (existing, total) if part)
            return response
        finally:
            _observer.reset(token)
    return measured
