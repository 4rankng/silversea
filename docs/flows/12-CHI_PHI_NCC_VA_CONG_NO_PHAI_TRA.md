# Chi phí vận hành, Nhà cung cấp & Công nợ phải trả

> Tài liệu QA testing & Hướng dẫn sử dụng — Danh mục Nhà cung cấp, nhập phiếu chi phí (sửa chữa/phụ tùng/bảo hiểm/đăng kiểm/phí đường bộ), công nợ phải trả, nhắc gia hạn
> **Routes:** `/suppliers`, `/expenses`, `/payables`, `/payables/:id` (+ khối "Hạng mục chi phí" trong `/config`)
> **Roles:** ADMIN, MANAGER, ACCOUNTANT (DRIVER không truy cập được)

---

## 1. Tổng quan

### 1.1 Mô tả

Module bổ sung phần chi phí vận hành mà quy trình Excel cũ vẫn theo dõi nhưng sản phẩm web trước đây còn thiếu: **sửa chữa, phụ tùng, vật tư, bảo hiểm, đăng kiểm, phí đường bộ**. Gồm 4 phần:

1. **Nhà cung cấp (NCC)** — danh mục mọi bên nhận tiền (gara, trạm lốp, cửa hàng phụ tùng, công ty bảo hiểm, trung tâm đăng kiểm, đơn vị thu phí đường bộ).
2. **Hạng mục chi phí** — danh mục cấu hình được; mỗi hạng mục là **một lần** hoặc **định kỳ** (có nhắc gia hạn).
3. **Phiếu chi phí** — ghi nhận một khoản chi, gắn NCC + (tùy chọn) một xe, **trả ngay** hoặc **ghi nợ**.
4. **Công nợ phải trả** — số tiền đang nợ NCC, tuổi nợ, ghi nhận thanh toán.

### 1.2 Phân quyền

| Vai trò | Danh mục NCC | Hạng mục CP | Nhập phiếu CP | Công nợ phải trả | Thanh toán NCC |
|---------|:------------:|:-----------:|:-------------:|:----------------:|:--------------:|
| ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ |
| MANAGER | ✅ | ✅ | ✅ | ✅ | ✅ |
| ACCOUNTANT | ✅ | ✅ | ✅ | ✅ | ✅ |
| DRIVER | ❌ | ❌ | ❌ | ❌ | ❌ |

### 1.3 API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET/POST/PUT/DELETE` | `/api/suppliers` | JWT + config:* | CRUD Nhà cung cấp |
| `GET/POST/PUT/DELETE` | `/api/expense-categories` | JWT + config:* | CRUD Hạng mục chi phí |
| `GET` | `/api/expenses` | JWT + financial:read | Danh sách phiếu chi phí (lọc theo xe/NCC/hạng mục/khoảng ngày) |
| `POST` | `/api/expenses` | JWT + financial:write | Tạo phiếu chi phí (PAID/UNPAID) |
| `PUT` | `/api/expenses/:id` | JWT + financial:write | Sửa phiếu (ADJUSTMENT bù trừ nếu đã ghi nợ) |
| `DELETE` | `/api/expenses/:id` | JWT + financial:write | Soft-delete (ADJUSTMENT bù trừ nếu đã ghi nợ) |
| `GET` | `/api/reports/payables-summary` | JWT + financial:read | Tổng hợp công nợ phải trả + tuổi nợ |
| `GET` | `/api/ledger/suppliers/:id/statement` | JWT + financial:read | Sao kê chi tiết NCC |
| `GET` | `/api/ledger/carriers/:id/statement` | JWT + financial:read | Sổ phải trả cước thuê ngoài, tách khỏi phải thu khách hàng |
| `POST` | `/api/payments/vendor` | JWT + financial:write | Ghi nhận thanh toán cho NCC |
| `POST` | `/api/payments/carrier` | JWT + financial:write | Ghi nhận thanh toán cước cho nhà vận chuyển thuê ngoài |
| `GET` | `/api/reports/renewals` | JWT + financial:read | Danh sách hạng mục định kỳ sắp/đã tới hạn |

---

## 2. Hướng dẫn sử dụng

