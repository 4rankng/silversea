# Công nợ & Thanh toán

> Tài liệu QA testing & Hướng dẫn sử dụng — Quản lý công nợ khách hàng, ghi nhận thanh toán
> **Routes:** `/debt`, `/debt/:id`
> **Roles:** ADMIN, MANAGER, ACCOUNTANT (DRIVER không truy cập được)

---

## 1. Tổng quan

### 1.1 Mô tả

Module Công nợ & Thanh toán cho phép theo dõi công nợ khách hàng, ghi nhận thanh toán, điều chỉnh nợ, và xuất sao kê.

### 1.2 Phân quyền

| Vai trò | Xem công nợ | Ghi thanh toán | Điều chỉnh | Xuất báo cáo |
|---------|:-----------:|:--------------:|:----------:|:------------:|
| ADMIN | ✅ | ✅ | ✅ | ✅ |
| MANAGER | ✅ | ✅ | ✅ | ✅ |
| ACCOUNTANT | ✅ | ✅ | ✅ | ✅ |
| DRIVER | ❌ | ❌ | ❌ | ❌ |

### 1.3 API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/ledger` | JWT + financial:read | Danh sách ledger (phân trang) |
| `GET` | `/api/ledger/customers/:id/statement` | JWT + financial:read | Sao kê chi tiết KH |
| `POST` | `/api/payments/receive` | JWT + financial:write | Ghi nhận thanh toán |
| `POST` | `/api/adjustments` | JWT + financial:write | Điều chỉnh công nợ (độc lập) |
| `POST` | `/api/trips/:id/adjustment` | JWT + financial:write | Điều chỉnh công nợ (theo chuyến) |
| `GET` | `/api/customers` | JWT + config:read | Danh sách khách hàng |

---

## 2. Hướng dẫn sử dụng

### 2.1 Danh sách Công nợ (/debt)

**4 thẻ Aging Buckets:**

| Thẻ | Khoảng ngày | Màu sắc |
|-----|-------------|---------|
| Hiện hành | 0–30 ngày | Xanh lá |
| 31–60 ngày | 31–60 ngày | Vàng |
| 61–90 ngày | 61–90 ngày | Cam |
| 90+ ngày | > 90 ngày | Đỏ |

**Bảng công nợ:** Tên KH (click → /debt/:id), Tổng nợ (đỏ/xanh), Thanh aging (bar ngang), Ngày quá hạn max, Liên hệ.

**Hành động:** Filter pills (All/Overdue/High risk), Tìm kiếm, Export CSV, Nhắc nợ hàng loạt, Click KH → chi tiết.

> **Làm mới tức thời (A8):** Số liệu công nợ (số dư, tuổi nợ, KPI) được làm mới tức thời khi có ghi nhận ledger mới — không cần người dùng tải lại trang. Cơ chế: server push invalidation + `queryClient.invalidateQueries` cho các query liên quan đến công nợ.

### 2.2 Chi tiết Công nợ (/debt/:id)

**Header:** Tên KH + thông tin liên hệ.

**Hero card:** Tổng nợ chưa thanh toản (viền đỏ nếu > 0, xanh nếu = 0).

**4 Aging KPIs:** Phân bổ nợ theo 4 bucket.

**Chi tiết công nợ (mở mặc định):** Hiển thị trực tiếp các khoản cước, phí chi hộ, thanh toán và điều chỉnh theo tuyến/container. Người dùng không cần tạo hoặc tải Bảng kê/Giấy báo nợ mới xem được phát sinh công nợ. Bảng kê và Giấy báo nợ vẫn nằm ở các tab chứng từ riêng.

**Bảng chi tiết:** Ngày, Chuyến/đối chiếu, Tuyến/container/nội dung, Loại giao dịch, Phát sinh phải thu, Đã thu, Số dư.

**Hành động:** 
- Ghi thanh toán (modal)
- Xuất sao kê (CSV)
- Xuất Giấy báo nợ (PDF/Excel): Hỗ trợ xuất theo Tháng (MONTHLY) hoặc Lô (PER_BATCH), chi tiết từng khoản phụ phí dịch vụ.
- Đối trừ công nợ (Debt Netting): Khả dụng nếu khách hàng có liên kết với Nhà cung cấp.

