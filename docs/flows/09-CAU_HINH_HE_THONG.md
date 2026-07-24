# Cấu hình hệ thống

> Tài liệu QA testing & Hướng dẫn sử dụng — Quản lý cấu hình toàn hệ thống
> **Route:** `/config` (hub) + 13 sub-pages
> **Roles:** ADMIN (CRUD), MANAGER (view + limited edit), ACCOUNTANT (view only), DRIVER (no access)

---

## 1. Tổng quan

### 1.1 Mô tả

Trang **Cấu hình hệ thống** là trung tâm quản trị toàn bộ dữ liệu nền tảng. Hub page hiển thị 13 thẻ, mỗi thẻ liên kết đến một sub-page cấu hình.

### 1.2 13 Sub-pages

| # | Tên | Route | Mô tả |
|---|-----|-------|-------|
| 1 | Định mức nhiên liệu | `/config/fuel` | Tiêu hao NL theo loại xe + tuyến |
| 2 | Tiền đi đường | `/config/road-allowances` | Phụ cấp đường theo tuyến × loại rơ-mooc (20FT/40FT) |
| 3 | Quy tắc kỷ luật & phạt | `/config/penalty-reasons` | Danh mục lý do phạt |
| 4 | Người dùng & Lái xe | `/config/drivers` | CRUD người dùng + hồ sơ lái xe |
| 5 | Thông tin công ty & Cổ phần | `/config/cap-table` | Cổ đông, tỷ lệ chia lợi nhuận |
| 6 | Khách hàng & Đối tác | `/config/customers` | CRUD khách hàng (xem 08-KHACH_HANG.md) |
| 7 | Tuyến đường & Cự ly | `/config/routes` | Tuyến đường, khoảng cách |
| 8 | Xe đầu kéo | `/config/trucks` | Biển số, biển số rơ-mooc ghép cặp, loại rơ-mooc, trạng thái |
| 9 | Loại hàng hóa | `/config/cargo-types` | Phân loại hàng hóa |
| 10 | Bảng giá cước | `/config/pricing-tables` | Giá cước theo tuyến × loại hàng |
| 11 | Phí quản lý | `/config/management-fees` | Tỷ lệ phí QL trừ P&L |
| 12 | Loại container | `/config/container-types` | Danh mục loại container (20'DC, 20'OT, 20'RF, 40'DC, 40'HC...) |
| 13 | Cảng / Bãi | `/config/ports` | Danh mục cảng, bãi (chủ yếu tại Hải Phòng) |

> **Module bổ sung (xem tài liệu riêng):**
> - **Quản lý lốp xe** → [`15-QUAN_LY_LOP_XE.md`](./15-QUAN_LY_LOP_XE.md) — CRUD lốp, grid theo xe, cảnh báo bảo hành.
> - **Cảnh báo đội xe** (`vehicle_alerts`) — cấu hình `lead_days` cho từng loại cảnh báo (thay dầu, đăng kiểm, bảo hiểm, phí đường bộ). Xem `07-DOI_XE_VA_FLEET.md §2.3` và `PRODUCT-SPECS §4.17`.
> - **Hướng dẫn cho lái xe** (`trip_instructions`) — quản lý nhập từ chi tiết chuyến, không phải sub-page riêng. Xem `11-LAI_XE_MOBILE.md §2.5`.
> - **Phân chia lợi nhuận theo xe** (`truck_profit_distribution`) — cấu hình `share_pct` cho từng xe. Xem `05-PHAN_BO_LOI_NHUAN.md §2.4` và `PRODUCT-SPECS §4.8.1`.
> - **Cài đặt ứng dụng** (`/config/app-settings`, ADMIN) — bật/tắt tính năng dùng chung, chọn nhà cung cấp AI và cấu hình tài khoản định vị Bách Khoa.

### 1.3 Phân quyền

| Role | Xem | Tạo | Sửa | Xóa |
|------|:---:|:---:|:---:|:---:|
| ADMIN | ✅ | ✅ | ✅ | ✅ |
| MANAGER | ✅ | ❌ | ✅ (giới hạn) | ❌ |
| ACCOUNTANT | ✅ | ❌ | ❌ | ❌ |
| DRIVER | ❌ | ❌ | ❌ | ❌ |

### 1.4 API Endpoints

Tất cả qua `/api/v1/catalog/*` (catalogs route) + `/api/v1/fleet/*` + `/api/v1/drivers/*` + `/api/v1/config/*`.

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET/POST/PUT/DELETE | `/catalog/fuel-norms[/:id]` | CRUD định mức NL |
| GET/POST/PUT/DELETE | `/catalog/road-allowances[/:id]` | CRUD tiền đi đường |
| GET/POST/PUT/DELETE | `/catalog/penalty-reasons[/:id]` | CRUD lý do phạt |
| GET/POST/PUT/DELETE | `/catalog/cargo-types[/:id]` | CRUD loại hàng |
| GET/POST/PUT/DELETE | `/catalog/pricing-tables[/:id]` | CRUD bảng giá cước |
| GET/POST/PUT/DELETE | `/catalog/management-fees[/:id]` | CRUD phí quản lý |
| GET/POST/PUT/DELETE | `/catalog/container-types[/:id]` | CRUD loại container |
| GET/POST/PUT/DELETE | `/catalog/ports[/:id]` | CRUD cảng/bãi |
| GET/POST/PUT/DELETE | `/catalog/route-configs[/:id]` | CRUD tuyến đường |
| GET/POST/PUT/DELETE | `/fleet/trucks[/:id]` | CRUD xe đầu kéo (kèm trailer_plate_number + trailer_type) |
| GET/POST/PUT/DELETE | `/drivers[/:id]` | CRUD lái xe |
| GET/PUT | `/config/cap-table` | Xem/cập nhật cổ phần |
| GET | `/catalog/fuel-price-history` | Lịch sử giá nhiên liệu (append-only, sắp xếp giảm theo ngày) |
| GET/PUT | `/admin/app-settings` | Bật/tắt Trợ lý ảo và Hướng dẫn sử dụng |
| GET/PUT | `/admin/llm-settings` | Chọn MiniMax/OpenRouter và cập nhật API key |
| GET/PUT | `/admin/gps-settings` | Cập nhật tên đăng nhập/mật khẩu định vị Bách Khoa |

---

## 2. Hướng dẫn sử dụng

### 2.1 Hub `/config`

13 thẻ grid. Click thẻ → sub-page. ADMIN thấy đủ 13. MANAGER ẩn Cổ phần. ACCOUNTANT chỉ xem. DRIVER không thấy menu.

### 2.2 Định mức & Đơn giá nhiên liệu `/config/fuel`

**Phần 1 — Định mức nhiên liệu:**

**Trường:** Loại xe (bắt buộc), Tuyến đường (bắt buộc), Định mức L/100km (>0), Ghi chú.

**Ràng buộc:** Cặp (loại xe + tuyến) duy nhất. Không xóa khi đang dùng trong chuyến.

**Phần 2 — Đơn giá nhiên liệu:**

**Trường:** Đơn giá (VNĐ/lít, >0).

**Hành vi:** Kế toán nhập đơn giá mới → hệ thống tự động ghi một dòng vào **Bảng lịch sử giá** bên dưới với ngày hiệu lực = hôm nay, người thay đổi = user hiện tại. Bảng lịch sử là append-only — không sửa/xóa.

**Bảng lịch sử giá nhiên liệu** (hiển thị bên dưới trường đơn giá):

| Cột | Mô tả |
|-----|-------|
| Ngày hiệu lực | Ngày đơn giá bắt đầu áp dụng |
| Đơn giá (VNĐ/lít) | Giá nhiên liệu |
| Người thay đổi | Họ tên user cập nhật |
| Ghi chú | Lý do thay đổi (tùy chọn) |

**Sử dụng trong chuyến:** Khi kế toán nhập liệu chuyến (Pha 2), trường "Đơn giá thực tế" có nút **Đề xuất** — hệ thống tra bảng lịch sử để tìm giá hiệu lực tại ngày xuất phát của chuyến và tự điền. Kế toán có thể chấp nhận hoặc nhập giá khác.

### 2.3 Tiền đi đường `/config/road-allowances`

**Trường:** Tuyến đường (bắt buộc), Loại xe (bắt buộc), Số tiền phụ cấp (>=0), Ghi chú.

**Ràng buộc:** Không xóa khi đang dùng trong chuyến.

### 2.4 Quy tắc kỷ luật & phạt `/config/penalty-reasons`

**Trường:** Tên lý do (bắt buộc, duy nhất), Số tiền phạt (>=0), Mô tả, Trạng thái (active/inactive).

### 2.5 Người dùng & Lái xe `/config/drivers`

**Trường:** Họ tên (bắt buộc), SĐT (bắt buộc, duy nhất), Email (duy nhất), Vai trò, Mật khẩu (bắt buộc khi tạo), Biển số xe mặc định (DRIVER), **Lương cơ bản (VNĐ)** — `baseSalary`, số không âm, bắt buộc cho DRIVER role, **BHXH doanh nghiệp đóng (VNĐ)** — `social_insurance`, số không âm, mặc định 0 *(dùng để tính `daily_rate` và lương chuyến quy đổi — Pete xác nhận 4/6)*, Trạng thái.

**Đặc biệt:** Không xóa user có chuyến → deactivate. Xe gắn phải ACTIVE. Lương cơ bản và BHXH dùng trong công thức lương chuyến: `(baseSalary + social_insurance) / 26 × tripWageDays`.

### 2.6 Cổ phần `/config/cap-table`

**Trường:** Tên cổ đông (bắt buộc), Số cổ phần (>0), Ghi chú. Tỷ lệ tự tính.

**Ràng buộc:** Tổng tỷ lệ tất cả cổ đông = 100%.

### 2.7 Khách hàng → xem **08-KHACH_HANG.md**

### 2.8 Tuyến đường `/config/routes`

**Trường:** Tên tuyến (bắt buộc, duy nhất), Điểm đi, Điểm đến, Cự ly km (>0), Ghi chú.

**Ràng buộc:** Không xóa khi dùng trong bảng giá hoặc chuyến đi.

### 2.9 Xe đầu kéo `/config/trucks`

**Trường:** Biển số đầu kéo (bắt buộc, duy nhất), Biển số rơ-mooc ghép cặp (tùy chọn), Loại rơ-mooc (20FT/40FT, tùy chọn), Trạng thái (ACTIVE/MAINTENANCE/INACTIVE).

**Ràng buộc:** Không xóa khi gán chuyến đi. ACTIVE mới xuất hiện dropdown tạo chuyến. Loại rơ-mooc quyết định tiền đi đường chuẩn sẽ tra theo cặp nào trong bảng `road_allowances`.

### 2.10 Loại hàng hóa `/config/cargo-types`

**Trường:** Tên loại (bắt buộc, duy nhất), Mô tả, Mã, Trạng thái.

### 2.11 Bảng giá cước `/config/pricing-tables`

**Trường:** Tuyến (bắt buộc), Loại hàng (bắt buộc), Đơn giá (>0), Đơn vị (per_trip/per_ton/per_km).

**Ràng buộc:** Bộ 3 (tuyến + loại hàng + đơn vị) duy nhất.

### 2.12 Phí quản lý `/config/management-fees`

**Trường:** Tên phí (bắt buộc, duy nhất), Tỷ lệ % (0 < x <= 100), Mô tả, Trạng thái.

### 2.13 Loại container `/config/container-types`

**Trường:** Mã loại (bắt buộc, duy nhất — VD: `20DC`, `40HC`), Tên hiển thị (bắt buộc — VD: 20'DC, 40'HC), Kích thước nhóm (20FT/40FT — dùng để validate phù hợp với rơ-mooc), Trạng thái (active/inactive).

**Dữ liệu mẫu:** 20'DC (Dry Container), 20'OT (Open Top), 20'RF (Reefer), 40'DC, 40'HC (High Cube).

**Ràng buộc:** Không xóa loại đang dùng trong chuyến. Kích thước nhóm dùng để cảnh báo: rơ-mooc 20FT chỉ nên chở container nhóm 20FT.

### 2.14 Cảng / Bãi `/config/ports`

**Trường:** Tên (bắt buộc, duy nhất — VD: Cảng Đình Vũ, Bãi ICD NL), Địa chỉ, Ghi chú, Trạng thái (active/inactive).

**Sử dụng:** Khi nhập chặng (trip legs), trường origin/destination hiển thị **combobox** — dropdown chọn từ danh mục Cảng/Bãi, đồng thời cho phép nhập text tự do nếu điểm chưa có trong danh mục. Mục mới nhập sẽ được gợi ý thêm vào danh mục.

**Ràng buộc:** Không xóa cảng/bãi đang dùng trong chặng chuyến.

### 2.15 Cài đặt ứng dụng `/config/app-settings`

Trang này chỉ dành cho ADMIN và gồm ba nhóm:

1. **Tính năng ứng dụng** — bật/tắt Trợ lý ảo và Hướng dẫn sử dụng.
2. **Nhà cung cấp AI** — chọn MiniMax hoặc OpenRouter và cập nhật API key. Route cũ `/config/llm-settings` tự chuyển về trang này.
3. **Định vị Bách Khoa** — cập nhật tên đăng nhập và mật khẩu dùng cho dữ liệu vị trí xe/lộ trình GPS.

API key và thông tin đăng nhập Bách Khoa được mã hóa AES-256-GCM trong `app_settings`. Mật khẩu/API key đầy đủ không được trả lại trình duyệt; để trống trường secret khi lưu sẽ giữ nguyên giá trị hiện tại. Cấu hình mới làm mất hiệu lực cache/session GPS để có hiệu lực mà không cần khởi động lại backend.

---

## 3. Luồng nghiệp vụ

### 3.1 Sơ đồ phụ thuộc

```
Tuyến đường ─────────┐
                      ├──→ Bảng giá cước ──→ Chuyến đi
Loại hàng hóa ───────┘                    │
Xe đầu kéo ─────────────────────────────→ Chuyến đi (loại rơ-mooc tự tra từ xe)
Lái xe ─────────────────────────────────→ Chuyến đi
Khách hàng ─────────────────────────────→ Chuyến đi
Loại container ────────────────────────→ Container trong chuyến
Cảng/Bãi ─────────────────────────────→ Chặng chuyến (origin/destination dropdown)

Tuyến + Xe.trailerType ──→ Tiền đi đường ──→ Tính chi phí
Tuyến + Xe ────────────→ Định mức NL ──────→ Tính chi phí
Lịch sử giá NL ────────→ Đề xuất giá ──────→ Nhập liệu chuyến (fuelActualUnitPrice)
Cổ phần ────→ Phân bổ lợi nhuận
Phí QL ─────→ Trừ P&L
```

### 3.2 Thứ tự thiết lập

1. Cổ phần → 2. Người dùng → 3. Khách hàng → 4. Loại hàng → 5. Tuyến đường → 6. Xe đầu kéo (+ biển số/loại rơ-mooc ghép cặp) → 7. Loại container → 8. Cảng/Bãi → 9. Bảng giá cước → 10. Định mức NL → 11. Tiền đi đường → 12. Lý do phạt → 13. Phí quản lý

---

## 4. Bảng tra cứu

### 4.1 Trạng thái xe / rơ-moóc

| Giá | Ý nghĩa | Dropdown tạo chuyến |
|-----|---------|-------------------|
| ACTIVE | Đang hoạt động | ✅ Có |
| MAINTENANCE | Đang bảo dưỡng | ❌ Không |
| INACTIVE | Ngừng hoạt động | ❌ Không |

### 4.2 Loại rơ-moóc (trailerType)

| Giá trị | Mô tả |
|---------|-------|
| 20FT | Rơ-mooc 20 feet |
| 40FT | Rơ-mooc 40 feet |

Loại rơ-moóc là trường trên bảng `trucks` (`trailer_type`), dùng làm khóa tra bảng `road_allowances` (Tuyến × Loại rơ-moóc).

### 4.3 Đơn vị giá cước

| Giá | Mô tả |
|-----|-------|
| per_trip | Theo chuyến |
| per_ton | Theo tấn |
| per_km | Theo km |

---

## 5. QA Test Checklist

### 5.1 Hub Page (TC-CH-001 → TC-CH-004)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-001 | 11 thẻ trên hub | ADMIN | Mở `/config` | Hiển thị đúng 11 thẻ có icon + tên + số lượng | High |
| TC-CH-002 | Click thẻ → sub-page | ADMIN | Click "Định mức NL" | Chuyển đến `/config/fuel` | High |
| TC-CH-003 | DRIVER không thấy menu | DRIVER | Kiểm tra sidebar | Không thấy "Cấu hình" | High |
| TC-CH-004 | ACCOUNTANT chỉ xem | ACCOUNTANT | Vào sub-page bất kỳ | Không có nút Tạo/Sửa/Xóa | High |

### 5.2 Định mức NL (TC-CH-005 → TC-CH-007)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-005 | Tạo định mức | ADMIN, `/config/fuel` | Chọn xe + tuyến, nhập 25 L/100km → Lưu | Tạo thành công | High |
| TC-CH-006 | Thiếu trường bắt buộc | ADMIN, `/config/fuel` | Để trống định mức → Lưu | Lỗi validation | High |
| TC-CH-007 | Xóa khi đang dùng | Định mức có trong chuyến | Click xóa → Xác nhận | Lỗi: đang sử dụng | High |

### 5.3 Tiền đi đường (TC-CH-008 → TC-CH-009)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-008 | Tạo phụ cấp | ADMIN | Chọn tuyến + xe, nhập 500000 → Lưu | Tạo thành công | High |
| TC-CH-009 | Số tiền âm | ADMIN | Nhập -100000 → Lưu | Lỗi validation: >= 0 | Medium |

### 5.4 Lý do phạt (TC-CH-010 → TC-CH-011)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-010 | Tạo lý do phạt | ADMIN | Nhập "Đi muộn", 200000 → Lưu | Tạo thành công | High |
| TC-CH-011 | Trùng tên lý do | Có "Đi muộn" | Tạo lại "Đi muộn" → Lưu | Lỗi trùng lặp | High |

### 5.5 Người dùng & Lái xe (TC-CH-012 → TC-CH-014)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-012 | Tạo lái xe | ADMIN | Nhập họ tên, SĐT, role DRIVER → Lưu | Tạo thành công | High |
| TC-CH-013 | Trùng SĐT | Có SĐT 0901234567 | Tạo mới cùng SĐT → Lưu | Lỗi trùng lặp | High |
| TC-CH-014 | Deactivate thay vì xóa | Lái xe có chuyến | Click deactivate | Trạng thái → inactive, không xóa | High |

### 5.6 Cổ phần (TC-CH-015 → TC-CH-016)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-015 | Thêm cổ đông | ADMIN | Nhập tên + 1000 cổ phần → Lưu | Tạo thành công, tỷ lệ tự cập nhật | High |
| TC-CH-016 | Tổng tỷ lệ = 100% | 2 cổ đông 60%+40% | Xóa 1 cổ đông | Cảnh báo tổng ≠ 100% | High |

### 5.7 Tuyến đường (TC-CH-017 → TC-CH-018)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-017 | Tạo tuyến | ADMIN | Nhập "HCM-ĐN", 850km → Lưu | Tạo thành công | High |
| TC-CH-018 | Xóa tuyến đang dùng | Tuyến có trong bảng giá | Click xóa → Xác nhận | Lỗi: đang sử dụng | High |

### 5.8 Xe đầu kéo (TC-CH-019 → TC-CH-020)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-019 | Tạo xe | ADMIN | Nhập "60C-12345", ACTIVE → Lưu | Tạo thành công | High |
| TC-CH-020 | Trùng biển số | Có "60C-12345" | Tạo mới cùng BS → Lưu | Lỗi trùng lặp | High |

### 5.9 Xe đầu kéo — thông tin rơ-moóc (TC-CH-021 → TC-CH-022)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-021 | Gắn rơ-moóc vào xe | ADMIN | Sửa xe → nhập biển số rơ-moóc + chọn 40FT → Lưu | Xe cập nhật trailer_plate + trailer_type | High |
| TC-CH-022 | Tiền đi đường tự chọn đúng loại | Xe ghép 20FT | Tạo chuyến chọn xe đó | Road allowance tra theo (tuyến × 20FT) | High |

### 5.10 Loại hàng hóa (TC-CH-023 → TC-CH-024)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-023 | Tạo loại hàng | ADMIN | Nhập "Cát xây dựng" → Lưu | Tạo thành công | High |
| TC-CH-024 | Trùng tên loại hàng | Có "Cát xây dựng" | Tạo lại → Lưu | Lỗi trùng lặp | High |

### 5.11 Bảng giá cước (TC-CH-025 → TC-CH-026)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-025 | Tạo bảng giá | Có tuyến + loại hàng | Chọn tuyến + hàng, giá 5M, per_trip → Lưu | Tạo thành công | High |
| TC-CH-026 | Trùng bộ 3 | Có giá (Tuyến A, Hàng X, per_trip) | Tạo cùng bộ 3 → Lưu | Lỗi trùng lặp | High |

### 5.12 Phí quản lý (TC-CH-027 → TC-CH-028)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-027 | Tạo phí QL | ADMIN | Nhập "Phí QL chung", 5% → Lưu | Tạo thành công | High |
| TC-CH-028 | Tỷ lệ > 100% | ADMIN | Nhập 150% → Lưu | Lỗi validation | High |

### 5.13 Phân quyền xuyên suốt (TC-CH-029 → TC-CH-030)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-029 | MANAGER không xóa | MANAGER | Vào sub-page bất kỳ | Nút xóa bị ẩn/vô hiệu | High |
| TC-CH-030 | ACCOUNTANT chỉ đọc | ACCOUNTANT | Vào sub-page bất kỳ | Không có nút Tạo/Sửa/Xóa | High |

### 5.14 Lịch sử giá nhiên liệu (TC-CH-031 → TC-CH-034)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CH-031 | Cập nhật giá → ghi lịch sử | ADMIN, `/config/fuel` | Đổi đơn giá từ 28.760 → 27.650 → Lưu | Bảng lịch sử hiện dòng mới: 27.650 VNĐ, ngày hôm nay, người thay đổi | High |
| TC-CH-032 | Append-only — không sửa/xóa | Có lịch sử giá | Thử sửa/xóa dòng trong bảng lịch sử | Không có nút sửa/xóa, chỉ đọc | High |
| TC-CH-033 | Đề xuất giá trên chuyến | Có lịch sử: 28.760 (1/5), 27.650 (15/5) | Mở form nhập liệu chuyến, ngày xuất phát 20/5 → nhấn **Đề xuất** | Tự điền 27.650 (giá hiệu lực gần nhất trước 20/5) | High |
| TC-CH-034 | Giá cấu hình đồng bộ dòng mới nhất | Có lịch sử 3 dòng | Xem giá cấu hình hiện tại | Giá cấu hình = giá dòng cuối cùng trong lịch sử | High |
