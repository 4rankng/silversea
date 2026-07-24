# Vòng đời Chuyến đi (Trip Lifecycle)

> Tài liệu QA testing & Hướng dẫn sử dụng — Toàn bộ vòng đời chuyến đi
> **Routes:** `/trips`, `/trips/:id`, `/trips/:id/edit`
> **Roles:** ADMIN, MANAGER (full CRUD), ACCOUNTANT (view + financials), DRIVER (own trips only)

---

## 1. Tổng quan

### 1.1 Mô tả

Module Chuyến đi quản lý toàn bộ vòng đời vận tải: tạo → xuất phát → hoàn thành → khóa sổ. Là module trung tâm kết nối tất cả module khác (tài chính, xe, lái xe, khách hàng).

### 1.2 Vòng đời trạng thái

```
CREATED → IN_TRANSIT → COMPLETED → LOCKED
   │
   └─→ CANCELLED (từ CREATED, IN_TRANSIT, hoặc COMPLETED)
```

**LOCKED = không thể sửa** — chốt sổ tài chính.
**CANCELLED** có thể từ CREATED, IN_TRANSIT, hoặc COMPLETED (không từ LOCKED).

### 1.3 Phân quyền

| Hành động | ADMIN | MANAGER | ACCOUNTANT | DRIVER |
|-----------|:-----:|:-------:|:----------:|:------:|
| Xem tất cả chuyến | ✅ | ✅ | ✅ | ❌ (chỉ mình) |
| Tạo chuyến | ✅ | ✅ | ❌ | ❌ |
| Sửa thông tin cấu trúc (tuyến, xe, lái xe) trên CREATED | ✅ | ✅ | ❌ | ❌ |
| Đổi khách hàng trên CREATED/IN_TRANSIT; COMPLETED chưa thanh toán | ✅ | ✅ | ❌ | ❌ |
| Sửa số liệu tài chính (nhiên liệu, tiền đi đường, vé, lương lái xe) trên IN_TRANSIT/COMPLETED | ✅ | ✅ | ✅ | ❌ |
| Xóa (chỉ CREATED) | ✅ | ✅ | ❌ | ❌ |
| Xem tài chính | ✅ | ✅ | ✅ | ❌ |

> Phân biệt rõ "sửa thông tin cấu trúc" (chỉ manager/admin, chỉ trên CREATED) và "sửa số liệu tài chính" (manager/admin + kế toán, trên IN_TRANSIT/COMPLETED). Đổi khách hàng là ngoại lệ nghiệp vụ: manager/admin được đổi ở CREATED/IN_TRANSIT, hoặc COMPLETED khi chưa thanh toán; hệ thống ghi bút toán hoàn tác và ghi lại công nợ cho khách mới. Backend đã luôn cho phép kế toán ghi số liệu tài chính (RBAC `trips:write` + `updateTripFigures` chỉ chặn LOCKED/CANCELED) — chi tiết xem `CONTEXT.md` và use case test `T4.10` trong `backend/src/tests/integration.test.ts`.

### 1.4 API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | `/api/trips` | JWT + trips:read | Danh sách (DRIVER chỉ thấy mình) |
| GET | `/api/trips/stats` | JWT + trips:read | KPI thống kê |
| GET | `/api/trips/:id` | JWT + trips:read | Chi tiết (DRIVER chỉ xem mình) |
| POST | `/api/trips` | JWT + trips:create | Tạo chuyến mới |
| PUT | `/api/trips/:id` | JWT + trips:update | Cập nhật (DRIVER giới hạn) |
| DELETE | `/api/trips/:id` | JWT + trips:delete | Xóa (chỉ CREATED) |

---

## 2. Hướng dẫn sử dụng

### 2.1 Tạo chuyến mới (`POST /api/trips`)

1. Từ trang danh sách `/trips` → nhấn **"Tạo chuyến"**
2. Điền form:
   - **Khách hàng** (dropdown từ danh sách KH active)
   - **Tuyến đường** (dropdown từ danh sách tuyến)
   - **VAT Rate** (tỷ lệ thuế, mặc định 8% hoặc 10%)
   - **Chế độ điều xe**: Chọn **Xe nhà** (OWN) hoặc **Xe ngoài** (EXTERNAL)
     - *Nếu Xe nhà*: Chọn **Xe đầu kéo** (ACTIVE) và **Lái xe**.
     - *Nếu Xe ngoài*: Chọn **Đối tác vận chuyển** (NCC), nhập **Giá cước thuê ngoài (gồm VAT)**, **Biển số xe**, **Tên lái xe**, **SĐT lái xe**.
   - **Ngày xuất phát** (date picker)
   - **Ngày dự kiến đến** (date picker)
   - **Loại hàng** (tùy chọn)
   - **Ghi chú** (tùy chọn)
