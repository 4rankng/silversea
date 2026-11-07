# Case SIL-693 r3 — Debit guard remedy: định giá bù trên lô COMPLETED/locked

Ticket: SIL-693 (id 805) · Re-opened 07/11/2026 sau lane F1 · QA verdict build
8f29bea4 (staging): "pricing dead-end on completed lots".

## Defect class

Guard 409 (freightAuto null + basis SKIP thiếu căn cứ) hoạt động đúng, nhưng
mọi remedy đều chết trên lô có chuyến COMPLETED: `setLclLotRevClass` 409
"Lô … đã hoàn thành chuyến — không đổi loại xe/giá cước thu được nữa" cho cả
giá nhập tay lẫn rating-class (QA: hoapt + admin, UI + API). Lô kẹt: đã khóa,
không giá, không xuất được debit note.

## Owner remedy (07/11/2026)

Kế toán được nhập giá tay + lý do trên lô COMPLETED/locked (manual price +
audit ghi `completedTrip/completedTripId/completedTripReason`) → khóa lại →
freeze mang freightAuto thật → guard mở. Cả 2 đường xuất (per-lot + consolidated
cùng route `POST /shipments/debit-notes`) đều qua guard dùng chung
`buildFrozenShipmentDebitLines`.

## Chain (pinned — đã chạy thật trên local, BE :3003, DB :5441)

1. Lô COMPLETED LCL + khóa + freightAuto null + basis SKIP → export → **409**
   remedy "chưa được định giá … hãy xác định giá cước thu khách trên Quyết toán"
   (per-lot [779059] VÀ consolidated [779059, …] — cùng message).
2. Unlock (ADMIN/MANAGER/ACCOUNTANT — SIL-721, lý do bắt buộc) → 200.
3. `POST /shipments/lcl/rev-class {shipmentId, freightRevenue: 3800000, reason?}`
   (ACCOUNTANT hoapt/ketoan) → **200** `channel=TRIP freightManual=3800000`
   (trước fix: 409 dead-end). Rating-class (`vehicleSizeClassId`) → 200 tương tự.
4. Re-lock → 201; lock mới active mang `cost_snapshot.freightAuto = 3800000`.
5. Export [lô] → 201; note mang dòng FREIGHT 3.800.000 (DB
   `billing_document_lines`). Re-export → 409 overlap (luật 1-lô-1-note,
   pre-check overlap chạy trước guard theo r2 — đúng thứ tự).

## Pins

- BE unit: `debit-note-unpriced-freight-guard.test.ts` (guard matrix 9 test) +
  `lcl-completed-trip-pricing-law.test.ts` (6 pin luật per-lot outputs,
  schema reason optional, merge/assign vẫn chặn completed).
- API probe: `qa/2026-11-07-k9-688-693/api-probe-693.mjs` (chain thật:
  unlock → rev-class 200 → re-lock 201 → export 201 FREIGHT → overlap 409) +
  `revclass-class-probe.mjs` (rating-class path).
- UI DRIVEN: `qa/2026-11-07-k9-688-693/ui-drive-693.mjs` + shots + driver log.
