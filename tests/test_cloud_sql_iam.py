from pathlib import Path
import threading
import traceback
import unittest
from unittest.mock import Mock, patch

from backend.db.cloud_sql import (
    CLOUD_SQL_LOGIN_SCOPE,
    CloudSqlConfigurationError,
    CloudSqlIamConfig,
    CloudSqlIamTokenError,
    IamLoginTokenProvider,
)


ROOT = Path(__file__).resolve().parents[1]


class CloudSqlIamConfigTests(unittest.TestCase):
    def test_parses_passwordless_psycopg_url_and_builds_safe_kwargs(self):
        config = CloudSqlIamConfig.from_database_url(
            "postgresql+psycopg://service-account%40project.iam@"
            "private-db.internal.example:5432/planner"
            "?sslmode=verify-full&sslrootcert=%2Fmounted-secrets%2Fserver-ca.pem"
        )

        self.assertEqual(config.safe_url.drivername, "postgresql+psycopg")
        self.assertIsNone(config.safe_url.password)
        self.assertEqual(config.username, "service-account@project.iam")
        self.assertEqual(config.host, "private-db.internal.example")
        self.assertEqual(config.port, 5432)
        self.assertEqual(config.database, "planner")
        self.assertEqual(
            config.connect_kwargs(),
            {
                "user": "service-account@project.iam",
                "host": "private-db.internal.example",
                "port": 5432,
                "dbname": "planner",
                "sslmode": "verify-full",
                "sslrootcert": "/mounted-secrets/server-ca.pem",
            },
        )

    def test_cache_key_contains_only_passwordless_stable_configuration(self):
        config = CloudSqlIamConfig.from_database_url(
            "postgresql+psycopg://iam-user@10.20.30.40:5432/planner"
            "?sslmode=require"
        )

        self.assertNotIn("password", config.cache_key.lower())
        self.assertNotIn("token", config.cache_key.lower())
        self.assertEqual(config.cache_key, config.safe_url.render_as_string(hide_password=False))

    def test_tls_options_cannot_be_mutated_to_inject_connection_parameters(self):
        config = CloudSqlIamConfig.from_database_url(
            "postgresql+psycopg://iam-user@db:5432/planner?sslmode=require"
        )

        with self.assertRaises(TypeError):
            config.tls_options["password"] = "injected"

        self.assertNotIn("password", config.connect_kwargs())

    def test_requires_exact_psycopg_driver(self):
        for url in (
            "postgresql://iam-user@db:5432/planner?sslmode=require",
            "postgresql+psycopg2://iam-user@db:5432/planner?sslmode=require",
            "postgresql+pg8000://iam-user@db:5432/planner?sslmode=require",
            "postgresql+asyncpg://iam-user@db:5432/planner?sslmode=require",
        ):
            with self.subTest(url=url):
                with self.assertRaisesRegex(
                    CloudSqlConfigurationError,
                    "postgresql\\+psycopg",
                ):
                    CloudSqlIamConfig.from_database_url(url)

    def test_rejects_password_in_url_without_fallback(self):
        for url in (
            "postgresql+psycopg://iam-user:secret@db:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user:@db:5432/planner?sslmode=require",
        ):
            with self.subTest(url=url):
                with self.assertRaisesRegex(
                    CloudSqlConfigurationError,
                    "must not contain a password",
                ):
                    CloudSqlIamConfig.from_database_url(url)

    def test_requires_host_user_port_and_database(self):
        invalid_urls = (
            "postgresql+psycopg://db:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@db/planner?sslmode=require",
            "postgresql+psycopg://iam-user@db:not-a-port/planner?sslmode=require",
            "postgresql+psycopg://iam-user@db:5432/?sslmode=require",
        )
        for url in invalid_urls:
            with self.subTest(url=url):
                with self.assertRaises(CloudSqlConfigurationError):
                    CloudSqlIamConfig.from_database_url(url)

    def test_rejects_missing_or_unsafe_tls(self):
        for suffix in ("", "?sslmode=disable", "?sslmode=allow", "?sslmode=prefer"):
            with self.subTest(suffix=suffix):
                with self.assertRaisesRegex(CloudSqlConfigurationError, "TLS"):
                    CloudSqlIamConfig.from_database_url(
                        f"postgresql+psycopg://iam-user@db:5432/planner{suffix}"
                    )

    def test_verify_modes_require_explicit_root_certificate(self):
        for sslmode in ("verify-ca", "verify-full"):
            with self.subTest(sslmode=sslmode):
                with self.assertRaisesRegex(CloudSqlConfigurationError, "sslrootcert"):
                    CloudSqlIamConfig.from_database_url(
                        "postgresql+psycopg://iam-user@db:5432/planner"
                        f"?sslmode={sslmode}"
                    )

    def test_client_certificate_and_key_must_be_paired(self):
        for option in (
            "sslcert=%2Fmounted%2Fclient.pem",
            "sslkey=%2Fmounted%2Fclient-key.pem",
        ):
            with self.subTest(option=option):
                with self.assertRaisesRegex(CloudSqlConfigurationError, "sslcert and sslkey"):
                    CloudSqlIamConfig.from_database_url(
                        "postgresql+psycopg://iam-user@db:5432/planner"
                        f"?sslmode=require&{option}"
                    )

    def test_rejects_unapproved_or_repeated_query_options(self):
        for query in (
            "sslmode=require&password=secret",
            "sslmode=require&passfile=%2Fmounted%2Fpgpass",
            "sslmode=require&service=cloud-sql",
            "sslmode=require&options=-csearch_path%3Dpublic",
            "sslmode=require&sslmode=verify-full",
        ):
            with self.subTest(query=query):
                with self.assertRaises(CloudSqlConfigurationError):
                    CloudSqlIamConfig.from_database_url(
                        f"postgresql+psycopg://iam-user@db:5432/planner?{query}"
                    )

    def test_login_scope_is_exact(self):
        self.assertEqual(
            CLOUD_SQL_LOGIN_SCOPE,
            "https://www.googleapis.com/auth/sqlservice.login",
        )

    def test_requirements_pin_google_auth_and_retain_psycopg(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf8").splitlines()
        self.assertIn("google-auth==2.56.2", requirements)
        self.assertIn("psycopg[binary]==3.2.13", requirements)


class _FakeCredentials:
    def __init__(self, *, token=None, expired=True, refresh_error=None):
        self.token = token
        self.expired = expired
        self.refresh_error = refresh_error
        self.refresh_calls = 0

    @property
    def valid(self):
        return bool(self.token) and not self.expired

    def refresh(self, request):
        self.refresh_calls += 1
        if self.refresh_error:
            raise self.refresh_error
        self.token = f"fresh-token-{self.refresh_calls}"
        self.expired = False


class IamLoginTokenProviderTests(unittest.TestCase):
    def test_from_adc_requests_only_sqlservice_login_scope(self):
        credentials = _FakeCredentials(token="current-token", expired=False)
        with patch(
            "backend.db.cloud_sql.google.auth.default",
            return_value=(credentials, "project-id"),
        ) as default_credentials:
            provider = IamLoginTokenProvider.from_adc()

        self.assertEqual(provider.current_token(), "current-token")
        default_credentials.assert_called_once_with(
            scopes=("https://www.googleapis.com/auth/sqlservice.login",)
        )

    def test_valid_credentials_are_reused_without_refresh(self):
        credentials = _FakeCredentials(token="current-token", expired=False)
        provider = IamLoginTokenProvider(credentials, request=object())

        self.assertEqual(provider.current_token(), "current-token")
        self.assertEqual(provider.current_token(), "current-token")
        self.assertEqual(credentials.refresh_calls, 0)

    def test_expired_credentials_are_refreshed(self):
        credentials = _FakeCredentials(token="expired-token", expired=True)
        provider = IamLoginTokenProvider(credentials, request=object())

        self.assertEqual(provider.current_token(), "fresh-token-1")
        self.assertEqual(credentials.refresh_calls, 1)

    def test_concurrent_requests_perform_one_refresh(self):
        credentials = _FakeCredentials(token=None, expired=True)
        provider = IamLoginTokenProvider(credentials, request=object())
        barrier = threading.Barrier(8)
        results = []
        errors = []

        def worker():
            try:
                barrier.wait()
                results.append(provider.current_token())
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)

        self.assertEqual(errors, [])
        self.assertEqual(results, ["fresh-token-1"] * 8)
        self.assertEqual(credentials.refresh_calls, 1)

    def test_adc_discovery_failure_is_sanitized_without_exception_chain(self):
        secret = "adc-secret-detail"
        with patch(
            "backend.db.cloud_sql.google.auth.default",
            side_effect=RuntimeError(secret),
        ):
            with self.assertRaises(CloudSqlIamTokenError) as raised:
                IamLoginTokenProvider.from_adc()

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertEqual(str(raised.exception), "Cloud SQL IAM credentials are unavailable.")
        self.assertNotIn(secret, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_refresh_failure_is_sanitized_without_token_or_exception_chain(self):
        old_token = "expired-sensitive-token"
        secret = "refresh-secret-detail"
        credentials = _FakeCredentials(
            token=old_token,
            expired=True,
            refresh_error=RuntimeError(secret),
        )
        provider = IamLoginTokenProvider(credentials, request=object())

        with self.assertRaises(CloudSqlIamTokenError) as raised:
            provider.current_token()

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertEqual(
            str(raised.exception),
            "Cloud SQL IAM login token refresh failed.",
        )
        self.assertNotIn(old_token, rendered)
        self.assertNotIn(secret, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_missing_refreshed_token_fails_safely(self):
        credentials = Mock()
        credentials.valid = False
        credentials.token = None
        credentials.refresh.return_value = None
        provider = IamLoginTokenProvider(credentials, request=object())

        with self.assertRaisesRegex(
            CloudSqlIamTokenError,
            "did not return a current login token",
        ):
            provider.current_token()
