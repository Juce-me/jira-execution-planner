import os
import json
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from sqlalchemy.exc import IntegrityError
from backend.auth.context import RequestAuthContext
from backend.auth.cache_policy import build_jira_home_process_cache_key
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine
from backend.db import models
from backend.epm import home as epm_home
from backend.epm.issues import EpmIssuesDependencies, build_epm_project_issues_payload
from backend.epm.projects import EpmProjectsDependencies, build_epm_home_projects_state
from backend.epm.rollup import EpmRollupDependencies, build_per_project_rollup
from backend.services import user_view_config
from backend.services.user_view_config import (
    UserViewConfigConflict,
    UserViewConfigStorageError,
    create_user_view,
    mutate_user_view,
    save_user_epm_config,
)
from backend.config.view_validation import ViewPayloadValidationError
from backend.config.import_config import import_dashboard_config
import jira_server


def oauth_context(
    user_id='user-1', connection_id='connection-1', token_version='1', workspace_id='workspace-1',
):
    return RequestAuthContext(
        auth_mode='atlassian_oauth',
        user_id=user_id,
        stable_subject=f'subject-{user_id}',
        atlassian_account_id=f'account-{user_id}',
        workspace_id=workspace_id,
        auth_connection_id=connection_id,
        cloud_id='cloud-1',
        site_url='https://example.atlassian.net',
        token_version=token_version,
        account_status='active',
        is_admin=False,
    )


def project_deps(context, cache, fetcher):
    return EpmProjectsDependencies(
        fetch_epm_home_projects=fetcher,
        merge_epm_linkage=lambda home_project, row: ({}, 'metadata-only'),
        normalize_epm_config=lambda payload: payload,
        utc_now_iso=lambda timespec=None: 'fresh',
        cache=cache,
        cache_lock=threading.Lock(),
        cache_ttl_seconds=300,
        home_project_limit=500,
        now=lambda: 1001,
        context=context,
    )


class FakeGoalClient:
    def __init__(self, goal):
        self.goal = goal
        self.execute_calls = 0

    def execute(self, _query, _variables):
        self.execute_calls += 1
        return {'data': {'goals_byKey': self.goal}}


