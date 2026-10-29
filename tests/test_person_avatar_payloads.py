import unittest

import jira_server

HOST = 'avatar-management--avatars.us-west-2.prod.public.atl-paas.net'
PHOTO = f'https://{HOST}/712020:00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/32'


def user(**avatar_urls):
    return {'accountId': 'acc-1', 'displayName': 'Ada Example', 'avatarUrls': avatar_urls}


class ShapeJiraPersonTests(unittest.TestCase):
    def test_default_shape_is_unchanged(self):
        self.assertEqual(jira_server.shape_jira_person(user(**{'32x32': PHOTO})),
                         {'accountId': 'acc-1', 'displayName': 'Ada Example'})

    def test_avatar_uses_only_the_32x32_size(self):
        self.assertEqual(jira_server.shape_jira_person(user(**{'32x32': PHOTO}), avatar=True),
                         {'accountId': 'acc-1', 'displayName': 'Ada Example', 'avatarUrl': PHOTO})
        for avatar_urls in ({'48x48': PHOTO}, {}, {'32x32': 'https://secure.gravatar.com/avatar/0?d=x'},
                            {'32x32': f'https://{HOST}/initials/AE-0.png'}, {'32x32': 7}):
            with self.subTest(avatar_urls=avatar_urls):
                self.assertEqual(jira_server.shape_jira_person(user(**avatar_urls), avatar=True),
                                 {'accountId': 'acc-1', 'displayName': 'Ada Example'})

    def test_malformed_input(self):
        for value in (None, 'text', 7, []):
            self.assertIsNone(jira_server.shape_jira_person(value, avatar=True))
        self.assertNotIn('avatarUrl', jira_server.shape_jira_person({'accountId': 'a', 'avatarUrls': 'x'}, avatar=True))

    def test_epm_slim_payload_adds_avatar_only_when_allowlisted(self):
        def issue(assignee):
            return {'key': 'X-1', 'fields': {'summary': 's', 'assignee': assignee}}
        slim, _ = jira_server.shape_epm_issue_payload([
            issue(user(**{'32x32': PHOTO})), issue(user(**{'32x32': 'https://evil.example.test/a'})), issue(None)])
        self.assertEqual(slim[0]['assignee'], 'Ada Example')
        self.assertEqual(slim[0]['assigneeAvatarUrl'], PHOTO)
        self.assertNotIn('assigneeAvatarUrl', slim[1])
        self.assertNotIn('assigneeAvatarUrl', slim[2])

    def test_cache_version_changed_so_old_payloads_are_not_served(self):
        self.assertNotEqual(jira_server.TASKS_CACHE_SCHEMA_VERSION, 'v3-team-label-aliases')


if __name__ == '__main__':
    unittest.main()
