# Luồng 5: Chi phí phát sinh — Nhân viên Hiện trường (Ops / Forwarder)

> **Vai trò sở hữu:** Nhân viên Hiện trường (FORWARDER / Ops)
> **Tài khoản demo:** `giaonhan` (password: `Abc123`)
> **Route chính:** `/my-forwarder-trips`, `/my-advances`, `/my-settlements`, `/my-settlements/new`
> **Thiết bị mặc định:** Mobile (iPhone SE 375×667)
> **PRD nguồn:** Module 09 (`docs/prd/Module9.docx`), Module 04, O2C Bước 3, TC-MO2C-08, Q12–Q14
>
> **Tổng quan luồng:** Nhân viên hiện trường thực hiện chi trả hộ phí bãi/cảng, nhập dữ liệu thực chi
> kèm ảnh chứng từ. Hệ thống tự động áp giá nâng/hạ theo bảng giá master. Khi mọi scope hoàn tất,
> shipment chuyển PENDING_EXPENSE_APPROVAL. Kế toán duyệt và hệ thống tự cấn trừ vào tạm ứng.

---

## 5.1 — Xem chuyến được giao trên cổng Ops

### TC-OPS-CHIPHI-001 — Ops thấy chuyến FCL trên cổng

- **Mã PRD:** M09, TC-MO2C-08
- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Thiết bị:** Mobile (375×667)
- **Tiền điều kiện:** Trip đã được điều vận phân cho Ops liên quan
- **Các bước:**
  1. Đăng nhập `giaonhan`. Mở `/my-forwarder-trips`.
  2. Tìm chuyến FCL. Bấm vào xem chi tiết.
- **Kết quả mong đợi (Pass):**
  - Chuyến hiển thị trên cổng Ops với thông tin đầy đủ: container, tuyến, thời gian.
  - Có nút "Chi phí phát sinh" để truy cập.
- **Bằng chứng:** ảnh danh sách + ảnh chi tiết chuyến

---

## 5.2 — Thêm chi phí nâng/hạ (áp giá tự động)

### TC-OPS-CHIPHI-002 — Tạo chi phí nâng/hạ — giá tự động theo master

- **Mã PRD:** TC-MO2C-08, M04
- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Có bảng giá nâng/hạ theo Cảng + cỡ cont + Hàng/Rỗng + Nâng/Hạ
- **Các bước:**
  1. Mở chuyến FCL. Chọn "Chi phí phát sinh" → "Thêm".
  2. Chọn đúng: Cảng/Bãi + loại container + Hàng/Rỗng + chiều Nâng/Hạ + ngày hiệu lực.
  3. Kiểm tra đơn giá hiển thị (read-only).
  4. Lưu.
- **Kết quả mong đợi (Pass):**
  - Giá nâng/hạ tự áp theo đủ khóa master: Cảng + cỡ cont + Hàng/Rỗng + Nâng/Hạ + ngày.
  - Đơn giá **read-only**, không cho nhập tay.
  - Đơn giá khớp với bảng giá master đã ghi trước.
- **Kỳ vọng sai (Fail nếu):**
  - Giá cho nhập tay / sai khóa / sai ngày.
  - Không có giá nâng/hạ hiển thị.
- **Bằng chứng:** ảnh form với khóa giá + ảnh đơn giá read-only + đối chiếu master

---

### TC-OPS-CHIPHI-003 — Thiếu bảng giá nâng/hạ → BLOCKED hoặc cảnh báo

- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Các bước:**
  1. Chọn Cảng/loại cont không có trong bảng giá.
  2. Thử lưu.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo: "Chưa có giá cho tổ hợp này" hoặc chuyển sang BLOCKED.
  - Không cho lưu giá 0 hoặc giá rỗng.
- **Bằng chứng:** ảnh cảnh báo

---

## 5.3 — Chi phí CÓ hóa đơn vs KHÔNG hóa đơn

### TC-OPS-CHIPHI-004 — Tạo khoản chi CÓ hóa đơn

- **Mã PRD:** Q12, TC-MO2C-08
- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Chọn "Chi phí phát sinh" → "Thêm".
  2. Chọn loại: "Có hóa đơn" (ví dụ: Nâng hạ, Lưu kho).
  3. Nhập số tiền, ngày, nhà cung cấp.
  4. Tải ảnh hóa đơn.
  5. Lưu.
- **Kết quả mong đợi (Pass):**
  - Khoản chi lưu thành công với trạng thái "Chờ duyệt".
  - Hóa đơn đính kèm xem được.
  - Phân loại đúng "Có hóa đơn".
