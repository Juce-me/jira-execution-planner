"""Dashboard config persistence helpers."""

import json
import os


def _noop_log(*_parts):
    return None


def resolve_groups_config_path(groups_config_path):
    return groups_config_path or './team-groups.json'


def load_groups_config_file(path, log_warning_fn=None):
    log_warning_fn = log_warning_fn or _noop_log
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, 'r') as handle:
            return json.load(handle)
    except Exception as e:
        log_warning_fn(f'Failed to read groups config: {e}')
        return None


def resolve_dashboard_config_path(dashboard_config_path):
    return dashboard_config_path or './dashboard-config.json'


def load_dashboard_config(dashboard_path, groups_path, load_groups_config_file_fn,
                          save_dashboard_config_fn, log_warning_fn=None):
    """Load the unified dashboard config, migrating from legacy team-groups.json if needed."""
    log_warning_fn = log_warning_fn or _noop_log
    if os.path.exists(dashboard_path):
        try:
            with open(dashboard_path, 'r') as handle:
                return json.load(handle)
        except Exception as e:
            log_warning_fn(f'Failed to read dashboard config: {e}')
            return None
    # Migrate from legacy team-groups.json
    legacy = load_groups_config_file_fn(groups_path)
    if legacy:
        config = {
            'version': 1,
            'projects': {'selected': []},
            'teamGroups': legacy
        }
        save_dashboard_config_fn(config)
        return config
    return None


def save_dashboard_config(config, dashboard_path):
    """Write the unified dashboard config to disk."""
    directory = os.path.dirname(dashboard_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(dashboard_path, 'w') as handle:
        json.dump(config, handle, indent=2)


def resolve_team_catalog_path(team_catalog_path):
    return team_catalog_path or './team-catalog.json'


def _normalize_catalog(raw, normalize_team_catalog_fn):
    if normalize_team_catalog_fn is not None:
        return normalize_team_catalog_fn(raw)
    return raw if isinstance(raw, dict) else {}


def _normalize_meta(raw, normalize_team_catalog_meta_fn):
    if normalize_team_catalog_meta_fn is not None:
        return normalize_team_catalog_meta_fn(raw)
    return raw if isinstance(raw, dict) else {}


def load_team_catalog(team_catalog_path, normalize_team_catalog_fn=None,
                      normalize_team_catalog_meta_fn=None, log_warning_fn=None):
    log_warning_fn = log_warning_fn or _noop_log
    if not os.path.exists(team_catalog_path):
        return {'catalog': {}, 'meta': {}}
    try:
        with open(team_catalog_path, 'r') as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return {'catalog': {}, 'meta': {}}
        return {
            'catalog': _normalize_catalog(data.get('catalog') or {}, normalize_team_catalog_fn),
            'meta': _normalize_meta(data.get('meta') or {}, normalize_team_catalog_meta_fn)
        }
    except Exception as e:
        log_warning_fn(f'Failed to read team catalog: {e}')
        return {'catalog': {}, 'meta': {}}


def save_team_catalog_file(catalog_data, team_catalog_path, normalize_team_catalog_fn=None,
                           normalize_team_catalog_meta_fn=None):
    directory = os.path.dirname(team_catalog_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    normalized = {
        'catalog': _normalize_catalog(catalog_data.get('catalog') or {}, normalize_team_catalog_fn),
        'meta': _normalize_meta(catalog_data.get('meta') or {}, normalize_team_catalog_meta_fn)
    }
    with open(team_catalog_path, 'w') as handle:
        json.dump(normalized, handle, indent=2)
    return normalized
