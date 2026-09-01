import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine
from backend.db import models
from backend.services.shared_capacity_config import (
    CapacityConfigConflict,
    load_shared_capacity_config,
    save_shared_capacity_config,
)


def _context(workspace_id, user_id, site_url='https://one.example.test', cloud_id='cloud-one'):
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id=user_id, stable_subject=user_id,
        atlassian_account_id=user_id, workspace_id=workspace_id,
        auth_connection_id=f'connection-{user_id}', cloud_id=cloud_id,
        site_url=site_url, token_version='1', account_status='active', is_admin=True,
    )


class SharedCapacityConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'capacity.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            first = models.Workspace(environment_key='test', name='One', jira_site_url='https://one.example.test', jira_cloud_id='cloud-one')
            second = models.Workspace(environment_key='test', name='Two', jira_site_url='https://two.example.test', jira_cloud_id='cloud-two')
            session.add_all([first, second])
            session.flush()
            self.workspace_one, self.workspace_two = first.id, second.id
            for user_id in ('user-one', 'user-two', 'user-three'):
                session.add(models.User(id=user_id, external_provider='test', external_subject=user_id, account_type='admin'))
            session.commit()
        self.one = _context(self.workspace_one, 'user-one')
        self.one_other_user = _context(self.workspace_one, 'user-two')
        self.two = _context(self.workspace_two, 'user-three', 'https://two.example.test', 'cloud-two')
        self.fields = [{'id': 'customfield_10001', 'name': 'Capacity points', 'schema': {'type': 'number'}}]

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def test_workspace_users_share_one_config_and_another_workspace_isolated(self):
        saved = save_shared_capacity_config(
            self.one, {'project': 'CAP', 'fieldId': 'customfield_10001', 'fieldName': 'Untrusted'}, 1,
            field_catalog=self.fields, database_url=self.database_url,
        )
        self.assertEqual(saved['fieldName'], 'Capacity points')
        self.assertEqual(load_shared_capacity_config(self.one_other_user, None, self.database_url)['project'], 'CAP')
        other = load_shared_capacity_config(self.two, None, self.database_url)
        self.assertEqual(other['project'], '')
        self.assertEqual(other['fieldId'], '')

    def test_stale_revision_returns_sanitized_current_config(self):
        save_shared_capacity_config(self.one, {'project': 'CAP', 'fieldId': 'customfield_10001'}, 1, field_catalog=self.fields, database_url=self.database_url)
        with self.assertRaises(CapacityConfigConflict) as raised:
            save_shared_capacity_config(self.one_other_user, {'project': 'OTHER', 'fieldId': 'customfield_10001'}, 1, field_catalog=self.fields, database_url=self.database_url)
        self.assertEqual(raised.exception.current['project'], 'CAP')
        self.assertEqual(raised.exception.current['configRevision'], 2)

    def test_concurrent_saves_with_the_same_revision_have_one_winner(self):
        save_shared_capacity_config(self.one, {'project': 'CAP', 'fieldId': 'customfield_10001'}, 1, field_catalog=self.fields, database_url=self.database_url)
        barrier = Barrier(2)

        def attempt(context, project):
            barrier.wait()
            try:
                return save_shared_capacity_config(context, {'project': project, 'fieldId': 'customfield_10001'}, 2, field_catalog=self.fields, database_url=self.database_url)
            except CapacityConfigConflict:
                return 'conflict'

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda item: attempt(*item), ((self.one, 'ONE'), (self.one_other_user, 'TWO'))))
        self.assertEqual(sum(result == 'conflict' for result in results), 1)
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(load_shared_capacity_config(self.one, None, self.database_url)['configRevision'], 3)

    def test_multiple_private_remnants_materialize_blank_resolution_marker(self):
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            for user_id, project in (('user-one', 'ONE'), ('user-two', 'TWO')):
                view = models.ViewConfig(workspace_id=self.workspace_one, owner_user_id=user_id, name=project, view_type='eng', payload={'capacity': {'project': project, 'fieldId': 'customfield_10001'}})
                session.add(view)
            session.commit()
        config = load_shared_capacity_config(self.one, None, self.database_url)
        self.assertEqual(config['configRevision'], 1)
        self.assertTrue(config['requiresResolution'])
        self.assertEqual(config['project'], '')
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            self.assertFalse(any('capacity' in row.payload for row in session.query(models.ViewConfig).all()))

    def test_two_admin_resolutions_of_a_materialized_marker_have_one_winner_and_a_sanitized_conflict(self):
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            session.add_all([
                models.ViewConfig(workspace_id=self.workspace_one, owner_user_id='user-one', name='One', view_type='eng', payload={'capacity': {'project': 'ONE', 'fieldId': 'customfield_10001'}}),
                models.ViewConfig(workspace_id=self.workspace_one, owner_user_id='user-two', name='Two', view_type='eng', payload={'capacity': {'project': 'TWO', 'fieldId': 'customfield_10001'}}),
            ])
            session.commit()
        marker = load_shared_capacity_config(self.one, None, self.database_url)
        self.assertTrue(marker['requiresResolution'])
        self.assertEqual(marker['configRevision'], 1)
        winner = save_shared_capacity_config(self.one, {'project': 'RESOLVED', 'fieldId': 'customfield_10001'}, marker['configRevision'], field_catalog=self.fields, database_url=self.database_url)
        with self.assertRaises(CapacityConfigConflict) as raised:
            save_shared_capacity_config(self.one_other_user, {'project': 'OTHER', 'fieldId': 'customfield_10001'}, marker['configRevision'], field_catalog=self.fields, database_url=self.database_url)
        self.assertFalse(winner['requiresResolution'])
        self.assertEqual(winner['configRevision'], 2)
        self.assertEqual(raised.exception.current, winner)

    def test_one_private_remnant_promotes_and_current_and_version_payloads_are_stripped(self):
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            view = models.ViewConfig(workspace_id=self.workspace_one, owner_user_id='user-one', name='Legacy', view_type='eng', payload={'capacity': {'project': 'ONE', 'fieldId': 'customfield_10001', 'fieldName': 'Capacity'}})
            session.add(view)
            session.flush()
            session.add(models.ViewConfigVersion(view_config_id=view.id, version_number=1, payload={'capacity': {'project': 'ONE', 'fieldId': 'customfield_10001', 'fieldName': 'Capacity'}}, created_by='user-one'))
            session.commit()
        promoted = load_shared_capacity_config(self.one, None, self.database_url)
        self.assertEqual(promoted['project'], 'ONE')
        with factory() as session:
            self.assertNotIn('capacity', session.query(models.ViewConfig).one().payload)
            self.assertNotIn('capacity', session.query(models.ViewConfigVersion).one().payload)

    def test_no_private_remnant_creates_blank_active_workspace_row(self):
        config = load_shared_capacity_config(self.one, None, self.database_url)
        self.assertEqual(config['project'], '')
        self.assertFalse(config['requiresResolution'])

    def test_field_must_be_exact_numeric_custom_field(self):
        invalid_catalog = [{'id': 'customfield_10001', 'name': 'Capacity points', 'schema': {'type': 'string'}}]
        with self.assertRaises(ValueError):
            save_shared_capacity_config(self.one, {'project': 'CAP', 'fieldId': 'customfield_10001'}, 1, field_catalog=invalid_catalog, database_url=self.database_url)


if __name__ == '__main__':
    unittest.main()
