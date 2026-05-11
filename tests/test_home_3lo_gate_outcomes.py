import unittest

from backend.auth.project_access import home_3lo_gate_mode


class TestHome3loGateOutcomes(unittest.TestCase):
    def test_pass_uses_db_auth_boundary(self):
        mode = home_3lo_gate_mode({'decision': 'pass', 'reason': 'home_graphql_3lo_supported'})

        self.assertEqual(mode, 'db_auth_boundary')

    def test_fail_keeps_routes_service_integration_scoped(self):
        mode = home_3lo_gate_mode({'decision': 'fail', 'reason': 'home_graphql_3lo_unsupported'})

        self.assertEqual(mode, 'service_integration_scoped')


if __name__ == '__main__':
    unittest.main()
