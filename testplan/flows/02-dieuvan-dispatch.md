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

### TC-DV-DISPATCH-014 — Dialog "Phân bổ nhà xe" hiển thị đầy đủ nhà xe ngoài (EXTERNAL) trong dropdown, không chỉ "Đội xe nội bộ SilverSea"

- **Mã PRD:** Bug fix 2026-09-05 — dropdown nhà xe trong dialog "Phân bổ nhà xe" (Kế hoạch tổng quát) chỉ hiển thị option OWN, không hiển thị nhà xe ngoài dù `/catalogs/bootstrap` đã trả `externalCarriers` hợp lệ
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - Backend `/api/v1/catalogs/bootstrap` trả về `externalCarriers` có ít nhất 1 nhà xe đang `isActive: true` (ví dụ HÀ AN, Nam Phong, Biên Đông).
  - Lô FCL đã READY_FOR_DISPATCH hiển thị trên `/dispatch` (Kế hoạch tổng quát), cột "Phân bổ nhà xe" đang "Chưa phân bổ".
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`.
  2. Tại cột "Phân bổ nhà xe" của 1 lô FCL, bấm "Chỉnh sửa phân bổ nhà xe" → dialog "Phân bổ nhà xe" mở ra.
  3. Bấm vào dropdown "Nhà xe" ở dòng "Phân bổ 1". Quan sát các option hiển thị.
  4. Bấm "Thêm nhà xe". Bấm dropdown "Nhà xe" ở dòng "Phân bổ 2". Quan sát.
  5. Chọn 1 nhà xe ngoài (EXTERNAL) cho dòng 1, nhập số container. Bấm "Lưu phân bổ".
  6. Mở lại dialog "Phân bổ nhà xe" cho cùng lô đó. Quan sát dropdown vẫn có nhà xe ngoài.
- **Kết quả mong đợi (Pass):**
  - Dropdown "Nhà xe" hiển thị **tất cả** option: "Đội xe nội bộ SilverSea" + toàn bộ nhà xe ngoài `isActive: true` từ `bootstrap.externalCarriers` (label lấy từ `carrier.name`).
  - "Thêm nhà xe" tạo được dòng mới, dropdown dòng mới cũng liệt kê nhà xe ngoài còn trống (không trùng với dòng đã chọn).
  - Lưu thành công với nhà xe ngoài: chip "Phân bổ nhà xe" trên master plan hiển thị cả OWN (nếu có) lẫn EXTERNAL (ví dụ "Biên Đông: 1x40'").
  - Mở lại dialog sau khi lưu: dropdown vẫn đầy đủ nhà xe ngoài (không bị reset về chỉ OWN).
- **Kỳ vọng sai (Fail nếu):**
  - Dropdown chỉ có 1 option "Đội xe nội bộ SilverSea", không có nhà xe ngoài nào (hành vi cũ — đã fix).
  - Có nhà xe ngoài trong dropdown nhưng bấm "Thêm nhà xe" không thêm được dòng mới hoặc không cho chọn nhà xe ngoài.
  - Không có cảnh báo khi `externalCarriers` rỗng/lỗi — user tưởng chỉ có OWN.
- **Bằng chứng:** ảnh dialog đang mở dropdown nhà xe (thấy cả OWN + EXTERNAL) + ảnh 2 dòng với 2 nhà xe khác nhau + ảnh chip sau khi lưu + ảnh Network `/api/v1/catalogs/bootstrap` chứa `externalCarriers` không rỗng

---

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

### TC-DV-DISPATCH-015 — Dialog "Phân bổ nhà xe" nhận diện dữ liệu nhà xe đã nhập và cho phép lưu

- **Mã PRD:** Bug fix regression — dialog "Phân bổ nhà xe" (Kế hoạch tổng quát) không nhận diện dữ liệu nhà xe đã nhập, dẫn đến trạng thái "Chưa phân đủ" hiển thị sai hoặc không cho phép lưu khi dữ liệu đã hợp lệ
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - Lô FCL READY_FOR_DISPATCH có 2 container 40' (0 container 20').
  - Dialog "Phân bổ nhà xe" đã mở, hiện dòng "Phân bổ 1" với dropdown "Nhà xe" và 2 ô input container.
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`. Tìm lô FCL có 2 container 40'. Bấm "Chỉnh sửa phân bổ nhà xe".
  2. Trong dialog, chọn "Đội xe nội bộ SilverSea" từ dropdown "Nhà xe".
  3. Nhập `0` vào ô "Container 20'" và `1` vào ô "Container 40'".
  4. Quan sát: bảng "Tổng phân bổ" cập nhật đúng (Đã phân = 1x40', Còn lại = 1x40').
  5. Quan sát: trạng thái hiển thị "Chưa phân đủ" (không phải "Cần điều chỉnh") và nút "Lưu phân bổ" **được phép bấm** (enabled).
  6. Bấm "Lưu phân bổ". Kiểm tra: lưu thành công, dialog đóng, chip trên master plan hiển thị "SilverSea: 1x40'".
  7. Mở lại dialog cho cùng lô đó. Kiểm tra: dữ liệu "Đội xe nội bộ SilverSea" với 1x40' được giữ nguyên (prefill đúng).
  8. Thêm dòng "Phân bổ 2", chọn nhà xe ngoài (ví dụ HÀ AN), nhập `0` container 20' và `1` container 40'.
  9. Quan sát: bảng "Tổng phân bổ" cập nhật (Đã phân = 2x40', Còn lại = 0). Trạng thái chuyển sang "Đã phân đủ".
  10. Bấm "Lưu phân bổ". Kiểm tra: lưu thành công, chip hiển thị cả 2 nhà xe.
- **Kết quả mong đợi (Pass):**
  - Bước 4: Tổng phân bổ cập nhật ngay khi nhập số container (không cần bấm nút nào khác).
  - Bước 5: Trạng thái "Chưa phân đủ" hiển thị đúng (không nhầm thành lỗi), nút "Lưu phân bổ" enabled.
  - Bước 6: Lưu thành công với `carrierType: 'OWN'`, `count40: 1`. Version shipment tăng.
  - Bước 7: Mở lại dialog → dữ liệu prefill đúng từ `carrierAllocationSummary` (không reset về空白).
  - Bước 9: Tổng phânổ = 2x40' = nhu cầu → "Đã phân đủ".
  - Bước 10: Lưu thành công cả 2 nhà xe (OWN + EXTERNAL).
- **Kỳ vọng sai (Fail nếu):**
  - Nhập số container nhưng bảng "Tổng phân bổ" không cập nhật (Đã phân vẫn = 0).
  - Trạng thái hiển thị "Cần điều chỉnh" hoặc nút "Lưu phân bổ" bị disabled dù dữ liệu hợp lệ.
  - Mở lại dialog mà dữ liệu đã nhập bị reset về空白 (prefill không hoạt động).
  - Lưu thành công nhưng chip không hiển thị trên master plan.
  - Backend trả lỗi "Mỗi nhà xe chỉ được xuất hiện một lần" dù chọn 2 nhà xe khác nhau.
- **Bằng chứng:** ảnh dialog sau khi nhập dữ liệu (bảng tổng phân bổ cập nhật) + ảnh nút "Lưu phân bổ" enabled + ảnh chip trên master plan sau lưu + ảnh dialog mở lại (prefill đúng) + ảnh Network 200 khi lưu

---

### TC-DV-DISPATCH-016 — Lưu phân bổ một phần (partial) và bổ sung sau

- **Mã PRD:** Bug fix regression — phân bổ một phần không được lưu hoặc dữ liệu bị mất khi bổ sung sau
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có 2 container 40' (0 container 20').
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`. Tìm lô FCL có 2 container 40'. Bấm "Chỉnh sửa phân bổ nhà xe".
  2. Chọn "Đội xe nội bộ SilverSea", nhập `0` container 20' và `1` container 40'.
  3. Bấm "Lưu phân bổ". Kiểm tra: lưu thành công (mode = partial, cho phép under-allocation).
  4. Quan sát master plan: chip hiển thị "SilverSea: 1x40'", trạng thái lô = "PARTIALLY_ALLOCATED".
  5. Mở lại dialog cho cùng lô đó. Kiểm tra: dữ liệu "SilverSea: 1x40'" được giữ nguyên.
  6. Thêm dòng "Phân bổ 2", chọn nhà xe ngoài, nhập `0` container 20' và `1` container 40'.
  7. Bấm "Lưu phân bổ". Kiểm tra: lưu thành công, trạng thái lô chuyển sang "FULLY_ALLOCATED".
  8. Kiểm tra DB: `shipment_fulfillments` có 2 rows, mỗi row `plannedCarrierType` đúng (1 OWN, 1 EXTERNAL).
- **Kết quả mong đợi (Pass):**
  - Bước 3: Lưu partial thành công, không bị lỗi "Phân bổ chưa khớp".
  - Bước 4: Master plan chip cập nhật đúng, allocationStatus = PARTIALLY_ALLOCATED.
  - Bước 5: Prefill đúng dữ liệu đã lưu (không reset).
  - Bước 7: Lưu lần 2 thành công, allocationStatus = FULLY_ALLOCATED.
  - Bước 8: DB đúng 2 fulfillments, mỗi cái plannedCarrierType riêng.
- **Kỳ vọng sai (Fail nếu):**
  - Lưu partial bị lỗi "Phân bổ nhà xe chưa khớp" (backend reject partial).
  - Dữ liệu bị mất khi mở lại dialog (prefill sai).
  - Lưu lần 2 bị lỗi 409 version conflict (version không tăng sau lần lưu đầu).
  - DB có fulfillments với plannedCarrierType sai hoặc thiếu.
- **Bằng chứng:** ảnh dialog lần 1 + ảnh master plan sau lần 1 (chip + status) + ảnh dialog lần 2 (prefill) + ảnh master plan sau lần 2 + query DB `shipment_fulfillments`

---

### TC-DV-DISPATCH-018 — Phát lệnh xe ngoài với biển số tự do (không cần xe trong database) (regression 2026-09-05)

- **Mã PRD:** Bug fix 2026-09-05 — phát lệnh FCL cho xe ngoài bị chặn với lỗi "Vui lòng chọn xe của nhà xe" khi biển số chưa có trong danh mục `carrierFleetVehicles`
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - Lô FCL READY_FOR_DISPATCH đã được phân bổ cho nhà xe ngoài (ví dụ Biên Đông) với 1 container 40'.
  - Nhà xe ngoài đã chọn có `carrierFleetVehicles` rỗng hoặc không chứa biển số cần dùng (xe mới, chưa đăng ký trong catalog).
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch-detail` (Kế hoạch chi tiết).
  2. Tìm fulfillment đã phân xe ngoài (Biên Đông). Ở cột "Biển số", chọn nhà xe ngoài và nhập biển số tự do (ví dụ `15C-222.33`) — không chọn từ dropdown fleet.
  3. Nhập tên tài xế: "Nguyen Van X". Nhập SĐT: "0912344565".
  4. Đặt giờ chạy và giờ kết thúc hợp lệ.
  5. Bấm "Phát lệnh".
