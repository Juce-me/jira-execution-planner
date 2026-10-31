#!/usr/bin/env python3
"""Generate the work-structure coupling inventory (plan Task 0).

Output: ``tmp/work-configuration-sites.json`` (ignored). The inventory is built
from (a) a curated SEED table copied from
``docs/plans/EXEC-quarterly-work-structure-migration.md`` and (b) a pattern scan
of ``backend/``, ``jira_server.py``, ``planning/`` and ``frontend/src/`` using
Python ``ast`` (enclosing symbol, callers) plus line regexes.  It is a
navigation/guard artifact, NOT an exhaustiveness claim: the header records
coverage notes and unknowns.  Output is deterministic (no timestamps, sorted).

Usage: python scripts/generate_work_configuration_sites.py [--out PATH]
"""
import argparse
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATOR_VERSION = 1
DEFAULT_OUT = ROOT / 'tmp' / 'work-configuration-sites.json'

DISPOSITIONS = (
    'query', 'metadata_protocol', 'display', 'calculation', 'cache_identity',
    'alert', 'edit_capability', 'route_selector', 'catalog', 'test_only',
    'legacy_adapter',
)
LEGACY_ADAPTER = 'legacy_adapter'
# A promoted-path bypass is never an allowed exception: the allowlist must stay empty.
PROMOTED_PATH_BYPASS_ALLOWLIST = ()
ROW_FIELDS = (
    'id', 'origin', 'path', 'line', 'line_end', 'symbol', 'assumption', 'matched_text',
    'callers', 'legacy_role', 'new_role', 'disposition', 'owning_test', 'confidence', 'note',
)

SCAN_DIRS = ('backend', 'planning', 'frontend/src')
SCAN_FILES = ('jira_server.py',)
SCAN_SUFFIXES = {'.py', '.js', '.jsx', '.mjs'}
SKIP_PARTS = {'dist', 'node_modules', '__pycache__', 'alembic'}

# --------------------------------------------------------------------------
# Seed table: (ref, disposition, legacy_role, new_role). Refs are
# ``basename-or-path:seg[,seg]`` where seg is ``N`` or ``N-M``. Basenames are
# resolved with PATH_HINTS then a unique-basename lookup.
# --------------------------------------------------------------------------
PATH_HINTS = {
    'models.py': 'backend/db/models.py',
    'guards.py': 'backend/security/guards.py',
    'settings_routes.py': 'backend/routes/settings_routes.py',
    'eng_routes.py': 'backend/routes/eng_routes.py',
    'eng_board.py': 'backend/services/eng_board.py',
    'eng_board_routes.py': 'backend/routes/eng_board_routes.py',
    'stats_routes.py': 'backend/routes/stats_routes.py',
    'epm_routes.py': 'backend/routes/epm_routes.py',
    'capacity_routes.py': 'backend/routes/capacity_routes.py',
    'dev_routes.py': 'backend/routes/dev_routes.py',
    'sprint_review_routes.py': 'backend/routes/sprint_review_routes.py',
    'epic_cohort_closed.py': 'backend/services/epic_cohort_closed.py',
    'eng_board_measurement.py': 'backend/services/eng_board_measurement.py',
    'jira_issue_project_track.py': 'backend/services/jira_issue_project_track.py',
    'jira_issue_field_edits.py': 'backend/services/jira_issue_field_edits.py',
    'sprint_review.py': 'backend/services/sprint_review.py',
    'epic_refresh.py': 'backend/services/epic_refresh.py',
    'workspace_catalog_config.py': 'backend/services/workspace_catalog_config.py',
    'sprints.py': 'backend/services/sprints.py',
    'rollup.py': 'backend/epm/rollup.py',
}

Q, MP, DI, CA, CI, AL, ED, RS, CT = (
    'query', 'metadata_protocol', 'display', 'calculation', 'cache_identity',
    'alert', 'edit_capability', 'route_selector', 'catalog')

