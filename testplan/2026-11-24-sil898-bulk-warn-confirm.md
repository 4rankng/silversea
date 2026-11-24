# SIL-898 — Phát lệnh hàng loạt dính cảnh báo xác nhận, hết đường override (0/2 oan)

Case ID: SIL-898-R12 (QA round 12 fail 24/11 12:37, staging vantai build 13e93679, role
dungnv, /dispatch-detail, tháng 11/2026).

## Reproduction

1. Mở /dispatch-detail → [Phát lệnh hàng loạt] → tick R3M-KQ1 (05/11/2026 08:00,
   RTAU4000119 20'DC 5 tấn) rồi tìm và tick R15-DRV-KEP (06/11/2026 08:00,
   RTAU4012151 20'DC 5 tấn) — cùng truck 15H-104.03 + rơ-moóc 15RM-107.28 20FT,
   phân loại Kẹp (DOUBLE).
2. Bấm [Phát lệnh đã chọn (2)].

Dữ liệu staging thật (điều tra read-only 24/11):

- Chuyến COMPLETED TRP-202611-0092/0093 (R4Q-676-1/2, cùng rig, 05/11 **07:00→09:00**)
  chồng khung giờ mới 08:00→10:00 → server trả 409 `RIG_OVERLAP_COMPLETED`
  'Có 1 chuyến đã hoàn thành trùng khung giờ phân công này. Vẫn lưu?'.
- Chuyến CREATED TRP-202611-0112 (SINGLE, cùng truck, 06/11, chở **15.000 kg**) là
  mixed-declaration candidate; 5.000 + 15.000 = **20.000 kg > bucket moóc 20FT
  18.000 kg** → 409 `KEP_WEIGHT_WARNING` 'Tổng tải trọng hàng ước tính có thể vượt
  tải trọng cho phép…'.

## Observed (bug)

Flow từng-dòng có đường confirm ('Vẫn lưu?' → retry với flag), nhưng flow hàng loạt
KHÔNG có: 2 cảnh báo rơi thẳng vào bảng tổng kết kèm dòng hướng dẫn
'dùng nút Phát lệnh trên dòng…', cả 2 dòng đứng yên ở 'Đã điều xe' — 0/2 oan.

## Expected

Cảnh báo confirm-able ở flow hàng loạt phải có đường xác nhận tương đương per-row:
dialog liệt kê dòng cảnh báo + nút 'Xác nhận vẫn phát lệnh' → phát thành công đúng
các dòng đó (retry mang cùng flag per-row); Hủy giữ dòng ở 'Đã điều xe'.

## Root-cause verdict (trả lời open question của QA)

CẢ HAI cảnh báo là ĐÚNG behavior (không phải false-positive như gate rơ-moóc trước
đây), chỉ thiếu đường confirm ở bulk:

1. Gate hoàn-thành-trùng-giờ đọc đúng: chỉ đếm `status = COMPLETED`, không đếm
   chuyến 'Đã hủy'; cặp 07:00→09:00 trùng thật với khung 08:00→10:00.
2. Gate tải trọng Kẹp đọc đúng 2 cont KHÁC nhau (không cộng dồn trùng cont):
   5t chân mới + 15t chân SINGLE cùng ngày trên moóc 20FT 18t — vượt thật, DOC
   TC6(2) bắt cảnh báo mềm cho phép xác nhận.

## Fix law (landed)

`bulkIssueRows` nhận `confirmWarnings`: các dòng 409 confirm-able
(`RIG_OVERLAP_COMPLETED` / `PLATE_DEFERRED_CONFIRM` / `KEP_WEIGHT_WARNING`) tạm
rời vòng phát, dialog trang liệt kê (identity + lý do nguyên văn server), nút
'Xác nhận vẫn phát lệnh' → phát lại CHỈ các dòng đó với flag per-row tương ứng
(`rigOverlapCompletedConfirmed` / `plateDeferredConfirmed` /
`kepWeightWarningConfirmed`); Hủy → dòng về tổng kết 'đã hủy xác nhận'. Không
callback → giữ behavior cũ (hint per-row). `issueOrder({ fromBulk: true })` bỏ
hook state `pendingWeightWarning` của lưới để không pop dialog lạ giữa batch —
per-row giữ nguyên. Một vòng confirm duy nhất: retry vẫn lỗi → tổng kết, không loop.

## Verification

- FE: `frontend/src/features/dispatch/detailed-plan/bulkIssueOrders.test.ts`
  — 20/20 (6 case mới: confirm retry đúng flag; decline; không callback giữ hint;
  lọ sạch phát vòng 1; retry vẫn lỗi → failure; message-fallback KEP).
- BE: `backend/src/tests/unit/sil898-bulk-warn-repro-gates.test.ts` — 8/8 pin số
  repro thật (5+15>18 overload; bucket 20FT = 18.000; cặp COMPLETED 07:00→09:00
  trùng khung 08:00→10:00; chuyến đã hủy không bị đếm).
- Full dispatch FE suites + tsc/be-tsc/lint/full FE suite — gates verbatim trong
  comment evidence trên ticket.
