import unittest

from backend.epm.payload import (
    build_empty_epm_rollup_payload,
    build_epm_rollup_hierarchy,
    dedupe_issues_by_key,
    normalize_epm_issue_type_sets,
    validate_epm_tab_sprint,
)


class EpmPayloadHelpersTests(unittest.TestCase):
    def test_dedupe_issues_by_key_keeps_first_issue(self):
        self.assertEqual(
            dedupe_issues_by_key([
                {'key': 'SYN-1', 'summary': 'first'},
                {'key': 'SYN-1', 'summary': 'second'},
                {'key': ''},
                {'key': 'SYN-2'},
            ]),
            [{'key': 'SYN-1', 'summary': 'first'}, {'key': 'SYN-2'}],
        )

    def test_active_tab_requires_numeric_sprint(self):
        self.assertEqual(validate_epm_tab_sprint('active', ''), ({'error': 'sprint_required'}, 400))
        self.assertEqual(validate_epm_tab_sprint('active', 'abc'), ({'error': 'sprint_not_numeric'}, 400))
        self.assertIsNone(validate_epm_tab_sprint('active', '42'))
        self.assertIsNone(validate_epm_tab_sprint('backlog', ''))

    def test_issue_type_sets_use_defaults_and_case_normalization(self):
        self.assertEqual(
            normalize_epm_issue_type_sets({'initiative': ['Theme'], 'epic': ['Feature'], 'leaf': ['Work']}),
            {'initiative': {'theme'}, 'epic': {'feature'}, 'leaf': {'work'}},
        )
        self.assertIn('initiative', normalize_epm_issue_type_sets({})['initiative'])

    def test_empty_rollup_payload_preserves_flags(self):
        project = {'id': 'project-1'}
        payload = build_empty_epm_rollup_payload(project, metadata_only=True)

        self.assertEqual(payload['project'], project)
        self.assertTrue(payload['metadataOnly'])
        self.assertFalse(payload['emptyRollup'])
        self.assertEqual(payload['initiatives'], {})
        self.assertEqual(payload['rootEpics'], {})
        self.assertEqual(payload['orphanStories'], [])

    def test_rollup_hierarchy_groups_initiatives_epics_and_orphans(self):
        hierarchy = build_epm_rollup_hierarchy([
            {'key': 'INIT-1', 'issueType': 'Initiative'},
            {'key': 'EPIC-1', 'issueType': 'Epic', 'parentKey': 'INIT-1'},
            {'key': 'EPIC-2', 'issueType': 'Epic'},
            {'key': 'STORY-1', 'issueType': 'Story', 'parentKey': 'EPIC-1'},
            {'key': 'STORY-2', 'issueType': 'Story', 'parentKey': 'INIT-1'},
            {'key': 'STORY-3', 'issueType': 'Story', 'parentKey': 'UNKNOWN'},
        ], {})

        self.assertIn('INIT-1', hierarchy['initiatives'])
        self.assertIn('EPIC-1', hierarchy['initiatives']['INIT-1']['epics'])
        self.assertEqual(hierarchy['initiatives']['INIT-1']['epics']['EPIC-1']['stories'][0]['key'], 'STORY-1')
        self.assertEqual(hierarchy['initiatives']['INIT-1']['looseStories'][0]['key'], 'STORY-2')
        self.assertIn('EPIC-2', hierarchy['rootEpics'])
        self.assertEqual(hierarchy['orphanStories'][0]['key'], 'STORY-3')


if __name__ == '__main__':
    unittest.main()
