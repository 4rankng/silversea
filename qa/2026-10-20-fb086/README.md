# FB-086 — Sửa lô ở Chi tiết lô (reconciliation TICKET-09) — evidence 21/10/2026

Card: `201026234505` (FB-086, QA R29, build a079aaf5, reporter tiepvv — NV019, role CUS).
Branch: `fix-fb086` (off main be1c65fe). Scope per owner steer 21/10:

1. **Containers ở /shipments/:id GIỮ read-only** — TICKET-09 (card 171026182554,
   17/10) SUPERSEDES FB-086 ở surface Chi tiết-lô: khách KHÔNG muốn thêm/xóa
   container tại màn này. Việc "thiếu nút thêm container" là TRẠNG THÁI ĐÚNG.
2. **FB-086 phần còn hợp lệ = nút "Sửa lô"** (sửa THÔNG TIN lô, không phải
   container) — spec `testplan/roles/01-cus.md` cho CUS "read & write the
   shipment workspace"; backend `PUT /shipments/:id` +
   `SHIPMENT_INTAKE_MUTATION_ROLES` (ADMIN/MANAGER/CUS/DISPATCHER) đã cấp quyền
   sẵn → implement UI reuse, không build API mới.
3. QA verdict R29 = **invalid-at-surface** (kỳ vọng thêm container ở màn mà
   TICKET-09 cố ý chặn) — cần QA biết khi tick lại (xem HANDOFF.md).

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| R29 repro: header /shipments/965 thiếu "Sửa lô", không có "Thêm container" (staging build a079aaf5, role tiepvv) | UI DRIVEN (DOM + driver; screenshot bị host chặn — background tab không paint, DOM snapshot 449 nodes thay thế) | `ui-driver-before.log` (PASS BEFORE, exit 0), `before-staging-detail.png`, lot BKR29FCL01, Containers(2) | staging DB state trước/sau không query trực tiếp (staging là prod-mirror — read-only drive, không có write nào; HTTP ≥400 = 0 trong log) |
| TICKET-09 giữ đúng: KHÔNG nút thêm/xóa container ở chi tiết lô, cả trước lẫn sau fix | UI DRIVEN | `ui-driver-before.log` (`Thêm container present=false`) + `ui-driver-after.log` (same) + vitest pin `ShipmentDetailPage.test.tsx` "offers no Thêm container affordance (card 171026182554)" | các role khác trên staging (chỉ tiepvv được drive; ADMIN/CUS/MANAGER/DISPATCHER được pin bằng vitest role-matrix) |
| SAU fix: nút "Sửa lô" (CUS) → picker 6 nhóm → modal quick-edit dùng chung → lưu thành công | UI DRIVEN | `ui-driver-after.log` (exit 0): picker render đủ 6 nhóm, "Lịch trình" disabled đúng luật FCL, sửa "Hãng tàu" → toast "Đã lưu ô dữ liệu lô hàng" → header repaint marker | viewport mobile (390) chưa drive — cùng modal responsive đã có ở Tổng quan; LCL schedule group chưa drive (pin vitest) |
| DB side-effect (PUT /api/shipments/311567 bởi CUS) | UI DRIVEN (kèm DB proof) | `db-side-effect-before.txt` (version 2, shipping_line_name rỗng) → `db-side-effect-after.txt` (version 3, `QA-FB086-1792514920165`) | — |
| Alias `/shipments/:id/edit` không đổi (vẫn land về chi tiết, card 358) | UI DRIVEN (staging) + CODE pin | `ui-driver-before.log` (alias → chi tiết BKR29FCL01) + `App.shipments-edit-route.test.tsx` xanh trong full run | — |

## Kịch bản 409 (minh bạch)

Run đầu của AFTERdrive chọn lô `311587` (READY_FOR_DISPATCH nhưng KHÔNG có ngày
vận chuyển — dữ liệu QA cũ). PUT bị backend từ chối 409 "Lô hàng đã sẵn sàng
điều xe nên phải giữ ngày vận chuyển…" — đúng luật nghiệp vụ, KHÔNG phải lỗi
của fix; self-heal 409 của quick-edit (drop draft + toast + reload) chạy đúng.
Run sau đó chọn lô `311567` (READY, có ngày) → happy path xanh. Log đầy đủ nằm
append trong `ui-driver-after.log`.

## Gates

- `frontend: npx tsgo -b` = 0 (exit 0)
- `pnpm lint` = 0 errors
- FE vitest FULL: 5342/5343 pass — 1 fail DUY NHẤT `dev-port-contract` do
  `2026-10-20-pwa-standalone-ui-drive.mjs:7199` (script của worktree PWA đã
  merge ở main be1c65fe) — **pre-existing, A/B stash chứng minh trên cây sạch**
  (`gates-fe-vitest-full.log` dòng 20, 28). Script driver của FB-086 TUÂN
  thủ contract (port qua env, không hardcode).
- `make build` = 0 (exit 0)
- Backend/shared: KHÔNG đổi (frontend-only fix).

## Files

- `before-staging-detail.png` — staging /shipments/965 (tiepvv) trước fix.
- `after-detail-header.png` / `after-picker.png` / `after-documents-edit.png` /
  `after-saved-header.png` — local sau fix (cus, lô 311567).
- `ui-driver-before.log` / `ui-driver-after.log` — driver logs + exit status.
- `db-side-effect-before.txt` / `db-side-effect-after.txt` — DB proof.
- `gates-fe-vitest-full.log` — full FE vitest run record.
- Driver: `testplan/qa/scripts/2026-10-20-fb086-sua-lo-ui-drive.mjs`
  (env: QA_BASE/QA_MODE/QA_USER/QA_LOT/QA_GROUP — port theo contract, không hardcode).
