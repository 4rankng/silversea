# HANDOFF — 2026-10-18 — card 181026143000 LCL form labels + dispatch sync (VERIFIED-AT-BASE)

Controller: agent session `fix-lcl-form-labels-dispatch` (worktree
`/Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-form-labels-dispatch`,
branch `fix-lcl-form-labels-dispatch`, base = main `64c6d8e1`).
Last updated: 2026-10-18 ~15:05 local.
Handoff trước (watchdog cycle 2026-10-18, cards 171026123000/171026154000/
181026021137/reds-wave1/111026105610) đã merge xong và nằm trong git history —
deploy chain của cycle đó vẫn do watchdog main checkout sở hữu, không đổi.

## Goal & status

Spec 2026.10.17 (docx `doc_58c2e6857719`): (1a) label động Nhà máy/Kho theo
Hình thức XNK; (1b) LCL bắt buộc Nhà máy trừ «Lệnh chạy ngoài»; (1c) combobox
chọn danh mục/gõ tự do + «+ Thêm kho»/«+ Thêm nhà máy»; (1d) ô Kho lên card
«Điểm vận hành & tuyến», card «Thông tin hàng» chỉ còn trường hàng; (2) cột
Nâng/Trả trên Kế hoạch Tổng quát + Chi tiết Xe hiển thị đúng điểm lô LCL theo
chiều XNK.

**Status: DONE — verification card. Toàn bộ spec đã có tại base** nhờ FB-105
(commits `5a17e299` create form + `3628dae4` dispatch, user directive
2026-10-17, landed trước khi card này được cắt 14:30 ngày 18/10). Không có gap
cần sửa code; không viết code trùng. Deliverable của branch: testplan case
matrix + gate evidence + handoff này. Spec-item → file → test map đầy đủ ở
`testplan/2026-10-18-card-181026143000-lcl-form-labels-dispatch.md`.

## Quyết định tại chỗ spec mơ hồ (tóm tắt; chi tiết trong testplan)

1. Premise «label fix cứng» đã stale — FB-105 xử lý trước; verify, không churn.
2. Chưa chọn Hình thức XNK → giữ label trung tính tiền-FB-105 (pinned có chủ đích).
3. Kho (CFS/Cảng) cũng bắt buộc (spec vẽ «*» trên label; validation FB-105 yêu
   cầu cả 2 điểm — nhất quán).
4. Tên cột Tổng quát «Cảng nâng/Cảng hạ» vs Chi tiết «Nâng hàng/Trả hàng» —
   cùng đọc một rule `resolveLiftDropPoints` (liftDropPoints.ts).
5. Tên gõ tay lưu vào pickup/delivery_location và hiện đúng cột theo chiều.

## Scope / non-goals

- Không đổi code sản phẩm, schema, RBAC, tính toán tài chính.
- Non-goals: full FE/BE suite (scoped đã phủ mọi file test chạm spec), UI
  driver rung 3 (xem Phạm vi không cover trong testplan), các surface ngoài
  spec.

## Files owned by this task

- `testplan/2026-10-18-card-181026143000-lcl-form-labels-dispatch.md` (mới)
- `qa/2026-10-18_lcl-form-labels-dispatch_*.log` (6 artifact, force-tracked)
- `HANDOFF.md` (tài liệu này)

Không có thay đổi nào trong `frontend/src`, `backend/src`, `shared/src`.

## QA artifacts & results (tất cả EXIT 0)

- FE vitest scoped (10 file: lcl-points, mode-toggle, asterisk-contract,
  create-model, liftDropPoints, MasterPlanGrid.lcl-display, DetailedPlanGrid
  + lcl-grouping, ClerkShipmentCreatePage, ShipmentDetailPage): **243/243** →
  `qa/2026-10-18_lcl-form-labels-dispatch_fe-vitest-scoped.log`
- BE scoped (dispatch-plan-lift-drop-lcl, shipment-list-lcl-site-projection,
  shipment-detail-lift-drop-projection; dev DB :5441): **4/4** →
  `qa/2026-10-18_lcl-form-labels-dispatch_be-scoped.log`
- FE `tsc -b`, BE `tsc --noEmit`, root `pnpm lint`, `make build` → 4 log còn lại.

## Blockers / next step

Không có blocker. Next: merge/đóng card 181026143000 như duplicate-verified.
Rung UI: các claim của card này dừng ở TEST-VERIFIED (vitest against real
components) + CODE-READ; không claim UI DRIVEN nào.
