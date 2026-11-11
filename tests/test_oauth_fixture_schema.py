"""OAuth session fixtures use an explicitly prepared schema without repeated DDL."""

import os
import unittest
from unittest.mock import patch

from flask import session
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.pool import NullPool

import jira_server
from backend.auth.db_context import resolve_db_request_auth_context
from backend.db import engine as db_engine, models
from tests.oauth_test_helpers import install_oauth_session, push_oauth_request, set_up_db_oauth
from tests.postgres_test_db import fresh_database_url


class OAuthFixtureSchemaTests(unittest.TestCase):
    def setUp(self):
        config = patch.dict(jira_server.app.config, {
            'TESTING': True, 'SECRET_KEY': 'synthetic-fixture-schema-key',
        })
        config.start()
        self.addCleanup(config.stop)
        self.url = set_up_db_oauth(self)
        self.client = jira_server.app.test_client()

    def test_setup_is_unseeded_and_session_installation_does_not_initialize_schema(self):
        with db_engine.session_scope() as db:
            self.assertEqual(db.query(models.User).count(), 0)
        with patch.object(models.Base.metadata, 'create_all', side_effect=AssertionError('unexpected fixture DDL')):
            first = install_oauth_session(self.client, account_id='synthetic-first')
            second = install_oauth_session(jira_server.app.test_client(), account_id='synthetic-second')
            with db_engine.session_scope() as db:
                browser = db.get(models.BrowserSession, first['db_browser_session_id'])
                connection_id = browser.auth_connection_id
            third = install_oauth_session(jira_server.app.test_client(), db_auth_connection_id=connection_id)
        self.assertEqual(len({cookie['db_browser_session_id'] for cookie in (first, second, third)}), 3)
        with db_engine.session_scope() as db:
            self.assertEqual(db.query(models.User).count(), 2)
            self.assertEqual(db.query(models.Workspace).count(), 1)
            self.assertEqual(db.query(models.BrowserSession).count(), 3)

    def test_request_context_uses_persisted_identity_without_schema_initialization(self):
        with patch.object(models.Base.metadata, 'create_all', side_effect=AssertionError('unexpected fixture DDL')):
            context = push_oauth_request(jira_server.app, account_id='synthetic-request-user')
            self.addCleanup(context.pop)
            actor = resolve_db_request_auth_context(session['db_oauth_session'])
        self.assertIsNotNone(actor)
        self.assertEqual(actor.atlassian_account_id, 'synthetic-request-user')

    def test_session_installation_does_not_silently_initialize_an_empty_database(self):
        empty_url = fresh_database_url(self.addCleanup)
        with patch.dict(os.environ, {'DATABASE_URL': empty_url, 'TEST_DATABASE_URL': empty_url}):
            with self.assertRaises(ProgrammingError):
                install_oauth_session(self.client)
        engine = create_engine(empty_url, poolclass=NullPool)
        try:
            with engine.connect() as connection:
                self.assertEqual(connection.execute(text(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
                )).scalar_one(), 0)
        finally:
            engine.dispose()


if __name__ == '__main__':
    unittest.main()