### 2.1 Danh mục Nhà cung cấp (/suppliers)

CRUD đơn giản (theo mẫu Khách hàng): Tên, Người liên hệ, SĐT, Mã số thuế, Ghi chú, Trạng thái, **Cờ "Là NCC nhiên liệu"** (`isFuelSupplier`, checkbox). Không có trường "phân loại" — phân loại nằm ở hạng mục của từng phiếu chi. NCC được đánh dấu `isFuelSupplier` sẽ xuất hiện trong dropdown chọn NCC nhiên liệu trên form nhập liệu chuyến đi (§6).

**Phân loại NCC theo bản chất công nợ (A9):**

| Loại | Mô tả | Cách tạo công nợ |
|------|-------|------------------|
| `FUEL_SUPPLIER` | NCC nhiên liệu (gắn cờ `is_fuel_supplier`) | Tự động khi chuyến LOCKED (xem §6) |
| `EXTERNAL_CARRIER` | Đối tác vận tải thuê ngoài | Tự động khi chuyến EXTERNAL LOCKED |
| `COMMISSION_PAYABLE` | Hoa hồng phải trả (môi giới/KH rebate) | Kế toán tạo thủ công qua form phiếu chi |
| `OTHER_VENDOR` | NCC một lần (sửa chữa, phụ tùng, vật tư, bảo hiểm, đăng kiểm, phí đường bộ) | Khi phiếu UNPAID |

Báo cáo công nợ phải trả (`/payables`) cung cấp **filter chip** theo các loại trên.
Chip **Tất cả** cộng cả công nợ Nhà cung cấp (`VENDOR`) và cước vận chuyển
thuê ngoài (`EXTERNAL_CARRIER_COST`); chip **Vận chuyển thuê ngoài** chỉ hiển
thị phần cước của đối tác vận tải.

### 2.2 Hạng mục chi phí (trong /config)

- Tạo hạng mục tự do theo nhu cầu (VD: Sửa chữa, Phụ tùng, Vật tư, Bảo hiểm, Đăng kiểm, Phí đường bộ).
- Cờ **Định kỳ (`is_renewable`)**: bật nếu khoản này cần gia hạn (bảo hiểm, đăng kiểm, phí đường bộ).
- **Nhắc trước (`reminder_lead_days`)**: số ngày nhắc trước hạn, mặc định **30** (chỉ áp dụng khi định kỳ).

### 2.3 Nhập Phiếu chi phí (/expenses)

Form nhập:
1. **Ngày phát sinh (`expense_date`)** (bắt buộc) — ngày thực tế phát sinh chi phí tại NCC. Mặc định = hôm nay. **Ràng buộc: `expense_date <= today()`** — không cho phép ngày tương lai (A10.2).
2. **Ngày nhập (`recorded_at`)** — auto, ngày hệ thống ghi nhận. Hai mốc này tách biệt để hỗ trợ back-dating khi NCC báo về sau.
3. **Nhà cung cấp** (bắt buộc, từ danh mục)
4. **Hạng mục** (bắt buộc, từ danh mục)
5. **Xe** — chọn xe đầu kéo, **hoặc để trống** (chi phí chung). Khi chọn xe, đánh dấu chi phí thuộc **đầu kéo** hay **rơ-mooc** (dropdown `vehicle_component`: "Đầu kéo" / "Rơ-mooc", mặc định "Đầu kéo"). Chi phí rơ-mooc tự gộp vào lãi gộp của đầu kéo ghép cặp; phân loại chỉ dùng cho báo cáo phân tách.
6. **Số tiền** (bắt buộc, VND)
7. **Trạng thái:** Trả ngay (PAID) / Ghi nợ (UNPAID)
8. **Hiệu lực từ – đến** (`valid_from`/`valid_to`) — **chỉ hiện khi hạng mục là định kỳ**
9. **Ghi chú**, **Ảnh hóa đơn** (upload)
10. **`commission_type`** (chỉ với `COMMISSION_PAYABLE`): `PARTNER_REFERRAL` (chi phí bán hàng) hoặc `CUSTOMER_REBATE` (giảm doanh thu). Hạch toán khác nhau (xem `PRODUCT-SPECS §4.15`).

