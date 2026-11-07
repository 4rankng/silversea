# SIL-721 (id 841) — Kế toán (và Giám đốc) mở khóa được lô hàng + xem lịch sử khóa

- Ticket: SIL-721 (board SIL, id 841, báo cáo 07/11/2026; tái hiện trên staging
  vantai.tingting.vip, build 95e2bd13).
- Owner quyết định 07/11: "giam doc, ke toan, quan tri deu mo duoc" — mở khóa
  lô + xem lịch sử khóa cho 3 vai. Supersedes điểm chốt SIL-679 (04/11)
  "admin-only, non-admin 403 = PASS" đối với Kế toán + Giám đốc.
- Vai "Giám đốc" trong hệ thống = `Role.MANAGER` (seed-prod.ts
  `ROLE_BY_GROUP`: 'Ban Giám Đốc' / 'Giám đốc' / 'PGĐ' → MANAGER; user
  `giamdoc`). Không có enum DIRECTOR.

## Bug (kết quả thực tế trước fix)

1. Kế toán (hoapt) POST `/api/shipments/:id/unlock` → **403 'Không có quyền
   truy cập'**; lô vẫn khóa. Quản trị cùng lệnh → 200.
2. Kế toán GET `/api/shipments/:id/cost-lock-history` → **403**.
3. FE: nút MỞ KHÓA + mục Lịch sử khóa chỉ render cho Role.ADMIN.
4. Thông báo lô khóa còn ghi "Cần ADMIN mở khóa (kèm lý do)".

## Case pin (expected sau thay đổi)

1. BE route `POST /:id/unlock` → `requireRoles(Role.ADMIN, Role.MANAGER,
   Role.ACCOUNTANT)`; GET `/:id/cost-lock-history` cùng clearance.
   Vai khác (CUS/DISPATCHER/OPS/DRIVER) giữ 403.
2. Lý do mở khóa vẫn bắt buộc (1–2000 ký tự) + audit
   `SHIPMENT_COST_UNLOCKED` trong cùng transaction; Debit-Note claim vẫn chặn
   mở khóa (409 nêu số chứng từ).
3. `SHIPMENT_COST_LOCKED_MESSAGE` đổi thành "Cần Quản trị, Giám đốc hoặc Kế
   toán mở khóa (kèm lý do)".
4. FE `ShipmentDebitWorkspace`: `canUnlock` = ADMIN ∨ MANAGER ∨ ACCOUNTANT —
   nút MỞ KHÓA + section Lịch sử khóa hiện cho cả 3 vai; ẩn với vai khác.
5. Giám đốc (MANAGER) mở khóa không cần tài khoản staging riêng — role mapping
   là bằng chứng (seed-prod); unit pin mới là gate.

## Regression evidence

- `cd backend && npx tsx --test src/tests/unit/shipment-cost-unlock.test.ts
  src/tests/unit/shipment-cost-lock-history.test.ts
  src/tests/unit/cost-lock-debit-note-guidance.test.ts` → 25/25 pass
  (qa/2026-11-07-lane-g1/).
- FE `ShipmentDebitWorkspace.test.tsx` — it.each 3 vai thấy unlock+history,
  it.each 4 vai khác không thấy → pass (full suite run 2026-11-07).
- Full BE unit 971/971; BE tsc 0; FE tsc 0 (qa/2026-11-07-lane-g1/README).
