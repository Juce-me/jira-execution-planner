import os
import unittest
from unittest.mock import patch

import jira_server
from jira_server import (
    compute_track_phase_durations,
    parse_jira_datetime,
    parse_track_transitions,
)
from tests.oauth_test_helpers import install_oauth_session


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class TrackPhaseDurationMathTests(unittest.TestCase):
    def test_durations_initial_null_then_single_transition(self):
        # Mirrors the live TECH-27221 probe: created 2026-03-26, one transition
        # 2026-06-25 null -> Flexible, evaluated as-of 2026-06-30.
        out = compute_track_phase_durations(
            '2026-03-26T13:29:50.324+0000', 'Flexible',
            [{'date': '2026-06-25T00:00:00.000+0000', 'from': None, 'to': 'Flexible'}],
            parse_jira_datetime('2026-06-30T00:00:00.000+0000'))
        self.assertAlmostEqual(out['null (no value)'], 91.0, delta=1.0)
        self.assertAlmostEqual(out['Flexible'], 5.0, delta=1.0)

    def test_durations_no_transitions_attributes_all_time_to_current_value(self):
        out = compute_track_phase_durations(
            '2026-03-26T00:00:00.000+0000', 'Flexible',
            [],
            parse_jira_datetime('2026-03-31T00:00:00.000+0000'))
        self.assertEqual(set(out.keys()), {'Flexible'})
        self.assertAlmostEqual(out['Flexible'], 5.0, delta=0.01)

    def test_durations_no_transitions_and_blank_current_value_is_null_label(self):
        out = compute_track_phase_durations(
            '2026-03-26T00:00:00.000+0000', '',
            [],
            parse_jira_datetime('2026-03-31T00:00:00.000+0000'))
        self.assertEqual(set(out.keys()), {'null (no value)'})
        self.assertAlmostEqual(out['null (no value)'], 5.0, delta=0.01)

    def test_durations_two_transitions_sums_per_state(self):
        out = compute_track_phase_durations(
            '2026-01-01T00:00:00.000+0000', 'Committed',
            [
                {'date': '2026-01-11T00:00:00.000+0000', 'from': None, 'to': 'Flexible'},
                {'date': '2026-01-21T00:00:00.000+0000', 'from': 'Flexible', 'to': 'Committed'},
            ],
            parse_jira_datetime('2026-01-31T00:00:00.000+0000'))
        self.assertAlmostEqual(out['null (no value)'], 10.0, delta=0.01)
        self.assertAlmostEqual(out['Flexible'], 10.0, delta=0.01)
        self.assertAlmostEqual(out['Committed'], 10.0, delta=0.01)

    def test_durations_revisited_state_accumulates(self):
        out = compute_track_phase_durations(
            '2026-01-01T00:00:00.000+0000', 'Flexible',
            [
                {'date': '2026-01-06T00:00:00.000+0000', 'from': 'Flexible', 'to': 'Committed'},
                {'date': '2026-01-16T00:00:00.000+0000', 'from': 'Committed', 'to': 'Flexible'},
            ],
            parse_jira_datetime('2026-01-21T00:00:00.000+0000'))
        # Flexible: created..first (5d) + last..now (5d) = 10d; Committed: 10d.
        self.assertAlmostEqual(out['Flexible'], 10.0, delta=0.01)
        self.assertAlmostEqual(out['Committed'], 10.0, delta=0.01)


