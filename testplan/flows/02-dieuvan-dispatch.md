# Luồng 2: Điều xe / Phân bổ chuyến — Điều vận (Dispatcher)

> **Vai trò sở hữu:** Điều vận (DISPATCHER)
> **Tài khoản demo:** `dieuvan` (password: `Abc123`)
> **Route chính:** `/dispatch`, `/trips`, `/trips/new`, `/trips/:id`, `/fleet`
> **PRD nguồn:** Module 01 (`docs/prd/Module1.docx`), O2C Flow Bước 2
>
> **Tổng quan luồng:** Điều vận nhận lô từ CUS, rã lô thành fulfillment (với FCL: mỗi container
> là 1 fulfillment), gán xe + tài xế, phát lệnh điều xe. Hỗ trợ Xe nhà và Xe ngoài, kẹp hàng
> (2 chiều), và chặn xung đột xe bận.

---

## 2.1 — Tiếp nhận lô từ CUS

### TC-DV-DISPATCH-001 — Tiếp nhận lô và hiển thị trên màn dispatch

- **Mã PRD:** TC-MO2C-04
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** CUS đã tạo lô FCL với 2 container và bàn giao cho Điều vận
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`.
  2. Tìm lô vừa được bàn giao. Bấm "Tiếp nhận".
  3. Kiểm tra thông tin lô: Booking/BL, khách hàng, tuyến, container.
- **Kết quả mong đợi (Pass):**
  - Lô hiển thị trên `/dispatch` với trạng thái "Mới tạo".
  - Thông tin đầy đủ: Booking, BL, khách, tuyến, container, ngày giao dự kiến.
  - Trạng thái lô tự xác định từ lịch/ngày giao đã lưu.
- **Kỳ vọng sai (Fail nếu):**
  - Lô có lịch vận hành hoặc ngày giao không đến được Điều vận.
  - Thiếu thông tin container hoặc ngày giao.
- **Bằng chứng:** ảnh màn dispatch + ảnh chi tiết lô

---

## 2.2 — Rã lô FCL thành fulfillment

### TC-DV-DISPATCH-002 — Rã FCL thành đúng số dòng container

- **Mã PRD:** TC-MO2C-04
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Tiền điều kiện:** Lô FCL có 2 container đã tiếp nhận
- **Các bước:**
  1. Mở lô FCL trên `/dispatch`.
  2. Thực hiện rã lô (split) thành fulfillment.
  3. Kiểm tra: đúng 2 fulfillment, mỗi fulfillment gắn với 1 container.
  4. Kiểm tra dữ liệu từng fulfillment: container, seal, ngày giao.
- **Kết quả mong đợi (Pass):**
  - Rã đúng 2 dòng (mỗi container 1 fulfillment).
  - Dữ liệu theo đúng từng dòng container.
  - Trạng thái fulfillment rõ ràng.
- **Kỳ vọng sai (Fail nếu):**
  - Rã sai số dòng (thừa hoặc thiếu).
  - Dữ liệu container trộn giữa các fulfillment.
- **Bằng chứng:** ảnh trước/sau rã + ảnh 2 fulfillment riêng biệt

---

## 2.3 — Gán xe nhà (Xe nội bộ)

### TC-DV-DISPATCH-003 — Gán xe nhà + tài xế cho chuyến

- **Mã PRD:** TC-MO2C-04, M01-1.3
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Tiền điều kiện:** Có xe nhà và tài xế phù hợp trong danh mục
- **Các bước:**
  1. Chọn fulfillment FCL. Gán Xe nhà (biển số từ danh mục).
  2. Gán Tài xế (từ danh mục tài xế đã gán xe).
  3. Nhập thời gian dự kiến.
  4. Bấm "Phát hành lệnh điều xe".
- **Kết quả mong đợi (Pass):**
  - Lệnh phát hành thành công.
  - Trip được tạo với tag "Xe nhà".
  - Trạng thái lô chuyển sang "Đã phân xe" (DISPATCHED).
  - Tài xế nhận thông báo / push notification.
  - Ghi người phát lệnh, thời điểm, version.
- **Kỳ vọng sai (Fail nếu):**
  - Không có xe nhà hoặc tài xế trong danh mục.
  - Phát lệnh nhưng lô không chuyển DISPATCHED.
  - Tài xế không nhận thông báo.
- **Bằng chứng:** ảnh lệnh đã phát + ảnh trạng thái lô + ảnh thông báo tài xế

---

## 2.4 — Gán xe ngoài (Xe thuê ngoài)

### TC-DV-DISPATCH-004 — Gán xe ngoài cho chuyến LCL

- **Mã PRD:** TC-MO2C-04
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Tiền điều kiện:** Có lô LCL đã tiếp nhận, có nhà cung cấp cước xe ngoài
- **Các bước:**
  1. Chọn fulfillment LCL. Gán Xe ngoài (chọn nhà cung cấp / chủ xe).
  2. Nhập thông tin xe ngoài (biển số, tài xế, giá cước).
  3. Phát hành lệnh điều xe.
- **Kết quả mong đợi (Pass):**
  - Lệnh phát hành với tag "Xe ngoài".
  - AP (công nợ phải trả) ghi nhận nhà cung cấp cước xe ngoài.
  - Trip tạo thành công.
- **Kỳ vọng sai (Fail nếu):**
  - Tag sai (gán xe ngoài nhưng hiện xe nhà).
  - AP không ghi nhận đúng NCC.
- **Bằng chứng:** ảnh lệnh + ảnh tag xe + ảnh AP preview

---

## 2.5 — Chặn xung đột xe bận (Conflict Detection)

### TC-DV-DISPATCH-005 — Chặn gán trùng xe + thời gian chồng lấn

- **Mã PRD:** TC-MO2C-04, Q23
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Tiền điều kiện:** Đã có 1 chuyến được gán xe A + tài xế X, thời gian 08:00–14:00
- **Các bước:**
  1. Tạo chuyến mới. Gán cùng xe A + cùng tài xế X.
  2. Đặt thời gian chồng lấn: 10:00–16:00 (trùng với chuyến trước).
  3. Thử phát lệnh.
- **Kết quả mong đợi (Pass):**
  - Hệ thống **chặn** phát lệnh: "Xe/Tài xế đang bận trong khoảng thời gian này".
  - Không tạo trip mới.
  - Thông báo rõ ràng, tiếng Việt.
- **Kỳ vọng sai (Fail nếu):**
  - Cho phép phát lệnh trùng → tạo 2 chuyến cùng xe cùng lúc.
  - Không có cảnh báo.
- **Bằng chứng:** ảnh thông báo chặn + ảnh DB (không có trip mới)

---

### TC-DV-DISPATCH-006 — Sửa thời gian/xe hợp lệ sau khi bị chặn

- **Mã PRD:** TC-MO2C-04
- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Các bước:**
  1. Bị chặn ở TC-DV-DISPATCH-005.
  2. Đổi thời gian sang không chồng lấn (15:00–20:00) hoặc đổi xe khác.
  3. Phát lệnh lại.
- **Kết quả mong đợi (Pass):**
  - Phát lệnh thành công sau khi sửa.
  - Trip tạo đúng.
- **Bằng chứng:** ảnh lệnh đã phát + ảnh trip

---

## 2.6 — Kẹp hàng (Paired Trip — 2 chiều)

### TC-DV-DISPATCH-007 — Kẹp hàng hợp lệ — chỉ ghi 1 lần phí cầu đường

- **Mã PRD:** TC-MO2C-09
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Tiền điều kiện:** 2 lệnh Xe nhà cùng xe, cùng tài xế, cùng lộ trình 2 chiều, thời gian không chồng lấn
- **Các bước:**
  1. Tích chọn "Kẹp hàng" cho đúng cặp chuyến.
  2. Phát cả 2 lệnh.
  3. Mở chi phí dự kiến/thực tế.
  4. Đối chiếu tổng phí đường của nhóm.
- **Kết quả mong đợi (Pass):**
  - Cặp hợp lệ chỉ ghi **1 lần** định mức phí đường khép kín.
  - Lệnh thứ 2 mang khoản giảm/điều chỉnh rõ ràng.
  - Doanh thu, trạng thái và chi phí khác vẫn độc lập.
  - Nhật ký liên kết cặp được ghi nhận.
- **Kỳ vọng sai (Fail nếu):**
  - Tổng phí bị nhân đôi (2 lần phí đường).
  - Người dùng phải sửa tay.
  - Ghép sai xe/tài xế/thời gian mà vẫn cho phép.
- **Bằng chứng:** ảnh tích kẹp + 2 trip ID + phí từng dòng và tổng nhóm

---

### TC-DV-DISPATCH-008 — Kẹp hàng không đủ điều kiện — không tự ghép

- **Mã PRD:** TC-MO2C-09
- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Các bước:**
  1. Tạo cặp không đủ điều kiện (khác xe hoặc khác tài xế hoặc thời gian chồng).
  2. Thử tích "Kẹp hàng".
- **Kết quả mong đợi (Pass):**
  - Không cho phép ghép: "Không đủ điều kiện kẹp hàng".
  - Cặp không đủ điều kiện không được ưu đãi phí đường.
- **Bằng chứng:** ảnh thông báo chặn

---

## 2.7 — Phân quyền Điều vận

### TC-DV-DISPATCH-009 — Chỉ DISPATCHER/ADMIN mới truy cập màn dispatch

- **Mã PRD:** HT-02, Q17
- **Vai trò thử:** `dieuvan` (được), `cus`, `laixe`, `ketoan`, `customer` (bị chặn)
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `dieuvan` → mở `/dispatch` → phải thấy được.
  2. Đăng nhập `cus` → mở `/dispatch` → phải bị chặn.
  3. Đăng nhập `laixe`, `ketoan`, `customer` → mở `/dispatch` → phải bị chặn.
- **Kết quả mong đợi (Pass):**
  - Chỉ DISPATCHER và ADMIN vào được `/dispatch`.
  - Các vai trò khác: redirect về màn nhà hoặc "Không có quyền".
- **Bằng chứng:** ảnh redirect + Network 403

---

## 2.8 — Trường hợp biên

### TC-DV-DISPATCH-010 — Double-submit khi phát lệnh

- **Mã PRD:** Q23, HT-04
- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Các bước:**
  1. Chọn chuyến, bấm "Phát hành lệnh" **2 lần liên tiếp** (Slow 3G).
  2. Kiểm tra DB: đếm số trip.
- **Kết quả mong đợi (Pass):**
  - Chỉ tạo **1 trip**.
  - Lần thứ 2 trả về kết quả đã có hoặc "đã tồn tại".
- **Bằng chứng:** Network tab + DB

---

### TC-DV-DISPATCH-011 — Concurrent dispatch: 2 người cùng phát lệnh cho 1 lô

- **Mã PRD:** Q23
- **Vai trò:** 2 tài khoản `dieuvan` (hoặc `dieuvan` + `admin`)
- **Mức độ:** P1
- **Các bước:**
  1. Mở 2 tab, cùng 1 lô, 2 người cùng bấm "Phát hành lệnh".
  2. Kiểm tra: chỉ 1 thắng, người kia nhận conflict.
- **Kết quả mong đợi (Pass):**
  - First-dispatch-wins.
  - Người sau nhận 409 "phiên bản cũ" hoặc "lệnh đã được phát".
  - Audit log ghi cả 2 lần thử.
- **Bằng chứng:** ảnh 2 request (1 OK, 1 conflict) + audit log

### TC-DV-DISPATCH-012 — Phân xe lại khi tác vụ điều xe bị mất/tái cấu trúc (fallback)

- **Mã PRD:** Bug fix 2026-08-29 — lệnh đã phát muộn không thể "Phân xe lại"
- **Vai trò:** `dieuvan` (hoặc `admin` / `giamdoc`)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đã phát lệnh điều xe, trip ở CREATED. Có thể mô phỏng: trip.fulfillmentId trỏ tới 1 fulfillment đã bị hủy cứng (canceledAt IS NOT NULL ở cấp DB hoặc row bị xóa khỏi `shipment_fulfillments`).
- **Các bước:**
  1. Mở `/dispatch-detail` (Kế hoạch chi tiết xe). Ở ô đã phát lệnh (status chip = ISSUED, trip = CREATED), bấm "Phân xe lại".
  2. Trong dialog "Phân xe lại", đổi loại xe sang "Xe ngoài", chọn đối tác "Biên Đông", nhập biển số/tên lái xe/SĐT.
  3. Bấm "Xác nhận phân xe lại".
- **Kết quả mong đợi (Pass):**
  - **Không** hiện lỗi "Không tìm thấy tác vụ điều xe" (lỗi cũ trước fix).
  - Phân xe lại thành công: trip ghi nhận carrierType mới, externalCarrier/externalPlate mới, version tăng.
  - Dialog đóng, ô điều phối refresh, biển số mới hiển thị.
  - Nếu dispatch muốn re-link đầy đủ, "Phát lệnh" lại từ Kế hoạch chi tiết sẽ tạo fulfillment mới.
- **Kỳ vọng sai (Fail nếu):**
  - Vẫn trả 404 "Không tìm thấy tác vụ điều xe" (hành vi cũ — đã fix).
  - Không cập nhật được trip sau khi đổi.
- **Bằng chứng:** ảnh dialog trước/sau + ảnh ô điều phối sau refresh + ảnh Network 200

### TC-DV-DISPATCH-013 — Bộ lọc ngày "Kế hoạch tổng quát" hiển thị lô đã phân nhà xe theo appointment container

- **Mã PRD:** Bug fix 2026-08-29 — bộ lọc ngày đang không hiển thị lô đã phân nhà xe
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH đã được CUS gán nhà xe (plannedCarrierType = OWN/EXTERNAL trên shipmentFulfillments). **Quan trọng:** `shipments.expectedDeliveryDate` khác với `shipment_containers.customerAppointmentAt` (CUS đã re-appointment sang ngày khác).
- **Các bước:**
  1. Mở `/dispatch` (Kế hoạch tổng quát). Ở thanh "Ngày giao", chọn đúng ngày mà container đã được re-appointment tới (ví dụ 30/08/2026).
  2. Quan sát: lô FCL vừa tạo có xuất hiện trong danh sách không.
  3. Đổi bộ lọc về ngày = `expectedDeliveryDate` của lô. Quan sát: lô vẫn xuất hiện.
  4. Đổi sang 1 ngày không liên quan (ví dụ 15/08/2026). Quan sát: lô biến mất.
- **Kết quả mong đợi (Pass):**
  - Lô hiển thị ở cả 2 filter (ngày appointment, ngày EDD) — bộ lọc theo cả 2 nguồn ngày.
  - Lô biến mất khi filter sang ngày không liên quan.
  - Empty state "Không có lô hàng nào cần phân xe" chỉ hiện khi thật sự rỗng (không phải vì filter quá hẹp do sai nguồn ngày).
  - Cột "Sản lượng" / "Phân xe" vẫn hiển thị nhà xe đã gán (Biên Đông, SilverSea, …) cho lô đó.
- **Kỳ vọng sai (Fail nếu):**
  - Lô không hiện ở filter theo appointment date dù đã được re-appointment (hành vi cũ — đã fix).
  - Lô hiện ở cả filter ngày không liên quan (lọc quá rộng).
- **Bằng chứng:** ảnh Kế hoạch tổng quát với 3 filter trên + ảnh nhà xe đã gán

---

## Bảng nghiệm thu — Luồng Điều xe (Điều vận)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-DV-DISPATCH-001 | | | Tiếp nhận lô | |
| __/__/__ | TC-DV-DISPATCH-002 | | | Rã FCL | |
| __/__/__ | TC-DV-DISPATCH-003 | | | Gán xe nhà | |
| __/__/__ | TC-DV-DISPATCH-004 | | | Gán xe ngoài | |
| __/__/__ | TC-DV-DISPATCH-005 | | | Conflict detection | |
| __/__/__ | TC-DV-DISPATCH-006 | | | Sửa sau chặn | |
| __/__/__ | TC-DV-DISPATCH-007 | | | Kẹp hàng hợp lệ | |
| __/__/__ | TC-DV-DISPATCH-008 | | | Kẹp hàng không hợp lệ | |
| __/__/__ | TC-DV-DISPATCH-009 | | | RBAC dispatch | |
| __/__/__ | TC-DV-DISPATCH-010 | | | Double-submit | |
| __/__/__ | TC-DV-DISPATCH-011 | | | Concurrent dispatch | |
| __/__/__ | TC-DV-DISPATCH-012 | | | Phân xe lại khi tác vụ bị mất (fallback) | |
| __/__/__ | TC-DV-DISPATCH-013 | | | Filter ngày hiển thị lô đã phân nhà xe (appointment) | |
