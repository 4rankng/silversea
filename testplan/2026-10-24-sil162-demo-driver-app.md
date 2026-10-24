# TC — SIL-162 /demo/driver-app (mobile demo frame + trip cards + OCR + E-POD)

Ngày: 2026-10-24 · Lane: demo24-driver · Spec: 2026.10.24_Demo_layout.docx §5
(doc_bb1b74fcfa8b mục 5 — bản tóm lược trong ticket SIL-162).

Fixture: `frontend/src/demo/data/seed.ts` (SIL-155) — ngày demo 2026-10-24,
6 tài xế đội xe nhà, mỗi tài xế ≥ 2 chuyến trong ngày.

## TC-SIL162-01 — Khung giả lập + thanh chọn tài xế

Vào `/demo/driver-app` (đã đăng nhập):

1. Thấy khung điện thoại 390×844 (rounded-2xl, border-8 gray-800) giữa nền
   gray-100, bên trong shell demo.
2. Thanh chọn tài xế nằm trên khung; mặc định tài xế đầu (Nguyễn Văn Tâm).
3. Đổi tài xế (vd Lê Minh Tuấn) → danh sách thẻ lệnh đổi theo đúng chuyến
   của tài xế đó trong ngày 2026-10-24, chiều dài danh sách đúng seed.

Expected: TRK-01/DRV-01 → 2 thẻ (CH-2410-01, CH-2410-02); DRV-02 → 3 thẻ
(CH-2410-03, CH-2410-04, CH-2410-05).

## TC-SIL162-02 — Thẻ lệnh Layer 1 đủ thành phần

Mỗi thẻ lệnh hiển thị:

1. Giờ có mặt (timeline[0].start) — text-sm semibold, bên trái header thẻ.
2. Lộ trình dạng chip + mũi tên: Cảng Nâng ➔ Nhà máy ➔ Cảng Hạ
   (2 chip khi không có cảng hạ).
3. Cỡ cont (20′/40′) + Xuất/Nhập.
4. Badge `CHẠY KẸP` purple (purple-50 nền / purple-700 chữ, pill xs) chỉ
   xuất hiện ở 2 vỏ kẹp đôi (T-2403, T-2404 — cùng booking SITVBM9911455).
5. Khung cảnh báo đỏ (bg red-50 / border red-300) khi trip có `note`
   (vd T-2402: "Chờ CCP đỗ cổng số 3…").
6. Trạng thái tài chính đúng bố trí phí:
   - 🟢 "Công ty đã UNC — vào lấy lệnh" (lift UNC đã trả: T-2401, T-2413).
   - 🟠 "Lái xe tự chi {tổng} — HĐ về tên {invoiceTo}" (lift driver-cash:
     T-2402 = 1.430.000 ₫ / Công ty CP VICT; T-2406 = 2.150.000 ₫).
   - 🟡 chờ UNC (lift unc pending: T-2407) + dòng 🟠 phụ phí tự chi thêm
     khi chỉ phụ phí là driver-cash (T-2408, T-2412).

## TC-SIL162-03 — Layer 2 chi tiết + OCR demo

Tap thẻ → màn hình chi tiết:

1. Có nút "Chụp Cửa Container (AI OCR)".
2. Bấm nút → ngay lập tức có thumbnail preview + badge "Đang đọc dữ liệu...".
3. Sau 1,2s: 4 ô Số cont · Số Chì · Max Gross · Tare được tự điền từ fixture
   (trip có `containerSpec` dùng đúng giá trị seed; trip thiếu spec — T-2404 —
   OCR điền giá trị demo suy ra từ contNo + cỡ cont).
4. Cả 4 ô sửa tay được sau khi điền.
5. Khu ảnh EIR nâng / EIR hạ + biên lai: bấm tải lên → ô chuyển trạng thái
   đã đính kèm.

## TC-SIL162-04 — Hoàn thành chuyến

1. Nút "Hoàn thành chuyến" sticky đáy màn chi tiết.
2. Bấm → quay về Layer 1, thẻ về trạng thái hoàn thành (badge
   "Đã hoàn thành", thẻ mờ đi), không mất khỏi danh sách.
3. Mở lại thẻ đã hoàn thành → trạng thái hoàn thành giữ nguyên.

## TC-SIL162-05 — Gate

- `cd frontend && npx vitest run src/demo` — toàn pass.
- `cd frontend && npx tsgo -b` — 0 lỗi (kèm `npx tsc -b`).
- Screenshot 1440 (frame trong page) lưu `qa/2026-10-24-demo24/`.
