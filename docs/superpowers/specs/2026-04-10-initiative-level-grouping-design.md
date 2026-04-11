# Initiative-Level Grouping in Task List

**Date:** 2026-04-10
**Status:** Approved

## Problem

The task list groups stories under epics, but there is no visibility into the next level up — Initiatives. When a user is catching up across multiple epics that belong to the same initiative, there is no visual cue connecting them. The user wants a subtle aggregation layer that groups epics by initiative without overloading the UI.

## Jira Hierarchy Context

```
Objective
  Initiative          <-- NEW: surface this level
    Epic
      Story
```

In the user's Jira instance, the Initiative is the `parent` field of the Epic (next-gen / team-managed project hierarchy). No custom fields needed.

## Design

### 1. Data Fetching (Backend — jira_server.py)

**Constraint:** No more than 10% network response degradation from current benchmark.

**Approach:** Zero additional API calls. Add `parent` to the fields list in the existing `fetch_epic_details_bulk()` function. When an epic's parent exists and its issue type is "Initiative" (or `hierarchyLevel == 0`), include the initiative metadata in the response.

**Response shape change** — each epic in the `epics` dict gains an optional `initiative` field:

```json
{
  "PROD-456": {
    "key": "PROD-456",
    "summary": "Payment Gateway v2",
    "reporter": "Jane Smith",
    "assignee": { "displayName": "Jane Smith" },
    "initiative": {
      "key": "INIT-42",
      "summary": "Payments Initiative"
    }
  }
}
```

Adds ~50 bytes per epic that has an initiative parent. Epics without an initiative parent omit the field entirely.

**Detection logic:** When processing each epic from `fetch_epic_details_bulk()`, check:
- `fields.parent` exists
- `fields.parent.fields.issuetype.name` is "Initiative" (case-insensitive) OR `fields.parent.fields.issuetype.hierarchyLevel == 0`
- If match: set `initiative = { key: parent.key, summary: parent.fields.summary }`

### 2. Frontend Grouping Logic (dashboard.jsx)

New function `groupEpicsByInitiative(epicGroups, epicsData)`:

- Input: the existing array of `epicGroup` objects from `groupTasksByEpic()`, plus the `epics` dict from the API response.
- For each epicGroup, look up `epicsData[epicGroup.key]?.initiative`.
- Cluster epicGroups by `initiative.key`. Preserve original epic ordering within each initiative.
- Epics with no initiative parent go into a `NO_INITIATIVE` bucket.
- Output: array of `{ initiative: { key, summary } | null, epicGroups: [...] }`.

This function is only called when `groupByInitiative` state is `true`. When `false`, the existing `epicGroups` array is used directly (current behavior, no change).

### 3. Visual Rendering — Approach B: Subtle Top Banner + Left Accent

#### Multi-epic initiative (2+ epics in the group)

```
  PAYMENTS INITIATIVE  INIT-42 ->  ─────────────
  |  [ Epic: Payment Gateway v2       PROD-456 ]
  |    - Story 1
  |    - Story 2
  |  [ Epic: Billing Dashboard        PROD-789 ]
  |    - Story 3
  |    - Story 4
```

- **Label row:** Small caps initiative name, monospace key link (clickable, opens Jira), fading gradient line extending right.
- **Left accent:** 2px solid border in muted purple (`#c4b5fd`) connecting all epic blocks in the group.
- **Indent:** Epic blocks shift right by ~14px (the accent width + padding).

CSS class: `.initiative-group` wrapping all epic blocks for that initiative.

#### Single-epic initiative (1 epic in the group)

```
  ONBOARDING REVAMP  INIT-55 ->  ─────────────
  [ Epic: Welcome Flow Redesign       PROD-321 ]
    - Story 1
    - Story 2
```

- Just the label row as a subtitle above the epic header. No left accent border (unnecessary visual weight for a single epic).

CSS class: `.initiative-label-only` on the label when single-epic.

#### No-initiative epics

Rendered exactly as today — no initiative decoration at all.

### 4. Toggle Control

**Location:** In the existing toggle bar (`.toggle-container`) alongside "Hide Tech Tasks", "Show Product Tasks", etc. Separated from the hide/show toggles by a thin 1px vertical divider.

**State variable:** `groupByInitiative` (boolean, React useState).

**Default value:** `true` when at least one epic in the response has an `initiative` field; `false` otherwise. Determined after data is loaded.

**Active state (ON):**
- Background: `#f5f3ff` (light purple tint)
- Border: `1px solid #c4b5fd`
- Text color: `#7c3aed`
- Font weight: 500
- Small hierarchy SVG icon before "Initiatives" label

**Inactive state (OFF):**
- Background: `#fff`
- Border: `1px solid var(--border)`
- Text color: `#94a3b8`
- Same hierarchy icon, muted

**Label:** "Initiatives" (with icon).

### 5. What Does NOT Change

- All existing epic rendering (headers, sticky behavior, dependency focus, story items)
- Toggle OFF = exactly the current view, zero visual difference
- No changes to JQL construction, pagination, or any other API endpoints
- Catch Up, Planning, Scenario, and Statistics panels are unaffected
- No new API endpoints
- `epicsInScope` response is unaffected

### 6. CSS Additions

New classes in `frontend/dist/dashboard.css`:

- `.initiative-group` — container with left border accent and left padding
- `.initiative-label` — the small caps initiative name + key row
- `.initiative-label a` — clickable key link to Jira
- `.initiative-label-only` — variant for single-epic initiatives (no left border)
- `.initiative-divider` — the fading gradient line
- `.initiative-toggle` — toggle button active/inactive states
- `.initiative-toggle-separator` — the vertical divider before the toggle

Color palette: muted purples (`#7c3aed`, `#c4b5fd`, `#f5f3ff`, `#ede9fe`) for initiative accent. Gray (`#64748b`, `#94a3b8`) for single-epic subtitles and inactive toggle.

### 7. Performance Budget

| Metric | Impact |
|--------|--------|
| New Jira API calls | 0 |
| Additional fields per epic request | +1 (`parent`) |
| Extra bytes per epic in response | ~50 bytes (initiative key + summary) |
| Frontend compute | One array grouping pass, O(n) where n = number of epics |
| DOM changes | Wrapper divs + label rows; no extra re-renders when toggle is off |

Well within the 10% network degradation constraint.
