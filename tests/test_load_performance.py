import unittest
import uuid
import importlib
from contextlib import contextmanager
from dataclasses import replace
from unittest.mock import Mock, patch
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text
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


def board_observation(duration=1000, scope_type='all_work', outcome='success'):
    return dict(schemaVersion=1, loadId=str(uuid.uuid4()), groupId='department-a',
                sprintId=None if scope_type == 'all_work' else 'sprint-a', surface='eng_board',
                scopeType=scope_type, outcome=outcome, durationMs=duration, indexMs=100,
                firstFocusedContentMs=150, focusedCompleteMs=600, dependencyDurationMs=100,
                epicCount=12, issueCount=40, payloadBytes=5000, jiraRequests=4,
                jiraPages=4, jiraRetries=0, completeness='complete', cacheState='miss',
                peakChildSearches=2, scopeCohortDigest='a' * 64)


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

    def test_board_variant_roundtrips_without_a_fabricated_sprint_or_lanes(self):
        payload = board_observation()
        self.save(payload)
        sample = performance.load_report(
            self.session, 'workspace-a',
            {'surface': 'eng_board', 'scopeType': 'all_work', 'cacheState': 'miss',
             'scopeCohortDigest': 'a' * 64},
        )['samples'][0]
        self.assertIsNone(sample['sprintId'])
        self.assertEqual(sample['lanes'], [])
        self.assertEqual(sample['firstFocusedContentMs'], 150)
        self.assertEqual(sample['peakChildSearches'], 2)
        self.assertEqual(sample['scopeCohortDigest'], 'a' * 64)

    def test_board_cache_filter_is_applied_before_the_query_limit(self):
        older = board_observation(800)
        older['cacheState'] = 'miss'
        newer = board_observation(700)
        newer['cacheState'] = 'hit'
        self.save(older, now=datetime(2026, 9, 8, 10, 0, tzinfo=timezone.utc))
        self.save(newer, now=datetime(2026, 9, 8, 10, 1, tzinfo=timezone.utc))
        report = performance.load_report(
            self.session, 'workspace-a', {'surface': 'eng_board', 'cacheState': 'miss'},
            limit=1, environment='local',
        )
        self.assertEqual(1, report['summary']['sampleCount'])
        self.assertEqual('miss', report['samples'][0]['cacheState'])
        unscoped = performance.load_report(
            self.session, 'workspace-a', {'cacheState': 'miss'}, limit=1, environment='local',
        )
        self.assertEqual(1, unscoped['summary']['sampleCount'])
        self.assertEqual('miss', unscoped['samples'][0]['cacheState'])

    def test_board_schema_rejects_incomplete_success_and_unbounded_diagnostics(self):
        for key, value in (
            ('sprintId', 'fabricated'), ('scopeCohortDigest', 'not-a-digest'),
            ('peakChildSearches', 3), ('cacheState', 'unknown'),
            ('focusedCompleteMs', 1001),
        ):
            payload = board_observation()
            payload[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                performance.validate_load(payload)
        payload = board_observation(outcome='cancelled')
        for key in ('indexMs', 'firstFocusedContentMs', 'focusedCompleteMs', 'dependencyDurationMs',
                    'epicCount', 'issueCount', 'payloadBytes', 'jiraRequests', 'jiraPages',
                    'jiraRetries', 'peakChildSearches', 'scopeCohortDigest'):
            payload[key] = None
        payload['completeness'] = 'partial'
        payload['cacheState'] = 'unknown'
        performance.validate_load(payload)

    def test_mixed_measurement_cohorts_do_not_produce_combined_percentiles(self):
        self.save(board_observation(800))
        changed = board_observation(1500)
        changed['scopeCohortDigest'] = 'b' * 64
        self.save(changed)
        summary = performance.load_report(self.session, 'workspace-a', {'surface': 'eng_board'})['summary']
        self.assertTrue(summary['mixedCohorts'])
        self.assertIsNone(summary['p50Ms'])
        self.assertIsNone(summary['p95Ms'])

    def test_candidate_eligibility_requires_known_complete_board_cohort(self):
        self.save(board_observation())
        cancelled = board_observation(outcome='cancelled')
        cancelled['completeness'] = 'partial'
        cancelled['cacheState'] = 'unknown'
        cancelled['scopeCohortDigest'] = None
        cancelled['peakChildSearches'] = None
        self.save(cancelled)
        summary = performance.load_report(
            self.session, 'workspace-a', {'surface': 'eng_board', 'scopeCohortDigest': 'a' * 64},
        )['summary']
        self.assertEqual(summary['eligibleCount'], 1)

    def test_migration_matches_model_and_downgrades(self):
        migration = importlib.import_module('backend.db.migrations.versions.20260908_0014_load_performance')
        board_migration = importlib.import_module(
            'backend.db.migrations.versions.20260908_0015_board_load_performance')
        engine = create_engine('sqlite://')
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                connection.execute(text("""
                    INSERT INTO load_performance
                        (workspace_id, load_id, group_id, sprint_id, surface, outcome, duration_ms,
                         dependency_duration_ms, first_content_ms, lanes, environment, revision, recorded_at)
                    VALUES
                        ('workspace-a', '00000000-0000-0000-0000-000000000001', 'group-a', 'sprint-a',
                         'eng_sprint', 'success', 100, NULL, 50, '[]', 'test', 'legacy',
                         '2026-09-08 10:00:00')
                """))
                board_migration.upgrade()
                inspector = inspect(connection)
                self.assertEqual({c['name'] for c in inspector.get_columns('load_performance')},
                                 set(performance.LoadPerformance.__table__.columns.keys()))
                self.assertEqual(inspector.get_foreign_keys('load_performance'), [])
                legacy = connection.execute(text("""
                    SELECT sprint_id, schema_version, scope_type, scope_cohort_digest
                    FROM load_performance WHERE revision = 'legacy'
                """)).one()
                self.assertEqual(('sprint-a', None, None, None), tuple(legacy))
                connection.execute(text("""
                    INSERT INTO load_performance
                        (workspace_id, load_id, group_id, sprint_id, surface, schema_version,
                         scope_type, outcome, duration_ms, lanes, environment, revision, recorded_at)
                    VALUES
                        ('workspace-a', '00000000-0000-0000-0000-000000000002', 'group-a', NULL,
                         'eng_board', 1, 'all_work', 'cancelled', 100, '[]', 'test', 'board',
                         '2026-09-08 10:01:00')
                """))
                board_migration.downgrade()
                remaining = connection.execute(text(
                    'SELECT revision, sprint_id FROM load_performance ORDER BY revision'
                )).all()
                self.assertEqual([('legacy', 'sprint-a')], [tuple(row) for row in remaining])
                board_migration.upgrade()
                self.assertEqual({c['name'] for c in inspect(connection).get_columns('load_performance')},
                                 set(performance.LoadPerformance.__table__.columns.keys()))
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
