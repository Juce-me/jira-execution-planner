import unittest

import jira_server


class SecurityHeaderTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        self.client = jira_server.app.test_client()

    def test_public_page_has_security_headers(self):
        response = self.client.get("/health")
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.headers.get("Referrer-Policy"), "same-origin")
        self.assertIn("frame-ancestors 'self'", response.headers.get("Content-Security-Policy", ""))

    def test_script_csp_allows_gtm_without_inline_javascript(self):
        response = self.client.get("/health")
        csp = response.headers.get("Content-Security-Policy", "")
        script_policy = next((part.strip() for part in csp.split(";") if part.strip().startswith("script-src")), "")
        self.assertEqual(script_policy, "script-src 'self' https://*.googletagmanager.com")
        self.assertNotIn("'unsafe-inline'", script_policy)

    def test_csp_allows_gtm_and_ga4_collection_endpoints(self):
        response = self.client.get("/health")
        csp = response.headers.get("Content-Security-Policy", "")
        directives = {
            part.strip().split(" ", 1)[0]: part.strip()
            for part in csp.split(";")
            if part.strip()
        }
        self.assertEqual(
            directives.get("img-src"),
            "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
        )
        self.assertEqual(
            directives.get("connect-src"),
            "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
        )

    def test_api_response_has_no_store_cache_header(self):
        response = self.client.get("/api/auth/status")
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    def test_credentialed_cors_allows_configured_origin(self):
        response = self.client.get("/api/auth/status", headers={"Origin": "http://localhost:5050"})
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5050")
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")

    def test_credentialed_cors_rejects_unconfigured_origin(self):
        response = self.client.get("/api/auth/status", headers={"Origin": "https://evil.example.test"})
        self.assertNotEqual(response.headers.get("Access-Control-Allow-Origin"), "https://evil.example.test")
