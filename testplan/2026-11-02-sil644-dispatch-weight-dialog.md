# SIL-644 (id 749) — wave 2: the DISPATCHER-side weight path (Sửa điều phối dialog)

Re-opened by QA 02/11 (comment 3436): the first fix (76c4e77d) opened the CUS
ledger path, but the dispatch "Sửa điều phối" dialog still has NO cargo-weight
input — "dialog điều xe vẫn KHÔNG có trường nhập trọng tải". Option (A) of the
ticket demands the path from BOTH role surfaces.

## Case ID: SIL-644-D (dispatcher dialog weight field)

**Repro (QA staging, build 928a752a):** Điều vận → Kế hoạch Chi tiết Xe → row
menu "Sửa điều phối": the dialog edits carrier/plate/classification/money/
schedule but offers no weight field; the weightless container still needs a
role switch to Chứng từ to be healed.

**Expected behavior**

1. The "Sửa điều phối" dialog (DispatchPlanEditorCell — both the table cell
   mount and the mobile card-list mount) renders a "Trọng lượng" (kg) input for
   FCL container rows (`shipmentContainerId != null`), seeded from the
   container's `cargoWeightKg`.
2. Editability law (mirrors the BE write law, `cus-shipment-workspace-writes
   .service.ts:406-436`): editable while NOT issued — `tripId == null` (chưa
   điều xe / điều xe chưa phát lệnh) OR `tripStatus === 'CREATED'` (assignment
   window). Once the live trip LEFT CREATED (IN_TRANSIT/COMPLETED) the field is
   disabled with a visible reason; the value stays readable (never hidden).
3. Saving rides the SAME "Lưu thay đổi" button: an edited weight sequences a
   cus-workspace container-line write (DISPATCHER is an allowed writer) on the
   plan save's returned shipmentVersion — the same sequencing the Giờ điều vận
   appointment write already uses. No separate save button.
4. A touched weight counts as `planDirty`: "Phát lệnh" stays blocked behind
   "Lưu thay đổi điều phối trước khi phát lệnh" (an unsaved weight must never
   ride an issue — the first-issue "Thiếu trọng tải" 409 backstop reads the
   STORED container weight).
5. Issued-trip lock regression: weight writes on a trip that left CREATED keep
   the server 409 "Container đã gắn chuyến xe (…)" — unchanged law.

**Verification plan**

- FE unit: `DispatchPlanEditorCell.sil644-weight.test.tsx` (field presence /
  window editability / issued-disabled / save body / planDirty gating / LCL
  absence / clear-null).
- Hook unit: `useDispatchDetailPlan` sequencing — weight rides the container-line
  write after the plan PATCH (merged with the appointment write when both are
  touched), versions chained from the plan result.
- BE unit (extends `sil644-container-weight-lock.test.ts`): DISPATCHER is an
  allowed writer on the container-line route; the dispatch detail-plan wire
  carries `shipmentContainerId` + the container weight for both row families.
- QA rung 3 (local stack, qa/scripts/2026-11-02-sil644-dispatch-dialog.mjs):
  reproduce the dead-end state (assigned, live trip CREATED, weight NULL) →
  dieuvan opens Sửa điều phối → weight input ENABLED → type 20000 → Lưu thay
  đổi → DB `cargo_weight_kg = 20000.00` → Phát lệnh succeeds, trip carries
  20000. Disabled-state check on an issued row (any live trip ≠ CREATED on the
  dev DB) — read-only dialog open + assert.

**Out of scope:** the TripReassignDialog ("Phân xe lại" on issued trips) —
governed reassignment, not the assignment window; LCL lot-level weight (no
container line — stays a CUS lot-level edit); `frontend/src/features/shipments/create/**`,
`ShipmentsPage.tsx`, `design-system/**` (forbidden by lane contract).

## Results (02/11, wave 2 — CLOSED GREEN)

Scope grew by one finding during recon: the row ⋯ menu reroutes live-trip
rows (the dead-end state) to **TripReassignDialog** ("Phân xe lại"), so the
field had to land in BOTH dialogs — plan editor (READY rows) and reassign
dialog (DISPATCHED+CREATED rows). A second recon finding: the editors must
seed from the CONTAINER's own column (`cargoWeightKgRaw`, new wire key) —
the merged lot-level fallback made a weightless container LOOK weighted.

- Tests: FE +16 new / 1 superseded pin / BE +2 — all green (FE dispatch tree
  516/516, FE full 6088/6090 with 2 load-flakes green in isolation, BE
  750/750, tsc×2 0 errors, lint 0 errors, make build OK).
- QA rung 3: 24/24 — `testplan/evidence/sil644-dispatch/dialog-drive/`
  (P0 dead-end recreation → A "Phân xe lại" heal → P2 re-issue 201 →
  B plan-editor path + Phát lệnh gating → C IN_TRANSIT lock → D 390px).
- Full report: `plans/reports/sil644-report.md`.
