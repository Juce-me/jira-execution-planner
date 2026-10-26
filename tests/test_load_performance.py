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

from backend.db.models import Base, LoadPerformance
from backend.services import load_performance as performance


def observation(duration=1000, completeness='complete', outcome='success'):
    return dict(loadId=str(uuid.uuid4()), groupId='department-a', sprintId='sprint-a',
                surface='eng_sprint', outcome=outcome, durationMs=duration,
                lanes=[dict(project=project, durationMs=duration, issueCount=10,
                            epicCount=2, storyCount=8, payloadBytes=2000,
                            cacheState='miss', completeness=completeness,
                            stages={'total': duration}, jiraRequests=None,
                            jiraPages=None, jiraRetries=None) for project in ('product', 'tech')])


def catch_up_load(product_ms, tech_ms, total_ms, *, cache='miss', group='department-a', outcome='success',
                  completeness='unknown', failed=(), first_content_ms=None):
    payload = observation(total_ms, completeness=completeness, outcome=outcome)
    payload['groupId'] = group
    if first_content_ms is not None:
        payload['firstContentMs'] = first_content_ms
    for lane, duration in zip(payload['lanes'], (product_ms, tech_ms)):
        lane.update(durationMs=duration, cacheState=cache)
        if lane['project'] in failed:   # a failed or aborted lane is recorded without a body
            lane.update(payloadBytes=0, issueCount=0, epicCount=0, storyCount=0)
    return payload


WEEK_KEYS = ['cacheHitShare', 'cancelled', 'capped', 'errors', 'fullyLoaded', 'listLoaded', 'listLoads', 'loads',
             'partial', 'weekStart']


def board_observation(duration=1000, scope_type='all_work', outcome='success'):
    return dict(schemaVersion=1, loadId=str(uuid.uuid4()), groupId='department-a',
                sprintId='sprint-a' if scope_type == 'sprint' else None, surface='eng_board',
                scopeType=scope_type, outcome=outcome, durationMs=duration, indexMs=100,
                firstFocusedContentMs=150, focusedCompleteMs=600, dependencyDurationMs=100,
                epicCount=12, issueCount=40, payloadBytes=5000, jiraRequests=4,
                jiraPages=4, jiraRetries=0, completeness='complete', cacheState='miss',
                peakChildSearches=2, scopeCohortDigest='a' * 64)


