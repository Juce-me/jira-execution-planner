"""Pure Home shaping and strict OAuth provider-boundary contracts; all data is synthetic."""
import json
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from flask import session as flask_session

import jira_server
from backend.auth.db_context import revalidate_db_request_auth_context
from backend.auth.jira_auth import AuthError
from backend.epm import home as epm_home
from backend.epm.home import (
    bucket_epm_state, build_home_project_record, extract_latest_update,
    extract_tag_names, _container_id_from_cloud,
)
from tests.oauth_test_helpers import set_up_db_oauth, install_oauth_session, FULL_OAUTH_SCOPE


class TestEpmHomeShaping(unittest.TestCase):
    def test_bucket_pending_as_active(self):
        self.assertEqual(bucket_epm_state('PENDING'), 'active')

    def test_bucket_completed_as_archived(self):
        self.assertEqual(bucket_epm_state('COMPLETED'), 'archived')
        self.assertEqual(bucket_epm_state('DONE'), 'archived')
        self.assertEqual(bucket_epm_state('Completed 🎉'), 'archived')

    def test_bucket_todo_as_backlog(self):
        self.assertEqual(bucket_epm_state('TODO'), 'backlog')
        self.assertEqual(bucket_epm_state('To do'), 'backlog')

    def test_bucket_on_track_label_as_active(self):
        self.assertEqual(bucket_epm_state('On track'), 'active')
        self.assertEqual(bucket_epm_state('ON TRACK'), 'active')

    def test_extract_latest_update_prefers_newest_creation_date(self):
        latest = extract_latest_update([
            {'creationDate': '2026-04-01T08:00:00.000Z', 'summary': 'Older update'},
            {'creationDate': '2026-04-09T12:00:00.000Z', 'summary': 'Latest update'},
        ])
        self.assertEqual(latest['date'], '2026-04-09')
        self.assertEqual(latest['snippet'], 'Latest update')

    def test_extract_latest_update_skips_empty_no_update_placeholders(self):
        latest = extract_latest_update([
            {'creationDate': '2026-05-10T08:00:00.000Z', 'summary': ''},
            {
                'creationDate': '2026-04-29T12:00:00.000Z',
                'summary': '[on track] RFP AI bot and related deals AI work are progressing',
            },
        ])
        self.assertEqual(latest['date'], '2026-04-29')
        self.assertEqual(latest['snippet'], '[on track] RFP AI bot and related deals AI work are progressing')

    def test_extract_latest_update_includes_creator_name(self):
        latest = extract_latest_update([
            {
                'creationDate': '2026-04-09T12:00:00.000Z',
                'summary': 'Latest update',
                'creator': {'accountId': 'account-1', 'name': 'Ada Lovelace'},
            },
        ])
        self.assertEqual(latest['author'], 'Ada Lovelace')

    def test_extract_latest_update_includes_specific_update_url(self):
        latest = extract_latest_update([
            {
                'creationDate': '2026-04-09T12:00:00.000Z',
                'summary': 'Latest update',
                'url': 'https://home.atlassian.com/o/example/s/example/project/PROJ/updates/update-1',
            },
        ])
        self.assertEqual(
            latest['url'],
            'https://home.atlassian.com/o/example/s/example/project/PROJ/updates/update-1',
        )

    def test_extract_latest_update_preserves_adf_formatting_as_safe_html(self):
        latest = extract_latest_update([
            {
                'creationDate': '2026-04-09T12:00:00.000Z',
                'summary': json.dumps({
                    'version': 1,
                    'type': 'doc',
                    'content': [
                        {
                            'type': 'paragraph',
                            'content': [
                                {'type': 'text', 'text': 'Bold', 'marks': [{'type': 'strong'}]},
                                {'type': 'text', 'text': ' and '},
                                {'type': 'text', 'text': 'italic', 'marks': [{'type': 'em'}]},
                                {'type': 'text', 'text': ' '},
                                {
                                    'type': 'text',
                                    'text': 'link',
                                    'marks': [{'type': 'link', 'attrs': {'href': 'https://example.test/update'}}],
                                },
                            ],
                        },
                        {'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Second paragraph'}]},
                    ],
                }),
            }
        ])

        self.assertEqual(latest['snippet'], 'Bold and italic link Second paragraph')
        self.assertEqual(
            latest['html'],
            '<p><strong>Bold</strong> and <em>italic</em> <a href="https://example.test/update" target="_blank" rel="noopener noreferrer">link</a></p><p>Second paragraph</p>',
        )

    def test_container_id_uses_ari_prefix(self):
        self.assertEqual(
            _container_id_from_cloud('cloud-123'),
            'ari:cloud:townsquare::site/cloud-123',
        )

    def test_build_home_project_record_keeps_metadata_without_jira_linkage(self):
        project = build_home_project_record(
            {
                'id': 'tsq-1',
                'name': 'Synthetic Launch',
                'url': 'https://home.atlassian.com/projects/tsq-1',
                'stateValue': 'PAUSED',
                'stateLabel': 'Paused',
                'iconEmoji': '🚀',
                'targetDate': {'startDate': '2026-04-01', 'endDate': '2026-06-30'},
                'owner': {'accountId': 'owner-1', 'name': 'Ada Lovelace'},
            },
            [{'creationDate': '2026-04-12T10:00:00.000Z', 'summary': 'Awaiting budget approval'}],
            {},
        )
        self.assertEqual(project['tabBucket'], 'backlog')
        self.assertEqual(project['matchState'], 'metadata-only')
        self.assertEqual(project['latestUpdateDate'], '2026-04-12')
        self.assertEqual(project['latestUpdateSnippet'], 'Awaiting budget approval')
        self.assertEqual(project['latestUpdateAuthor'], '')
        self.assertEqual(project['iconEmoji'], '🚀')
        self.assertEqual(project['targetDate'], '2026-04-01')
        self.assertEqual(project['targetDateStart'], '2026-04-01')
        self.assertEqual(project['targetDateEnd'], '2026-06-30')
        self.assertEqual(project['ownerAccountId'], 'owner-1')
        self.assertEqual(project['ownerName'], 'Ada Lovelace')

    def test_build_home_project_record_keeps_string_home_tags_from_fetcher(self):
        project = build_home_project_record(
            {
                'id': 'CRITE-723',
                'name': 'Enriched Deals Redesign',
                'url': 'https://home.atlassian.com/project/CRITE-723',
                'stateValue': 'PENDING',
                'stateLabel': 'Pending',
            },
            [],
            {},
            home_tags=['rnd_project_bsw_enriched_deals_redesign'],
        )

        self.assertEqual(project['homeTags'], ['rnd_project_bsw_enriched_deals_redesign'])

    def test_extract_tag_names_normalizes_direct_and_cypher_tag_shapes(self):
        tags = extract_tag_names([
            {'name': ' rnd_project_alpha '},
            {'node': {'name': 'rnd_project_beta'}},
            {'data': {'name': 'rnd_project_gamma'}},
            {'data': {'__typename': 'AtlassianHomeTag', 'name': 'rnd_project_delta'}},
            {'name': 'rnd_project_alpha'},
            {'name': ''},
            'ignored',
        ])

        self.assertEqual(tags, [
            'rnd_project_alpha',
            'rnd_project_beta',
            'rnd_project_gamma',
            'rnd_project_delta',
        ])


