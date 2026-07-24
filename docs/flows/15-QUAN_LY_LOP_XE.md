# Quản lý Lốp xe (Tire Management)

> Tài liệu QA testing & Hướng dẫn sử dụng — Quản lý lốp xe theo số series, ngày thay, NCC, bảo hành
> **Route:** `/config/tires` (admin CRUD) + `/fleet/tires` (read grid by truck) + Dashboard widget
> **Roles:** ADMIN, MANAGER, ACCOUNTANT (CRUD); DRIVER (read-only: cảnh báo bảo hành)

---

## 1. Tổng quan

### 1.1 Mô tả

Mỗi đầu kéo có tối đa **22 lốp** (lốp chạy) + **2 lốp dự phòng**. Mỗi lốp có **số series riêng biệt** (serial_no) để nhận diện và truy vết. Hệ thống lưu lại:

- Lốp thuộc xe nào, vị trí nào (trước/sau/trái/phải/dự phòng).
- Lốp chạy được bao nhiêu ngày (tính từ `installed_at` đến `removed_at` hoặc hiện tại).
- Lốp mua từ NCC nào (`supplier_id`).
- Bảo hành đến ngày nào (`warranty_until`).
- Trạng thái hiện tại: đang lắp / dự phòng / đã tháo.

Cảnh báo khi lốp sắp tới hạn bảo hành hoặc đã hết hạn (lead-days cấu hình được).

### 1.2 Phạm vi hiện tại

- **Có:** CRUD lốp (thêm/sửa/xóa mềm), grid theo xe, cảnh báo bảo hành, cảnh báo đã hết hạn.
- **Ngoài phạm vi hiện tại:** theo dõi km đã chạy, cảnh báo km tới hạn thay lốp, lịch sử thay lốp tự động từ chuyến. (Epic riêng — xem `docs/plans/feedback-fix-plan.md` N1.)

### 1.3 Phân quyền

| Vai trò | Xem | Thêm/Sửa | Xóa (soft) |
|---------|:---:|:--------:|:----------:|
| ADMIN | ✅ | ✅ | ✅ |
| MANAGER | ✅ | ✅ | ✅ |
| ACCOUNTANT | ✅ | ✅ | ✅ |
| DRIVER | ✅ (cảnh báo bảo hành cho xe mình) | ❌ | ❌ |

### 1.4 API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/tires` | JWT + config:read | Danh sách lốp (filter: truck_id, status, supplier_id) |
| `POST` | `/api/tires` | JWT + config:write | Thêm lốp mới |
| `GET` | `/api/tires/:id` | JWT + config:read | Chi tiết lốp |
| `PUT` | `/api/tires/:id` | JWT + config:write | Sửa lốp |
| `DELETE` | `/api/tires/:id` | JWT + config:delete | Soft delete |
| `GET` | `/api/tires/alerts` | JWT + config:read | Lốp sắp/đã hết hạn bảo hành |

---

## 2. Hướng dẫn sử dụng

### 2.1 Trang Lốp xe (`/config/tires`)

**Bộ lọc:**
- **Xe đầu kéo** (dropdown) — lọc theo từng xe
- **Trạng thái:** Tất cả / Đang lắp / Dự phòng / Đã tháo
- **NCC** (dropdown) — lọc theo supplier đã mua

**Grid hiển thị:**

| Cột | Mô tả |
|-----|-------|
| Số series | Mã nhận diện duy nhất (`serial_no`) |
| Kích cỡ | Kích cỡ lốp (VD: 11R22.5) |
| Vị trí | Trước/Sau/Trái/Phải/Dự phòng |
| Ngày lắp | `installed_at` |
| Ngày tháo | `removed_at` (null nếu đang lắp) |
| Số ngày chạy | `removed_at - installed_at` hoặc `today - installed_at` |
| NCC | Tên nhà cung cấp |
| Bảo hành đến | `warranty_until` |
| Trạng thái | Badge: ACTIVE / SPARE / REMOVED |

**Hành động:**
- **Thêm lốp:** nút "Thêm" → form nhập serial_no (bắt buộc, unique), truck_id, kích cỡ, vị trí, ngày lắp, NCC, bảo hành đến.
- **Sửa lốp:** click nút Sửa → form inline.
- **Xóa lốp:** click nút Xóa → xác nhận. Soft delete (giữ record cho audit).

### 2.2 Cảnh báo bảo hành

Hiển thị trên:
- **Dashboard** — card "Lốp sắp/đã hết hạn bảo hành" (số lượng).
- **Trang Lốp xe** — badge 🔔 cạnh lốp có `warranty_until` trong lead_days hoặc đã qua.
- **Driver Portal** — chỉ hiện cho xe đang vận hành của lái xe (xem `11-LAI_XE_MOBILE.md §2.6`).

