# SIL-521 — Số tờ khai theo cont: thêm cột, cho phép trùng, sửa từng cont, bỏ nhập theo lô

> **UPDATE 30/10/2026 (SIL-701, owner ruling — đọc trước khi tin pin dưới):**
> Case pin 1 bị ĐẢO NGƯỢC MỘT PHẦN: form tạo/sửa lô **PHẢI** có cột số tờ
> khai per-cont trong bảng "Thông tin hàng" (nhập được ngay lúc tạo, từng cont
> riêng, không chặn trùng trong lô). Phần "bỏ nhập cấp lô" GIỮ NGUYÊN:
> payload `/shipments/quick` vẫn không mang `declarationNumber` cấp lô, không
> tạo `shipment_declarations` từ input. Xem
> `case-SIL-701-create-form-decl-column.md`.

- Ticket: SIL-521 (board SIL, id 584, In Progress) — quyết định chốt owner
  26/10/2026, chốt lại mô hình dữ liệu tờ khai (liên quan SIL-498, SIL-502).
- Surface: form tạo/sửa lô (`/shipments/new`, `/shipments/:id/edit`), Tổng quan
  containers (`/shipments-detail` — ShipmentContainerLedger), drawer Chi tiết
  lô (CusLotView), BE `/api/shipments/quick`.

## Yêu cầu owner (4 điểm chốt)

1. Số tờ khai quản lý THEO CONT — cột Số tờ khai ở bảng cont (chi tiết lô /
   Tổng quan), mỗi cont có số riêng.
2. Cho phép trùng 1 PHẦN hoặc TOÀN BỘ trong cùng 1 lô — không chặn trùng.
3. Sửa TỪNG cont riêng lẻ — không đồng bộ ép toàn lô (dòng trống chỉ fill qua
   cơ chế copy riêng; sibling giữ số KHÔNG bao giờ bị đè — SIL-498 FB-109).
4. BỎ nhập số tờ khai cấp lô — form tạo lô + mọi điểm nhập theo lô còn lại.

## Case pin (expected sau thay đổi)

1. Form tạo/sửa lô KHÔNG còn strip/chips/textarea "Số tờ khai" cấp lô; payload
   `/shipments/quick` không mang `declarationNumber`; BE schema từ chối key
   (assertKnownShipmentKeys).
2. Tổng quan + drawer: mỗi dòng cont có ô Số tờ khai riêng, sửa được riêng lẻ
   (click-to-edit / inline) — giữ nguyên từ SIL-498/503.
3. Cùng 1 lô: 2 cont trùng số, hoặc tất cả cùng 1 số — lưu OK, không 409
   (guard `assertContainerDeclarationNumberAvailable` chỉ chặn CROSS-lô).
4. Sửa 1 dòng không đè sibling đang giữ số khác; fan-out chỉ điền dòng TRỐNG
   (FB-109); nút copy-declaration điền dòng trống, không đè.
5. Tạo lô mới KHÔNG còn tạo `shipment_declarations` từ input cấp lô (hết
   normalize-all lúc tạo; dữ liệu legacy giữ nguyên — không truncate).

## Phạm vi giữ nguyên (có chủ đích)

- Hàng lẻ (LCL, lot-level pseudo-row): ô tờ khai click-to-edit trên
  ShipmentContainerLedger giữ qua entity API (SIL-503 13:26 cùng ngày; LCL
  không có dòng cont — đây là chỗ nhập duy nhất còn lại). Nếu owner muốn gỡ
  nốt, là quyết định riêng.
- Entity CRUD `/api/shipments/:id/declarations` (documents/finance concern)
  và các đường đọc hiển thị (CHỨNG TỰ, "Số tờ khai (N)") giữ nguyên.

## Gates

- Part 1 (shared+BE): `cd backend && npx tsc --noEmit` 0 lỗi +
  `cd backend && pnpm test` pass + shared schema test pass.
- Part 2 (FE): scoped vitest (create + cus + detail) + `tsgo --noEmit` 0.
- Rung-3 driver: tạo lô không còn ô tờ khai cấp lô; sửa tờ khai per-cont tại
  Tổng quan; trùng số lưu OK.
