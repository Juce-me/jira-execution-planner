import unittest
from pathlib import Path

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestDashboardCssExtraction(unittest.TestCase):
    def setUp(self):
        self.client = jira_server.app.test_client()

    def test_dashboard_html_links_external_stylesheet(self):
        resp = self.client.get('/jira-dashboard.html')
        try:
            self.assertEqual(resp.status_code, 200)
            html = resp.get_data(as_text=True)
            self.assertIn('/frontend/dist/dashboard.css', html)
            self.assertNotIn('<style>', html)
            self.assertNotIn('</style>', html)
        finally:
            resp.close()

    def test_dashboard_css_asset_served(self):
        resp = self.client.get('/frontend/dist/dashboard.css')
        try:
            self.assertEqual(resp.status_code, 200)
            css = resp.get_data(as_text=True)
            self.assertIn(':root', css)
            self.assertIn('.container', css)
            self.assertIn('.compact-sticky-header', css)
            self.assertIn('.compact-sticky-header.is-visible', css)
            self.assertIn('--compact-header-offset', css)
            self.assertIn('--sticky-control-overlay-z', css)
            self.assertIn('--planning-sticky-top', css)
            self.assertIn('--epic-sticky-top', css)
            self.assertIn('--scenario-sticky-top', css)
        finally:
            resp.close()


class TestDashboardCssFileContract(unittest.TestCase):
    def test_dashboard_css_includes_compact_sticky_header_contract(self):
        css_path = Path(__file__).resolve().parents[1] / 'frontend' / 'dist' / 'dashboard.css'
        css = css_path.read_text(encoding='utf-8')
        self.assertIn('.compact-sticky-header', css)
        self.assertIn('.compact-sticky-header.is-visible', css)
        self.assertIn('--compact-header-offset', css)
        self.assertIn('--sticky-control-overlay-z', css)
        self.assertIn('--planning-sticky-top', css)
        self.assertIn('--epic-sticky-top', css)
        self.assertIn('--scenario-sticky-top', css)


if __name__ == '__main__':
    unittest.main()
