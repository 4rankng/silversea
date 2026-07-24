# 06 — Kỷ luật & Phạt (Discipline & Penalty)

**Route:** `/penalty`
**Roles:** ADMIN, MANAGER (đầy đủ CRUD), ACCOUNTANT (chỉ xem), DRIVER (xem phạt của mình)

---

## 1. Tổng quan

Module **Kỷ luật & Phạt** quản lý vi phạm của lái xe, bao gồm:

| Chức năng | Mô tả |
|-----------|-------|
| **Bảng xếp hạng lái xe** | Thống kê điểm phạt, xếp hạng A+/A/B/C, theo dõi chuỗi chuyến sạch |
| **Nhật ký vi phạm** | Danh sách tất cả lần phạt, lọc theo lái xe, ngày, mức độ |
| **Tạo phạt mới** | Form trong Drawer, chọn lái xe, lý do, mức độ, số tiền, ghi chú |
| **Tính điểm & xếp hạng** | Minor = 1đ, Moderate = 3đ, Severe = 5đ → Grade tự động |

### Phân quyền chi tiết

| Hành động | ADMIN | MANAGER | ACCOUNTANT | DRIVER |
|-----------|-------|---------|------------|--------|
| Xem bảng xếp hạng | ✅ | ✅ | ✅ | ✅ (chỉ mình) |
| Xem nhật ký vi phạm | ✅ | ✅ | ✅ | ✅ (chỉ mình) |
| Tạo phạt mới | ✅ | ✅ | ❌ | ❌ |
| Sửa phạt | ✅ | ✅ | ❌ | ❌ |
| Xóa phạt | ✅ | ✅ | ❌ | ❌ |
| Lọc & tìm kiếm | ✅ | ✅ | ✅ | ✅ (giới hạn) |

---

## 2. Hướng dẫn sử dụng

### 2.1. Bảng xếp hạng lái xe (Driver Scoreboard)

1. Truy cập `/penalty` → tab **Bảng xếp hạng** hiển thị mặc định
2. Bảng hiển thị từng lái xe với các cột:
   - **Lái xe** — Tên lái xe
   - **Tổng điểm phạt** — Điểm tích lũy trong kỳ
   - **Xếp hạng** — Grade A+ / A / B / C (có badge màu)
   - **Chuỗi sạch** — Số chuyến liên tiếp không vi phạm
   - **Số lần vi phạm** — Tổng số lần phạt
3. Hàng có Grade C (nghiêm trọng) được highlight màu đỏ
4. Click tên lái xe → chuyển sang tab **Nhật ký** có filter sẵn lái xe đó

### 2.2. Nhật ký vi phạm (Violation Log)

1. Chuyển sang tab **Nhật ký vi phạm**
2. Bảng hiển thị tất cả lần phạt với các cột:
   - **Lái xe** — Tên người vi phạm
   - **Ngày** — Ngày vi phạm
   - **Lý do** — Lý do phạt (từ danh sách cấu hình)
   - **Số tiền** — Số tiền phạt (VND)
   - **Mức độ** — Minor / Moderate / Severe (badge màu)
   - **Trạng thái** — Đã áp dụng / Đã hủy
3. **Thanh lọc** phía trên bảng:
   - Lọc theo **Lái xe** (dropdown)
   - Lọc theo **Khoảng ngày** (từ ngày — đến ngày)
   - Lọc theo **Mức độ** (Minor / Moderate / Severe)
4. Nhấn **Đặt lại bộ lọc** → xóa tất cả filter

### 2.3. Tạo phạt mới

1. Nhấn nút **+ Tạo phạt** (góc trên phải, chỉ hiển thị với ADMIN/MANAGER)
2. Drawer mở ra bên phải với form:
   - **Lái xe** *(bắt buộc)* — Dropdown chọn từ danh sách lái xe active
   - **Lý do vi phạm** *(bắt buộc)* — Dropdown từ danh sách lý do cấu hình
   - **Mức độ** — Tự động điền theo lý do, có thể thay đổi:
     - Minor (nhẹ) — 1 điểm
     - Moderate (trung bình) — 3 điểm
     - Severe (nghiêm trọng) — 5 điểm
   - **Số tiền phạt** — Tự động điền từ default của lý do, có thể sửa
   - **Ghi chú** — Trường text tự do
