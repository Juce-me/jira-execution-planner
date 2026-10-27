"""Detect a missing or stale frontend build under frontend/dist (not tracked in git)."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

BUILD_HINT = "run `npm ci && npm run build` (or `npm run build` when node_modules exists)"
_DIST = Path("frontend") / "dist"
_HTML_REF = re.compile(r"""frontend/dist/([^"'\s>?#]+)""")
_LOCAL_IMPORT = re.compile(r"""(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}/[^"'?#]+)""")
_MANIFEST = re.compile(r"^lazy-views-[a-f0-9]{64}\.json$")
_JS_EXTENSIONS = {".js", ".jsx", ".mjs", ".json"}
_JS_OUTPUTS = ("dashboard.js", "early-bootstrap.js", "auth-focus-refresh.js")


def _missing_message(detail: str) -> str:
    return f"Frontend build is incomplete: {detail}. {BUILD_HINT}."


def _inside(path: Path, base: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
    except ValueError:
        return False
    return True


def _check_missing(repo_root: Path) -> str | None:
    repo_root = Path(repo_root)
    dist = repo_root / _DIST
    html = repo_root / "jira-dashboard.html"
    if not dist.is_dir():
        return _missing_message("frontend/dist is absent")
    if not html.is_file():
        return _missing_message("jira-dashboard.html is absent")
    required: list[Path] = []
    for name in dict.fromkeys(_HTML_REF.findall(html.read_text(encoding="utf-8"))):
        required.append(dist / name)
    manifests = sorted(path for path in dist.glob("lazy-views-*.json") if _MANIFEST.match(path.name))
    if len(manifests) != 1:
        return _missing_message(f"expected exactly one lazy-views-*.json, found {len(manifests)}")
    required.append(manifests[0])
    entries = [dist / "dashboard.js"]
    try:
        views = json.loads(manifests[0].read_text(encoding="utf-8"))["views"]
        for view in views.values():
            entries.append(dist / view["path"])
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return _missing_message(f"{manifests[0].name} is unreadable or malformed")
    required.extend(entries)
    for path in required:
        if not path.is_file():
            return _missing_message(f"{path.relative_to(repo_root).as_posix()} is missing")
    seen: set[Path] = set()
    pending = list(entries)
    while pending:
        current = pending.pop().resolve()
        if current in seen:
            continue
        seen.add(current)
        for target in _LOCAL_IMPORT.findall(current.read_text(encoding="utf-8", errors="replace")):
            path = (current.parent / target).resolve()
            if not _inside(path, dist):
                continue
            if not path.is_file():
                return _missing_message(f"{path.relative_to(dist.resolve()).as_posix()} (imported by {current.name}) is missing")
            pending.append(path)
    return None


def frontend_build_missing(repo_root: Path) -> str | None:
    try:
        return _check_missing(repo_root)
    except (OSError, ValueError) as error:
        return _missing_message(f"the build check could not read the output ({type(error).__name__})")


def _newest_input(files) -> float:
    newest = 0.0
    for path in files:
        try:
            newest = max(newest, path.stat().st_mtime)
        except OSError:
            continue
    return newest


def _source_files(src: Path):
    for current, dirs, names in os.walk(src):
        dirs[:] = [name for name in dirs if not name.startswith(".")]
        for name in names:
            if not name.startswith("."):
                yield Path(current) / name


def _check_stale(repo_root: Path) -> str | None:
    repo_root = Path(repo_root)
    src = repo_root / "frontend" / "src"
    lockfile = repo_root / "package-lock.json"
    if not src.is_dir() or not lockfile.is_file():
        return None
    sources = list(_source_files(src))
    js_inputs = [p for p in sources if p.suffix in _JS_EXTENSIONS]
    js_inputs += [repo_root / "package.json", lockfile, repo_root / "scripts" / "build_dashboard.mjs"]
    css_inputs = [p for p in sources if p.suffix == ".css"]
    dist = repo_root / _DIST
    stale = []
    js_newest = _newest_input(js_inputs)
    for name in _JS_OUTPUTS:
        output = dist / name
        if output.is_file() and output.stat().st_mtime < js_newest:
            stale.append(name)
    css = dist / "dashboard.css"
    if css.is_file() and css.stat().st_mtime < _newest_input(css_inputs):
        stale.append("dashboard.css")
    if not stale:
        return None
    return (
        f"Frontend build may be stale ({', '.join(stale)} older than its sources, mtime heuristic): "
        f"{BUILD_HINT}."
    )


def frontend_build_stale(repo_root: Path) -> str | None:
    try:
        return _check_stale(repo_root)
    except OSError:
        return None