SEEDS = [
    # --- Query construction (plan coupling table) ---
    ('jira_server.py:2940,2951-2986', Q,
     'Literal Initiative name/hierarchyLevel==0 ancestor test; textual Story->Epic JQL swap in derive_epic_jql',
     'Mapped ancestor/parent query; never rewrite arbitrary global JQL text'),
    ('jira_server.py:3404-3415,3433-3448,3820-3848', Q,
     'Team[Team] JQL clauses, configured-issue-type clause, lightweight non-parent (issuetype != Epic) rule',
     'Mapped Team/planning field ids; Legacy filter mode preserved; non-parent rule moves to actual role'),
    ('jira_server.py:4616-4619,5051-5060,5411-5418,5518,5571-5577,5608-5626', Q,
     'Stats/cohort/missing-info/label/history/excluded queries with Team[Team] and issuetype = Epic literals',
     'Mapped roles and Team; unchanged per-surface rules'),
    ('eng_routes.py:391,445,454,1406,1488,2033,2201-2204', Q,
     'Initiative-discovery/readiness JQL with issuetype = Epic/Story, parent in, Team[Team] literals',
     'Initiative discovery + Epic readiness/missing-info/Team directory via parent relations, not literal Story/Epic'),
    ('eng_board.py:235,268-300,328,372', Q,
     'Board Epic index/child/continuation JQL: issuetype = Epic, level-zero Story eligibility, Epic Link/parent',
     'Mapped parent JQL, level-zero eligibility and child/continuation cohort; per-consumer [] behavior preserved'),
    ('epic_cohort_closed.py:67', Q,
     'Closed-Epic cohort issuetype = Epic literal', 'Mapped grouping-parent type for closed cohort'),
    ('settings_routes.py:1099-1155,1210,1461-1556,1737-1749', CT,
     'Components/status catalogs, Epic search (literal Epic), issue-type catalog read through unscoped getters',
     'Explicit stored-configuration projections: components, grouping-parent status catalog, parent picker, id/level catalog'),
    ('dev_routes.py:379-387', Q, 'Developer probe with literal Epic/Story JQL',
     'Same explicit context and source guard, no hidden bypass'),
    ('eng_board_measurement.py:119', Q, 'Measurement probe JQL with Epic literal',
     'Same explicit context and source guard, no hidden bypass'),
    ('jira_issue_project_track.py:119', ED, 'Project Track editable on Epic by name',
     'Actual mapped parent edit capability (Initiative own key)'),
    ('jira_issue_field_edits.py:225-229', ED, 'Epic/Story edit capability by type name',
     'Mapped parent/child edit capability; never classify by name alone'),
    ('sprint_review.py:310-320', ED, 'Review row kind Epic/Story by name',
     'Native review-kind authorization; native type is not role'),
    # --- Calculations ---
    ('engTaskUtils.js:12,19', CA, 'SP parser oracle: parseFloat(x||0), NaN skipped; Killed excluded from Epic total',
     'Same parser applied to mapped Epic SP for Initiative totals'),
    ('capacityClassification.mjs:39', CA, 'classifyCapacityIssue Product/Tech/Ad Hoc by project key and Ad Hoc Epic set',
     'Combined lane: {projectType other, capacityType other|ad_hoc, productSubtype null}; Ad Hoc/excluded keys are Initiative keys'),
    ('planningCapacityUtils.js:402,425', CA, 'Planning capacity classification consumer',
     'Adapt to combined lane classification'),
    ('planningSelectionStats.js:53,67', CA, 'Selected project/team-project stats via classifyCapacityIssue',
     'Combined bucket; Ad Hoc not Product attributed'),
    ('planningSelectionStats.js:24-28', CA, 'selectedPlanningTasksList drops excluded Epics (allocation denominator)',
     'Distinct denominator preserved: excluded 0 in included bucket, 8 in excluded report'),
    ('useEngCapacity.js:69-75', CA, 'buildSelectedTeamStats(selectedTasksList) includes excluded; project stats use planning list',
     'Overall selected/team totals keep excluded selected work; combined bucket only'),
    ('eng_board.py:108', MP, 'Board project kind normalization accepts product/tech/other',
     'Combined lane must stay accepted as other'),
    ('jira_server.py:3417-3431', Q, 'Empty matching project keys omit project filtering (project_filter product/tech)',
     'One unfiltered lane; never two Product/Tech requests (no 16SP duplication)'),
    # --- Component Board admission ---
    ('eng_board.py:229-250,508-534', Q, 'Component predicate on Epic index and team-Epic batches',
     'Component membership on Epic leaves before admitting grouping Initiative parents'),
    ('eng_board_routes.py:786-800', Q, 'Board parent-level discovery for component/all_work',
     'Epic-leaf Component discovery then batch parent hydration'),
    ('eng_routes.py:391-394', Q, 'Oversized Department notice: Epic discovery excluding Done/Killed/Incomplete/Postponed',
     'Open Initiative discovery with the same bound and partial-data warning'),
    # --- Cache/read authority ---
    ('jira_server.py:215-224,2069,2808', CI, 'Tasks/readiness cache partitions and generation retirement',
     'Configuration id/revision/digest in existing partitions'),
    ('eng_board_routes.py:65-90', CI, 'Board snapshot/index/stream/resume scope digest',
     'Context in scope/checkpoint/cohort digest; reject stale resume'),
    ('jira_server.py:1302,1666,5802', CI, 'Completed stats/cohort/excluded/Track cache keys',
     'Single digest or ordered quarter-digest list'),
    ('workspace_catalog_config.py:36-46', CI, 'Sprint/Team catalog identity (workspace+Board)',
     'Per-source identity plus Team effective-scope digest'),
    ('workspace_catalog_config.py:40-43', CI, 'Board identity workspace+numeric Board', 'Unchanged Board identity; issue-mode adds scope digest'),
    ('jira_server.py:1324-1366,6410-6419,6474', CI, 'Metadata memos/catalogs read configuration-dependent scalars',
     'Projections keyed by configuration id/revision/digest'),
    ('jira_server.py:226-228', CI, 'EPM private-config/auth generation', 'Add structural digest'),
    ('rollup.py:182,247', CI, 'EPM rollup identity', 'Add structural digest to private-config/auth generation'),
    # --- Route selectors / catalogs ---
    ('settings_routes.py:656', RS, 'GET /api/config bootstrap', 'Compact summaries and promotion booleans'),
    ('settings_routes.py:550-584', RS, 'GET /api/sprints', 'Configuration-scoped rows with physical ids and source identity'),
    ('engApi.js:19', RS, 'Sprint fetch client', 'Carry configuration selector'),
    ('eng_routes.py:1832-1863', RS, 'GET /api/teams requires numeric sprint', 'Admitted source resolution, no name fallback'),
    ('eng_routes.py:2088-2100', RS, 'GET /api/teams/all optional sprint', 'Explicit quarter/configuration without sprint'),
    ('eng_routes.py:1626-1638', RS, 'GET /api/tasks selectors', 'quarter/configurationId; project=all once'),
    ('jira_server.py:3338-3347', RS, 'tasks request build_base_jql selectors', 'Configuration-resolved base JQL'),
    ('eng_routes.py:556-568', RS, 'GET /api/eng/story-readiness', 'Admitted context, complete selected-scope readiness'),
    ('eng_routes.py:1357-1372,2184-2193', RS, 'missing-info/backlog-epics selectors', 'Explicit viewed quarter for backlog'),
    ('epic_refresh.py:46-61', Q, 'Per-row refresh Product/Tech-only lane gate', 'Mapped lane gate'),
    ('eng_board_routes.py:35,57-64,1046', RS, 'GET /api/eng/board scope selectors', 'sprintId->quarter; all-work needs viewed quarter'),
    ('eng_routes.py:1007-1013', RS, 'GET /api/issues/subtasks', 'Context for role-dependent enrichment'),
    ('eng_routes.py:1015-1021', RS, 'subtasks required numeric sprint', 'Carry context'),
    ('eng_routes.py:889-913', RS, 'Issue field edit options', 'Configuration stamp'),
    ('jira_server.py:5994-6000,6055-6073', RS, 'GET /api/stats, /api/stats/burnout', 'Quarter-name selectors resolve configuration'),
    ('stats_routes.py:11-32', RS, 'Stats POST sources', 'SprintIds admit authoritative quarters'),
    ('jira_server.py:5943-5950,6116-6131,6278-6297', RS, 'Excluded-capacity, epic-cohort, Track phase routes', 'Quarter/configuration selectors'),
    ('epm_routes.py:273-311', RS, 'EPM rollup/issues routes', 'Selected id->quarter/configuration'),
    ('capacity_routes.py:49-53,110-122', RS, 'Capacity routes (global)', 'Unchanged: no project configuration selector'),
    ('jira_server.py:1924-1932', RS, 'Config helper referenced by plan', 'See plan'),
    ('jira_server.py:6487,6496-6506', CT, 'GET /api/test and issue-types catalog', 'Configuration id/revision for saved Test/catalog'),
    ('jiraCatalogApi.js:104-112', CT, 'Components client', 'Explicit configurationId/revision'),
    ('boardConfigApi.js:17-23', CT, 'Board statuses client', 'Explicit stored-entry selectors'),
    ('boardStatusCatalog.js:17-24', CT, 'Board status catalog helper', 'Explicit stored-entry selectors'),
    ('GroupBoardSettings.jsx:253', CT, 'Group board settings status fetch', 'Explicit stored-entry selectors'),
    ('dashboardRuntime.js:79-89,117-130,201-203', RS, 'Id-first sprint fallback', 'Quarter intent preserved across admission'),
    ('dashboard.jsx:449-454,1354-1389', RS, 'Dashboard sprint selection fallback', 'Quarter intent preserved'),
    ('epic_cohort_closed.py:16-34,111-135', Q, 'Last N closed-Epic cohort window', 'Closed grouping parents from selected scope'),
    ('cohortUtils.js:244-254', Q, 'Cohort query key / Last N client', 'Selected configuration digest in cohortQueryKey'),
    ('cohortUtils.js:24-31', Q, 'Cohort request builder', 'Selected configuration selectors'),
    ('jira_server.py:1278-1290,6133-6137', CI, 'Cohort cache identity', 'Selected configuration digest'),
    ('useStatsData.js:190-200', RS, 'Stats data request build', 'Configuration selectors'),
    # --- Writes / review ---
    ('eng_routes.py:857', ED, 'POST /api/issues/<key>/field', 'Configuration stamp, own key only'),
    ('jira_issue_field_edits.py:598', ED, 'Field validator', 'Mapped capability'),
    ('eng_routes.py:791,826', ED, 'editable-fields/user-options', 'Configuration selector'),
    ('eng_routes.py:1120,1151', ED, 'transition options/transitions', 'Configuration stamp'),
    ('eng_routes.py:1187,1224', ED, 'priority options/set', 'Configuration stamp'),
    ('eng_routes.py:1274,1302', ED, 'project-track options/set', 'Parent editor targets Initiative'),
    ('sprint_review_routes.py:64-78', ED, 'Sprint review routes', 'Configuration stamp'),
    ('capacity_routes.py:115-122', ED, 'PATCH /api/capacity/<issue_key>', 'Unchanged, no structural stamp'),
    ('models.py:850-895', MP, 'Review schema cells accept only Epic/Story String(8); views inherit by padded Sprint id',
     'Native kind is not role'),
    ('sprint_review.py:33-36,360-371', MP, 'Review row kinds Epic/Story', 'Native review-kind protocol'),
]