3. Nhấn **Lưu** → tạo vi phạm, bảng cập nhật ngay
4. Nhấn **Hủy** → đóng Drawer không lưu

### 2.4. Sửa / Xóa phạt

1. Tại hàng vi phạm trong **Nhật ký**, nhấn icon **Sửa** (chỉ ADMIN/MANAGER thấy)
2. Drawer mở với dữ liệu đã điền sẵn → sửa và **Lưu**
3. Nhấn icon **Xóa** → hiện xác nhận → xác nhận để xóa

---

## 3. Luồng nghiệp vụ

### 3.1. Luồng tạo phạt

```
MANAGER/ADMIN nhấn "Tạo phạt"
        │
        ▼
   Chọn lái xe ──────► (dropdown, chỉ lái xe active)
        │
        ▼
   Chọn lý do vi phạm ──► (từ danh sách penalty-reasons cấu hình)
        │
        ▼
   Mức độ tự động điền ──► Có thể thay đổi manually
        │
        ▼
   Số tiền tự động điền ──► Có thể sửa
        │
        ▼
   Nhập ghi chú (tuỳ chọn)
        │
        ▼
   Nhấn "Lưu"
        │
        ▼
   Validate form ──┬─ Lỗi → hiện thông báo, giữ Drawer mở
                   │
                   └─ Hợp lệ → lưu vi phạm
                        │
                        ▼
                  Cập nhật bảng xếp hạng
                  Cập nhật nhật ký vi phạm
                  Đóng Drawer
```

### 3.2. Luồng tính điểm & xếp hạng

```
Tổng điểm = Σ (điểm theo mức độ mỗi vi phạm active)
        │
        ▼
   Minor    = 1 điểm
   Moderate = 3 điểm
   Severe   = 5 điểm
        │
        ▼
   Xếp hạng:
   ┌────────────┬───────────────┐
   │ Tổng điểm  │   Xếp hạng    │
   ├────────────┼───────────────┤
   │    0       │    A+ (sạch)  │
   │   1–2      │    A          │
   │   3–5      │    B          │
   │   6+       │    C (nặng)   │
   └────────────┴───────────────┘
        │
        ▼
   Chuỗi sạch = số chuyến liên tiếp
                 không có vi phạm (streak counter)
```

### 3.3. Luồng xem của DRIVER

```
DRIVER truy cập /penalty
        │
        ▼
   Chỉ thấy dữ liệu của mình:
   - Bảng xếp hạng: chỉ hàng của mình
   - Nhật ký: chỉ vi phạm của mình
   - Không thấy nút "Tạo phạt"
   - Không thấy nút Sửa / Xóa
```

---

## 4. Bảng tra cứu

### 4.1. Mức độ vi phạm & Điểm

| Mức độ | Tiếng Anh | Điểm | Màu badge | Mô tả |
|--------|-----------|------|-----------|-------|
| Nhẹ | Minor | 1 | Xanh lá | Vi phạm nhỏ, cảnh báo |
| Trung bình | Moderate | 3 | Cam | Vi phạm đáng chú ý |
| Nghiêm trọng | Severe | 5 | Đỏ | Vi phạm nghiêm trọng |

### 4.2. Xếp hạng lái xe (Grade)

| Grade | Tổng điểm | Mô tả | Màu |
|-------|-----------|-------|-----|
| A+ | 0 | Lái xe xuất sắc, không vi phạm | Xanh dương đậm |
| A | 1–2 | Lái xe tốt, vi phạm nhỏ | Xanh lá |
| B | 3–5 | Cần cải thiện | Cam |
| C | 6+ | Cảnh báo nghiêm trọng | Đỏ |

### 4.3. Danh sách lý do vi phạm (Ví dụ)

> Lý do được cấu hình trong hệ thống (`config/penalty-reasons`). Sau đây là các lý do mẫu:

