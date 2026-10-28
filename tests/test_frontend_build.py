import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from backend.frontend_build import frontend_build_missing, frontend_build_stale

REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "lazy-views-" + "a" * 64 + ".json"
OLD = 1_000_000_000
NEW = 1_100_000_000

HTML = """<html><head>
<script async src="frontend/dist/early-bootstrap.js"></script>
<link rel="stylesheet" href="/frontend/dist/dashboard.css">
<script defer src="frontend/dist/auth-focus-refresh.js"></script>
<script id="dashboard-entry" type="module" src="frontend/dist/dashboard.js"></script>
</head></html>
"""


def _write(path, text="x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _build_dist(root, manifest=MANIFEST):
    """Synthetic dist: dashboard.js and the stats view both import shared chunks (chunk-b via chunk-a)."""
    dist = root / "frontend" / "dist"
    _write(root / "jira-dashboard.html", HTML)
    _write(dist / "early-bootstrap.js")
    _write(dist / "auth-focus-refresh.js")
    _write(dist / "dashboard.css")
    _write(dist / "dashboard.js", 'import{a as A}from"./chunks/chunk-AAAA.js";import "./chunks/Eager.js";var x=1;')
    _write(dist / "chunks" / "chunk-AAAA.js", 'import{b as B}from"./chunk-BBBB.js";export{A as a};')
    _write(dist / "chunks" / "chunk-BBBB.js", "export{b};")
    _write(dist / "chunks" / "Eager.js", "export{};")
    _write(dist / "chunks" / "StatsPanel-AAAAAAAA.js", 'import{a}from"./chunk-AAAA.js";import{c}from"./chunk-CCCC.js";export default 1;')
    _write(dist / "chunks" / "chunk-CCCC.js", "export{c};")
    _write(dist / manifest, json.dumps({
        "schemaVersion": 1, "buildId": "a" * 64,
        "views": {"stats": {"path": "chunks/StatsPanel-AAAAAAAA.js", "exportName": "default"}},
    }))
    return dist


def _add_sources(root):
    _write(root / "frontend" / "src" / "dashboard.jsx", "x")
    _write(root / "frontend" / "src" / "styles" / "a.css", "x")
    _write(root / "package.json", "{}")
    _write(root / "package-lock.json", "{}")
    _write(root / "scripts" / "build_dashboard.mjs", "x")


def _set_all(root, mtime):
    for path in root.rglob("*"):
        if path.is_file():
            os.utime(path, (mtime, mtime))


class FrontendBuildTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def assertBuildHint(self, message):
        self.assertIsNotNone(message)
        self.assertIn("npm run build", message)

    def test_missing_dist_directory(self):
        _write(self.root / "jira-dashboard.html", HTML)
        self.assertBuildHint(frontend_build_missing(self.root))

    def test_complete_dist_only_layout_is_neither_missing_nor_stale(self):
        _build_dist(self.root)
        self.assertIsNone(frontend_build_missing(self.root))
        self.assertIsNone(frontend_build_stale(self.root))

    def test_missing_referenced_file(self):
        for name in ("early-bootstrap.js", "dashboard.css", "auth-focus-refresh.js", "dashboard.js"):
            with self.subTest(name=name):
                dist = _build_dist(self.root)
                (dist / name).unlink()
                self.assertBuildHint(frontend_build_missing(self.root))
                shutil.rmtree(self.root / "frontend")

    def test_missing_manifest_or_view_chunk(self):
        dist = _build_dist(self.root)
        (dist / "chunks" / "StatsPanel-AAAAAAAA.js").unlink()
        self.assertBuildHint(frontend_build_missing(self.root))
        shutil.rmtree(self.root / "frontend")
        dist = _build_dist(self.root)
        (dist / MANIFEST).unlink()
        self.assertBuildHint(frontend_build_missing(self.root))

    def test_manifest_with_an_outside_or_absolute_view_path_reports_instead_of_raising(self):
        for bad in ("/nonexistent/x.js", "../../outside.js"):
            with self.subTest(path=bad):
                dist = _build_dist(self.root)
                (dist / MANIFEST).write_text(json.dumps({"views": {"v": {"path": bad}}}), encoding="utf-8")
                self.assertBuildHint(frontend_build_missing(self.root))
                shutil.rmtree(self.root / "frontend")

    def test_undecodable_html_reports_instead_of_raising(self):
        _build_dist(self.root)
        (self.root / "jira-dashboard.html").write_bytes(b"\xff\xfe\x00bad")
        self.assertBuildHint(frontend_build_missing(self.root))

    def test_two_manifests_are_not_exactly_one(self):
        dist = _build_dist(self.root)
        _write(dist / ("lazy-views-" + "b" * 64 + ".json"), (dist / MANIFEST).read_text())
        self.assertBuildHint(frontend_build_missing(self.root))

    def test_missing_shared_chunk_in_both_layouts(self):
        for name in ("chunk-AAAA.js", "chunk-BBBB.js", "chunk-CCCC.js", "Eager.js"):
            for with_sources in (False, True):
                with self.subTest(name=name, with_sources=with_sources):
                    dist = _build_dist(self.root)
                    if with_sources:
                        _add_sources(self.root)
                    (dist / "chunks" / name).unlink()
                    self.assertBuildHint(frontend_build_missing(self.root))
                    shutil.rmtree(self.root / "frontend")

    def test_stale_when_source_or_lockfile_newer_than_dashboard_js(self):
        for newer in ("frontend/src/dashboard.jsx", "package-lock.json", "package.json", "scripts/build_dashboard.mjs"):
            with self.subTest(newer=newer):
                _build_dist(self.root)
                _add_sources(self.root)
                _set_all(self.root, OLD)
                os.utime(self.root / newer, (NEW, NEW))
                self.assertIsNone(frontend_build_missing(self.root))
                self.assertBuildHint(frontend_build_stale(self.root))

    def test_fresh_dist_is_not_stale(self):
        _build_dist(self.root)
        _add_sources(self.root)
        _set_all(self.root, OLD)
        self.assertIsNone(frontend_build_stale(self.root))

    def test_newer_css_makes_only_the_stylesheet_stale(self):
        _build_dist(self.root)
        _add_sources(self.root)
        _set_all(self.root, OLD)
        os.utime(self.root / "frontend/src/styles/a.css", (NEW, NEW))
        message = frontend_build_stale(self.root)
        self.assertBuildHint(message)
        self.assertIn("dashboard.css", message)
        self.assertNotIn("dashboard.js", message)

    def test_js_source_does_not_make_the_stylesheet_stale(self):
        _build_dist(self.root)
        _add_sources(self.root)
        _set_all(self.root, OLD)
        os.utime(self.root / "frontend/src/dashboard.jsx", (NEW, NEW))
        message = frontend_build_stale(self.root)
        self.assertIn("dashboard.js", message)
        self.assertNotIn("dashboard.css", message)

    def test_ds_store_and_html_prototypes_do_not_count(self):
        _build_dist(self.root)
        _add_sources(self.root)
        _write(self.root / "frontend/src/.DS_Store")
        _write(self.root / "frontend/src/.hidden/inner.js")
        _write(self.root / "frontend/src/prototype.html")
        _write(self.root / "frontend/src/notes.md")
        _set_all(self.root, OLD)
        for name in (".DS_Store", ".hidden/inner.js", "prototype.html", "notes.md"):
            os.utime(self.root / "frontend/src" / name, (NEW, NEW))
        self.assertIsNone(frontend_build_stale(self.root))

    def test_stale_is_none_without_lockfile_or_sources(self):
        _build_dist(self.root)
        _add_sources(self.root)
        _set_all(self.root, OLD)
        os.utime(self.root / "frontend/src/dashboard.jsx", (NEW, NEW))
        (self.root / "package-lock.json").unlink()
        self.assertIsNone(frontend_build_stale(self.root))
        shutil.rmtree(self.root / "frontend" / "src")
        self.assertIsNone(frontend_build_stale(self.root))

    @unittest.skipUnless((REPO_ROOT / "frontend" / "dist" / "dashboard.js").is_file(), "needs a built dist")
    def test_real_dist_copy_is_complete_and_a_deleted_shared_chunk_is_caught(self):
        shutil.copy(REPO_ROOT / "jira-dashboard.html", self.root / "jira-dashboard.html")
        shutil.copytree(REPO_ROOT / "frontend" / "dist", self.root / "frontend" / "dist")
        self.assertIsNone(frontend_build_missing(self.root))
        chunk = sorted((self.root / "frontend" / "dist" / "chunks").glob("chunk-*.js"))[0]
        chunk.unlink()
        self.assertBuildHint(frontend_build_missing(self.root))


class DistIsNotTrackedTests(unittest.TestCase):
    # EXPECTED RED until the A1 wave untracks frontend/dist (git rm -r --cached frontend/dist).
    def test_frontend_dist_is_not_tracked(self):
        if shutil.which("git") is None or not (REPO_ROOT / ".git").exists():
            self.skipTest("not a git checkout")
        result = subprocess.run(
            ["git", "ls-files", "frontend/dist"], cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        )
        self.assertEqual(result.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
