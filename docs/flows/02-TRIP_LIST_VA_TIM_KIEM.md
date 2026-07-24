# Danh sách Chuyến đi & Tìm kiếm

> Tài liệu QA testing & Hướng dẫn sử dụng — Danh sách chuyến đi
> **Route:** `/trips`
> **Roles:** ADMIN, MANAGER (đầy đủ), ACCOUNTANT (xem + tài chính), DRIVER (chỉ chuyến mình)

---

## 1. Tổng quan

### 1.1 Mô tả

Trang danh sách chuyến đi — xem, tìm kiếm, lọc trạng thái, sắp xếp, xuất CSV. Màn hình chính theo dõi toàn bộ hoạt động vận tải.

### 1.2 Thành phần

| Thành phần | Mô tả |
|-----------|--------|
| Header | Tiêu đề "Chuyến đi" + nút Xuất CSV + nút Tạo chuyến |
| Hero Metrics | 4 KPI: Tổng chuyến, Đang chạy, Hoàn thành, Doanh thu |
| Thanh tìm kiếm | Tìm theo mã chuyến, tuyến, khách hàng, lái xe |
| Status Pills | 6 nút: Tất cả, Đã tạo, Đang chạy, Hoàn thành, Đã khóa, Đã hủy |
| Bảng dữ liệu | Mã chuyến, Tuyến, Khách hàng, Xe, Lái xe, Trạng thái, Tổng tiền, Ngày tạo, Actions |
| Phân trang | 10 dòng/trang |

### 1.3 Phân quyền

| Role | Xem | Xem tài chính | Tạo | Sửa | Xóa | Xuất CSV |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| ADMIN | ✅ | ✅ | ✅ | ✅ (trừ LOCKED) | ✅ (chỉ CREATED) | ✅ |
| MANAGER | ✅ | ✅ | ✅ | ✅ (trừ LOCKED) | ✅ (chỉ CREATED) | ✅ |
| ACCOUNTANT | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| DRIVER | Chỉ mình | ❌ | ❌ | Giới hạn | ❌ | ❌ |

### 1.4 API Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/trips` | Danh sách chuyến (ADMIN/MANAGER/ACCT: tất cả, DRIVER: chỉ mình) |
| GET | `/api/trips/stats` | Thống kê KPI |
| GET | `/api/trips/:id` | Chi tiết chuyến |
| DELETE | `/api/trips/:id` | Xóa (chỉ CREATED) |

---

## 2. Hướng dẫn sử dụng

### 2.1 Hero Metrics

4 KPI cards:

| KPI | Màu | Công thức |
|-----|-----|-----------|
| Tổng chuyến | Xanh dương | COUNT tất cả |
| Đang chạy | Vàng | COUNT IN_TRANSIT |
| Hoàn thành | Xanh lá | COUNT COMPLETED |
| Doanh thu | Tím | SUM grandTotal của COMPLETED + LOCKED |

### 2.2 Tìm kiếm

Gõ vào ô tìm kiếm → lọc real-time theo: mã chuyến, tuyến (origin → destination), tên KH, tên lái xe, số container. Không phân biệt hoa/thường. Bấm X để xóa.

### 2.3 Lọc trạng thái

6 pills: Tất cả, Đã tạo, Đang chạy, Hoàn thành, Đã khóa, Đã hủy. Kết hợp được với tìm kiếm. Chuyển về "Tất cả" để bỏ lọc.

### 2.4 Sắp xếp

Click header **Ngày tạo** hoặc **Tổng tiền** để sort. Click lại đảo chiều. Chỉ 1 cột sort tại 1 thời điểm.

### 2.5 Xuất CSV

Bấm "Xuất CSV" → tải `chuyen-di-YYYY-MM-DD.csv`. File chứa dữ liệu đang hiển thị (sau lọc). Có BOM UTF-8 cho Excel.

### 2.6 Cảnh báo nhiên liệu ⚠️

Icon ⚠️ hiện khi `(fuelAmount / distance) * 100 > 8.5` L/100km. Hover xem chi tiết mức tiêu thụ.

### 2.7 Actions

| Action | Điều kiện |
|--------|-----------|
| Xem (Eye) | Luôn hiện |
| Sửa (Pencil) | ADMIN/MANAGER + chưa LOCKED |
| Xóa (Trash) | ADMIN/MANAGER + trạng thái CREATED |

---

## 3. Luồng nghiệp vụ

```
Tạo chuyến mới → Xuất hiện trạng thái CREATED
    │
    ├─ Lọc "Đã tạo" → Xử lý chuyến → Đổi sang IN_TRANSIT
    ├─ Lọc "Đang chạy" → Theo dõi → COMPLETED khi giao xong
    ├─ Lọc "Hoàn thành" → Kiểm tra → LOCKED khi chốt sổ
    └─ Xóa chuyến lỗi (chỉ CREATED)
```

