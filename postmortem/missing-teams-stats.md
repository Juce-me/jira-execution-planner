# Postmortem: Missing Teams in Stats View

## Summary
- Team selector and stats tables showed fewer teams than the JQL filter contained.

## Root Causes
- Team lists were derived from returned issues/stats instead of the full Team[Team] filter list, so teams with zero issues were omitted.
- Team field ID resolution was inconsistent, which dropped teams when fallback fields were used.
- Cached stats and fresh UI state mixed together, masking missing teams during refresh.

## Fix
- Always scope teams to the configured Team[Team] IDs and use a single authoritative source (config/JQL), not issue-derived results.

## Prevention
- Use Team[Team] IDs from the JQL filter as the authoritative team list.
- Never derive teams from returned issues.
- If a team has zero issues, still show it with zeros.
- Resolve Team[Team] field ID once and reuse it.
