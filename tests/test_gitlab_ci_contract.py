import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class GitLabCiContractTests(unittest.TestCase):
    def _ci(self):
        return (ROOT / ".gitlab-ci.yml").read_text(encoding="utf8")

    def test_gitlab_ci_has_verify_and_container_stages(self):
        ci = self._ci()

        self.assertIn("stages:", ci)
        self.assertIn("- verify", ci)
        self.assertIn("- container", ci)
        self.assertNotIn("- deploy", ci)

    def test_gitlab_ci_defaults_are_non_deploying(self):
        ci = self._ci()

        self.assertIn('IMAGE_NAME: "$CI_REGISTRY_IMAGE"', ci)
        self.assertIn('PUSH_IMAGE: "false"', ci)

    def test_gitlab_ci_runs_existing_project_verification(self):
        ci = self._ci()

        for command in (
            "python -m pip install -r requirements.txt",
            "python -m pip install -e .",
            "python -m unittest discover -s tests",
            "npm ci",
            "npm run build",
            "npm run test:frontend:unit",
            "git diff --exit-code frontend/dist",
        ):
            self.assertIn(command, ci)

        for env_setting in (
            'JIRA_AUTH_MODE: "basic"',
            'CONFIG_STORAGE_BACKEND: "jsonfile"',
            'APP_ENVIRONMENT_KEY: "local"',
        ):
            self.assertIn(env_setting, ci)

    def test_gitlab_ci_builds_sha_tagged_image_from_dockerfile(self):
        ci = self._ci()

        self.assertIn('docker build --pull -f Dockerfile -t "$IMAGE_NAME:$CI_COMMIT_SHA" .', ci)
        self.assertIn("$CI_COMMIT_SHA", ci)
        self.assertIn("Dockerfile", ci)
        self.assertIn("when: manual", ci)
        self.assertIn("allow_failure: true", ci)

    def test_gitlab_ci_has_no_deploy_or_ungated_push_commands(self):
        ci = self._ci()

        for forbidden in ("kubectl", "helm", "terraform", "ssh ", "scp "):
            self.assertNotIn(forbidden, ci.lower())
        self.assertNotRegex(ci, r"(?im)^\s*-\s+.*\bdeploy\b")

        if "docker push" in ci:
            self.assertIn('if [ "$PUSH_IMAGE" = "true" ]; then', ci)
            self.assertIn('IMAGE_NAME must start with CI_REGISTRY when PUSH_IMAGE=true', ci)
            self.assertIn('case "$IMAGE_NAME" in "$CI_REGISTRY"/*)', ci)
            self.assertLess(
                ci.index('if [ "$PUSH_IMAGE" = "true" ]; then'),
                ci.index("docker push"),
            )
            self.assertLess(
                ci.index('case "$IMAGE_NAME" in "$CI_REGISTRY"/*)'),
                ci.index("docker push"),
            )

    def test_gitlab_ci_does_not_contain_secret_or_target_values(self):
        ci = self._ci()

        forbidden_patterns = (
            r"postgresql(?:\+psycopg)?://",
            r"(?i)bearer\s+[a-z0-9._-]+",
            r"(?i)atl[a-z0-9_-]{20,}",
            r"(?i)client_secret\s*[:=]\s*['\"]?[a-z0-9._-]+",
            r"/Users/[^\\s'\"]+",
            r"registry\.internal",
            r"\.corp\b",
            r"\.internal\b",
        )
        for pattern in forbidden_patterns:
            self.assertIsNone(re.search(pattern, ci), pattern)