**Điều kiện kích hoạt:** `hôm nay >= warranty_until − lead_days` HOẶC đã quá hạn. Mặc định `lead_days = 30` (cấu hình trong `vehicle_alerts` chung).

### 2.3 Thay lốp (replace workflow)

Khi thay lốp cũ bằng lốp mới (hoặc tháo lốp dự phòng ra lắp):

1. Mở chi tiết lốp cũ → sửa:
    - Set `removed_at = ngày tháo`.
    - Set `status = 'REMOVED'`.
2. Mở lốp dự phòng (status='SPARE') → sửa:
    - Set `installed_at = ngày lắp`.
    - Set `position = vị trí mới`.
    - Set `status = 'ACTIVE'`.
3. (Tùy chọn) thêm lốp mới mua từ NCC vào grid, status='SPARE' (dự phòng).

---

## 3. Luồng nghiệp vụ

### 3.1 Thêm lốp mới

```
POST /api/tires
{ serial_no, truck_id, size, position, installed_at, supplier_id, warranty_until, status: 'ACTIVE' | 'SPARE' }
→ BE: validation (serial_no unique per truck)
→ INSERT
→ 201 Created
```

### 3.2 Cảnh báo bảo hành

```
GET /api/tires/alerts?lead_days=30
→ SELECT t.* FROM tires t
   WHERE t.deleted_at IS NULL
     AND (t.warranty_until <= today() + lead_days
          OR t.warranty_until < today())
→ Trả về danh sách lốp sắp/đã hết hạn, kèm số ngày còn lại (âm nếu quá hạn)
```

---

## 4. Bảng tra cứu

### 4.1 Tire Entity

| Trường | Kiểu | Ràng buộc | Mô tả |
|--------|------|-----------|-------|
| `serial_no` | varchar | NOT NULL, unique | Số series nhận diện (do NCC cấp hoặc tự tạo) |
| `truck_id` | integer | FK → trucks.id, NOT NULL | Xe đầu kéo sở hữu lốp |
| `size` | varchar | NOT NULL | Kích cỡ lốp (VD: 11R22.5, 295/80R22.5) |
| `position` | varchar | NOT NULL | Vị trí (FRONT_LEFT, FRONT_RIGHT, REAR_LEFT, REAR_RIGHT, SPARE, ...) |
| `installed_at` | date | NOT NULL | Ngày lắp lên xe |
| `removed_at` | date | Nullable | Ngày tháo (null nếu đang lắp) |
| `supplier_id` | integer | FK → suppliers.id, nullable | NCC mua lốp |
| `warranty_until` | date | Nullable | Ngày hết hạn bảo hành |
| `status` | enum | `ACTIVE` / `SPARE` / `REMOVED` | Trạng thái hiện tại |
| `created_at` | timestamp | auto | Ngày tạo bản ghi |
| `deleted_at` | timestamp | Nullable (soft delete) | Ngày xóa mềm |

### 4.2 Validation

| Trường | Ràng buộc |
|--------|-----------|
| `serial_no` | Bắt buộc, duy nhất toàn hệ thống (unique constraint) |
| `truck_id` | Bắt buộc, FK tồn tại |
| `installed_at` | Không trong tương lai (theo `today()`) |
| `warranty_until` | Sau hoặc bằng `installed_at` (nếu có) |
| `status='REMOVED'` | Yêu cầu `removed_at` không null |

### 4.3 Quy tắc nghiệp vụ

- Mỗi đầu kéo tối đa **22 lốp ACTIVE** + **2 lốp SPARE** (mặc định) — không cứng, có thể cấu hình linh hoạt.
- Khi `status='REMOVED'`, lốp không còn hiển thị trong grid mặc định (chỉ khi filter "Đã tháo").
- Soft delete giữ record cho audit — không xóa cứng để bảo toàn lịch sử thay lốp.

### 4.4 Seed Data

- Mỗi đầu kéo seed với 22 lốp ACTIVE + 2 lốp SPARE, `installed_at` = ngày mua xe, `warranty_until` = +18 tháng.
- NCC = "Trạm lốp ABC" (mặc định cho seed).

---

## 5. QA Test Checklist

### 5.1 CRUD

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LP-001 | Thêm lốp mới | ADMIN, có xe | Nhập serial, xe, size, vị trí, ngày lắp, NCC → Lưu | Lốp xuất hiện trong grid | High |
| TC-LP-002 | Trùng serial_no | Đã có lốp serial="ABC123" | Thêm lốp cùng serial | Lỗi 409: serial đã tồn tại | High |
| TC-LP-003 | Sửa vị trí lốp | Có lốp | Sửa position → Lưu | Cập nhật thành công | Medium |
| TC-LP-004 | Tháo lốp | Lốp ACTIVE | Sửa status='REMOVED', removed_at=hôm nay | Lốp chuyển filter "Đã tháo" | High |
| TC-LP-005 | Xóa mềm | Có lốp | Click Xóa → Xác nhận | Lốp biến mất khỏi grid (DB giữ deletedAt) | High |
| TC-LP-006 | Filter theo xe | Có 2 xe với lốp | Chọn xe A | Chỉ hiện lốp xe A | High |
| TC-LP-007 | Filter trạng thái | Có lốp ACTIVE + SPARE + REMOVED | Chọn "Dự phòng" | Chỉ hiện lốp SPARE | Medium |

