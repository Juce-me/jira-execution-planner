# ENG Workflows

This guide covers the operational path from choosing a Department through planning, Board work, search, and the Jira handoff. The first-run Department workflow is available on desktop and mobile. The dashboard coachmark tour is desktop only; mobile tour work is deferred in GitHub issue #151.

## Choose or add a Department

First run begins with a personal Department choice:

- With zero through three Departments, the picker shows the list without search. At four or more, search is available.
- If an eligible existing Department matches your work, select it and choose **Continue**. An eligible Department has at least one configured Team or Jira Component, so this path does not open configuration.
- **Add Department** is always available. Choose **Create clean Department** for a new draft, or **Duplicate existing Department** and name the source explicitly.
- A duplicate copies the full Department. Teams, mapped team labels, and Components are preserved by default. **Remove existing teams** removes only teams and their team-label mappings; **Remove existing components** removes only Components. Other Department settings remain in the draft.
- If an existing Department has neither a configured Team nor Jira Component, use **Configure and use {Department}** to repair it explicitly.

A clean draft, duplicate, or explicitly repaired Department becomes the pending private favorite and is added to the visible Department set. Complete the real Settings guide and choose **Save and continue**. A successful save continues directly to the dashboard; it does not send you back to the picker.

## Configure the Department

The guide uses Settings → Departments → Team Groups rather than a second, simplified form.

1. Edit the Department name in the left Department list. There is no second name field in the right editor. On compact or mobile layouts, open the **Groups** drawer to reach the list.
2. Add at least one Team or Jira Component. Either scope makes the Department eligible to complete first run; Teams determine the Department's main Jira scope.
3. Add Jira Components if they are useful, or choose **Continue without components** when a Team already provides the required scope. Component is a Jira issue field, commonly set at Epic level. Components broaden the **Missing Information** and **Lead Times** queries through configured-Team **or** Component matching. In Board, the cross-sprint **Component** choice shows only Epics with an exact Component match, while **All work** unions those Epics with Team-derived parents. Component matching is never applied to Stories and does not make Stories appear in the main Product/Tech hierarchy.
4. Review the filled favorite star. It is your one private startup Department, not a shared workspace default.
5. Keep **Show in Department selector** enabled for Departments you want in your controls. Your favorite is always visible.

The Settings header keeps **Run onboarding again** at the right across tabs. It is unavailable while Settings has unsaved changes or is saving.

Outside first run, commit Settings changes with the footer **Save** button. First-run configuration uses **Save and continue**. The Settings confirmation dialog is for discarding unsaved changes; a normal successful save does not require a confirmation checkmark.

## Make expected Epics and Stories visible

At least one configured Team or Jira Component is required for first-run eligibility. After that, Jira work can enter the UI through three distinct shipped discovery paths:

1. **Main Initiative/Epic/Story hierarchy:** a Story in the selected sprint whose Jira Team matches a configured Department Team is included, and its parent Epic is brought into the hierarchy.
2. **Epic-only and empty-Epic discovery:** the Epic must match either its Jira Team or the Department's exact mapped team label (any one of that Team's configured aliases), and it must match either its Jira Sprint value, the exact selected-sprint-name label, or that label's `_candidate` form. The suffix comparison ignores case but requires the whole label.
3. **Future sprint ready path:** the Epic requires both the configured mapped Team label and either the exact selected-sprint-name label or its `_candidate` form. One does not replace the other.

Configured Jira Components broaden Missing Information and Lead Times through configured-Team or Component matching. They also define Board's cross-sprint **Component** choice and the Component-owned half of **All work**, at the Epic boundary only. They never make Stories appear in the main Product/Tech list.

If expected work is missing, check in this order:

1. Confirm the active Department and selected sprint.
2. Clear search, facet filters, and the Product/Tech display filters.
3. Verify the Jira Story Team and sprint.
4. For Epic-only discovery, verify the Epic Team or one of the exact team-label aliases, then verify the Epic sprint or either accepted whole sprint label.
5. Save the Department configuration.
6. Choose **Refresh** to load the Jira scope again.

### Team labels (aliases)

