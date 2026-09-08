# Luồng 3: Nhận lệnh & Kích hoạt chuyến — Lái xe (Driver)

> **Vai trò sở hữu:** Lái xe (DRIVER)
> **Tài khoản test:** chọn theo môi trường qua [`../testaccounts.txt`](../testaccounts.txt) — runner tự map role `DRIVER` → username phù hợp (local: `DRIVER`; staging: prod-mirror như `bqhuong`). Khi cần 2 driver khác nhau cho cùng 1 test, dùng 2 user bất kỳ trong cùng role.
> **Route chính:** `/my-trips`, `/my-trips/:id`, `/my-earnings`, `/my-payslips`, `/my-penalties`
> **Thiết bị mặc định:** Mobile (iPhone SE 375×667) — ứng dụng lái xe trên điện thoại
> **PRD nguồn:** Module 08 (`docs/prd/Module8.docx`), O2C Bước 3, TC-MO2C-05
>
> **Tổng quan luồng:** Lái xe nhận lệnh điều động từ Điều vận qua ứng dụng mobile, xem chi tiết
> lệnh (thời gian, tuyến, container, chứng từ), xác nhận nhận lệnh gốc để kích hoạt chuyến từ
> CREATED → IN_TRANSIT. Push notification cơ bản được cài cho Lái xe (MVP).

---

## 3.1 — Xem lệnh mới trên ứng dụng mobile

### TC-LX-NHANLENH-001 — Lái xe thấy lệnh mới và thông báo

- **Mã PRD:** M08-8.2, TC-MO2C-05
- **Vai trò:** `DRIVER`
- **Mức độ:** P0
- **Thiết bị:** Mobile (375×667)
- **Tiền điều kiện:** Điều vận đã phát lệnh cho `DRIVER` (trip CREATED)
- **Các bước:**
  1. Đăng nhập `DRIVER` trên mobile. Mở `/my-trips`.
  2. Tìm lệnh mới. Bấm vào để xem chi tiết.
  3. Kiểm tra: chuyến, thời gian, tuyến, Booking/BL, container, xe, hướng dẫn, chứng từ đính kèm.
- **Kết quả mong đợi (Pass):**
  - Lệnh mới hiển thị trên `/my-trips` với trạng thái rõ ràng.
  - Có thông báo (in-app / push) khi lệnh mới được giao.
  - Chi tiết hiển thị đủ: thời gian, tuyến, điểm giao nhận, container, seal, hướng dẫn đóng/trả hàng.
  - Chứng từ đính kèm xem được trên mobile (PDF viewer thu nhỏ vừa màn).
  - Nhãn tiếng Việt, nút chạm ≥ 44px.
- **Kỳ vọng sai (Fail nếu):**
  - Lái xe không thấy lệnh.
  - Không có thông báo.
  - Thiếu thông tin container/thời gian/tuyến.
  - Chứng từ không xem được trên mobile.
- **Bằng chứng:** ảnh `/my-trips` + ảnh chi tiết lệnh + ảnh thông báo + ảnh PDF viewer

---

### TC-LX-NHANLENH-002 — Lái xe không có lệnh nào (empty state)

- **Mã PRD:** M08-8.1
- **Vai trò:** `DRIVER` (mới, chưa được điều động)
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Đăng nhập `DRIVER` mới (chưa có chuyến).
  2. Mở `/my-trips`.
- **Kết quả mong đợi (Pass):**
  - Hiển thị "Chưa có lệnh điều động" rõ ràng.
  - Không lỗi kỹ thuật (không stack-trace, không 500).
  - Empty state căn giữa, có icon, không vỡ bố cục.
- **Bằng chứng:** ảnh empty state

---

## 3.2 — Kích hoạt chuyến (ORDER_RECEIVED)

### TC-LX-NHANLENH-003 — Lái xe tự kích hoạt chuyến: CREATED → IN_TRANSIT

