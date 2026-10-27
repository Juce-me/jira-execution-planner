"""Guards for the append-only docs that `.gitattributes` merges with `merge=union`.

Union keeps both sides of a concurrent edit, so a bullet edited on both sides,
or a plan link added twice, survives as a silent duplicate. These validators
turn that into a red check. Each validator takes text and returns a list of
violation strings, so the synthetic cases below can feed it bad input.
"""
import re
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFLICT_RE = re.compile(r"^(<<<<<<< |=======$|>>>>>>> )", re.M)
HEADING_RE = re.compile(r"^## (\d+)\.", re.M)
PLAN_LINK_RE = re.compile(r"^- \[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)", re.M)
GITATTRIBUTES_LINES = (
    "/AGENTS.md merge=union",
    "/docs/README_ANALYTICS.md merge=union",
    "/docs/plans/README.md merge=union",
)
PREFIX_LEN = 40


def _conflicts(text):
    return ["conflict marker"] if CONFLICT_RE.search(text) else []


def _bullets(text):
    return [line for line in text.splitlines() if line.startswith("- ")]


def _section_bodies(text):
    """Text of sections 10 and 11 (from the `## 10.` heading to end of file)."""
    match = re.search(r"^## 10\.", text, re.M)
    return text[match.start():] if match else ""


def check_agents_md(text):
    problems = _conflicts(text)
    if not text.endswith("\n"):
        problems.append("missing trailing newline")
    for bullet, count in Counter(_bullets(text)).items():
        if count > 1:
            problems.append("duplicate bullet: %s" % bullet[:60])
    prefixes = Counter(b[:PREFIX_LEN] for b in _bullets(_section_bodies(text)))
    for prefix, count in prefixes.items():
        if count > 1:
            problems.append("shared %d-char prefix in sections 10-11: %s" % (PREFIX_LEN, prefix))
    if len(re.findall(r"^Template version:", text, re.M)) != 1:
        problems.append("Template version line must appear exactly once")
    numbers = Counter(HEADING_RE.findall(text))
    for number, count in numbers.items():
        if count != 1:
            problems.append("heading ## %s. appears %d times" % (number, count))
    return problems


def check_plans_index(text):
    problems = _conflicts(text)
    for target, count in Counter(PLAN_LINK_RE.findall(text)).items():
        if count > 1:
            problems.append("plan link appears %d times: %s" % (count, target))
    return problems


def check_analytics(text):
    problems = _conflicts(text)
    if len(re.findall(r"^Status:", text, re.M)) != 1:
        problems.append("Status line must appear exactly once")
    rows = [
        line for line in text.splitlines()
        if line.startswith("|") and not re.fullmatch(r"\|[\s:|-]+\|?", line)
    ]
    for row, count in Counter(rows).items():
        if count > 1:
            problems.append("duplicate table row: %s" % row[:60])
    return problems


def check_gitattributes(text):
    lines = set(text.splitlines())
    return ["missing line: %s" % line for line in GITATTRIBUTES_LINES if line not in lines]


GOOD_AGENTS = (
    "# AGENTS.md\n\nTemplate version: 2026-01-01\n\n## 0. A\n\n- one\n\n## 10. P\n\n"
    "- first rule about alpha things that is long enough to matter\n\n## 11. L\n\n"
    "- second rule about beta things that is long enough to matter\n"
)


class SyntheticGuardTests(unittest.TestCase):
    def test_good_fixture_passes(self):
        self.assertEqual(check_agents_md(GOOD_AGENTS), [])

    def test_duplicate_bullet_fails(self):
        self.assertTrue(check_agents_md(GOOD_AGENTS + "- one\n"))

    def test_same_prefix_pair_fails(self):
        prefix = "- shared prefix of exactly forty chars ok."[:PREFIX_LEN]
        text = GOOD_AGENTS + prefix + " tail A\n" + prefix + " tail B\n"
        self.assertTrue(any("prefix" in p for p in check_agents_md(text)))

    def test_prefix_rule_ignores_sections_before_10(self):
        prefix = "- shared prefix of exactly forty chars ok."[:PREFIX_LEN]
        text = GOOD_AGENTS.replace("- one\n", prefix + " a\n" + prefix + " b\n")
        self.assertEqual(check_agents_md(text), [])

    def test_duplicate_heading_template_conflict_newline_fail(self):
        self.assertTrue(check_agents_md(GOOD_AGENTS + "\n## 11. Again\n"))
        self.assertTrue(check_agents_md(GOOD_AGENTS + "Template version: 2\n"))
        self.assertTrue(check_agents_md(GOOD_AGENTS + "<<<<<<< ours\n"))
        self.assertTrue(check_agents_md(GOOD_AGENTS.rstrip("\n")))

    def test_duplicate_plan_link_fails(self):
        text = "- [A](EXEC-a.md): x\n- [B](EXEC-b.md): y\n- [A again](EXEC-a.md): stale\n"
        self.assertTrue(check_plans_index(text))
        self.assertEqual(check_plans_index(text.rsplit("- [A again", 1)[0]), [])

    def test_duplicate_analytics_row_fails(self):
        table = "Status: ok\n\n| a | b |\n| --- | --- |\n| `x` | 1 |\n"
        self.assertEqual(check_analytics(table), [])
        self.assertTrue(check_analytics(table + "| `x` | 1 |\n"))
        self.assertEqual(check_analytics(table + "| `x` | 2 |\n"), [])
        self.assertTrue(check_analytics(table + "Status: again\n"))

    def test_gitattributes_requires_anchored_lines(self):
        self.assertTrue(check_gitattributes("AGENTS.md merge=union\n"))
        self.assertEqual(check_gitattributes("\n".join(GITATTRIBUTES_LINES) + "\n"), [])


class RealFileTests(unittest.TestCase):
    def _read(self, rel):
        return (ROOT / rel).read_text(encoding="utf-8")

    def test_agents_md(self):
        self.assertEqual(check_agents_md(self._read("AGENTS.md")), [])

    def test_plans_index(self):
        self.assertEqual(check_plans_index(self._read("docs/plans/README.md")), [])

    def test_analytics_doc(self):
        self.assertEqual(check_analytics(self._read("docs/README_ANALYTICS.md")), [])

    def test_gitattributes(self):
        self.assertEqual(check_gitattributes(self._read(".gitattributes")), [])


if __name__ == "__main__":
    unittest.main()
