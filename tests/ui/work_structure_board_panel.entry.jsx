// Harness entry for work_structure_board_panel.spec.js: mounts the REAL Board detail panel with the work model and an
// inline-edit stub injected through `window.__boardPanel`, so the person editors can be checked for both configurations.
// Synthetic data only.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import EngBoardEpicPanel from '../../frontend/src/eng/EngBoardEpicPanel.jsx';

const COLUMNS = [{ id: 'todo', name: 'To Do', statuses: ['To Do'] }, { id: 'done', name: 'Done', statuses: ['Done'] }];
const child = (key, typeName, extra = {}) => ({
    key, fields: { summary: `Synthetic ${key}`, status: { name: 'To Do' }, priority: { name: 'Medium' }, assignee: { displayName: 'Pat Synthetic' },
        issuetype: { id: '10', name: typeName, ...extra } },
});

function mount(workModel, children) {
    const opened = [];
    const issueFieldEdits = {
        activeEditor: null, metadata: null, suggestions: [], searchQuery: '', status: 'idle', pendingIssueKeys: new Set(),
        openEditor: editor => opened.push(editor), closeEditor() {}, search() {}, submit() {}, reload() {}, checkJira() {},
    };
    const epicGroup = {
        key: 'PLAN-P1', epic: { key: 'PLAN-P1', summary: 'Synthetic parent', status: { name: 'To Do' }, assignee: null, deliveryOwner: null },
        tasks: children, storyPoints: 8,
    };
    const root = createRoot(document.getElementById('panel'));
    root.render(<EngBoardEpicPanel epicGroup={epicGroup} columns={COLUMNS} issueFieldEdits={issueFieldEdits} workModel={workModel} onClose={() => {}} />);
    return { opened, unmount: () => root.unmount() };
}

window.__boardPanel = { mount, child };
