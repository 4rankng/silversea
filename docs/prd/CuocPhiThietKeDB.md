# Thiết kế DB — Cước cơ bản & phụ phí dầu

> **Trạng thái (2026-09-10): APPROVED DIRECTION — chốt ngày 10/09 sau khi wave spec
> (`run-1788968588650-mctezn`) khóa 3 quyết định KH (Câu 1=B, Câu 2=A, Câu 4=A) và
> anchor = Ngày vận chuyển (đóng item 2b).** Engine + schema đã merge ở `c959e7bb`
> (migration `0064_cynical_eddie_brock.sql`); triển khai wiring/config/UI/tests đang
> chạy theo các ticket T1–T6 trên board. Tài liệu này **không còn là đề xuất**: nó là
> **đặc tả kỹ thuật đang áp dụng**, mọi lệch triển khai đều cần sửa về đây. Xem thêm
> [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md) §2 để biết mapping 5 mục
> docx KH ↔ schema/engine, và §6.2 dưới đây để biết trạng thái open items còn lại.
>
> **Nguồn chân lý nghiệp vụ:** [`CuocPhiPhuPhiDau.md`](CuocPhiPhuPhiDau.md) (công thức
> + 4 quy tắc đã chốt 09/09) và file `18.7 - BG Long Minh T7.xlsx`. Nơi nào code hiện
> tại khác file Excel thì **file Excel đúng**, code phải sửa theo (xem §1).
>
> **Làm tròn: đến từng đồng (VND).** Không có phần thập phân trong mọi giá trị tiền.
> **Làm tròn từng thành phần (HALF_UP):** `J`, `H` tính và làm tròn RIÊNG rồi mới cộng
> vào `K` — đây là điểm khác với làm tròn hết rồi cộng (xem §4.2).
>
> Phạm vi: bảng dữ liệu + thuật toán tra cước + cơ chế snapshot + override debit note.
> **RBAC cho config CRUD** (T2) và **UI** (T3/T4) **không nằm trong tài liệu này** —
> xem [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md) §2.5 + testplan
> `TC-CUOC-020..024` (config RBAC, ticket T2 + T3).

---

## 1. Hai xung đột chặn — code hiện tại KHÔNG khớp Excel

Phải chốt 2 điểm này trước khi làm bảng, vì chúng quyết định hình dạng schema.

### 1.1. ⛔ Công thức `% chia sẻ` đang bị áp sai chỗ

| | Công thức | Ý nghĩa `% chia sẻ` |
|---|---|---|
| **Excel (đúng)** | `J = I × (1 + share)`  •  `H = (G − F) × E` | Là **% cộng thêm vào giá cước gốc**. Phụ phí dầu **thu 100 %**, không nhân share. |
| **Code hiện tại (sai)** | `H = (G − F) × E × share` | Là **% phần chênh giá dầu mà khách chịu**. Giá cước gốc **không** được cộng %. |

Nguồn: `shared/src/calculations/fuelSurcharge.ts:39-44` —
`amount = delta × quotaLiters × (sharePct/100)`.

Hai cách hiểu **loại trừ nhau**. Excel là chân lý ⇒ `computeFuelSurcharge()` phải sửa:
bỏ nhân `share` khỏi phụ phí, và chuyển `share` sang nhân vào giá cước gốc.

Kiểm chứng bằng số (NEWEB CONT40, kỳ 18/7):

| Cách tính | Kết quả |
|---|---|
| Excel | `4.100.000 × 1,02 + 9.777,41 × 91` = **5.071.744** ✓ |
| Code hiện tại | `9.777,41 × 91 × 0,02` = **17.795** ✗ (thiếu toàn bộ tiền cước) |

### 1.2. ⛔ `% chia sẻ` đang lưu sai cấp — không biểu diễn được hợp đồng thật

- Hiện tại: `customers.fuel_surcharge_share_pct` — **1 giá trị / 1 khách hàng**
  (`backend/src/db/schema/master-data.ts:223`).
- Thực tế: **cùng khách hàng Long Minh** có **3 mức khác nhau theo tuyến** —
  NEWEB 2 %, SUNRISE+SJ 2,5 %, ASKEY 4 % (đã xác nhận trong
  `backend/src/seed/data/pricing.ts`: `sharePct` ∈ {2; 2,5; 4}).

