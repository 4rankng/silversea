# Phân bổ Lợi nhuận

> Tài liệu QA testing & Hướng dẫn sử dụng — Báo cáo P&L, Cap Table, Phân bổ lợi nhuận theo quý
> **Route:** `/profit`
> **Roles:** ADMIN, MANAGER (ACCOUNTANT chỉ xem P&L, không phân bổ; DRIVER không truy cập)

---

## 1. Tổng quan

### 1.1 Mô tả

Trang Phân bổ Lợi nhuận cho phép xem báo cáo Kết quả Kinh doanh (KQKD) theo tháng, bảng tỷ lệ vốn (cap table), và phân bổ lợi nhuận theo quý.

### 1.2 Phân quyền

| Vai trò | Xem P&L | Xem Cap Table | Phân bổ lợi nhuận | Quản lý Cap Table |
|---------|:-------:|:-------------:|:------------------:|:-----------------:|
| ADMIN | ✅ | ✅ | ✅ | ✅ |
| MANAGER | ✅ | ✅ | ✅ | ✅ |
| ACCOUNTANT | ✅ | ✅ | ❌ (403) | ❌ |
| DRIVER | ❌ | ❌ | ❌ | ❌ |

### 1.3 API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/reports/pnl?month=X&year=Y` | JWT + financial:read | Báo cáo KQKD |
| `GET` | `/api/cap-table` | JWT + config:read | Danh sách đối tác |
| `POST` | `/api/cap-table` | JWT + config:write | Thêm đối tác |
| `PUT` | `/api/cap-table/:id` | JWT + config:write | Cập nhật đối tác |
| `DELETE` | `/api/cap-table/:id` | JWT + config:write | Xóa đối tác |
| `POST` | `/api/reports/distribute-profit` | JWT + financial:write (ADMIN/MANAGER only) | Phân bổ lợi nhuận |

### 1.4 Công thức

```
Doanh thu = customer_price / (1 + vatRate) — ex-VAT
Chi phí = tổng các khoản chi — incl. VAT (không trừ VAT đầu vào)
Lợi nhuận gộp = Doanh thu (ex-VAT) − Chi phí (incl. VAT)
Lợi nhuận ròng = Lợi nhuận gộp − Phí quản lý + Thu nhập khác
Phân bổ mỗi đối tác = Lợi nhuận ròng × Tỷ lệ (%)
```

---

## 2. Hướng dẫn sử dụng

### 2.1 Xem báo cáo P&L

1. Chọn **Tháng** (1-12) và **Năm** từ bộ lọc
2. Trang hiển thị: Doanh thu, Chi phí, LN gộp, Phí quản lý, Thu nhập khác, LN ròng
3. Chỉ tính chuyến **LOCKED** trong tháng đã chọn

### 2.2 Xem Cap Table

- Card grid hiển thị: Tên đối tác, Avatar, Tỷ lệ (%), Số tiền tính được
- Badge "Đối tác chính" cho đối tác có tỷ lệ cao nhất
- Seed data: Phan Thị Phụng (70.45%), Nguyễn Văn Thương (29.55%)

### 2.3 Phân bổ lợi nhuận

1. Chọn **Quý** (1-4) và **Năm**
2. Nhấn **"Chốt & phân bổ"**
3. Xác nhận dialog
4. Kết quả: bảng chi tiết mỗi đối tác + số tiền

### 2.4 Phân chia lợi nhuận theo xe (truck_profit_distribution) (A7)

Ngoài phân chia cổ tức tổng công ty theo `capTableHistory` (§4.8 PRODUCT-SPECS), hệ thống hỗ trợ **phân chia lợi nhuận ròng cho nhà đầu tư góp vốn vào từng xe cụ thể**. Bản chất: "góp vốn theo xe" = đầu tư trên tài sản cụ thể, nhà đầu tư sở hữu một phần lợi nhuận ròng sinh ra từ chính xe đó.

**Phân biệt 2 dòng tiền độc lập:**

| Dòng tiền | Bảng / Module | Đối tượng | Cách chia |
|-----------|---------------|-----------|-----------|
| Cổ tức cổ đông tổng công ty | `capTableHistory` (§2.2) | Tất cả cổ đông | Theo tỷ lệ sở hữu toàn công ty |
| Cổ tức nhà đầu tư theo xe | `truck_profit_distribution` (§2.4) | Nhà đầu tư góp vốn vào 1 xe | Theo `share_pct` của riêng xe đó |

Một cá nhân có thể vừa là cổ đông công ty (capTable) vừa là nhà đầu tư riêng cho 1 xe (truck_profit_distribution) — hai dòng tiền tách bạch, không cộng dồn.

