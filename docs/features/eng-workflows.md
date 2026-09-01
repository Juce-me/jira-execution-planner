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
3. Add Jira Components if they are useful, or choose **Continue without components**. Component is a Jira issue field, commonly set at Epic level. Components broaden only the **Missing Information** and **Lead Times** queries through configured-Team **or** Component matching; they do not make Stories appear in the main Product/Tech hierarchy.
4. Review the filled favorite star. It is your one private startup Department, not a shared workspace default.
5. Keep **Show in Department selector** enabled for Departments you want in your controls. Your favorite is always visible.

The Settings header keeps **Run onboarding again** at the right across tabs. It is unavailable while Settings has unsaved changes or is saving.

Outside first run, commit Settings changes with the footer **Save** button. First-run configuration uses **Save and continue**. The Settings confirmation dialog is for discarding unsaved changes; a normal successful save does not require a confirmation checkmark.

## Make expected Epics and Stories visible

At least one configured Team is required for first-run eligibility. After that, Jira work can enter the UI through three distinct shipped discovery paths:

1. **Main Initiative/Epic/Story hierarchy:** a Story in the selected sprint whose Jira Team matches a configured Department Team is included, and its parent Epic is brought into the hierarchy.
2. **Epic-only and empty-Epic discovery:** the Epic must match either its Jira Team or the Department's exact mapped team label, and it must match either its Jira Sprint value or the exact selected-sprint-name label.
3. **Future sprint ready path:** the Epic requires both the configured mapped team label and the selected-sprint-name label. One does not substitute for the other.

Configured Jira Components broaden only Missing Information and Lead Times through configured-Team or Component matching. They never make Stories appear in the main Product/Tech list.

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

Board groups Epics into the Department's configured columns. Opening an Epic shows its Stories and status progress. Board's own Priority, Projects, Assignee, and Delivery track facet filters refine the Epic set without changing the Catch Up/Planning filters.

Dragging an Epic to another column requests the Jira transitions available for that Epic and changes Jira status only when the user has permission and a usable target status is loaded for the destination. A refused, unavailable, or failed transition leaves the Epic in its existing status. A Board column star is session-only and changes the focused column for the current app session.

Settings → Departments → Boards maps Jira statuses to columns. There you can reorder columns; change a column's name and color; set advisory Min and Max values; and choose the shared default-star column. Loading the Jira status catalog requires a configured Jira board/project scope and permission to read its statuses. Saved columns remain intact when the catalog cannot load.

If a Department has no usable Board configuration, Board renders one **All epics** column and offers the configuration path. It does not mislabel unconfigured work as an Unmapped setup.

## Filters and search

Catch Up and Planning use the hierarchy search: key and summary across Initiative, Epic, and Story; assignee on Epic and Story only. Initiative assignee is not searched. Priority, Status, and Product/Tech filters recalculate that same visible hierarchy scope.

Board search is separate and Epic-only. It matches Epic key, summary, assignee, and Delivery Owner, then combines that result with Board's own facet filters. There is no single global search predicate shared by Board and Catch Up/Planning.

## Continue in Jira

The blue Jira control opens the currently scoped issue set in Jira. From there, Jira provides its bulk-operation tools. The app does not perform an in-app bulk mutation from this control.
