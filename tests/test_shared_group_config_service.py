import os
import tempfile
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import get_type_hints
from unittest.mock import patch

from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.db import engine as db_engine
from backend.db import models
from backend.services import shared_group_config as service
import jira_server


def validate_groups_config(payload, allow_empty=False):
    return jira_server.validate_groups_config(payload, allow_empty=allow_empty)


class SharedGroupConfigServiceTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'shared-groups.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.other_user_id = self._seed_subjects()
        self.context = self._context(self.user_id)
        self.other_context = self._context(self.other_user_id)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_subjects(self):
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject='account-1',
                account_type='user',
                status='active',
                created_by='test',
            )
            other_user = models.User(
                external_provider='atlassian',
                external_subject='account-2',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, user, other_user])
            session.commit()
            return workspace.id, user.id, other_user.id

    def _context(self, user_id):
        return SimpleNamespace(
            workspace_id=self.workspace_id,
            user_id=user_id,
            auth_connection_id=f'connection-{user_id}',
        )

    def _groups(self):
        return {
            'version': 1,
            'groups': [
                {'id': 'default', 'name': 'Default', 'teamIds': ['team-default']},
                {'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']},
            ],
            'defaultGroupId': 'default',
        }

    def _db_groups(self):
        return {
            'version': 1,
            'source': service.GROUPS_SOURCE_DB,
            'groups': [
                {'id': 'default', 'name': 'Default', 'teamIds': ['team-default']},
                {'id': 'platform', 'name': 'Platform', 'teamIds': ['team-platform']},
                {'id': 'mobile', 'name': 'Mobile', 'teamIds': ['team-mobile']},
                {'id': 'empty', 'name': 'Empty', 'teamIds': []},
            ],
            'defaultGroupId': 'default',
        }

    def test_load_imports_legacy_json_once_for_workspace(self):
        legacy = {
            'version': 1,
            'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
            'defaultGroupId': 'platform',
        }

        result = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: {'teamGroups': legacy},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )
        second = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: {'teamGroups': {'version': 1, 'groups': [], 'defaultGroupId': ''}},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        self.assertEqual(result['groups'][0]['id'], 'platform')
        self.assertEqual(result['configRevision'], 1)
        self.assertEqual(result['source'], 'workspace_db')
        self.assertEqual(second['groups'][0]['id'], 'platform')

    def test_existing_legacy_row_without_ad_hoc_field_normalizes_to_empty(self):
        with self.factory() as session:
            session.add(models.WorkspaceGroupConfig(
                workspace_id=self.workspace_id,
                payload_version=1,
                payload={
                    'version': 1,
                    'groups': [{
                        'id': 'platform',
                        'name': 'Platform',
                        'teamIds': ['team-a'],
                        'excludedCapacityEpics': ['ENG-1'],
                    }],
                    'defaultGroupId': 'platform',
                    'configRevision': 1,
                },
                config_revision=1,
                created_by=self.user_id,
                updated_by=self.user_id,
            ))
            session.commit()

        loaded = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: None,
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        self.assertEqual(loaded['groups'][0]['id'], 'platform')
        self.assertEqual(loaded['groups'][0]['adHocCapacityEpics'], [])
        self.assertEqual(loaded['groups'][0]['excludedCapacityEpics'], ['ENG-1'])

    def test_save_rejects_stale_base_revision(self):
        loaded = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: {'teamGroups': self._groups()},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )
        first = service.save_shared_groups(
            self.context,
            self._groups(),
            base_revision=loaded['configRevision'],
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        with self.assertRaises(service.GroupConfigConflict) as raised:
            service.save_shared_groups(
                self.other_context,
                {
                    'version': 1,
                    'groups': [{'id': 'mobile', 'name': 'Mobile', 'teamIds': ['team-m']}],
                    'defaultGroupId': 'mobile',
                },
                base_revision=loaded['configRevision'],
                validate_groups_config_fn=validate_groups_config,
                database_url=self.database_url,
            )

        self.assertEqual(raised.exception.current['configRevision'], first['configRevision'])

    def test_preferences_filter_unknown_groups_and_keep_default_visible(self):
        preferences = service.normalize_group_preferences(
            {'visibleGroupIds': ['platform', 'missing'], 'activeGroupId': 'missing', 'customized': True},
            self._groups(),
        )

        self.assertEqual(preferences['visibleGroupIds'], ['platform'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], ['default', 'platform'])
        self.assertEqual(preferences['activeGroupId'], 'default')

    def test_completed_onboarding_modules_normalize_in_canonical_order(self):
        self.assertEqual(
            service.normalize_completed_onboarding_modules([
                'planning',
                'catch-up',
                'planning',
                'unknown',
                7,
                None,
            ]),
            ['catch-up', 'planning'],
        )
        self.assertFalse(service.all_onboarding_modules_complete(['catch-up', 'planning']))
        self.assertTrue(service.all_onboarding_modules_complete([
            'catch-up',
            'configuration',
            'planning',
            'board',
            'statistics',
        ]))

    def test_missing_db_preferences_require_first_run_selection(self):
        preferences = service.normalize_group_preferences(
            {},
            self._groups(),
            preference_exists=False,
            require_first_run=True,
        )

        self.assertFalse(preferences['customized'])
        self.assertFalse(preferences['preferenceExists'])
        self.assertTrue(preferences['onboardingRequired'])
        self.assertEqual(preferences['visibleGroupIds'], [])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], [])

    def test_missing_db_preferences_require_first_run_even_before_groups_exist(self):
        preferences = service.normalize_group_preferences(
            {},
            {'version': 1, 'groups': [], 'defaultGroupId': ''},
            preference_exists=False,
            require_first_run=True,
        )

        self.assertTrue(preferences['onboardingRequired'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], [])

    def test_existing_preferences_reopen_onboarding_when_visible_groups_are_deleted(self):
        preferences = service.normalize_group_preferences(
            {'visibleGroupIds': ['deleted'], 'activeGroupId': 'deleted', 'customized': True},
            self._groups(),
            preference_exists=True,
            require_first_run=False,
        )

        self.assertTrue(preferences['onboardingRequired'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], [])
        self.assertIsNone(preferences['activeGroupId'])

    def test_missing_json_preferences_keep_browser_local_all_visible(self):
        preferences = service.normalize_group_preferences(
            {},
            self._groups(),
            preference_exists=False,
            require_first_run=False,
        )

        self.assertFalse(preferences['customized'])
        self.assertFalse(preferences['onboardingRequired'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], ['default', 'platform'])
        self.assertEqual(
            preferences['completedOnboardingModules'],
            list(service.ONBOARDING_MODULE_IDS),
        )
        self.assertTrue(preferences['onboardingDone'])

    def test_workspace_preferences_do_not_force_the_shared_default_visible(self):
        saved = service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )

        self.assertEqual(saved['visibleGroupIds'], ['platform'])
        self.assertEqual(saved['effectiveVisibleGroupIds'], ['platform'])
        self.assertEqual(saved['activeGroupId'], 'platform')
        self.assertFalse(saved['onboardingRequired'])
        self.assertEqual(saved['completedOnboardingModules'], [])
        self.assertFalse(saved['onboardingDone'])
        with self.factory() as session:
            stored = session.query(models.UserGroupPreference).one()
        self.assertEqual(stored.onboarding_completed_modules, [])
        self.assertFalse(stored.onboarding_done)

    def test_workspace_preferences_are_isolated_by_user_and_workspace(self):
        first = service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        second = service.save_group_preferences(
            self.other_context,
            {'visibleGroupIds': ['mobile'], 'activeGroupId': 'mobile'},
            self._db_groups(),
            database_url=self.database_url,
        )
        with self.factory() as session:
            other_workspace = models.Workspace(
                environment_key='other',
                name='Other',
                jira_site_url='https://other.example.atlassian.net',
                jira_cloud_id='cloud-2',
                created_by='test',
            )
            session.add(other_workspace)
            session.commit()
            other_workspace_context = SimpleNamespace(
                workspace_id=other_workspace.id,
                user_id=self.user_id,
                auth_connection_id='connection-other-workspace',
            )

        isolated = service.load_group_preferences(
            other_workspace_context,
            self._db_groups(),
            database_url=self.database_url,
        )

        self.assertEqual(first['activeGroupId'], 'platform')
        self.assertEqual(second['activeGroupId'], 'mobile')
        self.assertTrue(isolated['onboardingRequired'])
        self.assertIsNone(isolated['activeGroupId'])

    def test_existing_workspace_preference_allows_multiple_visible_groups_with_one_favorite(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )

        saved = service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform', 'mobile'], 'activeGroupId': 'mobile'},
            self._db_groups(),
            database_url=self.database_url,
        )

        self.assertEqual(saved['visibleGroupIds'], ['platform', 'mobile'])
        self.assertEqual(saved['effectiveVisibleGroupIds'], ['platform', 'mobile'])
        self.assertEqual(saved['activeGroupId'], 'mobile')

    def test_raw_workspace_preference_validation_rejects_invalid_first_and_existing_favorites(self):
        invalid_first_payloads = (
            {'visibleGroupIds': [], 'activeGroupId': None},
            {'visibleGroupIds': ['platform', 'mobile'], 'activeGroupId': 'platform'},
            {'visibleGroupIds': ['platform'], 'activeGroupId': None},
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'mobile'},
            {'visibleGroupIds': ['platform', 'platform'], 'activeGroupId': 'platform'},
            {'visibleGroupIds': ['unknown'], 'activeGroupId': 'unknown'},
            {'visibleGroupIds': ['empty'], 'activeGroupId': 'empty'},
            {'visibleGroupIds': 'platform', 'activeGroupId': 'platform'},
            {'visibleGroupIds': ['platform'], 'activeGroupId': 7},
        )
        for payload in invalid_first_payloads:
            with self.subTest(payload=payload), self.assertRaises(service.InvalidGroupPreferences):
                service.save_group_preferences(
                    self.context,
                    payload,
                    self._db_groups(),
                    database_url=self.database_url,
                )

        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        for payload in (
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'mobile'},
            {'visibleGroupIds': ['platform', 'empty'], 'activeGroupId': 'empty'},
        ):
            with self.subTest(existing_payload=payload), self.assertRaises(service.InvalidGroupPreferences):
                service.save_group_preferences(
                    self.context,
                    payload,
                    self._db_groups(),
                    database_url=self.database_url,
                )

    def test_invalid_stored_workspace_favorite_reopens_onboarding_without_rewriting(self):
        invalid_cases = (
            (['platform'], 'deleted', self._db_groups()),
            (['mobile'], 'platform', self._db_groups()),
            (['empty'], 'empty', self._db_groups()),
            (['platform'], 'platform', {
                **self._db_groups(),
                'groups': [group for group in self._db_groups()['groups'] if group['id'] != 'platform'],
            }),
        )
        for visible_ids, favorite_id, groups_config in invalid_cases:
            with self.subTest(visible_ids=visible_ids, favorite_id=favorite_id):
                with self.factory() as session:
                    session.query(models.UserGroupPreference).delete()
                    session.add(models.UserGroupPreference(
                        workspace_id=self.workspace_id,
                        user_id=self.user_id,
                        payload_version=1,
                        visible_group_ids=visible_ids,
                        active_group_id=favorite_id,
                        customized=True,
                    ))
                    session.commit()

                loaded = service.load_group_preferences(
                    self.context,
                    groups_config,
                    database_url=self.database_url,
                )
                self.assertTrue(loaded['onboardingRequired'])
                self.assertIsNone(loaded['activeGroupId'])
                self.assertEqual(loaded['effectiveVisibleGroupIds'], [])
                with self.factory() as session:
                    stored = session.query(models.UserGroupPreference).one()
                    self.assertEqual(stored.visible_group_ids, visible_ids)
                    self.assertEqual(stored.active_group_id, favorite_id)

    def test_concurrent_first_insert_recovers_and_applies_the_final_request(self):
        original_flush = Session.flush
        injected = False

        def flush_with_competing_insert(session, *args, **kwargs):
            nonlocal injected
            pending_preference = next(
                (row for row in session.new if isinstance(row, models.UserGroupPreference)),
                None,
            )
            if pending_preference is not None and not injected:
                injected = True
                with self.engine.begin() as connection:
                    connection.execute(models.UserGroupPreference.__table__.insert().values(
                        workspace_id=self.workspace_id,
                        user_id=self.user_id,
                        payload_version=1,
                        visible_group_ids=['mobile'],
                        active_group_id='mobile',
                        customized=True,
                        onboarding_done=True,
                        onboarding_completed_modules=list(service.ONBOARDING_MODULE_IDS),
                    ))
            return original_flush(session, *args, **kwargs)

        with patch.object(Session, 'flush', flush_with_competing_insert):
            saved = service.save_group_preferences(
                self.context,
                {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                self._db_groups(),
                database_url=self.database_url,
            )

        self.assertTrue(injected)
        self.assertEqual(saved['activeGroupId'], 'platform')
        self.assertTrue(saved['onboardingDone'])
        self.assertEqual(
            saved['completedOnboardingModules'],
            list(service.ONBOARDING_MODULE_IDS),
        )
        with self.factory() as session:
            stored = session.query(models.UserGroupPreference).one()
            self.assertEqual(stored.visible_group_ids, ['platform'])
            self.assertEqual(stored.active_group_id, 'platform')
            self.assertTrue(stored.onboarding_done)

    def test_group_preferences_serialize_stored_onboarding_values_and_missing_rows(self):
        missing = service.load_group_preferences(
            self.context,
            self._db_groups(),
            database_url=self.database_url,
        )
        self.assertEqual(missing['completedOnboardingModules'], [])
        self.assertFalse(missing['onboardingDone'])

        cases = (
            ([], False),
            (list(service.ONBOARDING_MODULE_IDS), True),
        )
        for completed_modules, done in cases:
            with self.subTest(completed_modules=completed_modules):
                with self.factory() as session:
                    session.query(models.UserGroupPreference).delete()
                    session.add(models.UserGroupPreference(
                        workspace_id=self.workspace_id,
                        user_id=self.user_id,
                        payload_version=1,
                        visible_group_ids=['platform'],
                        active_group_id='platform',
                        customized=True,
                        onboarding_done=done,
                        onboarding_completed_modules=completed_modules,
                    ))
                    session.commit()

                loaded = service.load_group_preferences(
                    self.context,
                    self._db_groups(),
                    database_url=self.database_url,
                )
                self.assertEqual(loaded['completedOnboardingModules'], completed_modules)
                self.assertIs(loaded['onboardingDone'], done)
                saved = service.save_group_preferences(
                    self.context,
                    {'visibleGroupIds': ['mobile'], 'activeGroupId': 'mobile'},
                    self._db_groups(),
                    database_url=self.database_url,
                )
                self.assertEqual(saved['completedOnboardingModules'], completed_modules)
                self.assertIs(saved['onboardingDone'], done)
                with self.factory() as session:
                    stored = session.query(models.UserGroupPreference).one()
                    self.assertEqual(stored.onboarding_completed_modules, completed_modules)
                    self.assertIs(stored.onboarding_done, done)

    def test_group_preference_responses_derive_done_from_canonical_modules(self):
        with self.factory() as session:
            session.add(models.UserGroupPreference(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                payload_version=1,
                visible_group_ids=['platform'],
                active_group_id='platform',
                customized=True,
                onboarding_done=True,
                onboarding_completed_modules=['planning', 'catch-up', 'planning', 'unknown'],
            ))
            session.commit()

        loaded = service.load_group_preferences(
            self.context,
            self._db_groups(),
            database_url=self.database_url,
        )
        saved = service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['mobile'], 'activeGroupId': 'mobile'},
            self._db_groups(),
            database_url=self.database_url,
        )

        expected_modules = ['catch-up', 'planning']
        self.assertEqual(loaded['completedOnboardingModules'], expected_modules)
        self.assertFalse(loaded['onboardingDone'])
        self.assertEqual(saved['completedOnboardingModules'], expected_modules)
        self.assertFalse(saved['onboardingDone'])
        with self.factory() as session:
            stored = session.query(models.UserGroupPreference).one()
        self.assertEqual(
            stored.onboarding_completed_modules,
            ['planning', 'catch-up', 'planning', 'unknown'],
        )

    def test_complete_onboarding_module_is_idempotent_and_isolated(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        service.save_group_preferences(
            self.other_context,
            {'visibleGroupIds': ['mobile'], 'activeGroupId': 'mobile'},
            self._db_groups(),
            database_url=self.database_url,
        )
        with self.factory() as session:
            other_workspace = models.Workspace(
                environment_key='module-other',
                name='Module Other',
                jira_site_url='https://module-other.example.atlassian.net',
                jira_cloud_id='cloud-module-other',
                created_by='test',
            )
            session.add(other_workspace)
            session.commit()
            other_workspace_context = SimpleNamespace(
                workspace_id=other_workspace.id,
                user_id=self.user_id,
                auth_connection_id='connection-module-other',
            )
            session.add(models.UserGroupPreference(
                workspace_id=other_workspace.id,
                user_id=self.user_id,
                payload_version=1,
                visible_group_ids=['mobile'],
                active_group_id='mobile',
                customized=True,
            ))
            session.commit()

        expected = {
            'completedOnboardingModules': ['planning'],
            'onboardingDone': False,
        }
        self.assertEqual(
            service.complete_onboarding_module(
                self.context,
                'planning',
                database_url=self.database_url,
            ),
            expected,
        )
        self.assertEqual(
            service.complete_onboarding_module(
                self.context,
                'planning',
                database_url=self.database_url,
            ),
            expected,
        )

        with self.factory() as session:
            rows = {
                (row.workspace_id, row.user_id): row
                for row in session.query(models.UserGroupPreference).all()
            }
        current = rows[(self.workspace_id, self.user_id)]
        other_user = rows[(self.workspace_id, self.other_user_id)]
        other_workspace = rows[(other_workspace_context.workspace_id, self.user_id)]
        self.assertEqual(current.onboarding_completed_modules, ['planning'])
        self.assertFalse(current.onboarding_done)
        self.assertEqual(other_user.onboarding_completed_modules, [])
        self.assertFalse(other_user.onboarding_done)
        self.assertEqual(other_workspace.onboarding_completed_modules, [])
        self.assertFalse(other_workspace.onboarding_done)

    def test_complete_onboarding_modules_incrementally_finishes_legacy_state_and_updates_timestamp(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        old_timestamp = datetime(2000, 1, 1, tzinfo=timezone.utc)
        with self.factory() as session:
            row = session.query(models.UserGroupPreference).one()
            row.updated_at = old_timestamp
            session.commit()

        for index, module_id in enumerate(service.ONBOARDING_MODULE_IDS):
            saved = service.complete_onboarding_module(
                self.context,
                module_id,
                database_url=self.database_url,
            )
            self.assertEqual(
                saved['completedOnboardingModules'],
                list(service.ONBOARDING_MODULE_IDS[:index + 1]),
            )
            self.assertIs(
                saved['onboardingDone'],
                index == len(service.ONBOARDING_MODULE_IDS) - 1,
            )

        with self.factory() as session:
            stored = session.query(models.UserGroupPreference).one()
        stored_timestamp = stored.updated_at
        if stored_timestamp.tzinfo is None:
            stored_timestamp = stored_timestamp.replace(tzinfo=timezone.utc)
        self.assertEqual(
            stored.onboarding_completed_modules,
            list(service.ONBOARDING_MODULE_IDS),
        )
        self.assertTrue(stored.onboarding_done)
        self.assertGreater(stored_timestamp, old_timestamp)

    def test_onboarding_mutations_execute_scoped_postgresql_row_lock_queries(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        original_execute = Session.execute
        mutation_statements = []

        def capture_execute(session, statement, *args, **kwargs):
            mutation_statements.append(statement)
            return original_execute(session, statement, *args, **kwargs)

        with patch.object(Session, 'execute', capture_execute):
            service.complete_onboarding_module(
                self.context,
                'planning',
                database_url=self.database_url,
            )
            service.set_onboarding_done(
                self.context,
                False,
                database_url=self.database_url,
            )

        self.assertEqual(len(mutation_statements), 2)
        self.assertEqual(
            [statement._for_update_arg is not None for statement in mutation_statements],
            [True, True],
        )
        for statement in mutation_statements:
            sql = str(statement.compile(dialect=postgresql.dialect()))
            self.assertIn('user_group_preferences.workspace_id =', sql)
            self.assertIn('user_group_preferences.user_id =', sql)
            self.assertIn('FOR UPDATE', sql)

    def test_complete_onboarding_module_rejects_unknown_module(self):
        with self.assertRaises(service.InvalidOnboardingModule):
            service.complete_onboarding_module(
                self.context,
                'unknown',
                database_url=self.database_url,
            )

    def test_set_onboarding_done_fills_or_clears_modules_idempotently_and_in_isolation(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        service.save_group_preferences(
            self.other_context,
            {'visibleGroupIds': ['mobile'], 'activeGroupId': 'mobile'},
            self._db_groups(),
            database_url=self.database_url,
        )
        with self.factory() as session:
            other_workspace = models.Workspace(
                environment_key='onboarding-other',
                name='Onboarding Other',
                jira_site_url='https://onboarding-other.example.atlassian.net',
                jira_cloud_id='cloud-onboarding-other',
                created_by='test',
            )
            session.add(other_workspace)
            session.commit()
            other_workspace_context = SimpleNamespace(
                workspace_id=other_workspace.id,
                user_id=self.user_id,
                auth_connection_id='connection-onboarding-other',
            )
            session.add(models.UserGroupPreference(
                workspace_id=other_workspace.id,
                user_id=self.user_id,
                payload_version=1,
                visible_group_ids=['mobile'],
                active_group_id='mobile',
                customized=True,
                onboarding_done=False,
            ))
            session.commit()

        empty = {
            'completedOnboardingModules': [],
            'onboardingDone': False,
        }
        complete = {
            'completedOnboardingModules': list(service.ONBOARDING_MODULE_IDS),
            'onboardingDone': True,
        }
        self.assertEqual(service.set_onboarding_done(
            self.context, False, database_url=self.database_url,
        ), empty)
        self.assertEqual(service.set_onboarding_done(
            self.context, True, database_url=self.database_url,
        ), complete)
        self.assertEqual(service.set_onboarding_done(
            self.context, True, database_url=self.database_url,
        ), complete)
        self.assertEqual(service.set_onboarding_done(
            self.context, False, database_url=self.database_url,
        ), empty)

        with self.factory() as session:
            rows = {
                (row.workspace_id, row.user_id): row
                for row in session.query(models.UserGroupPreference).all()
            }
        current = rows[(self.workspace_id, self.user_id)]
        other_user = rows[(self.workspace_id, self.other_user_id)]
        other_workspace = rows[(other_workspace_context.workspace_id, self.user_id)]
        self.assertFalse(current.onboarding_done)
        self.assertEqual(current.onboarding_completed_modules, [])
        self.assertEqual(current.visible_group_ids, ['platform'])
        self.assertEqual(current.active_group_id, 'platform')
        self.assertFalse(other_user.onboarding_done)
        self.assertEqual(other_user.onboarding_completed_modules, [])
        self.assertEqual(other_user.visible_group_ids, ['mobile'])
        self.assertFalse(other_workspace.onboarding_done)
        self.assertEqual(other_workspace.onboarding_completed_modules, [])
        self.assertEqual(other_workspace.visible_group_ids, ['mobile'])

    def test_set_onboarding_done_rejects_missing_preference_with_dedicated_error(self):
        with self.assertRaises(service.GroupSelectionRequired):
            service.set_onboarding_done(
                self.context, True, database_url=self.database_url,
            )

    def test_set_onboarding_done_declares_boolean_input_and_dict_output(self):
        type_hints = get_type_hints(service.set_onboarding_done)

        self.assertIs(type_hints['done'], bool)
        self.assertIs(type_hints['return'], dict)

    def test_set_onboarding_done_translates_query_storage_failure_with_cause(self):
        original_session_scope = service.db_engine.session_scope

        @contextmanager
        def failing_session_scope(database_url=None):
            with original_session_scope(database_url) as session:
                with patch.object(
                    session,
                    'execute',
                    side_effect=SQLAlchemyError('sensitive query detail'),
                ):
                    yield session

        with patch.object(service.db_engine, 'session_scope', failing_session_scope), \
             self.assertRaises(service.OnboardingStorageUnavailable) as raised:
            service.set_onboarding_done(
                self.context, True, database_url=self.database_url,
            )

        self.assertEqual(str(raised.exception), 'onboarding_storage_unavailable')
        self.assertIsInstance(raised.exception.__cause__, SQLAlchemyError)
        self.assertEqual(str(raised.exception.__cause__), 'sensitive query detail')

    def test_set_onboarding_done_translates_flush_storage_failure_with_cause(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        original_session_scope = service.db_engine.session_scope

        @contextmanager
        def failing_session_scope(database_url=None):
            with original_session_scope(database_url) as session:
                with patch.object(
                    session,
                    'flush',
                    side_effect=SQLAlchemyError('sensitive flush detail'),
                ):
                    yield session

        with patch.object(service.db_engine, 'session_scope', failing_session_scope), \
             self.assertRaises(service.OnboardingStorageUnavailable) as raised:
            service.set_onboarding_done(
                self.context, True, database_url=self.database_url,
            )

        self.assertEqual(str(raised.exception), 'onboarding_storage_unavailable')
        self.assertIsInstance(raised.exception.__cause__, SQLAlchemyError)
        self.assertEqual(str(raised.exception.__cause__), 'sensitive flush detail')
        with self.factory() as session:
            self.assertFalse(session.query(models.UserGroupPreference).one().onboarding_done)

    def test_set_onboarding_done_translates_commit_storage_failure_with_cause(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )
        original_session_scope = service.db_engine.session_scope

        @contextmanager
        def failing_session_scope(database_url=None):
            with patch.object(
                Session,
                'commit',
                side_effect=SQLAlchemyError('sensitive commit detail'),
            ):
                with original_session_scope(database_url) as session:
                    yield session

        with patch.object(service.db_engine, 'session_scope', failing_session_scope), \
             self.assertRaises(service.OnboardingStorageUnavailable) as raised:
            service.set_onboarding_done(
                self.context, True, database_url=self.database_url,
            )

        self.assertEqual(str(raised.exception), 'onboarding_storage_unavailable')
        self.assertIsInstance(raised.exception.__cause__, SQLAlchemyError)
        self.assertEqual(str(raised.exception.__cause__), 'sensitive commit detail')
        with self.factory() as session:
            self.assertFalse(session.query(models.UserGroupPreference).one().onboarding_done)

    def test_set_onboarding_done_does_not_revalidate_or_mutate_group_fields(self):
        with self.factory() as session:
            session.add(models.UserGroupPreference(
                workspace_id=self.workspace_id,
                user_id=self.user_id,
                payload_version=7,
                visible_group_ids=['deleted'],
                active_group_id='not-visible',
                customized=False,
                onboarding_done=False,
            ))
            session.commit()

        self.assertEqual(service.set_onboarding_done(
            self.context, True, database_url=self.database_url,
        ), {
            'completedOnboardingModules': list(service.ONBOARDING_MODULE_IDS),
            'onboardingDone': True,
        })

        with self.factory() as session:
            stored = session.query(models.UserGroupPreference).one()
        self.assertEqual(stored.payload_version, 7)
        self.assertEqual(stored.visible_group_ids, ['deleted'])
        self.assertEqual(stored.active_group_id, 'not-visible')
        self.assertFalse(stored.customized)
        self.assertTrue(stored.onboarding_done)
        self.assertEqual(
            stored.onboarding_completed_modules,
            list(service.ONBOARDING_MODULE_IDS),
        )

    def test_set_onboarding_done_rejects_non_db_auth_context(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )

        with self.assertRaises(service.OnboardingPreferencesUnavailable):
            service.set_onboarding_done(
                SimpleNamespace(
                    workspace_id=self.workspace_id,
                    user_id=self.user_id,
                    auth_connection_id='local-session',
                ),
                True,
                database_url=self.database_url,
            )


if __name__ == '__main__':
    unittest.main()
