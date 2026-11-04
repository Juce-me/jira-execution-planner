import unittest
from unittest.mock import patch

import jira_server
from backend.routes import settings_routes
from backend.auth.jira_auth import AuthError
from tests.test_work_structure_routes import WorkStructureRouteBase, jira_response

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 24
TYPE_PATH = '/rest/api/3/issuetype/10000'
AVATAR_PATH = '/rest/api/3/universal_avatar/view/type/issuetype/avatar/10307'


def image_response(status=200, content=PNG, content_type='image/png'):
    response = jira_response(status)
    response.content = content
    response.headers = {'Content-Type': content_type}
    return response


class IssueTypeIconRouteTests(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        settings_routes.ISSUE_TYPE_ICON_CACHE.clear()
        self.addCleanup(settings_routes.ISSUE_TYPE_ICON_CACHE.clear)

    def fetcher(self, type_body=None, avatar=None):
        calls = []

        def fetch(path, **kwargs):
            calls.append((path, kwargs))
            if path == TYPE_PATH:
                return jira_response(200, type_body or {'id': '10000', 'name': 'Epic', 'avatarId': 10307})
            if path == AVATAR_PATH:
                return avatar or image_response()
            raise AssertionError(f'unexpected Jira read {path}')
        return fetch, calls

    def test_serves_the_type_png_read_with_the_viewer_jira_context(self):
        fetch, calls = self.fetcher()
        with patch.object(jira_server, 'current_jira_get', side_effect=fetch):
            response = self.member.get('/api/issue-type-icon/10000')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'image/png')
        self.assertEqual(response.data, PNG)
        self.assertEqual([path for path, _ in calls], [TYPE_PATH, AVATAR_PATH])
        avatar_kwargs = calls[1][1]
        self.assertEqual(avatar_kwargs['params'], {'format': 'png', 'size': 'medium'})
        self.assertEqual(avatar_kwargs['accept'], 'image/png')

    def test_a_cached_icon_needs_no_jira_read_for_the_same_viewer(self):
        fetch, calls = self.fetcher()
        with patch.object(jira_server, 'current_jira_get', side_effect=fetch):
            self.member.get('/api/issue-type-icon/10000')
            again = self.member.get('/api/issue-type-icon/10000')
        self.assertEqual((again.status_code, again.data), (200, PNG))
        self.assertEqual(len(calls), 2)

    def test_the_cache_is_partitioned_by_viewer(self):
        fetch, calls = self.fetcher()
        with patch.object(jira_server, 'current_jira_get', side_effect=fetch):
            self.member.get('/api/issue-type-icon/10000')
            self.client.get('/api/issue-type-icon/10000')
        self.assertEqual(len(calls), 4)

    def test_a_malformed_type_id_is_400_without_jira_io(self):
        with patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('Jira I/O')):
            for type_id in ('abc', '10000x', '1' * 19):
                response = self.member.get(f'/api/issue-type-icon/{type_id}')
                self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_issue_type_id'), type_id)

    def test_anything_but_a_small_png_is_404_and_never_cached(self):
        cases = {
            'type missing': dict(type_body={'errorMessages': ['SECRET']}),
            'no avatar id': dict(type_body={'id': '10000', 'name': 'Epic', 'iconUrl': 'https://one.example.test/images/epic.svg'}),
            'boolean avatar id': dict(type_body={'id': '10000', 'name': 'Epic', 'avatarId': True}),
            'svg body': dict(avatar=image_response(content=b'<svg onload="SECRET"/>', content_type='image/svg+xml')),
            'png type, other bytes': dict(avatar=image_response(content=b'<svg onload="SECRET"/>')),
            'oversize': dict(avatar=image_response(content=PNG + b'\x00' * (64 * 1024))),
            'upstream error': dict(avatar=image_response(status=500, content=b'SECRET')),
        }
        for label, kwargs in cases.items():
            fetch, calls = self.fetcher(**kwargs)
            with patch.object(jira_server, 'current_jira_get', side_effect=fetch):
                response = self.member.get('/api/issue-type-icon/10000')
            self.assertEqual((response.status_code, response.get_json()['error']), (404, 'issue_type_icon_unavailable'), label)
            self.assertNotIn('SECRET', response.get_data(as_text=True), label)
            self.assertEqual(settings_routes.ISSUE_TYPE_ICON_CACHE, {}, label)

    def test_a_jira_read_failure_is_404_without_detail(self):
        with patch.object(jira_server, 'current_jira_get', side_effect=RuntimeError('SECRET boom')):
            response = self.member.get('/api/issue-type-icon/10000')
        self.assertEqual(response.status_code, 404)
        self.assertNotIn('SECRET', response.get_data(as_text=True))

    def test_an_expired_sign_in_is_the_terminal_401(self):
        with patch.object(jira_server, 'current_jira_get', side_effect=AuthError('auth_required', 'x')):
            response = self.member.get('/api/issue-type-icon/10000')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')


if __name__ == '__main__':
    unittest.main()
