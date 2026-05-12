import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from backend.epm import home as epm_home

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "check_home_write_capability.py"


class HomeWriteCapabilityGateTests(unittest.TestCase):
    def test_update_payload_contract_is_text_only(self):
        payload = epm_home.normalize_home_project_update_payload({
            "updateText": "  Shipping the private beta this week.  ",
            "clientMutationId": "home-update-1",
        })

        self.assertEqual(payload, {
            "updateText": "Shipping the private beta this week.",
            "clientMutationId": "home-update-1",
        })

    def test_update_payload_rejects_blank_and_oversized_text(self):
        with self.assertRaises(ValueError):
            epm_home.normalize_home_project_update_payload({"updateText": "   "})
        with self.assertRaises(ValueError):
            epm_home.normalize_home_project_update_payload({"updateText": "x" * 4001})

    def test_update_payload_rejects_proxy_and_credential_fields(self):
        for field in ("query", "operationName", "variables", "email", "apiToken", "authorization", "status", "lifecycle", "author"):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    epm_home.normalize_home_project_update_payload({
                        "updateText": "Shipping the private beta this week.",
                        field: "blocked",
                    })

    def test_update_payload_rejects_unknown_fields(self):
        with self.assertRaises(ValueError):
            epm_home.normalize_home_project_update_payload({
                "updateText": "Shipping the private beta this week.",
                "unexpectedField": "blocked",
            })

    def test_project_update_mutation_is_specific_and_server_owned(self):
        mutation = epm_home.HOME_PROJECT_UPDATE_MUTATION

        self.assertIn("mutation", mutation.lower())
        self.assertIn("$projectId", mutation)
        self.assertIn("$updateText", mutation)
        self.assertNotIn("$query", mutation)
        self.assertNotIn("$operationName", mutation)

    def test_write_probe_redacts_token_material(self):
        rendered = json.dumps(epm_home.redact_home_write_probe_payload({
            "email": "user@example.com",
            "apiToken": "secret-token",
            "Authorization": "secret-token",
            "result": {"decision": "pass", "reason": "home_project_update_supported"},
        }))

        self.assertNotIn("secret-token", rendered)
        self.assertNotIn("Basic", rendered)
        self.assertIn("home_project_update_supported", rendered)

    def test_write_probe_script_refuses_without_explicit_execute(self):
        env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("HOME_WRITE_PROBE_")
        }
        env.update({
            "HOME_WRITE_PROBE_EMAIL": "user@example.com",
            "HOME_WRITE_PROBE_API_TOKEN": "secret-token",
            "HOME_WRITE_PROBE_PROJECT_ID": "home-project-1",
            "HOME_WRITE_PROBE_TEXT": "Shipping the private beta this week.",
        })

        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--confirm-project-id", "home-project-1"],
            cwd=str(REPO_ROOT),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "FAIL insufficient_home_write_probe_input")
        self.assertNotIn("secret-token", result.stdout + result.stderr)
        self.assertNotIn("user@example.com", result.stdout + result.stderr)
