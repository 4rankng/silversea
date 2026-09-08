# Luồng 10: Kiểm thử Tích hợp Toàn trình (E2E) & Ngoại lệ (Edge Cases)

> **Vai trò tham gia:** CUS, Điều vận (DISPATCHER), Admin
> **Tài khoản test:** chọn theo môi trường qua [`../testaccounts.txt`](../testaccounts.txt) — runner tự map từng role (`CUS`, `DISPATCHER`, `ADMIN`) → username phù hợp với env đang chạy.
> **Route kiểm thử:** `/shipments/new` → `/shipments/:id` → `/dispatch-detail` → `/dispatch`
> **Mục đích:** Đảm bảo toàn bộ luồng nghiệp vụ xuyên suốt từ tạo lô → bổ sung ngày → điều phối
> tác vụ hoạt động mượt mà, dữ liệu đồng bộ 100% giữa các màn hình và vai trò.
>
> **Nguồn:** Tổng hợp từ báo cáo khách hàng 2026-09-07, kết hợp tất cả phân hệ đã fix trong đợt này:
> - §1.10: Xóa/reset dropdown
> - §1.11: Chặn trùng B/L & Tờ khai
> - §1.12: Nút "Xác nhận" ngày giờ giao
> - §1.13: Đồng bộ Tổng quan ↔ Chi tiết
> - §2.11: Tác vụ điều phối

---

## 9.1 — Luồng hoàn chỉnh End-to-End

### TC-E2E-001 — Full flow: Tạo lô chưa có ngày → Bổ sung ngày giao có nút Xác nhận → Điều phối tác vụ phân xe

- **Vai trò:** `CUS` (bước 1–7), `DISPATCHER` (bước 8–9)
- **Mức độ:** P1
- **Thiết bị:** Desktop (1440×900)
- **Dữ liệu kiểm thử:** B/L = "BL_E2E_SEPT_001" (phải là giá trị duy nhất, chưa tồn tại trong hệ thống)
- **Luồng thực hiện (Full Flow):**
  1. **[CUS — Tạo lô]** Đăng nhập `CUS`. Mở `/shipments/new`.
  2. **[CUS — Tạo lô]** Tạo lô hàng mới với B/L duy nhất: "BL_E2E_SEPT_001". Chọn khách hàng (vd LONG MINH), hình thức Nhập khẩu.
  3. **[CUS — Container]** Thêm container: Chọn Nhà máy "SCONECT", Tuyến đường "KCN QUẾ VÕ, BẮC NINH", Cảng nâng "Cảng VipGreenPort", Cảng hạ "Cảng nông hạ".
  4. **[CUS — Xóa dropdown]** Thử xóa 1 mục (vd Nhà máy) bằng icon 'x' → ô trở về placeholder → chọn lại "SCONECT" chuẩn xác.
  5. **[CUS — Lưu chưa có ngày]** Chưa nhập ngày giao hàng → Nhấn "Tạo lô hàng" → Hệ thống cảnh báo chưa chốt ngày nhưng vẫn lưu thành công.
  6. **[CUS — Factory sync]** Kiểm tra `/shipments/:id` (Chi tiết lô hàng) → Đảm bảo hiển thị đúng "SCONECT" (không hiện "Chưa có nhà máy").
  7. **[CUS — Xác nhận ngày giờ]** Vào thuộc tính container → Nhập Ngày "07/09/2026" & Giờ "11:00" → Nhấp nút "Xác nhận" → Lưu thành công (toast hiện).
  8. **[CUS/Ops — Đồng bộ]** Màn hình "Tổng quan lô hàng" (`/shipments`) cập nhật trạng thái đã có ngày giao, khớp hoàn toàn với màn hình Chi tiết. Badge "Chưa chốt ngày" đã biến mất.
  9. **[Điều vận — Phân xe + Tác vụ]** Chuyển sang `DISPATCHER` → Mở `/dispatch-detail` → Tìm container vừa cập nhật → Chọn xe + chọn Tác vụ: "Lấy vỏ ICD Quế Võ đi đóng" → Lưu.
  10. **[Điều vận — Kiểm tra]** Bảng điều vận hiển thị đầy đủ: container, xe, lái xe, và tác vụ điều vận.
