"""Flask application construction for the Jira execution planner."""

from flask import Flask
from flask_cors import CORS


def create_app(import_name='jira_server'):
    flask_app = Flask(import_name)
    CORS(flask_app)
    register_blueprints(flask_app)
    return flask_app


def register_blueprints(flask_app):
    from backend.routes.eng_routes import bp as eng_bp
    from backend.routes.epm_routes import bp as epm_bp
    from backend.routes.settings_routes import bp as settings_bp

    flask_app.register_blueprint(epm_bp)
    flask_app.register_blueprint(eng_bp)
    flask_app.register_blueprint(settings_bp)
    return flask_app


app = create_app()