3. **Giá cước tự động điền** dựa trên cặp (KH + tuyến) từ bảng giá cước
4. **Hoa hồng chi KH** (`customerCommission`): kế toán nhập tay khoản chiết khấu/hoa hồng thương mại cho khách hàng (không theo công thức). Ghi nhận ngay khi nhập, không đợi khóa chuyến. **Doanh thu thực tế = freightExVat − customerCommission.** *(Pete xác nhận 12/6)*
5. **Lương chuyến quy đổi** (`driver_salary`): hệ thống **tự động điền** khi chọn lái xe + nhập ngày đi/về, theo công thức `baseSalary / 26 × tripWageDays`; BHXH được hạch toán riêng. Kế toán có thể sửa/ghi đè số tiền hoặc điều chỉnh `trip_wage_days`. Hành vi tương tự chi phí xăng dầu, vé cầu đường — tự điền, cho phép sửa. Chỉ áp dụng cho **Xe nhà** (OWN). *(Pete xác nhận 12/6)*
6. **Số ngày tính lương** (`trip_wage_days`): hệ thống tự tính từ `daysBetween(departure, arrival) + 1`. Kế toán có thể ghi đè khi chuyến kéo dài xuyên ngày nghỉ.
7. Nhấn **"Lưu"** → chuyến tạo ở trạng thái CREATED

### 2.2 Chỉnh sửa chuyến (PUT /api/trips/:id)

**Trước khi xuất phát (CREATED):** Manager/Admin sửa được mọi trường. Kế toán không sửa (chỉ manager/admin tạo + chỉnh cấu trúc).
**Đang chạy (IN_TRANSIT):** Manager/Admin có thể đổi khách hàng; Manager/Admin + Kế toán sửa được số liệu tài chính (nhiên liệu, tiền đi đường, vé, lương lái xe). Đổi khách hàng không tự cập nhật giá cước. Nút "Nhập số liệu" hiển thị cho cả hai role.
**Hoàn thành (COMPLETED):** Manager/Admin có thể đổi khách hàng khi chuyến chưa phát sinh thanh toán; Manager/Admin + Kế toán sửa được số liệu tài chính. Khi đổi khách hàng, hệ thống hoàn tác công nợ của khách cũ và ghi nhận cho khách mới bằng các bút toán bổ sung, không sửa sổ cái và không tự cập nhật giá cước. Manager/Admin thấy nút "Chỉnh sửa", kế toán thấy nút "Nhập số liệu" (cùng form, cùng endpoint `PUT /actuals`).
**Đã khóa (LOCKED):** KHÔNG sửa được — nút Sửa bị ẩn.

**DRIVER chỉ sửa được:** status, actualArrival trên chuyến của mình.

### 2.3 Chuyển trạng thái

| Từ → Đến | Điều kiện | Ai thực hiện |
|----------|-----------|-------------|
| CREATED → IN_TRANSIT | Xe + lái xe đã gán | ADMIN/MANAGER |
| IN_TRANSIT → COMPLETED | actualArrival đã nhập | ADMIN/MANAGER/DRIVER |
| COMPLETED → LOCKED | Chi phí đầy đủ | ADMIN/MANAGER |
| CREATED/IN_TRANSIT/COMPLETED → CANCELLED | Lý do hủy | ADMIN/MANAGER |

> **Lưu ý 409 (A3.2):** Khi hai người dùng cùng chuyển trạng thái / nhập số liệu tài chính trên cùng chuyến, API trả 409. UI phải hiển thị thông báo "Dữ liệu đã thay đổi — tải lại" thay vì âm thầm nuốt lỗi. Xem chi tiết ở §2.5.

### 2.4 Hoàn thành chuyến (IN_TRANSIT → COMPLETED) & Khóa chuyến (LOCKED)

**Hoàn thành — chỉ qua nút bấm thủ công:**
- Khi chuyến đã về, ADMIN/MANAGER/DRIVER nhấn nút **"Hoàn thành"** + nhập `actualArrival` → chuyển sang `COMPLETED`.
- **Hệ thống KHÔNG tự động chuyển sang `COMPLETED`** khi kế toán upload ảnh container/seal, khi kết thúc chặng, hay khi đến ngày dự kiến. Upload ảnh chỉ lưu hồ sơ, không tác động trạng thái. (A3.1)
- Việc hoàn thành do người dùng quyết định — tránh trường hợp chuyến bị đánh dấu hoàn thành trong khi xe thực tế chưa về.