# --------------------------------------------------------------------------
# Pattern scan. (id, regex, assumption, py/js default disposition,
#                legacy_role, new_role). Applied to non-comment lines.
# --------------------------------------------------------------------------
PATTERNS = [
    ('team_team_field', r'Team\[Team\]', 'Team[Team]', Q,
     'Team work-item field referenced by JQL name', 'Mapped Team field id on the Epic leaf'),
    ('issuetype_epic', r'''(?i)\b(?:issue)?type\s*(?:=|!=|in|not in)\s*\(?\s*["']?\\?["']?Epic\b''', 'issuetype Epic', Q,
     'Epic literal in JQL', 'Mapped grouping/leaf type'),
    ('issuetype_story', r'''(?i)\b(?:issue)?type\s*(?:=|!=|in|not in)\s*\(?\s*["']?\\?["']?Story\b''', 'issuetype Story', Q,
     'Story literal in JQL', 'Mapped leaf type (Epic in new model)'),
    ('type_name_swap', r'''['"](?:issue)?type\s*=\s*\\?["']?Story[^,]*,\s*['"](?:issue)?type\s*=\s*\\?["']?Epic''', 'Story<->Epic textual swap', Q,
     'Textual Story/Epic type-name swap', 'Mapped parent/child roles'),
    ('level_zero', r'hierarchy_?[Ll]evel', 'hierarchyLevel / level-zero', MP,
     'Level-zero/hierarchy test on issue type metadata', 'Mapped level/id catalog'),
    ('epic_link', r'''Epic Link|epic_link|epicLink''', 'Epic Link field', MP,
     'Epic Link compatibility relationship', 'Preserved Story->Epic compatibility only; Epic->Initiative uses parent'),
    ('parent_jql', r'''\bparent\s+(?:in|=)\s*[\(\"'{]''', 'parent in (...)', Q,
     'JQL parent relation', 'Mapped parent relation'),
    ('type_name_compare', r'''(?i)(?:type_name|issue_?type\w*|issuetype\w*|typeName)\b[^\n]{0,30}(?:==|===|in)\s*[\(\[]?\s*['\"](?:initiative|epic|story|subtask|sub-task)['\"]''',
     'issue type name comparison', MP, 'Name-based type classification', 'Mapped role by type id'),
    ('initiative_literal', r'''['\"]Initiative['\"]''', "'Initiative' literal", MP,
     'Literal Initiative name', 'Mapped grouping parent'),
    ('product_tech_lane', r'''JIRA_PRODUCT_PROJECT|JIRA_TECH_PROJECT|techProjectKeys|tech_project_keys|project_filter\s*==|productProjectKeys''',
     'Product/Tech project lane', Q, 'Product/Tech lane by project key set', 'One combined lane (other)'),
    ('configured_issue_types', r'get_configured_issue_types|\bissueTypes\b', 'configured issue types', Q,
     '[] / single / multiple issue-type interpretation per surface', 'Mapped leaf type ids'),
    ('excluded_adhoc', r'excludedCapacityEpics|adHocEpic|adHocCapacityEpics|ad_hoc_epic|excluded_capacity_epics', 'Excluded/Ad Hoc Epic keys',
     CA, 'Epic-keyed exclusion / Ad Hoc', 'Initiative-keyed; Epic inherits'),
    ('story_points_parse', r'''customfield_10004|story_?points\b''', 'Story Points parse/field', CA,
     'Story Points normalization (parseFloat(x||0))', 'Mapped Epic SP with same parser'),
    ('epic_parent_keys', r'''\bepicKey\b|\bparentKey\b|\bepic_key\b''', 'epicKey/parentKey alias', CA,
     'Normalized Epic key alias on Story-level records', 'Mapped parent key alias'),
    ('review_kind', r'''row_?[Kk]ind|REVIEW_KIND|review_kind''', 'review row kind', MP,
     'Review kind Epic/Story', 'Native kind protocol'),
]
COMMENT_RE = re.compile(r'^\s*(#|//|\*|/\*)')

