# Card SIL-803 — Hồi quy: chặn ghi chi phí mới trên lô đã khóa (ngăn phoi-phieu)

Ngày: 2026-11-11 · Ticket SIL-803 (id 929, high) · KB §6.2 + PRD §7.9 + SIL-679 nhóm 3

## Lỗi
Lô đã khóa chi phí (costLockedAt != null) vẫn ghi được khoản chi mới qua ngăn
"+ Chi phí" phoi-phieu: POST /api/expense-accounting/entries/batch trả 201
(lô 812 — entry 67/68 vẫn RECORDED trong khi khóa).

Nguyên nhân: `createAccountingExpense` (expense-accounting-create.service.ts)
chỉ gate `assertShipmentAccountingUnlocked`, thiếu gate cost-lock — trong khi
update/reject/void/ops-expenses đều đã gate (SIL-679 r2). Cả /entries lẻ lẫn
/entries/batch đi qua cùng hàm này.

## Kỳ vọng
- Lô khóa: create (lẻ + batch) → 409 `SHIPMENT_COST_LOCKED_MESSAGE`, không
  ghi row nào (batch all-or-nothing giữ nguyên).
- Trip-scoped create trên lô khóa → 409 tương tự (cùng lớp lỗi).
- Lô không khóa: 201 như cũ.
- Các trường tracking-reality (ngày cọc phoi-phieu, tiền đã nhận) vẫn ghi
  được khi khóa (law hiện hành — deposit/meta KHÔNG gate).
- Frontend: drawer hiện lỗi 409 qua role="alert" (đã có sẵn — không đổi).

## Rủi ro hồi quy

| # | Khu vực | Rủi ro | Kiểm |
|---|---|---|---|
| R1 | RBAC | đụng requireExpenseFinance | chỉ thêm assert, không đổi role gate |
| R2 | Tracking fields law | gate nhầm deposit/meta | test pin `doesNotMatch` giữ nguyên |
| R3 | Batch atomicity | 409 giữa batch để rows mồ côi | 409 ném trước insert đầu tiên (assert đầu hàm) |
| R4 | Update/confirm path | không đổi hành vi | test r2 hiện có giữ xanh |

## Kiểm chứng
- `backend/src/tests/unit/shipment-cost-lock-enforcement.test.ts` — thêm pins
  create (lot branch + trip branch).