### 5.2 Validation

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-LP-010 | Thiếu serial_no | Để trống → Lưu | Lỗi validation | High |
| TC-LP-011 | Thiếu truck_id | Không chọn xe → Lưu | Lỗi validation | High |
| TC-LP-012 | installed_at tương lai | Nhập ngày mai | Lỗi validation | Medium |
| TC-LP-013 | warranty_until < installed_at | warranty = 1/1, installed = 1/6 | Lỗi validation | Medium |
| TC-LP-014 | status=REMOVED mà removed_at null | Sửa status='REMOVED' không set ngày | Lỗi validation | Medium |

### 5.3 Cảnh báo bảo hành

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LP-020 | Lốp sắp hết hạn (trong lead_days) | Lốp `warranty_until` = hôm nay + 15 ngày | Xem Dashboard | Card cảnh báo hiển thị lốp này | High |
| TC-LP-021 | Lốp đã hết hạn | `warranty_until` = hôm qua | Xem Dashboard | Card cảnh báo hiển thị, badge đỏ | High |
| TC-LP-022 | Lốp còn hạn xa | `warranty_until` = hôm nay + 60 ngày | Xem Dashboard | Không cảnh báo | High |
| TC-LP-023 | Lọc theo lead_days | Nhiều lốp | GET /api/tires/alerts?lead_days=7 | Chỉ lốp trong 7 ngày | Medium |
| TC-LP-024 | Driver thấy cảnh báo xe mình | DRIVER có xe X | Xem portal | Chỉ thấy lốp xe X | High |
| TC-LP-025 | Driver không thấy xe khác | DRIVER có xe X, lốp xe Y sắp hết hạn | Xem portal | Không thấy lốp xe Y | High |

### 5.4 Thay lốp

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LP-030 | Tháo lốp cũ + lắp dự phòng | Có 22 ACTIVE + 2 SPARE | 1. Sửa lốp cũ → REMOVED<br>2. Sửa lốp SPARE → ACTIVE | Cả 2 lốp cập nhật đúng trạng thái | High |
| TC-LP-031 | Mua lốp mới | — | Thêm lốp mới, status='SPARE' | Lốp mới xuất hiện trong filter "Dự phòng" | Medium |
| TC-LP-032 | Lịch sử thay lốp | Có 3 lốp REMOVED | Filter "Đã tháo" | Hiển thị 3 lốp với removed_at | Medium |

### 5.5 Phân quyền

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-LP-040 | DRIVER không thêm | DRIVER → /config/tires | Không thấy nút Thêm | High |
| TC-LP-041 | DRIVER không sửa | DRIVER → /config/tires | Không thấy nút Sửa | High |
| TC-LP-042 | DRIVER không xóa | DRIVER → /config/tires | Không thấy nút Xóa | High |
| TC-LP-043 | ACCOUNTANT CRUD đầy đủ | ACCOUNTANT | Thêm/sửa/xóa thành công | High |

### 5.6 Responsive

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-LP-050 | Mobile grid | < 768px | Grid → card view | Low |
| TC-LP-051 | Mobile filter | < 768px | Dropdown filter stack dọc | Low |

---

## 6. Ghi chú & Lưu ý

- **Phạm vi hiện tại** chỉ gồm CRUD + grid + cảnh báo bảo hành. Km tracking tự động + lịch sử thay lốp từ chuyến là epic riêng (xem `docs/plans/feedback-fix-plan.md` N1).
- **Số ngày chạy** = `removed_at - installed_at` (nếu đã tháo) hoặc `today - installed_at` (nếu đang lắp) — chỉ là thông tin, không có cảnh báo tự động.
- **Soft delete** giữ record vĩnh viễn cho audit trail.
- **Liên kết với chi phí bảo dưỡng (Module 9):** khi nhập phiếu chi phí `Hạng mục = Thay lốp/Sửa lốp`, kế toán chọn xe và `vehicle_component='TRUCK'|'TRAILER'`. Hệ thống **chưa** tự động link tới lốp cụ thể — kế toán tự quản lý trong ghi chú phiếu chi.
- **Lốp dự phòng (SPARE)** có thể chuyển sang ACTIVE khi cần — workflow §2.3.
- **Cảnh báo bảo hành dùng chung `lead_days`** với cảnh báo phương tiện (§4.17 PRODUCT-SPECS) — cấu hình trong bảng `vehicle_alerts`.
