import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sync_main.sh"
SCRATCH = ROOT / "tmp" / "a4"
BASH = "/bin/bash" if Path("/bin/bash").exists() else shutil.which("bash")

NAME = "Sync Tester"
EMAIL = "sync-tester@example.invalid"
REPO_EMAIL = "repo-user@example.invalid"
OTHER_EMAIL = "env-user@example.invalid"

NPM_STUB = r'''#!/usr/bin/env bash
set -u
printf 'npm|%s\n' "$*" >> "$SYNC_TEST_LOG"
if [ "${STUB_NPM_FAIL:-}" = "build" ] && [ "${1:-}" = "run" ]; then exit 1; fi
if [ "${1:-}" = "run" ]; then
  mkdir -p frontend/dist
  echo built > frontend/dist/dashboard.js
fi
exit 0
'''

BASE_FILES = {
    "AGENTS.md": "# A\n- one\n",
    "notes.txt": "base\n",
    "frontend/src/app.js": "app\n",
    "package.json": "{}\n",
    "package-lock.json": "{}\n",
    "scripts/build_dashboard.mjs": "build\n",
}


class SyncMainTests(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.base = Path(tempfile.mkdtemp(dir=SCRATCH))
        self.addCleanup(shutil.rmtree, self.base, True)
        (self.base / "gitconfig").write_text("")
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env.update(
            HOME=str(self.base),
            GIT_CONFIG_NOSYSTEM="1",
            GIT_CONFIG_GLOBAL=str(self.base / "gitconfig"),
            GIT_TERMINAL_PROMPT="0",
        )
        stubs = self.base / "stubs"
        stubs.mkdir()
        npm = stubs / "npm"
        npm.write_text(NPM_STUB)
        npm.chmod(0o755)
        self.log = self.base / "calls.log"
        self.log.write_text("")
        self.stubs = stubs

    # ---- helpers -------------------------------------------------------
    def git(self, cwd, *args, check=True, env=None):
        proc = subprocess.run(
            ["git", *args], cwd=cwd, env=env or self.env,
            capture_output=True, text=True,
        )
        if check and proc.returncode != 0:
            raise AssertionError("git %s failed: %s%s" % (args, proc.stdout, proc.stderr))
        return proc

    def write(self, repo, files):
        for rel, content in files.items():
            path = Path(repo) / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)

    def commit(self, repo, files=None, delete=(), msg="change"):
        self.write(repo, files or {})
        for rel in delete:
            self.git(repo, "rm", "-rq", "--", rel)
        self.git(repo, "add", "-A")
        self.git(repo, "commit", "-qm", msg)

    def make(self, dist_tracked=False, attrs=False, extra=None):
        """origin.git + seed clone (advances origin) + work clone on feature/x."""
        files = dict(BASE_FILES)
        files.update(extra or {})
        if attrs:
            files[".gitattributes"] = "/AGENTS.md merge=union\n"
        if dist_tracked:
            files["frontend/dist/dashboard.js"] = "old dist\n"
            files["frontend/dist/chunks/a.js"] = "chunk\n"
        else:
            files[".gitignore"] = "frontend/dist/\n"
        origin = self.base / "origin.git"
        self.git(self.base, "init", "-q", "--bare", "-b", "main", str(origin))
        self.seed = self.base / "seed"
        self.git(self.base, "init", "-q", "-b", "main", str(self.seed))
        self.git(self.seed, "config", "user.name", "Seed")
        self.git(self.seed, "config", "user.email", "seed@example.invalid")
        self.git(self.seed, "remote", "add", "origin", str(origin))
        self.commit(self.seed, files, msg="base")
        self.git(self.seed, "push", "-q", "origin", "main")
        self.work = self.base / "work"
        self.git(self.base, "clone", "-q", str(origin), str(self.work))
        self.git(self.work, "config", "user.name", "Repo User")
        self.git(self.work, "config", "user.email", REPO_EMAIL)
        self.git(self.work, "checkout", "-q", "-b", "feature/x")
        if not dist_tracked:
            self.write(self.work, {"frontend/dist/dashboard.js": "ignored dist\n"})

    def origin_commit(self, files=None, delete=(), msg="upstream"):
        self.commit(self.seed, files, delete, msg)
        self.git(self.seed, "push", "-q", "origin", "main")

    def run_sync(self, *args, extra_env=None, budgets="printf 'budgets\\n' >> \"$SYNC_TEST_LOG\"",
                 identity=True, cwd=None):
        env = dict(self.env)
        env["PATH"] = "%s:%s" % (self.stubs, env.get("PATH", ""))
        env["SYNC_TEST_LOG"] = str(self.log)
        env["JEP_SYNC_BUDGETS_CMD"] = budgets
        if identity:
            env["SYNC_GIT_NAME"] = NAME
            env["SYNC_GIT_EMAIL"] = EMAIL
        env.update(extra_env or {})
        return subprocess.run(
            [BASH, str(SCRIPT), *args], cwd=cwd or self.work, env=env,
            capture_output=True, text=True, timeout=120,
        )

    def calls(self):
        return self.log.read_text().splitlines()

    def build_calls(self):
        return [c for c in self.calls() if c.startswith("npm|")]

    def budget_calls(self):
        return [c for c in self.calls() if c == "budgets"]

    def head(self, ref="HEAD"):
        return self.git(self.work, "rev-parse", ref).stdout.strip()

    def merge_head(self):
        return self.git(self.work, "rev-parse", "-q", "--verify", "MERGE_HEAD", check=False).returncode == 0

    def parents(self):
        return self.git(self.work, "rev-list", "--parents", "-n1", "HEAD").stdout.split()[1:]

    def out(self, proc):
        return proc.stdout + proc.stderr

    def assert_identity(self):
        fmt = self.git(self.work, "log", "-1", "--format=%an|%ae|%cn|%ce").stdout.strip()
        self.assertEqual(fmt, "%s|%s|%s|%s" % (NAME, EMAIL, NAME, EMAIL))

    def conflict_notes(self):
        self.make()
        self.commit(self.work, {"notes.txt": "mine\n"}, msg="mine")
        self.origin_commit({"notes.txt": "theirs\n"})

    # ---- successful paths ----------------------------------------------
    def test_clean_merge_without_gitattributes_on_origin(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"docs/x.md": "x\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertNotIn("fatal", self.out(p))
        self.assertIn("SYNC: committed", p.stdout)
        self.assertEqual(len(self.parents()), 2)
        self.assertFalse(self.merge_head())
        self.assert_identity()
        self.assertEqual(self.build_calls(), [])
        self.assertEqual(len(self.budget_calls()), 1)

    def test_ordinary_merge_rebuilds_on_source_change(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"frontend/src/app.js": "app2\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.build_calls(), ["npm|run build"])
        self.assertEqual(len(self.budget_calls()), 1)

    def test_lockfile_change_runs_npm_ci_before_build(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"package-lock.json": "{\"v\":2}\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.build_calls(), ["npm|ci", "npm|run build"])

    def test_ordinary_merge_rebuilds_when_dist_missing(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"docs/x.md": "x\n"})
        (self.work / "frontend/dist/dashboard.js").unlink()
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.build_calls(), ["npm|run build"])
        self.assertEqual(len(self.budget_calls()), 1)

    def test_fast_forward_without_merge_commit(self):
        self.make()
        self.origin_commit({"frontend/src/app.js": "app2\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.head(), self.head("origin/main"))
        self.assertEqual(self.git(self.work, "rev-list", "--merges", "HEAD").stdout.strip(), "")
        self.assertIn("SYNC: fast-forwarded", p.stdout)
        self.assertEqual(self.build_calls(), ["npm|run build"])
        self.assertEqual(len(self.budget_calls()), 1)

    def test_fast_forward_without_source_change_and_dist_missing_rebuilds(self):
        self.make()
        self.origin_commit({"docs/x.md": "x\n"})
        (self.work / "frontend/dist/dashboard.js").unlink()
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.build_calls(), ["npm|run build"])
        self.assertEqual(len(self.budget_calls()), 1)

    def test_already_up_to_date(self):
        self.make()
        before = self.head()
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertIn("SYNC: up to date", p.stdout)
        self.assertEqual(self.head(), before)
        self.assertEqual(self.build_calls(), [])

    def test_union_applies_on_branch_lacking_gitattributes(self):
        self.make()
        self.commit(self.work, {"AGENTS.md": "# A\n- one\n- mine\n"})
        self.origin_commit({".gitattributes": "/AGENTS.md merge=union\n",
                            "AGENTS.md": "# A\n- one\n- theirs\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        text = (self.work / "AGENTS.md").read_text()
        self.assertIn("- mine", text)
        self.assertIn("- theirs", text)
        self.assertNotIn("<<<<<<<", text)
        self.assertEqual(len(self.parents()), 2)
        self.assertEqual(self.git(self.work, "config", "--local", "--get", "core.attributesFile", check=False).stdout, "")

    # ---- conflicts ------------------------------------------------------
    def test_hand_conflict_left_open_then_continue_commits_with_identity(self):
        self.conflict_notes()
        before = self.head()
        p = self.run_sync()
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertTrue(self.merge_head())
        self.assertEqual(self.head(), before)
        self.assertIn("GENERATED:", p.stdout)
        self.assertIn("HAND-EDIT:", p.stdout)
        hand = p.stdout.split("HAND-EDIT:", 1)[1]
        self.assertIn("notes.txt", hand)
        self.assertNotIn("notes.txt", p.stdout.split("GENERATED:", 1)[1].split("HAND-EDIT:", 1)[0])
        self.assertIn(shlex.quote(EMAIL), p.stdout)
        self.assertIn("commit --no-edit", p.stdout)
        # resolve and stage, then --continue
        self.write(self.work, {"notes.txt": "resolved\n"})
        self.git(self.work, "add", "notes.txt")
        p2 = self.run_sync("--continue")
        self.assertEqual(p2.returncode, 0, self.out(p2))
        self.assertFalse(self.merge_head())
        self.assertEqual(len(self.parents()), 2)
        self.assert_identity()
        self.assertEqual(len(self.budget_calls()), 1)
        self.assertEqual(self.git(self.work, "status", "--porcelain", "--untracked-files=no").stdout, "")

    def test_continue_rejects_remaining_unmerged_paths(self):
        self.conflict_notes()
        self.run_sync()
        p = self.run_sync("--continue")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertTrue(self.merge_head())

    def test_continue_rejects_conflict_markers(self):
        self.conflict_notes()
        self.run_sync()
        self.write(self.work, {"notes.txt": "<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n"})
        self.git(self.work, "add", "notes.txt")
        p = self.run_sync("--continue")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertTrue(self.merge_head())

    def test_continue_rejects_unintended_unstaged_edit(self):
        self.conflict_notes()
        self.run_sync()
        self.write(self.work, {"notes.txt": "resolved\n"})
        self.git(self.work, "add", "notes.txt")
        self.write(self.work, {"mine_extra.txt": "e\n"})
        self.write(self.work, {"AGENTS.md": "# A\n- one\n- stray\n"})
        p = self.run_sync("--continue")
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertTrue(self.merge_head())

    def test_continue_without_merge_in_progress_is_refused(self):
        self.make()
        p = self.run_sync("--continue")
        self.assertEqual(p.returncode, 2, self.out(p))

    def test_rerere_replayed_resolution_stays_unstaged_despite_autoupdate(self):
        self.conflict_notes()
        rr = ["-c", "rerere.enabled=true"]
        self.git(self.work, "fetch", "-q", "origin")
        self.git(self.work, *rr, "merge", "-q", "origin/main", check=False)
        self.write(self.work, {"notes.txt": "resolved\n"})
        self.git(self.work, *rr, "add", "notes.txt")
        self.git(self.work, *rr, "rerere")
        self.git(self.work, "merge", "--abort")
        env = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "rerere.autoupdate",
               "GIT_CONFIG_VALUE_0": "true"}
        p = self.run_sync(extra_env=env)
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertTrue(self.merge_head())
        self.assertEqual((self.work / "notes.txt").read_text(), "resolved\n")
        status = self.git(self.work, "status", "--porcelain", "--untracked-files=no").stdout
        self.assertIn("UU notes.txt", status)

    # ---- generated dist -------------------------------------------------
    def test_dist_modify_delete_is_auto_fixed_and_rebuilt(self):
        self.make(dist_tracked=True)
        self.commit(self.work, {"frontend/dist/dashboard.js": "branch dist\n"})
        self.origin_commit({".gitignore": "frontend/dist/\n"}, delete=["frontend/dist"])
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.git(self.work, "ls-files", "frontend/dist").stdout, "")
        self.assertTrue((self.work / "frontend/dist/dashboard.js").exists())
        self.assertEqual(self.build_calls(), ["npm|run build"])
        self.assertEqual(self.git(self.work, "status", "--porcelain", "--untracked-files=no").stdout, "")
        self.assertEqual(len(self.parents()), 2)
        self.assert_identity()
        self.assertEqual(len(self.budget_calls()), 1)

    def test_first_sync_past_a1_clean_delete_leaves_no_half_dist_and_rebuilds(self):
        self.make(dist_tracked=True)
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({".gitignore": "frontend/dist/\n"}, delete=["frontend/dist"])
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertEqual(self.git(self.work, "ls-files", "frontend/dist").stdout, "")
        self.assertEqual(self.build_calls(), ["npm|run build"])
        self.assertTrue((self.work / "frontend/dist/dashboard.js").exists())

    def test_dist_and_hand_conflict_deletes_dist_from_index_but_stops(self):
        self.make(dist_tracked=True)
        self.commit(self.work, {"frontend/dist/dashboard.js": "branch dist\n", "notes.txt": "mine\n"})
        self.origin_commit({".gitignore": "frontend/dist/\n", "notes.txt": "theirs\n"},
                           delete=["frontend/dist"])
        p = self.run_sync()
        self.assertEqual(p.returncode, 1, self.out(p))
        self.assertTrue(self.merge_head())
        self.assertEqual(self.git(self.work, "ls-files", "frontend/dist").stdout, "")
        self.assertEqual(self.build_calls(), [])

    # ---- refusals and failures -----------------------------------------
    def test_dirty_tree_is_refused(self):
        self.make()
        self.write(self.work, {"notes.txt": "dirty\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 2, self.out(p))

    def test_untracked_file_alone_is_not_dirty(self):
        self.make()
        self.write(self.work, {"scratch.txt": "s\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))

    def test_on_main_is_refused(self):
        self.make()
        self.git(self.work, "checkout", "-q", "main")
        p = self.run_sync()
        self.assertEqual(p.returncode, 2, self.out(p))

    def test_detached_head_is_refused(self):
        self.make()
        self.git(self.work, "checkout", "-q", "--detach")
        p = self.run_sync()
        self.assertEqual(p.returncode, 2, self.out(p))

    def test_merge_in_progress_is_refused(self):
        self.conflict_notes()
        self.git(self.work, "fetch", "-q", "origin")
        self.git(self.work, "merge", "-q", "--no-commit", "--no-ff", "origin/main", check=False)
        self.assertTrue(self.merge_head())
        p = self.run_sync()
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertTrue(self.merge_head())

    def test_missing_identity_is_refused(self):
        self.make()
        self.origin_commit({"docs/x.md": "x\n"})
        p = self.run_sync(identity=False)
        self.assertEqual(p.returncode, 2, self.out(p))
        p = self.run_sync(extra_env={"SYNC_GIT_NAME": NAME}, identity=False)
        self.assertEqual(p.returncode, 2, self.out(p))
        p = self.run_sync(extra_env={"SYNC_GIT_EMAIL": EMAIL}, identity=False)
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertNotEqual(self.head(), self.git(self.seed, "rev-parse", "HEAD").stdout.strip())

    def test_untracked_file_blocking_merge_is_exit_2_with_no_commit(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"new.txt": "n\n"})
        self.write(self.work, {"new.txt": "local untracked\n"})
        before = self.head()
        p = self.run_sync()
        self.assertEqual(p.returncode, 2, self.out(p))
        self.assertFalse(self.merge_head())
        self.assertEqual(self.head(), before)
        self.assertNotIn("SYNC: committed", p.stdout)
        self.assertIn("new.txt", self.out(p))

    def test_fetch_failure_is_exit_4(self):
        self.make()
        self.git(self.work, "remote", "set-url", "origin", str(self.base / "missing.git"))
        p = self.run_sync()
        self.assertEqual(p.returncode, 4, self.out(p))

    def test_build_failure_is_exit_5(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"frontend/src/app.js": "app2\n"})
        p = self.run_sync(extra_env={"STUB_NPM_FAIL": "build"})
        self.assertEqual(p.returncode, 5, self.out(p))
        self.assertEqual(self.budget_calls(), [])

    def test_budgets_failure_is_exit_3(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"docs/x.md": "x\n"})
        p = self.run_sync(budgets="false")
        self.assertEqual(p.returncode, 3, self.out(p))
        self.assertFalse(self.merge_head())
        self.assertEqual(len(self.parents()), 2)

    # ---- identity -------------------------------------------------------
    def test_commit_identity_beats_repo_config_and_exported_variables(self):
        self.make()
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"docs/x.md": "x\n"})
        env = {
            "GIT_AUTHOR_NAME": "Env", "GIT_AUTHOR_EMAIL": OTHER_EMAIL,
            "GIT_COMMITTER_NAME": "Env", "GIT_COMMITTER_EMAIL": OTHER_EMAIL,
            "EMAIL": OTHER_EMAIL,
        }
        p = self.run_sync(extra_env=env)
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assert_identity()
        local = self.git(self.work, "config", "--local", "--list").stdout
        self.assertNotIn("rerere", local)
        self.assertIn("user.email=" + REPO_EMAIL, local)
        self.assertNotIn(EMAIL, local)

    def test_commit_identity_beats_configured_author_and_committer_email(self):
        self.make()
        self.git(self.work, "config", "--local", "author.email", OTHER_EMAIL)
        self.git(self.work, "config", "--local", "committer.email", OTHER_EMAIL)
        self.commit(self.work, {"mine.txt": "m\n"})
        self.origin_commit({"docs/x.md": "x\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assert_identity()

    def test_continue_ignores_conflict_markers_quoted_in_an_incoming_file(self):
        self.make()
        self.commit(self.work, {"notes.txt": "mine\n"}, msg="mine")
        self.origin_commit({"notes.txt": "theirs\n", "docs/quote.md": "<<<<<<< quoted\nexample\n>>>>>>> quoted\n"})
        p = self.run_sync()
        self.assertEqual(p.returncode, 1, self.out(p))
        self.write(self.work, {"notes.txt": "resolved\n"})
        self.git(self.work, "add", "notes.txt")
        p2 = self.run_sync("--continue")
        self.assertEqual(p2.returncode, 0, self.out(p2))
        self.assertFalse(self.merge_head())


if __name__ == "__main__":
    unittest.main()
