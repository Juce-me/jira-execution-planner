# Design system and own-issue write contract

Verified on 2026-10-13. This map records the existing UI and the Part 1 write boundaries. It is not a claim that the hover migration has shipped. The [delivery design](plans/SUPPORT-design-system-hover-contract-design.md) separates the later global hover fix, surface migration and spec #3 scales/shared Button work.

Reuse an existing kind, component and class before adding another. One kind should have one look and one hover language. Interactive hover communicates clickability; passive rows and cards should not acquire it. The intended hover system changes colour and borders without moving or resizing controls. Part 1 only declares unused tokens; it preserves all current appearance and interactions, including grandfathered lifts and transitions.

## Element map

| Kind | Canonical component or entry point | Existing hooks / variants | Hover kind and write boundary | Deferred target |
| --- | --- | --- | --- | --- |
| Status pill | `ui/StatusPill.jsx`, `issues/StatusTransitionMenu.jsx` | `status-pill`, co-applied `task-status`; passive span / interactive button | Current brightness and semantic tints; interactive menu writes its own issue only | Ring, inset in clipped cells |
| Priority and Project Track controls | `issues/PriorityTransitionMenu.jsx`, `issues/ProjectTrackTransitionMenu.jsx` | `priority-transition`, `task-priority-icon` (`styles/eng/status-transitions.css`, `styles/eng/issues.css`), `epic-track-indicator` (`styles/eng/epics.css`) | Priority uses its issue; Project Track uses its displayed `epicKey`; never its children | Ring while retaining semantic tint |
| Pill, chip, badge | Classes in the registry below | Semantic labels, filters, selected chips, remove actions | Passive labels write nothing; remove/select writes only the represented local selection | Ring only for interactive controls |
| Buttons | Existing native buttons; no shared Button | Filled, secondary, transparent, light, pending / disabled | Current selectors; action-specific authority | 12% own-text-colour overlay and ring; Button/scales in spec #3 |
| Icon buttons | `ui/IconButton.jsx` | `icon-button--sm`, `icon-button--md` (`styles/shared/controls.css`); loading/variant hooks | Tinted circle; action-specific authority | Reuse existing primitive |
| Segmented control | `ui/SegmentedControl.jsx` | `segmented-control`, `eng-mode-control` (`styles/shared/controls.css`, `styles/eng/controls.css`) | Selection tint; local view state | Preserve fixed-row layout |
| Control field and dropdown trigger | `ui/ControlField.jsx`, `dashboard.jsx::renderSprintControl` | `control-field`, `sprint-dropdown-toggle`, `sprint-dropdown-option` (`styles/shared/controls.css`, `styles/shared/header.css`); selected value, search-on-change | Border/tint; local scope or settings state | Reuse layout and focus tokens |
| Menu options | `issues/IssueFieldOptionMenu.jsx` | Status, priority, Project Track options | Row tint; delegates to registered handler | Preserve own-key target |
| Inline text edits and links | `issues/IssuePersonEditor.jsx`, `issues/IssueSummaryEditor.jsx`, `issues/IssueTeamEditor.jsx`, `issues/StoryPointsEditor.jsx` | Assignee/delivery owner, Summary, Team, Story points | Underline; editors write `activeEditor.issueKey`, links write nothing | Scale cleanup in spec #3 |
| Chart segments, legends and readouts | `stats/ProjectTrackSprintChart.jsx`, `stats/ExcludedCapacityLineChart.jsx` | `project-track-sprint-segment` (`styles/stats/project-track.css`), `excluded-capacity-line-point` (`styles/stats/excluded-capacity.css`), `burnout-legend` (`styles/stats/burnout.css`); dimmed, isolated, hovered/readout states | Existing readouts; never infer Jira writes from a click | Keep readable readout and no global lift |
| Hover-reveal controls | `issues/IssueCard.jsx`, `eng/EpicBlock.jsx` | `task-remove` (`styles/eng/issues.css`), `epic-refresh-button` (`styles/eng/epics.css`); hover, focus-within, busy/error and touch fallbacks | Reveal only; tap remains available | Preserve touch behavior |
| Draggable cards | `eng/EngBoardEpicCard.jsx`, `eng/EngBoardView.jsx` | `ecard`, `ecard-open`, `is-dragging`, `is-rejected` (`styles/eng/board.css`) | Drop writes dragged Epic key only | No child or selected-task propagation |
| Non-interactive cards / rows | Existing surface components | Passive containers | No new hover or write | None |