⇒ **Schema hiện tại không thể lưu đúng hợp đồng Long Minh.** `% chia sẻ` phải nằm ở
cấp **(khách hàng × tuyến)**, không phải cấp khách hàng.

---

## 2. Phân rã dữ liệu theo tần suất thay đổi

Nguyên tắc thiết kế: **mỗi tham số nằm đúng một chỗ, ở đúng cấp nó thay đổi.**

| Tham số | Excel | Cấp | Tần suất đổi | Bảng |
|---------|-------|-----|--------------|------|
| Giá cước gốc | `I` | KH × tuyến × loại xe | Theo hợp đồng | `pricing_tables` *(có sẵn)* |
| % chia sẻ | `J/I` | **KH × tuyến** | Theo hợp đồng | `freight_rate_terms` *(mới)* |
| Km tính cước | `B`, `C` | KH × tuyến | Theo hợp đồng | `freight_rate_terms` *(mới)* |
| Giá dầu mốc | `F` | KH × tuyến | Theo hợp đồng | `freight_rate_terms` *(mới)* |
| Định mức dầu | `D` | **Loại xe** | Rất hiếm | `fuel_consumption_norms` *(mới)* |
| **Giá dầu kỳ** | `G` (ô `M1`) | **Toàn hệ thống** | **Mỗi kỳ** | `fuel_price_periods` *(mới)* |
| Loại xe | `A` | Danh mục | Hiếm | `vehicle_size_classes` *(mới)* |

`E`, `H`, `J`, `K`, `L` là **giá trị dẫn xuất — không lưu như dữ liệu nhập**, chỉ tính
khi đọc hoặc đóng băng vào snapshot khi phát hành (§5).

---

## 3. Thiết kế bảng

### 3.1. `vehicle_size_classes` — danh mục loại xe *(mới)*

Hiện `pricing_tables.rate_key` là **varchar tự do**, không có danh mục ⇒ không join
được, không gắn được định mức dầu, dễ sai chính tả (`CONT20` vs `CONT 20`).

```ts
export const vehicleSizeClasses = pgTable('vehicle_size_classes', {
  id: serial('id').primaryKey(),
  // Khoá ổn định: '1.25T', '2.5T', ..., 'CONT20', 'CONT40'
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 50 }).notNull(),
  // Container hay xe tải thùng — chi phối việc chọn containerTypeId khi tạo lô
  isContainer: boolean('is_container').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});
```

Seed 9 dòng: `1.25T, 2.5T, 3.5T, 5T, 8T, 10T, 15T, CONT20, CONT40`.

### 3.2. `freight_rate_terms` — điều khoản cước theo tuyến *(mới — bảng cốt lõi)*

Đây là bảng **sửa lỗi §1.2**. Một dòng = một khối bảng giá trong Excel.

```ts
export const freightRateTerms = pgTable('freight_rate_terms', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  routeId: integer('route_id').notNull(),

  // % cộng vào giá cước gốc. Excel: 2 / 2.5 / 4.
  // KHÔNG phải % chia sẻ phần chênh giá dầu (xem §1.1).
  sharePct: numeric('share_pct', { precision: 5, scale: 2 }).notNull().default('0'),

  // Km một chiều dùng để TÍNH CƯỚC (có thể khác quãng đường thực tế).
  billingKmOneWay: integer('billing_km_one_way').notNull(),
  // Excel luôn nhân 2 (khứ hồi). Để cấu hình được thay vì hardcode.
  // ✅ Chốt 2026-09-09 (Câu 4 = A): LUÔN × 2 cho mọi chuyến — không có nhánh
  // "1 chiều thì × 1"; trường giữ default 2, không expose thành tuỳ chọn per-trip.
  billingKmMultiplier: numeric('billing_km_multiplier', { precision: 4, scale: 2 })
    .notNull().default('2'),

  // Giá dầu MỐC (F) đã nằm sẵn trong giá cước gốc của hợp đồng này.
  // Excel: 19.270 / 1,08 = 17.842,5926 (đã trừ VAT 8%).
  // Thuộc HỢP ĐỒNG, không phải thị trường ⇒ để ở đây, không để ở fuel_price_periods.
  // ⚠️ scale PHẢI ≥ 4 — xem §3.2.1. scale 2 gây sai số 1 đồng.
  baseFuelPrice: numeric('base_fuel_price', { precision: 12, scale: 4 }).notNull(),

  // ĐỘ TRỄ áp giá dầu mới theo tuyến (ngày) — cơ chế khách đã xác nhận 09/09
  // (Câu 2). NEWEB = 1; ASKEY, SUNRISE+SJ chưa có số ⇒ seed 0 tạm và chờ khách
  // (không đoán). Resolution: effective_from <= (date − lag_days).
  fuelLagDays: integer('fuel_lag_days').notNull().default(0),

  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('freight_rate_terms_cust_route_date_uniq')
    .on(table.customerId, table.routeId, table.effectiveDate),
]);
```

