import unittest

import jira_server


IGNORED_ENDPOINTS = {"static"}
IGNORED_METHODS = {"HEAD", "OPTIONS"}

# Paths declared in backend/security/policy.py ahead of their Flask route
# registration, e.g. when a plan lands the endpoint policy in one task and the
# route itself in a later task. Remove each entry as soon as its route is
# registered; test_policy_only_routes_pending_implementation_have_no_registered_rule
# fails if an entry is left behind after that happens.
POLICY_ONLY_ROUTES_PENDING_IMPLEMENTATION = set()


class EndpointPolicyInventoryTests(unittest.TestCase):
    def route_methods(self, rule):
        return sorted(method for method in rule.methods if method not in IGNORED_METHODS)

    def test_every_non_static_route_method_has_exactly_one_security_policy(self):
        from backend.security.policy import matching_policies

        ambiguous = []
        missing = []
        for rule in jira_server.app.url_map.iter_rules():
            if rule.endpoint in IGNORED_ENDPOINTS:
                continue
            for method in self.route_methods(rule):
                matches = matching_policies(rule.rule, [method], rule.endpoint)
                if not matches:
                    missing.append({"rule": rule.rule, "method": method, "endpoint": rule.endpoint})
                elif len(matches) > 1:
                    ambiguous.append({
                        "rule": rule.rule,
                        "method": method,
                        "endpoint": rule.endpoint,
                        "policies": [policy.name for policy in matches],
                    })

        self.assertEqual(missing, [])
        self.assertEqual(ambiguous, [])

    def test_no_duplicate_route_method_registrations(self):
        seen = {}
        duplicates = []
        for rule in jira_server.app.url_map.iter_rules():
            if rule.endpoint in IGNORED_ENDPOINTS:
                continue
            for method in self.route_methods(rule):
                key = (rule.rule, method)
                if key in seen:
                    duplicates.append({
                        "rule": rule.rule,
                        "method": method,
                        "firstEndpoint": seen[key],
                        "secondEndpoint": rule.endpoint,
                    })
                else:
                    seen[key] = rule.endpoint

        self.assertEqual(duplicates, [])

    def test_policy_names_are_unique(self):
        from backend.security.policy import ENDPOINT_POLICIES

        names = [policy.name for policy in ENDPOINT_POLICIES]
        self.assertEqual(sorted(names), sorted(set(names)))

    def test_analytics_context_route_has_exactly_one_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/analytics/context", ["GET"], "analytics_routes.analytics_context")

        self.assertEqual([policy.name for policy in matches], ["analytics-context"])
        self.assertEqual(matches[0].policy_class, "public_context")

    def test_story_subtasks_route_has_authenticated_read_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/subtasks", ["GET"], "eng_routes.get_story_subtasks")

        self.assertEqual([policy.name for policy in matches], ["eng-api-story-subtasks"])
        self.assertEqual(matches[0].policy_class, "authenticated_read")

    def test_issue_transition_options_route_has_authenticated_read_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/transitions/options", ["POST"], "eng_routes.get_issue_transition_options")

        self.assertEqual([policy.name for policy in matches], ["jira-issue-transition-options"])
        self.assertEqual(matches[0].policy_class, "authenticated_read")

    def test_issue_transitions_write_route_has_user_write_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/transitions", ["POST"], "eng_routes.post_issue_transitions")

        self.assertEqual([policy.name for policy in matches], ["jira-issue-transitions-write"])
        self.assertEqual(matches[0].policy_class, "user_write")

    def test_issue_priority_options_route_has_authenticated_read_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/priorities/options", ["GET"], "eng_routes.get_issue_priority_options")

        self.assertEqual([policy.name for policy in matches], ["jira-issue-priority-options"])
        self.assertEqual(matches[0].policy_class, "authenticated_read")

    def test_issue_priorities_write_route_has_user_write_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/priorities", ["POST"], "eng_routes.post_issue_priorities")

        self.assertEqual([policy.name for policy in matches], ["jira-issue-priorities-write"])
        self.assertEqual(matches[0].policy_class, "user_write")

    def test_project_track_options_route_has_authenticated_read_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/project-track/options", ["GET"], "eng_routes.get_issue_project_track_options")

        self.assertEqual([policy.name for policy in matches], ["jira-project-track-options"])
        self.assertEqual(matches[0].policy_class, "authenticated_read")

    def test_project_track_write_route_has_user_write_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/project-track", ["POST"], "eng_routes.post_issue_project_track")

        self.assertEqual([policy.name for policy in matches], ["jira-project-track-write"])
        self.assertEqual(matches[0].policy_class, "user_write")

    def test_issue_status_catalog_route_has_authenticated_read_policy(self):
        from backend.security.policy import matching_policies

        matches = matching_policies("/api/issues/statuses/catalog", ["GET"], "eng_routes.get_issue_status_catalog")

        self.assertEqual([policy.name for policy in matches], ["jira-issue-status-catalog"])
        self.assertEqual(matches[0].policy_class, "authenticated_read")

    def test_dynamic_routes_have_security_samples(self):
        from backend.security.policy import routes_requiring_samples
        from tests.endpoint_security_samples import ROUTE_SAMPLES

        missing = sorted(route for route in routes_requiring_samples() if route not in ROUTE_SAMPLES)
        self.assertEqual(missing, [])

    def test_dynamic_path_compatibility_samples_are_oauth_ready(self):
        from backend.security.policy import is_oauth_ready_api_path
        from tests.endpoint_security_samples import ROUTE_SAMPLES

        wrong = []
        for rule, sample in sorted(ROUTE_SAMPLES.items()):
            if not sample.startswith("/api/"):
                continue
            if sample.startswith("/api/auth/dev/"):
                continue
            if not is_oauth_ready_api_path(sample):
                wrong.append({"rule": rule, "sample": sample})

        self.assertEqual(wrong, [])

    def test_policy_covers_existing_oauth_ready_routes_before_wrapper_removal(self):
        from backend.security.policy import classify_rule

        missing = []
        for path in sorted(jira_server.OAUTH_READY_API_PATHS):
            if path in POLICY_ONLY_ROUTES_PENDING_IMPLEMENTATION:
                continue
            rules = [rule for rule in jira_server.app.url_map.iter_rules() if rule.rule == path]
            if not rules:
                missing.append({"path": path, "reason": "no flask rule"})
                continue
            for rule in rules:
                methods = sorted(method for method in rule.methods if method not in IGNORED_METHODS)
                if not classify_rule(rule.rule, methods, rule.endpoint):
                    missing.append({"path": path, "methods": methods, "reason": "no policy"})

        self.assertEqual(missing, [])

    def test_policy_only_routes_pending_implementation_have_no_registered_rule(self):
        """Tripwire: a path left in the pending set after its route ships would
        otherwise silently skip test_policy_covers_existing_oauth_ready_routes_before_wrapper_removal
        for that path forever."""
        registered = {rule.rule for rule in jira_server.app.url_map.iter_rules()}
        stale = sorted(path for path in POLICY_ONLY_ROUTES_PENDING_IMPLEMENTATION if path in registered)

        self.assertEqual(
            stale,
            [],
            "Remove these paths from POLICY_ONLY_ROUTES_PENDING_IMPLEMENTATION now that they have a registered Flask rule",
        )

    def test_policy_marks_existing_shared_config_writes_admin_only(self):
        from backend.security.policy import classify_rule

        wrong = []
        for path in sorted(jira_server.OAUTH_SHARED_CONFIG_WRITE_PATHS):
            policy = classify_rule(path, ["POST"])
            if not policy or policy.policy_class != "shared_admin_write":
                wrong.append({"path": path, "policy": getattr(policy, "policy_class", None)})

        self.assertEqual(wrong, [])