# Query sites migrated by plan Task 4: the Epic/Story/Initiative/Team[Team] literals that remain
# inside them belong to the explicit Legacy adapter; a promoted request resolves the role through
# ``planning_work.WorkRoles``. (path, top-level symbol) -> token the function source must contain
# (tests/test_work_structure_consumer_inventory.py verifies it).
MIGRATED_QUERY_SITES = {
    ('jira_server.py', 'fetch_tasks'): 'roles',
    ('jira_server.py', 'derive_epic_jql'): 'roles',
    ('jira_server.py', 'fetch_epics_for_empty_alert'): 'roles',
    ('jira_server.py', 'fetch_backlog_epics_for_alert'): 'roles',
    ('jira_server.py', 'fetch_story_counts_for_epics'): 'roles',
    ('jira_server.py', 'fetch_story_distribution_for_epics'): 'roles',
    ('jira_server.py', 'fetch_epic_details_bulk'): 'roles',
    ('jira_server.py', 'build_scenario_jql'): 'roles',
    ('jira_server.py', 'fetch_stats_for_sprint'): 'roles',
    ('jira_server.py', 'fetch_burnout_events_for_sprint'): 'roles',
    ('jira_server.py', 'build_excluded_capacity_stats_jql'): 'roles',
    ('jira_server.py', 'fetch_epic_cohort_data'): 'roles',
    ('jira_server.py', 'fetch_closed_epic_cohort_data'): 'roles',
    ('jira_server.py', '_cohort_qualifies_through_leaves'): 'roles',
    ('jira_server.py', '_cohort_leaf_scope_builder'): 'roles',
    ('backend/services/epic_cohort_closed.py', 'build_leaf_scope_jql'): 'planning_clause',
    ('backend/routes/eng_routes.py', 'get_missing_info'): 'roles',
    ('backend/routes/eng_routes.py', 'get_backlog_epics'): 'roles',
    ('backend/routes/eng_routes.py', '_story_readiness_compute'): 'roles',
    ('backend/routes/eng_routes.py', 'resolve_team_names'): 'work_request',
    ('backend/routes/eng_board_routes.py', '_capture_shape'): 'roles',
    ('backend/routes/eng_board_routes.py', '_capture_snapshot'): 'roles',
    ('backend/routes/eng_board_routes.py', '_frame_stream'): 'leaf_cohort',
    ('backend/services/eng_board.py', 'build_epic_index_jql'): 'parent_clause',
    ('backend/services/eng_board.py', 'iter_team_epic_batches'): 'parent_clause',
    ('backend/services/eng_board.py', 'discover_team_epics'): 'parent_clause',
    ('backend/services/epic_cohort_closed.py', 'build_closed_epic_jqls'): 'parent_clause',
    ('backend/services/eng_subtasks.py', 'build_subtasks_jql'): 'sprint_clause',
    # Task 6: Stats, Last N, EPM and the Scenario seam resolve the role through the admitted configuration.
    ('jira_server.py', 'classify_project'): 'roles',
    ('jira_server.py', 'get_stats_team_ids'): 'roles',
    ('jira_server.py', 'get_completed_sprint_stats'): 'roles',
    ('jira_server.py', 'get_burnout_stats'): 'roles',
    ('jira_server.py', 'get_epic_cohort_stats'): 'work_request',
    ('jira_server.py', '_cohort_range_fetch'): 'roles',
    ('jira_server.py', 'fetch_excluded_capacity_stats_source'): 'roles',
    ('jira_server.py', 'build_excluded_capacity_issue_payload'): 'roles',
    ('jira_server.py', 'fetch_cached_excluded_capacity_epic_summaries'): 'roles',
    ('jira_server.py', 'get_project_track_phase_durations'): 'work_request',
    ('jira_server.py', 'scenario_planner'): 'roles',
    ('jira_server.py', 'scenario_work_gate'): 'is_legacy',
    ('jira_server.py', 'build_epm_rollup_dependencies'): 'roles',
    ('jira_server.py', 'admit_epm_work_request'): 'admit_sprint_id_groups',
    ('backend/epm/rollup.py', 'build_per_project_rollup'): 'roles',
    ('backend/epm/rollup.py', '_build_new_model_rollup'): 'roles',
    ('backend/epm/scope.py', 'build_epm_scope_clause'): 'epic_link',
    ('backend/routes/epm_routes.py', 'build_epm_project_issues_response'): 'roles',
    ('backend/services/planning_work.py', 'WorkRoles'): 'is_legacy',
    ('backend/services/planning_work.py', 'load_planning_work'): 'WorkRoles',
}

