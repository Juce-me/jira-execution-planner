#!/usr/bin/env python3
"""Measure how often merges of main into branches would conflict, read-only.

Each merge is replayed with `git merge-tree --write-tree` into a temporary
object directory, so the repository's objects and worktree stay unchanged.
Attributes come from an empty tree (history) or from HEAD's tree (--attrs head),
never from the worktree.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

MIN_GIT = (2, 43)
CLASSES = ("dist", "registries", "plan docs", "dashboard.jsx", "tests", "other")
REGISTRIES = {
    "AGENTS.md",
    "docs/ontology.md",
    "docs/README_ANALYTICS.md",
    "docs/plans/README.md",
    "docs/postmortem/README.md",
    "docs/TODO.md",
    "docs/design-system.md",
    "scripts/extraction_lint/owner_budgets.json",
    "tests/test_codebase_structure_budgets.py",
}
MECHANICAL = ("dist", "registries", "plan docs")


def classify(path):
    if path.startswith("frontend/dist/"):
        return "dist"
    if path in REGISTRIES:
        return "registries"
    if path.startswith("docs/plans/"):
        return "plan docs"
    if path == "frontend/src/dashboard.jsx":
        return "dashboard.jsx"
    if path.startswith("tests/"):
        return "tests"
    return "other"


def git(args, env=None, stdin=None):
    return subprocess.run(["git"] + args, capture_output=True, env=env, stdin=stdin)


def git_text(args, env=None):
    result = git(args, env)
    if result.returncode != 0:
        raise RuntimeError("git %s failed: %s" % (" ".join(args), result.stderr.decode(errors="replace").strip()))
    return result.stdout.decode(errors="replace")


class Replayer:
    """Temporary object directory with the repository as alternate."""

    def __init__(self, attrs):
        objects = git_text(["rev-parse", "--git-path", "objects"]).strip()
        self.tmp = tempfile.mkdtemp(prefix="measure-merge-")
        self.env = dict(
            os.environ,
            GIT_OBJECT_DIRECTORY=self.tmp,
            GIT_ALTERNATE_OBJECT_DIRECTORIES=os.path.abspath(objects),
        )
        empty = subprocess.run(
            ["git", "mktree"], stdin=subprocess.DEVNULL, capture_output=True, env=self.env
        ).stdout.decode().strip()
        self.attr_tree = empty
        if attrs == "head":
            self.attr_tree = git_text(["rev-parse", "HEAD^{tree}"]).strip()

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def probe(self):
        result = git(["--attr-source=" + self.attr_tree, "merge-tree", "-h"], self.env)
        text = (result.stdout + result.stderr).decode(errors="replace")
        if "--write-tree" not in text:
            return "merge-tree does not support --write-tree with --attr-source"
        return None

    def replay(self, p1, p2):
        """Return None when unreplayable, else {path: hunks} for conflicted paths."""
        result = git(
            ["--attr-source=" + self.attr_tree, "merge-tree", "--write-tree", "-z", p1, p2],
            self.env,
        )
        if result.returncode == 0:
            return {}
        if result.returncode != 1:
            return None
        tokens = result.stdout.split(b"\0")
        tree = tokens[0].decode()
        conflicts = {}
        for token in tokens[1:]:
            if not token:
                break
            path = os.fsdecode(token.split(b"\t", 1)[1])
            blob = git(["cat-file", "blob", "%s:%s" % (tree, path)], self.env)
            markers = sum(1 for line in blob.stdout.split(b"\n") if line.startswith(b"<<<<<<< "))
            conflicts[path] = max(1, markers) if blob.returncode == 0 else 1
        return conflicts


def unsupported_reason():
    """One clear message when this git cannot run the measurement, else None."""
    try:
        match = re.search(r"(\d+)\.(\d+)", git_text(["--version"]))
    except (OSError, RuntimeError) as exc:
        return "error: cannot run git: %s" % exc
    found = (int(match.group(1)), int(match.group(2))) if match else (0, 0)
    message = "error: measure_merge_conflicts needs git >= %d.%d (merge-tree --write-tree with --attr-source); found %s" % (
        MIN_GIT + ("%d.%d" % found,)
    )
    if found < MIN_GIT:
        return message
    replayer = Replayer("none")
    try:
        return message if replayer.probe() else None
    finally:
        replayer.close()


def merges_from(args, refs):
    out = git_text(["rev-list", "--merges", "--parents", "--since=" + args.since] + refs)
    return [tuple(line.split()) for line in out.splitlines() if line]


def resolve_merge_list(path):
    merges = []
    with open(path) as handle:
        for line in handle:
            sha = line.split("#", 1)[0].strip()
            if sha:
                parts = git_text(["rev-list", "--parents", "-n", "1", sha]).split()
                merges.append(tuple(parts))
    return merges


def measure(replayer, merges, list_conflicts):
    examined = skipped = conflicted = only_mechanical = 0
    counts = {name: 0 for name in CLASSES}
    hunks = {name: 0 for name in CLASSES}
    listing = []
    for merge in merges:
        result = replayer.replay(merge[1], merge[2])
        if result is None:
            skipped += 1
            continue
        examined += 1
        if not result:
            continue
        conflicted += 1
        touched = set()
        for path, count in result.items():
            name = classify(path)
            touched.add(name)
            hunks[name] += count
        for name in touched:
            counts[name] += 1
        if touched <= set(MECHANICAL):
            only_mechanical += 1
        listing.append("conflict %s %s" % (merge[0][:8], ",".join(sorted(touched))))
    pct = "n/a" if examined == 0 else "%d%%" % round(100 * conflicted / examined)
    lines = [
        "examined: %d" % examined,
        "skipped: %d" % skipped,
        "conflicted: %d (%s)" % (conflicted, pct),
        "only dist/registries/plan docs: %d" % only_mechanical,
    ]
    for name in CLASSES:
        lines += ["class %s: %d" % (name, counts[name]), "hunks %s: %d" % (name, hunks[name])]
    return lines + (listing if list_conflicts else [])


def limited(merges, limit):
    return merges[:limit] if limit else merges


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main", default="origin/main")
    parser.add_argument("--since", default="2026-09-01")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--local", action="store_true", help="include local branches, not only remote refs")
    parser.add_argument("--all-merges", action="store_true", help="also replay branch-to-branch merges, as a separate population")
    parser.add_argument("--merge-list", help="file of merge SHAs to replay instead of the discovered population")
    parser.add_argument("--attrs", choices=("head", "none"), default="none")
    parser.add_argument("--list", action="store_true", help="print each conflicted merge with its classes")
    args = parser.parse_args(argv)

    reason = unsupported_reason()
    if reason:
        print(reason, file=sys.stderr)
        return 2

    blocks = []
    summary = []
    if args.merge_list:
        merges = resolve_merge_list(args.merge_list)
        summary.append("population merge-list: %d" % len(merges))
        blocks.append(("merge-list", limited(merges, args.limit)))
    else:
        chain = set(git_text(["rev-list", "--first-parent", args.main]).split())
        remote_refs = [args.main, "--remotes"]
        refs = remote_refs + (["--branches"] if args.local else [])
        raw = merges_from(args, refs)
        remote = {m[0] for m in merges_from(args, remote_refs)}
        octopus = [m for m in raw if len(m) != 3]
        landings = [m for m in raw if len(m) == 3 and m[0] in chain]
        filtered = [m for m in raw if len(m) == 3 and m[0] not in chain]
        sync = [m for m in filtered if m[2] in chain]
        other = [m for m in filtered if m[2] not in chain]
        summary += [
            "population raw: %d" % len(raw),
            "population filtered: %d (excluded %d: %d octopus, %d on main chain)"
            % (len(filtered), len(raw) - len(filtered), len(octopus), len(landings)),
            "population remote-only: %d (excluded %d local-only)"
            % (sum(1 for m in filtered if m[0] in remote), sum(1 for m in filtered if m[0] not in remote)),
            "population main-sync: %d" % len(sync),
        ]
        blocks.append(("main-sync", limited(sync, args.limit)))
        if args.all_merges:
            summary.append("population branch-to-branch: %d" % len(other))
            blocks.append(("branch-to-branch", limited(other, args.limit)))

    print("ref: %s since %s" % (args.main, args.since))
    for line in summary:
        print(line)
    replayer = Replayer(args.attrs)
    try:
        for name, merges in blocks:
            print("== %s ==" % name)
            for line in measure(replayer, merges, args.list):
                print(line)
    finally:
        replayer.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