**Chỉnh sửa Giấy báo nợ:** Mỗi khách hàng chỉ có một Giấy báo nợ đang hiệu lực cho cùng một kỳ ngày; lưu lại sẽ thay thế bản hiện có. Sửa số tiền cước/phí chi hộ, thêm dòng riêng hoặc xóa dòng đều cập nhật công nợ bằng một bút toán `ADJUSTMENT` đúng phần chênh lệch. Lưu lặp lại khi số tiền không đổi không phát sinh thêm công nợ; xóa Giấy báo nợ sẽ hoàn lại phần điều chỉnh do chính Giấy báo nợ đó tạo ra.

### 2.3 Đối trừ công nợ (Debt Netting)
Dành cho thực thể vừa là khách hàng (phải thu) vừa là đối tác (phải trả).
1. Tại trang Chi tiết Công nợ, nếu có liên kết, hiển thị trực tiếp bảng phát sinh phải trả của nhà cung cấp liên kết (ngày, đối chiếu, loại giao dịch, phải trả, đã trả, số dư, ghi chú) bên cạnh chi tiết phải thu; người dùng không cần tải chứng từ để đối chiếu.
2. Nhấn "Đối trừ", hệ thống tự động tính số tiền = `min(Nợ phải thu, Nợ phải trả)`. (Không cho phép nhập số khác).
3. Nhập Ngày đối trừ và Ghi chú.
4. Gửi yêu cầu (trạng thái PENDING). Quản lý/Giám đốc duyệt để chính thức tạo 2 dòng ADJUSTMENT giảm cả 2 đầu nợ.

### 2.3a Nhập thanh toán từ báo có NH / phiếu thu (A8.1)

Kế toán ghi nhận khoản thanh toán mới từ ngân hàng (báo có NH) hoặc phiếu thu tiền mặt:

1. Nhấn **"Ghi nhận thanh toán"** tại trang chi tiết KH → mở modal.
2. Nhập **Mã phiếu thu** (`receipt_id`, bắt buộc) — dùng để nhóm các khoản thanh toán từ cùng một lệnh chuyển khoản ngân hàng.
3. Danh sách chuyến chưa thanh toán (FIFO): mỗi chuyến hiển thị mã, tuyến, tổng tiền, còn lại.
4. Nhập số tiền thanh toán cho mỗi chuyến (một lần có thể trả nhiều chuyến cùng `receipt_id`).
5. Nhấn **"Xác nhận"** → `POST /api/payments/receive` → mỗi chuyến tạo 1 dòng `PAYMENT_RECEIVED` ledger (credit, giảm nợ).

> Endpoint: `POST /api/payments/receive` (đã có sẵn). Quy trình này chỉ là cách ghi nhận tường minh — bản chất nghiệp vụ không thay đổi.

### 2.4 Sao kê & Báo cáo công nợ phải thu

#### 2.4.1 Sao kê chi tiết theo khách hàng (A8.2)

Trang chi tiết KH (`/debt/:id`) hiển thị toàn bộ dòng sổ cái + cho phép lọc theo **khoảng thời gian** tùy chọn:

1. Truy cập `/debt/:id` → Hero card tổng nợ + 4 aging KPIs.
2. **Bộ lọc khoảng thời gian:** 2 ô date picker (từ ngày → đến ngày). Mặc định = toàn bộ lịch sử.
3. Bảng ledger tự lọc theo `date BETWEEN from AND to`. Cột Ngày, Loại GD, Debit, Credit, Balance, Ghi chú.
4. **Xuất sao kê chi tiết:** CSV/PDF với tiêu đề "Sao kê công nợ [Tên KH] từ [dateFrom] đến [dateTo]" + các dòng ledger.

#### 2.4.2 Báo cáo tổng hợp công nợ (A8.3)

Báo cáo tổng hợp tất cả khách hàng theo thời điểm (snapshot):

1. Truy cập `/debt` → bảng tổng hợp KH × số dư × tuổi nợ × than aging bar.
2. **Bộ lọc thời điểm:** chọn "Tính đến ngày" → số dư được tính đến thời điểm đó (running balance cut-off).
3. **Export CSV** toàn bộ bảng — phục vụ đối chiếu cuối kỳ.

### 2.5 AR KPI card trên Dashboard (A8)

Dashboard quản lý/kế toán hiển thị **2 KPI card riêng cho AR**:

| Card | Nội dung | Đơn vị |
|------|----------|--------|
| **Tổng công nợ phải thu** | Tổng số dư hiện tại của tất cả KH có nợ > 0 | VND |
| **Số KH quá hạn** | Đếm KH có bất kỳ khoản nào > 30 ngày tuổi nợ | KH |

