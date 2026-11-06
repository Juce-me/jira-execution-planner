import * as React from 'react';

// Review-level actions exist only while there is something to save or discard; otherwise only a loading note can show.
export default function PlanningReviewStateCluster({ review, editable, onSave, onDiscard }) {
    const [confirming, setConfirming] = React.useState(false);
    const saveScopeId = React.useId(), discardScopeId = React.useId();
    React.useEffect(() => { if (!review.dirty) setConfirming(false); }, [review.dirty]);
    if (!review.dirty && !review.saving) {
        return review.loading ? <span className="planning-review-state-cluster"><span className="planning-review-state-note" role="status">Loading…</span></span> : null;
    }
    // A group-blocked save (group gone or view cap) keeps the draft; Discard, a group change or a reload clears it.
    const blocked = !editable || review.loading || review.saving || review.discarding || review.unconfirmed || Boolean(review.conflict) || review.groupBlocked;
    return <span className="planning-review-state-cluster">
        <span id={saveScopeId} className="planning-review-sr-only">Save includes all pending Teams. Shared column definitions and review values span Sprints; inclusion and layouts apply to this Sprint. Jira edits and capacity saves are independent.</span>
        <span id={discardScopeId} className="planning-review-sr-only">Restore the latest confirmed plan and app-owned review values. This does not reverse Jira edits or capacity saves.</span>
        <span className="planning-review-state-note" role="status">{review.saving ? 'Saving…' : 'Unsaved changes'}</span>
        {confirming
            ? <>
                <span className="planning-review-state-note">Discard unsaved changes?</span>
                <button type="button" className="fb-trigger" aria-describedby={discardScopeId} disabled={review.saving || review.discarding} onClick={() => { setConfirming(false); onDiscard(); }}>Discard changes</button>
                <button type="button" className="fb-trigger" onClick={() => setConfirming(false)}>Keep</button>
            </>
            : <>
                <button type="button" className="fb-trigger" aria-describedby={discardScopeId} disabled={review.saving || review.discarding} onClick={() => setConfirming(true)}>Discard changes</button>
                <button type="button" className="fb-trigger fb-trigger-primary" aria-label="Save plan" aria-describedby={saveScopeId} title="Save all pending Teams and app-owned review changes" disabled={blocked} onClick={onSave}>{review.saving ? 'Saving…' : 'Save plan'}</button>
            </>}
    </span>;
}
