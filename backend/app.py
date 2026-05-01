"""Flask application construction for the Jira execution planner."""

from flask import Flask
from flask_cors import CORS


def create_app(import_name='jira_server'):
    flask_app = Flask(import_name)
    CORS(flask_app)
    register_blueprints(flask_app)
    return flask_app


def register_blueprints(flask_app):
    return flask_app


app = create_app()
