# Postmortem: Scenario Planner Regressions

## Summary
- Firefox timeouts, wrong dependency direction, and unreadable lane layouts in large views.

## Root Causes
- Scroll-linked updates (layout + edge recompute on every scroll tick) caused Firefox to time out.
- Jira link direction handling relied on relation labels without normalizing inward/outward semantics.
- Blocked links were not treated as scheduling prerequisites, allowing overlaps.
- Full-bleed layout hacks caused width/overlay misalignment and brittle sizing.
- Excluded items were packed into the same rows as active items, cluttering lanes.

## Fix
- Throttle scroll/resize updates with requestAnimationFrame and cancel pending work on close.
- Normalize link types into canonical prereq -> dependent edges.
- Treat blocks/is blocked by as prerequisites in scheduling and edge rendering.
- Use a stable full-bleed wrapper pattern for the Scenario section.
- Stack excluded items separately to keep main lanes readable.

## Prevention
- Any scroll-based layout/edge updates must be throttled with rAF.
- Normalize Jira link types (name/inward/outward) into prereq/dependent before scheduling/rendering.
- Blocked links must be treated as hard prerequisites, not just visual cues.
