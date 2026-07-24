# Cổng thông tin Lái xe (Mobile)

> Tài liệu QA testing & Hướng dẫn sử dụng — Driver Portal
> **Routes:** `/my-trips`, `/my-trips/:id`, `/my-earnings`, `/my-penalties`
> **Role:** DRIVER chỉ (đọc, chỉ dữ liệu của mình)

---

## 1. Tổng quan

### 1.1 Mô tả

Cổng thông tin lái xe (Driver Portal) là giao diện mobile-first dành riêng cho vai trò DRIVER. Lái xe xem lệnh vận chuyển, thu nhập và phạt của chính mình — read-only, không thể sửa.

### 1.2 Nguyên tắc

| Nguyên tắc | Chi tiết |
|-----------|----------|
| **Chỉ đọc** | DRIVER không có thao tác tạo/sửa/xóa |
| **Phạm vi cá nhân** | Mọi API scope theo `drivers.userId = req.user.userId` |
| **Mobile-first** | Card layout, touch-friendly |
| **Chỉ DRIVER** | ADMIN/MANAGER truy cập /my-trips → redirect /dashboard |

### 1.3 API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/driver/me/trips` | JWT + driver_portal:read | Danh sách chuyến của tôi |
| `GET` | `/api/driver/me/trips/:id` | JWT + driver_portal:read | Chi tiết chuyến (scope own) |
| `GET` | `/api/driver/me/earnings` | JWT + driver_portal:read | Tổng quan thu nhập |
| `GET` | `/api/driver/me/penalties` | JWT + driver_portal:read | Danh sách vi phạm |
| `GET` | `/api/photos/{path}` | JWT + photos:read | Xem ảnh (scope chuyến mình) |

### 1.4 Sidebar Driver

| Menu | Route | Icon |
|------|-------|------|
| Lệnh của tôi | /my-trips | Route |
| Thu nhập | /my-earnings | DollarSign |
| Phạt | /my-penalties | AlertTriangle |

---

## 2. Hướng dẫn sử dụng

### 2.1 Danh sách chuyến (/my-trips)

- Card list: icon Route, tên tuyến, status pill, biển số xe, ngày khởi hành, lương lái xe, **số container**, **tên khách hàng** (B1.1)
- Click card → `/my-trips/:id`
- Empty state: "Chưa có lệnh vận chuyển nào"

### 2.2 Chi tiết chuyến (/my-trips/:id)

- **Header:** Tên tuyến + status + tên khách
- **Thông tin xe:** Đầu kéo, rơ moóc (biển + loại), ngày KH, loại hàng
- **Card nhiên liệu:** Lít được cấp, chế độ (Auto/Flat) — viền nổi bật
- **Card thu nhập:** Lương sản xuất, phụ phí đường, thưởng hàng về (+300K)
- **Chân tuyến:** Legs numbered, origin → destination, km, badge Hàng/Vô
- **Ghi chú:** Nội dung ghi chú
- **Hướng dẫn (B1.3):** phần read-only hiển thị tên + SĐT người liên hệ và lưu ý đặc biệt do quản lý nhập (xem §2.5). Nếu không có hướng dẫn → ẩn phần này.

### 2.3 Thu nhập (/my-earnings) — 5 thẻ dashboard

- **Hero card:** Thu nhập ròng (xanh nếu ≥ 0, đỏ nếu < 0)
- **5 thẻ KPI cộng dồn từ đầu tháng (B2.1–B2.5):**

| # | Thẻ | Nguồn |
|---|-----|-------|
| 1 | **Lương cơ bản tháng** | `base_salary` của lái xe |
| 2 | **Lương phân bổ chuyến** (B1.2 — relabel, ghi rõ "không cộng vào thu nhập thực nhận") | Σ `driver_salary` chuyến LOCKED trong tháng |
| 3 | **Tiền đi đường đã lĩnh** | Σ `totalRoadAllowance` chuyến LOCKED trong tháng |
| 4 | **Đã tạm ứng + đã thanh toán** | Từ sổ cái `entity_type='DRIVER'`, áp dụng quy ước `credit − debit` |
| 5 | **Còn lại** | `(Lương CB + Lương SX + Tiền đi đường) − (Tạm ứng + Kỷ luật + Đã thanh toán)` |

