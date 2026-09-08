# Postmortem MRT025: PR Publication Transaction Failures

**Date**: 2026-09-08
**Severity**: High
**Status**: In Progress
**Author**: Codex execution session

## Summary

Publication of Board Configuration horizontal scrolling in PR #170 repeated a commit and pull-request procedure failure that the operator reports has now occurred four times. The session treated a successful commit, push, and `gh pr` exit code as completion without first proving the proposed commit range, remote file set, commit history, and rendered pull-request body together.

The first published PR included unrelated environment and local-runner changes. Cleanup commits reduced the final file diff to the ten planned files, but the PR retained six commits rather than the requested atomic publication history. The PR description was passed through a JavaScript-to-shell quoting boundary that converted Markdown line breaks into literal `\n` text. The same unsafe construction was used twice, and JSON readback was accepted without inspecting the rendered GitHub result. The operator's screenshot, not the publication procedure, exposed the malformed description.

## Impact

- Reviewers received a malformed, difficult-to-read PR description containing literal `\n` sequences.
- PR #170 initially exposed files outside the immutable execution-plan map.
- Two cleanup commits were required after the PR opened, increasing the PR to six commits and violating the requested atomic publication procedure.
- The operator had to inspect the GitHub UI and report a recurrence that automated and command-line verification should have caught.
- Product code and generated assets were not corrupted; the final PR file diff was reduced to the intended ten files and CI passed.

## Root Cause

The publication workflow was not treated as one gated transaction.

1. **The wrong Git state was verified.** The session checked that the working tree was clean and that the latest local tests passed, but did not first run and approve both `git log origin/main..HEAD` and `git diff --name-status origin/main...HEAD`. A clean working tree says nothing about unrelated commits already present in the branch.
2. **The immutable file map was checked after publication.** Remote PR metadata was inspected only after `gh pr create`. This reversed the required order: the proposed remote range must be proven before any push or PR creation.
3. **Atomicity was reduced to final-tree correctness.** Once unrelated changes were found, follow-up cleanup and outcome commits were added. The final file tree became correct, but the requested single atomic publication did not. The session should have stopped and requested authorization for a clean-history reconstruction instead of silently converting a history problem into more commits.
4. **Markdown crossed an unsafe encoding boundary.** The PR body was constructed with `JSON.stringify(body)` and interpolated into a shell command using `--body`. JSON escapes newlines as `\n`; a shell double-quoted argument does not translate `\n` into line breaks, so GitHub stored the backslash and `n` characters.
5. **Verification checked data, not presentation.** `gh pr view --json body` was read as serialized JSON and the GitHub page was not visually inspected. The procedure therefore confirmed that text existed but not that Markdown rendered correctly.
6. **There was no recurrence gate.** Existing guidance covered branch naming, allowed files, build reproducibility, and waiting for push authorization, but did not define one mandatory pre-push/PR checklist with a stop condition. The operator's report that this is the fourth occurrence shows that reminders distributed across instructions have not been sufficient.

## Timeline

- 2026-09-07: Commit `7addded` recorded the feature implementation but also contained unrelated local-runner work; the branch ancestry also carried an unrelated environment example change.
- 2026-09-08: The operator authorized commit, push, and PR creation.
- The session found local commit `6ceb9c8` after beginning publication verification and preserved it on a separate local runner branch.
- The session explicitly pushed feature SHA `7addded`, then opened PR #170 before inspecting the PR's complete remote diff and commit range.
- GitHub reported 13 changed files, including `.env.example`, a local-runner work artifact, and a local-runner test.
- Cleanup commit `9429b55` removed those three files from the final PR diff.
- Outcome commit `4a27ba9` updated the execution plan after publication, bringing the PR to six commits.
- Both `gh pr create` and `gh pr edit` passed a JSON-stringified body through the shell. Both commands exited successfully while preserving literal `\n` characters.
- All four GitHub checks passed, but no rendered-body check was performed.
- At 10:06 CEST, the operator supplied a GitHub screenshot showing the malformed PR description and identified the fourth recurrence.

## Resolution

Completed containment:

- The unrelated runner commit remains preserved on a separate local branch and was not pushed into PR #170.
- The final PR file diff contains exactly the ten files allowed by the reviewed plan.
- At the operator's correction, this postmortem was moved onto the related `bugfix/local-runner-lock-replacement` branch and the incorrectly created dedicated docs branch was deleted locally and remotely.
- A root `AGENTS.md` publication rule now makes commit-range, file-map, body-input, rendered-body, and remote-head checks one mandatory gate.
- PR #170's body was replaced through `gh pr edit --body-file -`; CLI readback contained real line breaks, an explicit check found no literal `\n` sequences, and the operator confirmed the rendered PR looks normal.

Still requiring operator direction:

- Decide whether PR #170's six-commit history should be reconstructed as the requested atomic publication. That would require an explicitly authorized history rewrite and force-push; this postmortem does not infer that authority.

## Verification

- The operator screenshot shows literal `\n` sequences throughout the PR summary and verification sections.
- GitHub reported PR #170 at head `4a27ba9` with six commits.
- The final GitHub file list contains the intended ten files, confirming that file containment was repaired but commit atomicity was not.
- GitHub's four CI checks passed, demonstrating that CI correctness did not detect presentation or publication-history defects.
- `gh pr view --json body --jq .body` returned normally formatted multiline Markdown after the repair, and `.body | contains("\\n")` returned `false`; the operator confirmed PR #170 looks normal without further browser automation.
- `git branch --show-current` reports `bugfix/local-runner-lock-replacement` for these documentation changes; that branch has no upstream association with PR #170.

## Lessons Learned

- A clean working tree is not evidence of a clean PR. Publication scope is the merge-base-to-head commit range.
- Correct final files and correct commit history are separate acceptance criteria.
- A successful CLI exit code proves transport success, not correct Markdown rendering.
- Any content crossing JavaScript, shell, CLI, JSON, and Markdown boundaries must use an input mechanism that preserves bytes without re-escaping.
- Post-publication checks are containment, not substitutes for pre-publication gates.
- A fourth recurrence requires a procedural stop gate, not another reminder to be careful.

## Action Items

- [x] Document the repeated failure and its verified causes in MRT025.
- [x] Add a repository-wide PR publication transaction rule to root `AGENTS.md`.
- [x] Commit MRT025 on `bugfix/local-runner-lock-replacement` and delete the mistakenly created dedicated docs branch.
- [x] Verify that PR #170's final file diff contains exactly the ten planned files.
- [x] Repair PR #170 through stdin, verify it contains no literal escaped newlines, and record the operator's rendered-page confirmation.
- [ ] Ask the operator whether to reconstruct PR #170 as one atomic publication commit; do not force-push without explicit authorization.
- [ ] Before every future PR, capture the approved base/head SHAs, exact commit list, exact changed-file list, clean status, and rendered PR body in one final evidence block.

## Prevention

Treat publication as an all-or-stop transaction:

1. Fetch the target base and resolve immutable base and head SHAs.
2. Run `git status --short`, `git log --oneline origin/main..HEAD`, and `git diff --name-status origin/main...HEAD` before committing or pushing.
3. Compare the commit count and every changed path with the approved publication contract. If either differs, stop before push/PR and ask whether history may be reconstructed.
4. Run the required tests and committed-revision build at the exact proposed head.
5. Send multiline PR Markdown through stdin with `gh pr create --body-file -` or `gh pr edit --body-file -`; never synthesize it with JSON escaping inside a shell `--body` argument.
6. Read back the body as rendered text, inspect the GitHub page, verify the remote head SHA and changed-file list, and only then report publication complete.
7. If any post-publication check fails, report the PR as malformed and stop. Do not stack cleanup commits or rewrite history without operator authorization.

## Related Issues

- [MRT016](./MRT016-exec-02-plan-file-map-drift.md): file-map validation must precede execution and publication.
- [MRT022](./MRT022-agent-branded-branch-names.md): recurring Git-process failures require an explicit session gate.
- [PR #170](https://github.com/Juce-me/jira-execution-planner/pull/170)
- [Issue #167](https://github.com/Juce-me/jira-execution-planner/issues/167)

## References

- Commits `7addded`, `9429b55`, and `4a27ba9`.
- Operator screenshot captured 2026-09-08 at 10:06 CEST.
- Root `AGENTS.md` Git workflow and project learnings.
- `docs/plans/EXEC-board-configuration-horizontal-scroll.md` atomic publication requirement.