- **Mã PRD:** TC-MO2C-05, O2C Bước 3
- **Vai trò:** `DRIVER`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip ở trạng thái CREATED, đã gán cho `DRIVER`
- **Các bước:**
  1. Mở `/my-trips/:id` (trip CREATED).
  2. Bấm "Đã nhận lệnh gốc" (ORDER_RECEIVED).
  3. Ghi timestamp/version.
- **Kết quả mong đợi (Pass):**
  - **Chính lái xe** thực hiện kích hoạt — không cần Manager/Admin.
  - Trip chuyển từ CREATED → IN_TRANSIT.
  - Trạng thái lô (shipment) cũng chuyển sang "Đang chạy" (IN_TRANSIT).
  - Timestamp và audit được ghi nhận: người thực hiện, thời điểm.
  - Nút "Đã nhận lệnh gốc" chỉ bấm được 1 lần (disabled sau khi nhận).
- **Kỳ vọng sai (Fail nếu):**
  - Lái xe không thể tự kích hoạt (phải chờ Admin/Manager).
  - Trip không chuyển IN_TRANSIT.
  - Shipment không cập nhật trạng thái.
  - Không có timestamp/audit.
  - Nút vẫn bấm được sau khi đã nhận.
- **Bằng chứng:** ảnh trước/sau kích hoạt + timestamp + trạng thái trip/shipment

---

### TC-LX-NHANLENH-004 — Thử bấm nhận lệnh khi trip không ở trạng thái CREATED

- **Vai trò:** `DRIVER`
- **Mức độ:** P1
- **Các bước:**
  1. Trip đã ở IN_TRANSIT (đã nhận lệnh rồi).
  2. Thử bấm lại "Đã nhận lệnh gốc" (nếu nút vẫn hiện).
- **Kết quả mong đợi (Pass):**
  - Nút disabled/ẩn hoặc thông báo "Lệnh đã được nhận".
  - Không thay đổi trạng thái.
- **Bằng chứng:** ảnh nút disabled + ảnh thông báo

---

## 3.3 — Xem chi tiết chuyến đang chạy

### TC-LX-NHANLENH-005 — Xem chi tiết chuyến IN_TRANSIT

- **Mã PRD:** M08-8.2
- **Vai trò:** `DRIVER`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đã IN_TRANSIT
- **Các bước:**
  1. Mở `/my-trips/:id`.
  2. Kiểm tra hiển thị: trạng thái "Đang chạy", thông tin chuyến, container, thời gian, milestone tiếp theo.
- **Kết quả mong đợi (Pass):**
  - Trạng thái "Đang chạy" hiển thị rõ ràng.
  - Các milestone tiếp theo được hiển thị để lái xe biết cần làm gì.
  - Thông tin chuyến đầy đủ, cập nhật realtime.
- **Bằng chứng:** ảnh chi tiết chuyến đang chạy

---

## 3.4 — Phân quyền: Lái xe chỉ thấy lệnh của mình

### TC-LX-NHANLENH-006 — Lái xe A không xem được lệnh của Lái xe B

- **Mã PRD:** HT-02, M08-8.1
- **Vai trò:** `DRIVER` (A) vs `DRIVER` (B)
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Các bước:**
  1. Đăng nhập `DRIVER` (A). Lấy ID chuyến của `DRIVER` (B) từ DB hoặc URL.
  2. Mở trực tiếp `/my-trips/<id-của-thu>`.
- **Kết quả mong đợi (Pass):**
  - `DRIVER` A không xem được chi tiết chuyến của `DRIVER`.
  - Redirect về `/my-trips` hoặc "Không có quyền".
  - API trả 403. Response body không lộ dữ liệu.
- **Bằng chứng:** ảnh redirect + Network 403

---

### TC-LX-NHANLENH-007 — Vai trò khác không vào được cổng lái xe

- **Mã PRD:** HT-02
- **Vai trò thử:** `ACCOUNTANT`, `CUSTOMER`, `CUS`, `OPS`
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `ACCOUNTANT`. Mở `/my-trips`.
  2. Đăng nhập `CUSTOMER`. Mở `/my-trips`.
  3. Đăng nhập `CUS`. Mở `/my-trips`.
  4. Đăng nhập `OPS`. Mở `/my-trips`.
