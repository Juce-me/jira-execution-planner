"""Local Atlassian OAuth session storage for development mode."""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import os
import threading
import time
from typing import Callable, MutableMapping


@dataclass(frozen=True)
class LocalOAuthStoreConfig:
    auth_mode: str
    oauth_mode: str
    environment_key: str
    persistence_allowed: bool
    token_store_path: str
    ttl_seconds: int


class LocalOAuthTokenStore:
    def __init__(
        self,
        *,
        token_store: MutableMapping,
        refresh_locks: MutableMapping,
        store_lock,
        config: Callable[[], LocalOAuthStoreConfig],
        new_session_id: Callable[[], str],
        now: Callable[[], float] = time.time,
        lock_factory: Callable = threading.Lock,
        logger=None,
    ):
        self.token_store = token_store
        self.refresh_locks = refresh_locks
        self.store_lock = store_lock
        self._config = config
        self._new_session_id = new_session_id
        self._now = now
        self._lock_factory = lock_factory
        self._logger = logger or logging.getLogger(__name__)

    def persistence_enabled(self):
        config = self._config()
        if config.auth_mode != config.oauth_mode:
            return False
        if str(config.environment_key or '').strip().lower() not in {'local', 'dev'}:
            return False
        return bool(config.persistence_allowed and config.token_store_path)

    def read_persistent_token_store(self):
        if not self.persistence_enabled():
            return {}
        path = self._config().token_store_path
        try:
            with open(path, 'r', encoding='utf-8') as handle:
                payload = json.load(handle)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            self._logger.warning('Failed to read local OAuth token store: %s', exc)
            return {}
        return payload if isinstance(payload, dict) else {}

    def write_persistent_token_store(self, payload):
        if not self.persistence_enabled():
            return
        path = self._config().token_store_path
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        if not payload:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
            except OSError as exc:
                self._logger.warning('Failed to remove local OAuth token store: %s', exc)
            return
        temp_path = f'{path}.tmp'
        try:
            fd = os.open(temp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                json.dump(payload, handle)
            os.replace(temp_path, path)
            os.chmod(path, 0o600)
        except OSError as exc:
            self._logger.warning('Failed to write local OAuth token store: %s', exc)
            try:
                os.remove(temp_path)
            except OSError:
                pass

    def _drop_persistent_session(self, session_id):
        if not self.persistence_enabled():
            return
        payload = self.read_persistent_token_store()
        if session_id not in payload:
            return
        payload.pop(session_id, None)
        self.write_persistent_token_store(payload)

    def _save_persistent_session(self, session_id, data):
        if not self.persistence_enabled():
            return
        payload = self.read_persistent_token_store()
        payload[session_id] = dict(data)
        self.write_persistent_token_store(payload)

    def _load_persistent_session(self, session_id):
        payload = self.read_persistent_token_store()
        data = payload.get(session_id)
        return data if isinstance(data, dict) else {}

    def existing_refresh_lock(self, session_id):
        with self.store_lock:
            return self.refresh_locks.get(session_id)

    def drop_session(self, session_id):
        with self.store_lock:
            self.token_store.pop(session_id, None)
            self.refresh_locks.pop(session_id, None)
            self._drop_persistent_session(session_id)

    def cleanup_expired_sessions(self, now=None):
        now = self._now() if now is None else now
        expired = [
            stored_id
            for stored_id, stored in self.token_store.items()
            if now - float((stored or {}).get('stored_at') or 0) > self._config().ttl_seconds
        ]
        for stored_id in expired:
            self.token_store.pop(stored_id, None)
            self.refresh_locks.pop(stored_id, None)
            self._drop_persistent_session(stored_id)

    def save_session(self, browser_session, data):
        if not data:
            session_id = browser_session.pop('atlassian_oauth_session_id', None)
            if session_id:
                refresh_lock = self.existing_refresh_lock(session_id)
                if refresh_lock:
                    with refresh_lock:
                        self.drop_session(session_id)
                else:
                    self.drop_session(session_id)
            return
        now = self._now()
        session_id = browser_session.get('atlassian_oauth_session_id')
        with self.store_lock:
            self.cleanup_expired_sessions(now)
            if not session_id:
                session_id = self._new_session_id()
                browser_session['atlassian_oauth_session_id'] = session_id
            stored = dict(data, stored_at=now)
            self.token_store[session_id] = stored
            self.refresh_locks.setdefault(session_id, self._lock_factory())
            self._save_persistent_session(session_id, stored)

    def save_session_for_id(self, session_id, data):
        if not session_id:
            return
        if not data:
            self.drop_session(session_id)
            return
        now = self._now()
        with self.store_lock:
            self.cleanup_expired_sessions(now)
            stored = dict(data, stored_at=now)
            self.token_store[session_id] = stored
            self.refresh_locks.setdefault(session_id, self._lock_factory())
            self._save_persistent_session(session_id, stored)

    def refresh_lock(self, browser_session):
        return self.refresh_lock_for_id(browser_session.get('atlassian_oauth_session_id'))

    def refresh_lock_for_id(self, session_id):
        if not session_id:
            return self.store_lock
        with self.store_lock:
            return self.refresh_locks.setdefault(session_id, self._lock_factory())

    def session_data(self, browser_session):
        session_id = browser_session.get('atlassian_oauth_session_id')
        now = self._now()
        if not session_id:
            with self.store_lock:
                self.cleanup_expired_sessions(now)
            return {}
        data = self._session_data_for_id(session_id, now=now)
        if data and now - float(data.get('stored_at') or 0) > self._config().ttl_seconds:
            self.save_session(browser_session, {})
            return {}
        return data

    def session_data_for_id(self, session_id):
        if not session_id:
            return {}
        now = self._now()
        data = self._session_data_for_id(session_id, now=now)
        if data and now - float(data.get('stored_at') or 0) > self._config().ttl_seconds:
            self.drop_session(session_id)
            return {}
        return dict(data)

    def _session_data_for_id(self, session_id, now):
        with self.store_lock:
            self.cleanup_expired_sessions(now)
            data = self.token_store.get(session_id) or {}
            if not data:
                data = self._load_persistent_session(session_id)
                if data:
                    self.token_store[session_id] = dict(data)
                    self.refresh_locks.setdefault(session_id, self._lock_factory())
        return data
