# Case QA-2026-10-24-SIL177 — Xóa container đang mang tờ khai phải bị chặn

Ticket SIL-177 (board plan.tingting.vip). Surface: drawer "Chi tiết container"
(/shipments → drawer) và bảng Chi tiết lô — nút "Xóa container" (CUS-10).
QA R42: xóa MSKU1234586 (mang tờ khai Q1-DECL-177) trên staging fe966b30
THÀNH CÔNG, không lý do — guard chỉ còn chặn theo đường điều xe/lịch hẹn.

## Root cause

`removeCusShipmentContainer` (cus-workspace remove endpoint) không đọc
`shipment_containers.declarationNumber` — dòng đang mang số chứng từ bị
hard-delete, bỏ sót cả đường reconcile của "Sửa thông tin lô"
(`reconcileShipmentContainersInTx`) vốn xóa mọi dòng bị payload bỏ quên.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL177-R1 | Xóa cont KHÔNG tờ khai, chưa điều xe | Xóa thành công như cũ (dialog confirm → toast, list refresh) |
| SIL177-R2 | Xóa cont CÓ tờ khai (ví dụ Q1-DECL-177) | 409 `Cont có tờ khai <số> — gỡ tờ khai trước khi xóa dòng container.`; dialog giữ mở, toast lỗi hiện đúng lý do; dòng không mất |
| SIL177-R3 | "Sửa thông tin lô" gửi payload BỎ quên cont mang tờ khai | Cả save bị 409 với cùng message; lô không đổi |
| SIL177-R4 | Mọi role (ADMIN/MANAGER/CUS/DISPATCHER) | Không có ngoại lệ admin — cont có chứng từ bị chặn "đúng lý do" (spec card 211026094500) |
| SIL177-R5 | FE empty-state | Sau xóa cont thường, ledger + overview drop dòng ngay (refresh hiện có, không hồi quy) |

## Rule (nguồn)

Spec CUS-10 card 211026094500: "xóa được cont thường, cont có chứng từ bị
chặn đúng lý do"; QA R42 verdict coi tờ khai = chứng từ.

## Verify

- Unit: `backend/src/tests/unit/cus-container-remove-tokhai-guard.test.ts`
  (wiring guard ở CẢ hai đường remove + reconcile, message nêu số thật).
- Probe (rung 2): `qa/scripts/2026-10-24-sil177-remove-declared-probe.mjs`.