**Doanh thu:** Chỉ tính COMPLETED + LOCKED. CREATED/IN_TRANSIT/CANCELLED không tính.

**Cảnh báo nhiên liệu:** Quét danh sách → thấy ⚠️ → vào chi tiết kiểm tra lại.

---

## 4. Bảng tra cứu

### 4.1 Trạng thái & Màu

| Status | Label | Badge màu |
|--------|-------|-----------|
| CREATED | Đã tạo | Xanh dương |
| IN_TRANSIT | Đang chạy | Vàng |
| COMPLETED | Hoàn thành | Xanh lá |
| LOCKED | Đã khóa | Xám |
| CANCELLED | Đã hủy | Đỏ |

### 4.2 Cột Tổng tiền

| Điều kiện | Hiển thị |
|-----------|----------|
| ADMIN/MANAGER/ACCOUNTANT | Hiện cột, format VND |
| DRIVER | Ẩn cột hoàn toàn |
| Có items | Σ item.totalPrice |
| Không items, có customerRate + distance | customerRate × distance |
| Null | "-" |

### 4.3 Phân trang

- PAGE_SIZE = 10 (cố định)
- Tự reset về trang 1 khi đổi filter/search
- Text: "Hiển thị X–Y / Z chuyến"

---

## 5. QA Test Checklist

### 5.1 Hiển thị & KPI (TC-TS-001 → TC-TS-007)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-001 | Trang tải đầy đủ | MANAGER, 5+ chuyến | Mở `/trips` | Header + 4 KPI + Search + 6 Pills + Bảng + Pagination | High |
| TC-TS-002 | Đúng 7 cột bảng | MANAGER | Kiểm tra header | Các cột gộp theo thiết kế | High |
| TC-TS-003 | Tổng chuyến đúng | 15 chuyến DB | Xem KPI | Hiển thị 15, màu xanh dương | High |
| TC-TS-004 | Đang chạy đúng | 3 IN_TRANSIT | Xem KPI | Hiển thị 3, màu vàng | High |
| TC-TS-005 | Hoàn thành đúng | 7 COMPLETED | Xem KPI | Hiển thị 7, màu xanh lá | High |
| TC-TS-006 | Doanh thu đúng | 2 COMPLETED (10M+15M) + 1 LOCKED (8M) | Xem KPI | 33,000,000 ₫, màu tím | High |
| TC-TS-007 | CREATED không tính DT | 1 CREATED (5M) | Xem Doanh thu | Không chứa 5M từ CREATED | High |

### 5.2 Lọc trạng thái (TC-TS-008 → TC-TS-013)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-008 | Lọc Đang chạy | Nhiều trạng thái | Click pill "Đang chạy" | Chỉ hiện IN_TRANSIT, pill highlight | High |
| TC-TS-009 | Lọc Hoàn thành | Có COMPLETED | Click pill "Hoàn thành" | Chỉ hiện COMPLETED | High |
| TC-TS-010 | Lọc Đã khóa | Có LOCKED | Click pill "Đã khóa" | Chỉ hiện LOCKED | High |
| TC-TS-011 | Lọc Đã hủy | Có CANCELLED | Click pill "Đã hủy" | Chỉ hiện CANCELLED | High |
| TC-TS-012 | Lọc Đã tạo | Có CREATED | Click pill "Đã tạo" | Chỉ hiện CREATED | High |
| TC-TS-013 | Bỏ lọc | Đang lọc | Click "Tất cả" | Hiện lại toàn bộ | High |

### 5.3 Tìm kiếm (TC-TS-014 → TC-TS-020)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-014 | Tìm theo mã | Có "TRIP-001" | Gõ "TRIP-001" | Chỉ hiện TRIP-001 | High |
| TC-TS-015 | Tìm theo tuyến | Có chuyến → "Đà Nẵng" | Gõ "Đà Nẵng" | Hiện đúng chuyến | High |
| TC-TS-016 | Tìm theo KH | Có KH "Công ty ABC" | Gõ "Công ty ABC" | Hiện đúng chuyến | High |
| TC-TS-017 | Tìm theo lái xe | Có TX "Nguyễn Văn A" | Gõ "Nguyễn Văn A" | Hiện đúng chuyến | High |
| TC-TS-018 | Không kết quả | Không có "ZZZZZ" | Gõ "ZZZZZ" | Bảng trống, thông báo | Medium |
| TC-TS-019 | Xóa tìm kiếm | Đang tìm | Click X | Hiện lại toàn bộ | Medium |
| TC-TS-020 | Tìm + Lọc kết hợp | Dữ liệu đa dạng | Gõ "ABC" + pill "Hoàn thành" | Kết quả khớp cả hai | High |

