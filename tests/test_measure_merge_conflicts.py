import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "measure_merge_conflicts.py"
SCRATCH = ROOT / "tmp" / "a0"

IDENTITY = {
    "GIT_AUTHOR_NAME": "Test Author",
    "GIT_AUTHOR_EMAIL": "author@example.invalid",
    "GIT_COMMITTER_NAME": "Test Committer",
    "GIT_COMMITTER_EMAIL": "committer@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}

BLOCK_CLASSES = ("dist", "registries", "plan docs", "dashboard.jsx", "tests", "other")


def _unsupported_reason():
    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        import measure_merge_conflicts
    finally:
        sys.path.pop(0)
    return measure_merge_conflicts.unsupported_reason()


class GitRepoCase(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.repo = Path(tempfile.mkdtemp(dir=SCRATCH))
        self.addCleanup(shutil.rmtree, self.repo, True)
        self.env = dict(os.environ, **IDENTITY)

    def git(self, *args, check=True):
        result = subprocess.run(
            ["git", "-c", "commit.gpgsign=false", *args],
            cwd=self.repo, env=self.env, capture_output=True, text=True,
        )
        if check and result.returncode != 0:
            self.fail("git %s failed: %s%s" % (" ".join(args), result.stdout, result.stderr))
        return result

    def write(self, name, text):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit_file(self, name, text, message):
        self.write(name, text)
        self.git("add", name)
        self.git("commit", "-m", message)

    def merge(self, other, resolved=None):
        result = self.git("merge", "--no-ff", "-m", "merge " + other, other, check=False)
        if result.returncode != 0:
            self.assertIsNotNone(resolved, "unexpected conflict: " + result.stdout)
            for name, text in resolved.items():
                self.write(name, text)
                self.git("add", name)
            self.git("commit", "--no-edit")

    def run_script(self, *args):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=self.repo, env=self.env, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.splitlines()

    def object_count(self):
        out = self.git("count-objects", "-v").stdout
        return {k: v for k, v in (l.split(": ") for l in out.splitlines())}

    @staticmethod
    def block(lines, header):
        start = lines.index(header) + 1
        end = next((i for i in range(start, len(lines)) if lines[i].startswith("== ")), len(lines))
        return lines[start:end]

    @staticmethod
    def expected_block(examined, skipped, conflicted, pct, only, classes):
        out = [
            "examined: %d" % examined,
            "skipped: %d" % skipped,
            "conflicted: %d (%s)" % (conflicted, pct),
            "only dist/registries/plan docs: %d" % only,
        ]
        for name in BLOCK_CLASSES:
            count, hunks = classes.get(name, (0, 0))
            out += ["class %s: %d" % (name, count), "hunks %s: %d" % (name, hunks)]
        return out


class MeasureMergeConflictsTests(GitRepoCase):
    def setUp(self):
        super().setUp()
        reason = _unsupported_reason()
        if reason:
            print(reason)
            self.skipTest(reason)

    def build_history(self):
        self.git("init", "-b", "main")
        self.commit_file("AGENTS.md", "registry: base\n", "base")
        self.commit_file("other.txt", "other\n", "other")
        base = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("checkout", "-b", "conflict-branch")
        self.commit_file("AGENTS.md", "registry: branch\n", "branch edit")
        self.git("checkout", "-b", "clean-branch", base)
        self.commit_file("clean.txt", "clean\n", "clean edit")
        self.git("checkout", "main")
        self.commit_file("AGENTS.md", "registry: main\n", "main edit")
        self.git("checkout", "conflict-branch")
        self.merge("main", {"AGENTS.md": "registry: resolved\n"})
        self.git("checkout", "clean-branch")
        self.merge("main")
        self.git("checkout", "--orphan", "orphan")
        self.git("rm", "-rf", ".")
        self.commit_file("orphan.txt", "orphan\n", "orphan root")
        self.git("merge", "--no-ff", "--allow-unrelated-histories", "-m", "merge unrelated", "main")
        self.git("checkout", "main")

    def test_counts_classes_and_hunks_without_touching_the_repository(self):
        self.build_history()
        before = self.object_count()
        lines = self.run_script("--main", "main", "--local", "--since", "2000-01-01")
        self.assertEqual(lines[0], "ref: main since 2000-01-01")
        self.assertEqual(
            self.block(lines, "== main-sync =="),
            self.expected_block(2, 1, 1, "50%", 1, {"registries": (1, 1)}),
        )
        self.assertEqual(self.git("status", "--porcelain").stdout, "")
        self.assertEqual(self.object_count(), before)

    def test_all_merges_adds_branch_to_branch_population(self):
        self.build_history()
        self.git("checkout", "clean-branch")
        self.git("checkout", "-b", "side", "HEAD~1")
        self.commit_file("AGENTS.md", "registry: side\n", "side edit")
        self.git("checkout", "conflict-branch")
        self.merge("side", {"AGENTS.md": "registry: both\n"})
        self.git("checkout", "main")
        lines = self.run_script("--main", "main", "--local", "--since", "2000-01-01", "--all-merges")
        self.assertEqual(
            self.block(lines, "== main-sync =="),
            self.expected_block(2, 1, 1, "50%", 1, {"registries": (1, 1)}),
        )
        self.assertEqual(
            self.block(lines, "== branch-to-branch =="),
            self.expected_block(1, 0, 1, "100%", 1, {"registries": (1, 1)}),
        )

    def test_empty_population_reports_not_available_percentage(self):
        self.git("init", "-b", "main")
        self.commit_file("AGENTS.md", "x\n", "base")
        lines = self.run_script("--main", "main", "--local", "--since", "2000-01-01")
        self.assertEqual(
            self.block(lines, "== main-sync =="),
            self.expected_block(0, 0, 0, "n/a", 0, {}),
        )

    def test_merge_list_replays_only_listed_merges(self):
        self.build_history()
        merges = self.git("rev-list", "--merges", "--first-parent", "conflict-branch").stdout.split()
        listing = self.repo.parent / (self.repo.name + ".merges")
        self.addCleanup(lambda: listing.exists() and listing.unlink())
        listing.write_text("# comment\n%s\n" % merges[0])
        lines = self.run_script("--main", "main", "--local", "--merge-list", str(listing))
        self.assertEqual(
            self.block(lines, "== merge-list =="),
            self.expected_block(1, 0, 1, "100%", 1, {"registries": (1, 1)}),
        )


class AttributeSourceTests(GitRepoCase):
    def setUp(self):
        super().setUp()
        reason = _unsupported_reason()
        if reason:
            print(reason)
            self.skipTest(reason)

    def count(self, *extra):
        lines = self.run_script("--main", "main", "--local", "--since", "2000-01-01", *extra)
        return self.block(lines, "== main-sync ==")[2]

    def test_head_attributes_apply_and_worktree_attributes_do_not(self):
        self.git("init", "-b", "main")
        self.commit_file("AGENTS.md", "registry: base\n", "base")
        base = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("checkout", "-b", "feature", base)
        self.commit_file("AGENTS.md", "registry: branch\n", "branch edit")
        self.git("checkout", "main")
        self.commit_file("AGENTS.md", "registry: main\n", "main edit")
        self.git("checkout", "feature")
        self.merge("main", {"AGENTS.md": "registry: resolved\n"})
        self.git("checkout", "main")

        self.write(".gitattributes", "AGENTS.md merge=union\n")
        self.assertEqual(self.git("status", "--porcelain").stdout, "?? .gitattributes\n")
        self.assertEqual(self.count("--attrs", "head"), "conflicted: 1 (100%)")
        self.assertEqual(self.count("--attrs", "none"), "conflicted: 1 (100%)")
        self.assertEqual(self.count(), "conflicted: 1 (100%)")
        self.assertEqual(self.git("status", "--porcelain").stdout, "?? .gitattributes\n")

        self.git("add", ".gitattributes")
        self.git("commit", "-m", "union attributes")
        self.assertEqual(self.count("--attrs", "head"), "conflicted: 0 (0%)")
        self.assertEqual(self.count("--attrs", "none"), "conflicted: 1 (100%)")


if __name__ == "__main__":
    unittest.main()
