# Personal Group Favorite

In authenticated workspace-database mode, every user chooses one personal favorite Department group. The filled star identifies the group used when their dashboard starts or reloads. It is a user preference, not the workspace's shared `defaultGroupId`.

## First run

The dashboard does not preselect a group. The user must choose exactly one known group that has at least one configured team. Continue stays disabled for empty-team groups and while the preference save is running. Until a valid server response and its canonical group snapshot are applied, Product and Tech requests remain blocked and old scoped rows, loading states, and errors are cleared.

After a successful save, the dashboard applies the returned group configuration and favorite before starting scoped requests. A delayed response from an older group scope cannot replace the new scope. If the selected sprint resolves later, the normal sprint loader uses the saved favorite and its teams.

## Settings and dashboard scope

The Department settings list and editor show the personal favorite in workspace-database mode. Starring another eligible group moves the single star and automatically keeps that group visible in the user's controls. The favorite cannot be hidden, clicking its filled star is a no-op, and a group with no configured teams cannot be starred.

The header Group dropdown controls only the current dashboard scope. Switching it does not write preferences or move the Settings star. Reloading starts from the persisted favorite.

Shared group edits and personal preferences keep their existing ordered Save flow. If the shared configuration succeeds but the personal preference fails, the shared revision remains committed while the favorite draft stays dirty for a preference-only retry. A safe app-relative `/login` recovery link may be shown for an expired session; external and lookalike URLs are ignored.

If a favorite is deleted, hidden, or loses all teams, the backend returns mandatory selection again without inventing a replacement. Active scoped requests are aborted or ignored, rendered group data is cleared, and the user must explicitly choose another eligible group.

Preferences are isolated by both workspace and authenticated user. One user's star never changes another user's star.

## File and JSON compatibility

File, environment, and automatic configuration sources retain the legacy shared-default behavior. Their `defaultGroupId` remains visible and preferred, and the existing browser-local visibility behavior continues unchanged. The personal-star labels and persistence contract apply only when the group source is `workspace_db`.

## Analytics

No event is emitted merely for rendering a star. First-run selection and Settings preference persistence reuse `settings_action(section=departments)` with fixed workflow actions and count buckets only. Temporary header scope changes retain `filter_changed(filter_type=group)`. Group ids and names are never sent.
