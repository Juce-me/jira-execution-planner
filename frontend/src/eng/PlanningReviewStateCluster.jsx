import * as React from 'react';

// Review-level actions exist only while there is something to save or discard; otherwise only a loading note can show.
export default function PlanningReviewStateCluster({ review, editable, onSave, onDiscard }) {
    const [confirming, setConfirming] = React.useState(false);
    React.useEffect(() => { if (!review.dirty) setConfirming(false); }, [review.dirty]);
    if (!review.dirty && !review.saving) {
        return review.loading ? <span className="planning-review-state-cluster"><span className="planning-review-state-note" role="status">Loading…</span></span> : null;
    }
    const blocked = !editable || review.loading || review.saving || review.unconfirmed || Boolean(review.conflict);
    return <span className="planning-review-state-cluster">
        <span className="planning-review-sr-only" role="status">{review.saving ? 'Saving…' : 'Unsaved changes'}</span>
        {confirming
            ? <>
                <span className="planning-review-state-note">Discard unsaved changes?</span>
                <button type="button" className="planning-action-button" disabled={review.saving} onClick={() => { setConfirming(false); onDiscard(); }}>Discard</button>
                <button type="button" className="planning-action-button" onClick={() => setConfirming(false)}>Keep</button>
            </>
            : <>
                <button type="button" className="planning-action-button" disabled={review.saving} onClick={() => setConfirming(true)}>Discard</button>
                <button type="button" className="planning-action-button" aria-label="Save review" disabled={blocked} onClick={onSave}>{review.saving ? 'Saving…' : 'Save'}</button>
            </>}
    </span>;
}
