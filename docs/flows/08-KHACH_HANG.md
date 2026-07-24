# Khách hàng

> Tài liệu QA testing & Hướng dẫn sử dụng — Quản lý khách hàng
> **Route:** `/customers`
> **Roles:** ADMIN, MANAGER, ACCOUNTANT (DRIVER không truy cập)

---

## 1. Tổng quan

### 1.1 Mô tả

Trang Quản lý Khách hàng cho phép CRUD khách hàng vận tải, hiển thị KPI, chỉ báo rủi ro nợ, tìm kiếm, lọc, phân trang.

### 1.2 Phân quyền

| Vai trò | Xem | Thêm/Sửa | Xóa |
|---------|:---:|:--------:|:---:|
| ADMIN | ✅ | ✅ | ✅ |
| MANAGER | ✅ | ✅ | ✅ |
| ACCOUNTANT | ✅ | ✅ | ❌ (403) |
| DRIVER | ❌ | ❌ | ❌ |

### 1.3 API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/customers` | JWT + config:read | Danh sách KH (phân trang) |
| `POST` | `/api/customers` | JWT + config:write | Thêm KH mới |
| `GET` | `/api/customers/:id` | JWT + config:read | Chi tiết KH |
| `PUT` | `/api/customers/:id` | JWT + config:write | Cập nhật KH |
| `DELETE` | `/api/customers/:id` | JWT + config:delete | Xóa mềm KH |

---

## 2. Hướng dẫn sử dụng

### 2.1 Xem danh sách

1. Truy cập `/customers` → 4 KPI cards: Tổng KH, Active, Top 4 doanh thu, Locked
2. Bảng: Tên KH, MST, Người liên hệ, ĐT, Hạn mức TD, Trạng thái, Risk dot
3. Phân trang: 10 bản ghi/trang

### 2.2 Thêm khách hàng

1. Nhấn "Thêm" → inline form row xuất hiện
2. Nhập: **Tên** (bắt buộc), MST, Người liên hệ, ĐT, Hạn mức TD, Trạng thái, **Phương thức Giấy báo nợ** (Tháng/Lô), **Khách hàng liên kết** (Chọn NCC nếu có).
3. Nhấn "Lưu"

### 2.3 Sửa khách hàng

1. Click (⋮) → "Sửa" → inline edit
2. Chỉnh sửa → "Lưu"

### 2.4 Xóa khách hàng

1. Click (⋮) → "Xóa" → Xác nhận
2. Soft delete: `deletedAt` được set, KH biến mất khỏi danh sách

### 2.5 Tìm kiếm & Lọc

- **Tìm kiếm:** Debounce 300ms, tìm theo tên/MST
- **Filter pills:** All/Risk/Active/Locked

### 2.6 Công nợ phải thu trên trang chi tiết KH (A13)

Trang chi tiết khách hàng (`/customers/:id`) hiển thị **widget Công nợ phải thu** ngay tại header (phía dưới thông tin liên hệ), giúp quản lý/kế toán nắm được tình trạng nợ mà không cần chuyển sang trang `/debt/:id`.

**Nội dung widget:**

| Thành phần | Mô tả |
|------------|-------|
| **Số dư hiện tại** | Tổng `balance` của dòng ledger mới nhất (VND) — viền đỏ nếu > 0, xanh nếu = 0 |
| **Tuổi nợ lớn nhất** | Số ngày kể từ dòng `TRIP_REVENUE` chưa thanh toán cũ nhất |
| **4 aging buckets** | Hiển thị 4 ô: 0–30 / 31–60 / 61–90 / 90+ với số tiền từng bucket |
| **Nút "Xem chi tiết"** | Chuyển sang `/debt/:id` để xem sao kê + ghi thanh toán |

**Cập nhật:** số liệu làm mới tức thời khi có ledger post mới (xem `04-CONG_NO_VA_THANH_TOAN.md §2.1`).

---

## 3. Luồng nghiệp vụ

```
THÊM: POST /api/customers { name (required), tax_code?, contact_person?, phone?, credit_limit?, status?, debit_note_mode?, linked_supplier_id? }
→ 201 Created → Refresh danh sách

SỬA: PUT /api/customers/:id { name?, tax_code?, contact_person?, phone?, credit_limit?, status?, debit_note_mode?, linked_supplier_id? }
→ 200 OK → Refresh

XÓA: DELETE /api/customers/:id → Soft delete → 200 { ok: true }
```

---

## 4. Bảng tra cứu

