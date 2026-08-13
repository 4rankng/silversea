---
date: 2026-08-13 17:30
component: CUS shipment workspace
status: verified-local
---

# CUS Read-only Container Detail

## Context

The CUS shipment master was carrying a dedicated detail column and an expanded
surface that read too much like an edit form. The approved boundary keeps
shipment-level transport and custody controls in the master workflow while
presenting per-container operational facts in a compact second layer.

## What happened

The dedicated `Chi tiết` track was removed. Activating a shipment row now opens
its container ledger read-only; `Chỉnh sửa` is the explicit transition to only
the CUS-authorized per-container controls and row-level save. `Thu gọn` closes
the inline ledger, and the mobile drawer retains the same read-only-first
contract.

## Decisions and safeguards

- Keep container, carrier, plate, type, lift/drop-off, and close/return in the
  ledger; do not repeat shipment transport date or document custody there.
- Require confirmation before discarding unsaved container edits. Inline
  collapse and mobile close paths are blocked while a save is in flight.
- Preserve sibling drafts when a successful row save advances the shipment
  version.
- Use a fixed compact desktop ledger and labelled drawer grid so 1440px through
  320px layouts do not introduce horizontal overflow.

## Touchpoints

- `frontend/src/pages/ShipmentsPage.tsx`
- `frontend/src/pages/ShipmentsPage.css`
- `frontend/src/pages/ShipmentsPage.test.tsx`
- `frontend/src/pages/ShipmentsPage.density.test.ts`
- `e2e/test_18_cus_shipment_workspace.py`
- `e2e/test_19_cus_workspace_accessibility_matrix.py`

## Verification

Focused review and local gates are recorded in:

- `qa/2026-08-13_cus-layer2_code-review.md`
- `qa/2026-08-13_cus-layer2_frontend-test-final.log` — 640 tests passed
- `qa/2026-08-13_cus-layer2_frontend-typecheck-final.log`
- `qa/2026-08-13_cus-layer2_lint-final.log` — 0 errors; existing warnings
- `qa/2026-08-13_cus-layer2_build-final.log`
- `qa/2026-08-13_cus-layer2_e2e-workspace-final.log` — 21/21 passed
- `qa/2026-08-13_cus-layer2_e2e-accessibility-final.log` — 54/54 passed

## Next

No deployment or commit is recorded by this journal. Any release remains a
separate, explicitly authorized operation.
