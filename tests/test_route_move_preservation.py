import unittest

import jira_server


IGNORED_METHODS = {"HEAD", "OPTIONS"}
EXPECTED_MOVED_ROUTE_METHODS = {
    "/api/scenario": {"GET", "POST"},
    "/api/scenario/overrides": {"GET", "POST"},
    "/api/stats": {"GET"},
    "/api/stats/burnout": {"GET", "POST"},
    "/api/stats/epic-cohort": {"POST"},
    "/api/stats/excluded-capacity-source": {"POST"},
    "/api/capacity": {"GET"},
    "/api/planned-capacity": {"GET"},
    "/api/export-excel": {"POST"},
    "/api/test": {"GET"},
    "/api/debug-fields": {"GET"},
    "/api/tasks-fields": {"GET"},
}


class RouteMovePreservationTests(unittest.TestCase):
    def test_moved_route_urls_and_methods_stay_registered(self):
        actual = {}
        for rule in jira_server.app.url_map.iter_rules():
            methods = {method for method in rule.methods if method not in IGNORED_METHODS}
            actual.setdefault(rule.rule, set()).update(methods)

        missing = {}
        wrong_methods = {}
        for route, expected_methods in EXPECTED_MOVED_ROUTE_METHODS.items():
            if route not in actual:
                missing[route] = sorted(expected_methods)
            elif actual[route] != expected_methods:
                wrong_methods[route] = {"expected": sorted(expected_methods), "actual": sorted(actual[route])}

        self.assertEqual(missing, {})
        self.assertEqual(wrong_methods, {})
