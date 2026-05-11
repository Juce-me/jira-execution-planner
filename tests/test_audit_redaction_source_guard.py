import unittest
from pathlib import Path

from backend.db.models import AuditEvent, audit_event, redact_audit_metadata


REPO_ROOT = Path(__file__).resolve().parents[1]


class AuditRedactionSourceGuardTests(unittest.TestCase):
    def test_audit_metadata_redacts_token_material_and_callback_urls(self):
        redacted = redact_audit_metadata({
            'status': 401,
            'authorization': 'Bearer access-123',
            'oauth_code': 'code-123',
            'callbackUrl': 'http://localhost:5050/api/auth/atlassian/callback?state=abc&code=secret',
            'nested': {
                'pkce_verifier': 'verifier-123',
                'projectKey': 'ABC',
            },
        })

        self.assertEqual(redacted['status'], 401)
        self.assertEqual(redacted['authorization'], '[redacted]')
        self.assertEqual(redacted['oauth_code'], '[redacted]')
        self.assertEqual(redacted['callbackUrl'], 'http://localhost:5050/api/auth/atlassian/callback')
        self.assertEqual(redacted['nested']['pkce_verifier'], '[redacted]')
        self.assertEqual(redacted['nested']['projectKey'], 'ABC')

    def test_audit_event_factory_redacts_metadata_before_insert(self):
        row = audit_event(
            workspace_id='workspace-1',
            event_type='login_failure',
            metadata={'refresh_token': 'refresh-123', 'error_code': 'invalid_grant'},
        )

        self.assertIsInstance(row, AuditEvent)
        self.assertEqual(row.event_metadata['refresh_token'], '[redacted]')
        self.assertEqual(row.event_metadata['error_code'], 'invalid_grant')

    def test_audit_events_do_not_add_token_bearing_columns(self):
        column_names = {column.name.lower() for column in AuditEvent.__table__.columns}

        forbidden_fragments = {'token', 'authorization', 'code_verifier', 'oauth_code', 'callback_url'}
        for column_name in column_names:
            for fragment in forbidden_fragments:
                self.assertNotIn(fragment, column_name)

    def test_audit_event_insert_paths_use_redaction_factory(self):
        offenders = []
        for path in (REPO_ROOT / 'backend').rglob('*.py'):
            if path.match('*/db/models.py'):
                continue
            text = path.read_text(encoding='utf-8')
            if 'AuditEvent(' in text:
                offenders.append(str(path.relative_to(REPO_ROOT)))

        self.assertEqual(offenders, [], f'Direct AuditEvent construction bypasses redaction: {offenders}')


if __name__ == '__main__':
    unittest.main()