- **Kết quả mong đợi (Pass):**
  - Lệnh phát hành thành công, **không** bị lỗi "Vui lòng chọn xe của nhà xe".
  - Trip được tạo với `externalPlateNumber = '15C-222.33'` và `externalCarrierVehicleId = null` (vì xe không có trong catalog).
  - Biển số hiển thị đúng trên Kế hoạch chi tiết sau khi phát lệnh.
- **Kỳ vọng sai (Fail nếu):**
  - Vẫn trả lỗi 400 "Vui lòng chọn xe của nhà xe" (hành vi cũ — đã fix).
  - Biển số bị mất hoặc hiển thị sai sau khi phát lệnh.
- **Bằng chứng:** ảnh dialog "Phát lệnh" khi nhập biển số tự do + ảnh trip đã tạo trong DB (`external_plate_number`, `external_carrier_vehicle_id`) + ảnh Kế hoạch chi tiết sau phát lệnh

---

### TC-DV-DISPATCH-017 — Warning "Chưa có nhà xe ngoài nào được cấu hình" phải ẩn khi đã nhập OWN allocation (regression 2026-09-05)

- **Mã PRD:** Bug fix 2026-09-05 — dialog "Phân bổ nhà xe" hiển thị liên tục warning "Chưa có nhà xe ngoài nào được cấu hình. Liên hệ Quản trị viên để bật cờ isCarrier…" ngay cả khi dispatcher đã nhập OWN allocation hợp lệ. Warning misleading khiến dispatcher nghĩ hệ thống không nhận diện dữ liệu đã nhập.
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - Backend `/api/v1/catalogs/bootstrap` trả về `externalCarriers: []` (zero nhà xe ngoài). Chỉ có "Đội xe nội bộ SilverSea".
  - Lô FCL READY_FOR_DISPATCH có 2 container 40' (0 container 20').
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`. Tìm lô FCL có 2 container 40'. Bấm "Chỉnh sửa phân bổ nhà xe".
  2. Quan sát ngay khi dialog mở (chưa nhập gì): warning "Chưa có nhà xe ngoài nào được cấu hình…" **phải hiển thị** (giải thích vì sao nút "+ Thêm nhà xe" bị disabled).
  3. Chọn "Đội xe nội bộ SilverSea" từ dropdown "Nhà xe".
  4. Nhập `0` vào ô "Container 20'" và `1` vào ô "Container 40'".
  5. Quan sát bảng "Tổng phân bổ": Đã phân 40' = 1, Còn lại 40' = 1.
  6. Quan sát: warning "Chưa có nhà xe ngoài nào được cấu hình…" **phải ẩn** (không còn hiển thị trong DOM). Status "Chưa phân đủ" và bottom note "Có thể lưu phân bổ hiện tại và bổ sung sau…" vẫn hiển thị.
  7. Bấm "Lưu phân bổ". Kiểm tra: lưu thành công.
  9. Mở lại dialog cho cùng lô đó. Nhập tiếp `0` container 20' và `1` container 40' vào dòng hiện có (cùng OWN). Quan sát: warning vẫn ẩn.
- **Kết quả mong đợi (Pass):**
  - Bước 2: Warning hiển thị khi chưa có allocation nào.
  - Bước 5: Tổng phân bổ cập nhật đúng (Đã phân 40' = 1, Còn lại 40' = 1).
  - Bước 6: Warning ẩn sau khi nhập OWN allocation hợp lệ. Status "Chưa phân đủ" vẫn đúng (partial), bottom note vẫn đúng (có thể lưu + bổ sung sau).
  - Bước 7: Lưu thành công, chip master plan hiển thị "SilverSea: 1x40'", allocationStatus = PARTIALLY_ALLOCATED.
  - Bước 9: Warning vẫn ẩn khi có allocation hợp lệ, kể cả khi nhập thêm số container vào dòng hiện có.
- **Kỳ vọng sai (Fail nếu):**
  - Warning vẫn hiển thị sau khi nhập OWN + số container > 0 (hành vi cũ — đã fix). Dispatcher thấy warning tưởng hệ thống không nhận diện dữ liệu.
  - Warning ẩn cả khi chưa nhập gì (mất thông tin hữu ích về config).
  - Bảng "Tổng phân bổ" không cập nhật khi nhập số container.
  - Nút "Lưu phân bổ" bị disabled dù dữ liệu OWN hợp lệ.
- **Bằng chứng:** ảnh dialog ngay khi mở (warning hiển thị) + ảnh dialog sau khi nhập OWN + 1x40' (warning ẩn, summary cập nhật, status "Chưa phân đủ") + ảnh master plan chip sau lưu + ảnh Network 200 khi lưu + ảnh `/api/v1/catalogs/bootstrap` response có `externalCarriers: []`

---

### TC-DV-DISPATCH-019 — Lô hàng có 1 cont hoàn thành vẫn hiển thị trên màn Điều vận (regression 2026-09-05)

- **Mã PRD:** Bug fix 2026-09-05 — lô hàng FCL có 1 container đã hoàn thành vận chuyển bị mất hiển thị cả lô trên màn Điều vận (Kế hoạch chi tiết)
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - Lô FCL có 2 container, mỗi container 1 fulfillment. Container A đã phát lệnh và hoàn thành (trip status = COMPLETED, shipment status đã chuyển sang COMPLETED). Container B chưa phát lệnh (fulfillment chưa có trip).
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch-detail` (Kế hoạch chi tiết).
  2. Tìm lô FCL có 2 container. Kiểm tra: cả 2 fulfillment phải hiển thị trên danh sách.
  3. Quan sát fulfillment container A: trip đã tạo, status chip = "Hoàn thành".
  4. Quan sát fulfillment container B: chưa có trip, status chip = "Chưa phát lệnh".
  5. Mở `/dispatch` (Kế hoạch tổng quát). Kiểm tra: lô vẫn hiển thị trong danh sách.