- **Bằng chứng:** ảnh form đã điền + ảnh hóa đơn + ảnh đã lưu

---

### TC-OPS-CHIPHI-005 — Tạo khoản chi KHÔNG hóa đơn (với chứng từ thay thế)

- **Mã PRD:** Q12, TC-MO2C-08
- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Chọn "Chi phí phát sinh" → "Thêm".
  2. Chọn loại: "Không hóa đơn".
  3. Chọn hạng mục từ danh mục cho phép (bốc xếp, vé bãi, xử lý khẩn cấp, vật tư nhỏ).
  4. Nhập: số tiền, ngày, người nhận, lý do.
  5. Tải ít nhất 1 chứng từ thay thế hợp lệ (ảnh hiện trường có geotag, phiếu thu, chuyển khoản).
  6. Lưu.
- **Kết quả mong đợi (Pass):**
  - Khoản chi lưu thành công.
  - Hạng mục phải nằm trong danh mục cho phép (không có "Hối lộ" hay mục ngoài danh sách).
  - Thiếu chứng từ thay thế → bắt buộc bổ sung, không cho lưu.
  - Bắt buộc: số tiền, ngày, người nhận, lô/chuyến, lý do, ≥1 bằng chứng.
- **Kỳ vọng sai (Fail nếu):**
  - Hạng mục ngoài danh sách vẫn lưu được.
  - Thiếu ảnh/geotag vẫn cho lưu.
  - Thiếu trường bắt buộc mà không cảnh báo.
- **Bằng chứng:** ảnh form + ảnh chứng từ thay thế + ảnh validation khi thiếu

---

## 5.4 — Scope chung và scope riêng theo container

### TC-OPS-CHIPHI-006 — Tạo scope chung và scope riêng cho từng container

