# Case 2026-10-19 — FB-030/075 segment auto-advance (verified fixed) + FB-066 quick-add BKS (fixed)

Branch `fix-fb030-fb066` off `38a2d814`. Controller: omp agent.

## FB-030/075 — gõ ngày/giờ KHÔNG tự nhảy segment (brief: "regression lần 3")

### Investigation (live rung 3, local stack :7178→:3003→dev DB, fresh-tab puppeteer)

Driver `testplan/qa/scripts/2026-10-19-fb030-fb066-repro.mjs`, evidence
`qa/2026-10-19_fb030-fb066_repro/`:

- The quick-edit dialog "Chỉnh sửa Lịch trình" (the EXACT dialog the FB-030/075
  ticket names — ShipmentsPage modal, account `cus`):
  - **Day → month advance WORKS**: typing "14" into the "Ngày đóng/trả" day
    segment lands focus on the month segment (`activeSeg: mm2`,
    `activeLabel: "Tháng — Ngày đóng/trả"`, `dd: "14"`). Screenshot
    `fb030-dialog-after-day14.png` shows `14 /MM/YYYY` with MM selected.
  - **Giờ typed-complete → day hand-off WORKS**: typing "1430" into Giờ
    formats "14:30" and moves focus to the Ngày day segment (`activeSeg: dd`).
    Screenshot `fb030-dialog-after-gio1430.png`.
- The segment engine (`DateTimeSegments`) auto-advances on a complete in-range
  digit pair; the two prior fixes (`4efa6e2c` ledger `onComplete` wiring,
  `692522c1` TimeInput HHmm normalise + ArrowDown focus) are BOTH in HEAD.

### Why R23 QA still reported FAIL

R23 report (`/tmp/req/r23.md`) flagged FB-030/075 FAIL in batch **B5 — Kế
toán** on staging build **`597e4c84`**. Git ancestry check:

```
git merge-base --is-ancestor 4efa6e2c 597e4c84  → NOT an ancestor
git merge-base --is-ancestor 692522c1 597e4c84  → NOT an ancestor
```

Build `597e4c84` predates BOTH fixes, so the R23 FAIL is a **stale-build
artifact**, not a live defect at HEAD. There is no R25 QA report in the repo —
`/tmp/req/r25.md` is the LCL "Gán xe nhóm" operation guide, not a QA verdict;
the brief's "R25 QA xác nhận vẫn không tự nhảy" is not backed by any QA report.

### Verdict — FB-030/075: FIXED at HEAD, NO code change

Live rung-3 evidence on the exact QA-named surface proves the auto-advance
works. No failing third host exists among the named surfaces (quick-edit
dialog, container ledger editor, create form — all use the shared segmented
engine). Per the delivery contract I did NOT fabricate a redundant fix.

## FB-066 — thiếu nút thêm nhanh BKS (FIXED)

### Surface

The LCL "Gán xe nhóm" dialog (`AssignTruckGroupDialog`, r25 guide step 3 +
lclspec) and the "Đổi BKS nhóm" edit dialog (`LclGroupTruckEditDialog`,
chungtu-dieuvan B.1) both render the "BKS thực" picker as a `USearchableField`
with free-text (`gõ mới`) but **no quick-add registration button** — a
dispatcher meeting a brand-new plate had to leave the flow and register it in
the fleet catalog. The dispatch editor and trip form already owned this
affordance; the two LCL dialogs did not.

### Fix

- New shared affordance `frontend/src/components/shared/QuickAddButton.tsx`
  (+css) — the ONE implementation of the "+ Thêm nhanh" button, so a third CSS
  copy never lands (the dispatch editor and trip form each grew their own).
- `AssignTruckGroupDialog.tsx`: "BKS thực" field wrapped in a head row carrying
  `QuickAddButton` (shown when own-fleet or an external nhà xe is picked);
  mounts `QuickAddVehicleDialog` (existing card 20261004_357 contract — internal
  truck POST /trucks, external POST /carrier-fleet-vehicles). The created plate
  is preselected and folds into the option list (`fleetNonce` re-runs the fleet
  fetch; own-fleet refetches the catalog). New `AssignTruckGroupDialog.css`.
- `LclGroupTruckEditDialog.tsx`: same affordance on its "BKS thực" field,
  keyed on the lot's own `carrierType`/`externalCarrierId`.

### Regression cases (AGENTS.md §6)

- CP-FB066-01: Gán xe nhóm dialog — with a nhà xe (external) chosen, "BKS thực"
  shows "+ Thêm nhanh"; with no source picked, it stays hidden.
  → `AssignTruckGroupDialog.test.tsx` (2 pins: external + own-fleet).
- CP-FB066-02: Đổi BKS nhóm dialog — "BKS thực" shows "+ Thêm nhanh" for the
  lot's existing nhà xe. → `LclGroupTruckEditDialog.test.tsx` (1 pin).

## Gates (all green)

| Gate | Command | Result |
|---|---|---|
| FE typecheck | `cd frontend && npx tsgo -b` | exit 0 |
| FE typecheck (tsc) | `cd frontend && npx tsc -b` | 0 errors |
| Root lint | `pnpm lint` | exit 0 |
| Scoped vitest (FB-030 surfaces + dispatch dialogs) | TimeInput, DateTimeSegments(+hosts), ShipmentContainerScheduleEditor, AssignTruckGroupDialog, LclGroupTruckEditDialog, DispatchPlanEditorCell, DispatchDetailPlanPage.lcl-assign-reason | 8 files / 149 tests pass |

## UI coverage (AGENTS.md §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| FB-030/075 quick-edit dialog day "14" → month focus | UI DRIVEN | `qa/2026-10-19_fb030-fb066_repro/fb030-dialog-after-day14.png` + probe records (`activeSeg: mm2`) | Mobile ≤640px; roles other than cus |
| FB-030/075 quick-edit dialog Giờ "1430" → day hand-off | UI DRIVEN | `…/fb030-dialog-after-gio1430.png` + probe records (`activeSeg: dd`) | Same as above |
| FB-066 "+ Thêm nhanh" button beside BKS thực (Gán xe nhóm) | UI DRIVEN | `qa/2026-10-19_fb066_quickadd/fb066-02-quickadd-button.png` | Roles other than dispatcher |
| FB-066 quick-add dialog opens from that button | UI DRIVEN | `…/fb066-03-quickadd-dialog.png` | Actual plate-create POST (not exercised end-to-end in the drive) |
| FB-066 regression pins (button presence external/own/Đổi BKS) | Automated unit | scoped vitest 18/18 on the two dialog suites | — |