Each Team in a Department's **Group labels** tab (**Team labels** pane) may have one to three Jira Epic-label aliases instead of a single label. Any of a Team's configured aliases discovers and classifies the same Epics — this lets an old label stay in place while a new one is adopted, without losing history. Order is preserved for display and export but does not affect matching, and an Epic carrying more than one of a Team's aliases still counts as one match for that Team (one alert group, one Story requirement).

The Team labels pane reads: "Map up to three Jira Epic labels per Team; any of them matches the Team. Use labels only this Team applies." That last sentence is the only guard against a broad alias — a label another Team also uses pulls that Team's Epics into this Team's alerts too; there is no automated usage checker.

The Jira Team field remains the existing OR alternative to label matching; aliases widen the label side of that match, they do not replace Jira Team-field matching. Saved aliases are resolved server-side (through the same effective-groups lookup Story readiness uses) before the task-request cache key is built, so a Team's saved aliases changing takes effect on the next task request even when the browser's query string is unchanged.

**Rollback note.** The shared group-configuration payload moved from version 1 (one label per Team) to version 2 (one to three label aliases per Team) as part of this change. The release is forward-only: code from before this change would read a saved alias array with `str(...)` and persist a literal value such as `"['a', 'b']"` on its next save. Before deploying, snapshot the `workspace_group_configs` rows (DB/OAuth) or the `teamGroups` section of `dashboard-config.json` (Basic mode). Rolling back means restoring that snapshot and then redeploying the previous release — never run the previous release against version-2 group data. After deploy, reload every open dashboard tab before editing Department labels, because a stale pre-deploy tab still normalizes a version-2 alias array with `String(...)` and would persist it as a joined legacy scalar on its next save.

## Planning

When capacity is enabled, the app reads capacity from the Jira project and field configured in Settings → Admin → Capacity. Planning is a calculator over the currently visible Stories:

- Individual Story checkboxes and the `Accepted`, `To Do`, `Postponed`, `Awaiting Val.`, and `Select All` action-bar buttons change only the planning selection.
- Those selection controls recalculate selected count, selected SP, the per-team allocation, and the Product/Tech split. They do not change Jira Status.
- A Story or Epic's displayed Status pill is a different control. Choosing a transition there performs a permission-gated Jira workflow transition and reports success or failure. In Planning, a Story's pill applies the transition to every selected Story in one request (up to 50); an Epic's or Subtask's pill changes only that issue.

The top bar compares the selected task count and SP with **Planning** capacity and **Team Cap**. Its over/under state shows whether selected SP is above or below the capacity signal. The breakdowns are labelled **Selected SP by Team** and **Selected SP by Project**. The capacity table is **Planned Teams Effort (Story Points)** and uses Product, Tech, and Total columns with **To Do / Pending**, **Postponed**, and **Accepted** values. A Team name too long for its column is shown on one line with an ellipsis; hovering or keyboard-focusing it shows the full name in the same readout used for truncated Epic header values.

## Board (Kanban)

Board groups Epics into the Department's configured columns. Opening an Epic shows its Stories and status progress. Board's own Priority, Projects, Assignee, and Project Track facet filters refine the Epic set without changing the shared task-list filters. Project Track always shows Committed and Flexible, including a zero-count option. With both checked, its heading counts every scoped Epic, including unset values; either checked alone selects that value, while both unchecked means only genuinely unset (`null`, missing, or trim-empty) values. Populated unknown values are not treated as unset. Select all, chip clear, and Clear all restore neutral; ordinary rerenders, mode and Teams changes, and same-scope Department restoration preserve an explicit empty selection, while a new Department or sprint snapshot starts neutral.

Board uses the Department and sprint already selected for Catch Up. Entering Board renders that already-loaded sprint snapshot immediately and issues no parallel selected-sprint Board fetch. The existing top Sprint selector is the only sprint/scope control. While Board is active it offers three kinds of choice: **All work**, **Component**, and the ordinary sprint list. All work and Component are transient Board modes and leave the saved sprint intact for sibling views; choosing an ordinary sprint or leaving Board returns to the selected-sprint Catch Up snapshot. No Board-local selector, button, or toggle exists.