- **Kết quả mong đợi (Pass):**
  - Cả 2 fulfillment hiển thị trên Kế hoạch chi tiết, kể cả fulfillment container A đã hoàn thành.
  - Lô vẫn hiển thị trên Kế hoạch tổng quát.
  - Không bị mất hiển thị cả lô khi 1 container hoàn thành.
- **Kỳ vọng sai (Fail nếu):**
  - Fulfillment container A bị ẩn hoặc cả lô biến mất (hành vi cũ — đã fix).
  - Không thấy fulfillment đã hoàn thành trên Kế hoạch chi tiết.
- **Bằng chứng:** ảnh Kế hoạch chi tiết thấy cả 2 fulfillment + ảnh Kế hoạch tổng quát thấy lô + query DB `shipments.status` cho thấy status đã chuyển sang COMPLETED

---

## 2.9 — Quy tắc cấp dữ liệu & tự động hóa (PRD Bước 2a / 2b)

Các case dưới đây mã hóa các quy tắc nền tảng trong `docs/prd/QuyTrinhO2C.md` Bước 2a / 2b — rút ra từ
tài liệu `1. Processes/Dispatch_Screen.docx`, `1. Processes/Dispatch_detail_screen.docx`,
`1. Processes/(TK) Product Spec.md` và `5. Archive/Sidebar_update.md`. Nếu sau này màn `/dispatch`
hoặc `/dispatch-detail` thay đổi cấp dữ liệu hoặc trigger, các case này phải được cập nhật trước.

### TC-DV-DISPATCH-020 — Màn `/dispatch` (Kế hoạch tổng quát) hiển thị theo LÔ HÀNG, không theo container

- **Mã PRD:** O2C Bước 2a (PRD: QuyTrinhO2C.md §2a)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có **≥ 5 container** (ví dụ 5×40HC). Lô LCL có ≥ 10 dòng hàng lẻ. Lô có `Ngày giao hàng` hợp lệ.
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`.
  2. Tìm lô FCL 5×40HC vừa tạo. Quan sát số dòng trên bảng cho lô đó.
  3. Tìm lô LCL 10 dòng hàng lẻ. Quan sát số dòng.
  4. Mở API response của `GET /api/shipments?status=READY_FOR_DISPATCH,DISPATCHED,IN_TRANSIT,COMPLETED` — đếm số row trả về cho mỗi lô (mỗi lô đúng 1 row, bất kể số container).
- **Kết quả mong đợi (Pass):**
  - Lô FCL 5×40HC hiển thị **đúng 1 dòng** trên bảng, **không** có 5 dòng con.
  - Lô LCL 10 dòng hàng lẻ cũng hiển thị **đúng 1 dòng**.
  - Trên UI, **không** hiển thị các cột số cont / biển số xe / cảng nâng-hạ riêng từng container (chỉ tổng số lượng + khối lượng cộng gộp).
  - API response trả về đúng 1 row per shipment (không phải per container).
- **Kỳ vọng sai (Fail nếu):**
  - Lô FCL 5×40HC hiển thị 5 dòng (đang rã sai cấp dữ liệu).
  - Lô LCL 10 dòng hiển thị 10 dòng.
  - Có cột "Số cont", "Biển số" hoặc "Cảng nâng/hạ" riêng cho từng container.
- **Bằng chứng:** ảnh màn `/dispatch` thấy 1 dòng cho lô 5×40HC + ảnh API Network tab.

### TC-DV-DISPATCH-021 — Phân bổ 1 lô cho nhiều nhà xe (multi-vendor)

- **Mã PRD:** O2C Bước 2a (multi-vendor allocation)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có **4 container 40'**, OWN fleet + ít nhất 1 EXTERNAL carrier (Biên Đông) đều active trong `/catalogs/bootstrap`.
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`. Bấm "Chỉnh sửa phân bổ nhà xe" trên lô 4×40HC.
  2. Trong dialog "Phân bổ nhà xe", chọn "Đội xe nội bộ SilverSea" ở dòng 1, nhập `0×20'` + `2×40'`.
  3. Bấm "Thêm nhà xe". Chọn "Biên Đông" ở dòng 2, nhập `0×20'` + `2×40'`.
  4. Quan sát bảng "Tổng phân bổ": Đã phân = 4×40', Còn lại = 0.
  5. Bấm "Lưu phân bổ".
  6. Quan sát master plan: chip "Phân bổ nhà xe" hiển thị cả 2 nhà xe (ví dụ `[SilverSea: 2×40'] [Biên Đông: 2×40']`).
  7. Mở `/dispatch-detail` (Kế hoạch chi tiết) — xác nhận **2 dòng pre-fill tên nhà xe khác nhau** đúng theo phân bổ (không phải random hóa sai).
- **Kết quả mong đợi (Pass):**
  - Dialog cho phép thêm nhiều dòng nhà xe; dropdown mỗi dòng liệt kê OWN + EXTERNAL `isActive: true`.
  - Tổng 4×40' khớp nhu cầu → "Đã phân đủ".
  - Lưu thành công; chip master plan hiển thị cả OWN lẫn EXTERNAL.
  - `/dispatch-detail` mở ra đúng 4 dòng container, pre-fill nhà xe đúng theo phân bổ.
- **Kỳ vọng sai (Fail nếu):**
  - Chỉ cho phép 1 dòng nhà xe duy nhất (thiếu nút "+ Thêm nhà xe").
  - Dropdown chỉ có OWN, không có EXTERNAL.
  - Lưu thất bại vì backend reject multi-vendor.
  - Pre-fill nhà xe ở `/dispatch-detail` sai (random hoặc đảo dòng).
- **Bằng chứng:** ảnh dialog 2 dòng OWN + EXTERNAL + ảnh master plan chip + ảnh `/dispatch-detail` 4 dòng pre-fill + query DB `shipment_fulfillments` (2 rows: 1 OWN + 1 EXTERNAL).

### TC-DV-DISPATCH-022 — Validation: tổng phân bổ cont vượt quá tổng cont của lô → chặn lưu

- **Mã PRD:** O2C Bước 2a (validation rule)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có **2 container 40'** (0 container 20'). OWN fleet + ít nhất 1 EXTERNAL carrier active.
- **Các bước:**
  1. Mở `/dispatch`. Bấm "Chỉnh sửa phân bổ nhà xe" trên lô 2×40HC.
  2. Dòng 1 — chọn OWN, nhập `0×20'` + `2×40'`.
  3. Bấm "Thêm nhà xe". Dòng 2 — chọn Biên Đông, nhập `0×20'` + `1×40'` (cố tình vượt 1).
  4. Quan sát bảng "Tổng phân bổ": Đã phân = 3×40', Còn lại = −1×40'.
  5. Quan sát nút "Lưu phân bổ".
  6. Bấm "Lưu phân bổ".
- **Kết quả mong đợi (Pass):**
  - Bảng "Tổng phân bổ" hiển thị cảnh báo "vượt tổng cont" bằng tiếng Việt.
  - Nút "Lưu phân bổ" **disabled** (hoặc nếu click thì backend trả 4xx với message tiếng Việt).
  - Không có row nào được tạo trong `shipment_fulfillments`.
- **Kỳ vọng sai (Fail nếu):**
  - Cho phép lưu → DB có 2 fulfillments với `plannedContainerCount40` cộng lại > 2.
  - Không có cảnh báo, nút Lưu vẫn enabled.
- **Bằng chứng:** ảnh dialog tổng phân bổ vượt + ảnh nút Lưu disabled + ảnh Network 4xx + query DB `shipment_fulfillments` (không thay đổi).

### TC-DV-DISPATCH-023 — Auto-split từ `/dispatch` sang `/dispatch-detail` sau khi lưu phân bổ

