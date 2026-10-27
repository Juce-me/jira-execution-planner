#!/usr/bin/env bash
# Sync the current feature branch with origin/main (docs/plans/EXEC-dashboard-conflict-resistant-architecture.md, Task A4).
#
# Usage: scripts/sync_main.sh [--continue]
# Requires SYNC_GIT_NAME and SYNC_GIT_EMAIL (identity for the merge commit).
#
# Exit codes: 0 synced or up to date, 1 conflicts left open, 2 refused or git
# aborted the merge, 3 post-merge budgets command failed, 4 git fetch failed,
# 5 rebuild failed.
#
# Runs under macOS /bin/bash 3.2: no mapfile/readarray, no empty-array
# expansion. set -e is a safety net only; every stage exits explicitly.
set -Eeuo pipefail

CONTINUE=0
case "${1:-}" in
  "") ;;
  --continue) CONTINUE=1 ;;
  *) echo "usage: scripts/sync_main.sh [--continue]" >&2; exit 2 ;;
esac

# Exported identity variables override `-c user.email`.
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL EMAIL

refuse() {
  echo "SYNC: refused: $1"
  exit 2
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || refuse "not inside a git repository"
cd "$repo_root" || exit 2

branch=$(git symbolic-ref -q --short HEAD) || refuse "detached HEAD"
[ "$branch" != "main" ] || refuse "on main; use a feature branch"

has_merge_head() {
  git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1
}

if has_merge_head; then
  [ "$CONTINUE" -eq 1 ] || refuse "a merge is already in progress (resolve it, then run with --continue)"
else
  [ "$CONTINUE" -eq 0 ] || refuse "--continue needs a merge in progress"
fi

if [ "$CONTINUE" -eq 0 ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    refuse "working tree has tracked changes; commit or stash them first"
  fi
fi

[ -n "${SYNC_GIT_NAME:-}" ] || refuse "SYNC_GIT_NAME is not set"
[ -n "${SYNC_GIT_EMAIL:-}" ] || refuse "SYNC_GIT_EMAIL is not set"

# origin/main's .gitattributes (when it exists) applies even on a branch that
# lacks the file, so union merges work on the first sync.
ATTR_FILE=""
cleanup() {
  if [ -n "$ATTR_FILE" ]; then rm -f "$ATTR_FILE"; fi
}
trap cleanup EXIT

prepare_attributes() {
  if git cat-file -e origin/main:.gitattributes 2>/dev/null; then
    ATTR_FILE=$(mktemp "${TMPDIR:-/tmp}/sync_main_attrs.XXXXXX") || exit 2
    git show origin/main:.gitattributes > "$ATTR_FILE" || exit 2
  fi
}

# git with the supplied identity and per-invocation rerere; no persistent config.
g() {
  if [ -n "$ATTR_FILE" ]; then
    git -c "user.name=$SYNC_GIT_NAME" -c "user.email=$SYNC_GIT_EMAIL" \
      -c rerere.enabled=true -c rerere.autoupdate=false \
      -c "core.attributesFile=$ATTR_FILE" "$@"
  else
    git -c "user.name=$SYNC_GIT_NAME" -c "user.email=$SYNC_GIT_EMAIL" \
      -c rerere.enabled=true -c rerere.autoupdate=false "$@"
  fi
}

origin_tracks_dist() {
  [ -n "$(git ls-tree -r --name-only origin/main -- frontend/dist 2>/dev/null | head -n 1)" ]
}

head_tracks_dist() {
  [ -n "$(git ls-files -- frontend/dist | head -n 1)" ]
}

OLD_HEAD=$(git rev-parse HEAD) || exit 2

# Step 4: rebuild when needed, commit when a merge is open, run budgets.
finish() {
  local touched=""
  if has_merge_head; then
    touched=$(git diff --cached --name-only HEAD) || exit 2
  else
    touched=$(git diff --name-only "$OLD_HEAD" HEAD) || exit 2
  fi

  local need_build=0 lock_changed=0
  if printf '%s\n' "$touched" | grep -Eq '^(frontend/dist/|frontend/src/|package\.json$|package-lock\.json$|scripts/build_dashboard\.mjs$)'; then
    need_build=1
  fi
  if printf '%s\n' "$touched" | grep -Eq '^package-lock\.json$'; then
    lock_changed=1
  fi
  if [ ! -f frontend/dist/dashboard.js ]; then
    need_build=1
  fi

  if [ "$need_build" -eq 1 ]; then
    echo "SYNC: rebuild"
    if [ "$lock_changed" -eq 1 ]; then
      npm ci || { echo "SYNC: npm ci failed"; exit 5; }
    fi
    npm run build || { echo "SYNC: npm run build failed"; exit 5; }
    if has_merge_head && origin_tracks_dist; then
      git add -A -- frontend/dist || exit 5
    fi
  fi

  if has_merge_head; then
    if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
      refuse "unmerged paths remain after the rebuild"
    fi
    g commit --no-edit -q || { echo "SYNC: git commit failed"; exit 2; }
    echo "SYNC: committed $(git rev-parse --short HEAD)"
  fi

  local budgets_cmd="${JEP_SYNC_BUDGETS_CMD:-}"
  if [ -z "$budgets_cmd" ]; then
    local py="${JEP_TEST_PYTHON:-.venv/bin/python}"
    budgets_cmd="$(printf '%q' "$py") -m unittest tests.test_codebase_structure_budgets"
  fi
  if sh -c "$budgets_cmd"; then
    echo "SYNC: budgets ok"
  else
    echo "SYNC: budgets command failed"
    exit 3
  fi
  echo "SYNC: done"
  exit 0
}

if [ "$CONTINUE" -eq 1 ]; then
  # Step 4 entry: validate the hand-resolved merge.
  prepare_attributes
  unmerged=$(git diff --name-only --diff-filter=U) || exit 2
  if [ -n "$unmerged" ]; then
    echo "SYNC: unmerged paths remain:"
    printf '  %s\n' "$unmerged"
    refuse "resolve and git add every unmerged path first"
  fi
  unstaged=$(git diff --name-only) || exit 2
  if [ -n "$unstaged" ]; then
    echo "SYNC: unstaged edits to tracked files:"
    printf '  %s\n' "$unstaged"
    refuse "git add intended edits or revert them first"
  fi
  marked=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if git grep -q -I --cached -E '^(<<<<<<< |>>>>>>> )' -- "$f"; then
      marked="$marked  $f
"
    fi
  done <<EOF
$(git diff --cached --name-only HEAD)
EOF
  if [ -n "$marked" ]; then
    echo "SYNC: conflict markers found in:"
    printf '%s' "$marked"
    refuse "remove the conflict markers and git add the files"
  fi
  finish
fi

# Step 2: fetch and merge.
git fetch origin main || { echo "SYNC: git fetch failed"; exit 4; }
prepare_attributes

merge_out=""
merge_rc=0
if git merge-base --is-ancestor HEAD origin/main; then
  merge_out=$(g merge --ff-only origin/main 2>&1) || merge_rc=$?
else
  if head_tracks_dist && ! origin_tracks_dist; then
    merge_out=$(g -c merge.renames=false merge --no-commit --no-ff origin/main 2>&1) || merge_rc=$?
  else
    merge_out=$(g merge --no-commit --no-ff origin/main 2>&1) || merge_rc=$?
  fi
fi
printf '%s\n' "$merge_out"

if ! has_merge_head; then
  if [ "$merge_rc" -ne 0 ]; then
    refuse "git aborted the merge (see the message above)"
  fi
  NEW_HEAD=$(git rev-parse HEAD) || exit 2
  if [ "$NEW_HEAD" = "$OLD_HEAD" ]; then
    echo "SYNC: up to date"
  else
    echo "SYNC: fast-forwarded"
  fi
  finish
fi

# Step 3: generated dist is never merged by hand.
if ! origin_tracks_dist; then
  git rm -rq --cached --ignore-unmatch frontend/dist || refuse "could not untrack frontend/dist"
fi

unmerged=$(git diff --name-only --diff-filter=U) || exit 2
if [ -z "$unmerged" ]; then
  echo "SYNC: merge staged"
  finish
fi

generated=""
handedit=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    frontend/dist/*) generated="$generated  $f
" ;;
    *) handedit="$handedit  $f
" ;;
  esac
done <<EOF
$unmerged
EOF

echo "GENERATED:"
if [ -n "$generated" ]; then printf '%s' "$generated"; else echo "  (none)"; fi
echo "HAND-EDIT:"
if [ -n "$handedit" ]; then printf '%s' "$handedit"; else echo "  (none)"; fi

if [ -z "$handedit" ]; then
  finish
fi

echo "SYNC: conflicts left open. Resolve, git add, then run: scripts/sync_main.sh --continue"
echo "SYNC: or commit with the supplied identity (a plain git commit would use the configured address):"
printf 'SYNC: commit command: git -c %s -c %s commit --no-edit\n' \
  "$(printf '%q' "user.name=$SYNC_GIT_NAME")" "$(printf '%q' "user.email=$SYNC_GIT_EMAIL")"
exit 1
