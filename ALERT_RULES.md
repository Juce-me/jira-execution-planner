# Alert Rules

This doc describes the dashboard alert panels and the rules that trigger them. It’s meant to be a living spec so the logic can be reviewed and adjusted without guessing.

## General

- Alerts operate on the currently loaded sprint data (Product and Tech).
- Alerts never include items with excluded statuses (`Killed`, `Done`) unless explicitly stated otherwise.
- Postponed items are shown in the Postponed Work panel.
- Each panel can be collapsed; collapse state is remembered in the browser.

## 📄 Missing Story Points

**Shows:** Stories that need a story point estimate.

**Rule:**
- Story status is **not** `Killed`, `Done`, or `Postponed`
- Story points field is missing, empty, or `0`

## ⛔️ Blocked

**Shows:** Stories that look blocked.

**Rule:**
- Story status contains `blocked` (case-insensitive, normalized)
- Story status is **not** `Killed`, `Postponed`, or `Done`

## 🧩 Missing Epic

**Shows:** Stories that have no parent epic.

**Rule:**
- Story status is **not** `Killed`, `Postponed`, or `Done`
- Story has no `epicKey` (no Epic Link / no parent epic detected)

## 🧺 Empty Epic

**Shows:** Epics that look empty for the selected sprint after excluding postponed/future-routed cases.

**Rule:**
- Epic status is **not** in the excluded set (configured via `EPIC_EMPTY_EXCLUDED_STATUSES`)
- Epic team is scoped by `EPIC_EMPTY_TEAM_IDS` (Team[Team] values); if unset, the backend may return broader results depending on `JQL_QUERY`
- Epic has `totalStories === 0` (legacy field name; backend count now treats Jira child work items as children, not only exact `Story` issue type)
- Epic has **no actionable child work items in the selected sprint**:
  - backend `selectedActionableStories === 0`
  - actionable excludes child statuses `Blocked`, `Done`, `Killed`, `Incomplete`
- Frontend fallback suppression also removes epics when loaded task data shows an actionable child in the selected sprint (to reduce false positives if count fields lag)
- Epic is **not** routed to postponed-work condition:
  - `selectedStories === 0`
  - `futureOpenStories > 0`

**Important:** `Show Only` stat tiles (`Done`, `In Progress`, priority filters, etc.) must not change Empty Epic membership. They only filter the visible task list.

**Implementation detail:** The backend counts child work items via Epic Link with a fallback to parent-based epic linkage for Jira setups where Epic Link is not present on child issues.

## ✅ Epic Ready to Close

**Shows:** Epics where all stories under the epic (no sprint filter) are `Done`, `Killed`, or `Incomplete`, but the epic itself is still open.

**Rule:**
- Epic status is **not** `Killed`, `Done`, or `Incomplete`
- Epic has at least one story in the loaded all-time data (no sprint filter)
- Every story under that epic in the loaded all-time data is `Done`, `Killed`, or `Incomplete`

## ⏭️ Postponed Work

**Shows:** Work that should move to a future sprint.

**Rules:**
- **Postponed stories:** Any story with status `Postponed`, regardless of story points (team filter applies).
- **Future-routed empty epics:** Epics with `totalStories === 0`, `selectedStories === 0`, and `futureOpenStories > 0` are shown here instead of `🧺 Empty Epic` with guidance to move the epic sprint. (`selectedStories` / `futureOpenStories` are legacy field names; counts are based on non-Epic child work items.)
- **Analysis epics:** Epics with status `Analysis` are shown when the **first future sprint** is selected, with a note: “waiting for description to create stories” (epic sprint value is ignored).
- **No separate R&D waiting panel:** The dedicated `Waiting for R&D Stories` alert was removed to avoid overlap with other epic alerts (notably `🧺 Empty Epic`).