TEST_GLOBS = ('tests/test_*.py', 'tests/*.js', 'tests/*.mjs', 'tests/ui/*.js')

# Manual classification of ambiguous scan groups, by (path-prefix, pattern id) ->
# (disposition, new_role, note). Decided by reading callers; see `note`.
# First match wins: (path prefix, symbol or '*', pattern id or '*') ->
# (disposition, new_role, note).
MANUAL_OVERRIDES = [
    ('backend/db/migrations', '*', '*', MP, 'Frozen migration history', 'Historical schema literal, not a runtime role'),
    ('backend/db', '*', '*', MP, 'Native storage protocol', 'Storage/review-kind schema literal, not a role (native type is not role)'),
    ('backend/routes/settings_routes.py', 'search_epics', '*', Q, 'Mapped parent picker', 'Epic search by type name/hierarchyLevel==1; caller is the Department excluded/Ad Hoc picker'),
    ('backend/services/jira_issue_field_edits.py', '_issue_supports_field', '*', ED, 'Mapped parent/child edit capability', 'Name-based capability gate; callers are the field edit routes'),
    ('backend/services/sprint_review.py', 'authorize_issues', '*', ED, 'Native review-kind authorization', 'Hierarchy used to authorize a review row kind'),
    ('backend/services/eng_board.py', 'resolve_issue_type_ids', '*', Q, 'Mapped leaf type ids', 'Level-zero non-subtask eligibility; [] => all eligible, missing key => Story'),
    ('backend/services/group_config.py', 'build_epic_alert_scope_clause', '*', Q, 'Mapped Team field on Epic leaf', 'Team clause builder used by Epic alert queries'),
    ('jira_server.py', 'fetch_epic_details_bulk', '*', Q, 'Mapped ancestor/parent hydration', 'Ancestor Initiative detection; caller feeds Epic details to alerts and Board'),
    ('jira_server.py', 'resolve_team_field_id', '*', Q, 'Mapped Team field id', 'Resolves the Team[Team] field id; docstring literal'),
    ('jira_server.py', 'extract_team_ids', '*', Q, 'Mapped Team field values', 'Team value extraction, docstring literal'),
    ('jira_server.py', 'extract_team_ids_from_jql', '*', Q, 'Mapped Team JQL parsing', 'Parses Team[Team] clause out of JQL'),
    ('jira_server.py', 'remove_team_filter_from_jql', '*', Q, 'Mapped Team JQL stripping', 'Strips Team[Team] clause (seed 3820-3848 caller)'),
    ('backend/config', '*', 'configured_issue_types', CT, 'Configuration storage of issueTypes', 'Config validation/storage; the owning Legacy entry keeps its names'),
    ('backend/epm', '*', 'configured_issue_types', CT, 'EPM private issueTypes buckets', 'EPM config is private/global, not quarter-scoped'),
    ('backend/epm', '*', 'initiative_literal', CT, 'EPM default issue type buckets', 'EPM bucket defaults'),
    ('frontend/src', '*', 'initiative_literal', CT, 'EPM default issue type buckets', 'EPM bucket defaults'),
    ('frontend/src', '*', 'type_name_swap', DI, 'Display label', 'Display text only'),
    ('frontend/src', '*', 'type_name_compare', DI, 'Display/row-kind by type name', 'Presentational kind selection; re-check where it gates behavior'),
    ('frontend/src', '*', 'product_tech_lane', CA, 'Product/Tech classification set', 'Combined lane classification consumer'),
    ('frontend/src', '*', 'configured_issue_types', CT, 'Settings issueTypes state', 'Settings/config client state'),
    ('frontend/src', '*', 'epic_parent_keys', CA, 'Mapped parent key alias on mapped leaf records', 'Alias read by calculation/grouping consumers, not by queries'),
    ('frontend/src', '*', 'story_points_parse', CA, 'Same oracle parser on mapped SP', 'Callers fold SP through the shared parseFloat oracle'),
    ('frontend/src', '*', 'level_zero', MP, 'Mapped level/id catalog', 'Metadata-only read of issue-type catalog'),
    ('frontend/src', '*', 'review_kind', MP, 'Native review-kind protocol', 'Frontend mirror of native kind'),
    ('backend/services/sprint_review.py', '*', 'review_kind', MP, 'Native review-kind protocol', 'Native kind, not role'),
    ('backend/routes/sprint_review_routes.py', '*', 'review_kind', MP, 'Native review-kind protocol', 'Native kind, not role'),
    ('backend/services/review_adoption.py', '*', 'review_kind', MP, 'Native review-kind protocol (adoption)', 'Native kind, not role'),
]


