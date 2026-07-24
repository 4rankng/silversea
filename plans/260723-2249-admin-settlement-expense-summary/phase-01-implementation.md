# Phase 01 — Compact settlement expense summary

## Context

`AdminAdvanceSettlementsPage` currently joins every unique trip/container pair into one unbounded text block under the forwarder name. The list payload already contains enough linked-expense data to produce useful counts, while the existing `/settlements/:id` page remains the authoritative detailed breakdown.

The list payload does not explicitly include completion status or `tripContainerId`. The list must therefore avoid claiming `Ops đã kê xong` or an authoritative general-expense count.

## Files

- `frontend/src/pages/admin-advance-settlement-summary.ts`
- `frontend/src/pages/admin-advance-settlement-summary.test.ts`
- `frontend/src/pages/AdminAdvanceSettlementsPage.tsx`
- `frontend/src/pages/AdminAdvanceSettlementsPage.css`

## Implementation

1. Add a page-specific pure summary helper that derives:
   - linked expense count;
   - unique trip count;
   - unique normalized non-empty container count.
2. Group settlement code and forwarder as the row identity, then give the bounded scope summary its own desktop column.
3. Label the desktop columns `Phiếu / Giao nhận`, `Phạm vi liên kết`, and `Thao tác`.
4. Replace the mobile `Phạm vi` text wall with the same bounded count summary.
5. Move the visible detail/review affordance into the action column so it does not compete with scope text.
6. Switch the ledger to two-column record cards at intermediate widths and one-column cards on phones.
7. Add unit coverage for empty data, duplicate trips/containers, missing container labels, and whitespace normalization.

## Validation

- Focused Vitest file for the summary helper.
- Frontend test suite.
- Frontend lint.
- Frontend production build.
- UI contract check.
- `git diff --check`.
- Authenticated desktop and representative mobile inspection at `/admin/advance-settlements`.

## Constraints

- Frontend-only; no API, schema, shared-type, or financial calculation changes.
- Preserve the seven-column desktop ledger while adapting to record cards before its minimum readable width.
- Use existing NEPO tokens, typography, buttons, and focus behavior.
- No new dependency, drawer, tooltip dependency, chips, truncation, or duplicate detail view.
- Default row/card content must remain understandable with large real settlements.
