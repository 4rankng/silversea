# HANDOFF — 2026-10-18 — card 181026143000 LCL form labels + dispatch sync

Controller: agent session `fix-lcl-form-labels-dispatch` (worktree
`/Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-form-labels-dispatch`,
branch `fix-lcl-form-labels-dispatch`). Last updated: 2026-10-18 ~16:00.
Handoff trước (watchdog cycle đã merge + docs-only verification card) nằm
trong git history của branch này.

## Goal & status — DONE (code + rung 3)

Spec 2026.10.17 (docx `doc_58c2e6857719`, brief /tmp/silversea-army2):
§1a–§1d form LCL + §2 dispatch sync. Phần lớn đã có tại base nhờ FB-105
(`5a17e299` + `3628dae4`). Phiên này drive UI rung 3 toàn chuỗi, tìm và sửa
**2 defect thật** (commits trên branch):

1. `032145a2` fix(forms) §1a — kho quick-add dialog đặt tên theo chiều:
   Xuất khẩu = «Thêm kho trả hàng», Nhập/neutral = «Thêm kho lấy hàng»
   (trước fix: hard-code «lấy hàng» cho cả 2 chiều — đúng lớp lỗi spec nêu).
   Files: `OperationalSiteCreateDialog.tsx` (prop `tradeDirection`),
   `ShipmentCreateModals.tsx`, `ShipmentCreateWorkspace.tsx`, test trong
   `ShipmentCreateWorkspace.lcl-points.test.tsx`.
2. `21121f90` fix(forms) §1c — nút «+ Thêm kho» chuyển về class dùng chung
   `csc-utility-button csc-utility-button--dashed` (bỏ inline palette + fallback
   XANH `#2563eb`, đúng emerald house tokens + one-pattern rule).
   File: `ShipmentCreateLclRouteSection.tsx`, test同 file.

BE không đổi (dispatch shape đã đúng; BE scoped tests xanh lại unchanged).

## Spec-item → file → test (map đầy đủ trong
`testplan/2026-10-18-card-181026143000-lcl-form-labels-dispatch.md`)

§1a label NK/XK + placeholder → `ShipmentCreateLclRouteSection.tsx` +
`OperationalSiteCreateDialog.tsx` (fix) → lcl-points tests + driver rung 3.
§1b validation + ad-hoc waiver → `shipment-create-model.ts` → model tests +
asterisk-contract. §1c combobox + Thêm kho/nhà máy → `ShipmentCreateLclRouteSection.tsx`
(fix class) → lcl-points + ClerkShipmentCreatePage TC-CUS-FACTORY-SEARCH-09.
§1d layout → workspace + `ShipmentCreateLclCargoFields.tsx` → lcl-points.
§2 dispatch 2 màn → `liftDropPoints.ts` + `MasterPlanGrid` + `DetailedPlanGrid`
+ BE `dispatch-planning-detail-plan-read.service.ts` → liftDropPoints /
lcl-display / DSP-PORT-02 / `dispatch-plan-lift-drop-lcl.test.ts`.

## Chỗ spec mơ hồ — cách quyết (chi tiết trong testplan)

1. Premise «label fix cứng» stale ở form (FB-105 đã sửa) nhưng CÒN ĐÚNG ở
   dialog title — đó là 2 defect phiên này sửa.
2. Chưa chọn chiều → label trung tính (pinned có chủ đích).
3. Kho cũng bắt buộc (spec vẽ «*» trên label; validation yêu cầu cả 2 điểm).
4. «Cảng nâng/Nâng hàng» là 2 tên cột trên 2 màn — cùng đọc một rule
   `resolveLiftDropPoints`.
5. Tên gõ tay lưu pickup/delivery_location, hiện đúng cột theo chiều.

## Gates (log trong qa/2026-10-18_lcl-form-labels-dispatch_*.log + 181026143000_*)

- FE vitest scoped 10 file: **245/245** (243 base + 2 fix tests), EXIT 0.
- BE scoped 3 suite (dev DB): 4/4, EXIT 0. FE `tsc -b` 0 · BE `tsc --noEmit` 0
  · root `pnpm lint` 0 · `make build` 0.
- UI driver rung 3 `testplan/qa/scripts/2026-10-18-181026143000-lcl-form-dispatch.mjs`:
  ALL PASS — §1a/§1c/§1d DOM asserts + dialog title 2 chiều, §1b blocked
  submit, TẠO THẬT 2 lô LCL (IMPORT+EXPORT), detail API persisted đúng chiều,
  `/dispatch` + `/dispatch-detail` cột Nâng/Trả đúng chiều. Screenshots
  ui-1..9 + driver.log (exit 0).
- Width sweep `…-widths.mjs` 390/768/1440: dashed class + dialog title + fits,
  ≤40px. widths.log exit 0.

## Coverage table (§9)

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| §1a label/placeholder/dialog title | UI DRIVEN | ui-1..3, ui-5/5b png + driver.log | role khác ADMIN |
| §1b validation + waiver | UI DRIVEN (blocked submit) + model tests | ui-6 png; ad-hoc waiver chỉ assert qua test (driver không click «Lệnh chạy ngoài») | ad-hoc click-through thật |
| §1c combobox + 2 nút Thêm | UI DRIVEN | ui-4/5/5b + width png | tạo site thật qua dialog (chỉ cancel) |
| §1d layout 2 card | UI DRIVEN | driver.log DOM assert | — |
| §2 dispatch columns LCL | UI DRIVEN | ui-8/9 png + detail API rows (lots QA-181026143000-*) | role khác; tháng ≠ 10/2026 |

## Files owned / next step

- Code: 2 commits trên (032145a2, 21121f90) + evidence commit này.
- Side-effect trên dev DB: các lô QA `QA-181026143000-*` (có chủ đích, không
  cleanup). Vite worktree :7176 vẫn chạy (nếu cần lại: `cd frontend && npx vite
  --port 7176 --strictPort`, KHÔNG set VITE_API_BASE — proxy /api đã đúng).
- Next: owner review + merge; card 181026143000 đóng như duplicate-verified +
  2 fix.
