---
phase: 2
title: "Build canonical advances workspace"
status: pending
effort: "medium"
---

# Phase 2: Build canonical advances workspace

## Overview

Compose the existing request and settlement screens under a thin workspace
shell while keeping each screen's data and actions authoritative.

## Implementation Steps

1. Add `AdvanceWorkspacePage` with a single h1, governance link, and native
   query-backed workspace links.
2. Add `embedded` composition support to the existing request and settlement
   pages; suppress only their duplicate headers.
3. Clarify request action copy as `Gửi đề nghị duyệt` /
   `Gửi đề nghị từ chối`.
4. Preserve settlement review copy and direct actions because that lifecycle
   does not use governance for ordinary check/approve/reject.
5. Keep all KPIs, filters, desktop grids, mobile cards, role gates, and focus
   IDs.
6. Add flat responsive workspace styling with 44px controls and no body
   overflow.

## Success Criteria

- [ ] Requests and settlements are both reachable without a second top-level
      finance page.
- [ ] No existing financial totals, filters, actions, or role gates are lost.
- [ ] The workspace explains the request-to-governance handoff accurately.
- [ ] 1440px, 1024px, 768px, 390px, and 320px layouts remain usable.

## Files

- `frontend/src/pages/AdvanceWorkspacePage.tsx` (new)
- `frontend/src/pages/AdvanceWorkspacePage.css` (new)
- `frontend/src/pages/AdminAdvancesPage.tsx`
- `frontend/src/pages/AdminAdvanceSettlementsPage.tsx`
- page-local CSS only as required for embedded/responsive behavior

## Constraints

- No new dependency or global theme change.
- No API/DB/RBAC/ledger/calculation change.
- No mutation of unrelated portal/banner/dashboard files.
