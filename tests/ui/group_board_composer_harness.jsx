// Mount harness for the Group Board composer.
//
// Nothing mounts GroupBoardSettings yet — the Boards sub-tab that does is the next task — so this
// file stands in for that consumer: it holds the group draft, renders the modal's own
// `.group-modal-validation` banner and footer Save from the composer's reported errors, and
// exposes the emitted board on `window.__groupBoardHarness` so a spec can assert the *data* the
// composer produces, not only its DOM.
//
// This is a harness, not the app. The assertions that prove the composer behaves inside the real
// settings modal (tab wiring, unified save, 409 handling) belong to the task that mounts it.

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import GroupBoardSettings from '../../frontend/src/settings/GroupBoardSettings.jsx';
import { validateComposerBoard } from '../../frontend/src/settings/groupBoardModel.js';
import {
    REFERENCE_BOARD_ID,
    REFERENCE_EPICS_BY_STATUS,
    referenceBoard,
} from '../fixtures/groupBoardReference.mjs';

function Harness() {
    const initial = window.__groupBoardHarnessInitialBoard === undefined
        ? referenceBoard()
        : window.__groupBoardHarnessInitialBoard;
    const [board, setBoard] = React.useState(initial);
    // GroupBoardSettings reports nothing upward (it has no onValidationChange) — the real Save gate
    // validates the committed board directly off the group draft, and this harness stands in for
    // that gate the same way, deriving errors from `board` instead of a composer callback.
    const { errors } = validateComposerBoard(board?.columns || []);

    window.__groupBoardHarness = { board, errors };

    return (
        <>
            {errors.length > 0 && (
                <div className="group-modal-validation" role="alert" aria-live="polite">
                    {errors.map((error) => <span key={error}>Group Board: {error}</span>)}
                </div>
            )}
            <div className="group-modal-content">
                <div className="group-modal-split">
                    <div className="group-pane group-pane-right">
                        <div className="group-editor">
                            <GroupBoardSettings
                                board={board}
                                backendUrl=""
                                boardId={REFERENCE_BOARD_ID}
                                groupName="Northwind"
                                epicsByStatus={REFERENCE_EPICS_BY_STATUS}
                                onChange={setBoard}
                                // undefined unless a spec sets it before navigation, in which case
                                // the component's own default (Math.random) never applies.
                                random={window.__groupBoardHarnessRandom}
                            />
                        </div>
                    </div>
                </div>
            </div>
            <div className="group-modal-footer">
                <span className="spacer" />
                <button type="button" className="primary" id="harness-save" disabled={errors.length > 0}>
                    Save
                </button>
            </div>
        </>
    );
}

const root = createRoot(document.getElementById('harness-root'));
root.render(<Harness />);

// Unmount and mount again in the same page, so a spec can prove the status catalog is cached for
// the session rather than refetched per mount.
window.__groupBoardHarnessRemount = async () => {
    root.render(null);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    root.render(<Harness />);
};
