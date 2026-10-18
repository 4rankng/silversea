# HANDOFF — 2026-10-18 — card 191026100010 (chứng từ điều vận B + Lái xe C)

Controller: omp agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-dieuvan-laixe`,
branch `fix-dieuvan-laixe` (off `a9e4b75b` + style commit `c1f412f8`).
Updated: 2026-10-18 ~23:10 +0800.

## Goal & status

Source `chungtu-dieuvan.docx` mục B (/dispatch + /dispatch-detail) và C (driver
portal `/api/driver/me/*`), 7 items. **Status: DONE** — committed as
`fix(dispatch-driver): B.1-B.5 + C.1-C.2 đổi xe/phát lệnh/tác vụ/bãi hạ (card 191026100010)`
and PUSHED. KHÔNG deploy (owner rule).

## What landed (per item)

- **B.1 FIX** — after "Gán xe nhóm" there was no way to change BKS. Added
  `LclGroupTruckEditDialog.tsx` (+css) on the EXISTING `updateLclTruck`
  (FB-093, `POST /api/shipments/lcl/truck`) with two affordances: the
  "Đổi BKS nhóm" row action in the Nhóm ghép trả ĐV menu, and the group
  line + button inside the "Chỉnh sửa điều phối" popup; grouped-row plate
  edits in the popup now run `updateLclTruck` BEFORE the atomic plan save
  (clear/defer refused on grouped rows). "Đơn" rows already had Sửa /
  Phân xe lại (verified, no change).
- **B.2 VERIFY** — external issue-before-plate already landed (cards
  20261004_359 `6c5836f3`, `68187f33`); re-verified via the "Bổ sung sau"
  FE describe + `trip-factory-snapshot.test.ts` BE describes. Internal keeps
  its mandatory plate.
- **B.3 VERIFY** — the ĐẢO VỎ auto-seed already removed (card 20261005_362
  `390dc945`); pin re-verified ("choosing Lấy Lẻ seeds NO tag").
- **B.4 FIX** — the quoted hard 409 "Đầu xe X đã được gán cho lô/tác vụ khác
  trong khung giờ trùng lặp." fired on the DELIBERATE "Gán xe nhóm"
  arrangement (one group = one truck). Cost-group siblings (same non-null
  `costGroupId`) now split out of the cross-lot HARD tier into the existing
  warn-once tier (RIG_OVERLAP_COMPLETED + " Vẫn lưu?") in BOTH
  `assertPlanRowRigAvailable` and `assertTripRigAvailable`; cross-lot
  overlaps without a shared group keep the hard block (pinned), and a
  sibling's weak slot never downgrades a true holder (mixed-set pin).
- **B.5 VERIFY** — container-bold/port-normal already landed (card
  20261005_361 `11f4ec4c`); pinned by the NEW
  `DetailedPlanGrid.container-port-weight.test.tsx` contract test.
- **C.1 FIX** — driver "Cảng hạ" resolves through the shared
  `resolveLiftDropPoints` rule (LCL direction swap: Nhập → Hạ = Nhà máy /
  bãi trả; Xuất → kho). FCL chain byte-identical (port → free text → FB-020
  snapshot), EXPORT never borrows the factory, legacy returnDepot precedence
  kept.
- **C.2 VERIFY** — SĐT kho tel: link already landed (card 20261005_364
  `26dee2d1`); driven live (anchor + href + click).

## Adjacent fixes required to turn the gates green (both one-liners)

- `frontend/src/features/expense-accounting/ShipmentExpensePanel.test.tsx` —
  removed an unused `waitFor` import (root lint was red from card 09ff9406).
- `testplan/qa/scripts/2026-10-18-fb095-fb094-ui-driver.mjs` — its QA_BASE
  DEFAULT was `localhost:7176`, breaking the dev-port contract test; default
  is now the documented 7175 (env override unchanged).

## Evidence

Regression plan + verdicts: `testplan/2026-10-18-card191026100010-dieuvan-laixe.md`.
Gates (all green, logs in `qa/2026-10-18_card191026100010_*`): FE 5152/5152,
fe-tsc 0, be-tsc 0, BE overlap 13/13 (repro red→green: exact quoted hard 409
before, warn-once after), BE unit 305/305, lint 0, `make build` 0.
UI rung-3 (driver `laixe`, token-injected): `qa/…_ui-c1-before.png` (main
build: "Chưa có cảng hạ" beside the delivery row naming the yard) vs
`…_ui-c1-after.png` (fixed: "Bãi JJ LOGISTICS"); `…_ui-c2-*.png` tel: link
click; driver log + API/DB identity file alongside. QA fixture edits
(trip 60516/67894 driver, shipment 104507 factory_name) were REVERTED after
capture.

## Deliberate non-changes / limits

- Master plan (/dispatch) got no new affordance: the card named "popup điều
  phối + row actions" (both on /dispatch-detail); the master-plan allocation
  popover remains editable pre-issue and issued lots still reassign via
  /dispatch-detail "Phân xe lại".
- Group NHÀ XE (carrier) change for a grouped lot is still the per-row popup /
  Phân xe lại path; `assignLclCostGroup` regroup semantics untouched (money
  law).
- The issue-time gate (`dispatch-resource-availability`) was NOT weakened:
  FB-012's same-lot carve-out there is unchanged; the quoted message never
  came from that gate.
- Driver-portal backend chain untouched (FB-020 `resolveDeliveryStage` keeps
  owning FCL); no LCL-IMPORT trip with a real factory existed in the local
  dev DB, so the C.1 UI drive used a locally seeded factory name on fixture
  lot 104507 (reverted).

## Next step

Independent review verdict (Card1910Review) recorded in the session; any
post-commit findings resolve as forward fixes. Awaiting owner merge/deploy
instruction — NEVER deploy.
