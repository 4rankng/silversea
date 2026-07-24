# Đội xe & Điều vận

> Tài liệu QA testing & Hướng dẫn sử dụng — Điều vận chuyến, Quản lý đội xe
> **Routes:** `/dispatch`, `/fleet`
> **Roles:** ADMIN, MANAGER, ACCOUNTANT (DRIVER không truy cập được)

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Hướng dẫn sử dụng](#2-hướng-dẫn-sử-dụng)
3. [Luồng nghiệp vụ](#3-luồng-nghiệp-vụ)
4. [Bảng tra cứu](#4-bảng-tra-cứu)
5. [QA Test Checklist](#5-qa-test-checklist)
6. [Ghi chú & Lưu ý quan trọng](#6-ghi-chú--lưu-ý-quan-trọng)

---

## 1. Tổng quan

### 1.1 Mô tả

Module **Đội xe & Điều vận** gồm hai trang:
- **Điều vận** (`/dispatch`) — Trung tâm chỉ huy điều vận chuyến đi, xem trạng thái đội xe, xuất phát chuyến, phân xe lại.
- **Đội xe** (`/fleet`) — Quản lý CRUD xe đầu kéo (kèm thông tin rơ-mooc ghép cặp) và lái xe. Không có bảng rơ-mooc riêng — biển số và loại rơ-mooc lưu trên bản ghi xe đầu kéo.

### 1.2 Vai trò truy cập

| Vai trò | Điều vận (/dispatch) | Đội xe (/fleet) |
|---------|---------------------|-----------------|
| ADMIN | ✅ Đầy đủ | ✅ Đầy đủ |
| MANAGER | ✅ Đầy đủ | ✅ Đầy đủ |
| ACCOUNTANT | ✅ Xem + điều vận | ✅ Xem + CRUD |
| DRIVER | ❌ Redirect /my-trips | ❌ Redirect /my-trips |

### 1.3 API Endpoints

#### Điều vận

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/trips?status=CREATED` | JWT + trips:read | Danh sách chuyến chờ xuất phát |
| `GET` | `/api/trips?status=IN_TRANSIT` | JWT + trips:read | Danh sách chuyến đang chạy |
| `GET` | `/api/drivers` | JWT + config:read | Danh sách lái xe |
| `GET` | `/api/trucks` | JWT + config:read | Danh sách xe đầu kéo |
| `POST` | `/api/trips/:id/dispatch` | JWT + trips:write | Xuất phát chuyến (CREATED → IN_TRANSIT) |
| `PATCH` | `/api/trips/:id/reassign` | JWT + trips:write | Phân xe lại (chỉ CREATED) |

#### Quản lý Đội xe — Xe đầu kéo

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/trucks` | JWT + config:read | Danh sách xe |
| `POST` | `/api/trucks` | JWT + config:write | Thêm xe mới |
| `PUT` | `/api/trucks/:id` | JWT + config:write | Cập nhật xe |
| `DELETE` | `/api/trucks/:id` | JWT + config:delete | Xóa mềm xe |


#### Quản lý Đội xe — Lái xe

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/drivers` | JWT + config:read | Danh sách lái xe |
| `POST` | `/api/drivers` | JWT + config:write | Thêm lái xe |
| `PUT` | `/api/drivers/:id` | JWT + config:write | Cập nhật lái xe |

> **Lưu ý:** Drivers KHÔNG có endpoint DELETE (không thể xóa lái xe).

---

## 2. Hướng dẫn sử dụng

### 2.1 Trang Điều vận (/dispatch)

![Điều vận](./screenshots/dispatch.png)

**Thanh chỉ huy (Hero Command Bar):**

| Thành phần | Mô tả |
|-----------|-------|
| Tỷ lệ sử dụng | % xe đang chạy / tổng xe |
| Tổng đội xe | Tổng số xe đầu kéo |
| Đang chạy | Số xe status=IN_TRANSIT |
| Sẵn sàng | Số xe status=CREATED, sẵn sàng xuất phát |
| Cần chú ý | Số xe cần xử lý (maintenance, no driver) |

**Lưới xe (Fleet Vehicle Grid):** Thẻ cho mỗi xe hiển thị biển số, trạng thái (Running/Ready/Maintenance/No driver), avatar lái xe, tuyến đường, ngày khởi hành.

**Hàng đợi lệnh (Orders Queue):** Danh sách chuyến chờ xuất phát với tuyến, khách hàng, xe + lái xe được phân, ngày khởi hành.

**Hành động:**
1. **Xuất phát chuyến:** Nhấn nút "Khởi hành" → hộp thoại xác nhận → `POST /api/trips/:id/dispatch`
2. **Phân xe lại:** Nhấn nút "Đổi xe" → chọn xe + lái xe → `PATCH /api/trips/:id/reassign`
3. **Tạo chuyến mới:** Nhấn nút → chuyển đến `/trips/new`
4. **Xem chuyến đang chạy:** Nhấn vào thẻ xe → chuyển đến `/trips/:id`
5. **Lọc:** Tab all/running/ready/noassign/maintenance

### 2.2 Trang Đội xe (/fleet)

![Đội xe](./screenshots/fleet.png)

**3 thẻ KPI:**
- Tổng xe đầu kéo (active/maintenance)
- Tổng lái xe
- Sẵn sàng chạy

**Bảng Xe đầu kéo:**

| Cột | Nội dung |
|-----|----------|
| Biển số đầu kéo | License plate |
| Biển số rơ-mooc | Plate ghép cặp hoặc "--" |
| Loại rơ-mooc | 20FT / 40FT hoặc "--" |
| Lái xe được phân | Tên lái xe hoặc "--" |
| Trạng thái | Active/Maintenance/Inactive |
| Thao tác | Nút Sửa + Xóa |

**Bảng Lái xe:**

| Cột | Nội dung |
|-----|----------|
| Tên | Họ tên lái xe |
| Điện thoại | Số điện thoại |
| Xe được phân | Biển số xe hoặc "--" |
| Lương cơ bản | Base salary (VND) |
| Trạng thái | Active/Inactive |
| Thao tác | Nút Sửa (KHÔNG có nút Xóa) |

### 2.3 Cảnh báo phương tiện (Vehicle alerts) (A12)

Hệ thống nhắc trước khi tới hạn các mốc vận hành của xe, hiển thị trên **Dashboard quản lý**, trang **Đội xe**, và trang **cá nhân lái xe** (chỉ phương tiện đang vận hành).

**4 loại cảnh báo + lead_days mặc định:**

| Loại | Mã | Lead-days mặc định |
|------|-----|---------------------|
| Thay dầu | `OIL_CHANGE` | **7 ngày** |
| Đăng kiểm | `INSPECTION` | **30 ngày** |
| Bảo hiểm TNDS | `INSURANCE` | **30 ngày** |
| Phí đường bộ | `ROAD_FEE` | **15 ngày** |

Mỗi loại có `lead_days` cấu hình được (override mặc định).

**Điều kiện kích hoạt:** `hôm nay >= hạn_cuối − lead_days` HOẶC đã quá hạn. Hệ thống dùng `hạn_cuối` mới nhất theo từng (xe × loại cảnh báo) — tức là khi nhập phiếu gia hạn mới với `valid_to` xa hơn, cảnh báo tự động cập nhật theo dòng mới.

**Hiển thị:**
- Dashboard: card tổng số cảnh báo + danh sách xe sắp/đã quá hạn.
- Trang Đội xe: cột "Cảnh báo" trong bảng xe — biểu tượng 🔔 + số ngày còn lại (âm nếu quá hạn).
- Lái xe: card "Cảnh báo phương tiện" trên cổng lái xe — chỉ hiện cho xe đang vận hành (`assigned_truck_id` của lái xe).

---

## 3. Luồng nghiệp vụ

### 3.1 Xuất phát chuyến (Dispatch)

```
Giám đốc nhấn "Khởi hành" trên chuyến CREATED
        │
        ▼
  Hiển thị ConfirmDialog: "Xác nhận xuất phát chuyến?"
        │
        ├── Hủy → Đóng dialog, không hành động
        │
        └── Xác nhận → POST /api/trips/:id/dispatch
                          │
                          ├── 200 OK → Chuyển trạng thái CREATED → IN_TRANSIT
                          │             Cập nhật badge sidebar
                          │             Cập nhật lưới xe
                          │
                          ├── Lỗi → Thông báo lỗi
                          │
                          └── Idempotent: Nếu đã IN_TRANSIT → 200, không side effect
```

### 3.2 Phân xe lại (Reassign)

```
Giám đốc nhấn "Đổi xe" trên chuyến CREATED
        │
        ▼
  Hiển thị inline editor: dropdown Xe + dropdown Lái xe
        │
        ├── Hủy → Đóng editor
        │
        └── Chọn xe + lái xe mới → PATCH /api/trips/:id/reassign
                                      Body: { truck_id, driver_id }
                                      │
                                      ├── 200 OK → Cập nhật chuyến
                                      │
                                      ├── 400 → Chỉ CREATED mới được phân lại
                                      │
                                      └── 404 → Chuyến không tồn tại
```

### 3.3 CRUD Xe đầu kéo

```
THÊM XE:
  Nhấn nút "Thêm" → Inline form xuất hiện
  Nhập biển số + chọn trạng thái → Nhấn "Lưu"
  POST /api/trucks { license_plate, status? }
  → 201 Created → Xuất hiện trong bảng

SỬA XE:
  Nhấn nút "Sửa" trên hàng xe → Inline edit
  Chỉnh sửa biển số/trạng thái → Nhấn "Lưu"
  PUT /api/trucks/:id { license_plate?, status? }
  → 200 OK → Cập nhật trong bảng

XÓA XE (mềm):
  Nhấn nút "Xóa" → Xác nhận
  DELETE /api/trucks/:id
  → 200 { ok: true } → Xe biến mất (soft delete)
```

### 3.4 CRUD Lái xe

```
THÊM LÁI XE:
  POST /api/drivers { name, phone?, assigned_truck_id?, base_salary?, status? }
  → 201 Created

SỬA LÁI XE:
  PUT /api/drivers/:id { name?, phone?, assigned_truck_id?, base_salary?, status? }
  → 200 OK

THÊM/SỬA RƠ-MOOC: Dùng API xe đầu kéo:
  PUT /api/trucks/:id { trailer_plate_number?, trailer_type?: "20FT"|"40FT" }
  → Rơ-mooc không có endpoint riêng

XÓA LÁI XE: KHÔNG HỖ TRỢ
  → Không có endpoint DELETE cho drivers
```

---

## 4. Bảng tra cứu

### 4.1 Truck Entity

| Trường | Kiểu | Ràng buộc | Mô tả |
|--------|------|-----------|-------|
| `license_plate` | string | Bắt buộc, min 1 ký tự, unique | Biển số đầu kéo |
| `trailer_plate_number` | string | Tùy chọn | Biển số rơ-mooc ghép cặp cố định |
| `trailer_type` | enum | Tùy chọn: `20FT` / `40FT` | Loại rơ-mooc ghép cặp |
| `status` | enum | ACTIVE / MAINTENANCE / INACTIVE (mặc định ACTIVE) | Trạng thái xe |

### 4.2 Driver Entity

| Trường | Kiểu | Ràng buộc | Mô tả |
|--------|------|-----------|-------|
| `name` | string | Bắt buộc, min 1 ký tự | Họ tên lái xe |
| `phone` | string | Tùy chọn | Số điện thoại |
| `assigned_truck_id` | integer | Tùy chọn, FK → trucks.id | Xe được phân công |
| `base_salary` | numeric | Tùy chọn, không âm | Lương cơ bản (VND) |
| `status` | enum | ACTIVE / INACTIVE (mặc định ACTIVE) | Trạng thái |

### 4.4 Reassign Request

| Trường | Kiểu | Ràng buộc |
|--------|------|-----------|
| `truck_id` | integer | Bắt buộc, positive |
| `driver_id` | integer | Bắt buộc, positive |

### 4.5 Dispatch Response

Không có request body. Response là trip đã cập nhật với status = IN_TRANSIT.

### 4.6 Trạng thái chuyến (Dispatch context)

| Trạng thái | Ý nghĩa | Hành động có thể |
|-----------|---------|-------------------|
| CREATED | Chờ xuất phát | Dispatch, Reassign, Cancel |
| IN_TRANSIT | Đang chạy | (Chỉ xem) |

### 4.6 Seed Data

| Entity | Số lượng | Chi tiết |
|--------|----------|----------|
| Xe đầu kéo | 4 | Mỗi xe có biển số rơ-mooc ghép cặp và loại (20FT/40FT) |
| Lái xe | Nhiều | Lương cơ bản 7.5M-8.5M VND |

---

## 5. QA Test Checklist

### 5.1 Happy Path — Điều vận

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-DP-001 | Xuất phát chuyến CREATED | Có chuyến status=CREATED | 1. Nhấn "Khởi hành"<br>2. Xác nhận dialog | Chuyển IN_TRANSIT, lưới xe cập nhật, badge sidebar cập nhật | High |
| TC-DP-002 | Phân xe lại chuyến CREATED | Có chuyến CREATED với xe A + lái xe X | 1. Nhấn "Đổi xe"<br>2. Chọn xe B + lái xe Y<br>3. Lưu | Chuyến cập nhật xe B + lái xe Y | High |
| TC-DP-003 | Xem lưới xe trạng thái | Có xe ở nhiều trạng thái | 1. Xem trang dispatch | Thẻ xe hiển thị đúng trạng thái: Running/Ready/Maintenance/No driver | High |
| TC-DP-004 | Lọc tab running | Có xe đang chạy và xe sẵn sàng | 1. Click tab "Running" | Chỉ hiển thị xe đang chạy | Medium |
| TC-DP-005 | Lọc tab ready | Có xe ở nhiều trạng thái | 1. Click tab "Ready" | Chỉ hiển thị xe sẵn sàng | Medium |
| TC-DP-006 | Điều hướng tạo chuyến mới | Đang ở trang dispatch | 1. Nhấn nút tạo chuyến | Chuyển đến `/trips/new` | Low |
| TC-DP-007 | Xem chi tiết chuyến đang chạy | Có xe đang chạy | 1. Nhấn vào thẻ xe | Chuyển đến `/trips/:id` | Medium |

### 5.2 Validation Tests — Điều vận

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-DP-010 | Phân xe lại chuyến IN_TRANSIT | Có chuyến IN_TRANSIT | 1. Thử PATCH reassign | Lỗi: chỉ CREATED mới được phân lại | High |
| TC-DP-011 | Phân xe lại thiếu truck_id | Có chuyến CREATED | 1. PATCH chỉ gửi driver_id | Lỗi validation: thiếu truck_id | Medium |
| TC-DP-012 | Phân xe lại truck_id không tồn tại | Có chuyến CREATED | 1. PATCH gửi truck_id=9999 | Lỗi: truck không tồn tại | Medium |
| TC-DP-013 | Xuất phát chuyến IN_TRANSIT (idempotent) | Chuyến đã IN_TRANSIT | 1. POST dispatch | 200 OK, không side effect | Medium |
| TC-DP-014 | Xuất phát chuyến LOCKED | Chuyến đã LOCKED | 1. POST dispatch | Lỗi: không thể chuyển từ LOCKED | High |

### 5.3 Happy Path — CRUD Xe đầu kéo

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TRK-001 | Thêm xe mới | Đăng nhập ADMIN | 1. Nhấn "Thêm" trên bảng xe<br>2. Nhập biển số "51C-99999"<br>3. Nhấn "Lưu" | Xe mới xuất hiện, status=ACTIVE | High |
| TC-TRK-002 | Thêm xe với status MAINTENANCE | Đăng nhập ADMIN | 1. Nhập biển số + chọn MAINTENANCE | Xe tạo với status MAINTENANCE | Medium |
| TC-TRK-003 | Sửa biển số xe | Có xe cần sửa | 1. Nhấn "Sửa"<br>2. Đổi biển số<br>3. "Lưu" | Biển số cập nhật | High |
| TC-TRK-004 | Đổi trạng thái xe | Xe đang ACTIVE | 1. Sửa status → MAINTENANCE | Status cập nhật, KPI cập nhật | Medium |
| TC-TRK-005 | Xóa xe (soft delete) | Có xe cần xóa, ADMIN | 1. Nhấn "Xóa"<br>2. Xác nhận | Xe biến mất, DB vẫn giữ (deletedAt != null) | High |
| TC-TRK-006 | Tìm kiếm xe | Có nhiều xe | 1. Gõ biển số vào ô tìm | Hiển thị xe khớp | Medium |

### 5.4 Validation Tests — Xe đầu kéo

| TC-ID | Tiêu đề | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|---------|----------|-------------------|---------|
| TC-TRK-010 | Thêm xe thiếu biển số | Đăng nhập ADMIN | 1. Để trống biển số → Lưu | Lỗi validation: biển số bắt buộc | High |
| TC-TRK-011 | Thêm xe trùng biển số | Đã có xe "51C-12345" | 1. Thêm xe cùng biển số | Lỗi 409: biển số đã tồn tại | High |
| TC-TRK-012 | Sửa xe không tồn tại | Biết ID không tồn tại | 1. PUT /api/trucks/9999 | Lỗi 404: không tìm thấy | Medium |

### 5.5 Happy Path — Cập nhật thông tin Rơ-mooc trên Xe

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TRL-001 | Gắn rơ-mooc 40FT vào xe | Đăng nhập ADMIN, có xe | 1. Sửa xe → nhập biển số rơ-mooc + chọn 40FT → Lưu | Xe cập nhật trailer_plate_number + trailer_type=40FT | High |
| TC-TRL-002 | Gắn rơ-mooc 20FT vào xe | Đăng nhập ADMIN, có xe | 1. Sửa xe → nhập biển số rơ-mooc + chọn 20FT → Lưu | Xe cập nhật trailer_type=20FT | High |
| TC-TRL-003 | Đổi loại rơ-mooc | Xe đang ghép 20FT | 1. Sửa xe → đổi trailer_type → 40FT → Lưu | Type cập nhật, chuyến mới dùng 40FT | Medium |
| TC-TRL-004 | Xóa thông tin rơ-mooc | Xe đang có rơ-mooc | 1. Sửa xe → xóa trắng biển số rơ-mooc → Lưu | trailer_plate_number=null, trailer_type=null | Medium |
| TC-TRL-005 | Tiền đi đường tự tra đúng loại | Xe ghép 40FT | 1. Tạo chuyến với xe đó | Tiền đi đường chuẩn tra theo cặp (tuyến × 40FT) | High |

### 5.6 Happy Path — CRUD Lái xe

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-DRV-001 | Thêm lái xe đầy đủ | Đăng nhập ADMIN | 1. Nhập tên, phone, lương, chọn xe → Lưu | Tạo thành công | High |
| TC-TRV-002 | Thêm chỉ tên (bắt buộc) | Đăng nhập ADMIN | 1. Chỉ nhập tên → Lưu | Tạo thành công, các trường khác null | High |
| TC-DRV-003 | Sửa lương cơ bản | Có lái xe cần sửa | 1. Đổi base_salary → Lưu | Lương cập nhật | Medium |
| TC-DRV-004 | Phân xe cho lái xe | Lái xe chưa có xe | 1. Chọn assigned_truck → Lưu | Lái xe được phân xe | High |
| TC-DRV-005 | Không có nút xóa lái xe | Xem bảng lái xe | 1. Kiểm tra cột thao tác | Chỉ có nút Sửa, KHÔNG có nút Xóa | High |
| TC-DRV-006 | Sửa status → INACTIVE | Lái xe đang ACTIVE | 1. Đổi status → INACTIVE | Lái xe không còn hiển thị trong dropdown phân xe | Medium |

### 5.7 Permission Tests

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-PERM-001 | DRIVER truy cập /dispatch | Đăng nhập DRIVER | 1. Truy cập /dispatch | Redirect về /my-trips | High |
| TC-PERM-002 | DRIVER truy cập /fleet | Đăng nhập DRIVER | 1. Truy cập /fleet | Redirect về /my-trips | High |
| TC-PERM-003 | ACCOUNTANT dispatch | Đăng nhập ACCOUNTANT | 1. POST /api/trips/:id/dispatch | 200 OK (ACCOUNTANT có trips:write) | High |
| TC-PERM-004 | ACCOUNTANT thêm xe | Đăng nhập ACCOUNTANT | 1. POST /api/trucks | 201 Created (ACCOUNTANT có config:write) | Medium |
| TC-PERM-005 | ACCOUNTANT xóa xe | Đăng nhập ACCOUNTANT | 1. DELETE /api/trucks/:id | Lỗi: ACCOUNTANT không có config:delete | Medium |
| TC-PERM-006 | Không auth — truy cập dispatch | Chưa đăng nhập | 1. GET /api/trips?status=CREATED | 401 Unauthorized | High |

### 5.8 Edge Cases

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-EDGE-001 | Phân xe đang MAINTENANCE vào chuyến | Xe status=MAINTENANCE | 1. Phân xe đang bảo trì | Cảnh báo hoặc cho phép (kiểm tra behavior) | Medium |
| TC-EDGE-002 | Phân lái xe INACTIVE vào chuyến | Lái xe status=INACTIVE | 1. Phân lái xe không hoạt động | Cảnh báo hoặc cho phép | Medium |
| TC-EDGE-003 | Xóa xe đang được lái xe tham chiếu | Xe được assigned_truck_id | 1. Xóa xe | Xóa thành công (soft delete, không cascade) | Medium |
| TC-EDGE-004 | Thanh command bar không có chuyến | Không có chuyến CREATED/IN_TRANSIT | 1. Xem trang dispatch | Hiển thị 0 trên các KPI, không crash | Medium |
| TC-EDGE-005 | Dispatch trang rỗng | Không có chuyến CREATED | 1. Xem orders queue | Hiển thị empty state | Low |

---

## 6. Ghi chú & Lưu ý quan trọng

### Nguyên tắc thiết kế

- **Dispatch** là trung tâm điều hành — chỉ hiển thị thông tin cần thiết cho quyết định xuất phát.
- **Fleet** là cấu hình danh mục — CRUD đơn giản, inline form, không có modal riêng.

### Hạn chế

- **Lái xe không thể xóa:** Endpoint DELETE `/api/drivers/:id` không tồn tại. Đổi status sang INACTIVE để "vô hiệu hóa".
- **ACCOUNTANT không xóa được xe:** Chỉ có `config:read` + `config:write`, không có `config:delete`.
- **Phân xe lại chỉ cho CREATED:** Chuyến IN_TRANSIT/COMPLETED/LOCKED không thể phân xe lại.
- **Dispatch idempotent:** Nếu chuyến đã IN_TRANSIT, gọi dispatch lần nữa trả về 200 mà không side effect.

### Dữ liệu Seed

- 4 xe đầu kéo, mỗi xe ghi sẵn biển số rơ-mooc ghép cặp + loại (20FT/40FT)
- Lái xe với lương cơ bản 7,500,000 — 8,500,000 VND
