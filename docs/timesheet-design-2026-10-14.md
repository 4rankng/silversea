# Thiết kế: Chấm công lái xe (timesheet) + Theo dõi hoàn cược (Thêm cược)

**Ngày:** 2026-10-14 · **Phạm vi:** hai module MỚI, không sửa module của wave khác
(A: role policies/approvals, B: driver LotCostForm, C: Ops + accounting forms).
**Nguồn quy tắc nghiệp vụ:** `docs/prd/PhanHeKeToan.md` (§3.6 theo dõi hoàn cược,
§6 danh mục Khác — bảng chấm công) + chỉ đạo trực tiếp của chủ sản phẩm trong
phiên này (bảng ký hiệu lưới, chế độ lương, quy tắc Chủ nhật). Chỉ đạo phiên này là
**authoritative** khi khác tài liệu; tài liệu PRD là bối cảnh.

Tài liệu này là **thiết kế trước khi code** (yêu cầu bắt buộc). Sau khi code
xong, mục "Trạng thái" ở cuối được cập nhật bằng đường dẫn file thật.

---

## 0. Quan hệ với những gì đã tồn tại (đọc trước khi code)

Module **không** được dựng lại những cái đã có:

| Đã có | Ở đâu | Quan hệ với module mới |
|---|---|---|
| `deposit_refund_trackers` (bảng) | `backend/src/db/schema/deposit.ts` | **Dùng lại, không tạo bảng cược mới.** Feature 1 chỉ bổ sung endpoint tra cứu Bill 4 số cuối + form "Thêm cược" gọi `POST /api/accounting/deposits` đã có. |
| `POST /api/accounting/deposits`, `PATCH /:id/dates`, `POST /:id/refund` | `backend/src/routes/accounting-deposit.ts` | Không đổi shape. Form mới chỉ tiền đệm trước khi gọi. |
| `driver_work_days` + `attendance.service.ts` (`computeSalary`, confirm/unconfirm) | `backend/src/db/schema/costs.ts`, `backend/src/services/attendance.service.ts` | **Không đụng.** Timesheet là bảng chấm công *vận hành* (ký hiệu K/Q/Đ/L/N/P) của Điều vận; attendance là bảng *lương* (TRIP_DAY/STANDBY/...) đã có quy trình confirm riêng. Xem §7 về ranh giới. |
| `tripFinancialState.revenue/totalCost` + `trips.driverId` | `backend/src/db/schema/trips.ts` | Nguồn cho chỉ số hiệu quả doanh thu/chi phí của rollup. |
| `shipments.blNumber` / `bookingRef` / `shippingLineName` / `customerId`→`customers.name` / `rawCustomerName` | `backend/src/db/schema/shipments.ts`, `master-data.ts` | Nguồn auto-fill cho Feature 1 (Bill/Booking – Hãng tàu – Tên khách hàng). |
| `auditLogs` | `backend/src/db/schema/core.ts:79` | Audit trail chung; timesheet ghi thêm cột người nhập/người đối chiếu. |
| Casbin `salary` resource | `backend/src/casbin/policy.csv:57-63` | Module mới dùng resource riêng `timesheet` để không mở rộng quyền ngoài ý muốn. |

---

## 1. Feature 1 — Thêm cược (bill suggestions)

### 1.1 Yêu cầu
Ô **Bill/Book**: gõ **4 số cuối** → hiện danh sách gợi ý các lô hàng khớp; chọn một
dòng → auto-fill **Bill/Booking – Hãng tàu – Tên khách hàng** từ dữ liệu lô phía
customer. Điền nốt số tiền cược và lưu.

### 1.2 API mới (một read endpoint, không có write endpoint mới)

`GET /api/accounting/deposits/bill-suggestions?q=<digits>`

- `q`: bắt buộc, **chỉ số**, tối đa 4 ký tự; ngắn hơn 4 số → `400`
  ("Nhập đủ 4 số cuối của số Bill/Booking."). Người dùng gõ dần → chỉ gọi API từ 4 số.
