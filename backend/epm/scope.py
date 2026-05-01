import re


def _quote_jql_value(value):
    text = str(value or '')
    escaped = text.replace('\\', '\\\\').replace('"', '\\"')
    return f'"{escaped}"'


def should_apply_epm_sprint(tab_name):
    return str(tab_name or '').strip().lower() == 'active'


def build_rollup_jqls(label):
    label_text = str(label or '').strip()
    if not label_text:
        return None

    def child_predicate(keys):
        quoted_keys = [_quote_jql_value(key) for key in keys or [] if str(key or '').strip()]
        if not quoted_keys:
            return None
        joined_keys = ', '.join(quoted_keys)
        return f'("Epic Link" in ({joined_keys}) OR parent in ({joined_keys}))'

    return f'labels = {_quote_jql_value(label_text)}', child_predicate


def normalize_epm_sprint_field(raw):
    if raw is None:
        return []
    entries = [raw] if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        return []

    normalized_by_id = {}
    for entry in entries:
        sprint_id = None
        name = ''
        state = ''
        if isinstance(entry, dict):
            try:
                sprint_id = int(entry.get('id'))
            except (TypeError, ValueError):
                continue
            name = str(entry.get('name') or '')
            state = str(entry.get('state') or '')
        elif isinstance(entry, str):
            id_match = re.search(r'id=(\d+)', entry)
            if not id_match:
                continue
            try:
                sprint_id = int(id_match.group(1))
            except (TypeError, ValueError):
                continue
            state_match = re.search(r'state=([^,\]]+)', entry)
            name_match = re.search(r'name=([^,\]]+)', entry)
            state = state_match.group(1) if state_match else ''
            name = name_match.group(1) if name_match else ''
        else:
            continue
        if sprint_id not in normalized_by_id:
            normalized_by_id[sprint_id] = {'id': sprint_id, 'name': name, 'state': state}

    return [normalized_by_id[sprint_id] for sprint_id in sorted(normalized_by_id)]


def build_epm_scope_clause(linkage):
    linkage = linkage or {}
    labels = sorted(set(linkage.get('labels') or []))
    epic_keys = sorted(set(linkage.get('epicKeys') or []))
    clauses = []
    if labels:
        quoted_labels = ', '.join(_quote_jql_value(label) for label in labels)
        clauses.append(f'labels in ({quoted_labels})')
    if epic_keys:
        quoted_epics = ', '.join(_quote_jql_value(key) for key in epic_keys)
        clauses.append(f'key in ({quoted_epics})')
        clauses.append(f'"Epic Link" in ({quoted_epics})')
        clauses.append(f'parent in ({quoted_epics})')
    return '(' + ' OR '.join(clauses) + ')' if clauses else ''