Selected controls keep their selected treatment; pending controls preserve locks and settlement; disabled controls gain no new hover. The final focus treatment keeps `:focus-visible` outlines and uses `--focus-ring-color`. Unused foundation tokens are `--hover-ring`, `--hover-ring-inset`, `--hover-overlay`, `--overlay-pct`, and `--motion-hover`. Sticky tiers, dropdown layer lifts, geometry and keyboard behavior remain unchanged. Tooltip-placement transforms, hover-reveal behavior and hover z-index lifts are distinct from movement effects; MRT009 documents the layer constraints.

## Measured CSS inventory

The bundled dashboard contains 49 CSS source files and 204 actual `:hover` selector occurrences across 41 files. The raw-text count is 206 because two comment mentions are not selectors. Current value sets contain 7 font-family values, 52 font sizes and 27 border radii; 41 full class names end in `-pill`, `-chip`, `-badge`, `-btn` or `-button`.

Raw sources contain 80 exact `transform: none` declarations and 45 unrelated `text-transform: none` declarations. Hover/active rules contain 66 `transform: none` declarations and 9 non-none transforms: 3 lifts and 6 placement/reveal transforms. Ten declarations use `transition: all`. Twenty-five hover-shadow declarations expand to 27 selector identities. The generated baseline has 122 offender identities (85 transform/scale/translate, 10 transitions and 27 shadows), preserving exact values and nested context. `styles/planning/capacity.css` repeats tooltip selectors: the second occurrence has a separate identity and allowance. None of these counts grants permission to add a deviation; the ratchets reject additions and stale allowances.

## Write ownership and effect inventory

All four mutation hooks are called once in `App` in `frontend/src/dashboard.jsx`. Presentational menus and editors receive handlers and never import Jira writers or write hooks. The queue, captured auth context, per-issue optimistic state and confirmed/rejected/unconfirmed settlement stay inside those existing owners. The API can accept arrays for status and priority, but UI writers construct singleton arrays; this document grants no bulk-write authority.

The six status JSX sites are Story and subtask in IssueCard, Epic in EpicBlock, Story and Epic in EngBoardEpicPanel, and the Planning table cell in App. Shared IssueCard/EpicBlock sites serve Catch Up and Planning list. The menu forwards its exact `issue` prop; App forwards `issue.key`. Board drop uses the same handler with the dragged Epic key. Priority derives its key from its own issue; Project Track receives the displayed Epic’s `epicKey`. Four editor components use `openEditor` descriptors at the recorded sites and submit through the controller's frozen `activeEditor.issueKey`. The capacity card submits its capacity issue (`candidate.issueKey`), through App's `updateCapacity` adapter.

`fetchIssueTransitionOptions` and `searchIssueFieldUsers` use POST for option reads. HTTP method alone does not classify a mutation. Every export of `jiraIssueApi.js` and `capacityApi.js` is listed by effect below. Application-storage writes have reasoned exemptions and retain their separate backend ownership, CSRF and permissions. Scenario Jira publication stays blocked; storage exemptions cannot authorize it. The controller's `updateField` dependency is a test seam, not a production option or a writer override.

The single JSON block is the machine-readable source for paths, symbols, imports, hosts, bindings and class names. Class hooks are the actual bundled suffix-matching selectors; they are an inventory, not permission to duplicate an existing kind. No new class, writer, call site or hook host is implicit.

