import os

from flask import request


def _content_security_policy():
    return "; ".join([
        "default-src 'self'",
        "script-src 'self' https://*.googletagmanager.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
        "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
    ])


def register_security_headers(flask_app):
    @flask_app.after_request
    def apply_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Content-Security-Policy", _content_security_policy())
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        if os.getenv("SESSION_COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes"}:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    return flask_app
