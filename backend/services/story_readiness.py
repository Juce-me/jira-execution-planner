"""Pure projection for complete ENG Story-readiness snapshots."""

from __future__ import annotations


class InvalidCompleteReadinessInput(ValueError):
    """Raised when exhaustive I/O did not produce a complete projection input."""


_NON_ACTIONABLE_STORY_STATUSES = frozenset({
    "blocked", "done", "killed", "incomplete",
})
_TERMINAL_EPIC_STATUSES = frozenset({
    "done", "killed", "incomplete", "postponed",
})
_PROJECT_CLASSES = frozenset({"product", "tech"})


def _text(value, *, required=False):
    result = str(value or "").strip() if isinstance(value, (str, int)) else ""
    if required and not result:
        raise InvalidCompleteReadinessInput("missing_required_text")
    return result


def _named_value(value, *, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, dict):
        raise InvalidCompleteReadinessInput("invalid_named_value")
    name = _text(value.get("name"), required=required)
    return {"name": name} if name else None


def _initiative(value):
    if not isinstance(value, dict):
        return None
    key = _text(value.get("key"))
    summary = _text(value.get("summary"))
    return {"key": key, "summary": summary} if key and summary else None


def _string_list(value, field):
    if not isinstance(value, list):
        raise InvalidCompleteReadinessInput(f"invalid_{field}")
    normalized = []
    seen = set()
    for item in value:
        item = _text(item, required=True)
        if item not in seen:
            normalized.append(item)
            seen.add(item)
    return normalized


def _normalize_input(payload):
    if not isinstance(payload, dict) or payload.get("status") != "complete":
        raise InvalidCompleteReadinessInput("input_not_complete")
    sprint = payload.get("canonicalSprint")
    group = payload.get("groupSnapshot")
    access = payload.get("projectAccessSnapshot")
    epics = payload.get("epics")
    children = payload.get("children")
    if not isinstance(sprint, dict) or not isinstance(group, dict):
        raise InvalidCompleteReadinessInput("invalid_scope")
    if not isinstance(access, dict) or not isinstance(epics, list) or not isinstance(children, list):
        raise InvalidCompleteReadinessInput("invalid_complete_collections")
    if access.get("product") != "accessible" or access.get("tech") != "accessible":
        raise InvalidCompleteReadinessInput("project_access_incomplete")

    sprint_id = _text(sprint.get("id"), required=True)
    sprint_name = _text(sprint.get("name"), required=True)
    sprint_state = _text(sprint.get("state"), required=True).lower()
    if sprint_state not in {"active", "future"}:
        raise InvalidCompleteReadinessInput("invalid_sprint_state")
    group_id = _text(group.get("id"), required=True)
    revision = group.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise InvalidCompleteReadinessInput("invalid_group_revision")
    raw_teams = group.get("teams")
    if not isinstance(raw_teams, list):
        raise InvalidCompleteReadinessInput("invalid_group_teams")
    teams = []
    team_ids = set()
    labels = set()
    for raw in raw_teams:
        if not isinstance(raw, dict):
            raise InvalidCompleteReadinessInput("invalid_group_team")
        team = {
            "id": _text(raw.get("id"), required=True),
            "name": _text(raw.get("name"), required=True),
            "label": _text(raw.get("label"), required=True),
        }
        if team["id"] in team_ids or team["label"] in labels:
            raise InvalidCompleteReadinessInput("duplicate_group_team")
        team_ids.add(team["id"])
        labels.add(team["label"])
        teams.append(team)
    if not teams:
        raise InvalidCompleteReadinessInput("empty_group_teams")
    return sprint_id, sprint_name, sprint_state, group_id, revision, teams, epics, children


def project_story_readiness(payload):
    """Project a validated exhaustive input into the public readiness response."""
    (sprint_id, sprint_name, sprint_state, group_id, revision, teams,
     raw_epics, raw_children) = _normalize_input(payload)

    epics = {}
    for raw in raw_epics:
        if not isinstance(raw, dict):
            raise InvalidCompleteReadinessInput("invalid_epic")
        project_class = _text(raw.get("projectClass"), required=True).lower()
        if project_class not in _PROJECT_CLASSES:
            raise InvalidCompleteReadinessInput("invalid_project_class")
        epic = {
            "key": _text(raw.get("key"), required=True),
            "summary": _text(raw.get("summary"), required=True),
            "status": _named_value(raw.get("status"), required=True),
            "priority": _named_value(raw.get("priority")),
            "assignee": raw.get("assignee") if isinstance(raw.get("assignee"), dict) else None,
            "labels": _string_list(raw.get("labels"), "epic_labels"),
            "projectTrack": _text(raw.get("projectTrack")),
            "projectKey": _text(raw.get("projectKey"), required=True),
            "projectClass": project_class,
            "initiative": _initiative(raw.get("initiative")),
        }
        existing = epics.get(epic["key"])
        if existing is not None and existing != epic:
            raise InvalidCompleteReadinessInput("conflicting_duplicate_epic")
        epics[epic["key"]] = epic

    children_by_epic = {key: [] for key in epics}
    child_keys = set()
    for raw in raw_children:
        if not isinstance(raw, dict):
            raise InvalidCompleteReadinessInput("invalid_child")
        key = _text(raw.get("key"), required=True)
        epic_key = _text(raw.get("epicKey"), required=True)
        if key in child_keys or epic_key not in epics:
            raise InvalidCompleteReadinessInput("invalid_child_identity")
        child_keys.add(key)
        children_by_epic[epic_key].append({
            "status": _text(raw.get("statusName"), required=True).lower(),
            "sprintIds": set(_string_list(raw.get("sprintIds"), "child_sprints")),
            "teamIds": set(_string_list(raw.get("teamIds"), "child_teams")),
        })

    projected = []
    for epic_key in sorted(epics):
        epic = epics[epic_key]
        if epic["status"]["name"].strip().lower() in _TERMINAL_EPIC_STATUSES:
            continue
        expected = [team for team in teams if team["label"] in set(epic["labels"])]
        children = children_by_epic[epic_key]
        missing = []
        for team in expected:
            team_children = [child for child in children if team["id"] in child["teamIds"]]
            selected = [child for child in team_children if sprint_id in child["sprintIds"]]
            actionable = [
                child for child in selected
                if child["status"] not in _NON_ACTIONABLE_STORY_STATUSES
            ]
            if actionable:
                continue
            if not children:
                reason = "no_stories"
            elif selected:
                reason = "selected_stories_not_actionable"
            elif team_children:
                reason = "stories_outside_sprint"
            else:
                reason = "team_uncovered"
            missing.append({"id": team["id"], "name": team["name"], "reason": reason})
        if not missing:
            continue
        projected.append({
            key: value for key, value in epic.items() if key != "labels"
        } | {
            "sprint": {"id": sprint_id, "name": sprint_name},
            "missingTeams": missing,
        })

    return {
        "schemaVersion": 1,
        "scope": {
            "groupId": group_id,
            "groupRevision": revision,
            "sprintId": sprint_id,
            "sprintName": sprint_name,
            "sprintState": sprint_state,
        },
        "complete": True,
        "epics": projected,
    }
