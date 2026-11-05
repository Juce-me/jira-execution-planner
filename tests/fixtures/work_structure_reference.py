"""Synthetic Legacy reference data and oracles for the work-structure migration (plan Task 0).

Everything here is synthetic: keys are OLD-* (Legacy model) and PLAN-* (new model),
teams/projects/components are invented. Legacy values are PINNED against the real
current functions in tests/test_work_structure_reference_fixture.py; the
NEW_MODEL_EXPECTED_* constants only record the plan's accepted outcomes and are NOT
yet asserted against any code (the new model does not exist at this base).

Not yet covered (add only when a test first needs it): Board progress, Stats, EPM.
"""

# --- Issue-type interpretation ------------------------------------------------
# dashboard-config `issueTypes` value -> what get_configured_issue_types() returns
# for the task/stats surfaces: missing/None -> ['Story']; [] -> unrestricted ([]).
TASK_STATS_ISSUE_TYPE_CASES = [
    # (case id, config dict, expected configured list)
    ('missing', {}, ['Story']),
    ('null', {'issueTypes': None}, ['Story']),
    ('empty', {'issueTypes': []}, []),
    ('single', {'issueTypes': ['Story']}, ['Story']),
    ('multiple', {'issueTypes': ['Story', ' Task ', '']}, ['Story', 'Task']),
]

# Synthetic Jira issue-type catalog as eng_board.resolve_issue_type_ids reads it.
BOARD_ISSUE_TYPE_CATALOG = [
    {'id': '90001', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False},
    {'id': '90002', 'name': 'Task', 'hierarchyLevel': 0, 'subtask': False},
    {'id': '90003', 'name': 'Bug', 'hierarchyLevel': 0, 'subtask': False},
    {'id': '90004', 'name': 'Sub-task', 'hierarchyLevel': 0, 'subtask': True},
    {'id': '90005', 'name': 'Epic', 'hierarchyLevel': 1, 'subtask': False},
    {'id': '90006', 'name': 'Initiative', 'hierarchyLevel': 2, 'subtask': False},
]
# Board: key absent -> Story; [] -> every eligible non-subtask level-zero type;
# names -> those ids (catalog order).
BOARD_ISSUE_TYPE_CASES = [
    # (case id, key_present, configured names, expected ids)
    ('absent', False, None, ('90001',)),
    ('empty', True, [], ('90001', '90002', '90003')),
    ('single', True, ['Task'], ('90002',)),
    ('multiple', True, ['Story', 'Task'], ('90001', '90002')),
]

# --- Story Points normalization oracle -----------------------------------------
# Source values are preserved as-is; the existing parser (parseFloat(x || 0), NaN
# skipped) aggregates them to 11.5 and displays null/''/'n/a' as 0.0.
SP_SOURCE_VALUES = [None, '', 8, '3.5', 'n/a']
SP_EXPECTED_TOTAL = 11.5
SP_EXPECTED_FIXED_DISPLAY = ['0.0', '0.0', '8.0', '3.5', '0.0']


def _story(key, sp, *, status='To Do', epic='OLD-E1', project='OLD', team=('team-a', 'Team A')):
    return {
        'key': key,
        'fields': {
            'customfield_10004': sp,
            'epicKey': epic,
            'projectKey': project,
            'teamId': team[0],
            'teamName': team[1],
            'status': {'name': status},
        },
    }


def sp_tasks():
    """One synthetic Story per SP_SOURCE_VALUES entry."""
    return [_story(f'OLD-{index + 1}', value) for index, value in enumerate(SP_SOURCE_VALUES)]


# Killed is off an Epic's total entirely; Incomplete (and every other status) counts.
KILLED_INCOMPLETE_TASKS = [
    _story('OLD-11', 8, status='Done'),
    _story('OLD-12', 5, status='Killed'),
    _story('OLD-13', 3, status='Incomplete'),
]
KILLED_INCOMPLETE_EXPECTED_EPIC_TOTAL = 11  # 8 + 3, Killed excluded

# --- Paired DELIVERY fixtures (selected vs included/excluded vs Ad Hoc) ----------
PAIR_TECH_PROJECT_KEYS = []  # no Tech project: Legacy lane is Product
PAIR_TEAM = ('team-a', 'Team A')

