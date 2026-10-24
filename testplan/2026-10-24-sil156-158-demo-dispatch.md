# Test plan — SIL-156/157/158 demo /demo/dispatch (grid + gantt + drawer)

Spec: `2026.10.24_Demo_layout.docx` §Phân hệ 1 (Bàn Điều Vận). Lane
`demo24-dispatch`. All cases run against fixtures in
`frontend/src/demo/data` — the demo surface never calls the API.

## TC-SIL156-01 — Date bar + KPI (grid mode)
1. Mở `/demo/dispatch`. Tab mặc định **Hôm nay = 2026-10-24** active.
2. 4 thẻ KPI hiển thị đúng số liệu seed 2026-10-24:
   - Tổng chuyến 16 (phân rã 20′/40′ đúng tỉ lệ seed),
   - Xe nhà 13 / 6 đầu kéo, Xe ngoài 3,
   - Cảnh báo vận hành = các chuyến hàng Xuất thiếu `containerSpec`
     (T-2404, T-2407, T-2416 — tính từ seed, không hardcode).
3. Bấm **Hôm qua** → lưới chỉ còn 2 chuyến CH-2310-*, KPI đổi theo.

## TC-SIL156-02 — Lưới 6 cột, 3 dòng/ô, không cột tiền
1. Mỗi dòng lưới có đủ 6 ô: Thời gian & Phương tiện / Khách hàng & điểm đóng
   trả / Lộ trình & tham chiếu / Thông số cont / Yêu cầu & ghi chú / Trạng
   thái & tín hiệu nâng-hạ.
2. Không ô nào hiển thị số tiền (cước, phí) — tiền chỉ nằm trong Drawer.
3. Ô 4: chuyến Xuất thiếu thông số có cảnh báo cam (icon + text).
4. Cặp T-2403/T-2404 (cùng booking SITVBM9911455) có tag KẸP.
5. Ô 6: badge tín hiệu — UNC đã trả = xanh "Đã UNC", chờ = cam "Chờ KT UNC",
   lái xe chi = xám "LX Chi".

## TC-SIL156-03 — Bộ lọc + tìm kiếm + Tạo Chuyến Mới
1. Chọn khách hàng SAM → chỉ còn chuyến của SAM.
2. Loại hình Hàng Nhập → còn đúng subset; Nguồn xe Xe ngoài → 3 chuyến.
3. Gõ biển số/cont/booking vào ô tìm kiếm → lưới thu hẹp tương ứng.
4. **+ Tạo Chuyến Mới** → modal; nhập booking + số lượng 2 → lưới thêm 2 dòng
   mới cùng mã booking, trạng thái "Mới tạo".

## TC-SIL157-01 — Gantt timeline
1. Bấm chuyển **Lịch trình đầu xe**: trục trái 6 đầu kéo (BKS + tài xế mặc
   định), thước giờ 00–24 theo 96px/giờ.
2. Khối chuyến: trái/phải = phút bắt đầu/kết thúc × 96/60, min 48px (30′).
3. Khối < 64px chỉ hiện dot; hover hiện tooltip mã chuyến + vỏ + tuyến.
4. Now-line (2px, error-500) + tam giác đầu, đúng vị trí giờ thực khi xem
   ngày 2026-10-24; ẩn khi xem ngày khác.
5. Click khối → mở drawer cùng chuyến.

## TC-SIL158-01 — Drawer 40%
1. Click dòng lưới → drawer trượt từ phải, rộng 40% viewport (desktop).
2. Header 64px: mã chuyến + nút đóng; body cuộn 3 khối; footer sticky 72px
   với Hủy (secondary) + Lưu (primary).
3. Khối 1: chọn lại đầu kéo → tự điền tài xế/SĐT/CCCD/rơ-moóc; nút copy
   thông tin đăng ký xe ghi clipboard + toast.
4. Khối 2: sửa Số chì → **Lưu** → ô 4 trên lưới cập nhật ngay, toast thành
   công; **Hủy** không thay đổi dữ liệu.
5. Khối 3: đơn giá nâng/hạ auto từ phí seed, Invoice To theo cảng, radio
   UNC/tiền mặt, phụ phí cảng có checkbox + số tiền.

## Unit tests (vitest)
- `dispatch-model.test.ts`: deriveTripStatus (đã xong/đang chạy/đã phân xe
  theo mốc thời gian cố định), phút↔px 96px/h + min 48px, filterTrips,
  dispatchKpis (đếm từ seed), copyVehicleText, isPairedTrip, exportSpecMissing.
- `DemoDispatchPage.render.test.tsx`: KPI render, đổi ngày tab, filter, view
  switch, mở/sửa/lưu drawer, copy clipboard (mock), tạo chuyến mới.

## UI evidence
- Screenshot 1440 + 390 (grid + gantt + drawer) → `qa/2026-10-24-demo24/`.
