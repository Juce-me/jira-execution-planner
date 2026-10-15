# Shareable View Links

Share the ENG view you are looking at as one link. A teammate who opens it, signing in first if needed, lands in the same view. The link carries selectors only (which view, group, Sprint, Teams, filters, search, and where to scroll); everything the teammate sees is loaded with their own Jira sign-in.

## Share a view

1. Set up the view: choose the Sprint, group and Teams, apply filters or search, and scroll to the alerts group, Epic or Story you want to point at.
2. Press **Share** in the header. After you scroll past the main header, the same control appears in the compact bar beside Search.
3. The link is copied and the icon turns into a check for two seconds. If your browser blocks the clipboard, the link appears under the control in a selectable field instead.
4. Paste it into chat.

Share is available in Catch Up, Planning, Board and Statistics, including Statistics on future Sprints. Planning links for closed Sprints fall back to Catch Up. It is hidden in EPM and Scenario, and disabled until the Department, Sprint catalog and applicable Team selection are ready.

## What a link carries

| Mode | Carried |
| --- | --- |
| Catch Up | group, Sprint, Teams, search, Status, Priority and Project Track filters, Product/Tech lanes, Initiative grouping, Epic sort, which alert categories are expanded, and one focus target (an alerts team group, an Epic or a Story) |
| Planning | group, Sprint, Teams, search, filters, lanes, List or Table, Epics or Stories rows (Table), Initiative grouping and sort (List), and one Epic or Story focus target |
| Board | group, Sprint, the Board scope (Sprint, Component or All work) and search |
| Statistics | group, Sprint, the Statistics view, its range, and Teams for the views that use them |

A link never carries your saved preferences, Planning row selections or review drafts, Scenario content, EPM state, alert dismissals, Board filters, Statistics display options, assignee filters, tokens or any account detail. It does contain ids (group, Team, Sprint, issue keys) and your search text, so treat it like any internal link. A link is not a permission: it cannot show anything the opener's own Jira access does not already allow.

## When you open a link

- It applies in four stages: the Department and Sprint, then the mode and its options, then Teams and filters once the data has loaded, then a scroll to the target. ENG task loading waits for the link’s scope and options before starting.
- Opening a link replaces your current view with the shared one. Applied controls use the existing local view and Team-selection persistence, but the link does not change your saved Department favorite; that favorite still governs startup in DB/OAuth mode.
- A link equal to your current view changes nothing. A recipient whose saved view is EPM or Scenario lands in the link's ENG view.
- If the group or Sprint in the link is not available to you, nothing from the link is applied and a notice says so. If other parts do not apply (a Team you cannot see, a filter value that no longer exists, a mode the Sprint does not allow, a target that is not on screen), the rest is applied and the notice names what was skipped; it never shows a value from the link.
- A click, a tap or a key press (including Escape, except modifier and lock keys) while it applies stops the link and keeps what was applied. Scrolling alone does not, until the scroll to the target begins. Reloading the page before it finishes drops the link; open it again.
- A first-time user is held through the Department popup; the link is dropped if its group is not among the Departments they picked. The Catch Up tour starts after the link has finished.
- If you open a link while signed out, you sign in and then land in the shared view. The link is kept for up to 15 minutes.
- The link has 90 seconds in total; the Department and Sprint step and the options step have 5 seconds each, the data step and the scroll 20 seconds each.

## What the notices mean

Notices name categories, never values from the link. Multiple skipped categories use the same labels in the displayed order below.

| Notice | What happened |
| --- | --- |
| Part of this link was not applied. Everything else was applied. | The apply stopped after some stages; no skipped category was identified. |
| Part of this link was not applied: Department group. Everything else was applied. | The Department group could not be applied. |
| Part of this link was not applied: Sprint. Everything else was applied. | The Sprint could not be applied. |
| Part of this link was not applied: view mode. Everything else was applied. | The view mode was unavailable. |
| Part of this link was not applied: Teams. Everything else was applied. | Some Teams could not be applied. |
| Part of this link was not applied: filters. Everything else was applied. | Some filters or other view options could not be applied. |
| Part of this link was not applied: highlighted item. Everything else was applied. | The highlighted item could not be revealed. |
| Part of this link was not applied: Department group, Sprint, view mode, Teams, filters and highlighted item. Everything else was applied. | Several categories were skipped; notices combine their labels in this order. |
| This link could not be applied right now, so your view was left as it was. | The link could not start, for example because readiness failed or timed out. |
| This link was not applied: its Department group is not available to you. | The named scope was unavailable, so nothing else from the link was applied. |
| This link was not applied: its Sprint is not available to you. | The named scope was unavailable, so nothing else from the link was applied. |
| This link was not applied: its Department group and Sprint are not available to you. | The named scope was unavailable, so nothing else from the link was applied. |
| This link is not valid, so it was not applied. Ask the sender to copy it again. | The query failed validation. |
| This link was made with a newer version of the app, so it was not applied. Update the app and open the link again. | The query uses a newer link version. |
| Link copied | The link reached the clipboard; the icon shows a check for two seconds. |
| Link copied, without some details to keep it short: view mode. | The link was copied after these details were left out to meet the query cap. |
| Link copied, without some details to keep it short: Teams. | The link was copied after these details were left out to meet the query cap. |
| Link copied, without some details to keep it short: filters. | The link was copied after these details were left out to meet the query cap. |
| Link copied, without some details to keep it short: highlighted item. | The link was copied after these details were left out to meet the query cap. |
| Link copied, without some details to keep it short: filters and highlighted item. | The link was copied after these details were left out to meet the query cap. |
| Link copied, without some details to keep it short: view mode, Teams, filters and highlighted item. | The link was copied after these details were left out to meet the query cap. |
| The browser did not allow copying. Select the link below and copy it. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: view mode. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: Teams. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: highlighted item. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters and highlighted item. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: view mode, Teams, filters and highlighted item. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| This view has too many selections to fit in one link, so nothing was copied. | The remaining selections still exceeded the query cap. |
| This view cannot be shared as a link right now, so nothing was copied. | The current view could not be encoded. |

## Limits

- The query part of a link can contain at most 1,536 characters. When a view would not fit, the lowest-priority parts are left out in this order (search text, the focus target, alert categories, Initiative grouping, sort) and the notice names them; if it still does not fit, nothing is copied.
- A Board or Statistics link has no focus target, and no link carries Board filters or Statistics display options in this version.
- Search text is part of the link. In the container deployment the access log records the request path only, never the query string or the Referer.