class ProviderResponse:
    status = 200

    def __init__(self, document):
        self.document = document

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.document).encode()


class TestEpmHomeOAuthContracts(unittest.TestCase):
    def setUp(self):
        set_up_db_oauth(self)
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'synthetic-home-secret'
        self.browser = jira_server.app.test_client()
        cookie = install_oauth_session(self.browser, account_id='home-reader',
            cloudid='cloud-123', site_url='https://example.atlassian.net',
            scope=FULL_OAUTH_SCOPE + ' ' + ' '.join(epm_home.EPM_HOME_READ_SCOPES))
        with jira_server.app.test_request_context('/'):
            flask_session['db_oauth_session'] = cookie
            self.context = jira_server.current_request_auth_context()
        self.auth = epm_home.HomeReadAuth(epm_home.HOME_READ_PROFILE_PUBLIC_READ_V1, self.context,
            revalidate=lambda context: revalidate_db_request_auth_context(
                context, required_scopes=' '.join(epm_home.EPM_HOME_READ_SCOPES)),
            load_session=jira_server.db_oauth_session_data_for_auth_context)
        self.client = self.auth.client()
        epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
        self.addCleanup(epm_home._STRICT_GOAL_LOOKUP_CACHE.clear)
        self.calls = []

    def provider(self, responder):
        def transport(request, timeout):
            self.assertEqual(request.full_url, epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT)
            self.assertEqual(request.get_method(), 'POST')
            self.assertTrue(request.get_header('Authorization').startswith('Bearer '))
            document = json.loads(request.data)
            self.calls.append(document)
            return ProviderResponse(responder(document['operationName'], document.get('variables', {})))
        return patch.object(epm_home, 'urlopen', side_effect=transport)

    @staticmethod
    def connection(nodes, *, after=None, more=False):
        return {'pageInfo': {'hasNextPage': more, 'endCursor': after},
                'edges': [{'node': node} for node in nodes]}

    @staticmethod
    def project(index, *, paused=False):
        return {'id': f'project-{index}', 'key': f'PROJECT-{index}', 'name': f'Project {index}',
            'url': f'https://home.example.test/project/{index}',
            'state': {'label': 'Paused' if paused else 'On track', 'value': 'PAUSED' if paused else 'ON_TRACK'},
            'tags': {'edges': [{'node': {'name': f'rnd_project_{index}'}}]},
            'updates': {'edges': [{'node': {'creationDate': '2026-04-12T10:00:00Z', 'summary': f'Latest {index}'}}]}}

    def test_cloud_id_comes_from_validated_actor_without_tenant_info_or_env_fallback(self):
        with patch.dict('os.environ', {'JIRA_URL': 'https://ignored.example.test/'}), \
             patch.object(epm_home, 'urlopen', side_effect=AssertionError('tenant_info HTTP')) as transport:
            self.assertEqual(epm_home.fetch_home_site_cloud_id(self.context, self.auth), 'cloud-123')
            self.assertEqual(epm_home.fetch_home_site_cloud_id(self.context, self.auth), 'cloud-123')
            transport.assert_not_called()

    def test_unbound_home_reads_reject_without_service_credentials_or_network(self):
        with patch.dict('os.environ', {'JIRA_AUTH_MODE': 'basic', 'JIRA_EMAIL': 'synthetic@example.test',
                    'JIRA_TOKEN': 'synthetic-token', 'ATLASSIAN_EMAIL': 'service@example.test',
                    'ATLASSIAN_API_TOKEN': 'synthetic-service-token'}), \
             patch.object(epm_home, 'urlopen', side_effect=AssertionError('retired transport')) as transport:
            for invoke in (lambda: epm_home.fetch_home_site_cloud_id(),
                           lambda: epm_home.fetch_epm_home_projects({'subGoalKey': 'CHILD-200'})):
                with self.assertRaises(AuthError):
                    invoke()
            transport.assert_not_called()
        self.assertFalse(hasattr(epm_home, 'HomeGraphQLClient'))
        self.assertFalse(hasattr(epm_home, 'build_home_graphql_client'))
        self.assertFalse(hasattr(epm_home, 'build_teamwork_graph_client'))

    def test_home_projects_requires_scope_argument(self):
        with self.assertRaises(TypeError):
            epm_home.fetch_epm_home_projects()

    def test_missing_and_malformed_scope_returns_empty_before_auth_or_provider(self):
        for scope in ({}, 'bad-scope', {'subGoalKey': ['CHILD-200']}, {'subGoalKeys': [42]}):
            with self.subTest(scope=scope), patch.object(epm_home, 'urlopen') as transport, \
                 patch.object(epm_home.logger, 'warning') as warning:
                self.assertEqual(epm_home.fetch_epm_home_projects(scope), [])
                warning.assert_called_once_with('EPM home fetch skipped: subGoalKeys is required')
                transport.assert_not_called()

    def test_goal_by_key_is_case_insensitive_and_precedes_search(self):
        goal = {'id': 'goal-root', 'key': '  ROOT-100 ', 'name': 'Root'}
        with self.provider(lambda operation, variables: {'data': {'goals_byKey': goal}}):
            found = epm_home.resolve_goal_by_key(self.client, 'root-100', 'container-1')
        self.assertEqual(found, goal)
        self.assertEqual([call['operationName'] for call in self.calls], ['GoalByKey'])
        self.assertEqual(self.calls[0]['variables'], {'containerId': 'container-1', 'goalKey': 'ROOT-100'})

    def test_goal_lookup_falls_back_to_registered_paginated_search_for_missing_key(self):
        goal = {'id': 'goal-child', 'key': ' child-200 ', 'name': 'Child'}
        def responder(operation, variables):
            if operation == 'GoalByKey':
                return {'data': {'goals_byKey': None}}
            self.assertEqual(operation, 'GoalsSearch')
            return {'data': {'goals_search': self.connection([goal])}}
        with self.provider(responder):
            self.assertEqual(epm_home.resolve_goal_by_key(self.client, 'CHILD-200', 'container-1'), goal)
        self.assertEqual(len(self.calls), 2)

    def test_sub_goals_exclude_archived_and_keep_documented_public_identity_omission(self):
        def responder(operation, variables):
            if operation == 'GoalByKey':
                return {'data': {'goals_byKey': {'id': 'root', 'key': 'ROOT-100'}}}
            self.assertEqual(operation, 'SubGoals')
            return {'data': {'goals_byId': {'subGoals': self.connection([
                {'id': 'child', 'key': 'CHILD-200'},
                {'id': 'archived', 'key': 'OLD-999', 'isArchived': True}])}}}
        with self.provider(responder):
            found = epm_home.fetch_sub_goals_for_root_key(self.client, 'ROOT-100', 'container-1')
        self.assertEqual([row['id'] for row in found], ['child'])
        query = self.calls[-1]['query']
        self.assertNotIn('owner', query)
        self.assertIn('archived: false', query)

    def test_projects_discover_descendants_dedupe_memberships_and_preserve_scope_order(self):
        goals = {'ROOT-100': {'id': 'root', 'key': 'ROOT-100'},
                 'CHILD-A': {'id': 'a', 'key': 'CHILD-A', 'name': 'Child A'},
                 'CHILD-B': {'id': 'b', 'key': 'CHILD-B', 'name': 'Child B'}}
        def responder(operation, variables):
            if operation == 'GoalByKey':
                return {'data': {'goals_byKey': goals[variables['goalKey']]}}
            if operation == 'SubGoals':
                children = {'root': [goals['CHILD-A'], goals['CHILD-B']],
                            'a': [{'id': 'grandchild', 'key': 'GRANDCHILD'}]}.get(variables['goalId'], [])
                return {'data': {'goals_byId': {'subGoals': self.connection(children)}}}
            self.assertEqual(operation, 'GoalProjects')
            projects = {'a': [self.project('shared')], 'b': [self.project('shared')],
                        'grandchild': [self.project('nested', paused=True)]}.get(variables['goalId'], [])
            return {'data': {'goals_byId': {'projects': self.connection(projects)}}}
        with self.provider(responder):
            found = epm_home.fetch_epm_home_projects(
                {'rootGoalKey': 'root-100', 'subGoalKeys': ['child-a', 'child-b', 'child-a']},
                context=self.context, home_auth=self.auth)
        self.assertEqual([row['homeProjectId'] for row in found], ['project-shared', 'project-nested'])
        self.assertEqual(found[0]['subGoalKeys'], ['CHILD-A', 'CHILD-B'])
        self.assertEqual(found[0]['subGoals'], [{'key': 'CHILD-A', 'name': 'Child A'}, {'key': 'CHILD-B', 'name': 'Child B'}])
        self.assertEqual(found[1]['subGoalKeys'], ['CHILD-A'])
        self.assertEqual(found[1]['tabBucket'], 'backlog')
        self.assertEqual(found[0]['homeTags'], ['rnd_project_shared'])
        self.assertEqual(found[0]['latestUpdateSnippet'], 'Latest shared')
        self.assertEqual({call['operationName'] for call in self.calls}, {'GoalByKey', 'SubGoals', 'GoalProjects'})

    def test_single_sub_goal_scope_without_root_uses_validated_cloud_and_enriched_rows(self):
        def responder(operation, variables):
            if operation == 'GoalByKey':
                self.assertEqual(variables['containerId'], 'ari:cloud:townsquare::site/cloud-123')
                return {'data': {'goals_byKey': {'id': 'child', 'key': 'CHILD-200'}}}
            if operation == 'SubGoals':
                return {'data': {'goals_byId': {'subGoals': self.connection([])}}}
            self.assertEqual(operation, 'GoalProjects')
            return {'data': {'goals_byId': {'projects': self.connection([self.project('single')])}}}
        with self.provider(responder):
            found = epm_home.fetch_epm_home_projects({'subGoalKey': 'child-200'}, home_auth=self.auth)
        self.assertEqual([row['homeProjectId'] for row in found], ['project-single'])
        self.assertEqual(found[0]['subGoalKeys'], ['CHILD-200'])
        self.assertEqual(len(self.calls), 3)

    def test_goal_project_pages_preserve_enrichment_and_order_without_per_project_fanout(self):
        nodes = [self.project('slow'), self.project('fast'), self.project('medium', paused=True)]
        build = epm_home._build_home_project_record_from_goal_row
        def delayed_build(row):
            if row['id'] == 'project-slow':
                time.sleep(0.03)
            return build(row)
        with self.provider(lambda operation, variables: {'data': {'goals_byId': {'projects': self.connection(nodes)}}}), \
             patch.object(epm_home, '_build_home_project_record_from_goal_row', side_effect=delayed_build):
            found = epm_home.fetch_projects_for_goal(self.client, 'goal-1')
        self.assertEqual([row['homeProjectId'] for row in found], [row['id'] for row in nodes])
        self.assertEqual(found[0]['latestUpdateSnippet'], 'Latest slow')
        self.assertEqual(found[0]['ownerName'], '')
        self.assertEqual(found[0]['latestUpdateAuthor'], '')
        self.assertEqual(found[2]['tabBucket'], 'backlog')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0]['operationName'], 'GoalProjects')
        for field in ('state', 'tags', 'updates'):
            self.assertIn(field, self.calls[0]['query'])
        for omitted in ('owner', 'creator'):
            self.assertNotIn(omitted, self.calls[0]['query'])

    def test_incomplete_goal_project_page_rejects_without_per_project_fallback(self):
        with self.provider(lambda operation, variables: {'data': {'goals_byId': {'projects': self.connection([{'id': 'incomplete'}])}}}):
            with self.assertRaises(epm_home.HomeReadError) as raised:
                epm_home.fetch_projects_for_goal(self.client, 'goal-1')
        self.assertEqual(raised.exception.category, 'invalid_response')
        self.assertEqual(len(self.calls), 1)

    def test_goal_project_pagination_reads_250_and_caps_500(self):
        for total, expected in ((250, 250), (550, 500)):
            self.calls.clear()
            def responder(operation, variables):
                self.assertEqual(operation, 'GoalProjects')
                start = int(variables['after'] or 0)
                end = min(total, start + 50)
                return {'data': {'goals_byId': {'projects': self.connection(
                    [self.project(index) for index in range(start, end)], after=str(end), more=end < total)}}}
            with self.subTest(total=total), self.provider(responder), patch.object(epm_home.logger, 'warning') as warning:
                found = epm_home.fetch_goal_project_links(self.client, 'goal-1')
                self.assertEqual(len(found), expected)
                self.assertEqual(found[-1]['id'], f'project-{expected-1}')
                self.assertEqual(len(self.calls), expected // 50)
                if total > expected:
                    warning.assert_called_once()
                    self.assertIn('truncated', warning.call_args.args[0])
                else:
                    warning.assert_not_called()
            for index, call in enumerate(self.calls):
                self.assertEqual(call['variables'], {'goalId': 'goal-1', 'first': 50, 'after': str(index*50) if index else None})

    def test_registered_pagination_stops_when_cursor_missing_or_unchanged(self):
        for cursor in (None, 'same'):
            self.calls.clear()
            def responder(operation, variables):
                return {'data': {'goals_search': self.connection([{'id': 'goal-1'}], after=cursor, more=True)}}
            with self.subTest(cursor=cursor), self.provider(responder):
                found = self.client.execute_paginated(epm_home.PUBLIC_READ_V1_REGISTRY['goals_search']['query'],
                    {'first': 1}, 'goals_search')
            self.assertEqual([row['id'] for row in found], ['goal-1'] * (2 if cursor else 1))
            self.assertEqual(len(self.calls), 2 if cursor else 1)

    def test_latest_update_fetch_requests_five_and_keeps_placeholder_rows_for_shaping(self):
        updates = [{'id': 'empty', 'summary': ''}, {'id': 'real', 'summary': 'Real update'}]
        with self.provider(lambda operation, variables: {'data': {'projects_byId': {'updates': self.connection(updates)}}}):
            found = epm_home.fetch_latest_project_update(self.client, 'project-1')
        self.assertEqual(found, updates)
        self.assertEqual(self.calls[0]['operationName'], 'ProjectUpdates')
        self.assertEqual(self.calls[0]['variables'], {'projectId': 'project-1', 'first': 5})

    def test_tags_use_direct_registered_read_and_never_teamwork_fallback(self):
        for tags in ([], [{'node': {'name': 'rnd_project_alpha'}}]):
            self.calls.clear()
            with self.subTest(tags=tags), self.provider(lambda operation, variables: {'data': {'projects_byId': {'tags': {'edges': tags}}}}):
                found = epm_home.fetch_project_tags(self.client, {'id': 'project-1'})
            self.assertEqual(found, ['rnd_project_alpha'] if tags else [])
            self.assertEqual(len(self.calls), 1)
            self.assertEqual(self.calls[0]['operationName'], 'ProjectTags')

    def test_provider_auth_failure_propagates_instead_of_empty_metadata_fallback(self):
        with patch.object(epm_home, 'urlopen', side_effect=HTTPError(
                epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT, 403, 'Forbidden', {}, None)) as transport:
            with self.assertRaises(epm_home.HomeReadError) as raised:
                epm_home.fetch_epm_home_projects({'subGoalKey': 'CHILD-200'}, home_auth=self.auth)
        self.assertEqual(raised.exception.category, 'access_denied')
        self.assertEqual(transport.call_count, 1)

    def test_execute_retries_429_using_retry_after_before_success(self):
        with patch.object(epm_home, 'time') as clock, patch.object(epm_home, 'urlopen', side_effect=[
                HTTPError(epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT, 429, 'Too Many Requests', {'Retry-After': '3'}, None),
                ProviderResponse({'data': {'goals_byKey': {'id': 'goal-1'}}})]) as transport:
            result = self.client.execute_operation('goals_byKey', {'containerId': 'container', 'goalKey': 'GOAL-1'})
        self.assertEqual(result.data['goals_byKey']['id'], 'goal-1')
        self.assertEqual(transport.call_count, 2)
        clock.sleep.assert_called_once_with(3)

    def test_unregistered_graphql_cannot_reach_provider(self):
        with patch.object(epm_home, 'urlopen') as transport:
            with self.assertRaises(epm_home.HomeReadError) as raised:
                self.client.execute('query Arbitrary { forbidden }')
        self.assertEqual(raised.exception.category, 'unregistered_operation')
        transport.assert_not_called()