- **Kết quả mong đợi (Pass):**
  - Tất cả đều bị redirect về màn nhà của vai trò hoặc "Không có quyền".
  - Không lộ dữ liệu chuyến/lương/chứng từ.
- **Bằng chứng:** ảnh redirect cho từng vai trò

---

## 3.5 — Dữ liệu nguồn & Đồng bộ

### TC-LX-NHANLENH-008 — Điều vận đổi giờ chạy → Lái xe thấy cập nhật

- **Mã PRD:** M08-8.1, Q22
- **Vai trò:** `ADMIN` (điều vận) + `DRIVER`
- **Mức độ:** P1
- **Các bước:**
  1. `ADMIN` sửa giờ chạy chuyến từ 08:00 → 09:00 trên `/trips/:id`.
  2. `DRIVER` tải lại `/my-trips` và mở `/my-trips/:id`.
  3. So sánh giờ hiển thị.
- **Kết quả mong đợi (Pass):**
  - Giờ trên cổng lái xe cập nhật thành 09:00, khớp nguồn admin.
  - Có audit/time log cho thay đổi.
- **Bằng chứng:** ảnh admin + ảnh lái xe (cùng giờ)

---

## 3.6 — Trường hợp biên: Mạng & Responsive

### TC-LX-NHANLENH-009 — Mất mạng khi đang xem lệnh

- **Mã PRD:** HT-08
- **Vai trò:** `DRIVER`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Đang xem `/my-trips/:id`. DevTools → Network → Offline.
  2. Bấm "Đã nhận lệnh gốc".
  3. Bật lại mạng. Bấm lại.
- **Kết quả mong đợi (Pass):**
  - Offline: thông báo lỗi tiếng Việt dễ hiểu, không crash.
  - Online lại: thao tác thành công.
  - Dữ liệu đã nhập không mất.
- **Bằng chứng:** ảnh toast offline + ảnh thành công online lại

---

### TC-LX-NHANLENH-010 — Responsive: xoay ngang, cỡ chữ lớn

- **Mã PRD:** HT-07, M08-8.1
- **Vai trò:** `DRIVER`
- **Mức độ:** P2
- **Thiết bị:** Mobile (375×667 + xoay ngang 667×375)
- **Các bước:**
  1. Mở `/my-trips/:id` ở dọc. Xoay ngang.
  2. Bật cỡ chữ lớn nhất hệ điều hành.
- **Kết quả mong đợi (Pass):**
  - Xoay ngang: nội dung không che, nút vẫn bấm được.
  - Cỡ chữ lớn: text không cắt, không tràn, không đè nhau.
- **Bằng chứng:** ảnh xoay ngang + ảnh cỡ chữ lớn

---

## Bảng nghiệm thu — Luồng Nhận lệnh (Lái xe)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-LX-NHANLENH-001 | | | Xem lệnh mới | |
| __/__/__ | TC-LX-NHANLENH-002 | | | Empty state | |
| __/__/__ | TC-LX-NHANLENH-003 | | | Kích hoạt ORDER_RECEIVED | |
| __/__/__ | TC-LX-NHANLENH-004 | | | Nhận lại lệnh đã nhận | |
| __/__/__ | TC-LX-NHANLENH-005 | | | Chi tiết IN_TRANSIT | |
| __/__/__ | TC-LX-NHANLENH-006 | | | RBAC lái xe vs lái xe | |
| __/__/__ | TC-LX-NHANLENH-007 | | | RBAC vai trò khác | |
| __/__/__ | TC-LX-NHANLENH-008 | | | Đồng bộ dữ liệu | |
| __/__/__ | TC-LX-NHANLENH-009 | | | Offline | |
| __/__/__ | TC-LX-NHANLENH-010 | | | Responsive | |
