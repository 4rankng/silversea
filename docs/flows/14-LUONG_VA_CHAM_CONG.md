# Flow 14: Quản Lý Lương & Chấm Công Tài Xế

> **Nguồn gốc:** Dựa trên đề xuất thiết kế "Quản Lý Lương & Chấm Công Tài Xế" (phiên bản 4/6/2026), đã được Pete xác nhận các điểm chính.

---

## 1. Tổng Quan Nghiệp Vụ

Hệ thống chấm công & tính lương giải quyết bài toán cân đối giữa:
- **Chi phí phân bổ theo chuyến** (ghi nhận vào P&L từng chuyến)
- **Lương tháng thực nhận** (bao gồm những ngày sửa xe, chờ việc mà lái xe vẫn hưởng lương)

Hai luồng song song:
1. **Chuyến đi thực tế** — tự động từ dữ liệu vận hành
2. **Lịch chấm công cá nhân** — kế toán xác nhận/điều chỉnh cuối tháng

---

## 2. Mô Hình Dữ Liệu

### 2.1 Trạng thái ngày công (`WorkDayStatus`)

| Mã | Tên | Mô tả | Ai ghi |
|---|---|---|---|
| `TRIP_DAY` | Ngày đi chuyến | Hệ thống tự ghi khi lái xe có chuyến bắt đầu/đang chạy trong ngày | Tự động |
| `STANDBY` | Chờ việc / Sửa xe | Trực bãi, xe hỏng, không có hàng — vẫn hưởng lương đầy đủ | Kế toán |
| `PERSONAL_LEAVE` | Nghỉ việc riêng | Tự xin nghỉ không lương | Kế toán |
| `WEEKLY_OFF` | Nghỉ tuần | Mặc định Chủ nhật hoặc nghỉ bù theo lịch — hệ thống tự tạo | Tự động |

> **Lưu ý Chủ nhật xuyên chuyến:** Nếu lái xe đang chạy chuyến kéo dài qua ngày Chủ nhật, ngày đó được tính là `TRIP_DAY` (ngày làm việc bình thường, không phải nghỉ tuần).

### 2.2 Bảng `driver_work_days`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | serial PK | |
| `driver_id` | integer FK → drivers | |
| `date` | date | Ngày cụ thể |
| `status` | enum WorkDayStatus | `TRIP_DAY` / `STANDBY` / `PERSONAL_LEAVE` / `WEEKLY_OFF` |
| `trip_id` | integer FK → trips (nullable) | Liên kết chuyến nếu `TRIP_DAY` |
| `note` | text (nullable) | Ghi chú kế toán (VD: "Sửa chữa gầm", "Trực bãi") |
| `created_by` | integer FK → users | |
| `created_at` | timestamptz | |

### 2.3 Bảng `salary_periods`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | serial PK | |
| `driver_id` | integer FK → drivers | |
| `year` | integer | |
| `month` | integer | 1–12 |
| `standard_work_days` | integer | Số ngày công chuẩn = số ngày trong tháng - số ngày Chủ nhật |
| `base_salary` | bigint | Lương cứng hàng tháng (VNĐ, theo cấu hình driver) |
| `daily_rate` | bigint | `base_salary / standard_work_days` (làm tròn; BHXH hạch toán riêng) |
| `trip_days` | integer | Số ngày đi chuyến |
| `standby_days` | integer | Số ngày chờ việc/sửa xe |
| `personal_leave_days` | integer | Số ngày nghỉ việc riêng |
| `total_trip_salary` | bigint | Σ `driver_salary` từ các chuyến đã khóa (LOCKED) trong kỳ |
| `adjustment` | bigint | Điều chỉnh công thiếu/thừa (có thể âm) |
| `penalties` | bigint | Tổng tiền phạt kỷ luật trong kỳ |
| `social_insurance` | bigint | BHXH/BHYT phần doanh nghiệp đóng (tùy cấu hình) |
| `net_salary` | bigint | Lương thực trả (xem công thức §3.1) |
| `standby_cost` | bigint | Chi phí chờ việc = `standby_days × daily_rate` (hạch toán vào chi phí chung) |
| `status` | enum | `DRAFT` / `CONFIRMED` |
| `confirmed_by` | integer FK → users (nullable) | |
| `confirmed_at` | timestamptz (nullable) | |

---

## 3. Công Thức Tính Lương

### 3.1 Lương thực nhận

