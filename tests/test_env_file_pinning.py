import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class EnvFilePinningTests(unittest.TestCase):
    def test_server_pins_dotenv_to_script_directory(self):
        source = (ROOT / "jira_server.py").read_text(encoding="utf8")

        self.assertNotIn(
            "load_dotenv()",
            source,
            "Bare load_dotenv() searches parent directories and lets nested "
            "checkouts (git worktrees) inherit another checkout's .env.",
        )
        self.assertIn(
            "load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))",
            source,
        )

    def test_preflight_pins_dotenv_to_repo_root(self):
        source = (ROOT / "scripts" / "check_startup_preflight.py").read_text(encoding="utf8")

        self.assertIn('load_dotenv(REPO_ROOT / ".env")', source)
        self.assertNotIn("load_dotenv()", source)
