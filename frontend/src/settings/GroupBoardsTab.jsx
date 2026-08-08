import * as React from 'react';
import GroupBoardSettings from './GroupBoardSettings.jsx';
import { formatGroupBoardSummary } from './groupConfigUtils.js';

// The Boards sub-tab under Departments (§5.1, D23): the same group-list-left, composer-right split
// as Team groups, so the group is always the composer's visible scope. Presentation only — dashboard
// keeps ownership of the group draft and board-config state and passes it in.

export default function GroupBoardsTab(props) {
    const {
        groupManageTab,
        filteredGroupDrafts,
        activeGroupDraft,
        groupSearchQuery,
        setGroupSearchQuery,
        setActiveGroupDraftId,
        showGroupListMobile,
        setShowGroupListMobile,
        board,
        backendUrl,
        boardId,
        projectScopeKey,
        groupName,
        epicsByStatus,
        onChange,
        random,
    } = props;

    return (
        <>
        {groupManageTab === 'boards' && (
        <div className="group-modal-body group-modal-split">
            <div className={`group-pane group-pane-left ${showGroupListMobile ? 'is-mobile-active' : ''}`}>
                <div className="group-pane-header">
                    <div className="group-pane-title">Groups</div>
                    <input
                        type="text"
                        className="group-filter-input"
                        placeholder="Search groups..."
                        value={groupSearchQuery}
                        onChange={(event) => setGroupSearchQuery(event.target.value)}
                    />
                </div>
                <div className="group-pane-list">
                    {(filteredGroupDrafts || []).map((group) => {
                        const isActive = activeGroupDraft?.id === group.id;
                        return (
                            <button
                                key={`board-group-${group.id}`}
                                className={`group-list-item ${isActive ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveGroupDraftId(group.id);
                                    setShowGroupListMobile(false);
                                }}
                                type="button"
                            >
                                <div className="group-list-line">
                                    <span className="group-list-name">{group.name || 'Untitled group'}</span>
                                </div>
                                <span className="group-list-meta">{formatGroupBoardSummary(group.board)}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
            <div className="group-pane group-pane-right">
                <div className="group-pane-mobile-header">
                    <button
                        className="secondary compact"
                        onClick={() => setShowGroupListMobile(true)}
                        type="button"
                    >
                        Groups
                    </button>
                    <div className="group-pane-mobile-title">
                        {activeGroupDraft ? (activeGroupDraft.name || 'Untitled group') : 'No group selected'}
                    </div>
                </div>
                {!activeGroupDraft ? (
                    <div className="group-pane-empty">Select a group to configure its board.</div>
                ) : (
                    <GroupBoardSettings
                        key={activeGroupDraft.id}
                        {...{
                            board,
                            backendUrl,
                            boardId,
                            projectScopeKey,
                            groupName,
                            epicsByStatus,
                            onChange,
                            random,
                        }}
                    />
                )}
            </div>
        </div>
        )}
        </>
    );
}
