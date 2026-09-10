# ENG Workflows

This guide covers the operational path from choosing a Department through planning, Board work, search, and the Jira handoff. The first-run Department workflow is available on desktop and mobile. The dashboard coachmark tour is desktop only; mobile tour work is deferred in GitHub issue #151.

## Choose or add a Department

First run begins with a personal Department choice:

- With zero through three Departments, the picker shows the list without search. At four or more, search is available.
- If an eligible existing Department matches your work, select it and choose **Continue**. An eligible Department has at least one configured Team, so this path does not open configuration.
- **Add Department** is always available. Choose **Create clean Department** for a new draft, or **Duplicate existing Department** and name the source explicitly.
- A duplicate copies the full Department. Teams, mapped team labels, and Components are preserved by default. **Remove existing teams** removes only teams and their team-label mappings; **Remove existing components** removes only Components. Other Department settings remain in the draft.
- If an existing Department has no configured Team, use **Configure and use {Department}** to repair it explicitly.

A clean draft, duplicate, or explicitly repaired Department becomes the pending private favorite and is added to the visible Department set. Complete the real Settings guide and choose **Save and continue**. A successful save continues directly to the dashboard; it does not send you back to the picker.

## Configure the Department

The guide uses Settings → Departments → Team Groups rather than a second, simplified form.

1. Edit the Department name in the left Department list. There is no second name field in the right editor. On compact or mobile layouts, open the **Groups** drawer to reach the list.
2. Add at least one Team. Teams determine the Department's main Jira scope, and a Department without a configured Team cannot complete first run.
3. Add Jira Components if they are useful, or choose **Continue without components**. Component is a Jira issue field, commonly set at Epic level. Components broaden the **Missing Information** and **Lead Times** queries through configured-Team **or** Component matching. In Board, the cross-sprint **Component** choice shows only Epics with an exact Component match, while **All work** unions those Epics with Team-derived parents. Component matching is never applied to Stories and does not make Stories appear in the main Product/Tech hierarchy.
4. Review the filled favorite star. It is your one private startup Department, not a shared workspace default.
5. Keep **Show in Department selector** enabled for Departments you want in your controls. Your favorite is always visible.

The Settings header keeps **Run onboarding again** at the right across tabs. It is unavailable while Settings has unsaved changes or is saving.

Outside first run, commit Settings changes with the footer **Save** button. First-run configuration uses **Save and continue**. The Settings confirmation dialog is for discarding unsaved changes; a normal successful save does not require a confirmation checkmark.

## Make expected Epics and Stories visible

At least one configured Team is required for first-run eligibility. After that, Jira work can enter the UI through three distinct shipped discovery paths:

1. **Main Initiative/Epic/Story hierarchy:** a Story in the selected sprint whose Jira Team matches a configured Department Team is included, and its parent Epic is brought into the hierarchy.
2. **Epic-only and empty-Epic discovery:** the Epic must match either its Jira Team or the Department's exact mapped team label, and it must match either its Jira Sprint value or the exact selected-sprint-name label.
3. **Future sprint ready path:** the Epic requires both the configured mapped team label and the exact selected-sprint-name label. One does not replace the other.

Configured Jira Components broaden Missing Information and Lead Times through configured-Team or Component matching. They also define Board's cross-sprint **Component** choice and the Component-owned half of **All work**, at the Epic boundary only. They never make Stories appear in the main Product/Tech list.

If expected work is missing, check in this order:

1. Confirm the active Department and selected sprint.
2. Clear search, facet filters, and the Product/Tech display filters.
3. Verify the Jira Story Team and sprint.
4. For Epic-only discovery, verify the Epic Team or the exact team-label mapping, then verify the Epic sprint or exact sprint-name label.
5. Save the Department configuration.
6. Choose **Refresh** to load the Jira scope again.

## Planning

When capacity is enabled, the app reads capacity from the Jira project and field configured in Settings → Admin → Capacity. Planning is a calculator over the currently visible Stories:

- Individual Story checkboxes and the `Accepted`, `To Do`, `Postponed`, `Awaiting Val.`, and `Select All` action-bar buttons change only the planning selection.
- Those selection controls recalculate selected count, selected SP, the per-team allocation, and the Product/Tech split. They do not change Jira Status.
- A Story or Epic's displayed Status pill is a different control. Choosing a transition there performs a permission-gated Jira workflow transition and reports success or failure.

The top bar compares the selected task count and SP with **Planning** capacity and **Team Cap**. Its over/under state shows whether selected SP is above or below the capacity signal. The breakdowns are labelled **Selected SP by Team** and **Selected SP by Project**. The capacity table is **Planned Teams Effort (Story Points)** and uses Product, Tech, and Total columns with **To Do / Pending**, **Postponed**, and **Accepted** values.