def iter_source_files():
    files = []
    for name in SCAN_FILES:
        p = ROOT / name
        if p.exists():
            files.append(p)
    for d in SCAN_DIRS:
        base = ROOT / d
        if not base.exists():
            continue
        for p in base.rglob('*'):
            if p.is_file() and p.suffix in SCAN_SUFFIXES and not (SKIP_PARTS & set(p.relative_to(ROOT).parts)):
                files.append(p)
    return sorted(set(files), key=lambda p: p.relative_to(ROOT).as_posix())


def rel(p):
    return p.relative_to(ROOT).as_posix()


class Index:
    """Cached file texts, Python symbol intervals and caller lookup."""

    def __init__(self, files):
        self.files = files
        self.lines = {}
        self.intervals = {}
        self.parse_errors = []
        for p in files:
            text = p.read_text(encoding='utf-8', errors='replace')
            self.lines[rel(p)] = text.split('\n')
            if p.suffix == '.py':
                self.intervals[rel(p)] = self._py_intervals(rel(p), text)
        self.tests = {}
        for pattern in TEST_GLOBS:
            for t in sorted(ROOT.glob(pattern)):
                self.tests[rel(t)] = t.read_text(encoding='utf-8', errors='replace')
        self._owner_cache = {}
        self._test_words = {t: set(re.findall(r'\w+', text)) for t, text in self.tests.items()}

    def _py_intervals(self, path, text):
        try:
            tree = ast.parse(text)
        except SyntaxError:
            self.parse_errors.append(path)
            return []
        out = []

        def walk(node, prefix):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    name = f'{prefix}{child.name}'
                    out.append((child.lineno, getattr(child, 'end_lineno', child.lineno), name))
                    walk(child, name + '.')
                else:
                    walk(child, prefix)
        walk(tree, '')
        return out

    def symbol(self, path, line):
        if path.endswith('.py'):
            best = None
            for start, end, name in self.intervals.get(path, ()):
                if start <= line <= end and (best is None or start >= best[0]):
                    best = (start, name)
            return best[1] if best else '<module>'
        lines = self.lines.get(path, [])
        js_def = re.compile(
            r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|'
            r'^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function|React\.|\w+\s*=>)')
        for i in range(min(line, len(lines)) - 1, -1, -1):
            m = js_def.match(lines[i])
            if m:
                return m.group(1) or m.group(2)
        return '<module>'

    def _call_index(self):
        if not hasattr(self, '_calls'):
            self._calls = {}
            ident = re.compile(r'(\w+)\s*\(')
            for p in sorted(self.lines):
                for i, text in enumerate(self.lines[p], 1):
                    if COMMENT_RE.match(text) or re.match(r'\s*(?:async\s+)?(?:def|function|export function)\s', text):
                        continue
                    for name in set(ident.findall(text)):
                        self._calls.setdefault(name, []).append(f'{p}:{i}')
        return self._calls

    def callers(self, symbol, path, limit=6):
        simple = symbol.split('.')[-1]
        if simple in ('<module>', '') or len(simple) < 4:
            return []
        return self._call_index().get(simple, [])[:limit]

    def owning_test(self, path, symbol):
        ck = (Path(path).stem, symbol.split('.')[-1])
        if ck in self._owner_cache:
            return self._owner_cache[ck]
        res = self._owning_test(path, symbol)
        self._owner_cache[ck] = res
        return res

    def _owning_test(self, path, symbol):
        simple = symbol.split('.')[-1]
        names = set()
        if simple and simple != '<module>' and len(simple) >= 5:
            names.add(simple)
        stem = Path(path).stem
        hits = []
        for tpath, text in self.tests.items():
            if names & self._test_words[tpath]:
                hits.append(tpath)
        if not hits:
            for tpath, text in self.tests.items():
                if len(stem) >= 6 and stem in text:
                    hits.append(tpath)
        return sorted(hits)[:3] or ['unowned']