Click mỗi card → chuyển đến `/debt` đã lọc sẵn. Số liệu làm mới tức thời khi có ledger post mới (xem §2.1).

---

## 3. Luồng nghiệp vụ

### 3.1 Thanh toán

```
Nhấn "Ghi thanh toán" → Modal mở
  → Nhập receipt_id + chọn chuyến + nhập tiền
  → POST /api/payments/receive
    { customer_id, receipt_id, payments: [{ trip_id, amount }] }
  → BE: Transaction + Advisory Lock trên CUSTOMER
  → Mỗi payment: tìm last balance → credit (giảm nợ) → INSERT PAYMENT_RECEIVED
  → Response 200 → Refresh ledger
```

### 3.2 Điều chỉnh (Adjustment) & Đối trừ (Debt Netting)

**Điều chỉnh thường:**
```
POST /api/adjustments
  { trip_id, amount, note, signed_agreement_ref }
  → amount > 0: Debit (tăng nợ)
  → amount < 0: Credit (giảm nợ)
  → Advisory lock → INSERT ADJUSTMENT ledger row
```

**Đối trừ công nợ:**
```
POST /api/finance/debt-offsets
  { customerId, supplierId, offsetDate, note }
  → Tính amount = min(arBalance, apBalance)
  → Trạng thái PENDING

POST /api/finance/debt-offsets/:id/approve (Manager)
  → Tạo 2 dòng ADJUSTMENT (giảm AR, giảm AP)
```

### 3.3 Xem sao kê

```
GET /api/ledger/customers/:id/statement
  → Response: { customer, ledgerRows, totalOutstanding, agingBuckets }
```

---

## 4. Bảng tra cứu

### 4.1 Loại giao dịch (TxnType)

| Giá trị | Badge | Dấu |
|---------|-------|------|
| TRIP_REVENUE | Xanh dương | Debit (+) |
| PAYMENT_RECEIVED | Xanh lá | Credit (-) |
| PENALTY | Đỏ | Debit (+) |
| MANAGEMENT_FEE | Tím | Debit (+) |
| ADJUSTMENT | Cam | +/− |
| DRIVER_SALARY | Xám | Credit (-) |

### 4.2 Quy ước sổ cái

- **IMMUTABLE** — append-only, không UPDATE/DELETE
- **Running balance** = balance trước + Debit − Credit
- **Advisory lock** bằng `pg_advisory_xact_lock` chống concurrent write
- **FIFO** — chuyến cũ hơn xuất hiện trước trong modal thanh toán

### 4.3 API — POST /api/payments/receive

**Request:**
```json
{
  "customer_id": 1,
  "receipt_id": "PT-2026-016",
  "payments": [
    { "trip_id": 42, "amount": 2000000 },
    { "trip_id": 45, "amount": 1500000 }
  ]
}
```

**Response (200):** `{ ok: true }`

### 4.4 API — GET /api/ledger/customers/:id/statement

**Response (200):**
```json
{
  "customer": { "id": 1, "name": "Công ty ABC", "contact_info": "..." },
  "ledgerRows": [...],
  "totalOutstanding": 3000000,
  "agingBuckets": [
    { "range": "0-30", "amount": 1000000 },
    { "range": "31-60", "amount": 1500000 },
    { "range": "61-90", "amount": 500000 },
    { "range": "90+", "amount": 0 }
  ]
}
```

---

## 5. QA Test Checklist

### 5.1 Hiển thị — Danh sách (/debt)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CN-001 | Hiển thị 4 aging cards | ADMIN, có dữ liệu nợ | Mở /debt | 4 thẻ đúng màu, có tổng tiền + số KH | High |
| TC-CN-002 | Click aging card lọc | Có KH ở bucket 90+ | Click thẻ 90+ | Bảng chỉ hiện KH có nợ 90+ | Medium |
| TC-CN-003 | Màu tổng nợ | KH nợ > 0 và KH nợ = 0 | Xem bảng | Nợ > 0 màu đỏ, nợ = 0 màu xanh | High |
| TC-CN-004 | Click KH → chi tiết | Có KH trong bảng | Click tên KH | Chuyển đến /debt/:id | High |
| TC-CN-005 | Filter pill Overdue | Có KH quá hạn | Click "Qua hạn" | Chỉ hiện KH quá hạn | Medium |
| TC-CN-006 | Export CSV | Có dữ liệu | Click Export | File CSV tải về | Medium |
| TC-CN-007 | DRIVER không truy cập | Đăng nhập DRIVER | Mở /debt | Redirect /my-trips | High |
| TC-CN-008 | Mobile card view | Màn hình < 768px | Xem /debt | Card view thay vì bảng | Low |