- **Mã PRD:** O2C Bước 2a (auto-split trigger)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có **3 container 40'**. Cả OWN và EXTERNAL đều active.
- **Các bước:**
  1. Mở `/dispatch`. Trên lô 3×40HC, bấm "Chỉnh sửa phân bổ nhà xe".
  2. Phân bổ: OWN = 2×40', EXTERNAL (Biên Đông) = 1×40'. Lưu.
  3. Quan sát: master plan có chip "OWN: 2×40', Biên Đông: 1×40'".
  4. Chuyển sang `/dispatch-detail`. Tìm cùng lô đó.
  5. Đếm số dòng fulfillment xuất hiện. Kiểm tra cột "Nhà xe" trên từng dòng đã được pre-fill (OWN hoặc Biên Đông).
- **Kết quả mong đợi (Pass):**
  - `/dispatch-detail` hiển thị **đúng 3 dòng** (mỗi container 1 dòng).
  - 2 dòng pre-fill OWN, 1 dòng pre-fill Biên Đông — khớp đúng với phân bổ vừa lưu.
  - Cột biển số xe đang trống (chưa gán).
- **Kỳ vọng sai (Fail nếu):**
  - `/dispatch-detail` không hiển thị lô vừa phân bổ.
  - Số dòng sai (ít hơn 3 hoặc nhiều hơn 3).
  - Pre-fill nhà xe sai (random không khớp phân bổ).
- **Bằng chứng:** ảnh `/dispatch` sau lưu + ảnh `/dispatch-detail` 3 dòng pre-fill đúng + ảnh DB `shipment_fulfillments` (3 rows đúng plannedCarrierType).

### TC-DV-DISPATCH-024 — Màn `/dispatch-detail` (Kế hoạch chi tiết) hiển thị theo CONTAINER, không theo lô

- **Mã PRD:** O2C Bước 2b (PRD: QuyTrinhO2C.md §2b)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có 2 lô — 1 lô 1 container, 1 lô 5 container.
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch-detail`.
  2. Đếm tổng số dòng fulfillment hiển thị.
  3. Đối chiếu: lô 1 cont → 1 dòng, lô 5 cont → 5 dòng.
- **Kết quả mong đợi (Pass):**
  - Tổng số dòng = **6 dòng** (không phải 2 dòng theo lô).
  - Mỗi dòng có: Số Cont (hoặc "Chưa có số"), Loại Cont, Trọng lượng, Nhà xe (pre-fill), Biển số (đang trống).
- **Kỳ vọng sai (Fail nếu):**
  - Chỉ hiển thị 2 dòng (đang sai cấp dữ liệu).
  - Không có cột "Số cont" / "Loại cont".
  - Có Expandable Rows thay vì trải phẳng (đã lỗi thời).
- **Bằng chứng:** ảnh `/dispatch-detail` đếm được 6 dòng + ảnh Network `/api/v1/shipments/dispatch-detail` response.

### TC-DV-DISPATCH-025 — Lô chỉ chuyển "Đã phân xe" khi TẤT CẢ container đã gán biển số

- **Mã PRD:** O2C Bước 2b (status trigger — `Đã phân xe` chỉ khi đủ biển số)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có **3 container 40'**, đã được pre-fill nhà xe ở `/dispatch-detail`. Tài khoản OWN đang có sẵn biển số trong master data.
- **Các bước:**
  1. Mở `/dispatch-detail` cho lô 3×40HC.
  2. **Bước 1:** Gán biển số xe cho dòng container 1. Lưu. Quan sát trạng thái lô.
  3. **Bước 2:** Gán biển số xe cho dòng container 2. Lưu. Quan sát.
  4. **Bước 3:** Để dòng container 3 **chưa gán biển số** (để trống). Lưu. Quan sát.
  5. Sau 3 bước: truy vấn DB `shipments.status` của lô.
- **Kết quả mong đợi (Pass):**
  - Sau bước 1: lô vẫn ở trạng thái cũ (chưa `Đã phân xe`).
  - Sau bước 2: lô vẫn ở trạng thái cũ.
  - Sau bước 3 (dòng 3 trống): lô vẫn ở trạng thái cũ.
  - DB `shipments.status` = `READY_FOR_DISPATCH` (hoặc tương đương, không phải `DISPATCHED`).
  - Chỉ khi gán đủ cả 3 dòng → lô mới chuyển `Đã phân xe`.
- **Kỳ vọng sai (Fail nếu):**
  - Sau bước 1, lô đã chuyển `Đã phân xe` dù còn 2 dòng trống.
  - DB `shipments.status` chuyển `DISPATCHED` khi mới chỉ 1/3 dòng có biển số.
- **Bằng chứng:** ảnh lô sau từng bước (status chip) + query DB `shipments.status` qua 3 bước.

### TC-DV-DISPATCH-026 — Push notification tới Lái xe khi gán biển số Xe nhà

- **Mã PRD:** O2C Bước 2b (push notification trigger)
- **Vai trò:** `dieuvan` (gán) + `laixe` / `thu` (nhận push)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900) cho `dieuvan`; Mobile (390×844) cho `laixe`
- **Tiền điều kiện:**
  - Lô FCL READY_FOR_DISPATCH có ≥ 1 container, đã pre-fill nhà xe OWN.
  - Tài khoản `laixe` đang bind với 1 biển số OWN (theo `testaccounts.txt`).
- **Các bước:**
  1. `dieuvan` mở `/dispatch-detail`. Gán biển số OWN của `laixe` cho 1 dòng container. Lưu.
  2. Quan sát: trong vòng 5 giây, `laixe` đăng nhập app Lái xe → tab "Lệnh mới" có chuyến vừa được gán.
  3. Kiểm tra push notification trên thiết bị `laixe` (nếu có PWA / mobile): thông báo "Chuyến được điều phối".
- **Kết quả mong đợi (Pass):**
  - Chuyến xuất hiện trong tab "Lệnh mới" của `laixe` ngay sau khi `dieuvan` lưu.
  - Push notification hiển thị tiếng Việt "Chuyến được điều phối" (hoặc tương đương).
  - Push xảy ra **trước** khi Ops đổi lệnh giấy (kể cả khi lô chưa `Đã phân xe` hẳn — miễn là 1 dòng Xe nhà đã có biển số).
- **Kỳ vọng sai (Fail nếu):**
  - Chuyến không xuất hiện trên app Lái xe.
  - Push notification chỉ tới khi cả lô `Đã phân xe` (chậm so với yêu cầu).
  - Chuyến xuất hiện nhưng thông báo sai nội dung / sai tiếng Việt.
- **Bằng chứng:** ảnh `/dispatch-detail` sau khi lưu + ảnh app Lái xe tab "Lệnh mới" + ảnh push notification.

### TC-DV-DISPATCH-027 — Lô `Chờ chốt lịch` (PENDING_DATE) bị ẩn khỏi `/dispatch`

- **Mã PRD:** O2C Bước 1 (validation) + Bước 2a (display rule)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Có 2 lô — 1 lô READY_FOR_DISPATCH (đủ ngày giao), 1 lô PENDING_DATE (thiếu `Ngày giao hàng`).
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch`.
  2. Tìm lô READY_FOR_DISPATCH — phải xuất hiện.
  3. Tìm lô PENDING_DATE — **phải không xuất hiện** trên bất kỳ filter nào (kể cả xóa filter ngày, kể cả search theo BL/khách hàng).
  4. Mở API `/api/v1/shipments/dispatch` — đảm bảo response không chứa lô PENDING_DATE.
- **Kết quả mong đợi (Pass):**
  - Lô PENDING_DATE hoàn toàn vắng mặt trên UI.
  - API response không trả về lô PENDING_DATE (bất kể filter nào).
  - Search "Số bill" của lô PENDING_DATE → trả về 0 dòng.
- **Kỳ vọng sai (Fail nếu):**
  - Lô PENDING_DATE hiện ra khi xóa filter ngày.
  - Lô PENDING_DATE trả về qua search.
- **Bằng chứng:** ảnh `/dispatch` chỉ thấy 1 lô READY + ảnh search 0 dòng + Network response không chứa PENDING.

### TC-DV-DISPATCH-028 — Xe ngoài cho phép nhập biển số tự do (free-text) khi chưa có trong catalog

- **Mã PRD:** O2C Bước 2b (xe ngoài free-text)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH đã phân bổ 1 container cho EXTERNAL carrier (ví dụ Biên Đông). Carrier này có `carrierFleetVehicles` rỗng (chưa đăng ký xe nào).
- **Các bước:**
  1. Mở `/dispatch-detail`. Tại dòng container EXTERNAL, cột "Biển số", chọn nhà xe ngoài (Biên Đông).
  2. Trong ô nhập biển số, **gõ tay** `15C-222.33` (không chọn từ dropdown).
  3. Nhập tên tài xế "Nguyen Van X", SĐT "0912344565".
  4. Bấm "Phát lệnh".