def resolve_seed_path(token, all_paths):
    if token in PATH_HINTS:
        return PATH_HINTS[token]
    if '/' in token:
        return token
    if (ROOT / token).exists():
        return token
    matches = sorted(p for p in all_paths if p.endswith('/' + token))
    matches = [m for m in matches if not m.startswith('tmp/')]
    if len(matches) == 1:
        return matches[0]
    raise SystemExit(f'ambiguous or missing seed path {token!r}: {matches}')


def parse_segments(spec):
    out = []
    for seg in spec.split(','):
        a, _, b = seg.partition('-')
        out.append((int(a), int(b or a)))
    return out


def seed_pairs():
    """Yield (seed_id, path, start, end, seed_tuple) for every seed segment."""
    all_paths = {rel(p) for p in iter_source_files()}
    for entry in SEEDS:
        ref = entry[0]
        token, _, spec = ref.partition(':')
        path = resolve_seed_path(token, all_paths)
        for start, end in parse_segments(spec):
            yield f'{path}:{start}' + (f'-{end}' if end != start else ''), path, start, end, entry


def seed_ids():
    return sorted({sid for sid, *_ in seed_pairs()})


def scan_range(index, path, start, end):
    lines = index.lines.get(path, [])
    found = []
    for n in range(start, min(end, len(lines)) + 1):
        text = lines[n - 1]
        if COMMENT_RE.match(text):
            continue
        for pid, rx, *_ in PATTERNS:
            if re.search(rx, text):
                found.append(pid)
    return sorted(set(found))