```
Ngày công hưởng lương = trip_days + standby_days

daily_rate = base_salary / standard_work_days

Điều chỉnh:
  Nếu ngày công hưởng lương < standard_work_days:
    adjustment = -((standard_work_days - ngày công hưởng lương) × daily_rate)
  Nếu ngày công hưởng lương > standard_work_days:
    adjustment = +((ngày công hưởng lương - standard_work_days) × daily_rate)
  Nếu bằng nhau:
    adjustment = 0

net_salary = base_salary + adjustment - penalties

*Lưu ý: Các khoản Lương chuyến (total_trip_salary) và Chi phí chờ việc (standby_cost) là các khoản phân bổ để hạch toán chi phí công ty, KHÔNG cộng vào `net_salary` của lái xe.*
```

> **BHXH/BHYT:** Phần doanh nghiệp đóng (`social_insurance`) được cấu hình cho từng lái xe trên trang Cấu hình → Lái xe, lưu trong cột `drivers.social_insurance`, và hạch toán riêng vào chi phí doanh nghiệp. Khoản này không cộng vào `base_salary`, `daily_rate`, lương chuyến hoặc lương thực trả. *(Pete xác nhận 11/6, cập nhật 12/6)*

> **Điều chỉnh ngày công:** Khi lái xe nghỉ không lương (`PERSONAL_LEAVE`), số ngày công hưởng lương sẽ giảm xuống dưới chuẩn, hệ thống tự động trừ tiền qua `adjustment`. Ngược lại, nếu lái xe đi làm vào ngày Chủ nhật (WEEKLY_OFF) và không nghỉ bù, số ngày công sẽ lớn hơn chuẩn, hệ thống tự động cộng tiền thêm (hệ số 1).

### 3.2 Số ngày công chuẩn (`standard_work_days`)

- **Tính theo thực tế từng tháng**: tổng số ngày trong tháng − số ngày Chủ nhật của tháng đó.
- Không cố định 26 ngày. Tháng có 27 ngày làm → tính lương thêm; tháng có 24 ngày làm → giảm tương ứng.

Ví dụ:
- Tháng 6/2026 (30 ngày, 4 CN): standard = 26
- Tháng 2/2026 (28 ngày, 4 CN): standard = 24

### 3.3 Phân bổ chi phí vào P&L

| Loại chi phí | Hạch toán | Ghi chú |
|---|---|---|
| **Nhân công trực tiếp** | Vào từng chuyến: `driver_salary` (kết hợp/thưởng) | Kế toán nhập thủ công trên form chuyến |
| **Nhân công gián tiếp (chờ việc)** | Vào chi phí chung tháng: `standby_days × daily_rate` | Không gán vào bất kỳ chuyến nào |

> **Lý do tách biệt:** Nếu gắn chi phí chờ việc vào chuyến cụ thể, hiệu quả kinh tế từng chuyến sẽ bị méo. Khoản này hạch toán vào chi phí quản lý đội xe chung của tháng trong báo cáo lãi lỗ.

---

## 4. Giao Diện Chấm Công

### 4.1 Màn hình lịch chấm công tháng

```
URL: /salary/:driverId/:year/:month
Quyền truy cập: ACCOUNTANT, MANAGER
```

Layout:
```
┌──────────────────────────────────────────────────────┐
│  Nguyễn Văn A  │  Tháng 6/2026  │  [< Prev] [Next >] │
├──────────────────────────────────────────────────────┤
│  Lịch tháng (Calendar Grid)                          │
│  T2   T3   T4   T5   T6   T7   CN                   │
│   1    2    3    4    5    6    7                    │
│  [🚛] [🚛] [⏳] [⏳] [⏳] [⏳] [💤]                │
│   8    9   10   11   12   13   14                   │
│  [🚛] [🚛] [🚛] [🚛] [🚛] [🏖] [💤]                │
├──────────────────────────────────────────────────────┤
│  Legend: 🚛 Đi chuyến  ⏳ Chờ việc  🏖 Nghỉ riêng  💤 Nghỉ tuần │
├──────────────────────────────────────────────────────┤
│  Tổng kết tháng:                                     │
│  Ngày đi chuyến: 18  │  Ngày chờ việc: 4           │
│  Ngày nghỉ riêng: 2  │  Ngày công chuẩn: 26        │
│  Lương cứng: 10,000,000 ₫                          │
│  Điều chỉnh (thiếu công): -769,230 ₫               │
│  Phạt: -500,000 ₫                                  │
│  ─────────────────────────────────────────          │
│  Lương thực nhận: 8,730,770 ₫                      │
│                                                    │
│  (Phân bổ chi phí nội bộ:                          │
│   Lương chuyến: 6,923,076 ₫                        │
│   Lương chờ việc: 1,538,461 ₫)                     │
│                              [Xác nhận kỳ lương]   │
└──────────────────────────────────────────────────────┘
```