- **Kết quả mong đợi (Pass):**
  - Lệnh phát hành thành công, không bị lỗi "Vui lòng chọn xe của nhà xe".
  - Trip tạo ra với `externalPlateNumber = '15C-222.33'`, `externalCarrierVehicleId = NULL`.
  - Biển số hiển thị đúng trên Kế hoạch chi tiết sau phát lệnh.
- **Kỳ vọng sai (Fail nếu):**
  - Trả lỗi 400 "Vui lòng chọn xe của nhà xe" khi biển số không có trong dropdown (hành vi cũ).
  - Dropdown buộc chọn từ danh sách có sẵn, không cho gõ tự do.
- **Bằng chứng:** ảnh dialog phát lệnh với biển số free-text + ảnh trip trong DB (`trips.external_plate_number` đúng) + ảnh `/dispatch-detail` sau phát lệnh.

---

## 2.10 — Phân loại chuyến: Đơn / Kẹp / Kết hợp

PRD Bước 2b quy định 4 phân loại chuyến (Đơn, Kẹp, Kết hợp, Lẻ) — trong đó 3 mô hình cont được mô tả
chi tiết tại `docs/prd/QuyTrinhO2C.md` §2b với sơ đồ và bảng so sánh. Phần này mã hóa các case nghiệm thu
cho 2 mô hình còn thiếu test chính thức: ghép kết hợp cùng/khác lô, và kẹp không hợp lệ (đổi tài xế).

### TC-DV-DISPATCH-029 — Ghép kết hợp CÙNG LÔ: 1 xe chở 2 container của cùng 1 lô FCL

- **Mã PRD:** O2C Bước 2b (kết hợp cùng lô)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - Lô FCL READY_FOR_DISPATCH có **4 container 20'** (tổng khối lượng ≤ tải trọng xe 40').
  - OWN fleet có 1 đầu kéo + 1 rơ-moóc 40' (2 slot 20') đang ACTIVE.
- **Các bước:**
  1. Mở `/dispatch-detail` cho lô 4×20'. Hệ thống đã auto-split thành 4 dòng container, pre-fill OWN.
  2. Chọn 2 dòng container (cùng lô). Bấm "Ghép chuyến" / "Kết hợp".
  3. Gán cùng biển số OWN + cùng tài xế cho cả 2 dòng.
  4. Đặt giờ chạy và giờ kết thúc giống nhau (cùng tuyến, overlap thời gian).
  5. Bấm "Phát hành lệnh điều xe".
  6. Quan sát: số trip tạo ra; mỗi trip link tới bao nhiêu fulfillments.
  7. Mở DB: kiểm tra `trips` ↔ `shipment_fulfillments` quan hệ.
- **Kết quả mong đợi (Pass):**
  - Tạo **đúng 1 trip** cho cả 2 dòng container (không phải 2 trip riêng).
  - Trip đó link tới **2 fulfillments** thuộc cùng lô (quan hệ N:1 trip ↔ fulfillments).
  - Biển số, tài xế, khung giờ hiển thị đồng nhất trên cả 2 dòng fulfillment.
  - Phí đường / VETC: ghi 1 lần cho cả nhóm (chia đều hoặc theo cấu hình kế toán).
- **Kỳ vọng sai (Fail nếu):**
  - Tạo 2 trip riêng cho 2 dòng ghép (đang hiểu nhầm thành "đơn 2 chuyến").
  - Trip chỉ link 1 fulfillment (bỏ sót container ghép).
  - Phí đường bị nhân đôi (2 trip × 1 phí đường).
- **Bằng chứng:** ảnh `/dispatch-detail` 2 dòng đã ghép + ảnh trip ID trong DB + ảnh quan hệ trip ↔ fulfillment + ảnh Network 200.

### TC-DV-DISPATCH-030 — Ghép kết hợp KHÁC LÔ: 1 xe chở container của 2 lô cùng tuyến, cùng KH

- **Mã PRD:** O2C Bước 2b (kết hợp khác lô)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - 2 lô FCL READY_FOR_DISPATCH cùng KH (LONG MINH), cùng tuyến Cảng Hải Phòng → Nhà máy Bắc Ninh, cùng ngày giao.
  - Lô A: 1×40HC; Lô B: 1×20'. Tổng khối lượng ≤ tải trọng xe OWN 40'.
  - OWN fleet có 1 đầu kéo + 1 rơ-moóc 40' đang ACTIVE.
- **Các bước:**
  1. Mở `/dispatch-detail`. Lọc theo tuyến Hải Phòng → Bắc Ninh, ngày giao hôm nay.
  2. Chọn 1 dòng container từ Lô A + 1 dòng container từ Lô B (2 lô khác nhau).
  3. Bấm "Ghép chuyến" / "Kết hợp".
  4. Gán cùng biển số OWN cho cả 2 dòng.
  5. Đặt giờ chạy overlap (cùng ca, cùng tuyến).
  6. Bấm "Phát hành lệnh điều xe".
  7. Mở DB: kiểm tra 1 trip link tới fulfillments của cả 2 lô.
- **Kết quả mong đợi (Pass):**
  - Tạo **đúng 1 trip** chứa 2 fulfillments thuộc 2 lô khác nhau.
  - Trên app Lái xe (`laixe`): 1 chuyến hiển thị gồm cả 2 bill (Lô A + Lô B).
  - Phí đường: 1 lần cho cả nhóm.
  - Doanh thu: mỗi fulfillment giữ doanh thu của lô mình (không trộn).
- **Kỳ vọng sai (Fail nếu):**
  - Hệ thống chặn không cho ghép khác lô (thiếu tính năng).
  - Tạo 2 trip riêng, mỗi trip 1 fulfillment.
  - Trộn doanh thu giữa 2 lô (sai nghiệp vụ kế toán).
- **Bằng chứng:** ảnh `/dispatch-detail` 2 dòng khác lô đã ghép + ảnh app Lái xe thấy 1 chuyến 2 bill + ảnh DB `trips` ↔ `shipment_fulfillments` (1 trip, 2 fulfillments, 2 lô) + ảnh Network 200.

### TC-DV-DISPATCH-031 — Kẹp hàng KHÔNG hợp lệ vì khác tài xế → bị chặn, không được hưởng ưu đãi phí đường

- **Mã PRD:** O2C Bước 2b (kẹp — điều kiện bắt buộc)
- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:**
  - 2 lô OWN cùng xe `15C-284.56` (gắn với `laixe`), cùng tuyến 2 chiều, thời gian không chồng lấn.
  - Có 1 tài khoản OWN khác (ví dụ `thu`) gắn với xe khác, đang rảnh cùng khung giờ.
- **Các bước:**
  1. Mở `/dispatch-detail`. Tạo 2 trip kẹp hợp lệ với xe `15C-284.56` + tài xế `laixe` (chiều đi + chiều về).
  2. Bấm tích "Kẹp hàng" cho cặp trip đó. Phát lệnh. Quan sát: 2 trip tạo ra, liên kết cặp kẹp thành công.
  3. Sau đó: **đổi tài xế** chiều về sang `thu` (cùng xe, khác tài xế). Lưu lại.
  4. Mở chi phí dự kiến/thực tế. Quan sát: tổng phí đường.
  5. Bấm "Kẹp hàng" lại trên cặp này.
- **Kết quả mong đợi (Pass):**
  - Bước 3: khi đổi tài xế chiều về sang `thu` (khác `laixe`), hệ thống **cảnh báo** "Không đủ điều kiện kẹp hàng" hoặc **tự gỡ liên kết kẹp** (cặp không còn hợp lệ).
  - Bước 4: tổng phí đường được tính **2 lần** (mỗi trip 1 lần) — không còn ưu đãi lộ trình khép kín.
  - Bước 5: tích "Kẹp hàng" không thành công hoặc không có hiệu lực.
  - Audit log ghi nhận lý do gỡ liên kết ("đổi tài xế → mất điều kiện kẹp").
- **Kỳ vọng sai (Fail nếu):**
  - Vẫn cho kẹp dù khác tài xế → phí đường bị tính 1 lần (sai chi phí).
  - Không có cảnh báo khi đổi tài xế.