def build_rows(index):
    rows = []
    for sid, path, start, end, (ref, disp, legacy, new) in seed_pairs():
        symbol = index.symbol(path, start)
        found = scan_range(index, path, start, end)
        assumption = ', '.join(found) if found else 'manual: no pattern match; classified from plan table and callers'
        rows.append({
            'id': f'seed:{sid}', 'origin': 'seed', 'path': path, 'line': start, 'line_end': end,
            'symbol': symbol, 'assumption': assumption, 'matched_text': '',
            'callers': index.callers(symbol, path), 'legacy_role': legacy, 'new_role': new,
            'disposition': disp, 'owning_test': index.owning_test(path, symbol),
            'confidence': 'seed_curated', 'note': 'Seed from EXEC plan; line numbers are the pinned base',
        })
    for path, lines in sorted(index.lines.items()):
        for n, text in enumerate(lines, 1):
            if COMMENT_RE.match(text):
                continue
            for pid, rx, assumption, disp, legacy, new in PATTERNS:
                if not re.search(rx, text):
                    continue
                confidence, note = 'pattern_default', ''
                symbol = index.symbol(path, n)
                for prefix, osym, opid, odisp, onew, onote in MANUAL_OVERRIDES:
                    if path.startswith(prefix) and osym in ('*', symbol) and opid in ('*', pid):
                        disp, new, confidence, note = odisp, onew, 'manual_override', onote
                        break
                if disp == Q and (path, symbol.split('.')[0]) in MIGRATED_QUERY_SITES:
                    disp, confidence = LEGACY_ADAPTER, 'migrated_task4'
                    new = 'Promoted requests resolve this role through planning_work.WorkRoles'
                    note = 'Literal retained only inside the explicit Legacy adapter branch'
                rows.append({
                    'id': f'scan:{path}:{n}:{pid}', 'origin': 'scan', 'path': path, 'line': n, 'line_end': n,
                    'symbol': symbol, 'assumption': assumption, 'matched_text': text.strip()[:160],
                    'callers': index.callers(symbol, path), 'legacy_role': legacy, 'new_role': new,
                    'disposition': disp, 'owning_test': index.owning_test(path, symbol),
                    'confidence': confidence, 'note': note,
                })
    rows.sort(key=lambda r: (r['path'], r['line'], r['origin'], r['id']))
    return rows


def generate():
    files = iter_source_files()
    index = Index(files)
    rows = build_rows(index)
    by_disp = {}
    for r in rows:
        by_disp[r['disposition']] = by_disp.get(r['disposition'], 0) + 1
    header = {
        'generator': 'scripts/generate_work_configuration_sites.py',
        'generator_version': GENERATOR_VERSION,
        'plan': 'docs/plans/EXEC-quarterly-work-structure-migration.md',
        'scanned_roots': list(SCAN_DIRS) + list(SCAN_FILES),
        'scanned_file_count': len(files),
        'row_count': len(rows),
        'rows_by_disposition': dict(sorted(by_disp.items())),
        'rows_by_origin': {o: sum(1 for r in rows if r['origin'] == o) for o in ('scan', 'seed')},
        'promoted_path_bypass_allowlist': list(PROMOTED_PATH_BYPASS_ALLOWLIST),
        'python_files_unparsed': sorted(index.parse_errors),
        'coverage_notes': [
            'NOT exhaustive. Seed rows come from the plan tables at the pinned base; scan rows come from line regexes over non-comment lines.',
            'Python symbol = innermost def/class from ast; JS symbol = nearest preceding function/const definition (best effort).',
            'Callers are textual call sites by simple name (max 6); dynamic dispatch, aliases and string-keyed callbacks are missed.',
            'owning_test = up to 3 test files mentioning the symbol (or module stem); "unowned" means none found, not that none exists.',
            'Dispositions on scan rows are pattern defaults unless confidence=manual_override; confidence=pattern_default rows need caller review before the guarded change touches them.',
            'Query builders that compose JQL from variables (no literal) are not found by regex; only seeds cover them.',
            'Backend alembic/migrations, tests, docs and frontend/dist are not scanned.',
        ],
        'unknowns': [
            'Scenario source/reload and review/adoption tools are covered only by pattern hits, not by a verified call graph.',
            'Frontend dynamic strings (template-literal JQL) are not parsed.',
            'Seed line numbers drift when the pinned files change; the guard test checks seed presence by id, not content.',
        ],
    }
    return {'header': header, 'rows': rows}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(DEFAULT_OUT))
    args = parser.parse_args(argv)
    data = generate()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    print(f"wrote {out} rows={data['header']['row_count']} by_disposition={data['header']['rows_by_disposition']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
