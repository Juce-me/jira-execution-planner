import base64
import hashlib
import hmac
import unittest
from types import SimpleNamespace


class AnalyticsIdentityTests(unittest.TestCase):
    def test_pseudonymous_user_id_is_stable_base64url_hmac(self):
        from backend.analytics.identity import pseudonymous_ga4_user_id

        expected = base64.urlsafe_b64encode(
            hmac.new(b"pepper-1", b"user:account-123", hashlib.sha256).digest()
        ).decode("ascii").rstrip("=")

        self.assertEqual(pseudonymous_ga4_user_id("pepper-1", "account-123"), expected)
        self.assertEqual(pseudonymous_ga4_user_id("pepper-1", "account-123"), expected)
        self.assertNotEqual(
            pseudonymous_ga4_user_id("pepper-1", "account-123"),
            pseudonymous_ga4_user_id("pepper-1", "account-456"),
        )
        self.assertNotIn("=", expected)

    def test_ga4_user_id_is_only_for_real_per_user_oauth_or_db_contexts(self):
        from backend.analytics.config import AnalyticsConfig
        from backend.analytics.identity import ga4_user_id_for_context

        config = AnalyticsConfig(
            enabled=True,
            gtm_container_id="GTM-NZJW2CFN",
            measurement_id="G-6QERX19WB0",
            user_id_pepper="pepper-1",
            debug_mode=False,
        )

        disallowed_contexts = [
            None,
            SimpleNamespace(auth_mode="basic", stable_subject="local-basic"),
            SimpleNamespace(auth_mode="atlassian_oauth", stable_subject=""),
            SimpleNamespace(auth_mode="atlassian_oauth", stable_subject="local-basic"),
            SimpleNamespace(auth_mode="local", stable_subject="account-123"),
        ]
        for context in disallowed_contexts:
            with self.subTest(context=context):
                self.assertIsNone(ga4_user_id_for_context(config, context))

        oauth_context = SimpleNamespace(auth_mode="atlassian_oauth", stable_subject="account-123")
        db_context = SimpleNamespace(auth_mode="db_oauth", stable_subject="db-user-123")
        self.assertIsNotNone(ga4_user_id_for_context(config, oauth_context))
        self.assertIsNotNone(ga4_user_id_for_context(config, db_context))

    def test_enabled_config_requires_valid_container_measurement_and_pepper(self):
        from backend.analytics.config import AnalyticsConfigError, load_analytics_config

        valid_env = {
            "GA4_ENABLED": "true",
            "GTM_CONTAINER_ID": "GTM-NZJW2CFN",
            "GA4_MEASUREMENT_ID": "G-6QERX19WB0",
            "GA4_USER_ID_PEPPER": "pepper-1",
        }
        self.assertTrue(load_analytics_config(valid_env).enabled)

        invalid_cases = [
            {"GTM_CONTAINER_ID": ""},
            {"GTM_CONTAINER_ID": "G-"},
            {"GA4_MEASUREMENT_ID": ""},
            {"GA4_MEASUREMENT_ID": "UA-123"},
            {"GA4_USER_ID_PEPPER": ""},
        ]
        for overrides in invalid_cases:
            env = dict(valid_env)
            env.update(overrides)
            with self.subTest(overrides=overrides):
                with self.assertRaises(AnalyticsConfigError):
                    load_analytics_config(env).validate_startup()

    def test_disabled_config_is_import_safe_and_redacts_enabled_values(self):
        from backend.analytics.config import load_analytics_config

        config = load_analytics_config({})

        self.assertFalse(config.enabled)
        self.assertEqual(config.context_payload(None), {
            "enabled": False,
            "gtmContainerId": None,
            "measurementId": None,
            "debugMode": False,
            "ga4UserId": None,
        })


if __name__ == "__main__":
    unittest.main()
