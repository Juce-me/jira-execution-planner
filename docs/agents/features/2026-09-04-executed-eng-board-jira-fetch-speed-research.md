# ENG Board Jira fetch-speed research

Status: executed
Type: feature

## Question

For ENG Board with optional Sprint / **All work**, can Jira return Epics, each Epic's direct-child
count, and child status distribution in one request? If not, what is the fastest complete design,
and can the UI update while child pages are still loading?

## Answer

Use one Board-owned browser flow and expect its backend work to contain at least two logical Jira
search phases:

1. fetch the exact in-scope Epic index; then
2. fetch the direct children of those Epic keys in bounded, paginated batches, requesting `parent`,
   `status`, and the fields already needed to render each child.

A single Jira JQL search can return both Epic and Story issue rows when both are independently
expressible in one JQL expression. That is not enough for this Board scope: the child predicate
depends on the keys returned by the Component/status/retention Epic query. Jira's documented
`parent` field accepts explicit parent keys or IDs and supports no JQL functions, so standard JQL
does not provide a correlated subquery such as "children of the Epics matched by this other clause."
[Atlassian's Parent JQL field documentation](https://support.atlassian.com/jira-software-cloud/docs/jql-fields/#Parent)

The documented enhanced-search response is a paginated collection of `issues`, controlled by
`fields`, `maxResults`, and `nextPageToken`; it has no per-parent group-by/count/status-distribution
shape. This makes exact per-Epic counts a consumer-side aggregation over returned child rows.
[Atlassian's enhanced Jira search API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-post)

Jira's approximate-count endpoint does not replace that child fetch: it returns one estimated count
for one bounded JQL query, not exact counts grouped by Epic and status. Calling it once per
Epic/status would create request fan-out and still would not provide the story rows required by the
Board. [Atlassian's count API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-approximate-count-post)

The Jira Software "issues for epic" endpoint is also not a suitable shortcut. It is deprecated,
operates on one Epic at a time, and Atlassian directs callers to JQL with the `parent` clause.
[Atlassian's Epic API](https://developer.atlassian.com/cloud/jira/software/rest/api-group-epic/#api-rest-agile-1-0-epic-epic-id-or-key-issue-get)

## Progressive behavior

The backend can aggregate `countByEpic` and `countByEpicAndStatus` as each Jira child page arrives.
Those numbers are **provisional** until every required batch ends with Jira's final-page signal.
Jira pagination exists to limit response size, and the enhanced endpoint exposes
`nextPageToken`/`isLast`; each page is a separate Jira HTTP response.
[Atlassian's REST pagination overview](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/#pagination)

The browser cannot see those intermediate pages through the repository's current endpoint because
the Flask handler collects all Jira pages and returns one JSON body. The settled progressive UI
therefore requires one of these app-level transports:

- one streamed response (SSE or NDJSON) that emits the Epic index and cumulative page progress; or
- a durable cross-worker manifest with generation-bound progress reads.

Do not publish a provisional count as an exact `0`, final denominator, completed status distribution,
Story-point total, or safe-to-drag signal. The approved visible sequence is: render Board columns and
Epic card shells; show Story counters as loading; replace batch-scoped cumulative Story counts/status
distribution after each accepted child page; then unlock child-derived filters/export only after one
Board-wide barrier proves that every required Product/Tech/other lane, Epic batch, and page completed.
The page snapshots add reconciliation and render cost without reducing Jira work, so the measurement
spike must record progress cadence/frame bytes and the production reducer must update only affected
Epic records.

Both scopes are Epic-first. Component-backed scope indexes by configured Component. The no-Component
selected-sprint fallback indexes bounded Epics across configured Jira projects, then qualifies those
candidates with selected sprint plus all saved Department Teams. This broader fallback may hit the
Epic safety ceiling and ask for Component configuration; it never reads or adapts Catch Up state.

## Current repository behavior

- The frontend starts Product and Tech loads separately (`frontend/src/dashboard.jsx:6613-6614`),
  and both use `GET /api/tasks-with-team-name` (`frontend/src/api/engApi.js:35-72`).
- Each legacy request applies Product/Tech project JQL before fetching
  (`jira_server.py:3285-3299`), so Product/Tech remains Jira-project-derived.
- It fetches child issue rows in pages of 100 but stops collecting at 250
  (`jira_server.py:3352-3412`). Only after collection does it derive Epic keys
  (`jira_server.py:3432-3460`) and make separate Epic-detail/scope searches
  (`jira_server.py:3497-3505`). The browser receives the result only after this completes.
- The existing alert path already proves the correct aggregation primitive: it fetches child rows
  with parent/Epic-link and status, then increments per-Epic buckets
  (`jira_server.py:3063-3185`). It currently performs separate count/distribution searches and
  should not be copied as Board request fan-out.
- The optional-sprint design already specifies one child pass for both qualification and rendering
  (see **Scope queries**) and keeps all child-derived behavior provisional until the whole Board's
  pages and batches complete (see **Canonical Board model and readiness**). Its transport remains
  intentionally gated on measurement (see **Candidate backend transport and cross-worker gate**).

## Speed comparison

| Design | Jira work | First useful content | Completeness | Assessment |
| --- | --- | --- | --- | --- |
| One broad Jira search for Epics and Stories | Potentially one logical paginated search, but must fetch Stories outside the exact Epic-derived scope or rely on duplicated child properties | Potentially early | Cannot express the required dependent child scope exactly | Reject |
| Epic query, then one child query per Epic | 1 + N paginated searches | Uneven | Exact | Reject: request fan-out and rate-limit risk |
| Epic query, then bounded child searches for many Epic keys | 1 + bounded batches/pages | Epic shells first; focused column can complete first | Exact | Recommended Jira access pattern |
| Separate lightweight count/status pass, then full child pass | Duplicates child search work | Counts may appear earlier | Exact only after both passes | Usually slower overall; measure only if child payload is unusually large |
| Epic index plus one child pass carrying all render fields | No duplicate child search | Slightly later first count than a count-only pass; fastest full completion in the normal case | Exact | Recommended default |

The child search should request only required fields. Atlassian explicitly recommends field
filtering, pagination, caching, batching, and avoiding excessive concurrency because quota cost
depends partly on objects/data returned and high request bursts can produce `429` responses.
[Atlassian's Jira Cloud rate-limit and optimization guidance](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/#optimizing-api-usage)

## Recommendation for the production plan

Keep the measurement gate, but test this default first:

- one browser-level progressive flow: a streamed aggregate when runtime flush/backpressure behavior
  passes, otherwise a durable cross-worker manifest with progress reads;
- separate concurrent Product and Tech child-search lanes are acceptable for Board; combining them is
  not required for classification or correctness; retain a bounded `other` child lane instead of
  dropping configured residual projects;
- one child hydration pass across every applicable child-project lane, batched by Epic keys and
  paginated strictly with `nextPageToken`/`isLast`, with at most two child searches in flight;
- `parent`, status, Jira project, and the complete child-card field set in that same pass;
- batch-scoped cumulative per-page snapshots with generation, lane, column, batch, retry-attempt, and
  revision identity, while final authority remains Board-global; and
- no per-Epic count requests and no second count-only child pass unless the measurement spike shows
  a material focused-content win without violating total completion and Jira-call budgets.

This distinguishes **one app-level flow** from **one Jira request**. The former is viable; the latter
does not fit the exact Component-derived Board scope without over-fetching or losing correctness.

## Outcome

Research completed. No production code was changed. The support design and measurement plan were
updated to make the approved progressive sequence, Board-owned source, Jira lane semantics, and
Board-global authority explicit; those plans remain the source of truth for execution.

## Current Accuracy

Accurate for the repository and Atlassian documentation inspected on 2026-09-04. Recheck the Jira
enhanced-search and rate-limit contracts before implementation if Atlassian changes them.