- Truy vấn `shipments` LEFT JOIN `customers`, khớp `RIGHT(bl_number,4) = q`
  **hoặc** `RIGHT(booking_ref,4) = q`. Khớp theo **4 số cuối** vì đó là cách nhân
  viên tra cứu từ giấy tờ (giống cách họ đọc Bill).
- Trả **tối đa 10** dòng, sắp xếp `createdAt DESC, id DESC`.
- Mỗi dòng: `{ shipmentId, billNumber, bookingRef, billDisplay, carrierName, customerName }`.
  - `billDisplay` = `billBookingTitle(blNumber, bookingRef)` (bill trước, booking fallback —
    đúng quy ước hiển thị hiện hành, `backend/src/lib/business-keys.ts:12`).
  - `carrierName` = `shippingLineName` (Hãng tàu).
  - `customerName` = `customers.name`, fallback `shipments.rawCustomerName` (lệnh chạy ngoài).
- Lô đã có tracker cược → vẫn trả về (KT có thể cược nhiều lần trên cùng lô), nhưng
  kèm `existingTrackerCount` để form hiển thị cảnh báo "Lô này đã có N lần cược".

**Vì sao là read-only:** PRD §3.6 nói rõ "CUS không điền thì kế toán được tự điền tay",
và `createDepositTracker` đã nhận `shipmentId` + tên Bill/khách/hãng. Endpoint mới
chỉ cung cấp **ứng viên**; không tạo bảng cược song song với `deposit_refund_trackers`.

Quyền: `casbinAuthz('accounting')` (đã có `ACCOUNTANT/MANAGER/CUS` read) — route nằm
trong router `accounting-deposit.ts` nên không cần dòng policy mới.

### 1.3 UI
- Nút **"Thêm cược"** trên bảng theo dõi hoàn cược hiện có (mở `Modal` dùng chung).
- Trong modal: ô Bill/Book là ô tìm kiểm gỡ — 4 số cuối hiện danh sách gợi ý
  (dùng shell search/combobox của house design system, **không** dựng control mới).
- Chọn dòng → 3 field hiển thị read-only: Bill/Booking, Hãng tàu, Tên khách hàng;
  các field này vẫn **sửa tay được** (PRD: KT tự điền tay).
- Người dùng bỏ chọn → xoá 3 field, chỉ nhập tay được.

---

## 2. Feature 2 — Chấm công lái xe (timesheet)

### 2.1 Ký hiệu lưới (authoritative)

| Ký hiệu | Nghĩa | Chuyến (trips) | Ngày công (attended day) |
|---|---|---|---|
| `K` | kẹp 2 cont 20 (2 container ghép) | **1** | 1 |
| `Q` | quay đầu | **2** | 1 |
| `Đ` | chạy đơn | **1** | 1 |
| `L` | lưu ca (giữ xe tại bãn) | **0** | 1 |
| `N` | nghỉ | **0** | **0** |
| `P` | nghỉ phép (xe hư) | **0** | **1 ngày công**, 0 trips |

`K` đếm **1 chuyến** dù ghép 2 container — đây là điểm dễ sai nhất, có test riêng.

### 2.2 Quy tắc Chủ nhật
- **Chủ nhật KHÔNG tính là ngày công.** Lái xe được trả riêng cho Chủ nhật.
- Trên ô Chủ nhật **vẫn ghi ký hiệu/trips** ("chỉ ghi chuyến").
- Vì vậy: ô Chủ nhật có `Đ` → 1 trip ghi nhận, nhưng **không** cộng vào workdays.
- Đây là khác biệt cốt lõi với `computeStandardWorkDays()` hiện có (days − Sundays);
  timesheet dùng bộ đếm riêng (`countAttendedDays`) vì P trên Chủ nhật cũng 0.

### 2.3 Chế độ lương (per driver, chọn được)

| Chế độ | Công thức |
|---|---|
| `PER_TRIP` — "không trốn vé" | `300_000 × trips` + `dailyBase × workdays` + thưởng chuyến vượt bậc |
| `FLAT_MONTHLY` — lương tháng cố định | `flatAmount` ( ví dụ 10.000.000đ nếu đủ công) |

