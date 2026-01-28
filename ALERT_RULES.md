# Alert Rules

This doc describes the dashboard alert panels and the rules that trigger them. It’s meant to be a living spec so the logic can be reviewed and adjusted without guessing.

## General

- Alerts operate on the currently loaded sprint data (Product and Tech).
- Alerts never include items with excluded statuses (`Killed`, `Postponed`, `Done`) unless explicitly stated otherwise.
- Each panel can be collapsed; collapse state is remembered in the browser.

## 📄 Missing Story Points

**Shows:** Stories that need a story point estimate.

**Rule:**
- Story status is **not** `Killed`, `Postponed`, or `Done`
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

**Shows:** Epics that have **zero stories** in Jira.

**Rule:**
- Epic status is **not** in the excluded set (configured via `EPIC_EMPTY_EXCLUDED_STATUSES`)
- Epic team is scoped by `EPIC_EMPTY_TEAM_IDS` (Team[Team] values); if unset, the backend may return broader results depending on `JQL_QUERY`
- Epic has `totalStories === 0` (computed by the backend by counting stories linked to that epic)

**Implementation detail:** The backend counts stories via Epic Link with a fallback to parent-based epic linkage for Jira setups where Epic Link is not present on stories.

## ✅ Epic Ready to Close

**Shows:** Epics where all stories under the epic (no sprint filter) are `Done`, `Killed`, or `Incomplete`, but the epic itself is still open.

**Rule:**
- Epic status is **not** `Killed`, `Done`, or `Incomplete`
- Epic has at least one story in the loaded all-time data (no sprint filter)
- Every story under that epic in the loaded all-time data is `Done`, `Killed`, or `Incomplete`