### 4.1 Customer Entity

| Trường | Kiểu | Ràng buộc |
|--------|------|-----------|
| name | varchar(255) | NOT NULL, min 1 |
| tax_code | varchar(20) | Nullable |
| contact_person | varchar(255) | Nullable |
| phone | varchar(20) | Nullable |
| contact_info | text | Nullable |
| credit_limit | numeric(15,0) | Nullable |
| status | ACTIVE/LOCKED | Default ACTIVE |
| debit_note_mode | enum | 'MONTHLY' \| 'PER_BATCH', Default 'MONTHLY' |
| linked_supplier_id | integer | Nullable, references suppliers(id) |

### 4.2 Risk Dot Indicators

| Màu | Điều kiện |
|-----|-----------|
| Xanh | nợ / hạn mức < 50% |
| Vàng | 50%–80% |
| Đỏ | > 80% |

### 4.3 Seed Data: 7 khách hàng, credit limits 50M–200M VND, 1 LOCKED (Hùng Thịnh Trans)

---

## 5. QA Test Checklist

### 5.1 Hiển thị

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-KH-001 | Trang tải đúng | ADMIN | Mở /customers | 4 KPI + Bảng + Pagination | High |
| TC-KH-002 | KPI đúng số liệu | 7 KH seed | Xem KPI | Tổng=7, Active=6, Locked=1 | High |
| TC-KH-003 | Risk dot hiển thị | KH có nợ/hạn mức | Xem bảng | Dot màu xanh/vàng/đỏ đúng | Medium |
| TC-KH-004 | Mobile card view | < 768px | Resize | Bảng → card view | Low |
| TC-KH-005 | DRIVER không truy cập | DRIVER | Mở /customers | Redirect /my-trips | High |

### 5.2 CRUD

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-KH-010 | Thêm KH đầy đủ | ADMIN | Nhập đầy đủ → Lưu | 201, KH mới xuất hiện | High |
| TC-KH-011 | Thêm KH thiếu tên | ADMIN | Để trống tên → Lưu | Lỗi validation | High |
| TC-KH-012 | Thêm KH trùng tên | ADMIN | Nhập tên đã tồn tại | Kiểm tra behavior (cho phép hoặc lỗi) | Medium |
| TC-KH-013 | Sửa tên KH | ADMIN | Sửa tên → Lưu | Tên cập nhật | High |
| TC-KH-014 | Đổi status ACTIVE→LOCKED | ADMIN | Sửa status → Lưu | Status cập nhật, KPI cập nhật | Medium |
| TC-KH-015 | Xóa KH (ADMIN) | ADMIN | Click Xóa → Xác nhận | Soft delete, KH biến mất | High |
| TC-KH-016 | ACCOUNTANT không xóa | ACCOUNTANT | Click Xóa | 403 hoặc nút ẩn | High |
| TC-KH-017 | Xóa KH rồi thêm lại | ADMIN | Xóa → Thêm cùng tên | Tạo thành công (ID mới) | Medium |
| TC-KH-018 | Sửa KH đã xóa | ADMIN | PUT /api/customers/:id đã xóa | 404 Not Found | Medium |

### 5.3 Tìm kiếm & Lọc

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-KH-020 | Tìm theo tên | ADMIN | Nhập "ABC" | Hiển thị KH có tên chứa "ABC" | High |
| TC-KH-021 | Tìm theo MST | ADMIN | Nhập MST | Hiển thị KH có MST khớp | Medium |
| TC-KH-022 | Debounce 300ms | ADMIN | Gõ nhanh 5 ký tự | Chỉ 1 request sau 300ms | Medium |
| TC-KH-023 | Filter Active | ADMIN | Click Active | Chỉ hiện KH ACTIVE | Medium |
| TC-KH-024 | Filter Locked | ADMIN | Click Locked | Chỉ hiện KH LOCKED | Medium |
| TC-KH-025 | Tìm + Filter kết hợp | ADMIN | Tìm + Active | Kết quả khớp cả hai | Medium |

---

## 6. Ghi chú & Lưu ý

- **Soft delete**: KH bị xóa vẫn tồn tại trong DB (deletedAt != null), không cascade xóa chuyến đi
- **Risk dot**: Tính client-side, dựa trên tỷ lệ nợ/hạn mức tín dụng
- **ACCOUNTANT không có config:delete** — không thể xóa KH, chỉ có thể đổi status sang LOCKED
- KH bị xóa mềm không xuất hiện trong dropdown tạo chuyến đi