> **Quan trọng:** Không tách STANDBY riêng — STANDBY đã nằm trong Lương CB tháng qua `daily_rate × (trip_days + standby_days)`. Tách riêng sẽ double-count. (B1.2)

- **Danh sách phạt:** Ngày, lý do, số tiền

### 2.4 Vi phạm (/my-penalties)

- **Banner:** Xanh "Không vi phạm" hoặc Đỏ "N vi phạm" + tổng tiền
- **3 KPI:** Vi phạm tháng này, Tiền phạt tháng này, Tổng bản ghi
- **Danh sách:** Lý do, số tiền, ngày, mã chuyến
- **Lọc tháng:** Dropdown

### 2.5 Hướng dẫn cho lái xe (B1.3)

Quản lý nhập hướng dẫn riêng cho từng chuyến (bảng `trip_instructions`). Trên cổng lái xe:

- Hiển thị ở trang chi tiết chuyến `/my-trips/:id` (xem §2.2).
- Read-only — lái xe không sửa được.
- **Trường hiển thị:**
    - **Người liên hệ:** Tên + SĐT
    - **Lưu ý đặc biệt:** free text (hun trùng, cân hàng, kẹp seal tạm, lấy mẫu kiểm dịch…)

### 2.6 Cảnh báo phương tiện (B4)

Lái xe xem cảnh báo hạn vận hành của xe **đang vận hành** (xe gắn với lái xe qua `assigned_truck_id`):

- **4 loại cảnh báo:** Thay dầu (7 ngày), Đăng kiểm (30 ngày), Bảo hiểm TNDS (30 ngày), Phí đường bộ (15 ngày).
- **Hiển thị:** card trên cổng lái xe, badge màu (vàng = sắp tới hạn, đỏ = quá hạn).
- **Mục đích:** nhắc lái xe chủ động báo cho quản lý kế hoạch gia hạn.

---

## 3. Luồng nghiệp vụ

### 3.1 Xem chuyến

```
DRIVER mở /my-trips
→ GET /api/driver/me/trips (scope: drivers.userId = req.user.userId)
→ Hiển thị card list
→ Click card → GET /api/driver/me/trips/:id (403 nếu không phải chuyến mình)
```

### 3.2 Thu nhập

```
GET /api/driver/me/earnings
→ { baseSalary, tripIncome (sum of driverSalary from LOCKED trips), penalties, netIncome }
GET /api/driver/me/penalties
→ { items: [{ id, amount, date, customReason, reasonText }] }
→ netIncome = tripIncome − penalties
```

### 3.3 Truy cập trái phép

```
DRIVER cố vào /finance → Redirect /my-trips
ADMIN cố vào /my-trips → Redirect /dashboard
DRIVER xem ảnh chuyến người khác → GET /api/photos/{path} → 403
```

---

## 4. Bảng tra cứu

### 4.1 Response — GET /api/driver/me/earnings

```json
{
  "baseSalary": "8000000",
  "tripIncome": 7500000,
  "penalties": 500000,
  "netIncome": 7000000
}
```

### 4.2 Response — GET /api/driver/me/trips/:id

```json
{
  "id": 1, "tripCode": "TRP-202605-0001", "departureDate": "2026-05-28",
  "status": "IN_TRANSIT", "fuelLiters": 150.5, "fuelMode": "AUTO",
  "totalRoadAllowance": 500000, "driverSalary": 2500000,
  "hasReturnCargo": true, "notes": "...", "customerReference": "PO-123",
  "routeName": "HCM - Đà Lạt", "truckPlate": "51C-12345",
  "trailerPlate": "30R-0001", "trailerType": "40FT",
  "customerName": "Công ty ABC", "cargoTypeName": "Hàng hỗn hợp",
  "legs": [{ "sequence": 1, "origin": "Kho A", "destination": "Kho B", "km": 310, "loading_type": "HANG" }]
}
```

---

## 5. QA Test Checklist

### 5.1 Xác thực & Phân quyền

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LX-001 | DRIVER truy cập portal | DRIVER | Mở /my-trips | Hiển thị danh sách chuyến, sidebar đúng 3 menu | High |
| TC-LX-002 | ADMIN không vào driver portal | ADMIN | Mở /my-trips | Redirect /dashboard | High |
| TC-LX-003 | DRIVER xem data người khác | DRIVER A | GET /api/driver/me/trips/:id của DRIVER B | 403 Forbidden | High |
| TC-LX-004 | Token hết hạn | Token cũ | Mở bất kỳ trang | Redirect /login | High |
| TC-LX-005 | DRIVER cố vào /finance | DRIVER | Mở /finance | Redirect /my-trips | High |

