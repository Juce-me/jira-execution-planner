from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class ScenarioDraftSecuritySourceGuardTests(unittest.TestCase):
    def test_draft_service_and_routes_do_not_reference_credential_sources(self):
        forbidden = (
            'OAUTH_TOKEN_STORE',
            'oauth_session_data',
            'save_oauth_session',
            'resolve_home_credential',
            'home_townsquare_basic',
            'jira_basic',
            'atlassian_user_api_token',
            'jira_get',
            'jira_post',
            'jira_request',
            'current_jira_request',
            'current_jira_get',
            'current_jira_search',
            'jira_search_request',
        )
        paths = [
            REPO_ROOT / 'backend' / 'scenario_drafts.py',
            REPO_ROOT / 'backend' / 'routes' / 'scenario_draft_routes.py',
        ]

        for path in paths:
            source = path.read_text(encoding='utf-8')
            for token in forbidden:
                with self.subTest(path=str(path), token=token):
                    self.assertNotIn(token, source)


if __name__ == '__main__':
    unittest.main()
