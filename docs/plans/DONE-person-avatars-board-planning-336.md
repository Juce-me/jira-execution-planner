> **Status:** Done (2026-11-11). Executed on branch `feature/336-user-avatars-board-planning`. Issue [#336](https://github.com/Juce-me/jira-execution-planner/issues/336). Kept for audit context only.

# Avatars on Board and Planning

## Problem

#324 put profile photos in the existing person-glyph slot of ENG rows and the EPM surfaces, and left the Board and the Planning Table text-only because they had no slot. #336 asks for the mark beside Assignee and Delivery owner on the Board and beside Assignee in Planning, plus a Delivery Owner column in the Planning Table.

## Decisions (operator, 2026-11-11)

- Scope is the issue only: Board Epic card and panel, Planning Table. Alerts, Stats, Scenario and EPM tree rows stay text.
- Delivery Owner enters Planning only as an optional Epic-row Table column (read-only, hidden by default like Component and Project Track); Catch Up and Planning Epic metadata stay unchanged. The AGENTS.md learning names this one exception.
- #324's rules hold: Atlassian-hosted photos only, so people with Gravatar-hosted avatars keep the glyph; no new request.

## Design

- `ui/PersonAvatar.jsx` gains `PersonAvatarSlot`: the shared `task-assignee-icon` box with the photo or the same glyph the ENG rows use. No new class hook; one `board.css` rule sizes it to 12px inside `.eng-board .eperson`, and `.planning-review-person` lays out the table cells.
- Board: `EngBoardEpicCard` and `EngBoardEpicPanel` place the slot between each label and its editor. Board `_person` already ships `avatarUrl`; `PersonAvatar` re-checks the host list.
- Planning: Assignee cell gets the slot; new native column `deliveryOwner` (Epic rows; Story rows show an em dash). `sprint_review.py` layout builtins accept `deliveryOwner` in every set, because the table posts its default hidden list for both row kinds.
- Backend: the Epic-detail `deliveryOwner` uses `shape_jira_person(..., avatar=True)`; `TASKS_CACHE_SCHEMA_VERSION` bumped to `v5-delivery-owner-avatars`.

## Outcome

Implemented as planned. Verification: frontend unit 3712 of 3712; Python `test_sprint_review`, `test_work_structure_reviews`, `test_avatar_urls`, `test_person_avatar_payloads`, `test_codebase_structure_budgets`, `test_agents_md_learnings`, `test_dashboard_css_extraction` pass; Chromium `eng_group_board_card`, `eng_group_board_panel`, `planning_review_table` and `person_avatars` specs pass after two spec edits (Epics optional list includes Delivery Owner; the 2400px wide-display check moved to 2560px because the Assignee mark widens a table that sat 18px under the cap).

Not verified: headed Firefox and WebKit at 2x, the full Chromium `tests/ui` run, a photo (not glyph) rendering on the Board and in Planning cells (the new specs assert the glyph fallback and geometry; the photo path is the shared `PersonAvatar`), and a live Jira payload for the Delivery Owner field.

## Current Accuracy

Accurate.