```json
{
  "version": 1,
  "verifiedOn": "2026-10-13",
  "classHooks": [
    "alert-chip",
    "alert-pill",
    "alerts-panel-summary-pill",
    "cohort-open-jira-button",
    "cohort-selected-chip",
    "component-chip",
    "dependency-pill",
    "eng-filter-status-pill",
    "epic-refresh-button",
    "epic-status-pill",
    "epm-duplicates-fix-button",
    "epm-duplicates-project-chip",
    "epm-project-board-label-pill",
    "epm-project-board-status-pill",
    "epm-project-collapse-all-button",
    "epm-scope-chip",
    "group-gear-button",
    "group-star-button",
    "header-icon-button",
    "issue-type-chip",
    "jira-export-icon-button",
    "mapping-delivery-owner-chip",
    "mapping-parent-chip",
    "mapping-sp-chip",
    "mapping-team-chip",
    "planning-action-button",
    "planning-button",
    "planning-icon-button",
    "planning-review-text-button",
    "product-chip",
    "project-type-btn",
    "remove-btn",
    "scenario-badge",
    "scenario-date-badge",
    "segmented-control-button",
    "selected-team-chip",
    "status-pill",
    "story-requirement-pill",
    "tech-chip",
    "uncheck-button",
    "update-badge"
  ],
  "hooks": [
    {
      "path": "frontend/src/eng/useEngStatusTransitions.js",
      "symbol": "useEngStatusTransitions",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "transitionIssues"
    },
    {
      "path": "frontend/src/eng/useEngPriorityTransitions.js",
      "symbol": "useEngPriorityTransitions",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "updateIssuePriorities"
    },
    {
      "path": "frontend/src/eng/useEngProjectTrackTransitions.js",
      "symbol": "useEngProjectTrackTransitions",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "updateIssueProjectTrack"
    },
    {
      "path": "frontend/src/eng/useEngIssueFieldEdits.js",
      "symbol": "useEngIssueFieldEdits",
      "host": "frontend/src/dashboard.jsx",
      "hostSymbol": "App",
      "calls": 1,
      "api": "updateIssueField"
    }
  ],
  "apiEffects": [
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchEditableIssueField",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngIssueFieldEdits.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "searchIssueFieldUsers",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngIssueFieldEdits.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "updateIssueField",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngIssueFieldEdits.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssueTransitionOptions",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngStatusTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "transitionIssues",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngStatusTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssuePriorityOptions",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngPriorityTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "updateIssuePriorities",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngPriorityTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssueProjectTrackOptions",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngProjectTrackTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "updateIssueProjectTrack",
      "effect": "jira-write",
      "owners": [
        "frontend/src/eng/useEngProjectTrackTransitions.js"
      ]
    },
    {
      "path": "frontend/src/api/jiraIssueApi.js",
      "symbol": "fetchIssueStatusCatalog",
      "effect": "read",
      "owners": [
        "frontend/src/eng/EngBoardView.jsx"
      ]
    },
    {
      "path": "frontend/src/api/capacityApi.js",
      "symbol": "fetchCapacity",
      "effect": "read",
      "owners": [
        "frontend/src/eng/useEngCapacity.js"
      ],
      "aliases": {
        "frontend/src/eng/useEngCapacity.js": "requestCapacity"
      }
    },
    {
      "path": "frontend/src/api/capacityApi.js",
      "symbol": "updateCapacity",
      "effect": "jira-write",
      "owners": [
        "frontend/src/dashboard.jsx"
      ]
    }
  ],
  "components": [
    {
      "path": "frontend/src/issues/StatusTransitionMenu.jsx",
      "symbol": "StatusTransitionMenu"
    },
    {
      "path": "frontend/src/issues/PriorityTransitionMenu.jsx",
      "symbol": "PriorityTransitionMenu"
    },
    {
      "path": "frontend/src/issues/ProjectTrackTransitionMenu.jsx",
      "symbol": "ProjectTrackTransitionMenu"
    },
    {
      "path": "frontend/src/issues/IssuePersonEditor.jsx",
      "symbol": "IssuePersonEditor"
    },
    {
      "path": "frontend/src/issues/IssueSummaryEditor.jsx",
      "symbol": "IssueSummaryEditor"
    },
    {
      "path": "frontend/src/issues/IssueTeamEditor.jsx",
      "symbol": "IssueTeamEditor"
    },
    {
      "path": "frontend/src/issues/StoryPointsEditor.jsx",
      "symbol": "StoryPointsEditor"
    }
  ],
  "status": {
    "component": "frontend/src/issues/StatusTransitionMenu.jsx",
    "handlerProp": "onSubmit",
    "forward": "onSubmit?.(targetStatus, issue)",
    "keyBinding": "issue.key",
    "callSites": [
      {
        "path": "frontend/src/issues/IssueCard.jsx",
        "issues": [
          "task",
          "subtask"
        ],
        "handler": "onSubmitStatusTransition"
      },
      {
        "path": "frontend/src/eng/EpicBlock.jsx",
        "issues": [
          "{ key: epicGroup.key, status: epicStatus, summary: epicTitle }"
        ],
        "handler": "handleSubmitStatusTransition"
      },
      {
        "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
        "issues": [
          "task",
          "{ key: epicKey, summary, status: epic.status }"
        ],
        "handler": "onSubmitStatusTransition"
      },
      {
        "path": "frontend/src/dashboard.jsx",
        "issues": [
          "{ key: row.key, status: row.status, summary: row.summary, storyPoints: row.issue?.fields?.customfield_10004 }"
        ],
        "handler": "handleSubmitStatusTransition"
      }
    ],
    "handlerPath": "frontend/src/dashboard.jsx",
    "handler": "handleSubmitStatusTransition",
    "hook": "useEngStatusTransitions",
    "api": "transitionIssues",
    "hookHost": "frontend/src/dashboard.jsx"
  },
  "bindings": [
    {
      "component": "frontend/src/issues/PriorityTransitionMenu.jsx",
      "symbol": "PriorityTransitionMenu",
      "handler": "onSubmit",
      "hook": "useEngPriorityTransitions",
      "api": "updateIssuePriorities",
      "keyBinding": "issue.key",
      "forward": "onSubmit?.(option.id, issueKey)",
      "callSites": [
        {
          "path": "frontend/src/issues/IssueCard.jsx",
          "issue": "task",
          "handler": "onSubmitPriorityTransition"
        },
        {
          "path": "frontend/src/eng/EpicBlock.jsx",
          "issue": "{ key: epicGroup.key, priority: epicOwnPriority, summary: epicTitle }",
          "handler": "submitPriorityChange"
        },
        {
          "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
          "issue": "issue",
          "handler": "priorityTransitions.submitPriorityChange"
        },
        {
          "path": "frontend/src/dashboard.jsx",
          "issue": "{ key: row.key, priority: row.priority, summary: row.summary }",
          "handler": "submitPriorityChange"
        }
      ],
      "hookHost": "frontend/src/dashboard.jsx"
    },
    {
      "component": "frontend/src/issues/ProjectTrackTransitionMenu.jsx",
      "symbol": "ProjectTrackTransitionMenu",
      "handler": "onSubmit",
      "hook": "useEngProjectTrackTransitions",
      "api": "updateIssueProjectTrack",
      "keyBinding": "epicKey",
      "forward": "onSubmit?.(option.value, epicKey)",
      "callSites": [
        {
          "path": "frontend/src/eng/EpicBlock.jsx",
          "key": "epicGroup.key",
          "handler": "submitProjectTrackChange"
        },
        {
          "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
          "key": "epicKey",
          "handler": "projectTrackTransitions.submitProjectTrackChange"
        },
        {
          "path": "frontend/src/dashboard.jsx",
          "key": "row.key",
          "handler": "submitProjectTrackChange"
        }
      ],
      "hookHost": "frontend/src/dashboard.jsx"
    }
  ],
  "editors": {
    "components": [
      "IssuePersonEditor",
      "IssueSummaryEditor",
      "IssueTeamEditor",
      "StoryPointsEditor"
    ],
    "hook": "useEngIssueFieldEdits",
    "api": "updateIssueField",
    "keyBinding": "activeEditor.issueKey",
    "openSites": [
      {
        "path": "frontend/src/issues/IssueCard.jsx",
        "key": "task.key"
      },
      {
        "path": "frontend/src/eng/EpicBlock.jsx",
        "key": "epicGroup.key"
      },
      {
        "path": "frontend/src/eng/EngBoardEpicPanel.jsx",
        "key": "issue.key"
      },
      {
        "path": "frontend/src/dashboard.jsx",
        "key": "row.key"
      }
    ],
    "hookHost": "frontend/src/dashboard.jsx",
    "handler": "openEditor/submit"
  },
  "boardDrop": {
    "path": "frontend/src/eng/EngBoardView.jsx",
    "symbol": "EngBoardView",
    "handler": "onSubmitStatusTransition",
    "keyBinding": "epicKey",
    "forward": "onSubmitStatusTransition?.(status, { key: epicKey })",
    "hook": "useEngStatusTransitions",
    "hookHost": "frontend/src/dashboard.jsx",
    "api": "transitionIssues",
    "callSites": [
      {
        "path": "frontend/src/eng/EngBoardView.jsx",
        "key": "epicKey",
        "handler": "onSubmitStatusTransition"
      }
    ]
  },
  "capacity": {
    "path": "frontend/src/eng/PlanningTeamCapacityCards.jsx",
    "symbol": "PlanningTeamCapacityCards",
    "host": "frontend/src/dashboard.jsx",
    "handler": "updateCapacityRequest",
    "api": "updateCapacity",
    "keyBinding": "candidate.issueKey",
    "callSites": [
      {
        "path": "frontend/src/eng/PlanningTeamCapacityCards.jsx",
        "handler": "updateCapacityRequest",
        "key": "candidate.issueKey"
      }
    ]
  },
  "statusPill": {
    "path": "frontend/src/ui/StatusPill.jsx",
    "symbol": "StatusPill",
    "interactiveOwner": "frontend/src/issues/StatusTransitionMenu.jsx",
    "handlers": [
      "onClick",
      "onPointerEnter",
      "onPointerLeave",
      "onPointerDown"
    ]
  },
  "exemptions": [
    {
      "path": "frontend/src/api/sprintReviewApi.js",
      "reason": "Sprint review snapshots write application storage, not Jira issue fields."
    },
    {
      "path": "frontend/src/api/configApi.js",
      "reason": "Workspace configuration and private preferences are storage writes; their ownership and edit gates remain independent."
    },
    {
      "path": "frontend/src/api/scenarioApi.js",
      "reason": "Draft save, rollback and reload affect application storage. Jira publication remains blocked and needs a separate write contract before enablement."
    },
    {
      "path": "frontend/src/settings/sharedExcludedCapacityToggle.js",
      "symbol": "saveSharedExcludedCapacityToggle",
      "reason": "Epic exclusion persists shared Department capacity configuration through saveGroupsConfig, never Jira status."
    }
  ],
  "classHookMap": [
    {
      "class": "alert-chip",
      "paths": [
        "frontend/src/styles/eng/alerts.css"
      ]
    },
    {
      "class": "alert-pill",
      "paths": [
        "frontend/src/styles/eng/alerts.css"
      ]
    },
    {
      "class": "alerts-panel-summary-pill",
      "paths": [
        "frontend/src/styles/eng/alerts.css"
      ]
    },
    {
      "class": "cohort-open-jira-button",
      "paths": [
        "frontend/src/styles/stats/cohort.css"
      ]
    },
    {
      "class": "cohort-selected-chip",
      "paths": [
        "frontend/src/styles/stats/cohort.css"
      ]
    },
    {
      "class": "component-chip",
      "paths": [
        "frontend/src/styles/settings/group-board.css",
        "frontend/src/styles/settings/group-editor.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "dependency-pill",
      "paths": [
        "frontend/src/styles/eng/dependencies.css"
      ]
    },
    {
      "class": "eng-filter-status-pill",
      "paths": [
        "frontend/src/styles/eng/filter-bar.css"
      ]
    },
    {
      "class": "epic-refresh-button",
      "paths": [
        "frontend/src/styles/eng/epics.css"
      ]
    },
    {
      "class": "epic-status-pill",
      "paths": [
        "frontend/src/styles/eng/epics.css"
      ]
    },
    {
      "class": "epm-duplicates-fix-button",
      "paths": [
        "frontend/src/styles/epm/duplicates.css"
      ]
    },
    {
      "class": "epm-duplicates-project-chip",
      "paths": [
        "frontend/src/styles/epm/duplicates.css"
      ]
    },
    {
      "class": "epm-project-board-label-pill",
      "paths": [
        "frontend/src/styles/epm/project-board.css"
      ]
    },
    {
      "class": "epm-project-board-status-pill",
      "paths": [
        "frontend/src/styles/epm/project-board.css"
      ]
    },
    {
      "class": "epm-project-collapse-all-button",
      "paths": [
        "frontend/src/styles/epm/project-board.css"
      ]
    },
    {
      "class": "epm-scope-chip",
      "paths": [
        "frontend/src/styles/settings/epm-settings.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "group-gear-button",
      "paths": [
        "frontend/src/styles/settings/modal-shell.css",
        "frontend/src/styles/shared/controls.css"
      ]
    },
    {
      "class": "group-star-button",
      "paths": [
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "header-icon-button",
      "paths": [
        "frontend/src/styles/shared/controls.css"
      ]
    },
    {
      "class": "issue-type-chip",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css",
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "jira-export-icon-button",
      "paths": [
        "frontend/src/styles/eng/export.css"
      ]
    },
    {
      "class": "mapping-delivery-owner-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "mapping-parent-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "mapping-sp-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "mapping-team-chip",
      "paths": [
        "frontend/src/styles/settings/mapping-preview.css"
      ]
    },
    {
      "class": "planning-action-button",
      "paths": [
        "frontend/src/styles/eng/planning-review-table.css",
        "frontend/src/styles/planning/actions.css"
      ]
    },
    {
      "class": "planning-button",
      "paths": [
        "frontend/src/styles/stats/summary.css"
      ]
    },
    {
      "class": "planning-icon-button",
      "paths": [
        "frontend/src/styles/planning/actions.css"
      ]
    },
    {
      "class": "planning-review-text-button",
      "paths": [
        "frontend/src/styles/eng/planning-review-table.css"
      ]
    },
    {
      "class": "product-chip",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css"
      ]
    },
    {
      "class": "project-type-btn",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css"
      ]
    },
    {
      "class": "remove-btn",
      "paths": [
        "frontend/src/styles/settings/epm-settings.css",
        "frontend/src/styles/settings/group-board.css",
        "frontend/src/styles/settings/group-editor.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "scenario-badge",
      "paths": [
        "frontend/src/styles/scenario/timeline.css"
      ]
    },
    {
      "class": "scenario-date-badge",
      "paths": [
        "frontend/src/styles/scenario/timeline.css"
      ]
    },
    {
      "class": "segmented-control-button",
      "paths": [
        "frontend/src/styles/shared/controls.css",
        "frontend/src/styles/shared/header.css",
        "frontend/src/styles/stats/shell.css"
      ]
    },
    {
      "class": "selected-team-chip",
      "paths": [
        "frontend/src/styles/settings/group-editor.css",
        "frontend/src/styles/settings/jira-fields.css",
        "frontend/src/styles/settings/mapping-preview.css",
        "frontend/src/styles/settings/team-groups.css"
      ]
    },
    {
      "class": "status-pill",
      "paths": [
        "frontend/src/styles/eng/board.css",
        "frontend/src/styles/eng/planning-review-table.css",
        "frontend/src/styles/eng/status-transitions.css"
      ]
    },
    {
      "class": "story-requirement-pill",
      "paths": [
        "frontend/src/styles/eng/issues.css"
      ]
    },
    {
      "class": "tech-chip",
      "paths": [
        "frontend/src/styles/settings/jira-fields.css"
      ]
    },
    {
      "class": "uncheck-button",
      "paths": [
        "frontend/src/styles/planning/stat-cards.css"
      ]
    },
    {
      "class": "update-badge",
      "paths": [
        "frontend/src/styles/shared/header.css"
      ]
    }
  ]
}
```