The dashboard restores the saved Sprint label immediately, but it does not load or display ENG Jira work until a non-empty Sprint catalog validates that selection. Sprint discovery itself waits for the first `/api/config` read to settle: until it returns, the Sprint selector is unavailable and no Sprint or ENG Jira request starts. OAuth requests reuse a user-partitioned in-process catalog for 24 hours; a cache miss resolves the actual quarterly Sprint values from Jira. While discovery is pending, or when Jira returns no usable Sprint values, the Sprint selector and all ENG work remain blocked instead of opening a perpetual loading menu.

The shared selector separates choosing a scope from being ready to load it. Once the Sprint catalog validates, ordinary Sprint choices stay operable in Catch Up, Planning, Board, Statistics, and Scenario while Board capability or configuration is pending, unavailable, or failed. An explicit Sprint choice in Statistics Project Track resets its source range to that Sprint and performs one dedicated current statistics-source reload whose `sprintIds` body contains only the chosen Sprint and whose `refresh` flag bypasses a prewarmed range or per-Sprint cache; it never falls through to the ordinary task endpoint. Reselecting the current ordinary Sprint repairs and reloads a divergent Project Track range once, while reselecting it again with the range already matched is a no-op. Task-backed Statistics views keep the ordinary Sprint task source. Scenario selection only changes the selected Sprint—running a Scenario remains an explicit **Run Scenario** action and never starts a compute or write automatically.

While Board is active, Component and All work are selectable after the Sprint catalog makes the selector usable, even if their data prerequisites are not ready. The selected label changes immediately and the Board content shows one explicit state: configuration loading; configuration read failure with Retry; unsupported environment; missing Department; missing Board columns; missing saved Jira project/source-Board authority; missing Components; or missing Teams/Components. No ordinary-Sprint cards, exports, or fallback Jira task request appear beneath a blocked cross-sprint label. A ready scope requires strict Board capability, accepted Department configuration, and persisted Jira authority from saved selected projects or a saved Jira source Board. Component additionally requires configured Components; All work requires configured Components or Teams. Readiness becoming valid starts exactly one strict request; the request omits `sprintId`.

**Component** is cross-sprint and includes only Epics whose own Component exactly matches the Department configuration. **All work** is cross-sprint and unions those Component-matched Epics with parent Epics discovered from eligible work assigned to any saved Department Team, within saved Jira projects. Component matching is Epic-only; it is not applied to Stories. Large Component catalogs are split into bounded Jira searches; each validated page can contribute candidate cards, while later cumulative updates may be coalesced before one complete Epic index becomes authoritative. The Team-parent source remains active in All work even when Components are configured. Raw work-item parent keys are filtered in bounded batches, and only eligible Epic parents count toward the 1,000-Epic membership limit, so cross-team-owned Epics are not lost. Team-only Departments can use All work, while Component is unavailable without configured Components. Parents are deduplicated and placed using their own status. Completed Epics use the saved 1–90 day retention window (28 days by default), based on status transition history with the conservative recent-created fallback. A cross-sprint load cannot show a final empty state until its complete membership is authoritative; child-derived filters, actions, and Work items export unlock only when the result is complete and authoritative. Provisional transport diagnostics are not rendered as normal product content.

On startup, the cached Sprint id and label render immediately as display-only context while the first catalog request validates the server-produced workspace/Board identity and browser context; the restored value cannot authorize ENG Jira work. When no saved valid selection exists, the current Sprint is selected. In DB/OAuth mode, Sprint catalogs persist per workspace and Jira source Board, while Team availability persists per workspace and Sprint and is valid only for the effective Board/project/base-JQL/Team-field scope digest. Team names remain a separate workspace directory and never grant Sprint membership.

A validated cached catalog keeps the selector usable during a background refresh. A complete validated empty response is authoritative and clears old choices or Team availability. A matching failed refresh retains the previous validated payload with a nonblocking warning; a payloadless failure cannot establish authority. Ordinary and manual refreshes coalesce onto the same pending attempt, while Retry forces one new attempt only when no ordinary attempt is pending. Server refreshes have a hard attempt deadline, and browser completion reads are bounded to the named attempt/identity and cancelled when authentication, configuration, modal/document lifetime, or request generation changes. Late completions cannot restore stale authority.