> Một hóa đơn gara nhiều khoản → nhập nhiều phiếu (mỗi hạng mục một phiếu), cùng NCC + cùng ngày.

**RBAC (A10.1):** Cả ADMIN, MANAGER, ACCOUNTANT đều có quyền tạo phiếu chi (Casbin `financial:write`). Nếu manager gặp lỗi 403/404 khi tạo, kiểm tra Casbin policy cho role MANAGER với resource `expenses` action `create`.

### 2.4 Công nợ phải trả (/payables, /payables/:id)

- `/payables`: danh sách NCC kèm số dư nợ + tuổi nợ (4 bucket: 0–30 / 31–60 / 61–90 / 90+), giống màn Công nợ phải thu.
- `/payables/:id`: mở trực tiếp bảng chi tiết NCC với các cột Phát sinh phải trả, Đã thanh toán và Số dư chạy + nút **Ghi thanh toán** (một ô số tiền — không khớp từng phiếu). Công cụ tạo Bảng kê nằm phía dưới bảng chi tiết để không che khuất dữ liệu đối chiếu.
- `/payables/:id?kind=carrier`: sổ phải trả riêng cho nhà vận chuyển thuê ngoài. Chỉ cước thuê ngoài và các khoản chi trả tương ứng được tính; không được chuyển sang hoặc trộn với sổ phải thu của khách hàng dù đối tác dùng chung danh mục khách hàng.
- Bút toán cước và thanh toán mới dùng `entity_type = CARRIER`. Khi đọc sổ phải trả, hệ thống vẫn chiếu các bút toán cước lịch sử từng lưu dưới `CUSTOMER`; các dòng này bị loại khỏi mọi phép tính và sao kê phải thu.
- Khi chọn **Chi phí nhiên liệu**, bảng chi tiết dùng dữ liệu snapshot của chuyến đã chốt để hiển thị: ngày vận chuyển, biển số xe, tuyến vận chuyển, số lít dầu, đơn giá thực tế (hoặc đơn giá áp dụng nếu chưa có giá thực tế), thành tiền, số dư và mã chuyến đối chiếu.
- Khi chọn **Ghi nhận chi phí**, các khoản sửa chữa/bảo dưỡng gắn đầu kéo hoặc rơ-moóc phải hiển thị biển số tương ứng. Bút toán mới lưu `expense.id` trong `txn_id`; dữ liệu cũ chỉ được nối lại khi khớp duy nhất, tránh gán nhầm xe.
- **Đối trừ công nợ (Debt Netting):** Tương tự như phải thu, nếu NCC có liên kết khách hàng, có thể đối trừ nợ (giảm cả AP và AR).

### 2.5 Nhắc gia hạn (Dashboard)

Widget liệt kê xe có bảo hiểm/đăng kiểm/phí đường bộ **sắp tới hạn** (trong `reminder_lead_days`) hoặc **đã quá hạn**, dựa trên `valid_to` mới nhất theo (xe × hạng mục).

### 2.6 Công nợ phải trả trên trang chi tiết NCC (A14)

Trang chi tiết NCC (`/suppliers/:id`) hiển thị **widget Công nợ phải trả** ngay tại header, mirror với widget AR trên trang KH (xem `08-KHACH_HANG.md §2.6`):

| Thành phần | Mô tả |
|------------|-------|
| **Số dư hiện tại** | Tổng `balance` của dòng ledger `entity_type='VENDOR'` mới nhất (VND) — viền đỏ nếu > 0 |
| **Tuổi nợ lớn nhất** | Số ngày kể từ dòng `VENDOR_EXPENSE` chưa thanh toán cũ nhất |
| **4 aging buckets** | 0–30 / 31–60 / 61–90 / 90+ |
| **Nút "Xem chi tiết"** | Chuyển sang `/payables/:id` |

**Cập nhật:** số liệu làm mới tức thời khi có ledger post mới.

### 2.7 Số dư tạm ứng giao nhận (A11.1)

Đối với tạm ứng giao nhận (forwarder advances), mỗi giao nhận có **số dư tạm ứng hiện tại**:

> **Số dư tạm ứng** = Σ tạm ứng đã duyệt − Σ tất toán (hoàn ứng) đã duyệt.

Hiển thị:
- Trên **danh sách giao nhận** (cột "Số dư tạm ứng").
- Trên **trang chi tiết giao nhận** (header).
- Ứng với `entity_type='FORWARDER'` trong sổ cái (hoặc tương đương).

### 2.8 Hoàn ứng theo từng container/lô (A11.2)

Kế toán/giám đốc duyệt **phiếu yêu cầu hoàn ứng** theo từng container/lô của chuyến:

1. Phiếu yêu cầu hoàn ứng gắn với `tripContainerId` cụ thể (FK).
2. Trang chi tiết giao nhận hiển thị bảng **"Lịch sử hoàn ứng theo container/lô"**:
    - Cột: Số container, tuyến, ngày vận chuyển, số tiền tạm ứng, số tiền hoàn ứng, trạng thái (Yêu cầu / Đã duyệt / Đã thanh toán).
3. Kế toán bấm **Duyệt** → chuyển trạng thái Yêu cầu → Đã duyệt.
4. Khi đã chi tiền → chuyển Đã duyệt → Đã thanh toán.

### 2.9 Troubleshooting (D1, D2)

| Vấn đề | Triệu chứng | Nguyên nhân & Cách xử lý |
|--------|-------------|---------------------------|
| **D1 — Dropdown hạng mục/NCC cũ** | Kế toán mở form nhập phiếu chi, danh sách NCC hoặc hạng mục không chứa NCC/hạng mục vừa tạo | Cache client hoặc chưa invalidate query. Form nhập phiếu phải `queryClient.invalidateQueries` cho `['suppliers']` và `['expense-categories']` khi mount. Refresh trang một lần cũng khắc phục tạm thời. |
| **D2 — Upload ảnh hóa đơn lỗi** | Kế toán tải ảnh lên phiếu chi, báo lỗi dù ảnh đã giảm dung lượng | Kế toán đang dùng sai endpoint. Phiếu chi (expense) dùng `/api/expense-photos/upload` (hoặc tương đương), **không** dùng `/api/trip-photos/upload` (chỉ dành cho ảnh container/seal trên chuyến). Kiểm tra FE form wiring. |

---

## 3. Luồng nghiệp vụ

### 3.1 Tạo phiếu chi phí — Ghi nợ (UNPAID)

```
POST /api/expenses { expenseDate, supplierId, categoryId, truckId?, vehicleComponent?: "TRUCK"|"TRAILER", amount, paymentStatus: "UNPAID", validFrom?, validTo?, note? }
  → BE: Transaction + Advisory Lock trên VENDOR:supplierId
  → INSERT expenses
  → LedgerService.postEntry: VENDOR_EXPENSE, credit = amount → balance = prev + credit − debit (tăng nợ)
  → Response 200
```

### 3.2 Tạo phiếu chi phí — Trả ngay (PAID)

```
POST /api/expenses { ..., paymentStatus: "PAID" }
  → vehicleComponent chỉ có khi truckId != null, mặc định "TRUCK"
  → INSERT expenses
  → KHÔNG tạo dòng sổ cái (hệ thống không có tài khoản tiền mặt)
  → Vẫn được tính vào P&L tháng thanh toán
```

### 3.3 Thanh toán cho NCC

```
POST /api/payments/vendor { supplierId, receiptId, amount, date }
  → Advisory Lock VENDOR:supplierId
  → LedgerService.postEntry: VENDOR_PAYMENT, debit = amount → balance = prev + credit − debit (giảm nợ)
  → Tuổi nợ tính lại theo FIFO (trừ phiếu cũ nhất trước)
```

### 3.4 Sửa/Xóa phiếu đã ghi nợ

```
PUT/DELETE /api/expenses/:id
  → Nếu phiếu đã post VENDOR_EXPENSE: post ADJUSTMENT bù trừ (sổ cái append-only, không sửa dòng cũ)
  → Soft-delete dòng expenses (set deletedAt)
```

### 3.5 P&L (theo tháng)

