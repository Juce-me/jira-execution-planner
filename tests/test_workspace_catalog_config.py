import os
import tempfile
import unittest

from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine
from backend.db import models
from backend.services.workspace_catalog_config import (
    normalize_catalog_base_jql,
    resolve_effective_catalog_config,
)


def _context(workspace_id, user_id='user-1'):
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id=user_id, stable_subject=user_id,
        atlassian_account_id=user_id, workspace_id=workspace_id,
        auth_connection_id=f'connection-{user_id}', cloud_id='cloud-1',
        site_url='https://one.example.test', token_version='1',
        account_status='active', is_admin=True,
    )


class WorkspaceCatalogConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'config.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='test', name='One', jira_site_url='https://one.example.test',
                jira_cloud_id='cloud-1',
            )
            session.add(workspace)
            session.flush()
            self.workspace_id = workspace.id
            session.commit()
        self.context = _context(self.workspace_id)
        self.runtime = {
            'jql_query': '', 'jira_board_id': '99',
            'team_field_default': 'customfield_10001',
            'sprint_field_default': 'customfield_10002',
        }

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def _resolve(self, payload=None, **runtime):
        if payload is not None:
            with self.factory() as session:
                session.add(models.WorkspaceDashboardConfig(
                    workspace_id=self.workspace_id, payload=payload, config_revision=1,
                ))
                session.commit()
        values = {**self.runtime, **runtime}
        with self.factory() as session:
            return resolve_effective_catalog_config(
                session, self.context, runtime_inputs=values,
                fallback_loader=None, legacy_site_url='',
            )

    def test_environment_jql_precedes_projects(self):
        config = self._resolve(
            {'projects': [{'key': 'B'}, {'key': 'A'}]},
            jql_query='project = ENV ORDER BY created DESC',
        )
        self.assertEqual(config.projects, ('A', 'B'))
        self.assertEqual(config.base_jql, '(project = ENV)')

    def test_saved_blank_board_blocks_environment_fallback(self):
        config = self._resolve({'board': {'boardId': ''}}, jira_board_id='99')
        self.assertEqual(config.board_id, '')
        self.assertIsNone(config.sprint_identity)

    def test_absent_team_field_uses_default_but_explicit_blank_is_required(self):
        absent = self._resolve({'projects': [{'key': 'DEMO'}]})
        self.assertEqual(absent.team_field_id, 'customfield_10001')
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            row.payload = {'projects': [{'key': 'DEMO'}], 'teamField': {'fieldId': ''}}
            session.commit()
        with self.factory() as session:
            blank = resolve_effective_catalog_config(
                session, self.context, runtime_inputs=self.runtime,
                fallback_loader=None, legacy_site_url='',
            )
        self.assertEqual(blank.team_scope_error, 'team_field_required')

    def test_revision_zero_read_does_not_insert(self):
        with self.factory() as session:
            config = resolve_effective_catalog_config(
                session, self.context, runtime_inputs=self.runtime,
                fallback_loader=lambda: {'board': {'boardId': '7'}},
                legacy_site_url='https://one.example.test',
            )
            self.assertEqual(config.config_revision, 0)
            self.assertEqual(session.query(models.WorkspaceDashboardConfig).count(), 0)

    def test_exact_quoted_jql_and_top_level_conjunct_normalization(self):
        cases = {
            'project = "A AND B" AND Sprint in (1,2) ORDER BY created DESC': '(project = "A AND B")',
            'Sprint=1 AND project=DEMO': '(project=DEMO)',
            'project=DEMO AND cf[10001] in ("team-a")': '(project=DEMO)',
            '"Team[Team]"=team-a AND project=DEMO': '(project=DEMO)',
            '(project=A OR project=B) AND Sprint=1': '((project=A OR project=B))',
            'project = "Sprint AND Team"': '(project = "Sprint AND Team")',
            'summary = "Sprint = 1" AND project=DEMO': '(summary = "Sprint = 1") AND (project=DEMO)',
            'summary ~ "Team IN (A)" AND project=DEMO': '(summary ~ "Team IN (A)") AND (project=DEMO)',
            'project = "Team IS EMPTY"': '(project = "Team IS EMPTY")',
            'NOT (status=Done) AND Sprint=1': '(NOT (status=Done))',
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(normalize_catalog_base_jql(
                    source, team_field_id='customfield_10001', sprint_field_id='customfield_10002',
                ), expected)

    def test_nested_target_predicate_is_rejected(self):
        for source in (
            '(Sprint=1 OR project=A)',
            'Sprint=1 OR project=A AND issuetype=Bug',
            '("Team[Team]"=a OR project=A) AND issuetype=Bug',
            '(Sprint=1 AND project=A) AND issuetype=Bug',
            'NOT (Sprint=1) AND project=DEMO',
            'NOT Sprint=1 AND project=DEMO',
            'NOT "Team[Team]"=a AND project=DEMO',
        ):
            with self.subTest(source=source), self.assertRaisesRegex(
                ValueError, 'team_scope_unsupported',
            ):
                normalize_catalog_base_jql(
                    source,
                    team_field_id='customfield_10001',
                    sprint_field_id='customfield_10002',
                )

    def test_generated_project_jql_rejects_unsafe_project_keys(self):
        injected = 'A\\") OR project = HACK OR project in ("B'
        config = self._resolve({
            'projects': {'selected': [{'key': injected}]},
        })
        self.assertEqual(config.team_scope_error, 'team_scope_unsupported')
        self.assertEqual(config.base_jql, '')
        self.assertNotIn('HACK', config.base_jql)

    def test_board_id_requires_canonical_ascii_positive_decimal(self):
        for value in ('', '0', '-1', '01', '١', '１', '17.0'):
            with self.subTest(value=value):
                config = self._resolve(jira_board_id=value)
                self.assertEqual(config.board_id, '')
                self.assertIsNone(config.sprint_identity)
        valid = self._resolve(jira_board_id='17')
        self.assertEqual(valid.board_id, '17')
        self.assertIsNotNone(valid.sprint_identity)

    def test_digest_excludes_user_token_preferences_and_unrelated_fields(self):
        first = self._resolve({'projects': [{'key': 'DEMO'}], 'priority': {'High': 5}})
        other = _context(self.workspace_id, 'user-2')
        with self.factory() as session:
            second = resolve_effective_catalog_config(
                session, other, runtime_inputs=self.runtime,
                fallback_loader=None, legacy_site_url='',
            )
        self.assertEqual(first.config_digest, second.config_digest)

    def test_real_projects_selected_shape_is_resolved(self):
        config = self._resolve({'projects': {'selected': [{'key': 'B'}, {'key': 'A'}]}})
        self.assertEqual(config.projects, ('A', 'B'))

    def test_jql_empty_operators_invalid_double_equals_and_none_values(self):
        for source in ('Sprint IS EMPTY AND project=DEMO', 'Sprint IS NOT EMPTY AND project=DEMO'):
            self.assertEqual(normalize_catalog_base_jql(
                source, team_field_id='customfield_10001', sprint_field_id='customfield_10002',
            ), '(project=DEMO)')
        with self.assertRaisesRegex(ValueError, 'team_scope_unsupported'):
            normalize_catalog_base_jql(
                'Sprint==1 AND project=DEMO', team_field_id='customfield_10001',
                sprint_field_id='customfield_10002',
            )
        config = self._resolve({
            'board': {'boardId': None}, 'teamField': {'fieldId': None},
            'projects': {'selected': [{'key': 'DEMO'}]},
        })
        self.assertEqual(config.board_id, '')
        self.assertEqual(config.team_field_id, '')


if __name__ == '__main__':
    unittest.main()
