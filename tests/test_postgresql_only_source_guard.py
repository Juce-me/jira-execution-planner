"""PostgreSQL is the only supported database: no current code or test may use SQLite."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SQLITE_USE = re.compile(
    r"sqlite(\+\w+)?://|import sqlite3|sqlite3\.|sqlite_where|sqlite_insert|dialects\.sqlite|dialects import [^\n]*\bsqlite\b"
    r"|BEGIN IMMEDIATE|PRAGMA |== ['\"]sqlite['\"]|FakeSession\(['\"]sqlite['\"]\)",
    re.IGNORECASE,
)
# A line that only asserts the refusal of SQLite carries this marker.
REFUSAL_MARKER = '# sqlite-refusal-check'


def current_sources():
    for base in ('backend', 'scripts', 'runners', 'tests'):
        for path in sorted((ROOT / base).rglob('*.py')):
            relative = path.relative_to(ROOT).as_posix()
            if relative.startswith('backend/db/migrations/versions/'):
                continue  # historical revisions keep their recorded dialect branches
            yield relative, path
    yield 'jira_server.py', ROOT / 'jira_server.py'


class PostgresqlOnlySourceGuardTests(unittest.TestCase):
    def test_no_current_source_uses_sqlite(self):
        offenders = []
        for relative, path in current_sources():
            if relative == 'tests/test_postgresql_only_source_guard.py':
                continue
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                if SQLITE_USE.search(line) and not line.rstrip().endswith(REFUSAL_MARKER):
                    offenders.append(f'{relative}:{number}')
        self.assertEqual(offenders, [], 'SQLite is retired; use PostgreSQL (tests: tests/postgres_test_db.py).')

    def test_refusal_markers_label_only_refusal_checks(self):
        marked = {}
        for relative, path in current_sources():
            count = sum(line.rstrip().endswith(REFUSAL_MARKER) for line in path.read_text(encoding='utf-8').splitlines())
            if count:
                marked[relative] = count
        self.assertEqual(marked, {
            'tests/isolated_runtime_sitecustomize.py': 1, 'tests/test_isolated_runtime_runner.py': 1,
            'tests/test_postgres_test_db.py': 1, 'tests/test_runtime_auth_cutover.py': 1,
            'tests/test_startup_preflight.py': 1,
        })

if __name__ == '__main__':
    unittest.main()
