# FUTURE: Dynamic Jira Catch Up Webhooks

> **Status:** Deferred and not selected. Do not implement until the scope is explicitly reopened and converted into a reviewed `EXEC-*` plan.

## Current Decision

Catch Up continues to rely on its existing full Jira refresh path. Dynamic Jira webhooks are an unreleased option only; they are not part of the current product direction, configuration, or runtime behavior.

## Deferred Option

If full refresh later becomes too slow or too stale, JDP could register a Jira Cloud `jira:issue_updated` webhook for assignee changes and notify active Catch Up browser sessions through an authenticated server-sent events channel.

The preferred registration unit would be one webhook per Atlassian site or workspace, not one webhook per Jira issue. Its JQL would cover the union of Jira projects used by departments with active Catch Up sessions, for example:

```text
project IN (PROJECT_A, PROJECT_B) AND issuetype IN (Story, Epic)
```

JDP would map each received issue event back to the affected active department or departments. Department membership based on Team fields, labels, sprint state, or other JDP configuration would remain an application-side decision rather than being assumed to be expressible in Jira's restricted dynamic-webhook JQL.

## Candidate Lifecycle

1. The first authenticated Catch Up session creates or acquires a short-lived server-side activity lease for its department.
2. JDP computes the union of Jira projects required by all active department leases.
3. JDP ensures one signed dynamic webhook covers that union and filters issue updates to the assignee field.
4. The webhook receiver verifies the Jira signature or JWT, deduplicates retries, acknowledges quickly, and queues processing.
5. JDP batches related issue changes and sends a scoped invalidation event only to affected authenticated Catch Up sessions.
6. The frontend performs a debounced scoped refresh or fetches changed issues; it does not run one full refresh per webhook delivery.
7. After the final active lease expires, JDP waits through an idle grace period before deleting the webhook.
8. A newly opened Catch Up session always performs the normal authoritative load first, recovering changes made while no webhook was registered.

Because the OAuth dynamic-webhook API has create, delete, and refresh operations but no in-place update operation, a scope change would create the replacement before deleting the old registration. Processing must tolerate duplicate delivery during that overlap.

## Constraints To Resolve Before Reopening

- JDP needs a publicly reachable HTTPS callback; a loopback-only Flask server cannot receive Jira Cloud events.
- The OAuth app would need Jira webhook-management scopes and a deliberate re-consent rollout, or the integration would need a separately reviewed signed admin-webhook ownership model.
- OAuth dynamic webhooks are limited per app, user, and tenant and expire after 30 days, so registration ownership and renewal cannot depend on an arbitrary browser user remaining signed in.
- Active-user tracking needs authenticated SSE connections, lease expiry, and shared coordination suitable for multiple server workers.
- Webhook identifiers and payload signatures must be verified; retries and overlapping registrations must be idempotent.
- Initial dashboard performance must not acquire, replace, or renew webhooks synchronously on the critical Catch Up data-loading path.
- Cache invalidation must preserve the existing selected sprint, department scope, Product/Tech hierarchy, and progressive Catch Up alert behavior.
- The implementation must include an analytics impact review. Automatic webhook receipt and cache invalidation should not create a user-interaction event unless a separately approved reporting need exists.

## Reopen Criteria

Convert this document into a reviewed `EXEC-*` plan only when all of the following are true:

- measured full-refresh latency or staleness justifies the additional distributed-system complexity;
- JDP has a stable public HTTPS deployment target;
- webhook registration ownership and OAuth/admin authorization are decided;
- active-session coordination and durable renewal can be implemented outside the initial-load path;
- the desired dashboard response is specified precisely, including whether it patches assignee data or invalidates and reloads a scoped cohort.

## Reference

- [Atlassian Jira Cloud webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
- [Jira Cloud dynamic webhook REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-webhooks/)
