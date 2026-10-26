# SIL-495 — Hồi quy: tìm kiếm Bill/Booking trên Kế hoạch làm hàng (/ops/orders)

Ngày: 2026-10-26 · SIL-495 · branch `fix-554-556-557-dispatch`

## Bug

Ô tìm kiếm (placeholder "Bill/Booking · Khách hàng · Số cont") trả "0 lô" khi
gõ mã Bill/Booking đang hiển thị trên chính danh sách (R42DIS-01, R42DIS,
R42…) — trong khi search khách hàng ("LONG MINH") và số cont
("MSKU4100003") hoạt động.

## Nguyên nhân

`listOpsOrders` chỉ match `shipment_code` · `customers.name` · số cont
(correlated exists) — thiếu 2 cột tham chiếu `bl_number` (IMPORT) /
`booking_ref` (EXPORT), tức đúng cột mà trang render ở cột "Bill / Booking".

## Fix

Thêm `ilike(bl_number)` + `ilike(booking_ref)` vào nhánh search (cùng needle
`%trim()%`, cùng shape search điều phối `dispatch-planning-utils.service.ts`).
Không đổi UI — placeholder đã quảng cáo đúng; chỉ thiếu điều kiện query.

## Trường hợp kiểm

| # | Màn hình | Trường hợp |
|---|----------|-----------|
| R1 | /ops/orders | Gõ MÃ Bill/Booking ĐẦY ĐỦ (R42DIS-01) ⇒ đúng các lô khớp, không còn "0 lô" |
| R2 | /ops/orders | Gõ PREFIX (R42DIS, R42) ⇒ mọi lô R42* trong ngày |
| R3 | /ops/orders | Không hồi quy: search khách hàng (LONG MINH) + số cont (MSKU…) vẫn chạy |
| R4 | /ops/orders | EXPORT lot: search booking_ref; IMPORT lot: search bl_number — cột nào hiển thị thì cột đó match |

## Evidence

- BE unit (source-scan pin — service db-bound, unit-only ruling 19/10):
  `backend/src/tests/unit/ops-orders-search-columns.test.ts` 3/3; BE unit
  full 500/500; backend tsc --noEmit 0 (qa/2026-10-26-sil495-*).
- FE scoped: OpsOrdersPage.test.tsx + features/ops 13 file / 89 test pass.
- API/UI: QA staging retest R1/R2 với lots thật (dungnv/hoangnh).