# Legacy side: one 8-SP Story under OLD-E1. `excluded`/`ad_hoc` list Legacy Epic keys.
LEGACY_PAIRS = {
    'ordinary': {
        'tasks': [_story('OLD-21', 8)],
        'excluded_epics': [], 'ad_hoc_epics': [],
        'expected': {
            'selected_team_total': 8,        # buildSelectedTeamStats(selectedTasksList)
            'included_project_stats': {'PRODUCT': 8},
            'ad_hoc_product_sp': 0,
            'excluded_project_stats': {},
        },
    },
    'ad_hoc': {
        'tasks': [_story('OLD-22', 8)],
        'excluded_epics': [], 'ad_hoc_epics': ['OLD-E1'],
        'expected': {
            'selected_team_total': 8,
            'included_project_stats': {'PRODUCT': 8},
            'ad_hoc_product_sp': 8,
            'excluded_project_stats': {},
        },
    },
    'excluded': {
        'tasks': [_story('OLD-23', 8)],
        'excluded_epics': ['OLD-E1'], 'ad_hoc_epics': [],
        'expected': {
            'selected_team_total': 8,        # overall selection keeps excluded work
            'included_project_stats': {},    # allocation list drops excluded Epics
            'ad_hoc_product_sp': 0,
            'excluded_project_stats': {'PRODUCT': 8},
        },
    },
}

# New-model outcomes from the plan (NOT pinned to code): the Epic is the leaf, the
# Initiative key carries exclusion/Ad Hoc, one unfiltered combined lane.
NEW_MODEL_EXPECTED_PAIRS = {
    'ordinary': {'combined': 8, 'ad_hoc': 0, 'product': 0, 'tech': 0,
                 'selected_team_total': 8, 'included_allocation': 8, 'excluded_report': 0, 'requests': 1},
    'ad_hoc': {'combined': 8, 'ad_hoc': 8, 'product': 0, 'tech': 0,
               'selected_team_total': 8, 'included_allocation': 8, 'excluded_report': 0, 'requests': 1},
    'excluded': {'combined': 0, 'ad_hoc': 0, 'product': 0, 'tech': 0,
                 'selected_team_total': 8, 'included_allocation': 0, 'excluded_report': 8, 'requests': 1},
}
NEW_MODEL_CLASSIFICATION_EXPECTED = {
    'ordinary': {'projectType': 'other', 'capacityType': 'other', 'productSubtype': None},
    'ad_hoc': {'projectType': 'other', 'capacityType': 'ad_hoc', 'productSubtype': None},
}
# Legacy classifyCapacityIssue results for the same situations (PINNED).
LEGACY_CLASSIFICATION_EXPECTED = {
    'ordinary': {'projectType': 'product', 'capacityType': 'product', 'productSubtype': 'standard'},
    'ad_hoc': {'projectType': 'product', 'capacityType': 'ad_hoc', 'productSubtype': 'ad_hoc'},
    'tech': {'projectType': 'tech', 'capacityType': 'tech', 'productSubtype': None},
}

# --- Component Board fixture ----------------------------------------------------
COMPONENT_BOARD_PROJECTS = (('OLD', 'product'),)
# Legacy: Epic with Component A and its existing Stories keeps its current scope.
LEGACY_COMPONENT_BOARD = {
    'epic': {'key': 'OLD-E2', 'components': ['Component A']},
    'stories': [_story('OLD-31', 5, epic='OLD-E2'), _story('OLD-32', 3, epic='OLD-E2')],
    'selected_components': ['Component A'],
    'expected_epic_index_clauses': ['issuetype = Epic', 'component in ("Component A")'],
    'expected_story_points': 8,
}
# New model (NOT pinned): Initiative I has Epic A (8 SP, Component A) and Epic B
# (5 SP, Component B); no Components on I. I appears once with only matching Epics.
NEW_MODEL_COMPONENT_BOARD = {
    'initiative': {'key': 'PLAN-I1', 'components': []},
    'epics': [
        {'key': 'PLAN-E1', 'parent': 'PLAN-I1', 'components': ['Component A'], 'story_points': 8},
        {'key': 'PLAN-E2', 'parent': 'PLAN-I1', 'components': ['Component B'], 'story_points': 5},
    ],
    'expected': {
        ('Component A',): {'initiatives': ['PLAN-I1'], 'epics': ['PLAN-E1'], 'story_points': 8},
        ('Component A', 'Component B'): {
            'initiatives': ['PLAN-I1'], 'epics': ['PLAN-E1', 'PLAN-E2'], 'story_points': 13},
    },
    'modes': ('component', 'all_work'),
}
