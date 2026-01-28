from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional


@dataclass
class Issue:
    key: str
    summary: str
    issue_type: str
    team: Optional[str]
    assignee: Optional[str]
    story_points: Optional[float]
    priority: Optional[str]
    status: Optional[str]
    epic_key: Optional[str] = None
    team_id: Optional[str] = None


@dataclass
class Dependency:
    issue_key: str
    depends_on_key: str


@dataclass
class ScenarioConfig:
    start_date: date
    quarter_end_date: date
    sp_to_weeks: float = 2.0
    team_sizes: Dict[str, int] = field(default_factory=dict)
    vacation_weeks: Dict[str, float] = field(default_factory=dict)
    sickleave_buffer: float = 0.1
    wip_limit: int = 1
    lane_mode: str = "team"  # "team" or "assignee"


@dataclass
class ScheduledIssue:
    key: str
    summary: str
    lane: str
    start_date: Optional[date]
    end_date: Optional[date]
    blocked_by: List[str]
    scheduled_reason: str
    duration_weeks: Optional[float] = None
    slack_weeks: Optional[float] = None
    is_critical: bool = False
    is_late: bool = False
    assignee: Optional[str] = None
    progress_pct: Optional[float] = None


@dataclass
class ScheduleResult:
    issues: List[ScheduledIssue]
    critical_path: List[str]
    bottleneck_lanes: List[str]
    late_items: List[str]
    unschedulable: List[str]
