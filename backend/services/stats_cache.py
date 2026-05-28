"""Completed-sprint stats file-cache helpers."""

import hashlib
import json
import os


def _noop(*_args, **_kwargs):
    return None


def load_stats_cache(cache_file, log_warning_fn=None):
    """Load stats cache from disk."""
    log_warning_fn = log_warning_fn or _noop
    try:
        if os.path.exists(cache_file):
            with open(cache_file, 'r', encoding='utf-8') as handle:
                return json.load(handle)
        return {}
    except Exception as exc:
        log_warning_fn(f'Failed to load stats cache: {exc}')
        return {}


def save_stats_cache(cache_data, *, cache_file, log_warning_fn=None):
    """Persist stats cache to disk."""
    log_warning_fn = log_warning_fn or _noop
    try:
        with open(cache_file, 'w', encoding='utf-8') as handle:
            json.dump(cache_data, handle, indent=2)
        return True
    except Exception as exc:
        log_warning_fn(f'Failed to save stats cache: {exc}')
        return False


def invalidate_stats_cache(cache_file, log_warning_fn=None):
    """Remove the stats cache file if present."""
    log_warning_fn = log_warning_fn or _noop
    try:
        if os.path.exists(cache_file):
            os.remove(cache_file)
        return True
    except Exception as exc:
        log_warning_fn(f'Failed to invalidate stats cache file: {exc}')
        return False


def build_stats_cache_key(sprint_name, base_jql, team_ids, *, order_by, group_id=None):
    raw = f"{sprint_name}::{base_jql}::{','.join(team_ids or [])}::{order_by}::{group_id or ''}"
    digest = hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12]
    return f"sprint:{sprint_name}:{digest}"
