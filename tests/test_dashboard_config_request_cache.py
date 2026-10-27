import unittest
from unittest.mock import patch

from flask import g

import jira_server
from backend.config.repository import ConfigStorageError
from backend.services.workspace_dashboard_config import WorkspaceConfigSnapshot


def _snapshot(field_id='customfield_10004', revision=1):
    return WorkspaceConfigSnapshot(
        {'storyPointsField': {'fieldId': field_id, 'fieldName': 'Story points'}}, revision, 'workspace_db')


class _CountingRepository:
    def __init__(self, snapshot):
        self.snapshot = snapshot
        self.reads = 0

    def load_dashboard_config_snapshot(self, context, **kwargs):
        self.reads += 1
        return self.snapshot

    def save_dashboard_section(self, context, section, value, base_revision, **kwargs):
        self.snapshot = _snapshot(value['fieldId'], base_revision + 1)
        return self.snapshot


class DashboardConfigRequestCacheTests(unittest.TestCase):
    """In DB mode a field-id getter must not re-resolve the request auth context (several queries) on every call.

    The lane and dependency loops call get_story_points_field_id() once per issue, so on a 75-issue lane the
    repeated resolution measured about 14 ms per issue (about one second) of the Catch Up lane response build.
    """

    def setUp(self):
        self.resolutions = 0
        self.repository = _CountingRepository(_snapshot())
        self.context_error = None

        def resolve_context():
            self.resolutions += 1
            if self.context_error is not None:
                raise self.context_error
            return object()

        patches = (
            patch.object(jira_server, 'config_storage_db_enabled', return_value=True),
            patch.object(jira_server, 'build_db_config_repository', return_value=self.repository),
            patch.object(jira_server, 'current_request_auth_context', side_effect=resolve_context),
        )
        for active in patches:
            active.start()
            self.addCleanup(active.stop)

    def test_repeated_field_id_reads_resolve_the_request_context_and_the_repository_once(self):
        with jira_server.app.test_request_context('/'):
            for _ in range(100):
                self.assertEqual(jira_server.get_story_points_field_id(), 'customfield_10004')
        self.assertEqual(self.resolutions, 1)
        self.assertEqual(self.repository.reads, 1)

    def test_each_request_resolves_its_own_context(self):
        for _ in range(2):
            with jira_server.app.test_request_context('/'):
                jira_server.get_story_points_field_id()
                jira_server.get_story_points_field_id()
        self.assertEqual(self.resolutions, 2)
        self.assertEqual(self.repository.reads, 2)

    def test_a_snapshot_the_guard_already_placed_on_the_request_resolves_no_context(self):
        with jira_server.app.test_request_context('/'):
            g._workspace_dashboard_config_snapshot = _snapshot('customfield_guard')
            self.assertEqual(jira_server.get_story_points_field_id(), 'customfield_guard')
            self.assertEqual(jira_server.load_dashboard_config_snapshot().config_revision, 1)
        self.assertEqual(self.resolutions, 0)
        self.assertEqual(self.repository.reads, 0)

    def test_a_saved_section_replaces_the_snapshot_later_reads_in_the_request_see(self):
        with jira_server.app.test_request_context('/'):
            self.assertEqual(jira_server.get_story_points_field_id(), 'customfield_10004')
            jira_server.save_dashboard_config_section(
                'storyPointsField', {'fieldId': 'customfield_20000'}, base_revision=1)
            self.assertEqual(jira_server.get_story_points_field_id(), 'customfield_20000')

    def test_a_failed_first_resolution_is_not_cached_and_the_next_read_resolves_again(self):
        self.context_error = jira_server.AuthError('auth_required', 'Atlassian authentication is required.')
        with jira_server.app.test_request_context('/'):
            for _ in range(2):
                with self.assertRaises(jira_server.AuthError):
                    jira_server.get_story_points_field_id()
        self.assertEqual(self.resolutions, 2)
        self.assertEqual(self.repository.reads, 0)

    def test_a_read_outside_a_request_still_fails_closed_without_resolving_a_context(self):
        with patch.object(jira_server, 'has_request_context', return_value=False):
            with self.assertRaises(ConfigStorageError):
                jira_server.get_story_points_field_id()
        self.assertEqual(self.resolutions, 0)
        self.assertEqual(self.repository.reads, 0)


if __name__ == '__main__':
    unittest.main()
