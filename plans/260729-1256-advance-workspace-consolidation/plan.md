---
title: Advance Workspace Consolidation
description: >-
  Consolidate advance requests and settlement review into one canonical office
  workspace while preserving the separate governance authority queue.
status: completed
priority: P2
branch: main
tags:
  - frontend
  - finance
  - navigation
  - responsive
blockedBy: []
blocks: []
created: '2026-07-29T05:02:01.685Z'
createdBy: 'ck:plan'
source: skill
---

# Advance Workspace Consolidation

## Overview

Replace the two overlapping top-level finance destinations with one canonical
`/advances` workspace. The workspace owns the common header and query-backed
views for advance requests and settlement review. `/governance-actions` remains
separate and is renamed **Trung tâm phê duyệt** because it is the authority
queue that completes governed decisions.

No API, database, ledger, calculation, RBAC, or settlement-detail mutation
contract changes are in scope.

## Acceptance criteria

- Finance navigation exposes one `Tạm ứng & hoàn ứng` item and one separate
  `Trung tâm phê duyệt` item.
- `/advances` supports durable `view=requests|settlements` URLs; the legacy
  `/admin/advance-settlements` URL redirects to the settlement view while
  preserving `focus` and unrelated query parameters.
- Existing request and settlement capabilities, role rules, status filters,
  deep links, totals, and detail links remain available.
- Request actions are described as proposals sent to governance, not immediate
  final approval. Settlement actions retain their existing direct-review
  semantics.
- Desktop, tablet, and mobile layouts have no page-level horizontal overflow;
  workspace controls and action targets are at least 44px high.
- Focus deep links remove only `focus`/`fdur`, preserving workspace view state.
- Affected QA gates, independent review, artifact validation, demo deployment,
  and authenticated desktop/mobile smoke checks are green.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Consolidate navigation and routes](./phase-01-consolidate-navigation-and-routes.md) | Completed |
| 2 | [Build canonical advances workspace](./phase-02-build-canonical-advances-workspace.md) | Completed |
| 3 | [Regression and QA](./phase-03-regression-and-qa.md) | Completed |

## Dependencies

- Preserve unrelated customer-portal and banner/dashboard changes already in
  the dirty worktree.
- Do not commit or push; the user authorized implementation and `make demo`
  only.