## Board (Kanban)

Board groups Epics into the Department's configured columns. Opening an Epic shows its Stories and status progress. Board's own Priority, Projects, Assignee, and Project Track facet filters refine the Epic set without changing the shared task-list filters. Project Track always shows Committed and Flexible, including a zero-count option. With both checked, its heading counts every scoped Epic, including unset values; either checked alone selects that value, while both unchecked means only genuinely unset (`null`, missing, or trim-empty) values. Populated unknown values are not treated as unset. Select all, chip clear, and Clear all restore neutral; ordinary rerenders, mode and Teams changes, and same-scope Department restoration preserve an explicit empty selection, while a new Department or sprint snapshot starts neutral.

Board uses the Department and sprint already selected for Catch Up. Entering Board renders that already-loaded sprint snapshot immediately and issues no parallel selected-sprint Board fetch. The existing top Sprint selector is the only sprint/scope control. While Board is active it offers three kinds of choice: **All work**, **Component**, and the ordinary sprint list. All work and Component are transient Board modes and leave the saved sprint intact for sibling views; choosing an ordinary sprint or leaving Board returns to the selected-sprint Catch Up snapshot. No Board-local selector, button, or toggle exists.

**Component** is cross-sprint and includes only Epics whose own Component exactly matches the Department configuration. **All work** is cross-sprint and unions those Component-matched Epics with parent Epics discovered from eligible work assigned to any saved Department Team, within saved Jira projects. Component matching is Epic-only; it is not applied to Stories. The Team-parent source remains active in All work even when Components are configured, so cross-team-owned Epics are not lost. Team-only Departments can use All work, while Component is unavailable without configured Components. Parents are deduplicated and placed using their own status. Completed Epics use the saved 1–90 day retention window (28 days by default), based on status transition history with the conservative recent-created fallback. A cross-sprint load cannot show a final empty state until its complete membership is authoritative; child-derived filters, actions, and Work items export unlock only when the result is complete and authoritative. Provisional transport diagnostics are not rendered as normal product content.

All work shows Component-matched Epic cards before the remaining Department Team parent discovery completes. Story counts and status distribution update as validated child pages arrive; gray loading bars stand in for unavailable totals. Completed columns show their final totals independently. A timeout or temporary Jira failure retains the Epic cards already received with an incomplete-state retry, while child-derived filters and export remain locked. Authentication, scope changes, and invalid data still invalidate the generation. Dependency enrichment is not part of this Board load.

Dragging an Epic to another column requests the Jira transitions available for that Epic and changes Jira status only when the user has permission and a usable target status is loaded for the destination. A refused, unavailable, or failed transition leaves the Epic in its existing status. A Board column star is session-only and changes the focused column for the current app session.

Settings → Departments → Boards maps Jira statuses to columns. There you can reorder columns; change a column's name and color; set advisory Min and Max values; and choose the shared default-star column. Loading the Jira status catalog requires a configured Jira board/project scope and permission to read its statuses. Saved columns remain intact when the catalog cannot load.

If a Department has no usable Board configuration, Board renders one **All epics** column and offers the configuration path. It does not mislabel unconfigured work as an Unmapped setup.

## Filters and search

Catch Up and the applicable Planning, Scenario, and Statistics task-list modes use the hierarchy search: key and summary across Initiative, Epic, and Story; assignee on Epic and Story only. Initiative assignee is not searched. Priority, Status, Product/Tech, and Project Track filters recalculate that same visible hierarchy scope.

Project Track remains an Epic-owned field even in these Story-oriented modes. Its heading and option counts are unique Epics, while the top filter readout remains Stories. The fixed options are `🔒 Committed` and `🤷 Flexible`, including at zero. Neutral admits every Story, including unknown values and Stories without an Epic. Both options unchecked admits only Stories under an existing Epic whose Project Track is `null`, missing, or trim-empty; a populated unknown value such as `Other` and a Story without an Epic do not match. The explicit-empty state survives task-list mode and Teams changes plus same-scope Department restoration. A new Department or sprint starts neutral.

Board search is separate and Epic-only. It matches Epic key, summary, assignee, and Delivery Owner, then combines that result with Board's own facet filters. There is no single global search predicate shared by Board and Catch Up/Planning.

## Continue in Jira

The blue Jira control normally opens a menu with separate **Open epics** and **Open stories** choices. On strict Board, the second choice is **Open work items** and includes every authoritative visible configured child type, such as Stories, Bugs, or Tasks. Choosing one opens only that currently scoped subset in Jira, where Jira provides its bulk-operation tools. Pending Board data exposes no Work items export action. The app does not perform an in-app bulk mutation from this control.
