# QA cut 1c — Driver fixture creation attempt

**Status:** BLOCKED — could not create populated driver fixture end-to-end on this turn. The dispatch-edit dialog is stuck on "Đang tải..." (Loading...) and the operations tags picker is reachable only via the inline `DispatchPlanEditorCell` which requires a row-level click I could not trigger to enter edit mode.

## What I verified (rung 3, real staging, real DOM)

### As dungnv (DISPATCHER) on /dispatch-detail
- Cleared localStorage + sessionStorage; re-logged in as `dungnv` / `Abc123` → redirected to `/dispatch` (DISPATCHER home) cleanly.
- Navigated to `/dispatch-detail`. 11 rows in `.detailed-plan-grid__row` (10 plated, 1 unplated "Chưa có số"). 6 rows have `.dispatch-assignment-cell__quick-issue` buttons.

### Dialogs opened during fixture attempt
- **Click on `.dispatch-assignment-cell__trigger`** (the carrier cell): opens dialog titled "Phân xe lại" with fields Loại xe / Xe nhà / Xe đầu kéo / 15H-021.39 / Lái xe / Xác nhận phân xe lại. Stays on "Đang tải..." (Loading...) — carrier list never resolves. No operations tags in this dialog.
- **Click on `.dispatch-assignment-cell__quick-issue`** (the send icon button): opens dialog titled "Phát lệnh · EBKG18452303" with Tên tài xế / SĐT tài xế / CHỌN NHANH NGÀY / GIỜ CHẠY / GIỜ KẾT THÚC / NGÀY CHẠY / KHUNG GIỜ PHỔ BIẾN / Hủy / Phát lệnh. No operations tags picker.
- **Click on `.detailed-plan-grid__cell--notes`** (the Ghi chú cell, currently shows "Xe: Xưởng 2"): no effect — no inline editor opens. The notes cell is a static `<div>`.

### Master-plan alternative path
- Navigated to `/dispatch`. 9 rows with "Phân bổ nhà xe" buttons. Clicked the first one → opened popover titled "Phân bổ nhà xe" with container types + carrier list. NO operations tags picker in this popover either. (This popover is `DispatchAllocationPopover`, separate from `DispatchPlanEditorCell`.)

### Code location of the operations tags picker
- File: `frontend/src/features/dispatch/detailed-plan/DispatchTaskTagEditor.tsx` — the "Ghi chú tác vụ" composer with class `.dispatch-assignment-dialog__notes-label`.
- Mounted from `DispatchPlanEditorCell.tsx` line 714 inside the `DetailedPlanGrid` rows.
- The editor is rendered when the row is in edit mode — but no UI affordance I could click (carrier trigger, quick-issue, notes cell, container cell) opens that edit mode in the current staging render.

## What I could NOT do
- **Set 2-3 tác vụ tags via the picker** — the picker is not visible in any reachable dialog. The carrier REASSIGN and quick-issue dialogs lack it; the inline `DispatchPlanEditorCell` doesn't appear in the DOM in an editable state.
- **Issue the order with driver assignment** — the carrier REASSIGN dialog is stuck on "Đang tải..." (the carrier-list API call appears not to resolve in this staging cut).
- **Populate any DRIVER account's /my-trips** — no order issued, no operationalNotes set, no driver assignment created.

## Why this is a blocker, not a code regression
- Cycle-2 unit tests for `DriverTripsPage` (11/11 green) and `useDispatchTaskTags` (2/2 green) PASSED on commit 9b2744b6 (FE) + 13b68a2b (BE).
- The cycle-2 unit test `renders operation task chips from operationalNotes` confirms the FE wiring: `parseNote` + chips section + free-text-not-chip + displayOrder pass-through. The code contract is intact.
- The blocker is operational (staging render + dialog state) rather than a code regression.

## Possible next-cycle approaches
- **API-level fixture**: use `db_query` (when a staging DB connection is registered) to set `shipments.operationalNotes` + `shipment_fulfillments.driver_id` + `trucks.plate` directly for one of the 38 DRIVERs. This bypasses the dispatch UI dialog entirely and produces the populated card the driver view needs.
- **Different UI trigger**: there may be a "Chỉnh sửa" button on the row's container cell or a right-click context menu I did not discover. A second QA cycle can enumerate `[role=button]` + `[class*=edit]` + `[class*=action]` triggers per row.
- **Fix the carrier-list API**: the "Đang tải..." stuck state suggests `GET /api/dispatch/carriers` is not returning a list. If a debug log or network capture were available, the root cause could be identified.

## Honest rung labels
- RBAC fix verified rung 3 (drivers reach /my-trips no 403).
- Dispatch-detail page wiring verified rung 3 (rows, triggers, quick-issue buttons render).
- Operations tags picker reachable from driver / dispatch-detail UI: rung 1 — present in code (DispatchTaskTagEditor.tsx), not reachable from any UI affordance I could click in this staging cut.
- TC-DRV-MOBILE-001..007 + TC-REPLACE-TAGS-002: rung 1 — code covered by cycle-2 unit-test green; UI not driven against a populated card this turn.

## Artifacts
- `qa/2026-09-10_driver-fixture-cut1c.md` — THIS report.
- Prior artifacts: `qa/2026-09-10_driver-mobile-ui_cycle2-reverify.md`, `qa/2026-09-10_driver-mobile-ui_cut1b.md`.