class EpmHomeCacheIsolationTests(unittest.TestCase):
    def setUp(self):
        epm_home._GOAL_BY_KEY_CACHE.clear()

    def tearDown(self):
        epm_home._GOAL_BY_KEY_CACHE.clear()

    def test_user_home_project_visibility_does_not_share_cached_projects(self):
        cache = {}
        scope = {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']}
        user_a_calls = []
        user_b_calls = []

        state_a = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(user_id='user-a', connection_id='connection-a'),
                cache,
                lambda _scope: user_a_calls.append('fetch') or [{'homeProjectId': 'project-a'}],
            ),
        )
        state_b = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(user_id='user-b', connection_id='connection-b'),
                cache,
                lambda _scope: user_b_calls.append('fetch') or [{'homeProjectId': 'project-b'}],
            ),
        )

        self.assertFalse(state_a['cacheHit'])
        self.assertFalse(state_b['cacheHit'])
        self.assertEqual(state_a['homeProjects'], [{'homeProjectId': 'project-a'}])
        self.assertEqual(state_b['homeProjects'], [{'homeProjectId': 'project-b'}])
        self.assertEqual(user_a_calls, ['fetch'])
        self.assertEqual(user_b_calls, ['fetch'])
        self.assertEqual(len(cache), 2)

    def test_token_update_refetches_home_project_metadata(self):
        cache = {}
        scope = {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']}
        calls = []

        first_state = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(token_version='1'),
                cache,
                lambda _scope: calls.append('v1') or [{'homeProjectId': 'before-update'}],
            ),
        )
        second_state = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(token_version='2'),
                cache,
                lambda _scope: calls.append('v2') or [{'homeProjectId': 'after-update'}],
            ),
        )

        self.assertEqual(first_state['homeProjects'], [{'homeProjectId': 'before-update'}])
        self.assertEqual(second_state['homeProjects'], [{'homeProjectId': 'after-update'}])
        self.assertEqual(calls, ['v1', 'v2'])
        self.assertEqual(len(cache), 2)

    def test_revoked_token_does_not_return_stale_home_projects(self):
        cache = {}
        scope = {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']}

        build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(token_version='1'),
                cache,
                lambda _scope: [{'homeProjectId': 'still-visible-before-revoke'}],
            ),
        )

        with self.assertRaises(AuthError) as raised:
            build_epm_home_projects_state(
                scope,
                project_deps(
                    oauth_context(token_version='2'),
                    cache,
                    lambda _scope: (_ for _ in ()).throw(
                        AuthError('home_user_token_required', 'Connect your Atlassian API token to load EPM Home projects.')
                    ),
                ),
            )

        self.assertEqual(raised.exception.code, 'home_user_token_required')
        self.assertEqual(len(cache), 1)

    def test_goal_lookup_bypasses_process_cache_for_oauth_context(self):
        container_id = 'ari:cloud:townsquare::site/cloud-1'
        cache_key = epm_home._goal_cache_key(container_id, 'ROOT-100')
        epm_home._GOAL_BY_KEY_CACHE[cache_key] = {
            'id': 'cached-goal',
            'key': 'ROOT-100',
            'name': 'Cached for another user',
        }
        client = FakeGoalClient({
            'id': 'fresh-goal',
            'key': 'ROOT-100',
            'name': 'Fresh for current user',
        })

        goal = epm_home.resolve_goal_by_key(
            client,
            'ROOT-100',
            container_id,
            context=oauth_context(),
        )

        self.assertEqual(goal['id'], 'fresh-goal')
        self.assertEqual(client.execute_calls, 1)
        self.assertEqual(epm_home._GOAL_BY_KEY_CACHE[cache_key]['id'], 'cached-goal')
        partitioned_key = build_jira_home_process_cache_key(oauth_context(), cache_key)
        self.assertEqual(epm_home._GOAL_BY_KEY_CACHE[partitioned_key]['id'], 'fresh-goal')

    def test_epm_clear_removes_only_the_current_oauth_partition(self):
        user_a = oauth_context(user_id='user-a', connection_id='connection-a')
        user_b = oauth_context(user_id='user-b', connection_id='connection-b')
        key_a = build_jira_home_process_cache_key(user_a, 'projects', 'generation')
        key_b = build_jira_home_process_cache_key(user_b, 'projects', 'generation')
        for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
            cache.clear()
            cache[key_a] = {'data': 'a'}
            cache[key_b] = {'data': 'b'}

        jira_server.clear_epm_caches(user_a)

        for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
            self.assertNotIn(key_a, cache)
            self.assertIn(key_b, cache)

    def test_config_digest_forces_projects_issues_and_rollup_misses_without_local_eviction(self):
        context = oauth_context()
        calls = {'projects': 0, 'issues': 0, 'rollup': 0}
        project_cache = {}
        issue_cache = {}
        rollup_cache = {}

        def fetch_projects(_scope):
            calls['projects'] += 1
            return [{'homeProjectId': 'home-1'}]

        for generation in ('old-digest', 'new-digest'):
            deps = project_deps(context, project_cache, fetch_projects)
            deps.config_generation = generation
            state = build_epm_home_projects_state({'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']}, deps)
            self.assertFalse(state['cacheHit'])

        def fetch_issues(*_args, **_kwargs):
            calls['issues'] += 1
            return []

        for generation in ('old-digest', 'new-digest'):
            payload, status, headers = build_epm_project_issues_payload(
                'home-1', 'active', '1', EpmIssuesDependencies(
                    find_epm_project_or_404=lambda _project_id: {
                        'id': 'home-1', 'resolvedLinkage': {'labels': ['label-one']},
                    },
                    validate_epm_tab_sprint=lambda _tab, _sprint: None,
                    build_epm_scope_clause=lambda _linkage: 'labels = label-one',
                    build_base_jql=lambda: 'project = PROD',
                    add_clause_to_jql=lambda base, clause: f'{base} AND {clause}',
                    fetch_issues_by_jql=fetch_issues,
                    build_epm_fields_list=lambda: ['summary'],
                    shape_epm_issue_payload=lambda issues: (issues, {}),
                    dedupe_issues_by_key=lambda issues: issues,
                    cache=issue_cache, cache_lock=threading.Lock(), cache_ttl_seconds=300,
                    context=context, config_generation=generation, now=lambda: 10, timer=lambda: 1,
                ),
            )
            self.assertEqual(status, 200)
            self.assertEqual(payload['issues'], [])
            self.assertIn('Server-Timing', headers)

        def fetch_rollup(*_args, **_kwargs):
            calls['rollup'] += 1
            return []

        for generation in ('old-digest', 'new-digest'):
            payload, status, headers = build_per_project_rollup(
                'home-1', 'active', '1', EpmRollupDependencies(
                    find_epm_project_or_404=lambda _project_id: {'id': 'home-1', 'label': 'label-one'},
                    normalize_epm_text=lambda value: str(value or '').strip(),
                    validate_epm_tab_sprint=lambda _tab, _sprint: None,
                    build_empty_epm_rollup_payload=lambda project, **flags: {**project, **flags},
                    build_base_jql=lambda: 'project = PROD',
                    add_clause_to_jql=lambda base, clause: f'{base} AND {clause}',
                    build_jira_headers=lambda: {}, resolve_epic_link_field_id=lambda _headers: 'epic-link',
                    resolve_team_field_id=lambda _headers: 'team',
                    build_epm_rollup_fields_list=lambda *_args: ['summary'],
                    get_epm_config=lambda: {'issueTypes': {}},
                    normalize_epm_issue_type_sets=lambda _types: {
                        'initiative': {'initiative'}, 'epic': {'epic'}, 'leaf': {'story'},
                    },
                    fetch_epm_rollup_query=fetch_rollup,
                    shape_epm_rollup_issue_payload=lambda issues, **_kwargs: (issues, {}),
                    dedupe_issues_by_key=lambda issues: issues,
                    build_epm_rollup_hierarchy=lambda *_args: {},
                    cache=rollup_cache, cache_lock=threading.Lock(), cache_ttl_seconds=300,
                    context=context, config_generation=generation, now=lambda: 10,
                ),
            )
            self.assertEqual(status, 200)
            self.assertTrue(payload['empty_rollup'])
            self.assertIn('Server-Timing', headers)

        self.assertEqual(calls, {'projects': 2, 'issues': 2, 'rollup': 2})
        self.assertEqual((len(project_cache), len(issue_cache), len(rollup_cache)), (2, 2, 2))

    def test_effective_default_mutations_evict_only_after_commit_and_only_target_partition(self):
        tmpdir = tempfile.TemporaryDirectory()
        database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir.name, 'cache-invalidation.db')}"
        engine = db_engine.get_engine(database_url)
        models.Base.metadata.create_all(engine)
        factory = db_engine.session_factory(database_url)
        try:
            with factory() as session:
                workspaces = []
                for index in range(2):
                    workspace = models.Workspace(
                        environment_key=f'cache-{index}', name=f'Cache {index}',
                        jira_site_url=f'https://cache-{index}.example.net', jira_cloud_id=f'cloud-{index}',
                        created_by='test',
                    )
                    session.add(workspace)
                    workspaces.append(workspace)
                users = []
                for index in range(2):
                    user = models.User(
                        external_provider='atlassian', external_subject=f'cache-user-{index}',
                        account_type='user', status='active', created_by='test',
                    )
                    session.add(user)
                    users.append(user)
                session.flush()
                workspace_ids = [row.id for row in workspaces]
                user_ids = [row.id for row in users]
                session.commit()

            target = oauth_context(user_ids[0], 'connection-a', workspace_id=workspace_ids[0])
            same_workspace = oauth_context(user_ids[1], 'connection-b', workspace_id=workspace_ids[0])
            other_workspace = oauth_context(user_ids[0], 'connection-c', workspace_id=workspace_ids[1])
            caches = (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE)
            target_keys = [build_jira_home_process_cache_key(target, kind, 'old') for kind in ('projects', 'issues', 'rollup')]
            same_user_keys = [build_jira_home_process_cache_key(same_workspace, kind, 'old') for kind in ('projects', 'issues', 'rollup')]
            other_workspace_keys = [build_jira_home_process_cache_key(other_workspace, kind, 'old') for kind in ('projects', 'issues', 'rollup')]
            callbacks = []

            def warm():
                for cache, target_key, same_key, other_key in zip(caches, target_keys, same_user_keys, other_workspace_keys):
                    cache.clear()
                    cache[target_key] = {'data': 'target'}
                    cache[same_key] = {'data': 'same-workspace'}
                    cache[other_key] = {'data': 'other-workspace'}

            def after_commit(result):
                callbacks.append(result.view_config_id)
                jira_server.clear_epm_caches(target)

            def assert_evicted_once(before):
                self.assertEqual(len(callbacks), before + 1)
                for cache, target_key, same_key, other_key in zip(caches, target_keys, same_user_keys, other_workspace_keys):
                    self.assertNotIn(target_key, cache)
                    self.assertIn(same_key, cache)
                    self.assertIn(other_key, cache)

            def assert_not_evicted(before):
                self.assertEqual(len(callbacks), before)
                for cache, target_key in zip(caches, target_keys):
                    self.assertIn(target_key, cache)

            payload = lambda marker: {
                'version': 2,
                'scope': {'rootGoalKey': f'root-{marker}', 'subGoalKeys': [f'goal-{marker}']},
                'labelPrefix': 'project_*', 'projects': {},
                'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
            }

            warm()
            before = len(callbacks)
            default = save_user_epm_config(target, payload('created'), database_url=database_url, post_commit=after_commit)
            assert_evicted_once(before)

            warm()
            before = len(callbacks)
            replaced = save_user_epm_config(target, payload('replacement'), database_url=database_url, post_commit=after_commit)
            assert_evicted_once(before)

            warm()
            before = len(callbacks)
            other = create_user_view(
                target, name='Other', view_type='epm', payload={'epm': payload('other')},
                is_default=False, database_url=database_url, post_commit=after_commit,
            )
            assert_not_evicted(before)

            for mutation in (
                lambda: mutate_user_view(target, other.view_config_id, name='Metadata only', database_url=database_url, post_commit=after_commit),
                lambda: mutate_user_view(
                    target, default.view_config_id, payload={'epm': payload('replacement')},
                    base_version=replaced.version_number, database_url=database_url, post_commit=after_commit,
                ),
            ):
                warm()
                before = len(callbacks)
                mutation()
                assert_not_evicted(before)

            for mutation in (
                lambda: mutate_user_view(target, other.view_config_id, is_default=True, database_url=database_url, post_commit=after_commit),
                lambda: mutate_user_view(target, other.view_config_id, is_default=False, database_url=database_url, post_commit=after_commit),
                lambda: mutate_user_view(target, default.view_config_id, is_default=True, database_url=database_url, post_commit=after_commit),
                lambda: mutate_user_view(target, default.view_config_id, archive=True, database_url=database_url, post_commit=after_commit),
            ):
                warm()
                before = len(callbacks)
                mutation()
                assert_evicted_once(before)

            warm()
            before = len(callbacks)
            with self.assertRaises(UserViewConfigConflict):
                mutate_user_view(
                    target, other.view_config_id, payload={'epm': payload('conflict')}, base_version=0,
                    database_url=database_url, post_commit=after_commit,
                )
            assert_not_evicted(before)

            with self.assertRaises(ViewPayloadValidationError):
                save_user_epm_config(
                    target, {**payload('invalid'), 'projects': {'bad': {
                        'id': 'bad', 'name': 'Bad', 'label': 'bad', 'homeProjectId': '',
                    }}}, database_url=database_url, post_commit=after_commit,
                )
            assert_not_evicted(before)

            retry_error = IntegrityError(
                'insert', {}, sqlite3.IntegrityError(
                    'UNIQUE constraint failed: view_config_versions.view_config_id, view_config_versions.version_number'
                ),
            )
            with patch.object(user_view_config, '_run_mutation_once', side_effect=retry_error):
                with self.assertRaises(UserViewConfigStorageError):
                    save_user_epm_config(target, payload('retry'), database_url=database_url, post_commit=after_commit)
                self.assertEqual(user_view_config._run_mutation_once.call_count, 3)
            assert_not_evicted(before)

            with self.assertRaises(RuntimeError):
                create_user_view(
                    target, name='Rollback', view_type='epm', payload={'epm': payload('rollback')},
                    is_default=True, database_url=database_url, post_commit=after_commit,
                    _before_commit=lambda: (_ for _ in ()).throw(RuntimeError('rollback')),
                )
            assert_not_evicted(before)
        finally:
            for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
                cache.clear()
            db_engine.dispose_engines()
            tmpdir.cleanup()

    def test_legacy_import_invalidates_only_changed_owner_partition_after_commit(self):
        tmpdir = tempfile.TemporaryDirectory()
        database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir.name, 'import-cache.db')}"
        source_path = os.path.join(tmpdir.name, 'dashboard-config.json')
        engine = db_engine.get_engine(database_url)
        models.Base.metadata.create_all(engine)
        factory = db_engine.session_factory(database_url)
        try:
            with factory() as session:
                workspace = models.Workspace(environment_key='import', name='Import', created_by='test')
                other_workspace = models.Workspace(environment_key='import-other', name='Other', created_by='test')
                user = models.User(
                    external_provider='atlassian', external_subject='import-user', account_type='user',
                    status='active', created_by='test',
                )
                other_user = models.User(
                    external_provider='atlassian', external_subject='other-user', account_type='user',
                    status='active', created_by='test',
                )
                session.add_all([workspace, other_workspace, user, other_user])
                session.flush()
                session.commit()
                ids = workspace.id, other_workspace.id, user.id, other_user.id
            workspace_id, other_workspace_id, user_id, other_user_id = ids
            target = oauth_context(user_id, 'connection-target', workspace_id=workspace_id)
            other_user = oauth_context(other_user_id, 'connection-other-user', workspace_id=workspace_id)
            other_workspace = oauth_context(user_id, 'connection-other-workspace', workspace_id=other_workspace_id)
            caches = (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE)
            target_keys = [build_jira_home_process_cache_key(target, kind, 'old') for kind in ('projects', 'issues', 'rollup')]
            other_user_keys = [build_jira_home_process_cache_key(other_user, kind, 'old') for kind in ('projects', 'issues', 'rollup')]
            other_workspace_keys = [build_jira_home_process_cache_key(other_workspace, kind, 'old') for kind in ('projects', 'issues', 'rollup')]
            callbacks = []

            def warm():
                for cache, target_key, user_key, workspace_key in zip(caches, target_keys, other_user_keys, other_workspace_keys):
                    cache.clear()
                    cache[target_key] = 'target'
                    cache[user_key] = 'other-user'
                    cache[workspace_key] = 'other-workspace'

            def after_commit(result):
                callbacks.append(result.view_config_id)
                jira_server.clear_epm_caches(target)

            def payload(marker):
                return {
                    'version': 1,
                    'epm': {
                        'version': 2, 'labelPrefix': 'project_*',
                        'scope': {'rootGoalKey': marker, 'subGoalKeys': []},
                        'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
                        'projects': {},
                    },
                }

            with open(source_path, 'w', encoding='utf-8') as handle:
                json.dump(payload('ROOT-1'), handle)
            warm()
            first = import_dashboard_config(
                database_url=database_url, context=target, source_path=source_path,
                post_commit=after_commit,
            )
            self.assertTrue(first.imported)
            self.assertEqual(len(callbacks), 1)
            for cache, target_key, user_key, workspace_key in zip(caches, target_keys, other_user_keys, other_workspace_keys):
                self.assertNotIn(target_key, cache)
                self.assertIn(user_key, cache)
                self.assertIn(workspace_key, cache)

            warm()
            duplicate = import_dashboard_config(
                database_url=database_url, context=target, source_path=source_path,
                post_commit=after_commit,
            )
            self.assertFalse(duplicate.imported)
            self.assertEqual(len(callbacks), 1)
            for cache, target_key in zip(caches, target_keys):
                self.assertIn(target_key, cache)

            unchanged_path = os.path.join(tmpdir.name, 'same-epm.json')
            with open(unchanged_path, 'w', encoding='utf-8') as handle:
                json.dump(payload('ROOT-1'), handle)
            unchanged = import_dashboard_config(
                database_url=database_url, context=target, source_path=unchanged_path,
                post_commit=after_commit,
            )
            self.assertTrue(unchanged.imported)
            self.assertEqual(len(callbacks), 1)
            with factory() as session:
                saved = session.query(models.ViewConfig).filter_by(
                    workspace_id=workspace_id, owner_user_id=user_id, is_default=True,
                ).one()
                persisted_before_failures = (
                    dict(saved.payload), saved.source_path, saved.source_hash,
                    session.query(models.ViewConfigVersion).filter_by(view_config_id=saved.id).count(),
                )

            invalid_path = os.path.join(tmpdir.name, 'invalid.json')
            with open(invalid_path, 'w', encoding='utf-8') as handle:
                json.dump({'epm': {'version': 2, 'teamCatalog': {}}}, handle)
            with self.assertRaises(ViewPayloadValidationError):
                import_dashboard_config(
                    database_url=database_url, context=target, source_path=invalid_path,
                    post_commit=after_commit,
                )
            self.assertEqual(len(callbacks), 1)
            for cache, target_key, user_key, workspace_key in zip(caches, target_keys, other_user_keys, other_workspace_keys):
                self.assertIn(target_key, cache)
                self.assertIn(user_key, cache)
                self.assertIn(workspace_key, cache)

            changed_path = os.path.join(tmpdir.name, 'changed.json')
            with open(changed_path, 'w', encoding='utf-8') as handle:
                json.dump(payload('ROOT-2'), handle)
            with self.assertRaises(RuntimeError):
                import_dashboard_config(
                    database_url=database_url, context=target, source_path=changed_path,
                    post_commit=after_commit,
                    _before_commit=lambda: (_ for _ in ()).throw(RuntimeError('rollback')),
                )
            self.assertEqual(len(callbacks), 1)
            for cache, target_key, user_key, workspace_key in zip(caches, target_keys, other_user_keys, other_workspace_keys):
                self.assertIn(target_key, cache)
                self.assertIn(user_key, cache)
                self.assertIn(workspace_key, cache)
            with factory() as session:
                saved = session.query(models.ViewConfig).filter_by(
                    workspace_id=workspace_id, owner_user_id=user_id, is_default=True,
                ).one()
                self.assertEqual(
                    (
                        dict(saved.payload), saved.source_path, saved.source_hash,
                        session.query(models.ViewConfigVersion).filter_by(view_config_id=saved.id).count(),
                    ),
                    persisted_before_failures,
                )
        finally:
            for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
                cache.clear()
            db_engine.dispose_engines()
            tmpdir.cleanup()


if __name__ == '__main__':
    unittest.main()