**Cấu hình `truck_profit_distribution`:**

| Trường | Mô tả |
|--------|-------|
| `truck_id` | FK → xe đầu kéo |
| `partner_id` | FK → forwarders/partners (nullable: 1 nhà đầu tư có thể góp nhiều xe) |
| `period` | Tháng/quý |
| `gross_profit` | Lãi gộp của xe trong kỳ |
| `net_profit` | Lãi ròng của xe trong kỳ (sau chi phí vận hành theo xe) |
| `share_pct` | Tỷ lệ % nhà đầu tư được hưởng trên xe (decimal 5,2) |
| `amount` | Số tiền thực nhận = `net_profit × share_pct / 100` |
| `status` | `DRAFT` / `CONFIRMED` |

**Tách bạch chi phí vận hành theo xe (không gộp vào cổ tức tổng):**
- Chi phí sửa chữa, bảo dưỡng, lốp, bảo hiểm, đăng kiểm, phí đường bộ **của riêng xe đó** → trừ vào `gross_profit` xe → ra `net_profit` xe.
- Cổ tức cổ đông tổng công ty (capTable) chia từ **LN ròng toàn công ty** (đã trừ chi phí chung) — KHÔNG trừ thêm chi phí theo xe.

**Luồng nghiệp vụ:**

1. ADMIN/MANAGER mở `/profit` → tab **"Phân chia theo xe"**.
2. Chọn **Kỳ** (tháng/quý) + **Năm**.
3. Hệ thống tính `gross_profit` và `net_profit` cho từng xe trong kỳ (từ chuyến LOCKED + phiếu chi phí theo xe).
4. Với mỗi xe có `truck_profit_distribution` cấu hình, hiển thị `share_pct` × `net_profit` = `amount`.
5. ADMIN/MANAGER nhấn **"Chốt & phân bổ"** → tạo bản ghi `truck_profit_distribution` với `status='CONFIRMED'` (bất biến, không sửa).

---

## 3. Luồng nghiệp vụ

### 3.1 Xem P&L

```
Chọn Tháng/Năm → GET /api/reports/pnl?month=X&year=Y
→ Tính từ chuyến LOCKED trong tháng
→ revenue = customer_price / (1 + vatRate) — ex-VAT
→ costs = tổng chi phí — incl. VAT
→ grossProfit = revenue (ex-VAT) − costs (incl. VAT)
→ netProfit = grossProfit − managementFee + otherIncome
→ Response: { period, totalRevenue, totalCosts, grossProfit, managementFee, otherIncome, netProfit, tripCount, trucks[] }
```

### 3.2 Phân bổ lợi nhuận

```
Chọn Quý/Năm → "Chốt & phân bổ" → Confirm
→ POST /api/reports/distribute-profit { quarter, year }
→ Kiểm tra role: chỉ ADMIN/MANAGER (ACCOUNTANT → 403)
→ Lấy cap table → tính gross profit quý → phân bổ theo %
→ INSERT vào bảng distributions
→ Response: { quarter, year, netProfit, distributions[] }
```

---

## 4. Bảng tra cứu

### 4.1 GET /api/reports/pnl

**Query:** month (1-12), year (defaults current year)
**Response:**
```json
{ "period": { "month": 5, "year": 2026 },
  "totalRevenue": 150000000, "totalCosts": 95000000,
  "grossProfit": 55000000, "managementFee": 5000000,
  "otherIncome": 2000000, "netProfit": 52000000,
  "tripCount": 24,
  "trucks": [{ "plate": "51C-12345", "revenue": 30000000, "costs": 18000000, "profit": 12000000, "trips": 5 }] }
```

### 4.2 POST /api/reports/distribute-profit

**Request:** `{ "quarter": 1, "year": 2026 }`
**Response:**
```json
{ "quarter": 1, "year": 2026, "netProfit": 156000000,
  "distributions": [
    { "quarter": 1, "year": 2026, "partnerName": "Phan Thị Phụng", "amount": 109902000 },
    { "quarter": 1, "year": 2026, "partnerName": "Nguyễn Văn Thương", "amount": 46098000 } ] }
```

### 4.3 Cap Table Schema

| Trường | Ràng buộc |
|--------|-----------|
| partner_name | Bắt buộc, min 1 |
| percentage | 0–100 |
| effective_date | Bắt buộc |

---

## 5. QA Test Checklist