**Khóa chuyến — chỉ từ COMPLETED:**
1. Khi chuyến hoàn thành và chi phí đã được xác minh, ADMIN/MANAGER nhấn **"Khóa chuyến"**
2. Hệ thống tính toán `computeTripTotals()` → tạo TRIP_REVENUE ledger
3. Chuyến chuyển sang LOCKED — không thể sửa

### 2.5 Trạng thái concurrent (409 recovery)

Khi hai người dùng cùng chỉnh sửa một chuyến đi (hoặc nhập liệu tài chính), backend sử dụng cơ chế phát hiện xung đột (optimistic concurrency / advisory lock per trip). Khi phát hiện xung đột:

- API trả về HTTP **409 Conflict** với thông báo "Dữ liệu đã thay đổi — tải lại".
- **UI phải hiển thị thông báo rõ ràng** cho người dùng, kèm hành động tải lại dữ liệu mới nhất. Không được âm thầm nuốt lỗi 409 hoặc ghi đè dữ liệu của người khác. (A3.2)
- Người dùng xem lại số liệu mới, áp dụng lại thay đổi của mình rồi ghi lại.

Áp dụng cho: cập nhật số liệu tài chính, chuyển trạng thái, sửa container, đăng ký tạm ứng.

### 2.6 Xóa chuyến

Chỉ xóa được chuyến ở trạng thái **CREATED**. Chuyến IN_TRANSIT, COMPLETED, LOCKED, CANCELLED không thể xóa.

---

## 3. Luồng nghiệp vụ

### 3.1 Luồng tạo & hoàn thành

```
[ADMIN/MANAGER tạo chuyến]
    │
    ▼ CREATED
    │  Chọn KH + Tuyến + Xe + Lái xe
    │  Giá cước tự điền
    │  Hoa hồng chi KH (nhập tay)
    │  Lương chuyến quy đổi tự điền (khi có lái xe + ngày)
    │  trip_wage_days tự tính
    │
    ▼ Nhấn "Xuất phát"
    │
IN_TRANSIT
    │  Lái xe vận chuyển
    │  Cập nhật chi phí thực tế
    │
    ▼ Nhấn "Hoàn thành" + nhập actualArrival
    │
COMPLETED
    │  Kiểm tra chi phí
    │  round2dp() cho mọi tính toán
    │
    ▼ Nhấn "Khóa chuyến"
    │
LOCKED
    │  Tạo TRIP_REVENUE ledger
    │  Không thể sửa
    │  Dữ liệu vào P&L
```

### 3.2 Luồng hủy chuyến

```
CREATED/IN_TRANSIT/COMPLETED → Nhấn "Hủy" → Nhập lý do → CANCELLED
(Locked không thể hủy)
```

### 3.3 Luồng DRIVER

```
DRIVER đăng nhập → Xem chuyến mình →
    ├─ Cập nhật status (IN_TRANSIT → COMPLETED)
    ├─ Nhập actualArrival
    └─ Không sửa tài chính, không xóa
```

### 3.4 Tính toán tài chính

```
computeTripTotals(trip):
  customerFreightExVat = customerFreightInclVat / (1 + vatRate)
  recordedRevenue = customerFreightExVat − customerCommission   // doanh thu thực tế

  Nếu Xe nhà:
    totalExpenses = fuelAmount + tollFees + driverSalary + driverAllowance + ...  // tất cả incl. VAT
    grandTotal = recordedRevenue − totalExpenses + serviceMargin

  Nếu Xe ngoài:
    externalFreightInclVat = externalFreightCost  // giá thuê ngoài đã gồm VAT
    externalMargin = customerFreightExVat − externalFreightInclVat
    grandTotal = externalMargin + serviceMargin

  Nguyên tắc VAT (bất đối xứng):
    Doanh thu = ex-VAT (trừ VAT đầu ra)
    Chi phí   = incl. VAT (giữ nguyên VAT đầu vào, không khấu trừ)
  → Mọi giá trị dùng round2dp()
```

---

## 4. Bảng tra cứu

### 4.1 Trạng thái chuyến

