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
        source = (ROOT / "scripts" / "install.sh").read_text(encoding="utf8")
        self.assertIn(".venv/bin/python -m pip install -r requirements.txt", source)
        self.assertIn(".venv/bin/python -m pip install -e .", source)
        self.assertNotIn("pip3 install --user flask flask-cors requests", source)

    def test_makefile_exposes_standard_targets(self):
        source = (ROOT / "Makefile").read_text(encoding="utf8")
        for target in ("install:", "build:", "test:", "test-security:", "preflight:", "run:"):
            self.assertIn(target, source)

    def test_startup_preflight_script_exists(self):
        source = (ROOT / "scripts" / "check_startup_preflight.py").read_text(encoding="utf8")
        self.assertIn("run_preflight", source)
        self.assertIn("validate_config_storage_startup", source)
        self.assertIn("key_provider_from_env", source)

    def test_release_workflow_defines_runnable_zip_shape(self):
        source = (ROOT / ".github" / "workflows" / "release-latest.yml").read_text(encoding="utf8")

        for runtime_file in (
            "jira_server.py",
            "jira-dashboard.html",
            "requirements.txt",
            "pyproject.toml",
            ".env.example",
            "INSTALL.md",
            "README.md",
        ):
            self.assertIn(runtime_file, source)

        self.assertIn("cp -R backend planning frontend release-root/", source)
        self.assertIn("rm -rf release-root/frontend/src", source)
        self.assertIn("find release-root/frontend -mindepth 1 -maxdepth 1 ! -name dist", source)
        self.assertIn("cp -R assets release-root/", source)
        self.assertIn("cp -R scripts release-root/", source)

    def test_docs_state_release_zip_is_runnable_package(self):
        readme = (ROOT / "README.md").read_text(encoding="utf8")
        install = (ROOT / "INSTALL.md").read_text(encoding="utf8")

        for source in (readme, install):
            self.assertIn("release zip is the runnable package", source)
            self.assertIn("Editable installs assume the source checkout or extracted release directory is still present", source)
