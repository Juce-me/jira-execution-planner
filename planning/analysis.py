from collections import defaultdict, deque
from datetime import date
from typing import Dict, List, Tuple

from .models import ScheduledIssue


def build_successors(dependencies: Dict[str, List[str]]) -> Dict[str, List[str]]:
    successors = defaultdict(list)
    for issue, deps in dependencies.items():
        for dep in deps:
            successors[dep].append(issue)
    return successors


def compute_slack(
    scheduled: Dict[str, ScheduledIssue],
    dependencies: Dict[str, List[str]],
    quarter_end_date: date,
) -> Tuple[Dict[str, float], List[str]]:
    if not scheduled:
        return {}, []

    quarter_weeks = max(
        1.0,
        (quarter_end_date - min(issue.start_date for issue in scheduled.values() if issue.start_date)).days / 7.0
    )
    successors = build_successors(dependencies)

    indegree = {key: 0 for key in scheduled}
    for issue, deps in dependencies.items():
        for dep in deps:
            if issue in scheduled and dep in scheduled:
                indegree[issue] += 1

    queue = deque([k for k, v in indegree.items() if v == 0])
    topo = []
    while queue:
        node = queue.popleft()
        topo.append(node)
        for nxt in successors.get(node, []):
            if nxt in indegree:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)

    latest_start = {key: quarter_weeks for key in scheduled}
    for key in reversed(topo):
        issue = scheduled[key]
        duration = issue.duration_weeks or 0.0
        successor_starts = [latest_start[s] for s in successors.get(key, []) if s in scheduled]
        latest_finish = min(successor_starts) if successor_starts else quarter_weeks
        latest_start[key] = latest_finish - duration

    slack = {}
    critical = []
    for key, issue in scheduled.items():
        if issue.start_date is None:
            continue
        start_week = (issue.start_date - min(i.start_date for i in scheduled.values() if i.start_date)).days / 7.0
        slack_weeks = latest_start[key] - start_week
        slack[key] = slack_weeks
        if slack_weeks <= 0.01:
            critical.append(key)

    return slack, critical
