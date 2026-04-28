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
        self.assertIn('.compact-sticky-header-controls', css)
        self.assertIn('overflow: visible;', css)
        self.assertIn('.team-dropdown-panel label.team-dropdown-option', css)
        self.assertNotIn('.view-selector .team-dropdown-panel label.team-dropdown-option', css)
        self.assertIn('.sprint-dropdown-panel', css)
        self.assertIn('.group-dropdown-panel', css)
        self.assertIn('.sprint-dropdown-option + .sprint-dropdown-option', css)
        self.assertIn('.group-dropdown-option + .group-dropdown-option', css)
        self.assertIn('.compact-sticky-header .sprint-dropdown,', css)
        self.assertIn('max-width: 170px;', css)
        self.assertIn('max-width: 210px;', css)
        self.assertIn('width: 100%;', css)
        self.assertIn('min-width: 100%;', css)
        self.assertIn('.project-bar-fill:hover', css)
        self.assertIn('z-index: 50;', css)
        self.assertIn('.microbar', css)
        self.assertIn('height: 14px;', css)
        self.assertIn('--compact-header-offset', css)
        self.assertIn('--sticky-control-overlay-z', css)
        self.assertIn('--planning-sticky-top', css)
        self.assertIn('--epic-sticky-top', css)
        self.assertIn('--scenario-sticky-top', css)

    def test_epm_settings_projects_layout_contract(self):
        css_path = Path(__file__).resolve().parents[1] / 'frontend' / 'dist' / 'dashboard.css'
        css = css_path.read_text(encoding='utf-8')
        self.assertIn('.epm-settings-tab-panel', css)
        self.assertIn('.epm-projects-tab-panel', css)
        self.assertIn('.epm-projects-scroll-region', css)
        self.assertIn('min-height: 0;', css)
        self.assertIn('overflow-y: auto;', css)
        self.assertIn('.epm-projects-header-actions', css)
        self.assertIn('.epm-prerequisite-panel', css)
        self.assertIn('.epm-project-skeleton-row', css)
        self.assertIn('.epm-project-load-error', css)
        self.assertIn('.epm-project-row-warning', css)
        self.assertIn('.epm-label-menu-layer', css)


if __name__ == '__main__':
    unittest.main()