### 5.2 Danh sách chuyến (/my-trips)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LX-010 | Hiển thị danh sách | Lái xe có ≥ 3 chuyến | Mở /my-trips | Card list với: tên tuyến, status, biển số, ngày, lương | High |
| TC-LX-011 | Empty state | Lái xe chưa có chuyến | Mở /my-trips | "Chưa có lệnh vận chuyển nào" | Medium |
| TC-LX-012 | Click → chi tiết | Có chuyến | Click card | Chuyển đến /my-trips/:id | High |

### 5.3 Chi tiết chuyến (/my-trips/:id)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LX-020 | Hiển thị đầy đủ | Chuyến có đủ data | Mở /my-trips/:id | Header, info xe, nhiên liệu, thu nhập, legs, ghi chú | High |
| TC-LX-021 | Card nhiên liệu nổi bật | Có fuelLiters | Xem card | Viền nổi bật, hiển thị lít + chế độ | Medium |
| TC-LX-022 | Thưởng hàng về | hasReturnCargo=true | Xem thu nhập | Hiển thị "+300,000 ₫" | Medium |
| TC-LX-023 | Chuyến không thuộc mình | Trip của lái xe khác | Mở /my-trips/:id | 403 Forbidden | High |
| TC-LX-024 | Nút quay lại | Đang xem chi tiết | Nhấn quay lại | Về /my-trips | Medium |

### 5.4 Thu nhập (/my-earnings)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LX-030 | Thu nhập dương | tripIncome > penalties | Mở /my-earnings | Hero card xanh, số dương, công thức đúng | High |
| TC-LX-031 | Thu nhập âm | penalties > tripIncome | Mở /my-earnings | Hero card đỏ, số âm | Medium |
| TC-LX-032 | Công thức đúng | tripIncome=7.5M, penalties=0.5M | Xem hero | netIncome=7.0M | High |
| TC-LX-033 | 3 KPI đúng | Có dữ liệu | Xem KPI | baseSalary, tripIncome, deductions đúng | High |

### 5.5 Vi phạm (/my-penalties)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LX-040 | Banner xanh | Không có vi phạm | Mở /my-penalties | "Không vi phạm" màu xanh | High |
| TC-LX-041 | Banner đỏ | Có 3 vi phạm | Mở /my-penalties | "3 vi phạm" màu đỏ + tổng tiền | High |
| TC-LX-042 | Lọc tháng | Có vi phạm nhiều tháng | Chọn tháng 4 | Chỉ hiện vi phạm tháng 4 | Medium |
| TC-LX-043 | Danh sách đủ thông tin | Có vi phạm | Xem danh sách | Lý do, số tiền, ngày, mã chuyến | High |

### 5.6 Truy cập ảnh

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LX-050 | Xem ảnh chuyến mình | DRIVER có chuyến với ảnh | GET /api/photos/{path} (trip mình) | 200 OK, trả về file ảnh | Medium |
| TC-LX-051 | Không xem ảnh người khác | Ảnh thuộc chuyến lái xe khác | GET /api/photos/{path} | 403 Forbidden | High |

### 5.7 Mobile UX

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-LX-060 | Layout mobile 375px | iPhone | Mở /my-trips | Cards full width, text không cắt | Medium |
| TC-LX-061 | Touch target | Mobile | Nhấn card | Vùng nhấn ≥ 44px | Medium |
| TC-LX-062 | Sidebar mobile | Mobile | Toggle sidebar | 3 menu item đúng | Medium |

---

## 6. Ghi chú & Lưu ý

- Tất cả API `/api/driver/me/*` scope tự động theo `req.user.userId` — frontend KHÔNG gửi driverId
- `tripIncome` chỉ tính chuyến **LOCKED** — chuyến COMPLETED chưa khóa không tính
- `netIncome` có thể âm nếu penalties > tripIncome
- Card nhiên liệu có viền nổi bật (branded border) để lái xe dễ nhận diện
- Thưởng hàng về (+300K) chỉ hiện khi `hasReturnCargo = true`
- DRIVER KHÔNG thể upload ảnh qua portal — ảnh do ADMIN upload
