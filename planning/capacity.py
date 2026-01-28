from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class LaneCapacity:
    lane: str
    slot_count: int
    capacity_factor: float
    available_at: List[float] = field(default_factory=list)
    assignee_slots: Dict[str, int] = field(default_factory=dict)  # assignee -> slot_index
    assignee_available_at: Dict[str, float] = field(default_factory=dict)  # assignee -> end_week


def build_lane_capacities(
    lanes: List[str],
    team_sizes: Dict[str, int],
    lane_mode: str,
    wip_limit: int,
    total_weeks: float,
    vacation_weeks: Dict[str, float],
    sickleave_buffer: float,
):
    capacities = {}
    effective_wip_limit = 1 if lane_mode == "assignee" else wip_limit
    for lane in lanes:
        size = team_sizes.get(lane, 1)
        if lane_mode == "assignee":
            size = 1
        slot_count = max(1, int(size * max(1, effective_wip_limit)))
        vacation = max(0.0, vacation_weeks.get(lane, 0.0))
        effective_weeks = max(0.1, total_weeks - vacation)
        capacity_factor = max(0.1, effective_weeks / max(0.1, total_weeks))
        capacity_factor *= max(0.1, 1.0 - sickleave_buffer)
        capacities[lane] = LaneCapacity(
            lane=lane,
            slot_count=slot_count,
            capacity_factor=capacity_factor,
            available_at=[0.0 for _ in range(slot_count)],
        )
    return capacities
