import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

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
        self.assertFalse(missing['onboardingDone'])

        for done in (False, True):
            with self.subTest(done=done):
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
                    ))
                    session.commit()

                loaded = service.load_group_preferences(
                    self.context,
                    self._db_groups(),
                    database_url=self.database_url,
                )
                self.assertIs(loaded['onboardingDone'], done)
                saved = service.save_group_preferences(
                    self.context,
                    {'visibleGroupIds': ['mobile'], 'activeGroupId': 'mobile'},
                    self._db_groups(),
                    database_url=self.database_url,
                )
                self.assertIs(saved['onboardingDone'], done)
                with self.factory() as session:
                    self.assertIs(session.query(models.UserGroupPreference).one().onboarding_done, done)

    def test_set_onboarding_done_updates_only_the_scalar_idempotently_and_in_isolation(self):
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

        self.assertFalse(service.set_onboarding_done(
            self.context, False, self._db_groups(), database_url=self.database_url,
        ))
        self.assertTrue(service.set_onboarding_done(
            self.context, True, self._db_groups(), database_url=self.database_url,
        ))
        self.assertTrue(service.set_onboarding_done(
            self.context, True, self._db_groups(), database_url=self.database_url,
        ))

        with self.factory() as session:
            rows = {
                (row.workspace_id, row.user_id): row
                for row in session.query(models.UserGroupPreference).all()
            }
        current = rows[(self.workspace_id, self.user_id)]
        other_user = rows[(self.workspace_id, self.other_user_id)]
        other_workspace = rows[(other_workspace_context.workspace_id, self.user_id)]
        self.assertTrue(current.onboarding_done)
        self.assertEqual(current.visible_group_ids, ['platform'])
        self.assertEqual(current.active_group_id, 'platform')
        self.assertFalse(other_user.onboarding_done)
        self.assertEqual(other_user.visible_group_ids, ['mobile'])
        self.assertFalse(other_workspace.onboarding_done)
        self.assertEqual(other_workspace.visible_group_ids, ['mobile'])

    def test_set_onboarding_done_rejects_missing_and_invalid_personal_favorites(self):
        invalid_cases = (
            (None, self._db_groups()),
            (('platform', 'deleted'), self._db_groups()),
            (('mobile', 'platform'), self._db_groups()),
            (('platform', 'platform'), {
                **self._db_groups(),
                'groups': [group for group in self._db_groups()['groups'] if group['id'] != 'platform'],
            }),
            (('empty', 'empty'), self._db_groups()),
        )
        for stored, groups_config in invalid_cases:
            with self.subTest(stored=stored):
                with self.factory() as session:
                    session.query(models.UserGroupPreference).delete()
                    if stored is not None:
                        visible_ids, active_group_id = stored
                        session.add(models.UserGroupPreference(
                            workspace_id=self.workspace_id,
                            user_id=self.user_id,
                            payload_version=1,
                            visible_group_ids=[visible_ids],
                            active_group_id=active_group_id,
                            customized=True,
                            onboarding_done=False,
                        ))
                    session.commit()

                with self.assertRaises(service.InvalidGroupPreferences):
                    service.set_onboarding_done(
                        self.context, True, groups_config, database_url=self.database_url,
                    )

    def test_set_onboarding_done_rejects_json_mode_groups(self):
        service.save_group_preferences(
            self.context,
            {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
            self._db_groups(),
            database_url=self.database_url,
        )

        with self.assertRaises(service.OnboardingPreferencesUnavailable):
            service.set_onboarding_done(
                self.context, True, self._groups(), database_url=self.database_url,
            )


if __name__ == '__main__':
    unittest.main()