| Lý do | Mức độ mặc định | Số tiền mặc định |
|-------|-----------------|-----------------|
| Đi trễ | Minor | 100,000 đ |
| Không tuân thủ lịch trình | Moderate | 300,000 đ |
| Lái xe quá tốc độ | Moderate | 500,000 đ |
| Vi phạm an toàn giao thông | Severe | 1,000,000 đ |
| Say xỉn khi lái xe | Severe | 2,000,000 đ |
| Phá hoại tài sản | Severe | 2,000,000 đ |
| Thái độ không hợp tác | Minor | 200,000 đ |

> **Lưu ý:** Mức độ và số tiền là giá trị mặc định, có thể thay đổi khi tạo phạt.

### 4.4. Trạng thái vi phạm

| Trạng thái | Mô tả |
|------------|-------|
| Active | Đang hiệu lực, tính vào điểm |
| Cancelled | Đã hủy, không tính vào điểm |

---

## 5. QA Test Checklist

### 5.1. Trang & Phân quyền (TC-KL-001 → TC-KL-006)

| Mã | Test Case | Tiền điều kiện | Bước thực hiện | Kết quả mong đợi |
|----|-----------|----------------|-----------------|-------------------|
| TC-KL-001 | ADMIN truy cập trang phạt | Đăng nhập ADMIN | Truy cập `/penalty` | Trang hiển thị đầy đủ: bảng xếp hạng, nhật ký, nút Tạo phạt |
| TC-KL-002 | MANAGER truy cập trang phạt | Đăng nhập MANAGER | Truy cập `/penalty` | Trang hiển thị đầy đủ giống ADMIN |
| TC-KL-003 | ACCOUNTANT truy cập trang phạt | Đăng nhập ACCOUNTANT | Truy cập `/penalty` | Hiển thị bảng xếp hạng + nhật ký. KHÔNG thấy nút Tạo phạt, Sửa, Xóa |
| TC-KL-004 | DRIVER truy cập trang phạt | Đăng nhập DRIVER | Truy cập `/penalty` | Chỉ thấy dữ liệu của mình (1 hàng trong bảng xếp hạng). KHÔNG thấy nút Tạo, Sửa, Xóa |
| TC-KL-005 | Driver A không thấy phạt của Driver B | 2 driver có vi phạm | DRIVER A truy cập `/penalty` | Nhật ký chỉ hiển thị vi phạm của DRIVER A |
| TC-KL-006 | Driver thấy xếp hạng của mình | DRIVER có vi phạm | DRIVER truy cập `/penalty` | Bảng xếp hạng hiển thị 1 hàng với đúng tên, điểm, grade |

### 5.2. Bảng xếp hạng lái xe (TC-KL-007 → TC-KL-014)

| Mã | Test Case | Tiền điều kiện | Bước thực hiện | Kết quả mong đợi |
|----|-----------|----------------|-----------------|-------------------|
| TC-KL-007 | Hiển thị bảng xếp hạng | Có ≥ 3 lái xe trong hệ thống | Truy cập `/penalty`, tab Bảng xếp hạng | Bảng hiển thị tất cả lái xe với cột: Tên, Tổng điểm, Grade, Chuỗi sạch, Số lần vi phạm |
| TC-KL-008 | Grade A+ khi không có vi phạm | Lái xe chưa từng bị phạt | Xem hàng lái xe đó | Grade = A+, Tổng điểm = 0, badge màu xanh dương |
| TC-KL-009 | Grade A khi 1–2 điểm | Lái xe có 1 vi phạm minor (1đ) | Xem hàng lái xe đó | Grade = A, Tổng điểm = 1, badge màu xanh lá |
| TC-KL-010 | Grade B khi 3–5 điểm | Lái xe có 1 vi phạm moderate (3đ) | Xem hàng lái xe đó | Grade = B, Tổng điểm = 3, badge màu cam |
| TC-KL-011 | Grade C khi 6+ điểm | Lái xe có 2 vi phạm moderate + 1 severe (11đ) | Xem hàng lái xe đó | Grade = C, Tổng điểm = 11, badge màu đỏ, hàng highlight đỏ |
| TC-KL-012 | Chuỗi sạch (streak) cập nhật | Lái xe có 5 chuyến liên tiếp không vi phạm, trước đó có vi phạm | Xem chuỗi sạch | Chuỗi sạch = 5 |
| TC-KL-013 | Click tên lái xe chuyển tab | Đang ở tab Bảng xếp hạng | Click tên lái xe bất kỳ | Chuyển sang tab Nhật ký vi phạm, filter lái xe tự chọn đúng lái xe đó |
| TC-KL-014 | Sắp xếp bảng xếp hạng | Nhiều lái xe có điểm khác nhau | Xem thứ tự bảng | Lái xe có điểm cao nhất (xấu nhất) xếp trên cùng hoặc theo đúng thứ tự quy định |

