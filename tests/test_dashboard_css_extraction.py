import unittest
import re
from pathlib import Path

from tests.auth_mode_test_utils import force_basic_auth_mode

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


def _css_block(css, selector):
    match = re.search(r'(?m)^' + re.escape(selector) + r'\s*\{', css)
    if not match:
        raise AssertionError(f'CSS selector not found: {selector}')
    block_start = match.start()
    block_end = css.index('}', match.end()) + 1
    return css[block_start:block_end]


_IMPORT_RE = re.compile(r'@import\s+["\'](.+?)["\'];')


def _styles_dir():
    return Path(__file__).resolve().parents[1] / 'frontend' / 'src' / 'styles'


def _dashboard_css_imports():
    styles_dir = _styles_dir()
    entrypoint = styles_dir / 'dashboard.css'
    seen = set()
    ordered = []

    def visit(path, stack):
        resolved = path.resolve()
        relative = resolved.relative_to(styles_dir)
        if relative in stack:
            cycle = ' -> '.join(str(item) for item in [*stack, relative])
            raise AssertionError(f'CSS import cycle detected: {cycle}')
        if relative in seen:
            return
        seen.add(relative)
        ordered.append(relative)
        for imported in _IMPORT_RE.findall(path.read_text(encoding='utf-8')):
            visit((path.parent / imported).resolve(), [*stack, relative])

    visit(entrypoint, [])
    return ordered


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestDashboardCssExtraction(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
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

    def test_dashboard_js_source_map_asset_served_as_valid_json(self):
        resp = self.client.get('/frontend/dist/dashboard.js.map')
        try:
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.mimetype, 'application/json')
            source_map = resp.get_json()
            self.assertEqual(source_map.get('version'), 3)
            self.assertIsInstance(source_map.get('sources'), list)
            self.assertGreater(len(source_map.get('sources')), 0)
        finally:
            resp.close()


class TestDashboardCssFileContract(unittest.TestCase):
    def test_dashboard_css_source_exists_under_frontend_src_styles(self):
        css_path = _styles_dir() / 'dashboard.css'
        self.assertTrue(css_path.is_file())

    def test_dashboard_css_source_is_ordered_import_entrypoint(self):
        styles_dir = _styles_dir()
        entrypoint = styles_dir / 'dashboard.css'
        expected_imports = [
            'base.css',
            'settings.css',
            'eng.css',
            'stats-summary.css',
            'scenario.css',
            'stats.css',
            'planning.css',
            'epm.css',
        ]
        self.assertEqual(
            entrypoint.read_text(encoding='utf-8').splitlines(),
            [f'@import "./{filename}";' for filename in expected_imports],
        )
        for filename in expected_imports:
            self.assertTrue((styles_dir / filename).is_file(), filename)

    def test_dashboard_css_source_import_graph_includes_feature_partials(self):
        imported = {str(path) for path in _dashboard_css_imports()}
        expected_partials = {
            'shared/controls.css',
            'eng/issues.css',
            'eng/dependencies.css',
            'eng/subtasks.css',
            'planning/capacity.css',
            'planning/selection.css',
            'settings/team-groups.css',
            'settings/jira-fields.css',
            'stats/excluded-capacity.css',
            'stats/cohort.css',
            'scenario/timeline.css',
            'epm/project-board.css',
        }
        self.assertTrue(expected_partials.issubset(imported), sorted(expected_partials - imported))

    def test_dashboard_css_top_level_partials_stay_as_import_maps(self):
        styles_dir = _styles_dir()
        budgets = {
            'base.css': 750,
            'eng.css': 80,
            'settings.css': 80,
            'stats.css': 80,
            'scenario.css': 80,
            'planning.css': 80,
            'epm.css': 80,
        }
        for filename, max_lines in budgets.items():
            path = styles_dir / filename
            line_count = len(path.read_text(encoding='utf-8').splitlines())
            self.assertLessEqual(line_count, max_lines, f'{filename} has {line_count} lines')

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

    def test_epm_segmented_controls_and_update_lists_contract(self):
        css_path = Path(__file__).resolve().parents[1] / 'frontend' / 'dist' / 'dashboard.css'
        css = css_path.read_text(encoding='utf-8')
        self.assertIn('.segmented-control', css)
        self.assertIn('.segmented-control-button', css)
        self.assertIn('.segmented-control-button.active', css)
        self.assertIn('.epm-state-control', css)
        self.assertIn('.epm-project-board-update-copy ul,', css)
        self.assertIn('.epm-project-board-update-copy ol', css)
        self.assertIn('padding-left: 1.1rem;', css)

    def test_select_controls_share_rounded_control_shape(self):
        css_path = Path(__file__).resolve().parents[1] / 'frontend' / 'dist' / 'dashboard.css'
        css = css_path.read_text(encoding='utf-8')
        select_block = _css_block(css, 'select')
        self.assertIn('border-radius: 10px;', select_block)

    def test_epm_project_board_surface_and_update_reading_contract(self):
        css_path = Path(__file__).resolve().parents[1] / 'frontend' / 'dist' / 'dashboard.css'
        css = css_path.read_text(encoding='utf-8')
        self.assertNotIn('.epm-project-board::before', css)
        self.assertIn('.epm-project-board-body::before', css)
        board_block = _css_block(css, '.epm-project-board')
        self.assertIn('border: 1px solid var(--epm-project-border);', board_block)
        self.assertIn('border-radius: 8px;', board_block)
        self.assertIn('background: var(--epm-project-surface);', board_block)
        update_block = _css_block(css, '.epm-project-board-update')
        self.assertIn('max-width: 72ch;', update_block)
        self.assertIn('font-size: 0.9rem;', update_block)
        self.assertIn('background: #fbfcfe;', update_block)
        self.assertIn('border: 1px solid #e5ebf3;', update_block)
        self.assertIn('border-radius: 8px;', update_block)
        self.assertIn('box-shadow: none;', update_block)
        self.assertNotIn('.epm-project-board-update-row.is-collapsed', css)
        self.assertNotIn('.epm-project-board-link', css)
        self.assertIn('.epm-project-board-rollup-control', css)
        self.assertIn('.epm-project-board-name-link', css)
        self.assertIn('.epm-project-board-home-icon', css)
        self.assertIn('.epm-project-board-target-date', css)
        self.assertIn('.epm-project-board-owner-avatar', css)
        self.assertIn('.epm-project-board-status-pill.task-status', css)
        self.assertIn('.epm-project-board-title-meta', css)
        self.assertIn('justify-self: end;', _css_block(css, '.epm-project-board-title-meta'))
        self.assertNotIn('background-image:', update_block)
        self.assertNotIn('rgba(190, 128, 71', update_block)


if __name__ == '__main__':
    unittest.main()
