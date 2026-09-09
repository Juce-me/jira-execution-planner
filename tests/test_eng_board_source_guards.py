import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class EngBoardFrontendIntegrationSourceGuards(unittest.TestCase):
    def test_config_capability_is_explicit_and_fail_closed(self):
        source = (ROOT / 'backend/routes/settings_routes.py').read_text(encoding='utf-8')
        self.assertIn("'boardAllWorkAvailable': eng_board.strict_adapter_available(", source)
        self.assertIn('database_backed=is_db_auth_context(auth_context) and config_storage_db_enabled()', source)

    def test_dashboard_has_one_server_derived_strict_board_seam(self):
        source = (ROOT / 'frontend/src/dashboard.jsx').read_text(encoding='utf-8')
        integration = (ROOT / 'frontend/src/eng/useStrictEngBoardIntegration.js').read_text(encoding='utf-8')
        self.assertIn('config.boardAllWorkAvailable === true', source)
        self.assertIn('const strictBoardActive =', source)
        self.assertIn('useEngBoardData({', integration)
        self.assertIn('buildStrictEngBoardViewModel(', integration)
        self.assertIn('streamEngBoard({ backendUrl, ...options })', integration)
        self.assertIn('const [boardAllWorkAvailable, setBoardAllWorkAvailable] = useState(null);', source)
        self.assertIn('if (strictBoardActive || (showBoard && boardAllWorkAvailable === null)) return;', source)

    def test_strict_board_export_uses_authoritative_canonical_work_items(self):
        source = (ROOT / 'frontend/src/dashboard.jsx').read_text(encoding='utf-8')
        integration = (ROOT / 'frontend/src/eng/useStrictEngBoardIntegration.js').read_text(encoding='utf-8')
        self.assertIn('activeJiraExportWorkItemKeys', source)
        self.assertIn('workItemKeys={strictBoardActive ? activeJiraExportWorkItemKeys : undefined}', source)
        self.assertIn('model.childrenAuthoritative', integration)

    def test_strict_board_mutations_refresh_owner_not_legacy_sprint_stores(self):
        source = (ROOT / 'frontend/src/dashboard.jsx').read_text(encoding='utf-8')
        integration = (ROOT / 'frontend/src/eng/useStrictEngBoardIntegration.js').read_text(encoding='utf-8')
        self.assertIn('refreshAfterStrictBoardMutation', source)
        self.assertIn('strictEngBoardMutationProps', source)
        self.assertIn('if (active) await refresh()', integration)

    def test_strict_board_records_one_operational_and_accepted_terminal_result(self):
        source = (ROOT / 'frontend/src/eng/useStrictEngBoardIntegration.js').read_text(encoding='utf-8')
        self.assertIn('createMeasurement', source)
        self.assertIn('recordPerformanceLoad(backendUrl, sample)', source)
        self.assertIn('isAcceptedBoardTerminalSample(sample)', source)
        self.assertIn("trackApiResult('eng_board'", source)


if __name__ == '__main__':
    unittest.main()
