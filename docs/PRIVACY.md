# Privacy Notice for Self-Hosted Deployments

Effective date: 25 August 2026

Jira Delivery Planner is self-hosted software. This project does not provide a
central hosted application, user-account service, or database. The person or
organization that deploys an instance (the **deployment operator**) controls
that instance and is responsible for its privacy practices.

This notice is intended for self-hosted instances that allow users to sign in
through a privately shared Atlassian OAuth 2.0 (3LO) application. It does not
describe distribution through the Atlassian Marketplace.

This notice describes the data the software can process. It does not replace
the deployment operator's own privacy notice. Before allowing users to sign
in, the deployment operator should provide its identity and contact details,
the purposes and legal bases for processing, hosting and storage locations,
retention periods, subprocessors, user-rights process, and any other notices
required by applicable law or organizational policy.

## Data the software can process

Depending on the features and run mode enabled by the deployment operator, an
instance can process:

- Atlassian identity data, including an Atlassian account identifier, display
  name, email address, account status, accessible Atlassian sites, and granted
  OAuth scopes;
- Atlassian OAuth access and refresh tokens used to make Jira requests on the
  signed-in user's behalf;
- an optional user-supplied Atlassian API token and associated email address
  used for Home/Townsquare metadata when the EPM integration is enabled;
- operator-supplied Atlassian account email addresses and API tokens when a
  legacy Basic-authentication or workspace service-integration mode is used;
- Jira and Home/Townsquare data that the signed-in user is permitted to access,
  including projects, goals, issues, issue fields, assignees, teams, sprints,
  dependencies, statuses, estimates, and planning metadata;
- application configuration, group preferences, private view configuration,
  scenario-planning drafts and versions, collaboration presence and locks, and
  audit records; and
- browser-side UI preferences and planning selections stored in
  `localStorage`, an analytics login-deduplication marker in `sessionStorage`,
  and authentication/session and CSRF state in a cookie.

The software uses this data to authenticate users, authorize application
features, retrieve and display Atlassian information, support planning and
collaboration workflows, preserve user and workspace configuration, secure
credentials, diagnose failures, and maintain security audit history.

The software does not bypass Atlassian permissions. Jira requests made through
OAuth are limited by the signed-in user's Atlassian permissions and the scopes
granted to the OAuth application. In Basic-authentication and service-account
modes, requests use the permissions of the account configured by the deployment
operator rather than the permissions of each signed-in user. The deployment
operator is responsible for restricting instance access and configuring an
account whose permissions are appropriate for every authorized user.

## Storage and security

The deployment operator chooses and controls the application server, database,
backups, logs, network, encryption infrastructure, and hosting jurisdiction.

In the database-backed OAuth mode, the software stores OAuth and connected
Home/Townsquare token material encrypted in the database. Encryption keys and
other application secrets remain deployment-managed configuration and should
not be committed to the source repository. Other application data can be
stored in the operator's database, local configuration files, server memory,
logs, browser storage, and backups, depending on the selected run mode and
features.

The optional local/development OAuth store can persist token-bearing session
data in a server-side JSON file when the deployment operator explicitly enables
that mode. Legacy Basic-authentication credentials can be supplied through
deployment environment configuration. These modes are deployment-managed and
must not expose their token or credential files to application users or source
control.

The software uses short-lived in-memory caches for several Jira and
Home/Townsquare views. Legacy or local-file modes can also write local cache and
configuration files. Cache expiration does not determine how long database
records, logs, configuration files, or backups are retained.

## External services

An instance communicates with Atlassian to authenticate users and provide the
requested Jira and Home/Townsquare functionality. Atlassian processes those
requests under the agreements and notices applicable to the user's Atlassian
account and the deployment operator's Atlassian organization.

The application page loads fonts from Google Fonts. The user's browser may
therefore send ordinary connection information, such as an IP address and user
agent, to Google when the page loads.

Product analytics through Google Tag Manager and Google Analytics are disabled
by default. If the deployment operator sets `GA4_ENABLED=true`, the user's
browser sends the configured Google Analytics property pseudonymous usage
information, logical page/view activity, feature interactions, result states,
and ordinary Google-managed request metadata. App-owned analytics events are
designed not to include raw Atlassian account identifiers, database user IDs,
emails, display names, Jira issue keys, Jira or Home URLs, JQL, tokens, or
user-entered free text. The deployment operator is responsible for deciding
whether analytics may be enabled and for providing any required notice or
choice. The detailed analytics contract is documented in
[README_ANALYTICS.md](README_ANALYTICS.md).

Unless disabled with `UPDATE_CHECK=false`, the dashboard requests version
information when it loads. The server can then contact the configured Git
remote to compare the installed revision with the configured branch, subject
to a short server-side result cache. For the default public repository, that
remote is normally hosted by GitHub. This check sends ordinary server
connection metadata to the remote Git host; it does not send Jira content or
application user records.

The deployment operator may configure additional infrastructure or services
that are not supplied by this repository. Those services are governed by the
operator's own configuration and privacy notice.

## Retention and deletion

This project does not impose one retention period across self-hosted instances.
The deployment operator determines retention for database records, audit
history, local files, logs, browser data, and backups and is responsible for
honoring applicable access, correction, export, and deletion requests.

Logging out ends the browser session but does not necessarily delete OAuth
connections, application records, logs, or backups. Revoking a connected
Home/Townsquare token removes the active encrypted token from the application
database and records the revocation in the security audit history. Users can
also revoke the application's Atlassian OAuth grant through their Atlassian
account. These actions do not automatically remove all other records held by a
deployment or copies retained in backups.

Users can clear browser-stored preferences through their browser controls. For
all other privacy requests, users should contact the operator of the instance
they use. The source-project repository cannot access or delete data held by an
independently operated instance.

## Changes to this notice

This notice can change when the software's data handling changes. Deployment
operators should review updates and keep their instance-specific privacy notice
aligned with the version and configuration they run.