```
getPnlReport(month, year)
  → Per-truck: Tổng chi phí xe = Σ chi phí chuyến của xe
                                + Σ bảo dưỡng gắn đầu kéo đó trong tháng (vehicle_component='TRUCK')
                                + Σ bảo dưỡng gắn rơ-mooc ghép cặp với xe đó trong tháng (vehicle_component='TRAILER')
              Lãi gộp xe = Doanh thu − Tổng chi phí xe
              (Báo cáo phân tách: chi phí đầu kéo vs rơ-mooc trong từng xe)
  → Company-level: Σ chi phí không gắn xe (để trống)
  → Lãi ròng = Σ Lãi gộp xe − Phí quản lý − Chi phí chung + Thu nhập khác
```

---

## 4. Bảng tra cứu

### 4.1 Loại giao dịch mới (TxnType)

| Giá trị | Dấu | Ý nghĩa |
|---------|-----|---------|
| VENDOR_EXPENSE | Credit (+nợ) | Phát sinh công nợ phải trả khi ghi nợ một phiếu chi phí |
| VENDOR_PAYMENT | Debit (−nợ) | Thanh toán cho NCC, giảm công nợ |

### 4.2 Quy ước sổ cái cho VENDOR

- **Dấu:** `balance = balance trước + Credit − Debit` (giống DRIVER — công nợ phải trả).
- **Tuổi nợ (aging):** ngược với phải thu — *chi phí là Credit* (cần tính tuổi), *thanh toán là Debit* (áp FIFO).
- **IMMUTABLE** — append-only; sửa/xóa dùng ADJUSTMENT bù trừ.
- **Advisory lock** `pg_advisory_xact_lock(3, supplierId)` (type key VENDOR = 3).

### 4.3 Hành vi hạng mục chi phí

| Trường | Ý nghĩa |
|--------|---------|
| `is_renewable` | `false` = một lần (sửa chữa, phụ tùng, vật tư). `true` = định kỳ (bảo hiểm, đăng kiểm, phí đường bộ) → phiếu cần `valid_from/to`, có nhắc gia hạn |
| `reminder_lead_days` | Số ngày nhắc trước `valid_to` (mặc định 30) |

### 4.4 Quy về P&L theo loại gắn xe

| Phiếu gắn | vehicle_component | Quy về |
|-----------|-------------------|--------|
| Xe đầu kéo | `TRUCK` (mặc định) | Trừ vào **Lãi gộp** của chính xe đó |
| Xe đầu kéo | `TRAILER` | Trừ vào **Lãi gộp của đầu kéo ghép cặp** — rơ-mooc ghép cố định, tính chung |
| Không gắn xe | — | **Chi phí chung công ty** (trừ ở Lãi ròng) |

> **Lưu ý:** Cả `TRUCK` và `TRAILER` đều gộp vào lãi gộp của cùng một đầu kéo. Phân loại `vehicle_component` chỉ để báo cáo phân tách chi tiết (VD: "xe A tốn 50M sửa đầu kéo + 20M thay lốp rơ-mooc").

---

## 5. QA Test Checklist

### 5.1 Happy Path

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-CP-001 | Tạo NCC | ketoan | /suppliers → Thêm → lưu | NCC xuất hiện trong danh sách | High |
| TC-CP-002 | Tạo hạng mục một lần | ketoan | /config → Hạng mục CP → thêm "Sửa chữa" (is_renewable off) | Lưu thành công, không hỏi ngày hiệu lực | High |
| TC-CP-003 | Tạo hạng mục định kỳ | ketoan | Thêm "Bảo hiểm" (is_renewable on, lead 30) | Lưu thành công | High |
| TC-CP-004 | Phiếu Ghi nợ gắn đầu kéo | Có NCC + hạng mục | /expenses → nhập, UNPAID, chọn xe X, vehicle_component=TRUCK | 1 dòng VENDOR_EXPENSE credit, số dư NCC tăng, vehicle_component ghi TRUCK | High |
| TC-CP-004b | Phiếu gắn rơ-mooc | Có NCC + xe có trailer | /expenses → nhập, chọn xe X, vehicle_component=TRAILER | Lưu thành công, P&L gộp vào xe X, báo cáo phân tách hiển thị "Rơ-mooc" | High |
| TC-CP-005 | Phiếu Trả ngay | Có NCC | Nhập PAID | Không tạo dòng sổ cái; vẫn vào P&L | High |
| TC-CP-006 | Phiếu định kỳ có hạn | Hạng mục định kỳ | Nhập Bảo hiểm, valid_to = +1 năm, ảnh hóa đơn | Lưu thành công, hiện trên nhắc gia hạn khi tới gần | High |
| TC-CP-007 | Phiếu không gắn xe | — | Nhập phiếu để trống xe | Lưu thành công (chi phí chung) | Medium |
| TC-CP-008 | Thanh toán NCC | NCC có nợ | /payables/:id → Ghi thanh toán | Dòng VENDOR_PAYMENT debit, số dư giảm | High |

