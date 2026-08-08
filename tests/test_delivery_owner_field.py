import unittest
from unittest.mock import patch

import jira_server
from tests.auth_mode_test_utils import force_basic_auth_mode


class _FakeResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class DeliveryOwnerFieldConfigTests(unittest.TestCase):
    """There is no built-in Delivery Owner field id (O11).

    The id differs per Jira instance and was never verified from this repo, so the
    field stays unset until an admin picks one at Settings -> Admin -> Mapping.
    """

    def test_no_default_field_id_when_config_absent(self):
        with patch.object(jira_server, 'load_dashboard_config', return_value={}):
            self.assertEqual(jira_server.get_delivery_owner_field_id(), '')

    def test_module_exposes_no_hardcoded_delivery_owner_field_id(self):
        self.assertFalse(hasattr(jira_server, 'DELIVERY_OWNER_FIELD_DEFAULT'))

    def test_config_overrides_field_id(self):
        cfg = {'deliveryOwnerField': {'fieldId': 'customfield_88888', 'fieldName': 'Delivery Owner'}}
        with patch.object(jira_server, 'load_dashboard_config', return_value=cfg):
            self.assertEqual(jira_server.get_delivery_owner_field_id(), 'customfield_88888')

    def test_empty_configured_field_id_stays_unset(self):
        cfg = {'deliveryOwnerField': {'fieldId': '', 'fieldName': ''}}
        with patch.object(jira_server, 'load_dashboard_config', return_value=cfg):
            self.assertEqual(jira_server.get_delivery_owner_field_id(), '')

    def test_field_id_unset_when_config_unavailable(self):
        from backend.config.repository import ConfigStorageError
        with patch.object(jira_server, 'load_dashboard_config', side_effect=ConfigStorageError('no context')):
            self.assertEqual(jira_server.get_delivery_owner_field_id(), '')


class FetchEpicDetailsDeliveryOwnerTests(unittest.TestCase):
    def test_config_override_field_requested_and_value_parsed(self):
        captured = {}

        def fake_search(payload):
            captured['payload'] = payload
            return _FakeResp(200, {'issues': [
                {'key': 'PRODUCT-1', 'fields': {
                    'summary': 'Epic one',
                    'status': {'name': 'In Progress'},
                    'updated': '2026-01-05T10:00:00.000+0000',
                    'customfield_88888': {'displayName': 'Jane Doe'},
                }},
            ]})

        cfg = {'deliveryOwnerField': {'fieldId': 'customfield_88888', 'fieldName': 'Delivery Owner'}}
        with patch.object(jira_server, 'load_dashboard_config', return_value=cfg), \
             patch.object(jira_server, 'jira_search_request', side_effect=fake_search):
            details = jira_server.fetch_epic_details_bulk(['PRODUCT-1'], {}, None)

        self.assertIn('customfield_88888', captured['payload']['fields'])
        self.assertEqual(details['PRODUCT-1']['deliveryOwner'], {'displayName': 'Jane Doe'})
        self.assertEqual(details['PRODUCT-1']['updated'], '2026-01-05T10:00:00.000+0000')

    def test_configured_field_present_but_empty_yields_none(self):
        cfg = {'deliveryOwnerField': {'fieldId': 'customfield_88888', 'fieldName': 'Delivery Owner'}}

        def fake_search(payload):
            return _FakeResp(200, {'issues': [
                {'key': 'TECH-2', 'fields': {
                    'summary': 'Epic two',
                    'status': {'name': 'To Do'},
                    'updated': None,
                    'customfield_88888': None,
                }},
            ]})

        with patch.object(jira_server, 'load_dashboard_config', return_value=cfg), \
             patch.object(jira_server, 'jira_search_request', side_effect=fake_search):
            details = jira_server.fetch_epic_details_bulk(['TECH-2'], {}, None)

        self.assertIsNone(details['TECH-2']['deliveryOwner'])
        self.assertIsNone(details['TECH-2']['updated'])

    def test_unconfigured_field_is_not_requested_and_key_is_omitted(self):
        captured = {}

        def fake_search(payload):
            captured['payload'] = payload
            return _FakeResp(200, {'issues': [
                {'key': 'TECH-2', 'fields': {
                    'summary': 'Epic two',
                    'status': {'name': 'To Do'},
                    'updated': None,
                }},
            ]})

        with patch.object(jira_server, 'load_dashboard_config', return_value={}), \
             patch.object(jira_server, 'jira_search_request', side_effect=fake_search):
            details = jira_server.fetch_epic_details_bulk(['TECH-2'], {}, None)

        # No guessed id is sent to Jira, and no blank field name either.
        self.assertNotIn('customfield_11147', captured['payload']['fields'])
        self.assertNotIn('', captured['payload']['fields'])
        self.assertIn('updated', captured['payload']['fields'])
        # The epic payload simply omits deliveryOwner while the field is unconfigured.
        self.assertNotIn('deliveryOwner', details['TECH-2'])


class DeliveryOwnerFieldRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        force_basic_auth_mode(self, jira_server)
        self.client = jira_server.app.test_client()

    def test_get_returns_unset_when_no_config(self):
        with patch.object(jira_server, 'load_dashboard_config', return_value={}):
            response = self.client.get('/api/delivery-owner-field/config')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'fieldId': '', 'fieldName': ''})

    def test_post_persists_field_config(self):
        with patch.object(jira_server, 'load_dashboard_config', return_value={}), \
             patch.object(jira_server, 'save_dashboard_config') as mock_save:
            response = self.client.post(
                '/api/delivery-owner-field/config',
                json={'fieldId': 'customfield_99999', 'fieldName': 'Delivery Owner'},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'fieldId': 'customfield_99999', 'fieldName': 'Delivery Owner'})
        mock_save.assert_called_once()
        saved_config = mock_save.call_args[0][0]
        self.assertEqual(
            saved_config['deliveryOwnerField'],
            {'fieldId': 'customfield_99999', 'fieldName': 'Delivery Owner'},
        )


if __name__ == '__main__':
    unittest.main()