Chi tiết chế độ PER_TRIP (định nghĩa gốc):
- `300.000đ/chuyến` cho mọi chuyến.
- `dailyBase` (lương ngày) theo **ngày công** (workdays), **không** theo Chủ nhật.
- **Trips 21+ trong tháng: mỗi chuyến từ thứ 21 trở đi cộng thêm `100.000đ`.**
  Nghĩa là `bonusTrips = max(0, trips − 20)`, `salary = 300_000×trips + 100_000×bonusTrips + dailyBase×workdays`.
  Đọc "21+ pay +100.000đ/trip extra" theo nghĩa chuyến thứ 21 trở đi được thêm 100k
  (giải thích được, kiểm toán được, không nhân với cả khối lượng chuyến).

Hằng số: `PER_TRIP_RATE = 300_000`, `EXTRA_TRIP_THRESHOLD = 21`, `EXTRA_TRIP_RATE = 100_000`.

### 2.4 Người nhập / người đối chiếu (audit trail)
- **Điều vận (`DISPATCHER`)** điền lưới.
- **Kế toán (`ACCOUNTANT`)** đối chiếu lần cuối, được **sửa số âm** ở ô chỉnh lệch
  (adjustment có thể âm — ví dụ KT bỏ 1 chuyến do không có chứng từ).
- Mỗi ô lưu `enteredBy/enteredAt` + `updatedBy/updatedAt`; lưu phiên đối chiếu
  (status, người đối chiếu, thời điểm, ghi chú) + `auditLogs` row cho mỗi lần ghi/chỉnh.
- Ô đã đối chiếu mà Điều vận sửa → phiên trở lại `PENDING` (hiện rõ "cần đối chiếu lại").

### 2.5 Rollup cuối tháng (per driver)
`đơn / kẹp / ghép` counts, `trips`, `workdays`, `salary by mode`, `adjustmentTrips`,
và chỉ số hiệu quả: `revenue` / `cost` / `salary` / `salaryRatio` (salary ÷ revenue)
lấy từ `trips` của driver trong tháng (`tripFinancialState`), **chỉ tính chuyến có
bill khớp lưới ký hiệu** nếu có; nếu không có liên kết chuyến thì efficiency = null
(không đoán).

---

## 3. Schema (Drizzle, file mới `backend/src/db/schema/timesheet.ts`)

### 3.1 `driverTimesheetMonths` — phiên chấm công 1 driver × 1 tháng
| cột | kiểu | ghi chú |
|---|---|---|
| `id` | serial PK | |
| `driver_id` | int NOT NULL | → `drivers.id` |
| `year`, `month` | int NOT NULL | tháng 1–12 |
| `salary_mode` | text NOT NULL | `PER_TRIP` \| `FLAT_MONTHLY` |
| `daily_base` | numeric(15,0) | lương ngày, chỉ dùng PER_TRIP |
| `flat_amount` | numeric(15,0) | chỉ dùng FLAT_MONTHLY |
| `status` | text NOT NULL default `OPEN` | `OPEN` → `RECONCILED` |
| `reconciled_by`, `reconciled_at` | int / ts | |
| `reconcile_note` | text | |
| `created_at`, `updated_at` | ts | |

Unique: `(driver_id, year, month)`.

### 3.2 `driverTimesheetDays` — một ô lưới
| cột | kiểu | ghi chú |
|---|---|---|
| `id` | serial PK | |
| `month_id` | int NOT NULL | → `driverTimesheetMonths.id` |
| `driver_id`, `work_date` | int / date NOT NULL | denormalize để index/report độc lập |
| `symbol` | char(1) | `K\|Q\|Đ\|L\|N\|P` |
| `trips` | int NOT NULL default 0 | **luôn** = trips của symbol (dispatcher nhập, server chốt) |
| `is_sunday` | boolean NOT NULL | snapshot để lịch sử không đổi theo thời gian |
| `accountant_trip_adjustment` | int NOT NULL default 0 | **có thể âm** |
| `adjusted_by`, `adjusted_at` | int / ts | |
| `note` | text | |
| `entered_by`, `entered_at` | int / ts | dispatcher |
| `created_at`, `updated_at` | ts | |