### 5.2 Validation

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-CP-020 | Thiếu NCC | Tạo phiếu không chọn NCC | Lỗi validation | High |
| TC-CP-021 | Thiếu hạng mục/số tiền | Bỏ trống | Lỗi validation | High |
| TC-CP-022 | vehicle_component khi không chọn xe | Không chọn xe, chọn vehicle_component=TRAILER | vehicle_component bị ẩn hoặc bỏ qua (chỉ hiện khi có xe) | Medium |
| TC-CP-022b | Mặc định TRUCK khi chọn xe | Chọn xe, không đổi vehicle_component | Lưu vehicle_component='TRUCK' tự động | Medium |
| TC-CP-023 | Hạng mục định kỳ thiếu valid_to | is_renewable on, bỏ trống ngày | Lỗi validation | Medium |
| TC-CP-024 | Số tiền ≤ 0 | Nhập 0 | Lỗi validation | Medium |

### 5.3 Permission

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-CP-030 | DRIVER chặn /expenses | Đăng nhập laixe → /expenses | Redirect /my-trips | High |
| TC-CP-031 | DRIVER chặn /payables | laixe → /payables | Redirect | High |
| TC-CP-032 | DRIVER gọi API | laixe → POST /api/expenses | 403 Forbidden | High |
| TC-CP-033 | ketoan/giamdoc được phép | Đăng nhập → thao tác | Thành công | High |

### 5.4 Edge Cases & Sổ cái

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-CP-040 | Tuổi nợ AP đúng chiều | NCC có phiếu cũ + thanh toán | Tuổi nợ tính trên credit (chi phí), FIFO áp debit (thanh toán) | High |
| TC-CP-041 | Xóa phiếu đã ghi nợ | DELETE phiếu UNPAID | ADJUSTMENT bù trừ, số dư về đúng, dòng soft-delete | High |
| TC-CP-042 | Sửa số tiền phiếu đã ghi nợ | PUT đổi amount | ADJUSTMENT chênh lệch, số dư khớp | Medium |
| TC-CP-043 | Xóa phiếu Trả ngay | DELETE phiếu PAID | Không tạo ADJUSTMENT (chưa từng post sổ cái) | Medium |
| TC-CP-044 | Sổ cái immutable | PUT/DELETE trực tiếp ledger | Lỗi 405 | High |

### 5.5 Concurrency

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-CP-050 | Thanh toán đồng thời | 2 request cùng NCC | Advisory lock tuần tự, số dư cuối đúng | High |

### 5.6 P&L & Nhắc gia hạn

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-CP-060 | Bảo dưỡng đầu kéo vào lãi gộp | Phiếu gắn xe X, vehicle_component=TRUCK trong tháng | /finance: lãi gộp xe X giảm đúng số tiền | High |
| TC-CP-061 | Chi phí rơ-mooc vào lãi gộp đầu kéo cặp | Phiếu gắn xe X, vehicle_component=TRAILER | Trừ vào lãi gộp của xe X; không trừ ở chi phí chung; báo cáo phân tách hiện "Rơ-mooc" | High |
| TC-CP-062 | Chi phí chung vào lãi ròng | Phiếu không gắn xe | Trừ ở dòng chi phí chung | Medium |
| TC-CP-063 | Lát cắt cơ cấu chi phí | Có nhiều hạng mục | Pie chart hiện lát sửa chữa/phụ tùng/bảo hiểm/đăng kiểm/phí đường bộ | Medium |
| TC-CP-064 | Nhắc gia hạn sắp tới hạn | Bảo hiểm valid_to trong 30 ngày | Dashboard hiện cảnh báo | High |
| TC-CP-065 | Nhắc gia hạn quá hạn | đăng kiểm valid_to đã qua | Dashboard hiện "quá hạn" | High |
| TC-CP-066 | Gia hạn xóa nhắc | Nhập phiếu mới valid_to xa hơn | Cảnh báo biến mất (dùng valid_to mới nhất) | Medium |