class TrackTransitionParserTests(unittest.TestCase):
    def test_parser_matches_fieldid_not_status_lookalike(self):
        histories = [
            {'created': '2026-06-25T00:00:00.000+0000', 'items': [
                {'fieldId': 'customfield_35024', 'field': 'Project Track', 'fromString': None, 'toString': 'Flexible'},
                {'fieldId': 'status', 'field': 'status', 'fromString': 'To Do', 'toString': 'Flexible'}]}]
        tx = parse_track_transitions(histories, 'customfield_35024')
        self.assertEqual([(t['from'], t['to']) for t in tx], [(None, 'Flexible')])

    def test_parser_matches_display_name_when_fieldid_absent(self):
        histories = [
            {'created': '2026-06-25T00:00:00.000+0000', 'items': [
                {'field': 'Project Track', 'fromString': None, 'toString': 'Flexible'}]}]
        tx = parse_track_transitions(histories, 'customfield_35024')
        self.assertEqual([(t['from'], t['to']) for t in tx], [(None, 'Flexible')])

    def test_parser_sorts_histories_ascending_by_created(self):
        histories = [
            {'created': '2026-01-21T00:00:00.000+0000', 'items': [
                {'fieldId': 'customfield_35024', 'fromString': 'Flexible', 'toString': 'Committed'}]},
            {'created': '2026-01-11T00:00:00.000+0000', 'items': [
                {'fieldId': 'customfield_35024', 'fromString': None, 'toString': 'Flexible'}]},
        ]
        tx = parse_track_transitions(histories, 'customfield_35024')
        self.assertEqual(
            [(t['from'], t['to']) for t in tx],
            [(None, 'Flexible'), ('Flexible', 'Committed')],
        )

    def test_parser_blank_strings_normalized_to_none(self):
        histories = [
            {'created': '2026-06-25T00:00:00.000+0000', 'items': [
                {'fieldId': 'customfield_35024', 'fromString': '', 'toString': 'Flexible'}]}]
        tx = parse_track_transitions(histories, 'customfield_35024')
        self.assertEqual(tx[0]['from'], None)
        self.assertEqual(tx[0]['to'], 'Flexible')


class TrackPhaseDurationRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._env_patcher = patch.dict(os.environ, {
            "CONFIG_STORAGE_BACKEND": "",
            "DATABASE_URL": "",
            "TEST_DATABASE_URL": "",
        }, clear=False)
        self._env_patcher.start()
        self.client = jira_server.app.test_client()
        install_oauth_session(self.client)

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._env_patcher.stop()

    def _issue_response(self, key, *, created, track_value, histories, total=None):
        changelog = {'histories': histories}
        if total is not None:
            changelog['total'] = total
        return FakeResponse(200, {
            'key': key,
            'fields': {
                'created': created,
                'summary': f'Synthetic {key}',
                'customfield_35024': {'value': track_value} if track_value else None,
            },
            'changelog': changelog,
        })

    def test_route_returns_durations_per_epic(self):
        issue = self._issue_response(
            'TECH-1',
            created='2026-03-26T00:00:00.000+0000',
            track_value='Flexible',
            histories=[{'created': '2026-06-25T00:00:00.000+0000', 'items': [
                {'fieldId': 'customfield_35024', 'fromString': None, 'toString': 'Flexible'}]}],
        )
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_project_track_field_id", return_value="customfield_35024"), \
             patch.object(jira_server, "current_jira_get", return_value=issue) as mock_get:
            response = self.client.post(
                "/api/stats/project-track-phase-durations",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"epicKeys": ["TECH-1"]},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertFalse(body["meta"]["truncated"])
        self.assertEqual(body["meta"]["processedEpicCount"], 1)
        epics = {e["key"]: e for e in body["epics"]}
        self.assertIn("TECH-1", epics)
        durations = epics["TECH-1"]["durations"]
        self.assertIn("null (no value)", durations)
        self.assertIn("Flexible", durations)
        mock_get.assert_called()
        # params dict, never a query string baked into the path.
        call = mock_get.call_args
        self.assertEqual(call.args[0], "/rest/api/3/issue/TECH-1")
        self.assertEqual(call.kwargs["params"]["expand"], "changelog")
        self.assertIn("customfield_35024", call.kwargs["params"]["fields"])

    def test_route_caps_epic_keys_and_marks_truncated(self):
        issue = self._issue_response(
            'TECH-X',
            created='2026-03-26T00:00:00.000+0000',
            track_value='Flexible',
            histories=[],
        )
        cap = jira_server.PROJECT_TRACK_PHASE_MAX_EPICS
        epic_keys = [f"TECH-{i}" for i in range(cap + 5)]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_project_track_field_id", return_value="customfield_35024"), \
             patch.object(jira_server, "current_jira_get", return_value=issue):
            response = self.client.post(
                "/api/stats/project-track-phase-durations",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"epicKeys": epic_keys},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertTrue(body["meta"]["truncated"])
        self.assertEqual(body["meta"]["processedEpicCount"], cap)

    def test_route_pages_changelog_when_total_exceeds_returned_histories(self):
        # The embedded /issue response carries id='1' only (total=2), so the
        # /changelog pagination branch must fire and collect id='2'.
        issue = self._issue_response(
            'TECH-2',
            created='2026-01-01T00:00:00.000+0000',
            track_value='Committed',
            histories=[{'id': '1', 'created': '2026-01-11T00:00:00.000+0000', 'items': [
                {'fieldId': 'customfield_35024', 'fromString': None, 'toString': 'Flexible'}]}],
            total=2,
        )
        # Faithful paged response: only the non-embedded record (id='2').
        changelog_page = FakeResponse(200, {
            'isLast': True,
            'values': [
                {'id': '2', 'created': '2026-01-21T00:00:00.000+0000', 'items': [
                    {'fieldId': 'customfield_35024', 'fromString': 'Flexible', 'toString': 'Committed'}]},
            ],
        })

        def fake_get(path, **kwargs):
            if path.endswith('/changelog'):
                return changelog_page
            return issue

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_project_track_field_id", return_value="customfield_35024"), \
             patch.object(jira_server, "current_jira_get", side_effect=fake_get) as mock_get:
            response = self.client.post(
                "/api/stats/project-track-phase-durations",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"epicKeys": ["TECH-2"]},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        epics = {e["key"]: e for e in body["epics"]}
        durations = epics["TECH-2"]["durations"]
        # The Committed transition only exists on the paged changelog page; if pagination
        # was skipped this state would be missing.
        self.assertIn("Committed", durations)
        self.assertIn("Flexible", durations)
        paged = [c for c in mock_get.call_args_list if c.args[0].endswith('/changelog')]
        self.assertTrue(paged, "expected the /changelog pagination branch to be exercised")

    def test_route_deduplicates_boundary_history_id_from_paged_changelog(self):
        # Adversarial: the paged /changelog page re-includes id='1' (the embedded
        # boundary record) but with a DIFFERENT toString ('Committed' instead of
        # 'Flexible').  Without dedup, this would add a spurious second transition and
        # skew durations.  With dedup, the original embedded record wins (first
        # occurrence kept) and no extra state appears.
        issue = self._issue_response(
            'TECH-3',
            created='2026-01-01T00:00:00.000+0000',
            track_value='Flexible',
            histories=[{'id': '1', 'created': '2026-01-11T00:00:00.000+0000', 'items': [
                {'fieldId': 'customfield_35024', 'fromString': None, 'toString': 'Flexible'}]}],
            total=2,
        )
        # Paged page re-sends id='1' with a conflicting toString, plus a genuine id='2'.
        changelog_page_adversarial = FakeResponse(200, {
            'isLast': True,
            'values': [
                # Boundary duplicate: same id, different toString — must be dropped.
                {'id': '1', 'created': '2026-01-11T00:00:00.000+0000', 'items': [
                    {'fieldId': 'customfield_35024', 'fromString': None, 'toString': 'Committed'}]},
                {'id': '2', 'created': '2026-01-21T00:00:00.000+0000', 'items': [
                    {'fieldId': 'customfield_35024', 'fromString': 'Flexible', 'toString': 'Flexible'}]},
            ],
        })

        def fake_get(path, **kwargs):
            if path.endswith('/changelog'):
                return changelog_page_adversarial
            return issue

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_project_track_field_id", return_value="customfield_35024"), \
             patch.object(jira_server, "current_jira_get", side_effect=fake_get):
            response = self.client.post(
                "/api/stats/project-track-phase-durations",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"epicKeys": ["TECH-3"]},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        epics = {e["key"]: e for e in body["epics"]}
        durations = epics["TECH-3"]["durations"]
        # The embedded id='1' records None -> Flexible, so Flexible must appear.
        self.assertIn("Flexible", durations)
        # If dedup is absent, the paged duplicate id='1' with toString='Committed' would
        # inject an extra null->Committed transition and 'Committed' would appear.
        # Dedup keeps the first (embedded) occurrence, so 'Committed' must NOT appear.
        self.assertNotIn("Committed", durations)

    def test_route_requires_epic_keys(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/stats/project-track-phase-durations",
                headers={"X-Requested-With": "jira-execution-planner"},
                json={"epicKeys": []},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
