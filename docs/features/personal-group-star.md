# Personal Group Favorite

In authenticated workspace-database mode, every user has exactly one private favorite Department. The filled star identifies the Department used when their dashboard starts or reloads. It is a user preference, not the workspace's shared `defaultGroupId`.

## First run

Direct picker selection remains explicit. The dashboard does not preselect a Department: choose one known Department with at least one configured Team, then choose **Continue**. Continue stays disabled for an ineligible Department and while the preference save is running.

Create, duplicate, and **Configure and use {Department}** are intentionally different. Before Team Groups opens, the edited Department becomes the pending private favorite and is added to the pending visible set. This staging happens before any shared save and sends no premature preference request. The pending choice is committed only by **Save and continue**, after shared Department configuration succeeds.

Until a valid preference response and its canonical Department snapshot are applied, Product and Tech requests remain blocked and old scoped rows, loading states, and errors are cleared. After success, the dashboard applies the returned Department configuration and favorite before starting scoped requests. A delayed response from an older Department scope cannot replace the new scope.

## Cancel and recovery

Before any shared section is committed, **Cancel** restores the captured Settings drafts and returns to the picker without saving the pending favorite. Once a shared section has committed, the UI stays in recovery instead of claiming that Cancel can undo the saved work.

Shared Department edits are saved before private preferences. If a later shared section fails, retry continues with the remaining sections. If the shared configuration succeeds but the private favorite/visibility save fails, the shared revision remains committed and the private draft stays available for a preference-only retry. The preference request is never sent before the shared Department snapshot is verified.

## Settings and dashboard scope

The Department settings list shows the user's private favorite in workspace-database mode. Starring another eligible Department moves the single star and automatically keeps that Department visible. The favorite cannot be hidden, clicking its filled star is a no-op, and a Department with no configured Team cannot be starred.

The header Department dropdown controls only the current dashboard scope. Switching it does not write preferences or move the Settings star. Reloading starts from the persisted favorite.

If a favorite is deleted, hidden, or loses all Teams, the backend requires selection again rather than inventing a replacement. Active scoped requests are aborted or ignored, rendered Department data is cleared, and the user must explicitly choose another eligible Department.

Preferences are isolated by both workspace and authenticated user. One user's star never changes another user's star.

## Shared and private ownership

Department names, Team membership, mapped team labels, Components, and Board layouts are shared workspace configuration. Favorite, visibility, and active Department are private per-user preferences. Creating or duplicating a Department never writes a shared `defaultGroupId` as a substitute for the user's favorite.

## File and JSON compatibility

File, environment, and automatic configuration sources retain the legacy shared-default behavior. Their `defaultGroupId` remains visible and preferred, and the existing browser-local visibility behavior continues unchanged. The private-star labels and persistence contract apply only when the Department source is `workspace_db`.

## Analytics

No event is emitted merely for rendering a star or staging create/duplicate/repair. First-run completion and Settings preference persistence reuse `settings_action(section=departments)` with fixed workflow actions and count buckets only. Temporary header scope changes retain `filter_changed(filter_type=group)`. Department ids and names are never sent.