| Status | Label | Màu | Sửa cấu trúc? (manager/admin) | Sửa tài chính? (manager/admin + kế toán) | Xóa? |
|--------|-------|-----|:------------------------------:|:----------------------------------------:|:----:|
| CREATED | Đã tạo | Xanh dương | ✅ | ❌ (kế toán chưa nhập ở trạng thái này) | ✅ |
| IN_TRANSIT | Đang chạy | Vàng | ❌ | ✅ | ❌ |
| COMPLETED | Hoàn thành | Xanh lá | ✅ (manager/admin) | ✅ | ❌ |
| LOCKED | Đã khóa | Xám | ❌ | ❌ | ❌ |
| CANCELLED | Đã hủy | Đỏ | ❌ | ❌ | ❌ |

> Riêng trường khách hàng, ADMIN/MANAGER có thể đổi ở CREATED và IN_TRANSIT, hoặc ở COMPLETED khi chưa có thanh toán; LOCKED/CANCELED không thể sửa.

### 4.2 Chuyển trạng thái hợp lệ

| Từ | Đến được | Không đến được |
|----|----------|----------------|
| CREATED | IN_TRANSIT, CANCELLED | COMPLETED, LOCKED |
| IN_TRANSIT | COMPLETED, CANCELLED | CREATED, LOCKED |
| COMPLETED | LOCKED, CANCELLED | CREATED, IN_TRANSIT |
| LOCKED | (kết thúc) | Tất cả |
| CANCELLED | (kết thúc) | Tất cả |

### 4.3 Validation tạo chuyến

| Trường | Ràng buộc |
|--------|-----------|
| customerName | Tối đa 200 ký tự |
| origin/destination | Tối đa 200 ký tự |
| distance | Số dương |
| customerRate | Số không âm |
| customerCommission | Số không âm, mặc định 0. Ghi nhận ngay, không đợi khóa. |
| driverSalary | Số không âm (OWN only). Hệ thống tự điền `(baseSalary+BHXH)/26×tripWageDays` |
| tripWageDays | Số nguyên dương. Hệ thống tự tính `daysBetween(departure, arrival)+1` |
| fuelAmount | Số không âm |
| status | Default: CREATED |

### 4.4 Mã lỗi

| HTTP | Message | Nguyên nhân |
|------|---------|-------------|
| 400 | "Dữ liệu không hợp lệ" | Validation fail |
| 400 | "Chuyến đã khóa không thể chỉnh sửa" | PUT trên LOCKED |
| 400 | "Chỉ xóa CREATED" | DELETE trên non-CREATED |
| 403 | "Không có quyền xem" | DRIVER xem chuyến khác |
| 404 | "Không tìm thấy chuyến" | ID không tồn tại |

---

## 5. QA Test Checklist

### 5.1 Tạo chuyến (TC-TL-001 → TC-TL-010)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-001 | Tạo chuyến đầy đủ | ADMIN, có KH+tuyến+xe+TX | Điền đủ → Lưu | CREATED, chuyến mới trong danh sách | High |
| TC-TL-002 | Giá cước tự điền | Có bảng giá KH×tuyến | Chọn KH + tuyến | customerRate tự điền đúng | High |
| TC-TL-003 | Không điền KH | ADMIN | Để trống KH → Lưu | Tạo thành công (KH tùy chọn) | Medium |
| TC-TL-004 | Không điền tuyến | ADMIN | Để trống tuyến → Lưu | Tạo thành công hoặc validation | Medium |
| TC-TL-005 | Chọn xe MAINTENANCE | Có xe MAINTENANCE | Chọn xe đó | Không xuất hiện dropdown hoặc lỗi | High |
| TC-TL-006 | ACCOUNTANT không tạo | ACCOUNTANT | Nhấn Tạo chuyến | Không thấy nút Tạo | High |
| TC-TL-007 | DRIVER không tạo | DRIVER | Kiểm tra header | Không thấy nút Tạo | High |
| TC-TL-008 | Tạo → kiểm tra KPI | ADMIN | Tạo chuyến xong | KPI Tổng chuyến +1 | High |
| TC-TL-009 | Ngày xuất phát quá khứ | ADMIN | Chọn ngày qua | Chấp nhận hoặc warning | Low |
| TC-TL-010 | Ghi chú dài | ADMIN | Nhập ghi chú 2000+ ký tự | Validation: tối đa 2000 | Medium |

