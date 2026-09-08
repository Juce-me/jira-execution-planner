import unittest
import uuid
import importlib
from contextlib import contextmanager
from dataclasses import replace
from unittest.mock import Mock, patch
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy import inspect
from alembic.migration import MigrationContext
from alembic.operations import Operations

from backend.db.models import Base
from backend.services import load_performance as performance


def observation(duration=1000, completeness='complete', outcome='success'):
    return dict(loadId=str(uuid.uuid4()), groupId='department-a', sprintId='sprint-a',
                surface='eng_sprint', outcome=outcome, durationMs=duration,
                lanes=[dict(project=project, durationMs=duration, issueCount=10,
                            epicCount=2, storyCount=8, payloadBytes=2000,
                            cacheState='miss', completeness=completeness,
                            stages={'total': duration}, jiraRequests=None,
                            jiraPages=None, jiraRetries=None) for project in ('product', 'tech')])


class LoadPerformanceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    def save(self, value, workspace='workspace-a', now=None):
        return performance.record_load(self.session, workspace, value,
                                       environment='local', revision='abc123', now=now)

    def test_schema_rejects_untrusted_or_unbounded_data(self):
        for field, value in [('userId', 'other'), ('durationMs', True),
                             ('durationMs', float('nan')), ('durationMs', 10 ** 400), ('groupId', 'x' * 129),
                             ('surface', 'other'), ('lanes', [])]:
            payload = observation()
            payload[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                performance.validate_load(payload)
        payload = observation()
        payload['lanes'][0]['issues'] = [{'key': 'PRIVATE-1'}]
        with self.assertRaises(ValueError):
            performance.validate_load(payload)
        payload = observation()
        payload['lanes'] *= 2
        with self.assertRaises(ValueError):
            performance.validate_load(payload)

    def test_success_requires_both_lanes_and_full_wall_clock_duration(self):
        for mutation in ('missing-lane', 'lane-too-long', 'dependencies-too-long'):
            payload = observation()
            if mutation == 'missing-lane':
                payload['lanes'].pop()
            elif mutation == 'lane-too-long':
                payload['lanes'][0]['durationMs'] = 2000
            else:
                payload['dependencyDurationMs'] = 2000
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                performance.validate_load(payload)
        payload = observation(outcome='cancelled')
        payload['lanes'] = []
        performance.validate_load(payload)

    def test_local_revision_changes_when_the_served_bundle_changes(self):
        from backend.routes import performance_routes
        bundle = Mock()
        bundle.stat.return_value = SimpleNamespace(st_mtime_ns=1, st_size=5)
        bundle.read_bytes.return_value = b'first'
        with patch.dict('os.environ', {'APP_REVISION': ''}), \
             patch.object(performance_routes, 'FRONTEND_BUNDLE', bundle), \
             patch.object(performance_routes, 'run_git_command', return_value=('abc123-dirty', None)):
            first = performance_routes._revision()
            self.assertEqual(performance_routes._revision(), first)
            self.assertEqual(bundle.read_bytes.call_count, 1)
            bundle.stat.return_value = SimpleNamespace(st_mtime_ns=2, st_size=6)
            bundle.read_bytes.return_value = b'second'
            self.assertNotEqual(performance_routes._revision(), first)
    def test_idempotence_workspace_isolation_and_percentiles(self):
        first = observation(1000)
        self.assertTrue(self.save(first))
        self.assertFalse(self.save(first))
        self.save(observation(5000))
        self.save(observation(9000), 'workspace-b')
        self.save(observation(60000, 'capped'))
        self.save(observation(1, 'unknown'))
        self.save(observation(100, outcome='error'))
        self.save(observation(200, outcome='cancelled'))
        summary = performance.load_report(self.session, 'workspace-a')['summary']
        self.assertEqual(summary['sampleCount'], 6)
        self.assertEqual(summary['eligibleCount'], 2)
        self.assertEqual(summary['avgMs'], 2000.33)
        self.assertEqual(summary['p50Ms'], 1000)
        self.assertEqual(summary['p95Ms'], 4600)
        self.assertEqual(summary['unknownCount'], 1)
        self.assertTrue(summary['contextual'])
        self.assertEqual(summary['breachCount'], 1)
        self.assertEqual(summary['cappedCount'], 1)
        self.assertEqual(summary['errorCount'], 1)
        self.assertEqual(summary['cancelledCount'], 1)

    def test_retention_filters_and_truncation(self):
        now = datetime.now(timezone.utc)
        self.save(observation(9000), now=now - timedelta(days=31))
        self.save(observation(1000), now=now)
        value = observation(2000)
        value['sprintId'] = 'sprint-b'
        self.save(value, now=now)
        report = performance.load_report(self.session, 'workspace-a', {'sprintId': 'sprint-b'})
        self.assertEqual(report['summary']['sampleCount'], 1)
        self.assertEqual(report['summary']['avgMs'], 2000)
        report = performance.load_report(self.session, 'workspace-a', limit=1)
        self.assertTrue(report['truncated'])
        self.assertEqual(report['summary']['sampleCount'], 1)
        self.assertEqual(len(self.session.query(performance.LoadPerformance).all()), 2)

    def test_environment_separates_identical_workspace_scopes(self):
        self.save(observation(1000))
        performance.record_load(self.session, 'workspace-a', observation(9000), environment='production', revision='abc123')
        report = performance.load_report(self.session, 'workspace-a', environment='local')
        self.assertEqual(report['summary']['sampleCount'], 1)
        self.assertEqual(report['summary']['avgMs'], 1000)

    def test_filter_choices_remain_available_after_selecting_a_scope(self):
        self.save(observation())
        other = observation()
        other['groupId'] = 'department-b'
        self.save(other)
        report = performance.load_report(self.session, 'workspace-a', {'groupId': 'department-a'})
        self.assertEqual(report['filters']['groups'], ['department-a', 'department-b'])

    def test_collection_defaults_on_with_database_and_supports_opt_out(self):
        self.assertFalse(performance.collection_enabled({}))
        self.assertFalse(performance.collection_enabled({'APP_PERFORMANCE_DEBUG': 'true'}))
        self.assertTrue(performance.collection_enabled({'DATABASE_URL': 'sqlite://'}))
        self.assertFalse(performance.collection_enabled({'APP_PERFORMANCE_DEBUG': 'false', 'DATABASE_URL': 'sqlite://'}))
        self.assertTrue(performance.collection_enabled({'APP_PERFORMANCE_DEBUG': 'true', 'DATABASE_URL': 'sqlite://'}))

    def test_epics_without_child_issues_and_dependency_timing_are_preserved(self):
        payload = observation()
        payload['lanes'][0].update(issueCount=0, epicCount=10, storyCount=0)
        payload['dependencyDurationMs'] = 300
        self.save(payload)
        sample = performance.load_report(self.session, 'workspace-a')['samples'][0]
        self.assertEqual(sample['lanes'][0]['epicCount'], 10)
        self.assertEqual(sample['dependencyDurationMs'], 300)

    def test_first_content_timing_roundtrip_and_duration_bound(self):
        payload = observation()
        payload['firstContentMs'] = 250
        self.save(payload)
        sample = performance.load_report(self.session, 'workspace-a')['samples'][0]
        self.assertEqual(sample['firstContentMs'], 250)
        for value in (1001, -1, True, '250'):
            payload['firstContentMs'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                performance.validate_load(payload)
        payload['firstContentMs'] = None
        performance.validate_load(payload)

    def test_migration_matches_model_and_downgrades(self):
        migration = importlib.import_module('backend.db.migrations.versions.20260908_0014_load_performance')
        engine = create_engine('sqlite://')
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                inspector = inspect(connection)
                self.assertEqual({c['name'] for c in inspector.get_columns('load_performance')},
                                 set(performance.LoadPerformance.__table__.columns.keys()))
                self.assertEqual(inspector.get_foreign_keys('load_performance'), [])
                migration.downgrade()
                self.assertNotIn('load_performance', inspect(connection).get_table_names())


class LoadPerformanceSecurityTests(unittest.TestCase):
    def setUp(self):
        import jira_server
        self.server = jira_server
        self.server.app.config['TESTING'] = True
        self.server.app.secret_key = 'synthetic-test-secret'
        self.client = self.server.app.test_client()

    def test_anonymous_oauth_denied_and_missing_csrf_denied(self):
        from tests.oauth_test_helpers import install_oauth_session
        from tests.test_endpoint_security_matrix import _verified_context
        with patch.object(self.server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            for method, path in [('GET', '/api/performance/context'), ('POST', '/api/performance/loads'),
                                 ('GET', '/api/admin/performance')]:
                self.assertEqual(self.client.open(path, method=method).status_code, 401)
            install_oauth_session(self.client, account_id='synthetic-account')
            with patch.object(self.server, 'current_request_auth_context', return_value=_verified_context()):
                response = self.client.post('/api/performance/loads', json=observation())
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()['error'], 'csrf_required')

    def test_admin_denied_even_when_settings_are_collaborative(self):
        from tests.oauth_test_helpers import install_oauth_session
        from tests.test_endpoint_security_matrix import _verified_context
        with patch.object(self.server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(self.server, 'SETTINGS_ADMIN_ONLY', False), \
             patch.object(self.server, 'current_request_auth_context', return_value=_verified_context()):
            install_oauth_session(self.client, account_id='synthetic-account')
            response = self.client.get('/api/admin/performance')
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.get_json()['error'], 'admin_required')

    def test_ingestion_and_admin_read_are_workspace_scoped(self):
        from tests.test_endpoint_security_matrix import _verified_context
        engine = create_engine('sqlite://')
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)

        @contextmanager
        def database_session():
            with Session(engine) as session:
                yield session
                session.commit()

        context = _verified_context(is_admin=True)
        with patch.object(self.server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.dict('os.environ', {'APP_ENVIRONMENT_KEY': 'local', 'APP_PERFORMANCE_DEBUG': 'true', 'DATABASE_URL': 'sqlite://'}), \
             patch.object(self.server, 'current_request_auth_context', return_value=context), \
             patch('backend.routes.performance_routes.session_scope', database_session):
            payload = observation()
            response = self.client.post('/api/performance/loads', json=payload)
            self.assertEqual(response.status_code, 201, response.get_json())
            self.assertEqual(self.client.post('/api/performance/loads', json=payload).status_code, 200)
            response = self.client.get('/api/admin/performance')
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertEqual(response.get_json()['summary']['sampleCount'], 1)
            with patch.object(self.server, 'current_request_auth_context', return_value=replace(context, workspace_id='other-workspace')):
                self.assertEqual(self.client.get('/api/admin/performance').get_json()['summary']['sampleCount'], 0)
            payload['workspaceId'] = 'other-workspace'
            self.assertEqual(self.client.post('/api/performance/loads', json=payload).status_code, 400)
            self.assertEqual(self.client.post('/api/performance/loads', data='x' * 16385).status_code, 413)
            with patch.dict('os.environ', {'APP_PERFORMANCE_DEBUG': 'false'}):
                self.assertEqual(self.client.post('/api/performance/loads', json=observation()).status_code, 404)
