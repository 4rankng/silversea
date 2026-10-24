# SIL-472 — Xóa container: confirm không xóa được dòng trên màn chi tiết lô

- **Case ID:** SIL-472-REG-1
- **Ticket:** plan.tingting.vip SIL-472 (id 529) — QA Glint, build `e04e7a15` (R42 merge)
- **Surface:** `/shipments/:id` → section "Quản lý container" (`ShipmentDetailContainerManagement` → `CusContainerLedger`) — cùng ledger ở drawer Tổng quan `/shipments`
- **Role:** tiepvv (CUS)

## Reproduction

1. Mở lot detail FCL có ≥2 dòng container, dòng cần xóa đang mang số tờ khai (sau khi lot đã từng nhập tờ khai — SIL-173 auto-copy dán số lên MỌI dòng còn trống).
2. Click "Xóa container" trên dòng → dialog "Xóa container <số>?" hiện.
3. Click nút "Xóa container" trong dialog.

## Observed (local repro trên trunk f1dd21f6, lot 319 dòng 2)

- Dialog KHÔNG đóng; dòng không biến mất; reload vẫn còn dòng.
- Có error toast (QA report "không toast" — toast tự ẩn ~5s, có thể bị bỏ sót): `Cont có tờ khai Q-DECL-177-389454 — gỡ tờ khai trước khi xóa dòng container.`
- Network: `POST /api/v1/shipments/319/containers/.../remove` → **409**.

## Root cause

Không phải wiring onConfirm bị đứt. Click confirm **có** gọi DELETE endpoint, nhưng guard **SIL-177** (card 211026094500, commit cf47ad30, chạy trong build QA) trả 409 cho mọi dòng đang mang `declarationNumber` — và sau SIL-173 auto-copy, mọi dòng của lot từng nhập tờ khai đều mang số ⇒ nút xóa chết với case phổ biến. Thông điệp guard chỉ tên bước recovery ("gỡ tờ khai trước khi xóa") nhưng confirm dialog không thực hiện/đề cập bước đó.

## Expected

Click confirm trên dòng mang tờ khai ⇒ flow "gỡ tờ khai khỏi dòng (container-line command `declarationNumber: ''` — đúng endpoint SIL-177 dùng cho inline edit) → DELETE remove endpoint → refetch ledger → dialog đóng → toast thành công". Dialog phải nêu trước rằng xóa sẽ gỡ tờ khai. Dòng không tờ khai giữ nguyên hành vi cũ (DELETE trực tiếp).

## Regression coverage

`frontend/src/features/shipments/cus/CusContainerLedger.test.tsx` — describe "SIL-472 — confirm xóa dòng mang tờ khai":

1. Dòng mang tờ khai: confirm ⇒ gọi gỡ (`declarationNumber: ''`, version hiện tại) TRƯỚC, rồi DELETE với version fresh trả về từ bước gỡ; `onLineSaved(null)`; dialog đóng. **Đỏ trên code trước fix** (remove 409, không có call gỡ, dialog còn mở).
2. Dòng không tờ khai: confirm ⇒ KHÔNG gọi gỡ, DELETE trực tiếp với version detail (no-regression pin).
3. Gỡ bị 403 (role không có quyền tờ khai): dialog giữ mở, KHÔNG gọi DELETE, toast nêu lý do server.
4. Dialog trên dòng mang tờ khai phải nêu số tờ khai trước khi confirm.
