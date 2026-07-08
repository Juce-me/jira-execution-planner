# Postmortem MRT022: Agent-Branded Branch Names Ignored Git Conventions

**Date**: 2026-07-08
**Severity**: Low
**Status**: Resolved
**Author**: Execution session (subagent-driven development)

## Summary

Coding-agent sessions in this repo repeatedly started work on auto-generated, agent-branded branch names (pattern `claude/<codename>-<hash>`, e.g. `claude/vibrant-edison-6cc684`) instead of a conventionally typed branch. Root `AGENTS.md` forbids this twice over: section 6's non-negotiable "No agent/tool branding … in branch names" and section 10's Git workflow rule to "Use a dedicated `feature/`, `bugfix/`, `improvement/`, or `docs/` branch". The violation had no code impact but recurred across sessions until the user pointed it out.

## Impact

- **Users affected**: none directly; process/convention only, no code or data impact.
- **Symptoms**: sessions began work, including commits, on a branch named after the harness's auto-generated worktree codename rather than a `feature/`|`bugfix/`|`improvement/`|`docs/`-prefixed name.
- **Duration / process failure**: the pattern recurred across sessions rather than being caught once; on 2026-07-08 the user had to notice and ask for the branch to be renamed before further work continued. There was a real risk that a branded branch name could reach the remote or a pull request.

## Root Cause

The agent harness auto-creates the working branch (named after a worktree codename) at session start, before the agent has read `AGENTS.md`. The agent then treated the pre-existing branch name as given infrastructure rather than as a state to check against the repo's conventions. `AGENTS.md` states what a branch name must look like, but had no rule instructing the agent to check and rename the current branch at session start, so the check was never triggered — this is a gap in the instructions, not a one-off oversight by any session.

## Resolution

On 2026-07-08 the session branch was renamed from `claude/vibrant-edison-6cc684` to `docs/root-cleanup-plan`, and subsequent cleanup execution moved to `improvement/root-cleanup-docs-postmortems`. This postmortem, together with the new section 11 learning line (see Prevention), makes the session-start branch check explicit going forward.

## Verification

`git branch --show-current` prints a conventionally named branch (`feature/`|`bugfix/`|`improvement/`|`docs/` prefix) before the first commit of a session.

## Lessons Learned

- A rule that only states the desired end state ("branch names must look like X") is not enough if nothing prompts the agent to check the *current* state against it. The harness creates the branch before the agent reads any instructions, so the check has to be an explicit session-start step, not an assumption that the starting branch is already compliant.

## Action Items

- [x] Rename the session branch away from the agent-branded name (`docs/root-cleanup-plan`, then `improvement/root-cleanup-docs-postmortems`).
- [x] Add a root `AGENTS.md` section 11 learning requiring a `git branch --show-current` check and rename at session start (this postmortem).

## Prevention

- At session start, before the first commit, check `git branch --show-current`. If the branch is auto-generated or agent-branded (e.g. `claude/*`), rename it to `feature/`|`bugfix/`|`improvement/`|`docs/` + a kebab-case summary before proceeding.

## Related Issues

None.

## References

- Root `AGENTS.md` section 6 (no agent/tool branding in branch names) and section 10 (Git workflow branch prefixes).
- Observed 2026-07-08: worktree branch `claude/vibrant-edison-6cc684`.