## Adding an element or write

1. Find its kind above and reuse its primitive, class and hover vocabulary. Stop for review before introducing another class for the same kind.
2. For a write, record the component, handler, owning hook/host, effect, call site and exact own-key binding in this registry; add a source pin and synthetic own-key test before connecting it.
3. Preserve selected, disabled, pending, touch and auth-expired behavior. Keep components presentational and production writers non-injectable.
4. Generate and inspect the CSS baseline with `node scripts/generate_design_system_baseline.cjs`. Font-family, font-size, radius and suffix-class changes need a reasoned review; the generator creates allowances only when no baseline exists and thereafter rejects additions or changed grandfathered values, allowing only stale removals. Duplicate selectors and nested contexts retain separate identities.
5. Run the write guards and CSS ratchets, rebuild, and use settled per-control Playwright geometry and screenshots for any visible hover or layout change. Existing mutation analytics stay unchanged; Part 1 is covered by the No-Event Allowlist.

Checks: [write contract guards](../tests/test_design_system_write_contract.js), [CSS ratchets](../tests/test_design_system_ratchets.js), [status binding tests](../tests/test_design_system_status_binding.js), [runtime matrix](../tests/ui/design_system_status_contract.spec.js). CSS baselines preserve exact values and property identities (`text-transform` is not `transform`); existing option/queue iteration is valid and never widens mutation targets.