### 4.2 Tương tác trên lịch

- **Ngày TRIP_DAY (tự động):** Click → tooltip hiển thị tên chuyến + tuyến đường. Không thể thay đổi.
- **Ngày trống / WEEKLY_OFF:** Click để chuyển vòng: `STANDBY → PERSONAL_LEAVE → (trống)`.
- **Ghi chú:** Hover vào ngày STANDBY → icon bút → nhập ghi chú ngắn (VD: "Sửa chữa gầm", "Trực bãi Đình Vũ").

### 4.3 Trường bổ sung trên form chuyến — Lương quy đổi tự động

| Trường | Loại | Ghi chú |
|---|---|---|
| `driver_salary` (Lương chuyến quy đổi) | Number | **Hệ thống tự điền** theo công thức `baseSalary / 26 × tripWageDays`. Kế toán có thể sửa/ghi đè. Đây là khoản phân bổ chi phí nội bộ. |
| `trip_wage_days` | Number | **Hệ thống tự tính** từ ngày đi → ngày về (`daysBetween(departure, arrival) + 1`). Kế toán có thể điều chỉnh khi chuyến kéo dài xuyên Chủ nhật. |

> **Luồng tự điền:** Khi kế toán chọn lái xe và nhập ngày đi/ngày về trên form chuyến → hệ thống load `baseSalary` của lái xe → tính `tripWageDays` → tự điền `driver_salary` theo mẫu số cố định 26. Kế toán thấy ngay số tiền gợi ý, có thể sửa lại hoặc điều chỉnh số ngày. Mẫu số `standardWorkDays` biến động theo tháng chỉ dùng cho chấm công/lương tháng. *(Pete xác nhận 11/6: "tự nhảy", giống chi phí xăng dầu và vé cầu đường)*

### 4.4 BHXH/BHYT cấu hình theo lái xe

| Trường | Vị trí | Ghi chú |
|---|---|---|
| `social_insurance` (BHXH/BHYT) | Cấu hình → Lái xe → cột "BHXH" | Phần doanh nghiệp đóng, cấu hình riêng cho từng lái xe. Mặc định 0. |

> `social_insurance` được hạch toán riêng, không tham gia lương chuyến quy đổi. Lương chuyến dùng `base_salary / 26`.

---

## 5. Luồng Nghiệp Vụ

### 5.1 Tự động cập nhật ngày công

```
Khi chuyến chuyển sang IN_TRANSIT hoặc COMPLETED:
  → Duyệt các ngày trong [departure_date, actual_arrival_date]
  → Tạo/cập nhật driver_work_days với status=TRIP_DAY
  → Nếu ngày là CN mà xe đang chạy chuyến → vẫn ghi TRIP_DAY (ghi đè WEEKLY_OFF)
  → Liên kết trip_id cho từng bản ghi

Khi chuyến bị HỦY:
  → Xóa tất cả bản ghi TRIP_DAY có trip_id tương ứng
```

### 5.2 Kế toán chấm công cuối tháng

```
Kế toán mở /salary/:driverId/:year/:month
  → Xem lịch với TRIP_DAY đã tự điền
  → Click ngày còn lại: gán STANDBY hoặc PERSONAL_LEAVE
  → Thêm ghi chú nếu cần
  → Xem tổng kết tự động (real-time)
  → Nhấn [Xác nhận kỳ lương]
    → salary_periods.status = CONFIRMED
    → Tạo expense record "Chi phí chờ việc" (standby_cost) vào chi phí chung tháng
    → Ghi ledger entry tương ứng
```

### 5.3 API tính lương

```
GET /api/salary/:driverId/:year/:month
  → Tổng hợp driver_work_days của kỳ
  → Lấy Σ driver_salary từ trips LOCKED trong [first_day, last_day]
  → standard_work_days = calendar_days(month) - count_sundays(month)
  → daily_rate = round(base_salary / standard_work_days)
  → Tính adjustment
  → Trả về salary_period (DRAFT hoặc CONFIRMED)
```