### 5.3. Tạo phạt mới (TC-KL-015 → TC-KL-023)

| Mã | Test Case | Tiền điều kiện | Bước thực hiện | Kết quả mong đợi |
|----|-----------|----------------|-----------------|-------------------|
| TC-KL-015 | Mở Drawer tạo phạt | Đăng nhập ADMIN/MANAGER | Nhấn nút "+ Tạo phạt" | Drawer mở bên phải với form rỗng |
| TC-KL-016 | Submit form hợp lệ | Drawer mở | Chọn lái xe, chọn lý do, nhấn Lưu | Vi phạm được tạo, Drawer đóng, bảng cập nhật |
| TC-KL-017 | Validate: thiếu lái xe | Drawer mở | Chọn lý do, KHÔNG chọn lái xe, nhấn Lưu | Thông báo lỗi "Vui lòng chọn lái xe", Drawer không đóng |
| TC-KL-018 | Validate: thiếu lý do | Drawer mở | Chọn lái xe, KHÔNG chọn lý do, nhấn Lưu | Thông báo lỗi "Vui lòng chọn lý do vi phạm" |
| TC-KL-019 | Số tiền tự động điền | Drawer mở | Chọn lý do "Đi trễ" | Số tiền field tự điền giá trị mặc định (vd: 100,000) |
| TC-KL-020 | Mức độ tự động điền | Drawer mở | Chọn lý do "Say xỉn khi lái xe" | Mức độ tự chọn "Severe" |
| TC-KL-021 | Sửa số tiền mặc định | Lý do đã chọn, số tiền tự điền | Xóa số tiền, nhập 500,000 → Lưu | Vi phạm tạo với số tiền 500,000 (không phải mặc định) |
| TC-KL-022 | Đổi mức độ từ mặc định | Lý do "Đi trễ" (default Minor) | Đổi mức độ thành Moderate → Lưu | Vi phạm tạo với mức Moderate (3 điểm) |
| TC-KL-023 | Nhập ghi chú | Form đã điền đầy đủ | Nhập ghi chú "Lần 2 trong tháng" → Lưu | Vi phạm tạo kèm ghi chú |

### 5.4. Nhật ký vi phạm & Lọc (TC-KL-024 → TC-KL-031)

| Mã | Test Case | Tiền điều kiện | Bước thực hiện | Kết quả mong đợi |
|----|-----------|----------------|-----------------|-------------------|
| TC-KL-024 | Hiển thị nhật ký | Có ≥ 5 vi phạm trong hệ thống | Chuyển tab Nhật ký vi phạm | Bảng hiển thị tất cả vi phạm: Lái xe, Ngày, Lý do, Số tiền, Mức độ, Trạng thái |
| TC-KL-025 | Lọc theo lái xe | Nhiều lái xe có vi phạm | Chọn 1 lái xe từ dropdown | Bảng chỉ hiển thị vi phạm của lái xe đó |
| TC-KL-026 | Lọc theo khoảng ngày | Có vi phạm trong nhiều ngày khác nhau | Chọn "Từ ngày" 01/05 → "Đến ngày" 15/05 | Bảng chỉ hiển thị vi phạm trong khoảng ngày đó |
| TC-KL-027 | Lọc theo mức độ | Có vi phạm minor, moderate, severe | Chọn filter mức độ "Severe" | Bảng chỉ hiển thị vi phạm mức Severe |
| TC-KL-028 | Kết hợp nhiều filter | Có dữ liệu đa dạng | Lọc: lái xe A + từ 01/05 + Moderate | Bảng chỉ hiển thị vi phạm của lái xe A, trong khoảng ngày, mức Moderate |
| TC-KL-029 | Đặt lại bộ lọc | Đã áp dụng filter | Nhấn "Đặt lại bộ lọc" | Tất cả filter được xóa, bảng hiển thị toàn bộ |
| TC-KL-030 | Badge màu mức độ | Nhật ký có đủ 3 mức | Xem cột Mức độ | Minor = xanh lá, Moderate = cam, Severe = đỏ |
| TC-KL-031 | Phân trang | Có > 20 vi phạm | Xem nhật ký | Bảng có phân trang, chuyển trang hoạt động đúng |

