"""Application-bound adapters for persistent Jira catalog services.

The service modules own catalog behavior. This adapter keeps the legacy
``jira_server`` public patch points while resolving their mutable dependencies
at call time, which is required by route binding and the existing test suite.
"""

from __future__ import annotations

import hashlib
import json
import os


class CatalogAppAdapter:
    def __init__(self, namespace):
        self._namespace = namespace

    def _get(self, name):
        return self._namespace[name]

    def runtime_inputs(self):
        return {
            'jql_query': self._get('JQL_QUERY'),
            'jira_board_id': self._get('JIRA_BOARD_ID'),
            'team_field_default': self._get('TEAM_FIELD_DEFAULT'),
            'sprint_field_default': self._get('SPRINT_FIELD_DEFAULT'),
        }

    def resolve_request_config(self, session, context):
        return self._get('resolve_effective_catalog_config')(
            session,
            context,
            runtime_inputs=self._get('catalog_runtime_inputs')(),
            fallback_loader=self._get('_load_dashboard_config_json'),
            legacy_site_url=self._get('JIRA_URL') or '',
        )

    @staticmethod
    def browser_context_id(context):
        canonical = json.dumps([
            1, 'browser', context.workspace_id, context.user_id,
            context.auth_connection_id, context.browser_session_id,
        ], ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        return f"bc1:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"

    def resolve_team_catalog_path(self):
        return self._get('_config_store').resolve_team_catalog_path(
            self._get('TEAM_CATALOG_PATH'),
        )

    def load_team_catalog(self):
        return self._get('_config_store').load_team_catalog(
            self._get('resolve_team_catalog_path')(),
            normalize_team_catalog_fn=self._get('normalize_team_catalog'),
            normalize_team_catalog_meta_fn=self._get('normalize_team_catalog_meta'),
            log_warning_fn=self._get('log_warning'),
        )

    def save_team_catalog_file(self, catalog_data):
        return self._get('_config_store').save_team_catalog_file(
            catalog_data,
            self._get('resolve_team_catalog_path')(),
            normalize_team_catalog_fn=self._get('normalize_team_catalog'),
            normalize_team_catalog_meta_fn=self._get('normalize_team_catalog_meta'),
        )

    def migrate_team_catalog_from_config(self):
        catalog_path = self._get('resolve_team_catalog_path')()
        if os.path.exists(catalog_path):
            return
        dashboard_config = self._get('load_dashboard_config')(source='jsonfile')
        team_groups = (dashboard_config or {}).get('teamGroups')
        if not isinstance(team_groups, dict):
            return
        catalog = self._get('normalize_team_catalog')(team_groups.get('teamCatalog') or {})
        if not catalog:
            return
        self._get('save_team_catalog_file')({
            'catalog': catalog,
            'meta': team_groups.get('teamCatalogMeta') or {},
        })
        self._get('log_info')('Migrated teamCatalog from dashboard-config.json to team-catalog.json')

    def fetch_board_sprints(self, *, board_id, context, diagnostic_transport, budget):
        if diagnostic_transport.budget is not budget:
            raise ValueError('Sprint catalog transport must use the refresh budget')
        return self._get('_sprints_service').fetch_board_sprints(
            board_id=board_id,
            jira_get=lambda path, **kwargs: self._get('current_jira_get')(
                path,
                context=context,
                diagnostic_transport=diagnostic_transport,
                **kwargs,
            ),
            auth_error_class=self._get('AuthError'),
            budget=budget,
        )

    def fetch_catalog_sprint_teams(self, *, sprint_id, config, context,
                                   diagnostic_transport, budget):
        if diagnostic_transport.budget is not budget:
            raise ValueError('Team catalog transport must use the refresh budget')
        directory = self._get('_team_catalog_service').normalize_team_catalog(
            self._get('_load_workspace_team_catalog_db')(context).get('catalog') or {}
        )

        def jira_search(payload):
            return self._get('current_jira_search')(
                payload,
                context=context,
                diagnostic_transport=diagnostic_transport,
                timeout=min(15, budget.remaining('team_page')),
            )

        return self._get('fetch_sprint_teams')(
            sprint_id=sprint_id,
            base_jql=config.base_jql,
            team_field_id=config.team_field_id,
            jira_search=jira_search,
            directory=directory,
            budget=budget,
        )

    def refresh_runtime(self):
        return self._get('_get_catalog_refresh_runtime')(
            fetch_sprints=self._get('fetch_board_sprints'),
            fetch_teams=self._get('fetch_catalog_sprint_teams'),
        )
