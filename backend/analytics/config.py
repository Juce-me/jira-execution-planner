"""GA4/GTM analytics configuration parsing and validation."""

import os
import re
from dataclasses import dataclass


TRUE_VALUES = {"1", "true", "yes"}
GTM_CONTAINER_RE = re.compile(r"^GTM-[A-Z0-9]+$")
GA4_MEASUREMENT_RE = re.compile(r"^G-[A-Z0-9]+$")


class AnalyticsConfigError(ValueError):
    """Raised when enabled analytics configuration is unsafe to serve."""


def _env_flag(environ, name):
    return str(environ.get(name) or "").strip().lower() in TRUE_VALUES


@dataclass(frozen=True)
class AnalyticsConfig:
    enabled: bool
    gtm_container_id: str
    measurement_id: str
    user_id_pepper: str
    debug_mode: bool

    def validate_startup(self):
        if not self.enabled:
            return self
        if not GTM_CONTAINER_RE.match(self.gtm_container_id):
            raise AnalyticsConfigError("GTM_CONTAINER_ID must match GTM-[A-Z0-9]+ when GA4_ENABLED=true")
        if not GA4_MEASUREMENT_RE.match(self.measurement_id):
            raise AnalyticsConfigError("GA4_MEASUREMENT_ID must match G-[A-Z0-9]+ when GA4_ENABLED=true")
        if not self.user_id_pepper:
            raise AnalyticsConfigError("GA4_USER_ID_PEPPER is required when GA4_ENABLED=true")
        return self

    def context_payload(self, auth_context):
        if not self.enabled:
            return {
                "enabled": False,
                "gtmContainerId": None,
                "measurementId": None,
                "debugMode": False,
                "ga4UserId": None,
            }

        from backend.analytics.identity import ga4_user_id_for_context

        return {
            "enabled": True,
            "gtmContainerId": self.gtm_container_id,
            "measurementId": self.measurement_id,
            "debugMode": self.debug_mode,
            "ga4UserId": ga4_user_id_for_context(self, auth_context),
        }


def load_analytics_config(environ=None):
    source = environ if environ is not None else os.environ
    return AnalyticsConfig(
        enabled=_env_flag(source, "GA4_ENABLED"),
        gtm_container_id=str(source.get("GTM_CONTAINER_ID") or "").strip(),
        measurement_id=str(source.get("GA4_MEASUREMENT_ID") or "").strip(),
        user_id_pepper=str(source.get("GA4_USER_ID_PEPPER") or "").strip(),
        debug_mode=_env_flag(source, "GA4_DEBUG_MODE"),
    )


def validate_analytics_startup_config(environ=None):
    return load_analytics_config(environ).validate_startup()