### 5.7 Responsive

| TC-ID | Tiêu đề | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------|-------------------|---------|
| TC-CP-070 | Mobile danh sách chi phí | < 768px | Card view thay bảng | Low |
| TC-CP-071 | Mobile công nợ phải trả | < 768px | Card view | Low |

---

## 6. Ghi chú & Lưu ý quan trọng

- **Tổng chi phí bao gồm TẤT CẢ chi phí** ở tầng P&L (chuyến + bảo dưỡng). Thẻ từng chuyến vẫn chỉ là dầu + tiền đi đường + lương — `computeTripTotals` không đổi.
- **Chi phí nhiên liệu & Công nợ Nhà cung cấp nhiên liệu:** Khi kế toán nhập liệu chuyến đi (OWN carrier), hệ thống cho phép lựa chọn Nhà cung cấp nhiên liệu tương ứng (trong số các VENDOR được đánh dấu cờ "Là nhà cung cấp nhiên liệu (xăng, dầu)" - `isFuelSupplier: true`). Khi chuyến đi được Chốt khóa (`LOCKED`), hệ thống tự động ghi nhận một bút toán ghi Có (`credit`) trị giá bằng `totalFuelCost` (Tổng tiền dầu chuyến đi) vào sổ cái của Nhà cung cấp đó (với loại giao dịch `FUEL_EXPENSE`), ghi nhận công nợ phải trả. Bút toán này sẽ được hoàn tác ghi Nợ (`debit` loại `UNLOCK_REVERSAL`) nếu chuyến đi được Mở khóa (`COMPLETED`). Lái xe cũng có thể xem số dầu được cấp và nhà cung cấp tương ứng qua Driver Portal.
- **Phiếu cấp nhiên liệu (Fuel Voucher):** Sau khi kế toán phê duyệt dữ liệu dầu trên chuyến đi, hệ thống hỗ trợ xuất Phiếu cấp nhiên liệu (HTML/PDF hoặc Excel) bao gồm: Biển số xe, Khối lượng/Số lít dầu, Đơn giá, Thành tiền, Tên + Địa chỉ nhà cung cấp, Mã chuyến, Tuyến đường, Ngày, Tên lái xe, Khối chữ ký (Kế toán / Giám đốc / Người nhận). Thông tin NCC tối giản — chỉ cần tên + địa chỉ, **không cần** MST, số tài khoản ngân hàng hay người liên hệ. Phiếu được in ra để ký tay hoặc trích xuất dưới dạng file ảnh/file điện tử gửi cho đối tác. *(Pete xác nhận 11/6)*
- **Phí đường bộ** (phí bảo trì đường bộ năm, theo xe) **khác** **Tiền đi đường** (vé cầu đường mỗi chuyến). Không nhầm.
- **Chi phí rơ-mooc tính vào lãi gộp đầu kéo ghép cặp** — mỗi đầu kéo và rơ-mooc ghép thành cặp cố định; hệ thống tự tra cặp khi tổng hợp P&L. Chỉ chi phí để trống (không gắn xe) mới là chi phí chung công ty. Phân loại `vehicle_component` (TRUCK/TRAILER) dùng cho báo cáo phân tách, không ảnh hưởng tính lãi gộp.
- **Không phân bổ (no amortization):** chi phí định kỳ ghi toàn bộ vào tháng thanh toán; chỉ nhắc gia hạn, không trải đều.
- Sổ cái VENDOR dùng chung bảng `ledger`, `entity_type='VENDOR'`, append-only.
- Tài khoản test: xem [README](./README.md) (ketoan / admin123).