Dữ liệu Long Minh (3 dòng):

| customer | route | share_pct | billing_km_one_way | base_fuel_price | fuel_lag_days |
|---|---|---:|---:|---:|---:|
| LONG MINH | Hải Phòng–NEWEB | 2,00 | 130 | 17.842,5926 | **1** (khách đã cho) |
| LONG MINH | ASKEY | 4,00 | 100 | 17.842,5926 | ⏳ 0 tạm — chờ khách |
| LONG MINH | SUNRISE+SJ | 2,50 | 120 | 17.842,5926 | ⏳ 0 tạm — chờ khách |

#### 3.2.1. ⚠️ Vì sao `base_fuel_price` phải có `scale ≥ 4`

`F` là **tham số công thức**, không phải số tiền phát hành ⇒ **không được làm tròn về
đồng**. Nhưng ngay cả `scale: 2` cũng đã sai.

Đã dựng lại toàn bộ 3 tuyến × 8 loại xe × 2 kỳ = **48 mức cước** từ đúng các bảng thiết
kế ở trên, rồi so với giá trị `K` đọc trực tiếp từ file Excel:

| `scale` của `base_fuel_price` | Khớp Excel | Sai lệch lớn nhất |
|---|---:|---:|
| 2 (`17.842,59`) | 46/48 | **0,70 đ** ⇒ lệch 1 đồng sau làm tròn |
| **4 (`17.842,5926`)** | **48/48** | **0,00 đ** ✅ |
| 6 | 48/48 | 0,00 đ |
| Chính xác tuyệt đối `19270/1,08` | 48/48 | 0,00 đ |

Sai số ở `scale: 2` rơi vào **CONT20 tuyến NEWEB** (83,2 L — số lít lớn nhất khuếch đại
sai số đơn giá): thiếu `0,0026 đ/lít × 83,2 L ≈ 0,22 đ`, đủ để đẩy kết quả qua ranh giới
làm tròn và lệch **1 đồng**.

⇒ **Chốt `numeric(12,4)`.** Với yêu cầu "làm tròn đến từng đồng", một đồng lệch là sai,
và nó chỉ xuất hiện ở đúng 2/48 dòng — loại lỗi rất khó phát hiện khi đối soát thủ công.

### 3.3. `fuel_consumption_norms` — định mức dầu theo loại xe *(mới)*

```ts
export const fuelConsumptionNorms = pgTable('fuel_consumption_norms', {
  id: serial('id').primaryKey(),
  vehicleSizeClassId: integer('vehicle_size_class_id').notNull(),
  // Lít/km. Excel: 0.10 → 0.35. scale 4 để dư chỗ khi tinh chỉnh.
  litersPerKm: numeric('liters_per_km', { precision: 6, scale: 4 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('fuel_consumption_norms_class_date_uniq')
    .on(table.vehicleSizeClassId, table.effectiveDate),
]);
```

