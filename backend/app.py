"""Flask application construction for the Jira execution planner."""

import os

from flask import Flask
from flask_cors import CORS


def _allowed_cors_origins():
    raw = os.getenv('APP_ALLOWED_ORIGINS', 'http://localhost:5050,http://127.0.0.1:5050')
    origins = [origin.strip() for origin in raw.split(',') if origin.strip()]
    if '*' in origins:
        raise ValueError('APP_ALLOWED_ORIGINS cannot include * when credentialed CORS is enabled')
    return origins


def create_app(import_name='jira_server'):
    flask_app = Flask(import_name)
    flask_app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.getenv('SESSION_COOKIE_SECURE', '').strip().lower() in {'1', 'true', 'yes'},
    )
    CORS(flask_app, origins=_allowed_cors_origins(), supports_credentials=True)
    from backend.security.guards import register_security_guards
    from backend.security.headers import register_security_headers

    register_security_guards(flask_app)
    register_security_headers(flask_app)
    register_blueprints(flask_app)
    return flask_app


def register_blueprints(flask_app):
    from backend.routes.admin_routes import bp as admin_bp
    from backend.routes.auth_routes import bp as auth_bp
    from backend.routes.capacity_routes import bp as capacity_bp
    from backend.routes.dev_routes import bp as dev_bp
    from backend.routes.diagnostic_routes import bp as diagnostic_bp
    from backend.routes.eng_routes import bp as eng_bp
    from backend.routes.epm_routes import bp as epm_bp
    from backend.routes.export_routes import bp as export_bp
    from backend.routes.scenario_routes import bp as scenario_bp
    from backend.routes.settings_routes import bp as settings_bp
    from backend.routes.stats_routes import bp as stats_bp
    from backend.routes.scenario_draft_routes import bp as scenario_draft_bp
    from backend.routes.user_connection_routes import bp as user_connection_bp
    from backend.routes.views_routes import bp as views_bp

    flask_app.register_blueprint(auth_bp)
    flask_app.register_blueprint(user_connection_bp)
    flask_app.register_blueprint(views_bp)
    flask_app.register_blueprint(scenario_bp)
    flask_app.register_blueprint(scenario_draft_bp)
    flask_app.register_blueprint(admin_bp)
    flask_app.register_blueprint(epm_bp)
    flask_app.register_blueprint(eng_bp)
    flask_app.register_blueprint(settings_bp)
    flask_app.register_blueprint(stats_bp)
    flask_app.register_blueprint(capacity_bp)
    flask_app.register_blueprint(diagnostic_bp)
    flask_app.register_blueprint(dev_bp)
    flask_app.register_blueprint(export_bp)
    return flask_app
