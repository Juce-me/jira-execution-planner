# Shareable View Links

Share the ENG view you are looking at as one link. A teammate who opens it, signing in first if needed, lands in the same view. The link carries selectors only (which view, group, Sprint, Teams, filters, search, and an optional explicit Epic destination); everything the teammate sees is loaded with their own Jira sign-in.

## Share a view

1. Set up the view: choose the Sprint, group and Teams, and apply filters or search.
2. Press **Copy view link** in the header to share those settings. Scroll position never adds an item target. After you scroll past the main header, the same control appears in the compact bar beside Find in view.
3. The icon turns into a check for two seconds; its tooltip and accessible status say **View link copied**. Ordinary success adds no visible popup or Dismiss button. If your browser blocks the clipboard, the link appears under the control in a selectable field instead.
4. Paste it into chat.

Share is available in Catch Up, Planning, Board and Statistics, including Statistics on future Sprints. Planning links for closed Sprints fall back to Catch Up. It is hidden in EPM and Scenario (Scenario keeps its slot empty, so switching modes never shifts the search field), and disabled until the Department, Sprint catalog and applicable Team selection are ready.

To point at a particular Epic in Catch Up or Planning, use the chain-link action at the right edge of its title (or beside its summary in Planning Table Epics rows). It is separate from the Jira title link. Hover or focus the header/row to reveal it; on touch devices it stays visible. The action sits between the summary and the key. Its tooltip says **Copy link to this Epic**, and the checkmark tooltip and accessible status identify the copied Epic. The action also works inside Initiative groups and carries the current view settings. Story and synthetic rows have no copy action. Each team group in the Catch Up alerts panel is copied by clicking its own count text (for example `2 stories blocked`, dotted-underlined, always visible so it works by tap; its tooltip says **Copy link to this alert group**). There is no separate icon, and the text turns into a checkmark with **Link copied** for two seconds. The recipient lands on that group with its card expanded and every other alert card folded, regardless of which cards the sender had open. A group that can only be identified by its display name has plain count text and no link. Older links targeting Stories still open.

## What a link carries

| Mode | Carried |
| --- | --- |
| Catch Up | group, Sprint, Teams, search, Status, Priority and Project Track filters, Product/Tech lanes, Initiative grouping, Epic sort, which alert categories are expanded, and an Epic target only when copied from that Epic |
| Planning | group, Sprint, Teams, search, filters, lanes, List or Table, Epics or Stories rows (Table), Initiative grouping and sort (List), and an Epic target only when copied from that Epic |
| Board | group, Sprint, the Board scope (Sprint, Component or All work), search, the Board's Priority, Projects, Assignee and Project Track filters, the column you explicitly focused (the opened column) and, from a card's copy action, one Epic card |
| Statistics | group, Sprint, the Statistics view, its range, and Teams for the views that use them; for Lead Times, its mode and that mode's own selection |

A link never carries your saved preferences, Planning row selections or review drafts, Scenario content, EPM state, alert dismissals, Statistics display options, assignee filters, tokens or any account detail. It does contain ids (group, Team, Sprint, issue keys) and your search text, so treat it like any internal link. A link is not a permission: it cannot show anything the opener's own Jira access does not already allow.

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

Apply and omission notices name categories, never values from the link. Copy confirmations name View or the explicitly selected Epic locally; that key never enters analytics. Multiple skipped categories use the same labels in the displayed order below. Omission copy examples use the header confirmation; Epic copy uses the same text with its local Epic destination.

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
| View link copied / Epic &lt;key&gt; link copied | The named destination reached the clipboard; the icon shows a check for two seconds. |
| View link copied, without some details to keep it short: view mode. | The link was copied after these details were left out to meet the query cap. |
| View link copied, without some details to keep it short: Teams. | The link was copied after these details were left out to meet the query cap. |
| View link copied, without some details to keep it short: filters. | The link was copied after these details were left out to meet the query cap. |
| The browser did not allow copying. Select the link below and copy it. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: view mode. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: Teams. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters. | Clipboard access was unavailable or refused; copy the selectable link manually. Any listed details were omitted to fit. |
| This view has too many selections to fit in one link, so nothing was copied. | The remaining selections still exceeded the query cap. |
| This view cannot be shared as a link right now, so nothing was copied. | The current view could not be encoded. |

## Limits

- An explicit Epic copy refuses if fitting the query would require omitting that Epic, so it never silently copies a view-only link.
- The query part of a link can contain at most 1,536 characters. When a view would not fit, the lowest-priority parts are left out in this order (search text, the focus target, alert categories, Initiative grouping, sort) and the notice names them; if it still does not fit, nothing is copied.
- A Lead Times link names the Mode only when it is not Created (`lead=closed` or `lead=last_n`) and carries only that mode's selection: Created its quarters (`from`, `to`), Closed its own quarters (`from`, `to` with `lead=closed`), and Last N its count (`n=30|50|60`) with no quarters. A Last N link without a valid count opens with 30 and the notice names the view mode; quarters on a Last N link are ignored, and a recipient's saved Closed range or count is never carried into a link for another mode. Links made before Lead Times modes carry no `lead` and open Created, as they always did. A browser tab that has not reloaded since the update ignores `lead` and `n` and opens Created; that cost is accepted.
- A Statistics link has no focus target, and no link carries Statistics display options in this version. A Board link names the focused column only when you chose one, or the card's own column when you copy from a card, which also carries the current filters and reveals that card (its column scrolls to it) on arrival; the card's action sits between its summary and its key, and the card's panel is not opened; an unknown column falls back to the recipient's default focus.
- Search text is part of the link. In the container deployment the access log records the request path only, never the query string or the Referer.

Feedback uses the existing compact export surfaces: a neutral menu holds the full selectable URL for manual copying, while omissions, refused copies and unapplied link details use a compact warning. Each has a compact Dismiss action. Recovery banners are reserved for connection recovery.

## Highlight on arrival

A revealed Epic, alert group or Planning row is painted with an overlay that holds at full strength briefly, then fades out over one second (a static tint with reduced motion). It is driven by the `data-share-reveal` attribute rather than a class. A revealed Story keeps the existing two-pulse card highlight.