### 5.5. Sửa & Xóa phạt (TC-KL-032 → TC-KL-036)

| Mã | Test Case | Tiền điều kiện | Bước thực hiện | Kết quả mong đợi |
|----|-----------|----------------|-----------------|-------------------|
| TC-KL-032 | Sửa vi phạm | ADMIN/MANAGER, có 1 vi phạm | Nhấn icon Sửa → đổi lý do → Lưu | Vi phạm cập nhật, bảng nhật ký cập nhật ngay |
| TC-KL-033 | Sửa số tiền | ADMIN/MANAGER, có 1 vi phạm | Nhấn icon Sửa → đổi số tiền → Lưu | Số tiền cập nhật, bảng xếp hạng điểm không đổi (điểm theo mức độ) |
| TC-KL-034 | Xóa vi phạm | ADMIN/MANAGER, có 1 vi phạm | Nhấn icon Xóa → xác nhận | Vi phạm bị xóa, bảng xếp hạng cập nhật điểm giảm |
| TC-KL-035 | Hủy xác nhận xóa | ADMIN/MANAGER, nhấn Xóa | Nhấn "Hủy" trong dialog xác nhận | Vi phạm KHÔNG bị xóa, dialog đóng |
| TC-KL-036 | ACCOUNTANT không thấy nút sửa/xóa | Đăng nhập ACCOUNTANT | Xem nhật ký vi phạm | Không hiển thị icon Sửa và Xóa ở mỗi hàng |

### 5.6. Tính điểm & Edge Cases (TC-KL-037 → TC-KL-042)

| Mã | Test Case | Tiền điều kiện | Bước thực hiện | Kết quả mong đợi |
|----|-----------|----------------|-----------------|-------------------|
| TC-KL-037 | Điểm tính đúng: 2 minor | Lái xe có 2 vi phạm minor | Xem tổng điểm | Tổng điểm = 2 (1+1), Grade = A |
| TC-KL-038 | Điểm tính đúng: hỗn hợp | 1 minor + 1 moderate + 1 severe | Xem tổng điểm | Tổng điểm = 9 (1+3+5), Grade = C |
| TC-KL-039 | Xóa vi phạm → điểm giảm | Lái xe Grade C (6đ), xóa 1 severe | Xóa 1 vi phạm severe | Tổng điểm = 1, Grade = A |
| TC-KL-040 | Hủy phạt không tính điểm | Lái xe có 1 vi phạm đã hủy (cancelled) | Xem bảng xếp hạng | Vi phạm cancelled KHÔNG tính vào tổng điểm |
| TC-KL-041 | Lái xe mới chưa có vi phạm | Lái xe vừa tạo tài khoản | Xem bảng xếp hạng | Grade A+, Tổng điểm 0, Chuỗi sạch 0 |
| TC-KL-042 | Chuỗi sạch reset sau vi phạm | Lái xe có streak = 5, tạo phạt mới | Tạo phạt mới → xem streak | Chuỗi sạch = 0 (reset về 0) |

### 5.7. Giao diện & Responsive (TC-KL-043 → TC-KL-045)

| Mã | Test Case | Tiền điều kiện | Bước thực hiện | Kết quả mong đợi |
|----|-----------|----------------|-----------------|-------------------|
| TC-KL-043 | Responsive mobile | Màn hình < 768px | Truy cập `/penalty` | Bảng cuộn ngang, Drawer full-width, nút/filter vẫn thao tác được |
| TC-KL-044 | Tab chuyển đổi mượt | Đang ở tab Bảng xếp hạng | Click tab "Nhật ký vi phạm" | Nội dung chuyển ngay, không reload trang |
| TC-KL-045 | Drawer đóng bằng ESC | Drawer tạo phạt đang mở | Nhấn phím ESC | Drawer đóng, dữ liệu không lưu |
