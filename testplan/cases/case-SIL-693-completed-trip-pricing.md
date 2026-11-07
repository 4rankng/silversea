# SIL-693 (id 805) — Dead-end định giá lô sau khi hoàn thành chuyến

- Ticket: id 805 (board SIL, CRITICAL) — QA Muse re-verify build 8f29bea4: lô LCL
  965 / trip 397 COMPLETED + khóa → export 409 NO_RATE_KEY đúng, nhưng MỌI remedy
  409 "đã hoàn thành chuyến — không đổi loại xe/giá cước thu được nữa" (UI nhập tay
  bằng hoapt; API manual price + rating-class bằng hoapt và admin; unlock→định
  giá→re-lock cũng bị chặn) → lô kẹt vĩnh viễn, không xuất được Debit Note.
- Surface: BE `POST /api/shipments/lcl/rev-class` (`setLclLotRevClass`) + guard
  xuất `buildFrozenShipmentDebitLines`; quy trình kế toán trên Chi phí - Quyết toán.

## Bug

Guard 409 thiếu căn cứ định giá (freightAuto null + basis SKIP) hứa remedy "xác
định giá trên Quyết toán rồi khóa lại", nhưng `setLclLotRevClass` chặn MỌI lần
định giá khi live trip của lô đã COMPLETED → remedy không tồn tại.

## Expected sau thay đổi

1. Định giá per-lot (giá nhập tay HOẶC loại xe tính cước) CHO PHÉP trên lô có trip
   COMPLETED — cùng kênh tiền TRIP (trip_financial_state override stamp), cùng hai
   lock-gate đứng trước; command nhận `reason` (optional — absent thì audit ghi
   reason mặc định deterministic).
2. Kèm lý do + audit: auditGroupChange ghi `completedTrip: true, completedTripId,
   completedTripReason` cho mọi lần định giá trên lô completed.
3. Guard xuất 409 NO_RATE_KEY GIỮ NGUYÊN (chưa giá thì vẫn chặn note); luật
   AD_HOC + legacy snapshot giữ nguyên; merge/assign (`assertMergeableMoney`) vẫn
   chặn completed trips.
4. Chuỗi AC: 409 → kế toán đặt manual price → unlock/re-lock → export 201 với dòng
   FREIGHT đủ tiền (`billedFreight = min(freightAuto, receivable)`).

## Regression lock

- `backend/src/tests/unit/lcl-completed-trip-pricing-law.test.ts` — 6 pin (không
  còn throw completed; carve-out + reason default; 3 audit site marker; lock-gate
  thứ tự; merge/assign luật cũ nguyên văn; schema reason optional).
- Chuỗi e2e: `qa/2026-11-07-lane-f1/setup-api.mjs` — BEFORE 409 NO_RATE_KEY →
  price 200 channel TRIP → re-lock freightAuto 3.800.000 (DB) → export 201/UI.
- UI: `qa/2026-11-07-lane-f1/ui-drive.mjs` — board 3.800.000, Xuất Debit Note 201
  (run1) / 409 overlap đúng luật (run cuối), note carries FREIGHT 3.800.000.