### 5.2 Hiển thị — Chi tiết (/debt/:id)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CN-010 | Hero card nợ dương | KH có nợ > 0 | Mở /debt/:id | Viền đỏ, hiển thị đúng số tiền | High |
| TC-CN-011 | Hero card nợ = 0 | KH hết nợ | Mở /debt/:id | Viền xanh, hiển thị "0 ₫" | Medium |
| TC-CN-012 | Bang ledger đúng | KH có nhiều ledger | Xem bảng | Sắp xếp theo ngày giảm dần, badge màu đúng | High |
| TC-CN-013 | Running balance | Kiểm tra cột Số dư | Kiểm tra từng dòng | Balance = balance trước + debit − credit | High |
| TC-CN-014 | Aging KPIs | KH có nợ đa bucket | Xem 4 KPI | Mỗi KPI hiển thị đúng số tiền từ agingBuckets | High |
| TC-CN-015 | KH không tồn tại | Truy cập /debt/999999 | Mở URL | Thông báo lỗi + nút quay lại | Medium |

### 5.3 Ghi nhận thanh toán

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CN-020 | Thanh toán thành công | KH có nợ, ADMIN | 1. Mở modal<br>2. Nhập receipt_id + tiền<br>3. Xác nhận | Thông báo thành công, ledger cập nhật, balance giảm | High |
| TC-CN-021 | Thiếu receipt_id | KH có nợ | Để trống receipt_id → Xác nhận | Lỗi validation | High |
| TC-CN-022 | Không nhập tiền chuyến nào | Modal mở | Xác nhận không nhập tiền | Lỗi validation | Medium |
| TC-CN-023 | Thanh toán nhiều chuyến | KH có 3+ chuyến chưa TT | Nhập tiền cho 3 chuyến | 3 dòng PAYMENT_RECEIVED tạo, balance giảm đúng | High |
| TC-CN-024 | Thanh toán vượt quá còn lại | Chuyến còn lại 2M | Nhập 3M cho chuyến đó | Lỗi validation | High |
| TC-CN-025 | Thanh toán hết nợ | Thanh toán toàn bộ | Xác nhận | Hero card chuyển viền xanh, nợ = 0 | Medium |
| TC-CN-026 | FIFO đúng thứ tự | Chuyến cũ + mới | Mở modal | Chuyến cũ xuất hiện trước | Medium |

### 5.4 Điều chỉnh (Adjustment)

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CN-030 | Debit adjustment | ADMIN | POST amount > 0 | Ledger ADJUSTMENT tạo, balance tăng | High |
| TC-CN-031 | Credit adjustment | ADMIN | POST amount < 0 | Ledger ADJUSTMENT tạo, balance giảm | High |
| TC-CN-032 | Thiếu note | ADMIN | POST note rỗng | Lỗi 400 validation | Medium |
| TC-CN-033 | Trip-scoped adjustment | ADMIN | POST /api/trips/:id/adjustment | Tạo thành công, liên kết trip | Medium |

### 5.5 Bảo mật & Concurrency

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CN-040 | Concurrent payment | 2 request cùng lúc | Gửi 2 thanh toán đồng thời | 1 thành công, 1 conflict (409) | High |
| TC-CN-041 | Ledger immutable | ADMIN | Thử PUT/DELETE ledger | Lỗi 405 | High |
| TC-CN-042 | Token hết hạn | Token cũ | Gọi API | 401 → redirect /login | High |
| TC-CN-043 | DRIVER gọi API | DRIVER | POST /api/payments/receive | 403 Forbidden | High |

---

## 6. Ghi chú & Lưu ý

- Ledger **IMMUTABLE** — mọi chỉnh sửa đều tạo row mới (append-only)
- Migration 0001 thu hồi quyền UPDATE/DELETE trên bảng ledger khỏi role `tingting_app`
- Advisory lock sử dụng `pg_advisory_xact_lock` — tự release khi transaction kết thúc
- Dấu nợ: Debit tăng công nợ KH, Credit giảm công nợ KH
- Module liên kết trực tiếp với Trip Lifecycle (mỗi chuyến LOCKED tạo TRIP_REVENUE) và Finance P&L
