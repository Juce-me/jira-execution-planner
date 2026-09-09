import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import jira_server
from backend.auth.context import RequestAuthContext
from backend.routes import eng_routes


def oauth_context():
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id='user-1', stable_subject='subject-1',
        atlassian_account_id='account-1', workspace_id='workspace-1',
        auth_connection_id='connection-1', cloud_id='cloud-1',
        site_url='https://example.atlassian.net', token_version='1',
        account_status='active', is_admin=False,
    )


class IssueEditCacheGenerationTests(unittest.TestCase):
    def setUp(self):
        jira_server.clear_auth_sensitive_caches('test_setup')
        eng_routes.SUBTASKS_CACHE.clear()

    def test_auth_clear_and_field_config_save_advance_the_same_generation(self):
        initial = jira_server.get_jira_issue_cache_generation()
        jira_server.clear_auth_sensitive_caches('test')
        after_clear = jira_server.get_jira_issue_cache_generation()
        self.assertGreater(after_clear, initial)

        with jira_server.app.test_request_context(json={'fieldId': 'customfield_12345', 'fieldName': 'Story Points'}), \
             patch.object(jira_server, 'config_storage_db_enabled', return_value=False), \
             patch.object(jira_server, 'load_dashboard_config', return_value={}), \
             patch.object(jira_server, 'save_dashboard_config'):
            response = jira_server._save_field_config('storyPointsField')
        self.assertEqual(response.status_code, 200)
        self.assertGreater(jira_server.get_jira_issue_cache_generation(), after_clear)

    def test_old_epic_summary_producer_cannot_repopulate_after_invalidation(self):
        started = threading.Event()
        release = threading.Event()
        calls = []

        def blocked_fetch(keys, fields, context=None):
            calls.append(list(keys))
            if len(calls) == 1:
                started.set()
                self.assertTrue(release.wait(5))
            return [{
                'key': keys[0],
                'fields': {'summary': 'Old' if len(calls) == 1 else 'Fresh', 'assignee': None},
            }]

        result = {}
        worker = threading.Thread(target=lambda: result.update(
            jira_server.fetch_cached_excluded_capacity_epic_summaries(['DEMO-1'])
        ))
        with patch.object(jira_server, 'get_project_track_field_id', return_value='customfield_track'), \
             patch.object(jira_server, 'fetch_issues_by_keys', side_effect=blocked_fetch):
            worker.start()
            self.assertTrue(started.wait(5))
            jira_server.clear_auth_sensitive_caches('issue_field_edit')
            release.set()
            worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(jira_server.EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE, {})
            fresh = jira_server.fetch_cached_excluded_capacity_epic_summaries(['DEMO-1'])

        self.assertEqual(len(calls), 2)
        self.assertEqual(fresh['DEMO-1']['summary'], 'Fresh')

    def test_old_dependency_producer_cannot_repopulate_after_invalidation(self):
        started = threading.Event()
        release = threading.Event()
        calls = []
        responses = []

        def blocked_collect(keys, context=None):
            calls.append(list(keys))
            if len(calls) == 1:
                started.set()
                self.assertTrue(release.wait(5))
            return {'DEMO-1': [{'key': 'OLD-1' if len(calls) == 1 else 'FRESH-1'}]}

        def request_once():
            with jira_server.app.test_request_context('/api/dependencies', method='POST', json={'keys': ['DEMO-1']}):
                eng_routes._sync_server_globals()
                responses.append(eng_routes.get_dependencies())

        with patch.object(jira_server, 'current_request_auth_context', return_value=oauth_context()), \
             patch.object(jira_server, 'jira_home_partitioned_process_cache_enabled', return_value=True), \
             patch.object(jira_server, 'collect_dependencies', side_effect=blocked_collect):
            worker = threading.Thread(target=request_once)
            worker.start()
            self.assertTrue(started.wait(5))
            jira_server.clear_auth_sensitive_caches('issue_field_edit')
            release.set()
            worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(jira_server.DEPENDENCIES_CACHE, {})
            request_once()

        self.assertEqual(len(calls), 2)

    def test_every_task_two_cache_writer_compares_generation_under_the_cache_lock(self):
        server_source = Path('jira_server.py').read_text(encoding='utf-8')
        eng_source = Path('backend/routes/eng_routes.py').read_text(encoding='utf-8')
        for cache_name in (
            'TASKS_CACHE', 'EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE',
            'EXCLUDED_CAPACITY_STATS_SOURCE_CACHE', 'EPIC_COHORT_CACHE',
        ):
            self.assertRegex(
                server_source,
                rf'with _cache_lock:[\s\S]{{0,240}}get_jira_issue_cache_generation\(\) == cache_generation:[\s\S]{{0,240}}{cache_name}',
            )
        for cache_name in ('DEPENDENCIES_CACHE', 'SUBTASKS_CACHE', 'MISSING_INFO_CACHE'):
            self.assertRegex(
                eng_source,
                rf'with _cache_lock:[\s\S]{{0,240}}get_jira_issue_cache_generation\(\) == cache_generation:[\s\S]{{0,240}}{cache_name}',
            )


if __name__ == '__main__':
    unittest.main()