Unique: `(month_id, work_date)`. Index `(driver_id, work_date)`.

### 3.3 Không tạo bảng riêng cho rollup
Rollup là **derived** — tính lúc đọc từ `driverTimesheetDays` (tháng ≤ 31 dòng/driver).
Không có bảng materialized để lệch; không có bảng nào phải backfill.

### 3.4 Migration
`pnpm db:generate` (drizzle-kit), SQL thuần cho bảng mới + index. Không có dữ liệu
cũ cần backfill (module mới). Migration **append-only**, không sửa file cũ.

---

## 4. Tính lương (shared, thuần, không I/O)

File mới: `shared/src/calculations/timesheetSalary.ts`

```ts
export const TIMESHEET_SYMBOLS = ['K','Q','Đ','L','N','P'] as const;
export type TimesheetSymbol = typeof TIMESHEET_SYMBOLS[number];

export const TIMESHEET_SYMBOL_RULES: Record<TimesheetSymbol, {trips:number; workday:boolean}> = {
  K: { trips: 1, workday: true },
  Q: { trips: 2, workday: true },
  Đ: { trips: 1, workday: true },
  L: { trips: 0, workday: true },
  N: { trips: 0, workday: false },
  P: { trips: 0, workday: true },
};

export const PER_TRIP_RATE = 300_000;
export const EXTRA_TRIP_THRESHOLD = 21;
export const EXTRA_TRIP_RATE = 100_000;

export function isSundayUtc(iso: string): boolean;          // Date.UTC → getUTCDay()===0
export function countDayTrips(symbol, isSunday, adj): number;
export function countWorkdays(symbol, isSunday): number;    // Sunday ⇒ 0
export function computeTimesheetSalary(input): TimesheetSalary;
```

`computeTimesheetSalary` trả:
`{ trips, workdays, symbolCounts:{K,Q,Đ,L,N,P}, bonusTrips, perTripPay,
extraTripBonus, dailyBasePay, salaryTotal, mode }`.
PER_TRIP: `salaryTotal = 300k×trips + 100k×bonusTrips + dailyBase×workdays`.
FLAT_MONTHLY: `salaryTotal = flatAmount` (thiếu cấu hình ⇒ 0 + cảnh báo ở API).

---

## 5. API (module mới `backend/src/routes/timesheet.ts` + service)

Mount: `app.use('/api/timesheet', authMiddleware, casbinAuthz('timesheet'), timesheetRoutes)`
Policy mới (chỉ dòng mới, không sửa dòng cũ):
`DISPATCHER read/write`, `ACCOUNTANT read/write`, `MANAGER read`, `ADMIN read/write`.

| Method | Path | Role | Việc |
|---|---|---|---|
| GET | `/months?year&month` | đọc | lưới tháng: driver × ngày + symbol |
| POST | `/months` | Kế toán | tạo phiên tháng (chọn salary mode + dailyBase/flatAmount) |
| PATCH | `/months/:id/mode` | Kế toán | đổi chế độ lương/tham số |
| PUT | `/months/:id/days` | Điều vận | ghi lưới hàng loạt (mảng ô `{date, symbol}`) — 1 transaction |
| PUT | `/months/:id/days/:dayId/adjustment` | Kế toán | chỉnh trips (âm được) |
| POST | `/months/:id/reconcile` | Kế toán | đối chiếu xong → `RECONCILED` |
| POST | `/months/:id/reopen` | Kế toán | mở lại |
| GET | `/rollup?year&month` | đọc | rollup per driver (counts/trips/workdays/salary/efficiency) |
| GET | `/drivers` | đọc | danh sách lái xe + mode hiện tại |

Payload ghi lưới dùng **ký hiệu**, không phải số: dispatcher gõ `k`, `q`, `d`, `l`, `n`, `p`
(UI map `d`→`Đ`); server là nguồn chân lý của `trips` (nhận `trips` từ client là
`400` — không có đường vòng để lái xe tự khai chuyến).

