import unittest

from backend.services.alert_epics import build_alert_epic_payloads


class AlertEpicIdentityTests(unittest.TestCase):
    def test_alert_epic_assignee_retains_account_id_and_display_name(self):
        payload = build_alert_epic_payloads([{
            'key': 'DEMO-1',
            'fields': {
                'summary': 'Synthetic epic',
                'assignee': {'accountId': 'account-owner', 'displayName': 'Same Name'},
            },
        }], None, None, build_team_value=lambda value: value, extract_team_name=lambda value: '')

        self.assertEqual(payload[0]['assignee'], {
            'accountId': 'account-owner', 'displayName': 'Same Name',
        })


if __name__ == '__main__':
    unittest.main()