### 5.2 Chuyển trạng thái (TC-TL-011 → TC-TL-022)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-011 | CREATED → IN_TRANSIT | Chuyến CREATED, có xe+TX | Chuyển status | Thành công, badge vàng | High |
| TC-TL-012 | IN_TRANSIT → COMPLETED | Chuyến IN_TRANSIT | Nhập actualArrival → chuyển | Thành công, badge xanh lá | High |
| TC-TL-013 | COMPLETED → LOCKED | Chuyến COMPLETED | Khóa chuyến | Thành công, badge xám, tạo ledger | High |
| TC-TL-014 | CREATED → CANCELLED | Chuyến CREATED | Hủy + nhập lý do | CANCELLED, badge đỏ | High |
| TC-TL-015 | IN_TRANSIT → CANCELLED | Chuyến IN_TRANSIT | Hủy + nhập lý do | CANCELLED | High |
| TC-TL-016 | COMPLETED → CANCELLED | Chuyến COMPLETED | Hủy + nhập lý do | CANCELLED | Medium |
| TC-TL-017 | LOCKED không hủy | Chuyến LOCKED | Thử hủy | Không thể hủy | High |
| TC-TL-18 | LOCKED không sửa | Chuyến LOCKED | Thử PUT | 400 "đã khóa" | High |
| TC-TL-019 | CREATED → COMPLETED (sai) | Chuyến CREATED | PUT status=COMPLETED | Lỗi: bỏ qua bước IN_TRANSIT | High |
| TC-TL-020 | CREATED → LOCKED (sai) | Chuyến CREATED | PUT status=LOCKED | Lỗi: chuyển không hợp lệ | High |
| TC-TL-021 | CANCELLED → CREATED (sai) | Chuyến CANCELLED | PUT status=CREATED | Lỗi: không quay lại | High |
| TC-TL-022 | LOCKED → bất kỳ | Chuyến LOCKED | PUT bất kỳ status | 400 "đã khóa" | High |

### 5.3 Sửa chuyến (TC-TL-023 → TC-TL-028)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-023 | Sửa trước xuất phát | CREATED | Đổi KH, tuyến → Lưu | Cập nhật thành công | High |
| TC-TL-024 | Sửa chi phí thực tế | IN_TRANSIT | Nhập fuelAmount, tollFees → Lưu | Cập nhật thành công | High |
| TC-TL-025 | Sửa chi phí COMPLETED | COMPLETED | Sửa fuelAmount → Lưu | Cập nhật thành công | High |
| TC-TL-026 | Sửa LOCKED bị chặn | LOCKED | Thử PUT bất kỳ | 400 "đã khóa" | High |
| TC-TL-027 | DRIVER sửa status mình | DRIVER, chuyến mình | PUT status=IN_TRANSIT | Thành công | High |
| TC-TL-028 | DRIVER sửa chuyến người khác | DRIVER, chuyến TX khác | PUT /api/trips/:id | 403 "không có quyền" | High |

### 5.4 Xóa chuyến (TC-TL-029 → TC-TL-033)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-029 | Xóa CREATED | MANAGER, chuyến CREATED | DELETE | 200, chuyến biến mất | High |
| TC-TL-030 | Xóa IN_TRANSIT | Chuyến IN_TRANSIT | DELETE | 400 "chỉ xóa CREATED" | High |
| TC-TL-031 | Xóa COMPLETED | Chuyến COMPLETED | DELETE | 400 "chỉ xóa CREATED" | High |
| TC-TL-032 | Xóa LOCKED | Chuyến LOCKED | DELETE | 400 "chỉ xóa CREATED" | High |
| TC-TL-033 | Xóa không tồn tại | ADMIN | DELETE /api/trips/fake-id | 404 | High |

### 5.5 Khóa chuyến & Tài chính (TC-TL-034 → TC-TL-040)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-034 | Khóa tạo ledger | COMPLETED, chi phí đầy đủ | Khóa chuyến | LOCKED, TRIP_REVENUE ledger tạo | High |
| TC-TL-035 | grandTotal đúng | revenue=10M, expenses=7M | Khóa → kiểm tra | grandTotal = 3,000,000 | High |
| TC-TL-036 | round2dp đúng | expenses có decimal | Kiểm tra totals | Không floating point error | High |
| TC-TL-037 | revenue = items totalPrice | 3 items: 2M+3M+5M | Kiểm tra revenue | revenue = 10,000,000 | High |
| TC-TL-038 | revenue = rate × distance | Không items, rate=5000, dist=200 | Kiểm tra revenue | revenue = 1,000,000 | High |
| TC-TL-039 | DRIVER không thấy tài chính | DRIVER | Xem chi tiết chuyến | Không thấy cột Tổng tiền | High |
| TC-TL-040 | ACCOUNTANT xem tài chính | ACCOUNTANT | Xem chi tiết | Thấy revenue + expenses | High |