Without a validated non-empty Sprint catalog, the selector and ENG Jira work remain gated. The first useful validated Component page or eligible Team-parent batch publishes bounded candidate Epic cards before the next request completes; later cumulative updates may be coalesced. Story counts and status distribution update as validated child pages arrive; gray loading bars stand in for unavailable totals. Completed columns show their final totals independently. A timeout, temporary Jira failure, or true scope limit retains the current load's validated cards and completed columns with an explicit incomplete-state Retry. A compatible refresh failure instead keeps the previous complete snapshot visible and labels it stale; it never mixes new partial membership or children into that snapshot. In both cases child-derived filters and Work items export remain locked unless the displayed source is complete and authoritative. Authentication, incompatible scope changes, and invalid data still invalidate the generation. Dependency enrichment is not part of this Board load.

When operational load collection is enabled, accepted Component observations are stored and reportable as `scopeType=component` with `sprintId=null`, matching their cross-sprint scope. These internal measurements are not product analytics and do not affect Board rendering or control availability.

Dragging an Epic to another column requests the Jira transitions available for that Epic and changes Jira status only when the user has permission and a usable target status is loaded for the destination. A refused, unavailable, or failed transition leaves the Epic in its existing status. A Board column star is session-only and changes the focused column for the current app session.

The default Board has three columns in reading order: **To Do | In Progress | Done**. **Reset to default columns** builds it from the Jira status catalog: exactly `In Progress` goes to In Progress; `Done`, `Incomplete`, and `Killed` go to Done; every other status goes to To Do. A configured Board has no Unmapped column: an Epic whose status no column holds is To Do work and renders in the first column.

On desktop wider than 760px, with a hovering fine pointer and room below the top controls and filter bar for one 340px column, Board switches to pane mode: the page itself never scrolls. The top bar and the filter bar stay in place, the board fills exactly the remaining screen height, and every open column is a bordered pane from its title line to the screen bottom that scrolls independently from the first wheel or trackpad gesture. Folded rails keep their fixed 340px track. An open column keeps its scroll position while it stays open; a folded column always reopens at the top. Field popovers (such as the person editor) close if their card scrolls out of its pane. Short, 760px-or-narrower, and touch viewports keep the page-scroll model with the pinned column chrome and compact header, and show a compact alert above the board, "Board needs a larger screen.", with a **Request small-screen support** button that records one `board_action` analytics event per click and then reads "Thanks, noted".

Settings → Departments → Boards maps Jira statuses to columns. There you can reorder columns; change a column's name and color; set advisory Min and Max values; and choose the shared default-star column. Loading the Jira status catalog requires a configured Jira board/project scope and permission to read its statuses. Saved columns remain intact when the catalog cannot load.

If a Department has no usable Board configuration, Board renders one **All epics** column and offers the configuration path.

## Filters and search

Catch Up and the applicable Planning, Scenario, and Statistics task-list modes use the hierarchy search: key and summary across Initiative, Epic, and Story; assignee on Epic and Story only. Initiative assignee is not searched. Priority, Status, Product/Tech, and Project Track filters recalculate that same visible hierarchy scope.

Project Track remains an Epic-owned field even in these Story-oriented modes. Its heading and option counts are unique Epics, while the top filter readout remains Stories. The fixed options are `🔒 Committed` and `🤷 Flexible`, including at zero. Neutral admits every Story, including unknown values and Stories without an Epic. Both options unchecked admits only Stories under an existing Epic whose Project Track is `null`, missing, or trim-empty; a populated unknown value such as `Other` and a Story without an Epic do not match. The explicit-empty state survives task-list mode and Teams changes plus same-scope Department restoration. A new Department or sprint starts neutral.

Board search is separate and Epic-only. It matches Epic key, summary, assignee, and Delivery Owner, then combines that result with Board's own facet filters. There is no single global search predicate shared by Board and Catch Up/Planning.

## Continue in Jira

The blue Jira control normally opens a menu with separate **Open epics** and **Open stories** choices. On strict Board, the second choice is **Open work items** and includes every authoritative visible configured child type, such as Stories, Bugs, or Tasks. Choosing one opens only that currently scoped subset in Jira, where Jira provides its bulk-operation tools. Pending Board data exposes no Work items export action. The app does not perform an in-app bulk mutation from this control.
