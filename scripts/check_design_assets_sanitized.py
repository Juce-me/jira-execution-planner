#!/usr/bin/env python3
"""Fail if local config values leak into tracked design assets.

`dashboard-config.json` is gitignored: the board id, board name, group names and
project keys it holds are local, identifiable configuration and must not appear
in tracked files. The design assets under `docs/plans/assets/` are committed so
implementation can work from the approved design, so they need a standing check
rather than a one-time cleanup.

This script hardcodes no real values. It reads whatever is in the local config
and looks for those strings in the tracked assets, so it cannot itself become a
place where those values live.

    .venv/bin/python scripts/check_design_assets_sanitized.py

Exits 0 when clean, 1 on a leak, and 0 with a notice when no local config exists
(as in CI), since there is then nothing to compare against.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / "dashboard-config.json"

# tracked files that describe the design and must stay free of local identifiers
SCANNED = [
    *sorted((ROOT / "docs/plans/assets").rglob("*.html")),
    ROOT / "docs/plans/EXEC-eng-group-board.md",
]

# short or generic values would match everywhere; only check distinctive ones
MIN_TOKEN_LEN = 4


def local_identifiers() -> tuple[set[str], list[str]]:
    """Distinctive strings from the local config, plus project-key prefixes."""
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    tokens: set[str] = set()
    prefixes: list[str] = []

    board = config.get("board") or {}
    for key in ("boardId", "boardName"):
        value = str(board.get(key) or "").strip()
        if len(value) >= MIN_TOKEN_LEN:
            tokens.add(value)

    groups = ((config.get("teamGroups") or {}).get("groups")) or []
    for group in groups:
        name = str(group.get("name") or "").strip()
        if len(name) >= MIN_TOKEN_LEN:
            tokens.add(name)

    for project in ((config.get("projects") or {}).get("selected")) or []:
        key = str(project.get("key") or "").strip()
        if len(key) >= MIN_TOKEN_LEN:
            tokens.add(key)
        if key:
            prefixes.append(key)

    return tokens, prefixes


def main() -> int:
    if not CONFIG.exists():
        print(f"no {CONFIG.name}; nothing to compare against — skipping")
        return 0

    tokens, prefixes = local_identifiers()
    key_pattern = (
        re.compile(r"\b(?:" + "|".join(re.escape(p) for p in prefixes) + r")-\d+\b")
        if prefixes
        else None
    )

    findings: list[str] = []
    for path in SCANNED:
        if not path.exists():
            continue
        rel = path.relative_to(ROOT)
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for token in tokens:
                if token in line:
                    findings.append(f"{rel}:{lineno}: local config value present")
                    break
            else:
                if key_pattern and key_pattern.search(line):
                    findings.append(f"{rel}:{lineno}: real-looking issue key")

    if findings:
        print("Local configuration leaked into tracked design assets:\n")
        for finding in findings:
            print(f"  {finding}")
        print(
            "\nReplace with synthetic equivalents. The assets must describe the design, "
            "not this instance."
        )
        return 1

    print(f"clean: {len(SCANNED)} tracked design file(s) carry no local config values")
    return 0


if __name__ == "__main__":
    sys.exit(main())