### 5.4 Phân trang & Sắp xếp (TC-TS-021 → TC-TS-026)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-021 | Phân trang | 25 chuyến | Xem trang 1, chuyển trang 2 | Mỗi trang ≤ 10 dòng | High |
| TC-TS-022 | Trang cuối | 25 chuyến | Trang 3 | Đúng 5 dòng, text "21–25 / 25" | Medium |
| TC-TS-023 | Reset trang khi đổi filter | Đang trang 2 | Đổi pill/search | Tự về trang 1 | High |
| TC-TS-024 | Sort theo ngày | Nhiều chuyến | Click "Ngày tạo" | Sắp xếp đúng, mũi tên hiện | High |
| TC-TS-025 | Sort theo tổng tiền | Nhiều chuyến | Click "Tổng tiền" | Sắp xếp đúng, mũi tên ở cột Tổng tiền | High |
| TC-TS-026 | Sort mutual exclusive | Đang sort Tổng tiền | Click "Ngày tạo" | Mũi tên chuyển sang Ngày tạo | Medium |

### 5.5 Xuất CSV (TC-TS-027 → TC-TS-029)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-027 | Xuất CSV thành công | MANAGER, có dữ liệu | Click "Xuất CSV" | File CSV tải về, có BOM UTF-8, 8 cột | High |
| TC-TS-028 | CSV chỉ xuất dữ liệu đã lọc | Lọc "Hoàn thành", 5 kết quả | Xuất CSV | Chỉ chứa 5 chuyến hoàn thành | High |
| TC-TS-029 | CSV disabled khi trống | Danh sách trống | Kiểm tra nút | Nút disabled | Medium |

### 5.6 Xóa & Sửa (TC-TS-030 → TC-TS-034)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-030 | Xóa CREATED thành công | MANAGER, có CREATED | Click Xóa → Xác nhận | Chuyến biến mất | High |
| TC-TS-031 | Hủy xóa | MANAGER | Click Xóa → Hủy | Dialog đóng, chuyến còn | Medium |
| TC-TS-032 | Chỉ xóa CREATED | Có IN_TRANSIT, COMPLETED... | Kiểm tra Actions | Không hiện icon Xóa | High |
| TC-TS-033 | API chặn xóa không CREATED | ADMIN | DELETE /api/trips/:id IN_TRANSIT | 400 "Chỉ xóa CREATED" | High |
| TC-TS-034 | Không hiện sửa LOCKED | Có LOCKED | Kiểm tra Actions | Không hiện icon Sửa | High |

### 5.7 Cảnh báo nhiên liệu (TC-TS-035 → TC-TS-037)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-035 | Vượt ngưỡng 8.5 | 500km, 50L (10 L/100km) | Xem Actions | Icon ⚠️, hover hiện tooltip | High |
| TC-TS-036 | Dưới ngưỡng | 500km, 30L (6 L/100km) | Xem Actions | Không hiện ⚠️ | Medium |
| TC-TS-037 | Thiếu dữ liệu | Null distance/fuelAmount | Xem Actions | Không hiện ⚠️ | Medium |

### 5.8 Phân quyền (TC-TS-038 → TC-TS-045)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-038 | Click mã chuyến | MANAGER | Click mã chuyến | Chuyển đến /trips/:id | High |
| TC-TS-039 | Click icon Eye | MANAGER | Click Eye | Chuyển đến /trips/:id | High |
| TC-TS-040 | Click icon Sửa | MANAGER, chưa LOCKED | Click Pencil | Chuyển đến /trips/:id/edit | High |
| TC-TS-041 | DRIVER chỉ xem mình | DRIVER, 3/20 chuyến | Mở /trips | Chỉ 3 chuyến của mình | High |
| TC-TS-042 | DRIVER không thấy Tổng tiền | DRIVER | Xem header | Không có cột Tổng tiền | High |
| TC-TS-043 | DRIVER không thấy Tạo/Xuất | DRIVER | Xem header | Không có 2 nút | High |
| TC-TS-044 | DRIVER không thấy Xóa | DRIVER | Xem Actions | Không icon Trash | High |
| TC-TS-045 | ACCOUNTANT chỉ xem | ACCOUNTANT | Xem trang | Không nút Tạo/Sửa/Xóa, có Tổng tiền | High |

### 5.9 Edge Cases (TC-TS-046 → TC-TS-050)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TS-046 | Format VND đúng | grandTotal = 15000000.5 | Xem cột Tổng tiền | "15,000,000.5 ₫" | Medium |
| TC-TS-047 | Format ngày đúng | createdAt "2026-05-15T08:30Z" | Xem cột Ngày tạo | Định dạng vi-VN | Medium |
| TC-TS-048 | Badge đúng màu | 5 trạng thái | Xem cột Trạng thái | Màu đúng bảng tra cứu | Medium |
| TC-TS-049 | Danh sách trống | DB không có chuyến | Mở /trips | "Chưa có chuyến đi nào", KPI = 0 | Medium |
| TC-TS-050 | DRIVER xem chuyến người khác | DRIVER (lái xe A) | GET /api/trips/:id (lái xe B) | 403 Forbidden | High |
