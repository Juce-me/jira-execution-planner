import re
import unittest
from pathlib import Path

from backend.security.avatar_urls import AVATAR_HOSTS, sanitize_avatar_url
from backend.security.headers import _content_security_policy

REPO_ROOT = Path(__file__).resolve().parents[1]
HOST = 'avatar-management--avatars.us-west-2.prod.public.atl-paas.net'
GOOD = f'https://{HOST}/712020:00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/48'


class SanitizeAvatarUrlTests(unittest.TestCase):
    def test_accepts_allowlisted_https_photo(self):
        self.assertEqual(sanitize_avatar_url(GOOD), GOOD)

    def test_rejects_everything_else(self):
        cases = {
            'javascript': 'javascript:alert(1)',
            'data': 'data:image/png;base64,AAAA',
            'http': f'http://{HOST}/a/48',
            'protocol relative': f'//{HOST}/a/48',
            'foreign host': 'https://evil.example.test/a/48',
            'userinfo': f'https://{HOST}@evil.example.test/a/48',
            'userinfo on allowed': f'https://user@{HOST}/a/48',
            'suffix lookalike': f'https://{HOST}.evil.example.test/a/48',
            'prefix lookalike': f'https://evil.{HOST}/a/48',
            'port': f'https://{HOST}:8443/a/48',
            'uppercase host': f'https://{HOST.upper()}/a/48',
            'trailing dot host': f'https://{HOST}./a/48',
            'gravatar': 'https://secure.gravatar.com/avatar/00000000000000000000000000000000?d=x',
            'initials default': f'https://{HOST}/initials/AB-0.png',
            'backslash': f'https://{HOST}\\@evil.example.test/a/48',
            'whitespace': f'https://{HOST}/a b/48',
            'newline': f'https://{HOST}/a\n/48',
            'empty': '',
            'oversized': f'https://{HOST}/' + 'a' * 3000,
        }
        for name, value in cases.items():
            with self.subTest(name):
                self.assertIsNone(sanitize_avatar_url(value))

    def test_rejects_non_strings(self):
        for value in (None, 7, {}, [], b'https://x'):
            with self.subTest(value=repr(value)):
                self.assertIsNone(sanitize_avatar_url(value))

    def test_host_set_is_exact_lowercase_hostnames_without_gravatar_or_wildcards(self):
        self.assertTrue(AVATAR_HOSTS)
        for host in AVATAR_HOSTS:
            self.assertEqual(host, host.lower())
            self.assertNotIn('*', host)
            self.assertNotIn('gravatar', host)
            self.assertTrue(host.endswith('.atl-paas.net'))


class AvatarCspTests(unittest.TestCase):
    def test_img_src_is_built_from_the_shared_host_set(self):
        directives = {part.strip().split(' ', 1)[0]: part.strip() for part in _content_security_policy().split(';')}
        sources = directives['img-src'].split()[1:]
        for host in AVATAR_HOSTS:
            self.assertIn(f'https://{host}', sources)
        self.assertNotIn('https:', sources)
        self.assertFalse([s for s in sources if 'gravatar' in s])
        extra = {s for s in sources if s.startswith('https://') and s[8:] in AVATAR_HOSTS}
        self.assertEqual(extra, {f'https://{h}' for h in AVATAR_HOSTS})


class AvatarSourceGuardTests(unittest.TestCase):
    # Not rendered anywhere: the Board stream validates the string and the dashboard never draws it.
    UNRENDERED_PRODUCERS = {'backend/services/eng_board.py', 'backend/services/eng_board_stream.py'}
    # Only the empty-string default for ownerAvatarUrl; the real value is sanitized in backend/epm/home.py.
    FRONTEND_CHECKED_PRODUCERS = {'backend/epm/projects.py'}

    def test_every_avatar_producer_calls_the_sanitizer(self):
        offenders = []
        files = [REPO_ROOT / 'jira_server.py'] + sorted((REPO_ROOT / 'backend').rglob('*.py'))
        skip = self.UNRENDERED_PRODUCERS | self.FRONTEND_CHECKED_PRODUCERS | {'backend/security/avatar_urls.py'}
        for path in files:
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel in skip:
                continue
            text = path.read_text(encoding='utf-8')
            if re.search(r"['\"](assignee|owner)?[aA]vatarUrl['\"]", text) and 'sanitize_avatar_url' not in text:
                offenders.append(rel)
        self.assertEqual(offenders, [])

    def test_only_person_avatar_renders_a_remote_person_image(self):
        offenders = []
        for path in sorted((REPO_ROOT / 'frontend' / 'src').rglob('*.jsx')):
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel.endswith('ui/PersonAvatar.jsx'):
                continue
            for line in path.read_text(encoding='utf-8').splitlines():
                if '<img' in line and re.search(r'[aA]vatar|photo|picture', line):
                    offenders.append(rel)
        self.assertEqual(offenders, [])

    def test_person_avatar_host_list_matches_backend_constant(self):
        source = (REPO_ROOT / 'frontend' / 'src' / 'ui' / 'avatarHosts.js').read_text(encoding='utf-8')
        hosts = set(re.findall(r"'([a-z0-9.-]+)'", source))
        self.assertEqual(hosts, set(AVATAR_HOSTS))


if __name__ == '__main__':
    unittest.main()
