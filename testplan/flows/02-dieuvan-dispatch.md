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