- **Mã PRD:** TC-MO2C-08
- **Vai trò:** `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Tạo 1 khoản chi phí scope chung (áp dụng cho cả lô).
  2. Tạo 1 khoản chi phí scope riêng cho container 1.
  3. Tạo 1 khoản chi phí scope riêng cho container 2.
  4. Lần lượt bấm "Đã kê xong" cho mỗi scope.
- **Kết quả mong đợi (Pass):**
  - Mỗi scope độc lập, không trộn.
  - Mọi scope phải hoàn tất trước khi shipment chuyển PENDING_EXPENSE_APPROVAL.
  - Thiếu scope → không cho chuyển trạng thái.
- **Kỳ vọng sai (Fail nếu):**
  - Scope trộn hoặc bỏ sót.
  - Thiếu scope vẫn chuyển trạng thái.
- **Bằng chứng:** ảnh từng scope + ảnh trạng thái shipment

---

## 5.5 — Ngưỡng chi phí (Q13, Q14)

### TC-OPS-CHIPHI-007 — Cảnh báo vượt ngưỡng 1.000.000đ/khoản

- **Mã PRD:** Q13
- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Các bước:**
  1. Tạo khoản chi "Vé bãi" 1.100.000đ.
  2. Lưu.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo: vượt ngưỡng 1.000.000đ/khoản (nếu ngưỡng cấu hình là 1tr).
  - Vẫn cho lưu nhưng đánh dấu cần duyệt cấp cao hơn.
- **Bằng chứng:** ảnh cảnh báo + ảnh đã lưu

---

### TC-OPS-CHIPHI-008 — Cảnh báo tổng người/ngày vượt 5.000.000đ

- **Mã PRD:** Q13
- **Vai trò:** `giaonhan`
- **Mức độ:** P1
- **Các bước:**
  1. Tạo 6 khoản chi cho cùng người, cùng ngày, tổng = 5.500.000đ.
  2. Lưu khoản cuối cùng.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo: "Tổng trong ngày vượt 5.000.000đ cho cùng người".
  - Hệ thống cộng gộp cùng người, cùng ngày, cùng hạng mục để chống chia nhỏ.
- **Bằng chứng:** ảnh 6 khoản + ảnh cảnh báo tổng

---

### TC-OPS-CHIPHI-009 — Maker không tự duyệt (Q14, Q15)

- **Mã PRD:** Q14, Q15
- **Vai trò:** `giaonhan` (maker) + `ketoan` (checker)
- **Mức độ:** P0
- **Các bước:**
  1. `giaonhan` tạo khoản chi 4.000.000đ.
  2. `giaonhan` thử tự duyệt khoản của mình.
- **Kết quả mong đợi (Pass):**
  - `giaonhan` bị từ chối tự duyệt (maker-checker rule).
  - Chỉ `ketoan` hoặc người có thẩm quyền mới duyệt được.
- **Bằng chứng:** ảnh "Không thể tự duyệt" + ảnh `ketoan` duyệt thành công

---

## 5.6 — Phê duyệt chi phí (Kế toán)

### TC-OPS-CHIPHI-010 — Kế toán duyệt chi phí + cấn trừ tạm ứng

- **Mã PRD:** TC-MO2C-08, O2C Bước 4
- **Vai trò:** `ketoan`
- **Mức độ:** P0
- **Tiền điều kiện:** Ops đã kê xong mọi scope. Có tạm ứng đã duyệt lớn hơn khoản chi.
- **Các bước:**
  1. Đăng nhập `ketoan`. Mở chi phí chờ duyệt.
  2. Duyệt khoản chi.
  3. Kiểm tra: bút toán cấn trừ vào dư nợ tạm ứng.
  4. Đối chiếu số dư tạm ứng còn lại.
- **Kết quả mong đợi (Pass):**
  - Duyệt thành công. Trạng thái chi phí → "Đã duyệt".
  - Hệ thống tự động cấn trừ đúng số tiền vào tạm ứng.
  - Số dư tạm ứng = tạm ứng ban đầu − khoản đã duyệt.
  - Không vượt số dư tạm ứng.
- **Kỳ vọng sai (Fail nếu):**
  - Cấn trừ sai / overdraw.
  - Số dư tạm ứng không cập nhật.
- **Bằng chứng:** ảnh duyệt + ảnh bút toán cấn trừ + ảnh số dư trước/sau

---

### TC-OPS-CHIPHI-011 — Chuyển PENDING_EXPENSE_APPROVAL khi đủ scope

- **Mã PRD:** TC-MO2C-08
- **Vai trò:** `giaonhan` + `ketoan`
- **Mức độ:** P0
- **Các bước:**
  1. Mọi scope đã "Đã kê xong". Mọi chi phí đã được duyệt.
  2. Kiểm tra trạng thái shipment.
- **Kết quả mong đợi (Pass):**
  - Shipment chuyển "Chờ duyệt phí" (PENDING_EXPENSE_APPROVAL) chỉ khi **đã đủ mọi scope**.
  - Thiếu scope → không chuyển.
- **Bằng chứng:** ảnh trạng thái shipment + ảnh danh sách scope hoàn tất

---

## 5.7 — Phân quyền Ops

### TC-OPS-CHIPHI-012 — Chỉ FORWARDER mới truy cập cổng Ops

- **Mã PRD:** HT-02
- **Vai trò thử:** `giaonhan` (được), `cus`, `laixe`, `ketoan`, `customer` (bị chặn)
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `giaonhan` → mở `/my-forwarder-trips` → phải thấy được.
  2. Các vai trò khác mở `/my-forwarder-trips` → phải bị chặn.
- **Kết quả mong đợi (Pass):**
  - Chỉ FORWARDER vào được cổng Ops.
  - Các vai trò khác redirect hoặc "Không có quyền".
- **Bằng chứng:** ảnh redirect cho từng vai trò

---

## Bảng nghiệm thu — Luồng Chi phí (Ops)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-OPS-CHIPHI-001 | | | Xem chuyến | |
| __/__/__ | TC-OPS-CHIPHI-002 | | | Giá nâng/hạ tự động | |
| __/__/__ | TC-OPS-CHIPHI-003 | | | Thiếu bảng giá | |
| __/__/__ | TC-OPS-CHIPHI-004 | | | Có hóa đơn | |
| __/__/__ | TC-OPS-CHIPHI-005 | | | Không hóa đơn + thay thế | |
| __/__/__ | TC-OPS-CHIPHI-006 | | | Scope chung/riêng | |
| __/__/__ | TC-OPS-CHIPHI-007 | | | Ngưỡng khoản | |
| __/__/__ | TC-OPS-CHIPHI-008 | | | Tổng người/ngày | |
| __/__/__ | TC-OPS-CHIPHI-009 | | | Maker-checker | |
| __/__/__ | TC-OPS-CHIPHI-010 | | | Duyệt + cấn trừ tạm ứng | |
| __/__/__ | TC-OPS-CHIPHI-011 | | | PENDING_EXPENSE_APPROVAL | |
| __/__/__ | TC-OPS-CHIPHI-012 | | | RBAC Ops | |