def phased_board(duration, index, first, focused, scope_type='component', **overrides):
    """A Board load whose phases are realistic: the focused column lands after the first byte."""
    payload = board_observation(duration, scope_type=scope_type)
    payload.update(indexMs=index, firstFocusedContentMs=first, focusedCompleteMs=focused,
                   dependencyDurationMs=None, **overrides)
    return payload


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

    def test_board_sample_splits_the_load_into_four_phases_that_add_up(self):
        self.save(phased_board(11210, 1800, 8780, 3520))
        sample = performance.load_report(self.session, 'workspace-a')['samples'][0]
        self.assertEqual({'waitMs': 5260, 'indexMs': 1800, 'focusedMs': 1720, 'restMs': 2430},
                         sample['phases'])
        self.assertEqual(11210, sum(sample['phases'].values()))

    def test_phases_are_absent_when_they_cannot_be_derived_honestly(self):
        # first focused content before the focused column completed would make the wait negative.
        self.save(board_observation(1000))
        self.save(phased_board(2000, 100, 900, 300, outcome='cancelled',
                               completeness='partial'))
        self.save(observation())
        samples = performance.load_report(self.session, 'workspace-a')['samples']
        self.assertEqual([None, None, None], [sample['phases'] for sample in samples])

    def test_weekly_stats_group_complete_board_loads_by_utc_monday(self):
        now = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)   # a Wednesday
        for days_ago, total, retries in ((9, 8000, 0), (8, 10000, 0), (7, 12000, 2),
                                         (2, 9000, 0), (1, 11000, 0)):
            payload = phased_board(total, 1000, total - 3000, 3000, jiraRetries=retries,
                                   jiraRequests=18, payloadBytes=600000)
            self.save(payload, now=now - timedelta(days=days_ago))
        weekly = performance.load_report(self.session, 'workspace-a', {'scopeType': 'component'},
                                         now=now)['weekly']
        self.assertEqual('component', weekly['scopeType'])
        self.assertFalse(weekly['mixedScopes'])
        first, second = weekly['weeks']
        self.assertEqual(('2026-10-12', 3), (first['weekStart'], first['loads']))
        self.assertEqual(('2026-10-19', 2), (second['weekStart'], second['loads']))
        self.assertEqual((10000, 2), (first['medianMs'], first['retries']))
        self.assertEqual(10000, second['medianMs'])   # median of 9000 and 11000
        self.assertEqual({'waitMs': 4000, 'indexMs': 1000, 'focusedMs': 2000, 'restMs': 3000},
                         first['phases'])
        self.assertEqual(18, first['medianJiraRequests'])
        self.assertEqual(600000, first['medianPayloadBytes'])
        self.assertFalse(first['partial'])
        self.assertTrue(second['partial'])   # the week still has days to run

    def test_weekly_stats_need_one_scope_and_ignore_loads_that_are_not_complete(self):
        now = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
        self.save(phased_board(10000, 1000, 7000, 3000), now=now - timedelta(hours=3))
        self.save(phased_board(10000, 1000, 7000, 3000, scope_type='all_work'),
                  now=now - timedelta(hours=2))
        mixed = performance.load_report(self.session, 'workspace-a', now=now)['weekly']
        self.assertTrue(mixed['mixedScopes'])
        self.assertEqual([], mixed['weeks'])
        self.assertIsNone(mixed['scopeType'])

        failed = phased_board(10000, 1000, 7000, 3000, outcome='error', completeness='partial')
        self.save(failed, now=now - timedelta(hours=1))
        cancelled = phased_board(10000, 1000, 7000, 3000, outcome='cancelled', completeness='partial')
        self.save(cancelled, now=now - timedelta(minutes=30))
        week = performance.load_report(self.session, 'workspace-a', {'scopeType': 'component'},
                                       now=now)['weekly']['weeks'][0]
        self.assertEqual((1, 1, 1), (week['loads'], week['errors'], week['cancelled']))

    def test_weekly_stats_are_empty_without_board_loads(self):
        self.save(observation())
        weekly = performance.load_report(self.session, 'workspace-a')['weekly']
        self.assertEqual({'scopeType': None, 'mixedScopes': False, 'weeks': []}, weekly)

    def test_board_scope_validation_matches_sprint_ownership(self):
        for scope_type in ('all_work', 'component'):
            with self.subTest(scope_type=scope_type):
                performance.validate_load(board_observation(scope_type=scope_type))
            for sprint_id in ('sprint-a', '', 0, False, True):
                payload = board_observation(scope_type=scope_type)
                payload['sprintId'] = sprint_id
                with self.subTest(scope_type=scope_type, sprint_id=sprint_id), \
                     self.assertRaises(ValueError):
                    performance.validate_load(payload)

        performance.validate_load(board_observation(scope_type='sprint'))
        for sprint_id in (None, '', 0, False, True):
            payload = board_observation(scope_type='sprint')
            payload['sprintId'] = sprint_id
            with self.subTest(scope_type='sprint', sprint_id=sprint_id), \
                 self.assertRaises(ValueError):
                performance.validate_load(payload)

        payload = board_observation()
        payload['scopeType'] = 'unknown'
        with self.assertRaises(ValueError):
            performance.validate_load(payload)

    def test_component_roundtrip_is_committed_and_isolated_by_scope_and_cohort(self):
        now = datetime.now(timezone.utc)
        component = board_observation(875, scope_type='component')
        component.update(indexMs=75, firstFocusedContentMs=125, focusedCompleteMs=550,
                         dependencyDurationMs=80, epicCount=7, issueCount=23,
                         payloadBytes=4321, jiraRequests=6, jiraPages=5, jiraRetries=1,
                         peakChildSearches=1, scopeCohortDigest='c' * 64)
        self.save(component, now=now - timedelta(minutes=3))
        self.save(board_observation(900, scope_type='all_work'),
                  now=now - timedelta(minutes=2))
        self.save(board_observation(925, scope_type='sprint'),
                  now=now - timedelta(minutes=1))
        other_cohort = board_observation(950, scope_type='component')
        other_cohort['scopeCohortDigest'] = 'd' * 64
        self.save(other_cohort, now=now)
        self.save(board_observation(975, scope_type='component'),
                  workspace='workspace-b', now=now)
        performance.record_load(
            self.session, 'workspace-a', board_observation(1000, scope_type='component'),
            environment='production', revision='abc123', now=now,
        )
        self.session.commit()
        self.session.close()

        with Session(self.engine) as reader:
            stored = reader.get(performance.LoadPerformance, ('workspace-a', component['loadId']))
            self.assertIsNone(stored.sprint_id)
            self.assertEqual(stored.scope_type, 'component')
            report = performance.load_report(
                reader, 'workspace-a',
                {'surface': 'eng_board', 'scopeType': 'component', 'cacheState': 'miss',
                 'scopeCohortDigest': 'c' * 64},
                environment='local',
            )

        self.assertEqual(report['summary']['sampleCount'], 1)
        self.assertEqual(report['summary']['eligibleCount'], 1)
        self.assertEqual(report['summary']['avgMs'], 875)
        self.assertEqual(report['filters']['scopeTypes'], ['all_work', 'component', 'sprint'])
        self.assertEqual(report['filters']['sprints'], ['sprint-a'])
        sample = report['samples'][0]
        self.assertEqual(sample['loadId'], component['loadId'])
        self.assertEqual(sample['surface'], 'eng_board')
        self.assertEqual(sample['scopeType'], 'component')
        self.assertIsNone(sample['sprintId'])
        self.assertEqual(sample['lanes'], [])
        self.assertEqual(sample['schemaVersion'], 1)
        self.assertEqual(sample['outcome'], 'success')
        self.assertEqual(sample['completeness'], 'complete')
        self.assertEqual(sample['cacheState'], 'miss')
        self.assertEqual(
            {key: sample[key] for key in (
                'durationMs', 'indexMs', 'firstFocusedContentMs', 'focusedCompleteMs',
                'dependencyDurationMs', 'epicCount', 'issueCount', 'payloadBytes',
                'jiraRequests', 'jiraPages', 'jiraRetries', 'peakChildSearches',
            )},
            {'durationMs': 875, 'indexMs': 75, 'firstFocusedContentMs': 125,
             'focusedCompleteMs': 550, 'dependencyDurationMs': 80, 'epicCount': 7,
             'issueCount': 23, 'payloadBytes': 4321, 'jiraRequests': 6,
             'jiraPages': 5, 'jiraRetries': 1, 'peakChildSearches': 1},
        )
        self.assertEqual(sample['scopeCohortDigest'], 'c' * 64)

    def test_component_scope_filter_is_applied_before_limit_with_or_without_surface(self):
        now = datetime.now(timezone.utc)
        component = board_observation(800, scope_type='component')
        self.save(component, now=now - timedelta(minutes=1))
        self.save(board_observation(700, scope_type='all_work'), now=now)

        for filters in ({'scopeType': 'component'},
                        {'surface': 'eng_board', 'scopeType': 'component'}):
            with self.subTest(filters=filters):
                report = performance.load_report(
                    self.session, 'workspace-a', filters, limit=1, environment='local',
                )
                self.assertEqual(report['summary']['sampleCount'], 1)
                self.assertEqual(report['samples'][0]['loadId'], component['loadId'])
                self.assertEqual(report['filters']['scopeTypes'], ['all_work', 'component'])
                self.assertEqual(report['filters']['sprints'], [])

        mixed = performance.load_report(
            self.session, 'workspace-a', {'surface': 'eng_board'}, environment='local',
        )['summary']
        self.assertTrue(mixed['mixedCohorts'])
        self.assertIsNone(mixed['p50Ms'])
        self.assertIsNone(mixed['p95Ms'])

    def test_board_cache_filter_is_applied_before_the_query_limit(self):
        older = board_observation(800)
        older['cacheState'] = 'miss'
        newer = board_observation(700)
        newer['cacheState'] = 'hit'
        now = datetime.now(timezone.utc)
        self.save(older, now=now - timedelta(minutes=1))
        self.save(newer, now=now)
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

    def test_peak_child_search_bound_matches_the_board_scheduler_limit(self):
        from backend.services.eng_board_stream import ENG_BOARD_MAX_CHILD_SEARCHES
        self.assertEqual(ENG_BOARD_MAX_CHILD_SEARCHES, performance.MAX_PEAK_CHILD_SEARCHES)

    def test_board_schema_accepts_the_four_child_search_peak(self):
        payload = board_observation()
        payload['peakChildSearches'] = 4
        self.assertEqual(4, performance.validate_load(payload)['peakChildSearches'])

    def test_board_schema_rejects_incomplete_success_and_unbounded_diagnostics(self):
        for key, value in (
            ('sprintId', 'fabricated'), ('scopeCohortDigest', 'not-a-digest'),
            ('peakChildSearches', 5), ('cacheState', 'unknown'),
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
        # Relative to now: the report only keeps RETENTION_DAYS of samples, so fixed dates age out.
        recorded = datetime.now(timezone.utc) - timedelta(days=2)
        self.save(board_observation(800), now=recorded)
        changed = board_observation(1500)
        changed['scopeCohortDigest'] = 'b' * 64
        self.save(changed, now=recorded + timedelta(days=1))
        report = performance.load_report(self.session, 'workspace-a', {'surface': 'eng_board'})
        summary = report['summary']
        self.assertTrue(summary['mixedCohorts'])
        self.assertIsNone(summary['p50Ms'])
        self.assertIsNone(summary['p95Ms'])
        self.assertEqual(len(report['trend']), 2)
        self.assertTrue(all(day['p50Ms'] is None for day in report['trend']))
        self.assertTrue(all(day['p50FirstContentMs'] is None for day in report['trend']))

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

    def test_board_candidate_summaries_exclude_unknown_rows_and_keep_first_content_separate(self):
        eligible = board_observation(1000)
        eligible['firstFocusedContentMs'] = 100
        eligible['dependencyDurationMs'] = 900
        self.save(eligible)
        contextual = board_observation(9000)
        contextual['firstFocusedContentMs'] = 8000
        self.save(contextual)
        stored = self.session.get(
            performance.LoadPerformance,
            ('workspace-a', contextual['loadId']),
        )
        stored.schema_version = None
        self.session.flush()

        report = performance.load_report(
            self.session, 'workspace-a',
            {'surface': 'eng_board', 'scopeType': 'all_work', 'cacheState': 'miss',
             'revision': 'abc123', 'scopeCohortDigest': 'a' * 64},
        )
        summary = report['summary']
        self.assertEqual(summary['sampleCount'], 2)
        self.assertEqual(summary['eligibleCount'], 1)
        self.assertEqual(summary['p50Ms'], 1000)
        self.assertEqual(summary['p50FirstContentMs'], 100)
        self.assertEqual(summary['p95FirstContentMs'], 100)
        eligible_sample = next(
            sample for sample in report['samples'] if sample['loadId'] == eligible['loadId']
        )
        self.assertEqual(eligible_sample['dependencyDurationMs'], 900)
        self.assertEqual(
            report['filters']['cacheStates'],
            ['miss'],
        )

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

    NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)   # a Wednesday

    def test_catch_up_weekly_plots_the_slower_lane_and_the_full_duration_per_utc_week(self):
        for days_ago, loads, extra in ((9, (1000, 3000, 9000), {'first_content_ms': 100}), (8, (2000, 2500, 7000), {}),
                                       (7, (4000, 1000, 11000), {}), (2, (1500, 500, 3000), {}), (1, (500, 2500, 5000), {})):
            self.save(catch_up_load(*loads, **extra), now=self.NOW - timedelta(days=days_ago))
        self.save(catch_up_load(60000, 60000, 60000), 'workspace-b', now=self.NOW - timedelta(days=1))
        report = performance.load_report(self.session, 'workspace-a', now=self.NOW)
        weeks = report['catchUpWeekly']['weeks']
        self.assertEqual(['2026-10-12', '2026-10-19'], [week['weekStart'] for week in weeks])
        first, second = weeks
        self.assertEqual(WEEK_KEYS, sorted(first))
        self.assertEqual((3, 3, False, 0, 0, 0, 0.0), (first['loads'], first['listLoads'], first['partial'], first['errors'],
                                                      first['cancelled'], first['capped'], first['cacheHitShare']))
        self.assertEqual({'avgMs': 3166.67, 'medianMs': 3000, 'p95Ms': 3900}, first['listLoaded'])
        self.assertEqual({'avgMs': 9000, 'medianMs': 9000, 'p95Ms': 10800}, first['fullyLoaded'])
        self.assertEqual((2, 2, True), (second['loads'], second['listLoads'], second['partial']))
        self.assertEqual({'avgMs': 2000, 'medianMs': 2000, 'p95Ms': 2450}, second['listLoaded'])
        self.assertEqual({'avgMs': 4000, 'medianMs': 4000, 'p95Ms': 4900}, second['fullyLoaded'])
        for week in weeks:
            for key in ('avgMs', 'medianMs', 'p95Ms'):
                self.assertLessEqual(week['listLoaded'][key], week['fullyLoaded'][key])

    def test_catch_up_weekly_blends_revisions_and_cache_states_that_blank_the_summary(self):
        for revision, cache, duration in (('rev-a', 'hit', 1000), ('rev-b', 'miss', 3000)):
            performance.record_load(self.session, 'workspace-a', catch_up_load(duration, duration, duration, cache=cache),
                                    environment='local', revision=revision, now=self.NOW - timedelta(hours=2))
        report = performance.load_report(self.session, 'workspace-a', now=self.NOW)
        self.assertTrue(report['summary']['mixedCohorts'])
        self.assertIsNone(report['summary']['p95Ms'])
        week, = report['catchUpWeekly']['weeks']
        self.assertEqual((2, 0.5), (week['loads'], week['cacheHitShare']))
        self.assertEqual({'avgMs': 2000, 'medianMs': 2000, 'p95Ms': 2900}, week['listLoaded'])
        self.assertEqual(week['listLoaded'], week['fullyLoaded'])

    def test_catch_up_list_loaded_survives_a_failed_dependency_tail_but_not_a_failed_lane(self):
        hours = iter(range(8, 0, -1))
        def at():
            return self.NOW - timedelta(hours=next(hours))
        self.save(catch_up_load(500, 600, 1000), now=at())                                        # success: list 600, full 1000
        self.save(catch_up_load(500, 600, 2000, completeness='capped'), now=at())                 # capped: counted only as capped
        self.save(catch_up_load(700, 900, 3000, outcome='error'), now=at())                       # dependency failed: list 900
        self.save(catch_up_load(500, 200, 3000, outcome='error', failed=('tech',)), now=at())     # tech lane failed: nothing
        self.save(catch_up_load(800, 400, 4000, outcome='cancelled'), now=at())                   # left during the tail: list 800
        self.save(catch_up_load(300, 100, 4000, outcome='cancelled', failed=('tech',)), now=at()) # aborted lane: nothing
        self.save(phased_board(10000, 1000, 7000, 3000), now=at())                                # Board ignored
        week, = performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly']['weeks']
        self.assertEqual((1, 3, 2, 2, 1), (week['loads'], week['listLoads'], week['errors'], week['cancelled'], week['capped']))
        self.assertEqual({'avgMs': 766.67, 'medianMs': 800, 'p95Ms': 890}, week['listLoaded'])
        self.assertEqual({'avgMs': 1000, 'medianMs': 1000, 'p95Ms': 1000}, week['fullyLoaded'])

    def test_catch_up_weekly_keeps_empty_weeks_and_ignores_malformed_lanes(self):
        self.save(phased_board(10000, 1000, 7000, 3000), now=self.NOW - timedelta(hours=1))
        self.assertEqual({'weeks': []}, performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly'])
        broken = [dict(project='product', durationMs=True, payloadBytes=10, completeness='unknown', cacheState='miss'),
                  dict(project='tech', durationMs='3000', payloadBytes=10, completeness='unknown', cacheState='miss')]
        for lanes in ([], broken):
            self.session.add(LoadPerformance(workspace_id='workspace-a', load_id=str(uuid.uuid4()), group_id='department-a',
                                             sprint_id='sprint-a', surface='eng_sprint', outcome='success', duration_ms=1000,
                                             lanes=lanes, environment='local', revision='abc123',
                                             recorded_at=self.NOW - timedelta(hours=1)))
        self.save(catch_up_load(500, 600, 3000, outcome='error', failed=('tech',)), now=self.NOW - timedelta(days=8))
        self.session.flush()
        outage, current = performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly']['weeks']
        self.assertEqual((0, 0, 1), (outage['loads'], outage['listLoads'], outage['errors']))
        self.assertEqual({'avgMs': None, 'medianMs': None, 'p95Ms': None}, outage['fullyLoaded'])
        self.assertEqual((2, 0, None), (current['loads'], current['listLoads'], current['cacheHitShare']))
        self.assertEqual({'avgMs': None, 'medianMs': None, 'p95Ms': None}, current['listLoaded'])
        self.assertEqual({'avgMs': 1000, 'medianMs': 1000, 'p95Ms': 1000}, current['fullyLoaded'])

    def test_catch_up_weekly_follows_the_report_filters_and_the_environment(self):
        self.save(catch_up_load(1000, 1000, 1000, cache='hit'), now=self.NOW - timedelta(hours=3))
        self.save(catch_up_load(3000, 3000, 3000, group='department-b'), now=self.NOW - timedelta(hours=2))
        performance.record_load(self.session, 'workspace-a', catch_up_load(9000, 9000, 9000), environment='production',
                                revision='abc123', now=self.NOW - timedelta(hours=1))
        def weeks(filters=None, environment='local'):
            return performance.load_report(self.session, 'workspace-a', filters, environment=environment,
                                           now=self.NOW)['catchUpWeekly']['weeks']
        self.assertEqual([2], [week['loads'] for week in weeks()])
        self.assertEqual([(1, 1000)], [(w['loads'], w['listLoaded']['avgMs']) for w in weeks({'cacheState': 'hit'})])
        self.assertEqual([(1, 3000)], [(w['loads'], w['listLoaded']['avgMs']) for w in weeks({'groupId': 'department-b'})])

    def test_catch_up_weekly_counts_every_scanned_row_not_only_the_returned_samples(self):
        for minute in range(205):
            self.save(catch_up_load(500, 600, 1000), now=self.NOW - timedelta(minutes=minute))
        report = performance.load_report(self.session, 'workspace-a', now=self.NOW)
        self.assertEqual(205, report['catchUpWeekly']['weeks'][0]['loads'])
        self.assertEqual(200, len(report['samples']))

    def test_catch_up_weekly_flags_the_oldest_week_after_a_truncated_scan(self):
        for day in (6, 13, 20):                                        # three weeks of ten loads each
            for index in range(10):
                self.save(catch_up_load(500, 600, 1000), now=self.NOW.replace(day=day) + timedelta(minutes=index))
        report = performance.load_report(self.session, 'workspace-a', now=self.NOW, limit=12)
        self.assertTrue(report['truncated'])
        oldest, newest = report['catchUpWeekly']['weeks']
        self.assertEqual(('2026-10-12', 2, True), (oldest['weekStart'], oldest['loads'], oldest['partial']))
        self.assertEqual(('2026-10-19', 10), (newest['weekStart'], newest['loads']))

    def test_catch_up_weekly_splits_at_utc_monday_midnight_in_any_database_zone(self):
        self.save(catch_up_load(500, 600, 1000), now=datetime(2026, 10, 18, 23, 59, 59, tzinfo=timezone.utc))
        self.save(catch_up_load(500, 600, 1000), now=datetime(2026, 10, 19, 0, 0, 0, tzinfo=timezone.utc))
        weeks = performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly']['weeks']
        self.assertEqual(['2026-10-12', '2026-10-19'], [week['weekStart'] for week in weeks])
        paris = timezone(timedelta(hours=2))                           # Monday 00:30 in Paris is Sunday 22:30 UTC
        moment = datetime(2026, 10, 19, 0, 30, tzinfo=paris)
        self.assertEqual('2026-10-12', performance._week_start(moment).isoformat())
        row = SimpleNamespace(surface='eng_sprint', outcome='success', duration_ms=1000, recorded_at=moment,
                              lanes=catch_up_load(500, 600, 1000)['lanes'])
        self.assertEqual(['2026-10-12'], [week['weekStart'] for week in performance._catch_up_weekly([row], self.NOW)['weeks']])

    def test_catch_up_weekly_marks_a_week_that_starts_before_the_retention_window(self):
        now = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)       # a Sunday: the window starts Sep 25, a Friday
        self.save(catch_up_load(500, 600, 1000), now=now - timedelta(days=31))
        self.save(catch_up_load(500, 600, 1000), now=now - timedelta(days=29))
        report = performance.load_report(self.session, 'workspace-a', now=now)
        week = report['catchUpWeekly']['weeks'][0]
        self.assertEqual(('2026-09-21', 1, True), (week['weekStart'], week['loads'], week['partial']))
        self.assertEqual(30, report['retentionDays'])

    def test_catch_up_weekly_marks_the_week_the_retention_window_starts_in(self):
        # NOW is a Wednesday, so the window starts Monday Sep 21 at 12:00 and that week has lost its morning
        self.save(catch_up_load(500, 600, 1000), now=datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc))
        self.save(catch_up_load(500, 600, 1000), now=datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc))
        oldest, following = performance.load_report(self.session, 'workspace-a', now=self.NOW)['catchUpWeekly']['weeks']
        self.assertEqual(('2026-09-21', True), (oldest['weekStart'], oldest['partial']))
        self.assertEqual(('2026-09-28', False), (following['weekStart'], following['partial']))


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
            self.assertNotIn('catchUpWeekly', response.get_json())

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
            self.assertIn('catchUpWeekly', response.get_json())
            with patch.object(self.server, 'current_request_auth_context', return_value=replace(context, workspace_id='other-workspace')):
                other = self.client.get('/api/admin/performance').get_json()
                self.assertEqual(other['summary']['sampleCount'], 0)
                self.assertEqual({'weeks': []}, other['catchUpWeekly'])
            payload['workspaceId'] = 'other-workspace'
            self.assertEqual(self.client.post('/api/performance/loads', json=payload).status_code, 400)
            self.assertEqual(self.client.post('/api/performance/loads', data='x' * 16385).status_code, 413)
            with patch.dict('os.environ', {'APP_PERFORMANCE_DEBUG': 'false'}):
                self.assertEqual(self.client.post('/api/performance/loads', json=observation()).status_code, 404)

    def test_oauth_component_ingestion_and_admin_report_use_real_storage(self):
        from tests.oauth_test_helpers import install_oauth_session
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
        with patch.object(self.server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.dict('os.environ', {
                 'APP_ENVIRONMENT_KEY': 'local', 'APP_PERFORMANCE_DEBUG': 'true',
                 'DATABASE_URL': 'sqlite://',
             }), \
             patch.object(self.server, 'current_request_auth_context', return_value=context), \
             patch('backend.routes.performance_routes.session_scope', database_session):
            install_oauth_session(self.client, account_id='synthetic-account')

            def csrf_headers():
                csrf_response = self.client.get('/api/auth/csrf')
                self.assertEqual(
                    csrf_response.status_code, 200, csrf_response.get_data(as_text=True),
                )
                return {
                    'X-Requested-With': 'jira-execution-planner',
                    'X-CSRF-Token': csrf_response.get_json()['csrfToken'],
                }

            payload = board_observation(825, scope_type='component')

            created = self.client.post(
                '/api/performance/loads', json=payload, headers=csrf_headers(),
            )
            self.assertEqual(created.status_code, 201, created.get_data(as_text=True))
            self.assertEqual(created.get_json(), {'recorded': True})
            duplicate = self.client.post(
                '/api/performance/loads', json=payload, headers=csrf_headers(),
            )
            self.assertEqual(duplicate.status_code, 200, duplicate.get_data(as_text=True))
            self.assertEqual(duplicate.get_json(), {'recorded': False})

            for scope_type in ('all_work', 'component'):
                invalid = board_observation(scope_type=scope_type)
                invalid['sprintId'] = 'sprint-a'
                rejected = self.client.post(
                    '/api/performance/loads', json=invalid, headers=csrf_headers(),
                )
                with self.subTest(scope_type=scope_type):
                    self.assertEqual(rejected.status_code, 400, rejected.get_data(as_text=True))
                    self.assertEqual(rejected.get_json(), {'error': 'invalid_measurement'})

            response = self.client.get(
                '/api/admin/performance',
                query_string={'surface': 'eng_board', 'scopeType': 'component'},
            )
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            report = response.get_json()
            self.assertEqual(report['summary']['sampleCount'], 1)
            self.assertEqual(len(report['samples']), 1)
            self.assertEqual(report['filters']['scopeTypes'], ['component'])
            self.assertEqual(report['filters']['sprints'], [])
            self.assertEqual(report['samples'][0]['loadId'], payload['loadId'])
            self.assertEqual(report['samples'][0]['scopeType'], 'component')
            self.assertIsNone(report['samples'][0]['sprintId'])