- **Kết quả mong đợi (Pass):**
  - Toàn bộ luồng xuyên suốt mượt mà, không gặp bất kỳ lỗi dữ liệu hay chặn luồng trái quy định.
  - Dữ liệu đồng bộ 100% giữa tất cả các màn hình liên quan: Tổng quan ↔ Chi tiết ↔ Thuộc tính ↔ Điều phối.
  - Không có duplicate B/L (dùng giá trị mới, chưa tồn tại).
  - Tác vụ hiển thị đúng trên cả Kế hoạch chi tiết và app Lái xe.
- **Kỳ vọng sai (Fail nếu):**
  - Bất kỳ bước nào bị chặn không rõ lý do.
  - Dữ liệu không đồng bộ giữa 2 màn hình.
  - Nhà máy hiển thị "Chưa có nhà máy" dù đã gán.
  - Nút "Xác nhận" không hoạt động.
  - Tác vụ điều phối không lưu hoặc không hiển thị.
- **Bằng chứng:** ảnh từng bước (tối thiểu: form tạo lô → chi tiết lô → ô ngày giờ → toast xác nhận → Tổng quan → popup điều phối → bảng điều vận có tác vụ)

---

## 9.2 — Trường hợp biên & Ngoại lệ (Edge Cases)

### TC-EDGE-001 — Race condition: 2 người dùng cùng nhập 1 số B/L cùng lúc

- **Vai trò:** 2 tài khoản `CUS` khác nhau (hoặc `CUS` + `ADMIN`)
- **Mức độ:** P2
- **Loại kiểm thử:** Concurrency / Database Constraint
- **Các bước:**
  1. Người dùng A (Công ty A) và Người dùng B (Công ty B) cùng mở form Tạo lô hàng.
  2. Cả hai cùng điền số B/L: "BL_CONCURRENCY_TEST".
  3. Cả hai nhấn nút Lưu cùng một lúc (hoặc trong vòng < 1 giây).
- **Kết quả mong đợi (Pass):**
  - Cơ sở dữ liệu sử dụng Unique Index / Lock: chỉ 1 giao dịch được tạo thành công trước.
  - Giao dịch thứ 2 bị chặn lại ngay lập tức với thông báo: "Lô hàng đã được tạo bởi tài khoản của đơn vị khác!" (409 Conflict).
  - Không bao giờ xảy ra tình trạng sinh 2 bản ghi cùng số B/L trong hệ thống.
- **Kỳ vọng sai (Fail nếu):**
  - Cả 2 đều tạo thành công → 2 lô cùng B/L (vi phạm unique constraint).
  - Giao dịch thứ 2 bị treo hoặc timeout thay vì trả 409 nhanh.
- **Bằng chứng:** Network tab (1 request 201, 1 request 409) + DB (đếm số lô có B/L = 1)

---

### TC-EDGE-002 — Validate B/L không phân biệt chữ hoa/thường và khoảng trắng thừa

- **Vai trò:** `CUS`
- **Mức độ:** P2
- **Tiền điều kiện:** Đã có lô B/L: "JJCTCHPDY260305".
- **Dữ liệu kiểm thử:**
  - Thử 1: "  jjctchpdy260305  " (chữ thường kèm khoảng trắng 2 đầu)
  - Thử 2: "JJCTchpdy260305" (vừa hoa vừa thường)
- **Các bước:**
  1. Mở form tạo lô mới.
  2. Nhập các giá trị thử nghiệm vào ô Số B/L.
  3. Bấm Lưu hoặc chuyển sang ô khác.
- **Kết quả mong đợi (Pass):**
  - Hệ thống tự động trim khoảng trắng thừa và chuẩn hóa chuỗi hoa thường (case-insensitive) khi so trùng.
  - Cảnh báo trùng lặp vẫn được kích hoạt chính xác cho cả 2 trường hợp.
- **Kỳ vọng sai (Fail nếu):**
  - "  jjctchpdy260305  " không bị phát hiện trùng (coi là giá trị mới).
  - Hệ thống phân biệt hoa thường → cho phép tạo 2 lô cùng B/L khác case.
- **Bằng chứng:** ảnh cảnh báo trùng cho cả 2 giá trị thử nghiệm + Network 409

---

## Bảng nghiệm thu — E2E & Edge Cases

| Ngày thử | Mã TC | Vai trò | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|---------|-----------|---------|---------|------------|
| __/__/__ | TC-E2E-001 | cus + dieuvan | | | Full flow: tạo lô → ngày giao → điều phối tác vụ | |
| __/__/__ | TC-EDGE-001 | cus × 2 | | | Race condition trùng B/L cùng lúc | |
| __/__/__ | TC-EDGE-002 | cus | | | Validate B/L case-insensitive + trim | |
