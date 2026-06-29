import unittest
from unittest.mock import patch

import jira_server


class _FakeResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class ProjectTrackFieldConfigTests(unittest.TestCase):
    def test_default_field_id_when_config_absent(self):
        with patch.object(jira_server, 'load_dashboard_config', return_value={}):
            self.assertEqual(jira_server.get_project_track_field_id(), 'customfield_35024')

    def test_config_overrides_field_id(self):
        cfg = {'projectTrackField': {'fieldId': 'customfield_99999', 'fieldName': 'Project Track'}}
        with patch.object(jira_server, 'load_dashboard_config', return_value=cfg):
            self.assertEqual(jira_server.get_project_track_field_id(), 'customfield_99999')

    def test_field_id_falls_back_when_config_unavailable(self):
        from backend.config.repository import ConfigStorageError
        with patch.object(jira_server, 'load_dashboard_config', side_effect=ConfigStorageError('no context')):
            self.assertEqual(jira_server.get_project_track_field_id(), 'customfield_35024')


class FetchEpicDetailsProjectTrackTests(unittest.TestCase):
    def test_config_override_field_requested_and_value_parsed(self):
        captured = {}

        def fake_search(payload):
            captured['payload'] = payload
            return _FakeResp(200, {'issues': [
                {'key': 'PRODUCT-1', 'fields': {
                    'summary': 'Epic one',
                    'status': {'name': 'In Progress'},
                    'customfield_99999': {'value': 'Committed'},
                }},
            ]})

        cfg = {'projectTrackField': {'fieldId': 'customfield_99999', 'fieldName': 'Project Track'}}
        with patch.object(jira_server, 'load_dashboard_config', return_value=cfg), \
             patch.object(jira_server, 'jira_search_request', side_effect=fake_search):
            details = jira_server.fetch_epic_details_bulk(['PRODUCT-1'], {}, None)

        self.assertIn('customfield_99999', captured['payload']['fields'])
        self.assertEqual(details['PRODUCT-1']['projectTrack'], 'Committed')

    def test_field_requested_and_value_parsed(self):
        captured = {}

        def fake_search(payload):
            captured['payload'] = payload
            return _FakeResp(200, {'issues': [
                {'key': 'PRODUCT-1', 'fields': {
                    'summary': 'Epic one',
                    'status': {'name': 'In Progress'},
                    'customfield_35024': {'value': 'Committed'},
                }},
                {'key': 'TECH-2', 'fields': {
                    'summary': 'Epic two',
                    'status': {'name': 'To Do'},
                    'customfield_35024': None,
                }},
            ]})

        with patch.object(jira_server, 'load_dashboard_config', return_value={}), \
             patch.object(jira_server, 'jira_search_request', side_effect=fake_search):
            details = jira_server.fetch_epic_details_bulk(['PRODUCT-1', 'TECH-2'], {}, None)

        self.assertIn('customfield_35024', captured['payload']['fields'])
        self.assertEqual(details['PRODUCT-1']['projectTrack'], 'Committed')
        self.assertIsNone(details['TECH-2']['projectTrack'])


if __name__ == '__main__':
    unittest.main()
