import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class ProjectPackagingTests(unittest.TestCase):
    def test_pyproject_declares_runtime_package_and_python_version(self):
        source = (ROOT / "pyproject.toml").read_text(encoding="utf8")
        self.assertIn('name = "jira-execution-planner"', source)
        self.assertIn('requires-python = ">=3.10"', source)
        self.assertIn('jira-execution-planner = "jira_server:main"', source)

    def test_install_script_uses_requirements_file(self):
        source = (ROOT / "install.sh").read_text(encoding="utf8")
        self.assertIn(".venv/bin/python -m pip install -r requirements.txt", source)
        self.assertIn(".venv/bin/python -m pip install -e .", source)
        self.assertNotIn("pip3 install --user flask flask-cors requests", source)

    def test_makefile_exposes_standard_targets(self):
        source = (ROOT / "Makefile").read_text(encoding="utf8")
        for target in ("install:", "build:", "test:", "test-security:", "run:"):
            self.assertIn(target, source)
