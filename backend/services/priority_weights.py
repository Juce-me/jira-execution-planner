"""Stats priority weight normalization helpers."""


def _noop(*_args, **_kwargs):
    return None


def normalize_priority_weight_name(name, name_aliases=None):
    key = str(name or '').strip().lower()
    return (name_aliases or {}).get(key, key)


def build_priority_weight_defaults(defaults):
    return [dict(item) for item in defaults]


def normalize_priority_weight_rows(rows, name_aliases=None):
    """Validate and normalize weight rows into canonical list format."""
    if not isinstance(rows, list):
        raise ValueError('weights must be an array')
    normalized = []
    seen = set()
    for item in rows:
        if not isinstance(item, dict):
            raise ValueError('each weight entry must be an object')
        priority = str(item.get('priority', '') or '').strip()
        if not priority:
            raise ValueError('priority is required')
        norm_name = normalize_priority_weight_name(priority, name_aliases)
        if norm_name in seen:
            raise ValueError(f'duplicate priority: {priority}')
        raw_weight = item.get('weight', None)
        try:
            weight = float(raw_weight)
        except (TypeError, ValueError):
            raise ValueError(f'invalid weight for {priority}')
        if weight < 0:
            raise ValueError(f'weight must be non-negative for {priority}')
        seen.add(norm_name)
        normalized.append({'priority': priority, 'weight': weight})
    return normalized


def parse_stats_priority_weights_env(raw, name_aliases=None):
    if not raw:
        return None
    rows = []
    for chunk in str(raw).split(','):
        token = chunk.strip()
        if not token:
            continue
        if ':' not in token:
            raise ValueError(f'invalid STATS_PRIORITY_WEIGHTS token: {token}')
        name, weight = token.split(':', 1)
        rows.append({'priority': name.strip(), 'weight': weight.strip()})
    return normalize_priority_weight_rows(rows, name_aliases)


def build_priority_weights_config(
    *,
    dashboard_config,
    env_value,
    defaults,
    name_aliases,
    log_warning_fn=None,
):
    """Return effective stats priority weights with source metadata."""
    log_warning_fn = log_warning_fn or _noop
    config = dashboard_config or {}
    if config and 'statsPriorityWeights' in config:
        try:
            rows = normalize_priority_weight_rows(config.get('statsPriorityWeights') or [], name_aliases)
            return {'weights': rows, 'source': 'config'}
        except ValueError as exc:
            log_warning_fn(f'Invalid statsPriorityWeights in dashboard config; falling back: {exc}')

    if env_value:
        try:
            rows = parse_stats_priority_weights_env(env_value, name_aliases)
            if rows:
                return {'weights': rows, 'source': 'env'}
        except ValueError as exc:
            log_warning_fn(f'Invalid STATS_PRIORITY_WEIGHTS env; using defaults: {exc}')

    return {'weights': build_priority_weight_defaults(defaults), 'source': 'default'}
