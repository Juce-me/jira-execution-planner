"""Statistics API route registrations."""

from flask import Blueprint

from . import get_jira_server


bp = Blueprint("stats_routes", __name__)


@bp.route('/api/stats/excluded-capacity-source', methods=['POST'])
def get_excluded_capacity_stats_source():
    return get_jira_server().get_excluded_capacity_stats_source()


@bp.route('/api/stats', methods=['GET'])
def get_completed_sprint_stats():
    return get_jira_server().get_completed_sprint_stats()


@bp.route('/api/stats/burnout', methods=['GET', 'POST'])
def get_burnout_stats():
    return get_jira_server().get_burnout_stats()


@bp.route('/api/stats/epic-cohort', methods=['POST'])
def get_epic_cohort_stats():
    return get_jira_server().get_epic_cohort_stats()


@bp.route('/api/stats/project-track-phase-durations', methods=['POST'])
def get_project_track_phase_durations():
    return get_jira_server().get_project_track_phase_durations()
