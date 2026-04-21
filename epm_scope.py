def _quote_jql_value(value):
    text = str(value or '')
    escaped = text.replace('\\', '\\\\').replace('"', '\\"')
    return f'"{escaped}"'


def should_apply_epm_sprint(tab_name):
    return str(tab_name or '').strip().lower() == 'active'


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