Ghi lưới → `auditLogs` (`entityType='TIMESHEET_MONTH'`) + mỗi ngày có
`enteredBy/enteredAt`; chỉnh của KT → `auditLogs` `entityType='TIMESHEET_ADJUST'`.

---

## 6. Frontend

Route/entry mới:
- `/timesheet` — **Điều vận** (điền lưới) — `dispatchOnly`.
- `/timesheet/doi-chieu` — **Kế toán** (đối chiếu) — `accountantOnly`.
- "Thêm cược" — trong `DepositRefundTrackerPage` (trang có sẵn).

Nav: `shared/src/navigation/pageCatalog.ts` + `frontend/src/lib/routes.ts` +
`App.tsx` route + title map. Mục nav mới dưới section `operations`.

Lưới (dispatcher):
- Bảng `.record-table` + `.ops-table` (bảng chuẩn của hệ design, không dựng skin riêng).
- Header: chọn tháng + chọn lái xe + chế độ lương (read-only ở đây).
- Ô ngày: nhận 1 ký hiệu, **focus sẵn**, `Enter`/`Tab` sang ô kế tiếp,
  `Backspace` trên ô trống → lùi 1 ô, `Esc` bỏ chọn. Gõ ký hiệu = ghi.
- Cột Chủ nhật ghi màu khác + tooltip "Chủ nhật không tính ngày công" — là **text/attribute**
  theo luật §1 design, không phải pill.
- Tổng chạy (trip/ngày công) hiện ở chân bảng dùng `SummaryRail`.

Đối chiếu (kế toán):
- Cùng lưới, thêm cột **chỉnh lệch** (số nguyên, **cho phép âm**) + trạng thái phiên.
- Tổng tiền theo chế độ lương + chỉ số hiệu quả (doanh thu/chi phí/lương/tỷ lệ).

Untitled UI PRO: dùng **Input/Combobox/Select/Button** đã vendor sẵn
(`src/components/untitled-ui/base/...`) cho ô Bill/Book gợi ý và các control nhập;
`Table` PRO (`application/table`) **không** được dùng nguyên xi vì hệ design đã có
`record-table` + 76 bảng đang dùng — nhập tay lớp bọc đè lên `.record-table` sẽ tạo
thứ hai cho cùng một việc, vi phạm "one answer" của `docs/design-system/03`.

---

## 7. Ranh giới với module chấm công/lương sẵn có (ghi rõ để không trùng)

| | `driver_work_days` + attendance (đã có) | timesheet (mới) |
|---|---|---|
| Người nhập | lái xe/ops qua app chấm công | **Điều vận** nhập ký hiệu |
| Đơn vị | 1 ngày = 1 trip (`TRIP_DAY`) | 1 ngày = **0..2 chuyến** (Q=2) + 5 loại ký hiệu |
| Chủ nhật | `WEEKLY_OFF` | trips vẫn ghi, **không** tính ngày công |
| Lương | base/ngày công + confirm period governance | per-trip 300k/+100k hoặc flat |
| Kết nối | không | rollup chỉ **đọc**, không tự đẩy sang attendance |

Không tích hợp 2 chiều: attendance không đọc timesheet, timesheet không ghi
`driver_work_days`. Việc nối hai bảng là quyết định sản phẩm khác, cần chủ sản
phẩm chốt (ghi ở §9).

---

## 8. Kiểm thử (bắt buộc, không stub)

Unit thuần trong `shared/src/calculations/timesheetSalary.test.ts`:
1. Ký hiệu → trips: K=1, Q=2, Đ=1, L=0, N=0, P=0.
2. workdays: L/N/P; **Chủ nhật = 0** cho mọi ký hiệu, kể cả K/Q/Đ và P.
3. PER_TRIP: 20 chuyến không thưởng; 21 chuyến → đúng 1 chuyến thưởng; 25 chuyến → 5.
4. PER_TRIP cộng `dailyBase × workdays` (Không nhân Chủ nhật).
5. FLAT: trả đúng `flatAmount`, không tính theo chuyến.
6. Chỉnh lệch âm của KT làm trips giảm, không xuống dưới 0 khi chưa có chuyến nào.
7. Ngưỡng chính xác tại 20/21 (biên).