> ⚠️ **Không dùng lại bảng `fuel_norms` đang có.** `fuel_norms` là **định mức phía CHI
> PHÍ** (lít/**100 km**, tách rỗng/có hàng, theo tuyến–xe cụ thể, để cấp dầu cho lái xe).
> Bảng mới là **định mức phía DOANH THU** (lít/**km**, theo loại xe, để tính phụ phí thu
> khách). Hai con số này **khác nhau về bản chất và có thể khác giá trị** — gộp lại sẽ
> làm sai cả hai. Đặt tên khác nhau là cố ý.

### 3.4. `fuel_price_periods` — giá dầu theo kỳ *(mới)*

Đây chính là **ô `M1`** của Excel — tham số động duy nhất.

```ts
export const fuelPricePeriods = pgTable('fuel_price_periods', {
  id: serial('id').primaryKey(),
  // Giá dầu kỳ (G), CHƯA VAT. Excel: 21.740 (11/7) → 27.620 (18/7).
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  // Ngày bắt đầu áp. effectiveTo = NULL nghĩa là kỳ đang hiệu lực.
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  // Nguồn/chứng từ công bố giá — để đối soát với khách.
  sourceNote: text('source_note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('fuel_price_periods_from_uniq').on(table.effectiveFrom),
]);
```

Dữ liệu đã biết:

| unit_price | effective_from | ghi chú |
|---:|---|---|
| 21.740,00 | 2026-07-11 | sheet `11.7` — **đọc trực tiếp từ file khách** |
| 27.620,00 | 2026-07-18 | sheet `18.7` — **đọc trực tiếp từ file khách** |
| *(≈ 25.760)* | *(chưa rõ)* | ⚠️ **Không có trong file khách.** Suy ngược từ seed `pricing.ts` (bàn giao 30/7) và **chỉ đúng nếu cùng mốc `F`** — xem `CuocPhiPhuPhiDau.md` §8.1. **Không nạp dòng này** cho tới khi khách xác nhận. |

> **Cập nhật giá dầu = thêm 1 dòng**, không sửa dòng cũ. Giữ được lịch sử và truy vết
> được cước đã phát hành thuộc kỳ nào.

### 3.5. `pricing_tables` — giữ nguyên, chỉ chuẩn hoá khoá loại xe

Bảng này **đã đúng vai trò**: lưu giá cước gốc `I` theo (KH × tuyến × loại xe × ngày
hiệu lực), và `effectiveDate` đã nằm trong unique index.

Thay đổi duy nhất — thay khoá text tự do bằng khoá danh mục:

```ts
// THÊM:
vehicleSizeClassId: integer('vehicle_size_class_id'),
// GIỮ rate_key trong giai đoạn chuyển đổi, bỏ sau khi backfill xong.
```

`price` giữ nguyên `numeric(15,0)` = **giá gốc `I`, đơn vị đồng, không thập phân**.

> ⚠️ `price` hiện đang bị hiểu nhầm ở seed: `pricing.ts` có cả `basePrice` và
> `withSurcharge`, và **`withSurcharge` là cước đã cộng phụ phí của một kỳ giá dầu cũ
> (25.760 đ/l)**. Sau thiết kế này, **chỉ `basePrice` được lưu**; `withSurcharge`
> không lưu nữa mà tính ra (§4).

---

## 4. Thuật toán tra cước

### 4.1. Trình tự

```
INPUT: customerId, routeId, vehicleSizeClassCode, date (ngày áp dụng)

1. terms  ← freight_rate_terms
             WHERE customer=? AND route=? AND effective_date <= date
             ORDER BY effective_date DESC LIMIT 1
2. base   ← pricing_tables
             WHERE customer=? AND route=? AND vehicle_size_class=? AND effective_date <= date
             ORDER BY effective_date DESC LIMIT 1
3. norm   ← fuel_consumption_norms
             WHERE vehicle_size_class=? AND effective_date <= date
             ORDER BY effective_date DESC LIMIT 1
4. fuel   ← fuel_price_periods
             WHERE effective_from <= (date − terms.fuel_lag_days)   -- độ trễ theo tuyến
             ORDER BY effective_from DESC LIMIT 1

5. billedKm  = terms.billing_km_one_way × terms.billing_km_multiplier   -- luôn × 2 (chốt 09/09)
6. liters    = billedKm × norm.liters_per_km          -- KHÔNG làm tròn
7. fuelDelta = fuel.unit_price − terms.base_fuel_price
8. surcharge = MAX(0, ROUND(fuelDelta × liters))      -- kẹp 0 khi dầu dưới mốc (chốt 09/09)
9. freight   = ROUND(base.price × (1 + terms.share_pct/100))  -- → đồng
10. total    = freight + surcharge

OUTPUT: { freight, surcharge, total, + toàn bộ tham số đã dùng }
```

Mỗi bước 1–4 đều là **"dòng mới nhất có hiệu lực tại `date`"** — cùng một mẫu truy vấn
`effective_date <= date ORDER BY … DESC LIMIT 1` mà `pricing.service.ts` đang dùng.

> **Hai quy tắc đã chốt 2026-09-09 đúc vào thuật toán trên:**
> - **Kẹp 0 (Câu 1 = B):** bước 8 — khi `fuelDelta < 0` ⇒ `surcharge = 0`, `total = freight`.
> - **Luôn km × 2 (Câu 4 = A):** bước 5 — multiplier cố định 2, không phụ thuộc thực tế
>   tận dụng xe.
> - **Độ trễ (Câu 2, khách đã xác nhận):** bước 4 — ngày áp giá dịch thêm
>   `fuel_lag_days` của tuyến (NEWEB = 1 ngày; tuyến khác chờ số).

### 4.2. Quy tắc làm tròn — đến từng đồng

| Giá trị | Kiểu | Làm tròn |
|---------|------|----------|
| `liters` (E) | lít | **Không** — giữ thập phân (33,8 L) |
| `fuelDelta` (G−F) | đ/lít | **Không** — tham số công thức (9.777,4074) |
| `surcharge` (H) | tiền | **Có** → đồng |
| `freight` (J) | tiền | **Có** → đồng |
| `total` (K) | tiền | Không cần — tổng của 2 số nguyên |

**Đã kiểm chứng 2 việc:**

1. **Thứ tự làm tròn không gây lệch.** Với 8 loại xe × 3 tuyến × 3 kỳ giá dầu (72 tổ
   hợp), `ROUND(J) + ROUND(H)` **luôn bằng** `ROUND(J + H)`. Vì vậy làm tròn từng thành
   phần là an toàn — và có lợi hơn, vì `freight` và `surcharge` lên chứng từ như 2 dòng
   riêng biệt.
2. **Thiết kế tái tạo đúng Excel.** Dựng dữ liệu vào đúng 5 bảng ở §3, chạy đúng thuật
   toán §4.1, so với `K` đọc trực tiếp từ file: **48/48 mức cước khớp tuyệt đối, sai số
   0 đồng** (với `base_fuel_price` scale 4 — xem §3.2.1).

Dùng `ROUND_HALF_UP` (làm tròn 0,5 lên) — **không** dùng banker's rounding.
`roundInt()` trong `shared/src/calculations/round.ts` hiện dùng `Math.round` = HALF_UP
cho số dương ⇒ phù hợp. Clamp `Math.max(0, …)` của `roundInt()` từng được ghi chú
"cần xem lại" — **đã chốt 2026-09-09 (Câu 1 = B): clamp là đúng nghiệp vụ**, giữ nguyên;
không còn kịch bản phụ phí âm nào cần xử lý riêng.

---

## 5. Đóng băng khi phát hành (snapshot)

Giá dầu đổi mỗi kỳ ⇒ **tính lại sau này sẽ ra số khác**. Chứng từ đã phát hành phải
giữ nguyên số đã chốt.

> **✅ Xác nhận 2026-09-09 (Câu 2 = A):** không hồi tố — thiết kế snapshot này đúng
> theo quyết định của khách/công ty. Cơ chế **độ trễ theo tuyến** (bước 4 §4.1) cũng
> đã được khách xác nhận (NEWEB = 1 ngày).

```ts
export const freightRateSnapshots = pgTable('freight_rate_snapshots', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id'),
  tripId: integer('trip_id'),

  // Kết quả đã chốt — đơn vị đồng
  freightAmount: numeric('freight_amount', { precision: 15, scale: 0 }).notNull(),
  surchargeAmount: numeric('surcharge_amount', { precision: 15, scale: 0 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 15, scale: 0 }).notNull(),

  // Truy vết: đã dùng đúng dòng tham số nào
  rateTermsId: integer('rate_terms_id').notNull(),
  pricingTableId: integer('pricing_table_id').notNull(),
  fuelNormId: integer('fuel_norm_id').notNull(),
  fuelPricePeriodId: integer('fuel_price_period_id').notNull(),

  // Giá trị trung gian, để giải thích số cho khách mà không phải join lại
  billedKm: numeric('billed_km', { precision: 10, scale: 2 }).notNull(),
  liters: numeric('liters', { precision: 10, scale: 3 }).notNull(),
  fuelDelta: numeric('fuel_delta', { precision: 12, scale: 4 }).notNull(),
  sharePct: numeric('share_pct', { precision: 5, scale: 2 }).notNull(),

  computedAt: timestamp('computed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('freight_rate_snapshots_shipment_idx').on(table.shipmentId),
  index('freight_rate_snapshots_trip_idx').on(table.tripId),
]);
```

Lưu **cả 4 id tham số** ⇒ trả lời được câu "vì sao lô này 5.071.744 đ?" bằng cách chỉ ra
đúng dòng giá gốc, đúng % chia sẻ, đúng định mức, đúng kỳ giá dầu.

---

## 6. Việc phải làm & điểm cần chốt

### 6.1. Thứ tự triển khai

| # | Việc | Ghi chú |
|---|------|---------|
| 1 | Tạo 5 bảng mới + seed `vehicle_size_classes`, `fuel_consumption_norms` | Thuần thêm mới, không phá gì |
| 2 | Seed `freight_rate_terms` 3 dòng Long Minh + `fuel_price_periods` | Từ file Excel |
| 3 | Backfill `pricing_tables.vehicle_size_class_id` từ `rate_key` | 27 dòng, map trực tiếp |
| 4 | **Sửa `computeFuelSurcharge()` theo Excel** (§1.1) | ⚠️ Đổi hành vi — cần test hồi quy |
| 5 | Viết `resolveFreightRate()` theo §4 | Dùng lại mẫu truy vấn của `pricing.service.ts` |
| 6 | Ghi snapshot khi phát hành | |
| 7 | Ngưng dùng `customers.fuel_surcharge_share_pct` | Sai cấp (§1.2) — bỏ sau khi §4 xong |

> ⚠️ Bước 4 đổi công thức tiền đang chạy. **Bắt buộc backup DB trước**, và đối chiếu lại
> toàn bộ cước đã phát hành trước/sau khi đổi.

### 6.2. Câu hỏi & open items

> **Cập nhật 2026-09-10 (wave `run-1788968588650-mctezn`):** câu 1, 2, 4 **đã có trả lời**
> (xem [`CauHoiKhachHang_CuocPhi_2026-09-08.md`](CauHoiKhachHang_CuocPhi_2026-09-08.md)) —
> thiết kế ở trên đã cập nhật theo. Item 2b (mốc ngày chọn kỳ) cũng đã **đóng** theo docx
> §2D: anchor cố định = **Ngày vận chuyển** (transport_date). Câu 3 đã rút khỏi hỏi KH.
>
> **Còn mở 4 mục**, tất cả đều track trong ticket `e3873fbc` (board) — xem thêm
> [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md) §4 để biết chi tiết + mitigation.

#### ĐÃ CHỐT

1. ~~**Giá dầu xuống dưới mốc `F`** → phụ phí âm hay chặn về 0?~~ —
   **ĐÃ CHỐT (09/09): Câu 1 = B — kẹp về 0** ⇒ `computeFreightRate()` giữ
   `Math.max(0, …)` (xem `shared/src/calculations/fuelSurcharge.ts:113`); `H` không bao
   giờ âm trên chứng từ. **Lệch chủ ý so với Excel** (Excel không có clamp; mọi kỳ
   trong file đều trên mốc nên nhánh chưa từng xuất hiện) — đã ghi nhận vào
   `CuocPhiPhuPhiDau.md` §2.5.
2. ~~**Cước đã phát hành có tính lại khi đổi kỳ giá dầu không?**~~ —
   **ĐÃ CHỐT (09/09): Câu 2 = A — không hồi tố, snapshot** (§5). Cước đã ghi trên chứng
   từ giữ nguyên khi kỳ giá dầu mới mở. Kèm xác nhận cơ chế độ trễ theo tuyến ⇒ cột
   `freight_rate_terms.fuel_lag_days` (§3.2); NEWEB = 1 ngày đã seed.
3. ~~**Kỳ giá dầu seed 30/7** (chênh 7.917,41 đ/l ⇒ ≈ 25.760 nếu cùng mốc `F`)…~~ —
   **RÚT (09/09)** khỏi danh sách hỏi KH. Không cần số kỳ cũ để chạy công thức; giữ
   dữ liệu 30/7 như snapshot lịch sử đã phát hành.
4. ~~**`billing_km_multiplier` = 2 luôn đúng?**~~ — **ĐÃ CHỐT (09/09): Câu 4 = A — luôn
   khứ hồi**; multiplier cố định 2, không expose tuỳ chọn per-trip. Ghép/Kết hợp không
   ảnh hưởng cước của từng lệnh.
7. ~~**Mốc ngày nào của lô dùng để chọn kỳ giá dầu** (phụ lục 2b)…~~ —
   **ĐÃ CHỐT (10/09, docx §2D): anchor = Ngày vận chuyển (`transport_date`).**
   Engine input `transportDate` (`freight-pricing-engine.service.ts:53`) quyết định giá
   dầu áp dụng; đổi `transport_date` sau khi tạo ⇒ **supersede** snapshot (không mutate
   row cũ, xem `PhuongAnTinhCuocTuDong.md` §2.3 bước 3 + testplan `TC-CUOC-010`).

#### CÒN MỞ (tracker: ticket `e3873fbc`) — defaults đã áp theo **D3 decision (10/09)**

> 4 mục dưới đây đều đã được **default** theo D3 decision (10/09) để không chặn code
> wave; KH có thể reply bất cứ lúc nào (track `e3873fbc`). Chi tiết mirroring:
> [`PhuongAnTinhCuocTuDong.md`](PhuongAnTinhCuocTuDong.md) §4.

5. **Câu 5 — Khách hàng khác Long Minh.** D3 default: **assumed (A) only Long Minh**.
   Schema + engine đáp ứng Long Minh duy nhất; khách khác tiếp tục nhập tay. Nếu KH
   đổi ý = (B) đa mô hình ⇒ cần cột `pricing_model` / `formula_variant` trên
   `freight_rate_terms` + UI chọn formula variant trong T2.
6. **Độ trễ ASKEY / SUNRISE+SJ** (phụ lục 2a). D3 default: **`fuel_lag_days = 0` cho
   cả 2 tuyến** (theo docx §2A example N=0 "khách áp dụng ngay"). NEWEB = 1 đã chốt
   09/09. Edit per-row qua T2 admin UI không cần code change khi KH cung cấp số thật.
8. **Giá gốc 15T × 3 tuyến.** D3 default: **deliberately missing**
   (`pricing_tables.base_price = 0`). MANUAL fallback là **designed behavior** (testplan
   `TC-CUOC-015`), không phải thiếu sót — tạo lô vẫn proceed, Kế toán nhập tay trên
   chứng từ. Khi KH bổ sung số, update 3 dòng `pricing_tables`; snapshot cũ giữ nguyên
   (no-retro theo Câu 2 = A).
9. **Threshold values X / Z cho từng khách.** D3 default:
   **`surcharge_threshold_pct = NULL` và `surcharge_threshold_abs = NULL`** (cả 3 tuyến
   Long Minh). NULL = always-adjust (engine không ratchet, giá mới luôn áp). XOR
   validation giữ nguyên khi KH edit (`TC-CUOC-013` ⇒ 422 nếu cả 2 set).

> **Không phải câu hỏi thiết kế — đã track ở §6.2 mục 8:** giá gốc `15T` đang trống
> ở cả Excel lẫn seed (`basePrice: 0`). Đây chỉ là **một điểm dữ liệu còn thiếu —
> không ảnh hưởng logic**. Schema và công thức chạy bình thường; chỉ cần điền số khi
> khách cung cấp. Cho đến lúc đó, `resolveFreightRate()` không tìm thấy dòng
> `pricing_tables` cho `15T` và rơi về nhánh **MANUAL** như mọi trường hợp thiếu giá
> catalog khác (testplan `TC-CUOC-015`).