- **Bằng chứng:** ảnh cảnh báo "Không đủ điều kiện kẹp hàng" + ảnh phí đường × 2 + ảnh audit log + ảnh DB cặp kẹp đã gỡ.

### TC-DV-DISPATCH-032 — Phân loại chuyến Đơn (1 chiều) — happy path

- **Mã PRD:** O2C Bước 2b (phân loại Đơn)
- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL READY_FOR_DISPATCH có 1 container 40'. OWN fleet có xe rảnh.
- **Các bước:**
  1. Mở `/dispatch-detail`. Tại dòng container, gán biển số OWN + tài xế. Phân loại = "Đơn".
  2. Đặt giờ chạy 1 chiều (chỉ chiều đi). Phát lệnh.
  3. Quan sát trip: phân loại = Đơn, không có cặp kẹp, không có ghép.
  4. Mở chi phí: phí đường tính 1 lần (không có ưu đãi kẹp).
- **Kết quả mong đợi (Pass):**
  - Trip tạo thành công với `tripClassification = 'SINGLE'` (hoặc label "Đơn").
  - Không có trip ngược chiều liên kết.
  - Phí đường = bình thường × 1.
- **Kỳ vọng sai (Fail nếu):**
  - Hệ thống mặc định ghép/kẹp khi không có yêu cầu.
  - Phân loại "Đơn" không hiển thị trên app Lái xe.
- **Bằng chứng:** ảnh dialog phân loại = "Đơn" + ảnh trip trong DB (`trip_classification = 'SINGLE'`) + ảnh chi phí phí đường × 1.

---

### TC-DV-DISPATCH-033 — Lô 1 cont hoàn thành TOÀN BỘ vẫn hiển thị trên Kế hoạch Tổng quát (regression 2026-09-05)

- **Mã PRD:** Bug fix 2026-09-05 (báo cáo khách hàng): lô FCL 1 container đã phát lệnh, tài xế hoàn thành → lô biến mất khỏi `/dispatch` (Kế hoạch Tổng quát) vì hook chỉ tải `READY_FOR_DISPATCH`.
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL 1 container đã phát lệnh và tài xế đã hoàn thành chuyến (`shipments.status = 'COMPLETED'`, badge CUS "Đã khóa"/"Chờ Kế toán").
- **Các bước:**
  1. Đăng nhập `dieuvan`. Mở `/dispatch` (Kế hoạch Tổng quát).
  2. Tìm lô theo tên khách hàng / số chứng từ.
  3. Quan sát dòng lô: chip phân bổ giữ nguyên, nút "Phân bổ nhà xe" bị vô hiệu (mờ) vì lô đã hoàn thành.
- **Kết quả mong đợi (Pass):**
  - Lô hoàn thành vẫn hiển thị trong danh sách Kế hoạch Tổng quát.
  - Nút "Phân bổ nhà xe" disabled cho lô COMPLETED (backend chặn đổi nhà xe khi lô không còn READY_FOR_DISPATCH).
- **Kỳ vọng sai (Fail nếu):**
  - Lô biến mất khỏi Kế hoạch Tổng quát sau khi hoàn thành (hành vi cũ — đã fix).
  - Nút "Phân bổ nhà xe" vẫn mở popover cho lô COMPLETED.
- **Bằng chứng:** ảnh Kế hoạch Tổng quát thấy lô COMPLETED + ảnh nút disabled + query DB `shipments.status = 'COMPLETED'` + test `listShipmentsPaginated` multi-status pass.

---

### TC-DV-DISPATCH-034 — Ghi chú tác vụ cho lái xe: chọn nhanh tag + text tay trong dialog Chỉnh sửa điều phối (feature 2026-09-07)

- **Mã PRD:** Feature request 2026-09-07 — quick-select task tags composing the driver-facing note
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Lô FCL/LCL READY_FOR_DISPATCH chưa phát lệnh, hiển thị trên /dispatch-detail
- **Các bước:**
  1. Đăng nhập `dieuvan`, mở `/dispatch-detail`.
  2. Bấm ô "Điều phối" của một dòng lô → dialog "Chỉnh sửa điều phối" mở.
  6. Tìm mục "Ghi chú tác vụ": chip row (Đặt đầu, Đặt đuôi, Đảo vỏ, Gửi bãi, Lấy vỏ ICD đi đóng, Di động — seed từ migration) + ô textarea + dòng xem trước.
  3. Bấm chọn chip "Đặt đầu", "Lấy vỏ ICD đi đóng".
  4. Gõ "gọi lái trước 30p" vào ô textarea.
  5. Bấm "Lưu thay đổi".
  6. Mở lại dialog cùng dòng → 2 chip còn được chọn (aria-pressed=true), textarea giữ "gọi lái trước 30p", dòng xem trước đúng chuỗi.
  7. Bấm "+ Thêm tag", gõ "Giao trước 9h", Enter → chip mới xuất hiện và được chọn.
  8. Thêm tag trùng "đặt đầu" (viết thường) → thông báo "Tag đã tồn tại — đã chọn tag có sẵn", chip "Đặt đầu" được chọn, không lỗi.
  9. Lưu và kiểm tra 3 mặt hiển thị:
     - Kế hoạch Tổng quát (/dispatch): cột Ghi chú hiển thị chuỗi composed.
     - Kế hoạch Chi tiết: dòng "Xe: <chuỗi>" trong cột Ghi chú.
     - Màn hình lái xe (tài xế được gán): khối ghi chú hiển thị đúng chuỗi.
  10. Lưu lại lần nữa KHÔNG đổi gì → shipment version không tăng (DB check shipments.version).
- **Kết quả mong đợi (Pass):** chuỗi composed = các tag đã chọn + text tay, nối bằng "; ", tag đứng trước text tay; 3 mặt hiển thị đúng; reopen parse đúng; add-tag + 409 auto-select; no-op save không bump version.
- **Bằng chứng:** ảnh dialog với chip row + dòng "Hiển thị:", ảnh 3 mặt hiển thị, DB row `shipments.operational_notes`, tag pool DB `dispatch_task_tags` (6 seed rows).

---

## 2.11 — Chọn Tác vụ điều phối (Dispatch Task Selector) trong popup Phân xe (báo cáo khách hàng 2026-09-07)

> **Nguồn:** Khách hàng yêu cầu 2026-09-07 — "ở popup Phân xe/Chỉnh sửa điều phối cần thêm dropdown
> chọn tác vụ: đặt đầu, đặt đuôi, đảo vỏ, lấy vỏ icd quế võ đi đóng, gửi bãi, trả vỏ, giao
> thẳng". Mục đích: nhân viên điều vận gán rõ nhiệm vụ cụ thể cho từng chuyến xe, lái xe nhìn
> vào nhận biết ngay việc cần làm.
>
> **Ghi chú:** TC-DV-DISPATCH-034 (§2.9) đã cover ghi chú tác vụ dạng chip tag nhanh + textarea.
> Phần này bổ sung trường dropdown **Tác vụ điều phối** riêng biệt (enum, không phải free-text)
> trong cùng popup "Chỉnh sửa điều phối".

### TC-DV-DISPATCH-035 — Hiển thị trường "Tác vụ điều phối" trên popup Chỉnh sửa điều phối

- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Tiền điều kiện:** Đăng nhập tài khoản Điều vận / Quản trị. Lô FCL/LCL hiển thị trên `/dispatch-detail`.
- **Các bước:**
  1. Mở phân hệ "Điều vận" → Kế hoạch chi tiết (`/dispatch-detail`).
  2. Nhấp vào 1 container để mở popup "Chỉnh sửa điều phối".
  3. Kiểm tra các trường thông tin trong popup.
- **Kết quả mong đợi (Pass):**
  - Xuất hiện trường "Tác vụ điều phối" (hoặc "Loại tác vụ" / "Hành động điều vận").
  - Vị trí hiển thị khoa học, nằm cùng nhóm với Phân số xe, Rơ mooc, Lái xe.
  - Có nhãn (label) rõ ràng và placeholder: "Chọn tác vụ điều vận".
- **Kỳ vọng sai (Fail nếu):** trường không xuất hiện; vị trí lạc quẻ; không có label/placeholder.
- **Bằng chứng:** ảnh popup "Chỉnh sửa điều phối" thấy trường Tác vụ

---

### TC-DV-DISPATCH-036 — Dropdown tác vụ đầy đủ danh sách nghiệp vụ

- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Các bước:**
  1. Nhấp vào dropdown "Tác vụ điều phối" để mở rộng danh sách lựa chọn.
  2. Kiểm tra các giá trị option có trong danh sách.
- **Kết quả mong đợi (Pass):**
  - Danh sách bao gồm đầy đủ:
    1. Đặt đầu
    2. Đặt đuôi
    3. Đảo vỏ
    4. Lấy vỏ ICD Quế Võ đi đóng
    5. Gửi bãi
    6. Trả vỏ
    7. Giao thẳng (hoặc tác vụ mặc định khác)
  - Các lựa chọn hiển thị rõ ràng tiếng Việt, không lỗi font.
- **Kỳ vọng sai (Fail nếu):** thiếu tác vụ; lỗi font tiếng Việt; option bị trùng lặp.
- **Bằng chứng:** ảnh dropdown mở rộng đầy đủ tác vụ

---

### TC-DV-DISPATCH-037 — Lưu điều phối khi chọn từng tác vụ cụ thể

- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Dữ liệu kiểm thử:** Container "SMCU6163403", Xe "15C-184.62", Tác vụ: "Lấy vỏ ICD Quế Võ đi đóng"
- **Các bước:**
  1. Chọn container "SMCU6163403".
  2. Nhập/chọn Số xe, Lái xe.
  3. Tại trường Tác vụ, chọn "Lấy vỏ ICD Quế Võ đi đóng".
  4. Nhập Ghi chú điều phối (nếu có).
  5. Nhấn nút "Lưu thay đổi" (hoặc "Xác nhận điều phối").
- **Kết quả mong đợi (Pass):**
  - Lưu thành công thông tin điều phối và tác vụ đã chọn.
  - Đóng popup, hiển thị thông báo thành công.
  - Mở lại popup container đó, trường Tác vụ vẫn giữ nguyên "Lấy vỏ ICD Quế Võ đi đóng".
- **Kỳ vọng sai (Fail nếu):** lưu không thành công; tác vụ bị reset sau khi mở lại; popup không đóng.
- **Bằng chứng:** ảnh popup đã chọn tác vụ + ảnh toast thành công + ảnh mở lại (giữ nguyên) + Network (200)

---

### TC-DV-DISPATCH-038 — Hiển thị tên Tác vụ trên bảng Điều vận và Chi tiết lô hàng

- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Tiền điều kiện:** Container đã được phân xe kèm tác vụ "Đảo vỏ" hoặc "Đặt đầu".
- **Các bước:**
  1. Mở màn hình Điều vận (`/dispatch-detail`) — danh sách kế hoạch chạy xe.
  2. Mở màn hình Chi tiết lô hàng (`/shipments/:id`) — cột Phân xe / Ghi chú / Trạng thái tác vụ.
- **Kết quả mong đợi (Pass):**
  - Tác vụ đã chọn hiển thị dưới dạng badge hoặc text rõ ràng cạnh biển số xe
    (ví dụ: "15H-021.39 [Đặt đầu]" hoặc cột Tác vụ riêng: "Đảo vỏ").
  - Lái xe (App tài xế nếu có) hoặc nhân viên điều vận nhìn vào nhận biết ngay nhiệm vụ cụ thể.
- **Kỳ vọng sai (Fail nếu):** tác vụ không hiển thị trên danh sách; lái xe không thấy nhiệm vụ.
- **Bằng chứng:** ảnh `/dispatch-detail` thấy badge tác vụ + ảnh Chi tiết lô hàng + ảnh app Lái xe (nếu có)

---

### TC-DV-DISPATCH-039 — Thay đổi tác vụ điều phối (ví dụ từ "Đặt đầu" sang "Gửi bãi")

- **Vai trò:** `dieuvan`
- **Mức độ:** P2
- **Các bước:**
  1. Mở lại container đang có tác vụ "Đặt đầu".
  2. Đổi tác vụ sang "Gửi bãi".
  3. Nhấn Lưu thay đổi.
- **Kết quả mong đợi (Pass):**
  - Dữ liệu được cập nhật mới thành "Gửi bãi" ngay lập tức trên hệ thống.
  - Lịch sử chỉnh sửa (Audit log) ghi nhận tài khoản điều vận đã đổi tác vụ vào thời gian tương ứng.
- **Kỳ vọng sai (Fail nếu):** đổi không lưu được; audit log không ghi nhận.
- **Bằng chứng:** ảnh tác vụ đã đổi + Network 200 + audit log row mới

---

### TC-DV-DISPATCH-040 — Dropdown picker không che nút bên dưới khi trigger ở dưới màn hình (dropdown-flip sweep, feature 2026-09-07)

- **Mã PRD:** Bug class fix 2026-09-07 — A1-A4 + B1: autocomplete/multi-select dùng position:absolute không portal/flip
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P0
- **Thiết bị:** Desktop (1440×900, thử thêm viewport thấp 420px)
- **Tiền điều kiện:** Có lô hàng trên /dispatch và /dispatch-detail
- **Các bước:**
  1. Mở /dispatch-detail → bấm "Bộ lọc" → drawer mở.
  2. Cuộn để trigger "Chọn điểm nâng…" nằm ở nửa dưới màn hình.
  3. Bấm trigger → popover phải mở **lên trên** (data-placement="top"), không che trigger và không bị cắt mất.
  4. Tương tự với "Chọn điểm hạ…", "Chọn điểm trả…", "Nhà xe" trên /dispatch; với "Cảng nâng"/"Cảng hạ" trên /shipments/new; với "Điểm đi/Điểm đến" chặng cuối trên /trips/new.
  5. Nhập text vào ô tìm kiếm trong popover → danh sách lọc đúng; "Bỏ chọn tất cả" xóa hết selection.
- **Kết quả mong đợi (Pass):** mọi picker mở đúng hướng (trên khi thiếu chỗ), không che nút + Thêm / nút cùng hàng; danh sách có viền và scroll đúng; một số picker hiển thị chip selection trên trigger.
- **Bằng chứng:** /tmp/facet-flip-verified.png (popover placement=top, 49 options), /tmp/b1-after-fix-flip.png (flip phía trên, fully visible), measurement JSON trong journals.

---

## 2.13 — Phân loại Đơn / Lẻ / Kết hợp là nghiệp vụ của CUS (Điều vận không thiết lập)

> **Ranh giới nghiệp vụ chuẩn:**
> - **Điều vận KHÔNG thiết lập hoặc thay đổi Đơn / Lẻ / Kết hợp**: Việc xác định phân loại vận chuyển (Đơn `SINGLE`, Lẻ `LCL`, Kết hợp `COMBINED`, Kẹp `DOUBLE`) và cờ đóng kết hợp (`isCombined`) là toàn quyền của nhân viên Chứng từ (CUS) khi tiếp nhận booking và tạo lô hàng (chi tiết toàn bộ quy tắc và ca kiểm thử xem tại `01-cus-create-shipment.md §1.19`).
> - **Nhiệm vụ của Điều vận**: Nhận thông tin phân loại đã ấn định từ CUS và thực hiện điều phối kỹ thuật (gán đầu kéo, rơ-moóc, tài xế hoặc nhà xe ngoài) đáp ứng yêu cầu vận chuyển. Khi lưu kế hoạch điều phối qua `/dispatch-detail-plan-rows/:fulfillmentId/plan`, hệ thống tự động bảo toàn nguyên vẹn phân loại và cờ cấp lô do CUS đã xác lập.

---

## 2.14 — Bộ thẻ tác vụ điều phối nhanh 9 tags bao gồm "XƯỞNG 2" (QA Matrix v2.0)

### TC_TAG_01 — Hiển thị đầy đủ 9 thẻ tag tác vụ chuyên biệt
- **Vai trò:** `dieuvan`, `admin`
- **Mức độ:** P1
- **Tiền điều kiện:** Mở dialog điều phối trên `/dispatch-detail`.
- **Các bước:**
  1. Quan sát khu vực "Tác vụ điều phối" trong dialog.
  2. Đếm và kiểm tra tên các thẻ tag hiện diện.
- **Kết quả mong đợi (Pass):**
  - Hiển thị đầy đủ 9 chip tag: `["Đảo vỏ", "Đặt đầu", "Đặt đuôi", "Di động", "Giao thẳng", "Gửi bãi", "Lấy vỏ ICD đi đóng", "Trả vỏ", "XƯỞNG 2"]`.
  - Tag `XƯỞNG 2` hiển thị đầy đủ, không bị thiếu.