Backend: route/service test cho ghi lưới + rollup + đối chiếu (theo mẫu
`src/tests/deposit-refund-http.test.ts`: express app thật + JWT, dọn dẹp theo prefix).

Frontend: test lưới (nhập ký hiệu bằng bàn phím → đúng ô), test chỉnh lệch âm ở ô đối chiếu.

---

## 9. Điểm cần chủ sản phẩm chốt (ghi, không tự chọn)

1. `dailyBase` mặc định khi chọn PER_TRIP (chưa có trong tài liệu nguồn) → để null,
   API trả cảnh báo cho tới khi Kế toán nhập.
2. "Trips 21+ cộng thêm 100.000đ" — đã chọn nghĩa **chuyến thứ 21 trở đi mỗi chuyến
   +100k**; nếu ý là "+100k một lần khi đạt 21" thì sửa `computeTimesheetSalary` 1 chỗ.
3. Phần lương Chủ nhật do công ty trả riêng — chưa có mức, chưa nhập ở đây.
4. Nối timesheet với `driver_work_days`/lương hiện có: chưa làm (xem §7).

## 10. Trạng thái (cập nhật sau khi code)

| Phần | File |
|---|---|
| Schema | `backend/src/db/schema/timesheet.ts` (+ export trong `db/schema/index.ts`) |
| Migration | `backend/drizzle/20261014103000_driver_timesheet.sql` + entry `_journal.json` (idx 141) |
| Tính lương | `shared/src/calculations/timesheetSalary.ts` (export qua `shared/src/index.ts`) |
| API | `backend/src/services/timesheet.service.ts`, `backend/src/routes/timesheet.ts` (mount `/api/timesheet`), `src/casbin/policy.csv` (resource `timesheet`) |
| Bill suggestions | `backend/src/services/deposit-bill-suggestions.service.ts` + `GET /accounting/deposits/bill-suggestions` |
| UI — lưới | `frontend/src/pages/TimesheetGridPage.tsx`, `frontend/src/features/timesheet/TimesheetGrid.tsx` |
| UI — đối chiếu | `frontend/src/pages/TimesheetReconciliationPage.tsx` |
| UI — Thêm cược | `frontend/src/pages/accounting/DepositRefundTrackerPage.tsx` (ô tra 4 số cuối) |
| Client | `frontend/src/api/timesheetClient.ts`, `depositRefundClient.ts`, `api/keys.ts` (`qk.timesheet`) |
| Nav | `shared/src/navigation/pageCatalog.ts`, `frontend/src/lib/routes.ts`, `Layout.tsx`, `App.tsx` |
| Test | `shared/src/calculations/timesheetSalary.test.ts` (23), `backend/src/tests/timesheet-grid.test.ts` (13), `backend/src/tests/deposit-bill-suggestions.test.ts` (5), `frontend/src/features/timesheet/TimesheetGrid.test.tsx` (9), `frontend/src/pages/TimesheetReconciliationPage.test.tsx` (5) |

### Ghi chú lệch so với thiết kế ban đầu (đã sửa trong code)

1. **Migration viết tay.** `drizzle-kit generate` lỗi do chuỗi snapshot `drizzle/meta`
   đã hỏng từ trước (một collision parent-snapshot có sẵn, không liên quan thay đổi
   này). Theo tiền lệ `20261013210105`, migration được viết tay kèm entry journal.
2. **Tiền không bao giờ âm.** Chỉnh lệch âm của Kế toán vẫn được ghi nhưng
   `salaryTotal` chặn dưới 0 (`Math.max(0, …)`), tránh sinh phiếu lương âm.
3. **`.strict()` trên từng ô lưới.** Một client gửi kèm `trips` bị **từ chối 400** thay
   vì bị bỏ qua — nếu bỏ qua, client có thể tin rằng đã ghi 99 chuyến.
4. **Chế độ dữ liệu trong `/rollup`:** `revenue`/`cost` lấy theo `trips.departure_date`
   của driver trong tháng lịch (không phải kỳ lương 25→24); `salaryRatio = lương/doanh thu`.