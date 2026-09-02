# Postmortem MRT024: Head-Stamped Schema Drift

**Date**: 2026-09-02
**Severity**: High
**Status**: Resolved

## Summary

A preserved local PostgreSQL volume reported the current Alembic head while its physical schema combined objects from different migration states. Startup initially failed on duplicate onboarding columns. After those upgrades became idempotent, authenticated requests exposed missing `scope_provenance` and then a missing `browser_sessions` table. The first repairs followed each visible error instead of comparing the entire affected schema with a clean current head.

## Impact

- The local PostgreSQL runner could not complete migration until the onboarding duplicates were handled.
- After startup succeeded, OAuth refresh and callback paths returned `500` responses.
- The user had to repeat pull, startup, sign-in, and diagnostic collection while preserving local data.

## Root Cause

The Alembic revision table and physical schema were inconsistent. The affected database was stamped at the current head but lacked the complete browser-session branch and four capacity-verification columns; it also initially contained onboarding columns ahead of their recorded revisions and lacked OAuth scope provenance.

The validation strategy amplified the incident. Synthetic tests reproduced one reported object at a time, so each repair proved its immediate case without first establishing the complete difference between the preserved schema and a clean head.

## Timeline

- Migration 0009 failed because `onboarding_done` already existed.
- The 0009 guard allowed progress; migration 0011 then failed because `onboarding_completed_modules` also existed.
- The 0011 guard allowed startup; authenticated reads then failed because `scope_provenance` was missing behind a head stamp.
- Forward migration 0012 repaired provenance; OAuth callback then failed because `browser_sessions` was absent.
- A schema-only inventory was collected from the stopped volume and diffed against an empty PostgreSQL database migrated to clean head.
- The comparison found exactly two remaining gaps: the complete `browser_sessions` contract and four capacity-verification columns.
- Forward migration 0013 repaired the complete audited gap set.

## Resolution

- Made onboarding migrations 0009 and 0011 tolerate equivalent pre-created columns while preserving their data backfills.
- Added online reconciliation migration 0012 for missing OAuth scope provenance.
- Added online reconciliation migration 0013 for the complete audited remaining gap set: browser-session table, indexes, foreign keys, and capacity-verification columns.
- Kept reconciliation downgrades non-destructive because the original branch migrations remain the schema owners.

## Verification

- A regression recreates an 0012-stamped schema missing both audited groups and upgrades it to head.
- The full migration module passes on SQLite.
- PostgreSQL reproduces the exact `create_browser_session` `UndefinedTable` failure before 0013 and succeeds afterward.
- The repaired PostgreSQL table, column, constraint, and index inventory matches a clean current-head database exactly.
- The preserved user backup was inspected only through schema-only artifacts; full data archives remained unopened.

## Lessons Learned

- An Alembic head stamp proves migration metadata, not physical schema parity.
- Repeated missing/duplicate-object failures indicate a schema-class incident, not independent migration bugs.
- After the second drift symptom, collect and compare a complete schema-only inventory before writing another repair.
- Runtime verification must exercise the affected ORM write/read path, not only startup and migration commands.

## Prevention

- Require clean-head schema diffs for multi-object or repeated stamped-schema drift.
- Reconcile the complete verified gap set in one new forward migration; do not keep editing historical revisions or patching only the next error.
- Preserve a private logical or stopped-volume backup before operational recovery and share only schema-only artifacts.

## Action Items

- [x] Add combined drift regression through current head.
- [x] Verify exact PostgreSQL schema parity after reconciliation.
- [x] Verify the OAuth browser-session ORM write before and after repair.
- [x] Add the schema-diff rule to root `AGENTS.md`.
- [ ] Extend startup preflight to validate critical physical schema objects in addition to Alembic head metadata.

## References

- `backend/db/migrations/versions/20260829_0009_user_onboarding.py`
- `backend/db/migrations/versions/20260902_0011_screen_scoped_onboarding.py`
- `backend/db/migrations/versions/20260902_0012_reconcile_scope_provenance.py`
- `backend/db/migrations/versions/20260902_0013_reconcile_head_schema.py`
- `tests/test_db_migrations.py`
- Commits `dffbd6b`, `182aef9`, and `8c4a65e`