### 5.1 P&L Report

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-PL-001 | P&L tháng có dữ liệu | ADMIN, có chuyến locked | Chọn tháng 5/2026 | Hiển thị đầy đủ: revenue, costs, profit, managementFee, otherIncome | High |
| TC-PL-002 | P&L tháng rỗng | ADMIN | Chọn tháng không có dữ liệu | Tất cả giá trị = 0, không crash | High |
| TC-PL-003 | P&L chỉ tính locked | Có chuyến unlocked + locked | Xem P&L | Chỉ tính chuyến locked | High |
| TC-PL-004 | P&L công thức đúng | revenue=100M, costs=60M, fee=5M, other=2M | Xem P&L | grossProfit=40M, netProfit=37M | High |
| TC-PL-005 | P&L chi tiết theo xe | Nhiều xe hoạt động | Xem trucks[] | Mỗi xe: plate, revenue, costs, profit, trips | Medium |
| TC-PL-006 | P&L DRIVER bị chặn | DRIVER | Gọi GET /api/reports/pnl | 403 Forbidden | High |
| TC-PL-007 | P&L ACCOUNTANT xem được | ACCOUNTANT | Gọi GET /api/reports/pnl | 200 OK | High |
| TC-PL-008 | P&L thiếu month | ADMIN | Gọi không có month | Lỗi 400 | Medium |

### 5.2 Cap Table

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CT-001 | Hiển thị cap table mặc định | Seed data chưa thay đổi | Xem trang /profit | 2 đối tác: Phụng 70.45%, Thương 29.55% | High |
| TC-CT-002 | Badge đối tác chính | Phụng 70.45% cao nhất | Xem card grid | Chỉ Phụng có badge "Đối tác chính" | Medium |
| TC-CT-003 | Tính phân bổ | netProfit=100M | Xem card | Phụng: 70.45M, Thương: 29.55M, tổng ≈ 100M | High |
| TC-CT-004 | Thêm đối tác | ADMIN | POST { partner_name, percentage, effective_date } | 201 Created | High |
| TC-CT-005 | Thêm percentage > 100 | ADMIN | POST percentage=150 | Lỗi 400 validation | Medium |
| TC-CT-006 | Sửa tỷ lệ | ADMIN | PUT /api/cap-table/:id { percentage: 35 } | 200 OK | Medium |
| TC-CT-007 | Xóa đối tác | ADMIN | DELETE /api/cap-table/:id | 200 OK | Medium |

### 5.3 Phân bổ lợi nhuận

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-PB-001 | Phân bổ Q1 hợp lệ | ADMIN, có locked trips Q1 | POST { quarter:1, year:2026 } | 200, distributions có 2 đối tác, số tiền đúng | High |
| TC-PB-002 | ACCOUNTANT bị từ chối | ACCOUNTANT | POST distribute-profit | 403: chỉ ADMIN/MANAGER | High |
| TC-PB-003 | MANAGER phân bổ được | MANAGER | POST distribute-profit | 200 OK | High |
| TC-PB-004 | Quý không có chuyến | ADMIN | POST Q không có locked | netProfit=0, distributions amount=0 | Medium |
| TC-PB-005 | Quarter ngoài phạm vi | ADMIN | POST quarter=5 | Lỗi 400 | Medium |
| TC-PB-006 | Thiếu quarter | ADMIN | POST chỉ có year | Lỗi 400 | Medium |
| TC-PB-007 | Confirm dialog | ADMIN | Nhấn "Chốt & phân bổ" | Hiển thị dialog, Hủy không gọi API | Medium |
| TC-PB-008 | DRIVER bị chặn | DRIVER | POST distribute-profit | 403 Forbidden | High |
| TC-PB-009 | Phân bổ 3 đối tác | Cap table 3 đối tác | POST distribute-profit | 3 distributions, tổng = netProfit | High |
| TC-PB-010 | Phân bổ lặp cùng quý | Đã phân bổ Q1 | POST lại Q1 | Kiểm tra behavior (ghi đè hoặc lỗi) | Medium |

---

## 6. Ghi chú & Lưu ý

- **ACCOUNTANT bị chặn ở service layer** — dù Casbin cho phép financial:write, service kiểm tra role cụ thể và từ chối ACCOUNTANT
- **Chỉ tính chuyến LOCKED** — chuyến COMPLETED chưa chốt không xuất hiện trong P&L
- **Phân bổ theo quý** — Q1: T1-T3, Q2: T4-T6, Q3: T7-T9, Q4: T10-T12
- **Cap table tổng % nên ≈ 100%** — hệ thống không enforce, cần kiểm tra thủ công
- **Distributions immutable** — bản ghi phân bổ lưu vĩnh viễn vào bảng distributions
