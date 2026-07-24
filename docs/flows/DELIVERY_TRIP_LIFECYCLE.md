# Hướng dẫn Sử dụng — TingTing Quản lý Vận tải

> Tài liệu dành cho **QA testing** và **User Manual**.
> Phiên bản: 2026-05 · Stack: Express v5 + PostgreSQL + React + TypeScript

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Vòng đời chuyến xe](#2-vòng-đời-chuyến-xe)
3. [Luồng Giám đốc (giamdoc)](#3-luồng-giám-đốc-giamdoc)
4. [Luồng Kế toán (ketoan)](#4-luồng-kế-toán-ketoan)
5. [Luồng Lái xe (laixe)](#5-luồng-lái-xe-laixe)
6. [Bảng tra cứu nhanh](#6-bảng-tra-cứu-nhanh)
7. [QA Test Checklist](#7-qa-test-checklist)

---

## 1. Tổng quan hệ thống

### 1.1 Vai trò người dùng

| Vai trò | Tài khoản demo | Mật khẩu | Trang chủ | Mô tả |
|---------|---------------|----------|-----------|-------|
| **Giám đốc** (MANAGER) | `giamdoc` | `admin123` | `/dashboard` | Quản lý toàn bộ — điều vận, tài chính, phân bổ lợi nhuận |
| **Kế toán** (ACCOUNTANT) | `ketoan` | `admin123` | `/dashboard` | Tạo/sửa chuyến, ghi nhận thanh toán, công nợ |
| **Lái xe** (DRIVER) | `laixe` | `admin123` | `/my-trips` | Xem lịch trình, thu nhập, phạt (chỉ đọc) |
| Quản trị (ADMIN) | `admin` | `admin123` | `/dashboard` | Toàn quyền bao gồm quản lý người dùng |

### 1.2 Trạng thái chuyến xe

```
CREATED → IN_TRANSIT → COMPLETED → LOCKED
   │                        ↑
   └──→ CANCELED  ←─────────┘
```

| Trạng thái | Tiếng Việt | Ý nghĩa |
|-----------|-----------|---------|
| `CREATED` | Mới tạo | Chuyến đã tạo, chờ điều vận xuất phát |
| `IN_TRANSIT` | Đang chạy | Xe đã khởi hành |
| `COMPLETED` | Hoàn thành | Xe về đích, đã nhập số liệu thực tế |
| `LOCKED` | Đã chốt | Chốt sổ — ghi nhận sổ cái, không thể sửa |
| `CANCELED` | Đã hủy | Hủy chuyến, tất cả số liệu về 0 |

### 1.3 Phân quyền theo vai trò

| Chức năng | Giám đốc | Kế toán | Lái xe |
|-----------|---------|---------|--------|
| Dashboard | ✅ | ✅ | ❌ |
| Điều vận / Xuất phát | ✅ | ✅ | ❌ |
| Tạo / Sửa chuyến | ✅ | ✅ | ❌ |
| Hủy chuyến | ✅ | ❌ | ❌ |
| Chốt chuyến (Lock) | ✅ | ✅ | ❌ |
| Tài chính (P&L) | ✅ | ✅ | ❌ |
| Phân bổ lợi nhuận | ✅ | ❌ | ❌ |
| Công nợ | ✅ | ✅ | ❌ |
| Phạt lái xe | ✅ | ✅ | ❌ |
| Cấu hình hệ thống | ✅ | ✅ | ❌ |
| Quản lý người dùng | ❌* | ❌ | ❌ |
| Nhật ký hoạt động | ❌* | ❌ | ❌ |
| Xem chuyến của mình | ❌ | ❌ | ✅ |
| Xem thu nhập | ❌ | ❌ | ✅ |
| Xem phạt | ❌ | ❌ | ✅ |

> *Chỉ ADMIN (`admin`) mới truy cập được Users và Audit Logs.*

---

## 2. Vòng đời chuyến xe

### 2.1 Sơ đồ tổng quát

```
┌─────────┐    Khởi hành     ┌────────────┐   Nhập actuals   ┌───────────┐   Chốt sổ   ┌────────┐
│ CREATED  │ ──────────────→ │ IN_TRANSIT  │ ───────────────→ │ COMPLETED │ ──────────→ │ LOCKED │
│ Mới tạo  │  /dispatch      │  Đang chạy  │  /trips/:id/edit │ Hoàn thành│  /lock      │ Đã chốt│
└─────────┘                  └────────────┘                   └───────────┘             └────────┘
      │                                                                        ↑
      │   Hủy chuyến (chỉ Giám đốc)                                           │
      └──→ CANCELED ←──────────────────────────────────────────────────────────┘
           Đã hủy         (không thể hủy từ LOCKED)
```

### 2.2 Chi tiết từng bước

#### Bước 1: Tạo chuyến (CREATED)
- **Ai thực hiện:** Kế toán hoặc Giám đốc
- **Trang:** `/trips/new` hoặc nút "Tạo chuyến mới" từ `/dispatch`
- **Thông tin cần nhập:**
  - Khách hàng (bắt buộc)
  - Tuyến đường (bắt buộc)
  - Xe đầu kéo (bắt buộc)
  - Lái xe (bắt buộc)
  - Ro-mooc
  - Loại hàng hóa
  - Ngày xuất phát (bắt buộc)
  - Mã tham chiếu khách hàng
  - Các chặng (origin, destination, km, loại xếp hàng: hàng/vỏ)
  - Chế độ nhiên liệu (TỰ ĐỘNG hoặc KHOÁN)
  - Doanh thu (tự động tra bảng giá, có thể ghi đè)
  - **Hoa hồng chi KH** (`customerCommission`): khoản chiết khấu/hoa hồng cho khách hàng, nhập tay theo từng chuyến (không theo công thức). Ghi nhận ngay, không đợi khóa.
  - **Lương chuyến quy đổi** (`driver_salary`): hệ thống **tự động điền** khi chọn lái xe + nhập ngày đi/về, theo công thức `baseSalary / 26 × tripWageDays`; BHXH được hạch toán riêng. Kế toán có thể sửa/ghi đè. Chỉ áp dụng cho Xe nhà. *(Pete xác nhận 12/6)*
  - **Số ngày tính lương** (`trip_wage_days`): hệ thống tự tính `daysBetween(departure, arrival) + 1`. Kế toán có thể ghi đè.
  - **Các container** (tùy chọn): mỗi dòng gồm Loại container (dropdown từ danh mục — VD: 20'DC, 40'HC), Số container (text nhập tay), Số seal (text nhập tay). Có thể thêm/xóa dòng.
- **Hệ thống tự động:**
  - Tra giá cước từ bảng giá theo Khách hàng × Tuyến đường × Ngày
  - Snapshot (chụp) các định mức hiện hành: giá nhiên liệu, định mức có tải/không tải, tiền đường, phí trạm. Giá nhiên liệu snapshot từ `fuel_config.unitPrice` hiện hành; hệ thống cũng có thể đề xuất giá từ `fuel_price_history` theo ngày xuất phát.
  - Sinh mã chuyến tự động: `TRP-YYYYMM-NNNN`
- **Kết quả:** Chuyến có trạng thái `CREATED`, xuất hiện trong hàng đợi Điều vận

#### Bước 2: Điều vận / Xuất phát (IN_TRANSIT)
- **Ai thực hiện:** Giám đốc hoặc Kế toán
- **Trang:** `/dispatch` → nút **"Khởi hành"**
- **Có thể làm trước khi xuất phát:**
  - Đổi xe/tài xê bằng nút **"Đổi xe"**
  - Chỉnh sửa số liệu chuyến tại `/trips/:id/edit`
- **Kết quả:** Trạng thái chuyển sang `IN_TRANSIT`, xe hiển thị "Đang chạy" trên bảng Điều vận

#### Bước 3: Hoàn thành (COMPLETED)
- **Ai thực hiện:** Kế toán hoặc Giám đốc
- **Trang:** `/trips/:id/edit` → nhập số liệu thực tế
- **Thông tin nhập:**
  - Cập nhật các chặng (km thực tế)
  - Số liệu nhiên liệu thực tế
  - Thu phí đường bộ thực tế
  - Hoa hồng chi KH (nếu chưa nhập, hoặc cần điều chỉnh)
  - Lương chuyến quy đổi (hệ thống tự điền, kế toán có thể sửa)
  - Doanh thu cuối cùng
  - **Cập nhật/bổ sung container** (Loại container, Số container nhập tay, Số seal nhập tay — nhập được bởi Kế toán, Giám đốc hoặc Giao nhận)
  - Ảnh bốc xếp (CONTAINER, SEAL). Bên cạnh ảnh, có thể nhập số container/seal bằng text.
- **Điều kiện chuyển trạng thái:**
  - **Ảnh KHÔNG bắt buộc khi hoàn thành** (quyết định B2, 2026-06-18) — có thể đánh dấu "Hoàn thành" mà chưa có ảnh, và bổ sung/sửa ảnh sau.
  - Yêu cầu về ảnh (nếu có) được kiểm tra ở bước **Chốt sổ** (Bước 4).
- **Kết quả:** Trạng thái chuyển sang `COMPLETED`

#### Bước 4: Chốt sổ (LOCKED)
- **Ai thực hiện:** Giám đốc hoặc Kế toán
- **Trang:** `/trips/:id` → nút **"Chốt chuyến"**
- **Quy trình chốt:**
  1. Hệ thống kiểm tra doanh thu > 0
  2. Nếu doanh thu = 0 → hiện cảnh báo "Doanh thu bằng 0. Xác nhận chốt?" → cần xác nhận
  3. **Kiểm tra ảnh bằng chứng:**
     - Phải có **ít nhất 1 ảnh** (loại bất kỳ) mới được chốt.
     - Nếu loại hàng có `requires_photos = true` (vd: chè): phải có thêm **≥1 ảnh CONTAINER** và **≥1 ảnh SEAL**.
     - Quản trị/Giám đốc có thể ghi đè bằng "Xác nhận chốt không ảnh" (cùng cơ chế với xác nhận doanh thu = 0).
  4. Hệ thống ghi sổ cái:
     - **Nợ Khách hàng** (TRIP_REVENUE): tăng công nợ = doanh thu (gồm VAT). Doanh thu thực tế nội bộ = freightExVat − customerCommission.
     - **Có Lái xe** (DRIVER_SALARY): tăng lương = lương chuyến quy đổi
  5. Ghi nhật ký kiểm toán
- **Kết quả:** Trạng thái `LOCKED` — **không thể sửa đổi**, số liệu đã ghi sổ

#### Bước 5: Hủy chuyến (CANCELED)
- **Ai thực hiện:** **Chỉ Giám đốc**
- **Trang:** `/trips/:id` → nút **"Hủy"**
- **Điều kiện:** Không thể hủy từ trạng thái `LOCKED`
- **Kết quả:** Tất cả số liệu tài chính về 0

---

## 3. Luồng Giám đốc (giamdoc)

### 3.1 Đăng nhập

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Mở trang chủ → chuyển hướng đến `/login` | Hiện form đăng nhập |
| 2 | Nhấn chip **giamdoc** (hoặc nhập `giamdoc` / `admin123`) | Tự động điền thông tin |
| 3 | Nhấn **"Đăng nhập"** | Chuyển đến `/dashboard` |

### 3.2 Dashboard — Tổng quan kinh doanh

**Trang:** `/dashboard`

| KPI | Mô tả |
|-----|-------|
| Doanh thu tháng | Tổng doanh thu, so với tháng trước (% tăng/giảm) |
| Tổng chi phí | Tổng chi phí + tỷ lệ chi/doanh thu |
| Lợi nhuận gộp | Doanh thu − Chi phí trực tiếp + biên lợi nhuận |
| Lợi nhuận ròng | Sau khi trừ phí quản lý + thu nhập khác |

**Biểu đồ:**
- **Biểu đồ đường 12 tháng:** Doanh thu & Lợi nhuận gộp
- **Biểu đồ donut cơ cấu chi phí:** Nhiên liệu / Lương lái xe / Tiền đi đường / Phí quản lý / Bảo dưỡng / Khác
- **Biểu đồ ngang lợi nhuận theo xe:** Top 5 xe đầu kéo
- **Bảng xếp hạng tuyến sinh lời:** Top 5 tuyến đường

**Cảnh báo (Cần chú ý):**
- 🔴 Khách hàng quá hạn công nợ
- 🟡 Chuyến chờ điều vận
- 📊 Sẵn sàng phân bổ lợi nhuận

### 3.3 Điều vận xe

**Trang:** `/dispatch`

#### Xem trạng thái đội xe

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/dispatch` | Hiện 5 KPI: Tỷ lệ vận dụng, Tổng đội xe, Đang chạy, Sẵn sàng, Cần lưu ý |
| 2 | Nhấn tab **"Đang chạy"** | Chỉ hiện xe đang IN_TRANSIT |
| 3 | Nhấn tab **"Sẵn sàng"** | Chỉ hiện xe sẵn sàng nhận lệnh |
| 4 | Nhấn tab **"Chưa giao lái xe"** | Xe chưa phân công lái xe |

#### Phân công xe và xuất phát

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Tại phần **"Đơn hàng cần điều vận"**, xem chuyến ở trạng thái CREATED | Hiện danh sách chuyến chờ xuất phát |
| 2 | Nếu chưa gắn xe → nhấn **"Đổi xe"** → chọn xe và lái xe | Cập nhật phân công |
| 3 | Nhấn nút xanh **"Khởi hành"** | Hộp thoại xác nhận |
| 4 | Xác nhận | Chuyến chuyển sang IN_TRANSIT, xe chuyển sang "Đang chạy" |

#### Tạo chuyến mới

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Nhấn **"Tạo chuyến mới"** | Chuyển đến `/trips/new` |
| 2 | Chọn Khách hàng, Tuyến đường, Xe, Lái xe | Các dropdown populate từ danh mục |
| 3 | Nhập Ngày xuất phát, chọn Ro-mooc, Loại hàng | |
| 4 | Thêm chặng (origin, destination, km, hàng/vỏ) | Hệ thống tự tính nhiên liệu |
| 5 | Nhấn **"Tạo chuyến"** | Tạo thành công → chuyển đến `/trips/:id` |

### 3.4 Quản lý chuyến xe

**Trang:** `/trips`

#### Danh sách chuyến

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/trips` | Bảng liệt kê tất cả chuyến với trạng thái, doanh thu, chi phí, lợi nhuận |
| 2 | Lọc theo trạng thái (CREATED, IN_TRANSIT, COMPLETED, LOCKED, CANCELED) | Danh sách cập nhật |
| 3 | Nhấn vào một chuyến | Chuyển đến chi tiết chuyến `/trips/:id` |

#### Sửa chuyến

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Tại chi tiết chuyến, nhấn **"Chỉnh sửa"** | Chuyển đến `/trips/:id/edit` |
| 2 | Sửa chặng, nhiên liệu, chi phí, doanh thu | Số liệu cập nhật |
| 3 | Nhấn **"Lưu"** | Lưu thành công (nếu không xung đột phiên bản) |
| | Nếu có người khác đã sửa → hiện lỗi 409 | "Có người khác đã cập nhật chuyến này. Tải lại?" |

#### Chốt chuyến

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Tại chuyến COMPLETED, nhấn **"Chốt chuyến"** | Hệ thống kiểm tra doanh thu |
| 2a | Nếu doanh thu > 0 | Xác nhận → chuyến chuyển sang LOCKED, ghi sổ cái |
| 2b | Nếu doanh thu = 0 | Cảnh báo → xác nhận "Doanh thu bằng 0. Xác nhận chốt?" → LOCKED |

#### Hủy chuyến (chỉ Giám đốc)

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Tại chuyến CREATED/IN_TRANSIT/COMPLETED, nhấn **"Hủy chuyến"** | Hộp thoại xác nhận |
| 2 | Xác nhận | Chuyến chuyển sang CANCELED, mọi số liệu về 0 |
| | Nếu chuyến đã LOCKED | Nút "Hủy" không khả dụng |

### 3.5 Tài chính — Báo cáo Lãi lỗ

**Trang:** `/finance`

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/finance` | Hiện báo cáo P&L tháng hiện tại |
| 2 | Chọn tháng/năm khác | Báo cáo cập nhật |
| 3 | Xem biểu đồ doanh thu 12 tháng | Xu hướng doanh thu |
| 4 | Xem bảng phân tích theo xe | Doanh thu, chi phí, lợi nhuận gộp mỗi xe |
| 5 | Nhấn **"Xuất CSV"** hoặc **"In PDF"** | Tải file báo cáo |

**Bảng P&L:**
```
Doanh thu vận tải       (+) Doanh thu (ex-VAT)
Hoa hồng chi KH         (−) Khấu trừ trên từng chuyến
─────────────────────────────────────
Doanh thu thực tế       = freightExVat − customerCommission

Chi phí nhiên liệu      (−) Xăng dầu (dùng giá thực tế nếu có, ngược lại giá cấu hình)
Tiền đi đường           (−) Lái xe thực nhận (đã trừ vé công ty)
Tiền vé BOT             (−) Trạm thu phí: số trạm × phí/trạm
Tiền vé công ty         (−) Công ty thanh toán hộ lái xe (tollsDiscount)
Lương lái xe            (−) Lương chuyến quy đổi (driver_salary)
Thưởng giao 2 điểm      (−) Nếu có
Lưu ca xe               (−) Nếu có
─────────────────────────────────────
Tổng chi phí trực tiếp

Biên dịch vụ            (+/−) Lãi từ phí đi kèm: bán ex-VAT − mua incl-VAT
─────────────────────────────────────
LỢI NHUẬN GỘP           = Doanh thu thực tế − Tổng chi phí + Biên dịch vụ

Phí quản lý             (−) Chi phí vận hành
Bảo dưỡng xe            (−) Sửa chữa, bảo hiểm, đăng kiểm, phí đường bộ
─────────────────────────────────────
LỢI NHUẬN RÒNG          = Lợi nhuận gộp − Phí quản lý − Bảo dưỡng + Thu nhập khác
```

### 3.6 Phân bổ lợi nhuận (chỉ Giám đốc)

**Trang:** `/profit`

> ⚠️ Kế toán **không thể** thực hiện chức năng này (bị chặn ở backend).

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/profit` | Hiện lợi nhuận ròng tháng, tỷ lệ cổ đông |
| 2 | Xem thẻ cổ đông: Ông Thương (29.55%), Ông Phụng (70.45%) | Số tiền tương ứng |
| 3 | Chọn Quý/Năm | Hiện lợi nhuận ròng quý đó |
| 4 | Nhấn **"Chốt & phân bổ"** | Xác nhận → tạo bản ghi phân bổ |

### 3.7 Quản lý công nợ

**Trang:** `/debt`

#### Danh sách công nợ

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/debt` | 4 KPI aging: Hiện hành (0-30 ngày), 31-60 ngày, 61-90 ngày, Trên 90 ngày |
| 2 | Xem bảng công nợ khách hàng | Tên, tổng nợ, thanh tiến aging, ngày quá hạn tối đa |
| 3 | Lọc: "Quá hạn" / "Rủi ro cao" | Danh sách lọc |
| 4 | Nhấn vào khách hàng | Chuyển đến `/debt/:id` — sao kê chi tiết |

#### Chi tiết công nợ khách hàng

**Trang:** `/debt/:id`

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Xem sao kê: từng dòng ledger (thu nhập, thanh toán, điều chỉnh) | Running balance |
| 2 | Xem aging buckets | Chi tiết nợ theo thời gian |
| 3 | Nhấn **"Ghi nhận thanh toán"** | Mở form nhập thanh toán |
| 4 | Nhập số tiền, chọn chuyến phân bổ | Ghi nhận → sổ cái cập nhật |
| 5 | Nhấn **"Điều chỉnh"** | Tạo bút toán điều chỉnh (ghi nợ / ghi có) |

### 3.8 Kỷ luật lái xe

**Trang:** `/penalties`

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/penalties` | KPI: số vi phạm tháng, tổng tiền phạt, lái xe tuân thủ |
| 2 | Xem bảng xếp hạng lái xe | Hạng, tên, chuỗi an toàn, vi phạm, điểm xếp loại (A+/A/B/C) |
| 3 | Xem lịch sử vi phạm | Lái xe, chuyến, lý do, số tiền, ngày |
| 4 | Nhấn **"Tạo phạt mới"** | Mở drawer form |
| 5 | Chọn lái xe, chuyến, lý do, nhập số tiền | Tạo phạt → ghi sổ cái DRIVER |

### 3.9 Cấu hình hệ thống

**Trang:** `/config` — 13 danh mục cấu hình

| Danh mục | Mô tả | Sử dụng khi |
|----------|-------|-------------|
| Định mức dầu | Định mức có tải/không tải (lit/100km), giá nhiên liệu, lịch sử giá (append-only) | Tính chi phí nhiên liệu, đề xuất giá theo ngày xuất phát |
| Tiền đi đường | Mức phụ cấp theo Tuyến × Loại ro-mooc | Tính chi phí đường bộ |
| Bảng giá cước | Giá theo Khách hàng × Tuyến đường | Tự động điền doanh thu khi tạo chuyến |
| Tuyến đường | Tên, km, núi/đồng bằng, phụ cấp nhiên liệu fixed | Tạo chuyến, tra giá |
| Xe đầu kéo | Biển số, trạng thái (Hoạt động/Bảo trì/Ngưng) | Điều vận |
| Ro-mooc | Biển số, loại (20FT/40FT) | Tạo chuyến |
| Lái xe | Tên, SĐT, lương cơ bản, xe phân công | Điều vận, tính lương |
| Khách hàng | Tên, MST, liên hệ, hạn mức tín dụng | Tạo chuyến, công nợ |
| Loại hàng hóa | Phân loại hàng (vd: chè yêu cầu ảnh) | Tạo chuyến, validation ảnh |
| Loại container | Mã, tên hiển thị, kích thước nhóm (20FT/40FT), trạng thái | Nhập container trong chuyến (20'DC, 20'OT, 20'RF, 40'DC, 40'HC...) |
| Cảng / Bãi | Tên, địa chỉ, ghi chú, trạng thái | Chọn điểm đi/đến trong chặng (combobox: dropdown + nhập mới) |
| Cổ đông | Tên, tỷ lệ sở hữu, ngày hiệu lực | Phân bổ lợi nhuận |
| Lý do phạt | Nội dung vi phạm, mức tiền mặc định | Tạo phạt |
| Phí quản lý | Số tiền phí theo tháng/năm | Báo cáo P&L |

### 3.10 Đội xe

**Trang:** `/fleet`

Quản lý 3 loại thực thể trong 1 trang:
- **Xe đầu kéo:** Thêm/sửa/xóa, trạng thái, lái xe gắn
- **Ro-mooc:** Thêm/sửa/xóa, loại 20FT/40FT
- **Lái xe:** Thêm/sửa/xóa, SĐT, lương cơ bản, xe phân công, tìm kiếm

---

## 4. Luồng Kế toán (ketoan)

### 4.1 Đăng nhập

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Nhấn chip **ketoan** trên trang đăng nhập | Tự động điền `ketoan` / `admin123` |
| 2 | Nhấn **"Đăng nhập"** | Chuyển đến `/dashboard` |

### 4.2 Tạo chuyến mới — Luồng chi tiết

Đây là nghiệp vụ chính của Kế toán.

| Bước | Hành động | Chi tiết | Kết quả mong đợi |
|------|-----------|----------|-------------------|
| 1 | Vào `/dispatch` → **"Tạo chuyến mới"** hoặc `/trips/new` | | Form tạo chuyến |
| 2 | Chọn **Khách hàng** | Dropdown từ danh mục | Hiện tên khách hàng |
| 3 | Chọn **Tuyến đường** | Dropdown từ danh mục | Hiện km, loại (núi/đồng bằng) |
| 4 | Chọn **Xe đầu kéo** | Chỉ hiện xe ACTIVE | Biển số hiển thị |
| 5 | Chọn **Lái xe** | Gợi ý lái xe gắn xe đã chọn (nếu có) | |
| 6 | Chọn **Ro-mooc** | 20FT hoặc 40FT | |
| 7 | Chọn **Loại hàng hóa** | | |
| 8 | Nhập **Ngày xuất phát** | | |
| 9 | **Thêm chặng** | Nhấn "Thêm chặng" → nhập điểm đi, điểm đến, km, loại xếp hàng (HÀNG/VỎ) | Hệ thống tự tính nhiên liệu mỗi chặng |
| 10 | Chọn **Chế độ nhiên liệu** | TỰ ĐỘNG (tính theo định mức) hoặc KHOÁN (nhập tay) | |
| 11 | **Doanh thu** | Tự động tra bảng giá. Nếu muốn ghi đè → nhập giá mới | Badge "Giá tự động: X VNĐ" hoặc "Ghi đè" |
| 12 | Nhập **Mã tham chiếu** khách hàng (nếu có) | | |
| 13 | **Nhập thông tin container** (tùy chọn) | Mỗi dòng: Loại container (dropdown), Số container (text), Số seal (text). Thêm/xóa dòng. | VD: 2×20'DC hoặc 1×40'HC |
| 14 | **Tải ảnh** (nếu cần) | Ảnh CONTAINER, SEAL, hoặc OTHER | |
| 15 | Nhấn **"Tạo chuyến"** | | ✅ Chuyến CREATED, mã `TRP-YYYYMM-NNNN` sinh tự động |

### 4.3 Nhập số liệu thực tế chuyến

Sau khi xe hoàn thành chuyến đi, Kế toán nhập số liệu thực tế.

| Bước | Hành động | Chi tiết | Kết quả mong đợi |
|------|-----------|----------|-------------------|
| 1 | Vào `/trips` → tìm chuyến IN_TRANSIT | Lọc "Đang chạy" | |
| 2 | Nhấn vào chuyến → **"Chỉnh sửa"** | `/trips/:id/edit` | |
| 3 | Cập nhật **chặng thực tế** | Km thực tế, có thể thêm/xóa chặng | Tổng km cập nhật |
| 4 | Kiểm tra **nhiên liệu** | Xem tổng tự tính hoặc nhập tay nếu KHOÁN | |
| 4a | Nhập **Đơn giá thực tế** (tùy chọn) | Giá thực mua tại trạm (VNĐ/lít). Nút **Đề xuất** tra giá hiệu lực từ lịch sử theo ngày xuất phát. Để trống → dùng giá cấu hình snapshot. Chỉ nhập được trước khi khóa chuyến. | Hệ thống tính lại `totalFuelCost` và `fuelPriceVariance` |
| 5 | Nhập **chi phí đi đường** | Số trạm × phí/trạm, giảm trừ (tiền vé công ty đã thanh toán), cộng thêm | |
| 6 | Cập nhật **doanh thu** (nếu cần) | Nếu giá thực tế khác bảng giá → ghi đè | Hệ thống lưu giá gốc + giá ghi đè |
| 7 | **Cập nhật/bổ sung container** | Loại container (dropdown), Số container (text), Số seal (text) | Nhập được bởi Kế toán, Giám đốc hoặc Giao nhận |
| 8 | **Tải ảnh** (tùy chọn khi hoàn thành) | Ảnh CONTAINER, SEAL. Bên cạnh ảnh, có thể nhập số cont/seal bằng text. Có thể bổ sung/sửa ảnh sau. | |
| 9 | Nhấn **"Lưu"** | | ✅ Chuyến chuyển sang COMPLETED |

> **Lưu ý về ảnh (quyết định B2, 2026-06-18):** Ảnh **không bắt buộc** khi hoàn thành — có thể bổ sung/sửa bất cứ lúc nào trước khi chốt. Yêu cầu về ảnh (kể cả `requiresPhotos = true` như chè) chỉ được kiểm tra ở bước **Chốt sổ** (mục 4.4).

### 4.4 Chốt sổ chuyến

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/trips` → tìm chuyến COMPLETED | |
| 2 | Nhấn vào chuyến → nút **"Chốt chuyến"** | |
| 3a | Nếu doanh thu > 0 → xác nhận | ✅ LOCKED, ghi sổ cái |
| 3b | Nếu doanh thu = 0 → xác nhận "Xác nhận chốt doanh thu = 0?" | ✅ LOCKED |
| 4 | **Kiểm tra ảnh bằng chứng** | Phải có ≥1 ảnh (loại bất kỳ); nếu `requiresPhotos = true` (vd: chè) thì cần thêm ≥1 CONTAINER + ≥1 SEAL. Quản trị/Giám đốc có thể "Xác nhận chốt không ảnh" để ghi đè. |

**Sổ cái ghi nhận khi chốt:**
- **Khách hàng:** Nợ TRIP_REVENUE = doanh thu chuyến
- **Lái xe:** Có DRIVER_SALARY = lương chuyến

### 4.5 Ghi nhận thanh toán

**Trang:** `/debt` → `/debt/:id`

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/debt` → nhấn vào khách hàng | Mở sao kê chi tiết |
| 2 | Xem tổng nợ hiện tại và aging | |
| 3 | Nhấn **"Ghi nhận thanh toán"** | Mở form |
| 4 | Nhập số tiền, chọn chuyến cần phân bổ | Có thể phân bổ cho nhiều chuyến |
| 5 | Xác nhận | ✅ Ghi sổ cái PAYMENT_RECEIVED, giảm công nợ |

### 4.6 Ghi nhận điều chỉnh

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Tại sao kê khách hàng, nhấn **"Điều chỉnh"** | Mở form |
| 2 | Nhập số tiền (dương = Ghi nợ tăng công nợ, âm = Ghi có giảm công nợ) | |
| 3 | Nhập lý do (bắt buộc) | |
| 4 | Xác nhận | ✅ Ghi sổ cái ADJUSTMENT |

### 4.7 Kỷ luật lái xe

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Vào `/penalties` → nhấn **"Tạo phạt mới"** | Mở drawer |
| 2 | Chọn lái xe, chuyến liên quan | |
| 3 | Chọn lý do từ danh mục hoặc nhập tay | |
| 4 | Nhập số tiền phạt | |
| 5 | Xác nhận | ✅ Ghi sổ cái PENALTY, tăng nợ lái xe |

### 4.8 Những gì Kế toán KHÔNG thể làm

| Hành động | Lý do |
|-----------|-------|
| Hủy chuyến | Chỉ Giám đốc/Admin |
| Phân bổ lợi nhuận | Chỉ Giám đốc/Admin |
| Quản lý người dùng | Chỉ Admin |
| Xem nhật ký hoạt động | Chỉ Admin |

---

## 5. Luồng Lái xe (laixe)

### 5.1 Đăng nhập

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Nhấn chip **laixe** trên trang đăng nhập | Tự động điền `laixe` / `admin123` |
| 2 | Nhấn **"Đăng nhập"** | Chuyển đến `/my-trips` (không phải Dashboard) |

> Giao diện lái xe là **mobile-first** — tối ưu cho điện thoại.

### 5.2 Xem lịch trình chuyến

**Trang:** `/my-trips`

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Mở `/my-trips` | Danh sách thẻ chuyến (card layout) |
| 2 | Xem mỗi thẻ | Hiện: ngày, tuyến, biển số xe, nhiên liệu cấp, trạng thái |
| 3 | Nhấn tab **"Sắp chạy"** | Chuyến IN_TRANSIT sắp tới |
| 4 | Nhấn tab **"Đã hoàn thành"** | Chuyến COMPLETED/LOCKED |
| 5 | Nhấn vào một thẻ | Mở chi tiết chuyến `/my-trips/:id` |

### 5.3 Chi tiết chuyến

**Trang:** `/my-trips/:id`

Hiển thị:
- Mã chuyến, ngày xuất phát
- Tuyến đường, thông tin xe và ro-mooc
- Loại hàng hóa
- Các chặng (điểm đi → điểm đến, km, loại xếp hàng)
- Nhiên liệu được cấp (tổng, phân bổ theo chặng)
- **KHÔNG hiện:** doanh thu, chi phí, lợi nhuận, lương chuyến

### 5.4 Xem thu nhập

**Trang:** `/my-earnings`

| KPI | Mô tả |
|-----|-------|
| Thu nhập thực nhận | Lương cơ bản + Thu nhập chuyến − Tổng phạt |
| Lương cơ bản | Lương tháng cố định |
| Thu nhập chuyến | Tổng lương từ các chuyến đã chốt (LOCKED) |
| Tổng phạt | Tổng tiền phạt tháng |

Dưới KPI:
- **Danh sách thu nhập chuyến:** Ngày, tuyến, số tiền
- **Lịch sử phạt:** Lý do, số tiền, ngày

### 5.5 Xem phạt

**Trang:** `/my-penalties`

| Bước | Hành động | Kết quả mong đợi |
|------|-----------|-------------------|
| 1 | Mở `/my-penalties` | Danh sách chỉ đọc các khoản phạt |
| 2 | Xem mỗi khoản | Lý do, số tiền, ngày |

### 5.6 Những gì Lái xe KHÔNG thể truy cập

Lái xe cố gắng truy cập bất kỳ trang quản lý nào → tự động chuyển hướng về `/my-trips`:

- ❌ Dashboard, Điều vận, Đội xe
- ❌ Quản lý chuyến (tạo, sửa, chốt, hủy)
- ❌ Tài chính, Lợi nhuận, Công nợ
- ❌ Phạt (tạo), Cấu hình, Khách hàng
- ❌ Người dùng, Nhật ký

---

## 6. Bảng tra cứu nhanh

### 6.1 Sidebar theo vai trò

**Giám đốc / Kế toán:**
```
📂 VẬN HÀNH
   ├── Dashboard
   ├── Điều vận (số chuyến chờ)
   ├── Đội xe
   ├── Chuyến xe
   └── Kỷ luật (số phạt tháng)

📂 TÀI CHÍNH
   ├── Báo cáo Tài chính (P&L)
   ├── Phân bổ Lợi nhuận
   └── Công nợ

📂 QUẢN TRỊ
   ├── Khách hàng
   ├── Tuyến đường
   └── Cấu hình
```

**Lái xe:**
```
📂 CHUYẾN XE CỦA TÔI
   ├── Lệnh của tôi
   ├── Thu nhập
   └── Phạt
```

### 6.2 API Endpoints theo nghiệp vụ

| Nghiệp vụ | Endpoint | Method |
|-----------|----------|--------|
| Đăng nhập | `/api/auth/login` | POST |
| Dashboard | `/api/reports/dashboard` | GET |
| Tạo chuyến | `/api/trips` | POST |
| Danh sách chuyến | `/api/trips` | GET |
| Chi tiết chuyến | `/api/trips/:id` | GET |
| Sửa chuyến | `/api/trips/:id/pre-departure` hoặc `/actuals` | PUT |
| Xuất phát | `/api/trips/:id/dispatch` | POST |
| Chốt chuyến | `/api/trips/:id/lock` | POST |
| Hủy chuyến | `/api/trips/:id/cancel` | POST |
| Đổi xe/lái xe | `/api/trips/:id/reassign` | PATCH |
| Báo cáo P&L | `/api/reports/pnl` | GET |
| Phân bổ lợi nhuận | `/api/reports/distribute-profit` | POST |
| Danh sách công nợ | `/api/ledger?entity_type=CUSTOMER` | GET |
| Sao kê khách hàng | `/api/ledger/customers/:id/statement` | GET |
| Ghi nhận thanh toán | `/api/payments/receive` | POST |
| Điều chỉnh | `/api/adjustments` | POST |
| Danh sách phạt | `/api/penalties` | GET |
| Tạo phạt | `/api/penalties` | POST |
| Lái xe — chuyến | `/api/driver/me/trips` | GET |
| Lái xe — thu nhập | `/api/driver/me/earnings` | GET |
| Lái xe — phạt | `/api/driver/me/penalties` | GET |
| Tải ảnh lên | `/api/upload` | POST |
| Danh mục bootstrap | `/api/catalogs/bootstrap` | GET |
| Tra giá cước | `/api/pricing?customerId=&routeId=` | GET |

### 6.3 Loại giao dịch sổ cái

| Mã | Mô tả | Ghi khi |
|----|-------|---------|
| `TRIP_REVENUE` | Doanh thu chuyến | Chốt chuyến (LOCK) |
| `PAYMENT_RECEIVED` | Khách thanh toán | Ghi nhận thanh toán |
| `DRIVER_SALARY` | Lương lái xe | Chốt chuyến (LOCK) |
| `PENALTY` | Tiền phạt | Tạo phạt |
| `MANAGEMENT_FEE` | Phí quản lý | Cấu hình phí |
| `ADJUSTMENT` | Điều chỉnh thủ công | Tạo điều chỉnh |

---

## 7. QA Test Checklist

### 7.1 Test đăng nhập

- [ ] Đăng nhập `giamdoc` → chuyển đến `/dashboard`
- [ ] Đăng nhập `ketoan` → chuyển đến `/dashboard`
- [ ] Đăng nhập `laixe` → chuyển đến `/my-trips` (không phải dashboard)
- [ ] Sai mật khẩu → hiện lỗi
- [ ] Token hết hạn → chuyển về `/login`

### 7.2 Test vòng đời chuyến đầy đủ

**Chuẩn bị:** Đảm bảo có sẵn danh mục (khách hàng, tuyến, xe, lái xe, ro-mooc, bảng giá).

- [ ] **Tạo chuyến:** `/trips/new` → điền đủ trường → tạo thành công, mã `TRP-YYYYMM-NNNN`
- [ ] **Kiểm tra tự động điền giá:** Chọn khách hàng + tuyến → doanh thu tự populating từ bảng giá
- [ ] **Sửa trước xuất phát:** Sửa chặng, nhiên liệu → lưu thành công
- [ ] **Điều vận:** `/dispatch` → nhấn "Khởi hành" → trạng thái IN_TRANSIT
- [ ] **Nhập actuals:** Sửa chuyến → cập nhật km thực tế → lưu → trạng thái COMPLETED (nếu đủ ảnh)
- [ ] **Kiểm tra yêu cầu ảnh:** Hàng hóa `requiresPhotos=true` → thiếu ảnh CONTAINER/SEAL → lỗi
- [ ] **Chốt chuyến:** Nhấn "Chốt" → trạng thái LOCKED
- [ ] **Kiểm tra sổ cái:** Sau khi chốt → kiểm tra ledger có TRIP_REVENUE (khách hàng) và DRIVER_SALARY (lái xe)
- [ ] **Không sửa khi LOCKED:** Mở chuyến đã chốt → không thể chỉnh sửa

### 7.3 Test phân quyền

- [ ] **Kế toán hủy chuyến:** Chuyển trạng thái sang CANCELED → bị từ chối (403)
- [ ] **Giám đốc hủy chuyến:** Chuyển sang CANCELED → thành công, số liệu về 0
- [ ] **Kế toán phân bổ lợi nhuận:** `/profit` → nhấn "Chốt & phân bổ" → bị từ chối (403)
- [ ] **Giám đốc phân bổ lợi nhuận:** Thành công
- [ ] **Lái xe truy cập Dashboard:** Nhập URL `/dashboard` → chuyển hướng `/my-trips`
- [ ] **Lái xe truy cập chuyến:** Nhập URL `/trips` → chuyển hướng `/my-trips`
- [ ] **Lái xe không thấy doanh thu:** `/my-trips/:id` → không hiện doanh thu, chi phí, lợi nhuận

### 7.4 Test công nợ

- [ ] **Chốt 2 chuyến cho cùng khách hàng** → kiểm tra công nợ tăng đúng tổng doanh thu 2 chuyến
- [ ] **Ghi nhận thanh toán** → công nợ giảm đúng số tiền
- [ ] **Điều chỉnh (ghi nợ)** → công nợ tăng
- [ ] **Điều chỉnh (ghi có)** → công nợ giảm
- [ ] **Kiểm tra aging:** Chuyến chốt >30 ngày → hiện ở bucket đúng

### 7.5 Test đồng thời (Concurrency)

- [ ] Hai người cùng sửa chuyến → người sau nhận lỗi 409 "Dữ liệu đã bị thay đổi"
- [ ] Hai chuyến cùng khách hàng chốt cùng lúc → sổ cái không bị deadlock

### 7.6 Test kỷ luật

- [ ] Tạo phạt → kiểm tra sổ cái lái xe tăng nợ
- [ ] Kiểm tra `/my-earnings` → tổng phạt phản ánh đúng
- [ ] Kiểm tra `/my-penalties` → lái xe xem được phạt của mình

### 7.7 Test Dashboard

- [ ] KPI doanh thu khớp tổng doanh thu chuyến LOCKED tháng
- [ ] KPI chi phí khớp tổng chi phí chuyến LOCKED tháng
- [ ] Biểu đồ 12 tháng hiện đúng dữ liệu
- [ ] Cảnh báo công nợ quá hạn hiện đúng khách hàng

### 7.8 Test Cấu hình

- [ ] Sửa định mức nhiên liệu → tạo chuyến mới → kiểm tra snapshot đúng định mức mới
- [ ] Chuyến cũ (đã tạo) → định mức không thay đổi (snapshot tại thời điểm tạo)
- [ ] Thêm tuyến đường → tạo chuyến → chọn được tuyến mới
- [ ] CRUD đầy đủ: Thêm → Sửa → Xóa mỗi loại danh mục

### 7.8a Test Điều chỉnh giá nhiên liệu

- [ ] **Nhập giá thực tế:** Mở form nhập liệu chuyến → nhập `fuelActualUnitPrice` khác `fuelPriceApplied` → `totalFuelCost` tính theo giá thực tế
- [ ] **Đề xuất giá:** Nhấn nút **Đề xuất** → hệ thống tra `fuel_price_history` theo ngày xuất phát → tự điền giá hiệu lực
- [ ] **Để trống giá thực tế:** Không nhập → `totalFuelCost` tính theo `fuelPriceApplied` (giá cấu hình snapshot)
- [ ] **Chênh lệch hiển thị:** Khi có giá thực tế → `fuelPriceVariance` hiển thị trên thẻ chuyến
- [ ] **Tính lại khi đổi giá:** Đổi `fuelActualUnitPrice` → `totalFuelCost`, `totalCost`, `grossProfit` tự cập nhật
- [ ] **Khóa chuyến:** Chuyến LOCKED → không thể nhập/sửa giá thực tế
- [ ] **Chuyến cũ:** Chuyến tạo trước khi có tính năng → để trống `fuelActualUnitPrice` → dùng giá cấu hình như cũ

### 7.9 Test Upload ảnh

- [ ] Tải ảnh JPEG → thành công
- [ ] Tải ảnh HEIC → tự động chuyển sang JPEG
- [ ] Tải ảnh >15MB → bị từ chối
- [ ] Tải file không phải ảnh → bị từ chối
- [ ] Xem ảnh trong chi tiết chuyến → hiển thị đúng

### 7.10 Test giao diện mobile (Lái xe)

- [ ] `/my-trips` hiển thị dạng thẻ (card), không phải bảng
- [ ] Tab "Sắp chạy" / "Đã hoàn thành" hoạt động đúng
- [ ] Nhấn thẻ → mở chi tiết chuyến
- [ ] `/my-earnings` hiện tổng thu nhập, breakdown, lịch sử phạt
- [ ] `/my-penalties` hiện danh sách chỉ đọc
