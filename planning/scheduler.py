from collections import defaultdict, deque
import heapq
from datetime import timedelta
from typing import Dict, List, Tuple

from .capacity import build_lane_capacities
from .models import Issue, ScheduledIssue, ScenarioConfig


PRIORITY_ORDER = {
    "blocker": 0,
    "highest": 0,
    "critical": 1,
    "high": 2,
    "major": 3,
    "medium": 3,
    "minor": 4,
    "low": 5,
    "trivial": 6,
    "lowest": 6,
}


def priority_rank(priority: str) -> int:
    if not priority:
        return 999
    return PRIORITY_ORDER.get(priority.lower(), 999)


def compute_duration_weeks(sp, sp_to_weeks, capacity_factor):
    if sp is None:
        return None
    base = max(0.0, float(sp)) * sp_to_weeks
    if base == 0:
        return 0.0
    return base / max(0.1, capacity_factor)


def topo_sort(issues: Dict[str, Issue], dependencies: Dict[str, List[str]]) -> List[str]:
    indegree = {key: 0 for key in issues}
    forward = defaultdict(list)
    for issue_key, deps in dependencies.items():
        for dep in deps:
            if dep not in issues:
                continue
            forward[dep].append(issue_key)
            indegree[issue_key] = indegree.get(issue_key, 0) + 1

    queue = []
    for key, count in indegree.items():
        if count == 0:
            issue = issues.get(key)
            heapq.heappush(
                queue,
                (priority_rank(issue.priority if issue else None), -(issue.story_points or 0.0), key),
            )
    order = []
    while queue:
        _, _, current = heapq.heappop(queue)
        order.append(current)
        for nxt in forward.get(current, []):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                issue = issues.get(nxt)
                heapq.heappush(
                    queue,
                    (priority_rank(issue.priority if issue else None), -(issue.story_points or 0.0), nxt),
                )
    return order


def schedule_issues(
    issues: List[Issue],
    dependencies: Dict[str, List[str]],
    config: ScenarioConfig,
) -> Tuple[List[ScheduledIssue], Dict[str, ScheduledIssue]]:
    issue_map = {issue.key: issue for issue in issues}
    total_weeks = max(1.0, (config.quarter_end_date - config.start_date).days / 7.0)

    lanes = []
    for issue in issues:
        if config.lane_mode == "assignee":
            lane = issue.assignee or issue.team or "Unassigned"
        else:
            lane = issue.team or "Unassigned"
        lanes.append(lane)
    lane_list = sorted(set(lanes))

    capacities = build_lane_capacities(
        lane_list,
        config.team_sizes,
        config.lane_mode,
        config.wip_limit,
        total_weeks,
        config.vacation_weeks,
        config.sickleave_buffer,
    )

    scheduled = {}
    unschedulable = {}

    for issue in issues:
        if not issue.story_points:
            unschedulable[issue.key] = ScheduledIssue(
                key=issue.key,
                summary=issue.summary,
                lane=issue.team or "Unassigned",
                start_date=None,
                end_date=None,
                blocked_by=dependencies.get(issue.key, []),
                scheduled_reason="missing_story_points",
            )

    for issue in issues:
        status = (issue.status or "").lower()
        if status in ("done", "killed"):
            scheduled[issue.key] = ScheduledIssue(
                key=issue.key,
                summary=issue.summary,
                lane=issue.team or "Unassigned",
                start_date=config.start_date,
                end_date=config.start_date,
                blocked_by=dependencies.get(issue.key, []),
                scheduled_reason="already_done",
                duration_weeks=0.0,
            )

    dependency_keys = {
        key: [dep for dep in deps if dep in issue_map]
        for key, deps in dependencies.items()
    }
    missing_dependency = {
        key: [dep for dep in deps if dep not in issue_map]
        for key, deps in dependencies.items()
    }

    order = topo_sort(issue_map, dependency_keys)
    for key in order:
        issue = issue_map[key]
        if key in scheduled or key in unschedulable:
            continue
        if missing_dependency.get(key):
            unschedulable[key] = ScheduledIssue(
                key=issue.key,
                summary=issue.summary,
                lane=issue.team or "Unassigned",
                start_date=None,
                end_date=None,
                blocked_by=dependencies.get(issue.key, []),
                scheduled_reason="missing_dependency",
            )
            continue

        lane = issue.team or "Unassigned"
        if config.lane_mode == "assignee":
            lane = issue.assignee or issue.team or "Unassigned"
        lane_capacity = capacities[lane]
        dep_end = 0.0
        for dep in dependency_keys.get(key, []):
            dep_issue = scheduled.get(dep)
            if dep_issue and dep_issue.duration_weeks is not None:
                dep_end = max(dep_end, dep_issue.duration_weeks + (dep_issue.start_date - config.start_date).days / 7.0)

        duration_weeks = compute_duration_weeks(
            issue.story_points,
            config.sp_to_weeks,
            lane_capacity.capacity_factor,
        )
        if duration_weeks is None:
            unschedulable[key] = ScheduledIssue(
                key=issue.key,
                summary=issue.summary,
                lane=lane,
                start_date=None,
                end_date=None,
                blocked_by=dependencies.get(issue.key, []),
                scheduled_reason="missing_story_points",
            )
            continue

        slot_index = min(range(len(lane_capacity.available_at)), key=lambda i: lane_capacity.available_at[i])
        slot_ready = lane_capacity.available_at[slot_index]
        start_week = max(dep_end, slot_ready)
        end_week = start_week + duration_weeks
        lane_capacity.available_at[slot_index] = end_week

        start_date = config.start_date + timedelta(weeks=start_week)
        end_date = config.start_date + timedelta(weeks=end_week)
        scheduled[key] = ScheduledIssue(
            key=issue.key,
            summary=issue.summary,
            lane=lane,
            start_date=start_date,
            end_date=end_date,
            blocked_by=dependencies.get(issue.key, []),
            scheduled_reason="scheduled",
            duration_weeks=duration_weeks,
        )

    all_results = {**scheduled, **unschedulable}
    return list(all_results.values()), scheduled
