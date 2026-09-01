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
            self.one, {'project': 'CAP', 'fieldId': 'customfield_10001', 'fieldName': 'Untrusted'}, 0,
            field_catalog=self.fields, database_url=self.database_url,
        )
        self.assertEqual(saved['fieldName'], 'Capacity points')
        self.assertEqual(load_shared_capacity_config(self.one_other_user, None, self.database_url)['project'], 'CAP')
        other = load_shared_capacity_config(self.two, None, self.database_url)
        self.assertEqual(other['project'], '')
        self.assertEqual(other['fieldId'], '')

    def test_stale_revision_returns_sanitized_current_config(self):
        save_shared_capacity_config(self.one, {'project': 'CAP', 'fieldId': 'customfield_10001'}, 0, field_catalog=self.fields, database_url=self.database_url)
        with self.assertRaises(CapacityConfigConflict) as raised:
            save_shared_capacity_config(self.one_other_user, {'project': 'OTHER', 'fieldId': 'customfield_10001'}, 0, field_catalog=self.fields, database_url=self.database_url)
        self.assertEqual(raised.exception.current['project'], 'CAP')
        self.assertEqual(raised.exception.current['configRevision'], 1)

    def test_concurrent_saves_with_the_same_revision_have_one_winner(self):
        save_shared_capacity_config(self.one, {'project': 'CAP', 'fieldId': 'customfield_10001'}, 0, field_catalog=self.fields, database_url=self.database_url)
        barrier = Barrier(2)

        def attempt(context, project):
            barrier.wait()
            try:
                return save_shared_capacity_config(context, {'project': project, 'fieldId': 'customfield_10001'}, 1, field_catalog=self.fields, database_url=self.database_url)
            except CapacityConfigConflict:
                return 'conflict'

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda item: attempt(*item), ((self.one, 'ONE'), (self.one_other_user, 'TWO'))))
        self.assertEqual(sum(result == 'conflict' for result in results), 1)
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(load_shared_capacity_config(self.one, None, self.database_url)['configRevision'], 2)

    def test_private_view_capacity_never_becomes_workspace_capacity(self):
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            for user_id, project in (('user-one', 'ONE'), ('user-two', 'TWO')):
                view = models.ViewConfig(workspace_id=self.workspace_one, owner_user_id=user_id, name=project, view_type='eng', payload={'capacity': {'project': project, 'fieldId': 'customfield_10001'}})
                session.add(view)
            session.commit()
        config = load_shared_capacity_config(self.one, None, self.database_url)
        self.assertEqual(config['configRevision'], 0)
        self.assertFalse(config['requiresResolution'])
        self.assertEqual(config['project'], '')

    def test_save_preserves_other_workspace_administrator_sections(self):
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=self.workspace_one,
                payload={'board': {'boardId': '42', 'boardName': 'Planning'}},
                config_revision=1,
            ))
            session.commit()
        save_shared_capacity_config(
            self.one, {'project': 'CAP', 'fieldId': 'customfield_10001'}, 1,
            field_catalog=self.fields, database_url=self.database_url,
        )
        with factory() as session:
            payload = session.query(models.WorkspaceDashboardConfig).one().payload
        self.assertEqual(payload['board'], {'boardId': '42', 'boardName': 'Planning'})
        self.assertEqual(payload['capacity']['project'], 'CAP')

    def test_no_private_remnant_creates_blank_active_workspace_row(self):
        config = load_shared_capacity_config(self.one, None, self.database_url)
        self.assertEqual(config['project'], '')
        self.assertEqual(config['configRevision'], 0)
        self.assertFalse(config['requiresResolution'])

    def test_field_must_be_exact_numeric_custom_field(self):
        invalid_catalog = [{'id': 'customfield_10001', 'name': 'Capacity points', 'schema': {'type': 'string'}}]
        with self.assertRaises(ValueError):
            save_shared_capacity_config(self.one, {'project': 'CAP', 'fieldId': 'customfield_10001'}, 0, field_catalog=invalid_catalog, database_url=self.database_url)


if __name__ == '__main__':
    unittest.main()