- **Bằng chứng:** `qa/2026-09-08_phan6_task-tags.png`
- **Regression ID:** REG-TAG-01-20260908

### TC_TAG_02 — Toggle chọn và bỏ chọn thẻ tag
- **Vai trò:** `dieuvan`, `admin`
- **Mức độ:** P1
- **Các bước:**
  1. Nhấp chuột vào chip `XƯỞNG 2`.
  2. Quan sát màu sắc và trạng thái của chip.
  3. Nhấp lại lần nữa.
- **Kết quả mong đợi (Pass):**
  - Khi được chọn: Chip chuyển sang trạng thái active với viền/nền nổi bật.
  - Khi nhấp lại: Chip bỏ chọn và trở về trạng thái bình thường.
- **Bằng chứng:** `qa/2026-09-08_phan6_task-tags.png`
- **Regression ID:** REG-TAG-02-20260908

### TC_TAG_03 — Kết hợp ghi chú văn bản tự do song song với thẻ tag
- **Vai trò:** `dieuvan`, `admin`
- **Mức độ:** P2
- **Các bước:**
  1. Nhập văn bản vào ô Ghi chú: "Hàng lạnh bảo quản ở 5°C".
  2. Chọn thêm thẻ tag "XƯỞNG 2".
  3. Quan sát nội dung ghi chú.
- **Kết quả mong đợi (Pass):**
  - Cả văn bản tự do và tag đã chọn được bảo toàn và ghép nối bằng dấu chấm phẩy (`; `), không bị ghi đè hay mất dữ liệu.
- **Bằng chứng:** `qa/2026-09-08_qa-matrix-v2_ui-driver.log`
- **Regression ID:** REG-TAG-03-20260908

### TC_TAG_04 — Nút "+ Thêm tag" bổ sung tag mới vào catalog
- **Vai trò:** `dieuvan`, `admin`
- **Mức độ:** P2
- **Các bước:**
  1. Quan sát cuối danh sách tag có nút "+ Thêm tag".
  2. Nhấp vào nút "+ Thêm tag".
- **Kết quả mong đợi (Pass):**
  - Mở modal hoặc ô nhập thêm tag mới trực tiếp, sẵn sàng mở rộng danh mục tác vụ điều phối.
- **Bằng chứng:** `qa/2026-09-08_phan6_task-tags.png`
- **Regression ID:** REG-TAG-04-20260908

---

### TC-DV-DISPATCH-041 — Editor điều vận không còn sở hữu Phân loại và Đóng kết hợp (CUS-owned, 2026-09-08)

- **Quyết định:** Phân loại chuyến (Đơn/Kẹp/Kết hợp/Lẻ) và cờ lot-level "Đóng kết hợp" là quyền của CUS
  (tạo lô + quick-edit). Điều vận chỉ phân xe/cước/ghi chú.
- **Vai trò:** `dieuvan` (DISPATCHER)
- **Mức độ:** P1
- **Các bước:**
  1. Mở /dispatch-detail → "Chỉnh sửa điều phối" một dòng.
  2. Xác nhận dialog KHÔNG còn select "Phân loại" và KHÔNG còn checkbox "Đóng kết hợp (kẹp chuyến)".
  3. Sửa nhà xe/cước/ghi chú tác vụ → Lưu → thành công; cột Phân loại trên grid giữ nguyên giá trị cũ.
  4. Gửi thẳng API PATCH kèm `classification`/`isCombined` (devtools) → backend vẫn strip, giá trị trong DB không đổi.
- **Kết quả mong đợi (Pass):** điều vận không thể thay đổi Phân loại/Đóng kết hợp qua bất kỳ đường nào;
  mọi giá trị khác (xe, cước, note) lưu bình thường; version bump đúng luật.
- **Bằng chứng:** backend test "omitting classification and isCombined leaves both stored values untouched"
  + "classification is CUS-owned — a dispatch save cannot rewrite it" (dispatch-detail-plan.test.ts).


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
| __/__/__ | TC-DV-DISPATCH-014 | | | Dropdown nhà xe ngoài trong dialog Phân bổ nhà xe (regression 2026-09-05) | |
| __/__/__ | TC-DV-DISPATCH-015 | | | Nhận diện dữ liệu nhà xe đã nhập + lưu + prefill khi mở lại (regression) | |
| __/__/__ | TC-DV-DISPATCH-016 | | | Lưu partial + bổ sung sau + prefill (regression) | |
| __/__/__ | TC-DV-DISPATCH-017 | | | Warning "Chưa có nhà xe ngoài nào được cấu hình" ẩn khi đã nhập OWN (regression 2026-09-05) | |
| __/__/__ | TC-DV-DISPATCH-018 | | | Phát lệnh xe ngoài với biển số tự do (regression 2026-09-05) | |
| __/__/__ | TC-DV-DISPATCH-019 | | | Lô hàng 1 cont hoàn thành vẫn hiển thị trên màn Điều vận (regression 2026-09-05) | |
| __/__/__ | TC-DV-DISPATCH-020 | | | `/dispatch` hiển thị theo lô hàng (không theo container) | |
| __/__/__ | TC-DV-DISPATCH-021 | | | Phân bổ 1 lô cho nhiều nhà xe (multi-vendor) | |
| __/__/__ | TC-DV-DISPATCH-022 | | | Validation tổng phân bổ cont vượt quá → chặn lưu | |
| __/__/__ | TC-DV-DISPATCH-023 | | | Auto-split từ `/dispatch` sang `/dispatch-detail` sau khi lưu | |
| __/__/__ | TC-DV-DISPATCH-024 | | | `/dispatch-detail` hiển thị theo container | |
| __/__/__ | TC-DV-DISPATCH-025 | | | Lô chỉ chuyển "Đã phân xe" khi TẤT CẢ container đã gán biển số | |
| __/__/__ | TC-DV-DISPATCH-026 | | | Push notification tới Lái xe khi gán biển số Xe nhà | |
| __/__/__ | TC-DV-DISPATCH-027 | | | Lô `Chờ chốt lịch` bị ẩn khỏi `/dispatch` | |
| __/__/__ | TC-DV-DISPATCH-028 | | | Xe ngoài cho phép nhập biển số free-text | |
| __/__/__ | TC-DV-DISPATCH-029 | | | Ghép kết hợp CÙNG LÔ (1 xe chở 2 cont cùng lô FCL) | |
| __/__/__ | TC-DV-DISPATCH-030 | | | Ghép kết hợp KHÁC LÔ (1 xe chở cont của 2 lô cùng tuyến) | |
| __/__/__ | TC-DV-DISPATCH-031 | | | Kẹp hàng không hợp lệ vì khác tài xế → bị chặn | |
| __/__/__ | TC-DV-DISPATCH-032 | | | Phân loại chuyến Đơn (1 chiều) — happy path | |
| __/__/__ | TC-DV-DISPATCH-033 | | | Lô 1 cont hoàn thành toàn bộ vẫn hiển thị trên Kế hoạch Tổng quát (regression 2026-09-05) | |
| __/__/__ | TC-DV-DISPATCH-034 | | | Ghi chú tác vụ: tag nhanh + text tay cho lái xe trong Chỉnh sửa điều phối (feature 2026-09-07) | |
| __/__/__ | TC-DV-DISPATCH-035 | | | Hiển thị trường "Tác vụ điều phối" trên popup Chỉnh sửa điều phối | |
| __/__/__ | TC-DV-DISPATCH-036 | | | Dropdown tác vụ đầy đủ danh sách nghiệp vụ | |
| __/__/__ | TC-DV-DISPATCH-037 | | | Lưu điều phối khi chọn tác vụ cụ thể | |
| __/__/__ | TC-DV-DISPATCH-038 | | | Hiển thị tên Tác vụ trên bảng Điều vận & Chi tiết lô | |
| __/__/__ | TC-DV-DISPATCH-039 | | | Thay đổi tác vụ điều phối + audit log | |
| __/__/__ | TC-DV-DISPATCH-040 | | | Dropdown picker không che nút dưới màn hình — flip + portal (dropdown-flip sweep) | |
| __/__/__ | TC-DV-DISPATCH-041 | | | Editor điều vận không còn Phân loại/Đóng kết hợp — CUS-owned (2026-09-08) | |