### 5.4 Driver Mobile — xem thu nhập

```
Driver mở /my-earnings?month=2026-06
  → GET /api/driver/me/earnings?month=2026-06
  → Hiển thị breakdown:
     - Lương cứng (base_salary)
     - Điều chỉnh công thiếu/thừa (adjustment)
     - Phạt kỷ luật (penalties)
     - Lương thực nhận (net_salary)
  → Chỉ xem — không có quyền sửa
```

---

## 6. API Endpoints

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/salary` | MANAGER | Danh sách kỳ lương tất cả lái xe (lọc theo tháng) |
| GET | `/api/salary/:driverId/:year/:month` | ACCOUNTANT, MANAGER | Xem tổng kết lương tháng của lái xe |
| PUT | `/api/salary/:driverId/:year/:month/workdays` | ACCOUNTANT | Cập nhật hàng loạt ngày công (array diff) |
| POST | `/api/salary/:driverId/:year/:month/confirm` | ACCOUNTANT, MANAGER | Xác nhận kỳ lương (DRAFT → CONFIRMED) |
| GET | `/api/driver/me/earnings` | DRIVER | Xem thu nhập cá nhân (scope theo userId) |

---

## 7. Tích Hợp P&L

Sau khi xác nhận kỳ lương:

1. **Chi phí nhân công trực tiếp** → đã nằm trong `driver_salary` trên từng chuyến.
2. **Chi phí chờ việc (gián tiếp)** → hệ thống tạo bản ghi trong bảng `expenses`:
   - `truck_id = null` (chi phí chung)
   - `category = STANDBY_LABOR`
   - `amount = standby_cost`
   - `payment_status = PAID` (không tạo công nợ NCC)
   - Gắn tháng/năm của kỳ lương
   - Hiển thị trong P&L như "Chi phí nhân công gián tiếp"

---

## 8. Phân Quyền

| Hành động | DRIVER | ACCOUNTANT | MANAGER |
|---|---|---|---|
| Xem lịch chấm công (của mình) | Chỉ xem | Xem + sửa | Xem + sửa |
| Chỉnh sửa ngày công | Không | Có | Có |
| Xác nhận kỳ lương | Không | Có | Có |
| Xem thu nhập (của mình) | /my-earnings | Có | Có |
| Xem thu nhập tất cả lái xe | Không | Có | Có |

---

## 9. QA Test Checklist

### 9.1 Tự động điền ngày công

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|---|---|---|---|---|---|
| TC-LC-001 | Chuyến → TRIP_DAY tự điền | Chuyến IN_TRANSIT, lái xe A | Chuyển sang IN_TRANSIT | Ngày xuất phát ghi TRIP_DAY cho lái xe A | High |
| TC-LC-002 | Chuyến dài xuyên CN | Chuyến T7→T2 (3 ngày), xuyên CN | Xem lịch | CN được ghi TRIP_DAY, không phải WEEKLY_OFF | High |
| TC-LC-003 | Hủy chuyến → xóa TRIP_DAY | Chuyến đã ghi TRIP_DAY | Hủy chuyến | Các ngày TRIP_DAY của chuyến đó bị xóa | High |
| TC-LC-004 | CN không có chuyến | Chủ nhật không có chuyến | Xem lịch | Ghi WEEKLY_OFF | Medium |

### 9.2 Tính lương

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|---|---|---|---|---|---|
| TC-LC-010 | Đủ công, không nghỉ | 26 ngày công, 0 nghỉ riêng | Xem kỳ lương | adjustment = 0, net = base - penalties | High |
| TC-LC-011 | Nghỉ riêng 2 ngày | standard=26, personal_leave=2 | Xem kỳ lương | adjustment = -(2 × daily_rate), net = base + adj | High |
| TC-LC-012 | Chạy thêm CN (dôi công) | trip_days+standby=28, standard=26 | Xem kỳ lương | adjustment = +(2 × daily_rate), net = base + adj | High |
| TC-LC-013 | Xe hỏng, trực bãi đủ tháng | trip_days=10, standby=16, standard=26 | Xem kỳ lương | adjustment = 0, nhận đủ base_salary | High |
| TC-LC-014 | BHXH không cộng vào daily_rate | social_insurance được cấu hình | daily_rate tính | daily_rate = base / standard; BHXH hạch toán riêng | Medium |
| TC-LC-015 | standard_work_days theo tháng thực | Tháng 2/2026 = 28 ngày, 4 CN | Tạo kỳ lương | standard = 24 | High |

### 9.3 Giao diện lịch chấm công

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|---|---|---|---|---|---|
| TC-LC-020 | Hiển thị lịch tháng | Có data chuyến | Mở lịch | Calendar grid, TRIP_DAY tô màu | High |
| TC-LC-021 | Click ngày trống → STANDBY | Ngày trống | Click ngày | Chuyển sang STANDBY | High |
| TC-LC-022 | Click STANDBY → PERSONAL_LEAVE | Ngày STANDBY | Click ngày | Chuyển sang PERSONAL_LEAVE | High |
| TC-LC-023 | Click PERSONAL_LEAVE → trống | Ngày PERSONAL_LEAVE | Click ngày | Trở về trạng thái trống | Medium |
| TC-LC-024 | TRIP_DAY không thay đổi khi click | Ngày TRIP_DAY | Click ngày | Tooltip tên chuyến + tuyến, không đổi trạng thái | High |
| TC-LC-025 | Xác nhận kỳ lương | Đã chấm công đủ | Nhấn Xác nhận | status=CONFIRMED, ô chấm công bị khóa | High |

### 9.4 Driver Mobile — Thu nhập

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|---|---|---|---|---|---|
| TC-LC-030 | Xem thu nhập đủ breakdown | DRIVER đăng nhập | Mở /my-earnings | Hiển thị base, trip, adjustment, penalties, net | High |
| TC-LC-031 | Lọc theo tháng | Nhiều tháng dữ liệu | Chọn tháng 5 | Chỉ hiển thị dữ liệu tháng 5 | Medium |
| TC-LC-032 | Scope cá nhân | DRIVER A | GET /api/driver/me/earnings | Chỉ thấy data của mình | High |
| TC-LC-033 | Hiển thị điều chỉnh âm | personal_leave=3, standard=26 | Xem thu nhập | Điều chỉnh hiển thị số âm màu đỏ | Medium |

---

## 10. Quyết Định Đã Xác Nhận

| # | Quyết định | Xác nhận bởi | Ngày |
|---|---|---|---|
| 1 | BHXH phần doanh nghiệp cộng vào tổng lương trước khi tính daily_rate để phân bổ đúng | Pete | 4/6/2026 |
| 2 | `standard_work_days` tính theo số ngày thực tế từng tháng trừ Chủ nhật (không cố định 26) | Pete | 4/6/2026 |
| 3 | Chỉ kế toán mới được chấm công; lái xe chỉ có quyền xem | Pete | 4/6/2026 |
| 4 | Chủ nhật đang trong chuyến → tính là `TRIP_DAY` (ngày làm việc bình thường) | Pete | 4/6/2026 |
| 5 | Lương chuyến quy đổi: **hệ thống tự điền** theo công thức `base/26×days`; BHXH hạch toán riêng, kế toán có thể sửa/ghi đè | Pete | 11/6/2026 |
| 6 | Chi phí chờ việc (standby_cost) hạch toán vào chi phí chung, không gán vào chuyến cụ thể | Thiết kế | 4/6/2026 |
| 7 | 4 ngày nghỉ miễn trừ = Chủ nhật mặc định. Làm CN có thể hoán đổi nghỉ bù; không nghỉ bù → kế toán nhập tay bổ sung 1× dailyRate | Pete | 11/6/2026 |
| 8 | Lương bổ sung (supplement) = standby_days × daily_rate, cộng vào net_salary | Pete | 11/6/2026 |
| 9 | Khấu trừ nghỉ việc riêng: personal_leave_days vượt 4 ngày miễn trừ → trừ tại dailyRate | Pete | 11/6/2026 |
| 10 | BHXH cấu hình riêng cho từng lái xe trên trang Cấu hình → Lái xe | Pete | 11/6/2026 |
| 11 | Phương thức nhập lương bổ sung: chọn **từng ngày cụ thể** trên lịch (không nhập tổng), trực quan hơn. Công thức: `standby_days × baseSalary / standard_work_days`; BHXH hạch toán riêng | Pete | 12/6/2026 |
| 12 | Chủ nhật hoán đổi: làm CN → nghỉ bù ngày thường (trước/sau). Không nghỉ bù → 1× daily_rate (không phải OT). CN đi làm = ngày làm việc bình thường | Pete | 12/6/2026 |