### 5.6 Concurrency & Edge Cases (TC-TL-041 → TC-TL-045)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-041 | Concurrent status change | 2 ADMIN cùng chuyển | Gửi 2 PUT đồng thời | 1 thành công, 1 conflict | Medium |
| TC-TL-042 | Sửa khi người khác xóa | A đang sửa, B xóa | A submit PUT | 404 "không tìm thấy" | Medium |
| TC-TL-043 | Token hết hạn khi sửa | Token sắp hết | PUT trip | 401 → redirect /login | High |
| TC-TL-044 | Chuyến với chi phí = 0 | Không nhập chi phí | Khóa chuyến | grandTotal = revenue | Medium |
| TC-TL-045 | Chuyến với chi phí âm | Thử nhập fuelAmount < 0 | PUT fuelAmount=-100 | Validation: số không âm | High |

### 5.7 Giá cước tự động (TC-TL-046 → TC-TL-050)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-046 | Giá tự điền khi chọn KH+tuyến | Có bảng giá | Chọn KH + tuyến | customerRate tự điền đúng | High |
| TC-KH-047 | Đổi KH → giá reset | Đã có giá | Đổi sang KH khác | Giá reset hoặc điền giá mới | High |
| TC-TL-048 | Tuyến chưa có giá | Không có bảng giá cho cặp | Chọn KH+tuyến chưa có giá | customerRate để trống | High |
| TC-TL-049 | Sửa giá bảng giá → chuyến cũ không đổi | Có chuyến đã tạo | Sửa bảng giá → xem chuyến cũ | Chuyến cũ giữ giá snapshot | High |
| TC-TL-050 | Chuyến mới dùng giá mới | Đã sửa bảng giá | Tạo chuyến mới | Chuyến mới dùng giá mới | High |

### 5.8 Hoa hồng & Lương chuyến quy đổi (TC-TL-056 → TC-TL-063)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-056 | Hoa hồng nhập tay | Chuyến OWN | Nhập customerCommission = 500K | Lưu thành công | High |
| TC-TL-057 | Hoa hồng trừ doanh thu | commission=500K, freightExVat=5M | Khóa chuyến → kiểm tra | recordedRevenue = 4,500,000 | High |
| TC-TL-058 | Hoa hồng = 0 (mặc định) | Chuyến mới | Không nhập commission | recordedRevenue = freightExVat | High |
| TC-TL-059 | Hoa hồng ghi nhận ngay | Chuyến IN_TRANSIT | Nhập commission → Lưu | Hiển thị ngay trên form, không đợi khóa | High |
| TC-TL-060 | Lương chuyến tự điền | Lái xe baseSalary=8M, BHXH=0, 3 ngày | Chọn lái xe + nhập ngày đi/về | driverSalary = (8M+0)/26×3 = 923,077 | High |
| TC-TL-061 | Sửa lương chuyến | driverSalary đã tự điền | Đổi số tiền → Lưu | Giá trị mới được lưu | High |
| TC-TL-062 | trip_wage_days tự tính | departure=1/6, arrival=3/6 | Xem trip_wage_days | = 3 (daysBetween+1) | High |
| TC-TL-063 | Lương chuyến chỉ Xe nhà | Chuyến EXTERNAL | Xem form | Không có trường driverSalary | High |

### 5.9 Responsive & UI (TC-TL-064 → TC-TL-068)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-TL-064 | Mobile form tạo chuyến | < 768px | Mở form | Form stack dọc, cuộn được | Medium |
| TC-TL-065 | Mobile danh sách chuyến | < 768px | Xem /trips | Bảng cuộn ngang, KPI 2 cột | Medium |
| TC-TL-066 | Badge trạng thái đúng màu | 5 trạng thái | Xem badge | CREATED xanh dương, IN_TRANSIT vàng, COMPLETED xanh lá, LOCKED xám, CANCELLED đỏ | High |
| TC-TL-067 | Format VND | grandTotal = 5000000 | Xem tổng tiền | "5,000,000 ₫" | Medium |
| TC-TL-068 | Chuyến thiếu dữ liệu | Null fields | Xem chi tiết | Hiển thị "-" cho null | Low |
