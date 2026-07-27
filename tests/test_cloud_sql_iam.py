import logging
from pathlib import Path
import threading
import traceback
import unittest
from unittest.mock import Mock, patch

from backend.db import cloud_sql
from backend.db.cloud_sql import (
    CLOUD_SQL_LOGIN_SCOPE,
    CloudSqlConfigurationError,
    CloudSqlConnectionError,
    CloudSqlIamConfig,
    CloudSqlIamTokenError,
    IamLoginTokenProvider,
    build_psycopg_creator,
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
                "connect_timeout": 10,
                "user": "service-account@project.iam",
                "host": "private-db.internal.example",
                "port": 5432,
                "dbname": "planner",
                "sslmode": "verify-full",
                "sslrootcert": "/mounted-secrets/server-ca.pem",
            },
        )
        self.assertEqual(cloud_sql.CLOUD_SQL_CONNECT_TIMEOUT_SECONDS, 10)

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

    def test_rejects_operator_supplied_connect_timeout(self):
        with self.assertRaises(CloudSqlConfigurationError):
            CloudSqlIamConfig.from_database_url(
                "postgresql+psycopg://iam-user@db:5432/planner"
                "?sslmode=require&connect_timeout=60"
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


class _SequencedTokenProvider:
    def __init__(self, tokens):
        self._tokens = iter(tokens)
        self.calls = 0

    def current_token(self):
        self.calls += 1
        return next(self._tokens)


class CloudSqlPsycopgCreatorTests(unittest.TestCase):
    def setUp(self):
        self.config = CloudSqlIamConfig.from_database_url(
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
            "?sslmode=require"
        )

    def test_every_creator_call_receives_the_current_token(self):
        provider = _SequencedTokenProvider(["token-one", "token-two"])
        connect_fn = Mock(side_effect=["connection-one", "connection-two"])
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=connect_fn,
        )

        self.assertEqual(creator(), "connection-one")
        self.assertEqual(creator(), "connection-two")
        self.assertEqual(provider.calls, 2)
        self.assertEqual(
            [call.kwargs["password"] for call in connect_fn.call_args_list],
            ["token-one", "token-two"],
        )
        for call in connect_fn.call_args_list:
            self.assertEqual(call.kwargs["user"], "iam-user")
            self.assertEqual(call.kwargs["host"], "private-db.internal.example")
            self.assertEqual(call.kwargs["dbname"], "planner")
            self.assertEqual(call.kwargs["sslmode"], "require")
            self.assertEqual(call.kwargs["connect_timeout"], 10)

    def test_token_provider_failure_propagates_without_calling_psycopg(self):
        token_error = CloudSqlIamTokenError("synthetic token failure")
        provider = Mock()
        provider.current_token.side_effect = token_error
        connect_fn = Mock()
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=connect_fn,
        )

        with self.assertRaises(CloudSqlIamTokenError) as raised:
            creator()

        self.assertIs(raised.exception, token_error)
        connect_fn.assert_not_called()

    def test_connection_failure_is_sanitized(self):
        token = "sensitive-login-token"
        secret = "libpq-secret-detail"
        provider = _SequencedTokenProvider([token])
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=Mock(side_effect=RuntimeError(f"{secret} {token}")),
        )

        with self.assertRaises(CloudSqlConnectionError) as raised:
            creator()

        rendered = "".join(traceback.format_exception(raised.exception))
        self.assertEqual(
            str(raised.exception),
            "Cloud SQL IAM database connection failed.",
        )
        self.assertNotIn(token, rendered)
        self.assertNotIn(secret, rendered)
        self.assertIsNone(raised.exception.__cause__)
        self.assertIsNone(raised.exception.__context__)

    def test_creator_does_not_log_token_or_connection_arguments(self):
        token = "sensitive-login-token"
        provider = _SequencedTokenProvider([token])
        connect_fn = Mock(return_value="connection")
        creator = build_psycopg_creator(
            self.config,
            provider,
            connect_fn=connect_fn,
        )

        with self.assertLogs(level=logging.DEBUG) as captured:
            logging.getLogger().debug("creator test boundary")
            creator()

        output = "\n".join(captured.output)
        self.assertNotIn(token, output)
        self.assertNotIn("private-db.internal.example", output)


class CloudSqlScopeGuardTests(unittest.TestCase):
    def test_runtime_dependencies_exclude_connector_and_alternate_drivers(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf8").lower()
        self.assertNotIn("cloud-sql-python-connector", requirements)
        self.assertNotIn("pg8000", requirements)
        self.assertNotIn("asyncpg", requirements)
        self.assertIn("psycopg[binary]==3.2.13", requirements)

    def test_database_runtime_has_no_connector_or_proxy_imports(self):
        source = "\n".join(
            path.read_text(encoding="utf8")
            for path in sorted((ROOT / "backend" / "db").rglob("*.py"))
        ).lower()
        for forbidden in (
            "google.cloud.sql.connector",
            "cloud_sql_python_connector",
            "import pg8000",
            "import asyncpg",
            "cloud-sql-proxy",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_container_entrypoints_have_no_proxy_process_integration(self):
        runtime_files = (
            ROOT / "Dockerfile",
            ROOT / "scripts" / "docker-entrypoint.sh",
        )
        source = "\n".join(
            path.read_text(encoding="utf8")
            for path in runtime_files
        ).lower()
        for forbidden in ("cloud-sql-proxy", "cloud_sql_proxy"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
