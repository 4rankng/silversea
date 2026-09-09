# Phương án tính cước tự động — tự động hoá cước & phụ phí dầu

> **Nguồn chân lý tài liệu:** `Phương án tính cước tự động.docx`
> (bản KH gửi 09/09, đính kèm phụ lục 2a/2b).
> Bản trích: `/tmp/docx_phuong_an_tinh_cuoc.md`.
>
> **PRD liên quan (tham chiếu chéo):**
> - [`CuocPhiPhuPhiDau.md`](CuocPhiPhuPhiDau.md) — quy tắc tính cước, công thức, 27 dòng
>   bảng cước Long Minh, 4 quy tắc đã chốt 09/09.
> - [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) — thiết kế DB schema, engine
>   `resolveFreightRate()`, bảng snapshot, trạng thái **APPROVED DIRECTION** (xem §1.2).
> - [`CauHoiKhachHang_CuocPhi_2026-09-08.md`](CauHoiKhachHang_CuocPhi_2026-09-08.md) —
>   lịch sử câu hỏi/chốt với KH Long Minh, **Câu 1=B, 2=A, 4=A đã chốt**, còn
>   **Câu 5** + 2 mục phụ (2a lag ASKEY/SUNRISE+SJ, 2b mốc ngày).
>
> **Trạng thái tài liệu (2026-09-10):** đặc tả kỹ thuật cho wave triển khai auto-pricing
> (run `run-1788968588650-mctezn`). Engine + schema đã land (c959e7bb, migration `0064`);
> **wiring/config/UI/tests** còn lại thuộc các ticket T1–T6 trên backlog board
> (`d4ae7d0d` = tài liệu này, mọi ticket khác xem NOTES.md). Tài liệu này **không
> thay thế** `CuocPhiThietKeDB.md` — nó neo lại **5 mục docx** vào schema/engine hiện có
> và liệt kê open items còn chờ KH/US.

---

## 1. Mục đích & phạm vi

### 1.1. Tại sao có tài liệu này

Docx `Phương án tính cước tự động.docx` (KH gửi 09/09) tổng hợp phương án **tự động hoá**
toàn bộ dòng cước từ khi nhân viên nhập **Ngày vận chuyển** đến khi Kế toán chốt **Bảng kê
/ Debit Note** gửi khách. Trước docx này:

- `CuocPhiPhuPhiDau.md` đã chốt **quy tắc tính** (công thức, 27 dòng, 4 quyết định 09/09).
- `CuocPhiThietKeDB.md` đã thiết kế **schema + engine** (5 bảng, `resolveFreightRate()`,
  `freight_rate_snapshots`).
- Nhưng **chưa có tài liệu nào** trả lời câu hỏi:
  *"Khi nào engine chạy? Ai chạy? Kết quả đi đâu? Kế toán sửa cước ở đâu?"*

Docx lấp đúng khoảng trống đó. Tài liệu này (PRD `PhuongAnTinhCuocTuDong.md`) **neo**
5 mục trong docx vào code đã có / sẽ có, theo đúng style của các PRD trước.

### 1.2. Trạng thái chốt & vai trò của tài liệu này

| Mốc | Trạng thái |
|---|---|
| **Engine + schema** (`resolveFreightRate`, 5 bảng, snapshot) | ✅ Merged `c959e7bb` (migration `0064`), **chưa có caller ngoài service** |
| **Wiring** (snapshot tại `shipment-create`, dispatch path) | ⏳ Ticket T1 (`cf5f4e29`) — backend |
| **Config CRUD routes** (`fuel_price_periods`, `freight_rate_terms`, `fuel_consumption_norms`) | ⏳ Ticket T2 (`a7f6740f`) — backend |
| **Admin UI** (fuel-price entry + rate-terms admin) | ⏳ Ticket T3 (`06b1a41f`) — frontend, **pending T2** |
| **Shipment preview + debit-note override UI** | ⏳ Ticket T4 (`28002a59`) — frontend, **pending T1** |
| **Tests** (unit test-first now, integration + flows/12 Phase-2) | ⏳ Ticket T6 (`2b5b9b5d`) — QA, **pending T1** |
| **PRD tài liệu này** | ✅ This document — fullstack ticket `d4ae7d0d` |

> ✅ = sẵn sàng / đã xong; ⏳ = đang chờ ticket khác.
> Tài liệu này **không tự verify** các ticket khác — nó chỉ ghi lại trạng thái
> chốt để người đọc biết phần nào đang đợi ai.

---

## 2. Mapping 5 mục docx ↔ code hiện có

Mỗi mục docx được ánh xạ vào (i) module code đã tồn tại (engine/schema) hoặc
(ii) ticket triển khai trên board. Cột "Docx anchor" chỉ ra đoạn nguyên văn trong docx
(trích từ `/tmp/docx_phuong_an_tinh_cuoc.md`) để truy vết ngược.

### 2.1. Mục 1 docx — Công thức cước cốt lõi (mỗi chuyến)

**Docx anchor (§1):** `{Tổng cước thu khách} = {Giá gốc sau chia sẻ} + {Phụ phí dầu chênh lệch}`
với `J = I × (1 + % chia sẻ)`, `H = (G − F) × E` (`E` = tổng lít dầu / chuyến).

**Code mapping:**

| Thành phần | Module | File:line |
|---|---|---|
| Công thức `K = I × (1 + share) + MAX(0, (G−F)×E)` | `computeFreightRate()` | `shared/src/calculations/fuelSurcharge.ts:99-120` |
| Làm tròn HALF_UP đến từng đồng (per-component) | `round2dp` + `roundInt` | `shared/src/calculations/round.ts` |
| Kẹp `H = max(0, …)` khi dầu dưới mốc (chốt 09/09, Câu 1=B) | `Math.max(0, …)` | `shared/src/calculations/fuelSurcharge.ts:113` |
| Km tính cước = `km một chiều × 2` (chốt 09/09, Câu 4=A) | `billedKm = km_one_way × 2` cố định | `backend/src/services/freight-pricing-engine.service.ts:230-231` (billedKm build); `freight_rate_terms.billing_km_multiplier` = 2 |

**Tại sao chia sẻ nhân vào `I` chứ không nhân vào `H`:**
Đây là **mâu thuẫn cũ** đã chốt trong [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) §1.1:
code gốc nhân share vào phụ phí (sai), Excel nhân vào giá gốc (đúng). Engine hiện tại
đã theo Excel. **Không có hành vi nào của tài liệu này yêu cầu đổi công thức.**

**Testplan anchor:** [`testplan/flows/12-cuocphi-phuphi-dau.md`](../../testplan/flows/12-cuocphi-phuphi-dau.md)
`TC-CUOC-001..008` (parity 48/48, kẹp về 0, biên delta = 0, snapshot không hồi tố, lag
tuyến, km × 2 luôn, làm tròn, scale 4 base_fuel_price).

---

### 2.2. Mục 2 docx — Cơ chế cấu hình "động" theo từng Khách hàng

Docx liệt kê **4 nhóm tham số A-D**, mỗi nhóm điều khiển một khía cạnh khác nhau của
phép tính. Cả 4 nhóm đã được ánh xạ vào bảng `freight_rate_terms`
([`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) §3.2) — schema này đã merge ở `c959e7bb`.

#### A. Độ trễ ngày áp dụng (`Lag_Days`)

**Docx anchor (§2A):** "Khi Petrolimex công bố giá dầu mới vào ngày D, mức cước mới sẽ
chỉ được áp dụng cho khách hàng sau đó N ngày (ngày D+N). VD: khách áp dụng ngay (N=0);
khách áp dụng sau 2 ngày (N=2)."

**Code mapping:**

- Cột `freight_rate_terms.fuel_lag_days` (integer, default 0)
- Engine: `targetDate = transportDate − lagDays`
  (`backend/src/services/freight-pricing-engine.service.ts:147-148`)
- Lookup `fuel_price_periods.effective_from ≤ targetDate` (desc + limit 1)

**Trạng thái dữ liệu:** NEWEB = **1 ngày** đã chốt (câu hỏi 2 kèm theo Câu 2 = A,
[09/09](../../docs/prd/CauHoiKhachHang_CuocPhi_2026-09-08.md)). ASKEY / SUNRISE+SJ **chưa có**
(phụ lục 2a, xem §4 open items).

**Testplan anchor:** `TC-CUOC-005` (độ trễ theo tuyến — Phase-2 evidence pending T1).

#### B. Ngưỡng kích hoạt điều chỉnh giá (`Surcharge_Threshold`)

**Docx anchor (§2B):** hỗ trợ **2 dạng tùy chọn** tùy theo hợp đồng:

1. **Ngưỡng %:** chỉ điều chỉnh khi giá dầu tăng/giảm > X% so với kỳ trước
   (VD: > 5%). Khách khác nhau ⇒ X khác nhau.
2. **Ngưỡng tuyệt đối:** chỉ điều chỉnh khi biến động > Z nghìn đồng/lít
   (VD: > 1.500 đ/lít). Khách khác nhau ⇒ Z khác nhau.

**Code mapping:**

- 2 cột `freight_rate_terms.surcharge_threshold_pct` (numeric, nullable)
  và `freight_rate_terms.surcharge_threshold_abs` (numeric, nullable).
- Engine kiểm tra tuần tự: nếu `pct` set & `changePct < pct` ⇒ ratchet về `prevFuel`;
  nếu `abs` set & `priceChange < abs` ⇒ ratchet về `prevFuel`
  (`backend/src/services/freight-pricing-engine.service.ts:189-215`).

**Quy tắc XOR (validation cần có trong T2):** `%` và `abs` **không được đồng thời
khác null** cho cùng dòng `freight_rate_terms` — KH chọn **1 trong 2** dạng tuỳ hợp
đồng. Nếu cả hai null ⇒ không ratchet (giá mới luôn áp). Nếu cả hai set ⇒ reject 409
"chỉ chọn 1 dạng ngưỡng".

**Testplan anchor:** `TC-CUOC-011` (threshold pct dưới ngưỡng ⇒ ratchet về kỳ trước),
`TC-CUOC-012` (threshold abs tương tự), `TC-CUOC-013` (validation XOR — 422 khi cả 2 set).

#### C. Thời điểm kích hoạt mức cước mới (`Activation_Trigger`)

**Docx anchor (§2C):** mô tả 2 mệnh đề:

> (1) "Mọi thông báo điều chỉnh giá cước ... có hiệu lực ngay khi giá dầu mới được
> cập nhật vào hệ thống"
>
> (2) "Toàn bộ các chuyến đi phát sinh thỏa mãn điều kiện Độ trễ ngày áp dụng sẽ tự
> động lấy giá dầu mới"

**Diễn giải kỹ thuật:** 2 mệnh đề này **không loại trừ nhau** — chúng mô tả cùng một
cơ chế từ hai góc:

- (1) = "kỳ giá dầu mới được mở" (admin nhập `fuel_price_periods` mới với `effective_from`)
- (2) = "kỳ giá mới áp lên chuyến" = `transportDate − lagDays ≥ effective_from`

**Code mapping:** engine step 4 — lấy `fuel_price_periods.effective_from ≤ targetDate`
mới nhất. Khi không có kỳ nào trước đó (kỳ đầu tiên) ⇒ giữ giá mới nhất (không có
`prevFuel` để ratchet — xem edge case 4 của [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md)
testplan §1).

**Không có cột schema mới** cho mục này — engine đã đủ.

#### D. Thời điểm khóa cước của chuyến đi (`Trigger_Type`)

**Docx anchor (§2D):** "Giá cước chính thức của chuyến đi được xác định và đóng băng
(Lock) ngay tại thời điểm nhân viên CUS hoặc Điều vận nhập/chọn **Ngày vận chuyển**
(Transport Date) trên hệ thống."

**Code mapping:**

- Engine input `transportDate` (`backend/src/services/freight-pricing-engine.service.ts:53`).
- Snapshot row ghi vào `freight_rate_snapshots` (computedAt = now) — không bao giờ update
  row cũ; row mới với `supersedesId` trỏ về row bị thay thế (xem `CuocPhiThietKeDB.md` §5).

**⭐ Chốt quan trọng (đóng open item 2b):** anchor cố định là **Ngày vận chuyển**
(`transport_date`), **không phải** ngày tạo lô / đóng hàng / trả hàng / xuất hoá đơn.
Đây là quyết định **KH đã xác nhận trong docx 09/09** (mục §2D), đóng item 2b trong
[`CauHoiKhachHang_CuocPhi_2026-09-08.md`](CauHoiKhachHang_CuocPhi_2026-09-08.md) §6.2.7.

**Hệ quả vận hành:**

- Lô tạo hôm nay, `transport_date` = ngày mai ⇒ engine lookup theo ngày mai (trừ lag).
- Đổi `transport_date` sau khi tạo ⇒ **supersede** snapshot, không mutate row cũ
  (xem edge case §3.2 của tài liệu này + `TC-CUOC-010` testplan).

---

### 2.3. Mục 3 docx — Quy trình tính toán & khóa số liệu tự động (3-step engine)

**Docx anchor (§3):** chuỗi 3 bước khi lô được gán `Ngày vận chuyển`:

1. **Xác định Ngày đối chiếu:** `T_target = T_transport − lag_days`
2. **Truy xuất & kiểm tra giá dầu:** tìm giá hiệu lực tại `T_target`, so với kỳ liền
   trước; đạt/vượt ngưỡng ⇒ cập nhật mốc mới, chưa đạt ⇒ giữ mốc cũ.
3. **Khóa cước:** ghi `system_calculated_freight` vào DB dạng **read-only**; cước đã
   chốt **không bị ảnh hưởng** bởi biến động giá dầu tương lai.

**Code mapping:**

| Bước docx | Engine method | File:line |
|---|---|---|
| Bước 1 (target date) | `subtractDays(transportDate, lagDays)` | `freight-pricing-engine.service.ts:147` |
| Bước 2 (lookup + ratchet) | query `fuel_price_periods` + threshold pct/abs | `freight-pricing-engine.service.ts:152-217` |
| Bước 3 (compute + lock) | `computeFreightRate()` + snapshot persist | `freight-pricing-engine.service.ts:230-247` |

**Cờ kết quả:**

- `source: 'AUTO'` — đủ dữ liệu, tính ra số cước.
- `source: 'MANUAL'` — thiếu dữ liệu (vd thiếu giá gốc 15T), trả về `total=0` với
  `formula` mô tả lý do, không chặn tạo lô.

**Ratchet semantics — single-step (chú ý):**

Engine hiện tại chỉ so sánh với **1 kỳ liền trước** (single-step ratchet). Docx không
nói rõ nếu KH muốn ratchet nhiều bước (recursive: nếu kỳ trước cũng dưới ngưỡng thì
lùi tiếp). **Đây là design note** — KH có thể yêu cầu recursive. Flagged as risk trong
NOTES.md; không chặn wave này nhưng phải ghi nhận.

**Testplan anchor:** `TC-CUOC-009` (lock-at-create), `TC-CUOC-010` (supersede on date
change), `TC-CUOC-011..013` (threshold pct/abs/XOR), `TC-CUOC-014` (ratchet single-step),
`TC-CUOC-015` (MANUAL fallback 15T), `TC-CUOC-016` (snapshot immutability). Tất cả
**BLOCKED — pending T1**, Phase-2 evidence.

---

### 2.4. Mục 4 docx — Đối soát & điều chỉnh đàm phán (Debit Note)

**Docx anchor (§4):**

- Cước tự động đóng băng (`system_calculated_freight`) là **giá gợi ý chuẩn theo hợp đồng gốc**.
- **Quyền nhập đè (Manual Override):** Khi Kế toán lập **Bảng kê / Debit Note** tổng
  hợp cuối tháng để gửi khách, hệ thống **mở ô** cho phép Kế toán nhập đè
  `final_debit_freight` (giá cước thực tế đàm phán) hoặc thêm chiết khấu/giảm giá.

**Code mapping:**

- Bảng `debit_note_overrides` đã có (migration `0064`): cột
  `debit_note_id`, `system_calculated_freight` (read-only copy), `final_debit_freight`
  (nullable, Kế toán nhập), `override_reason` (nullable, bắt buộc iff `final ≠ system`).
- Endpoint `PATCH /api/debit-notes/:id/freight` (đề xuất T1) ghi `final_debit_freight`
  + `override_reason` + audit log.
- Debit note lifecycle hiện hữu (`backend/src/services/debit-note-lifecycle.service.ts`)
  không ghi đè `system_calculated_freight` — chỉ thêm `final_debit_freight` qua override row.

**Quy tắc lý do bắt buộc:**

> Khi `final_debit_freight ≠ system_calculated_freight` ⇒ `override_reason` **phải**
> có nội dung (≥ 10 ký tự, không chỉ whitespace). Ngược lại (final = system) ⇒ lý do
> để trống cho phép.

Đây là rule có thể enforce qua CHECK constraint hoặc validation trong service T1.

**Testplan anchor:** `TC-CUOC-017` (override endpoint ghi đúng cả 2 cột + audit),
`TC-CUOC-018` (lý do bắt buộc khi final ≠ system — 422), `TC-CUOC-019` (Ops-role ghi đè
⇒ 403 — cước đã chốt read-only đối với vận hành).

---

### 2.5. Mục 5 docx — Quy trình vận hành cho Kế toán / CUS

**Docx anchor (§5):**

1. **Cập nhật giá dầu:** Khi Petrolimex công bố giá dầu mới, Kế toán/CUS nhập **một bản
   ghi duy nhất**: `[Ngày hiệu lực] − [Giá dầu DO mới/lít]`.
2. Hệ thống tự động áp công thức, tính độ trễ, kiểm tra ngưỡng và chốt cước cho các
   chuyến ngay khi người dùng nhập Ngày vận chuyển.

**Code mapping:**

- Bảng `fuel_price_periods` (cột: `effective_from`, `unit_price`, `created_by`,
  `created_at`, `deleted_at`). Schema đã có.
- Routes CRUD:
  - `POST /api/config/fuel-prices` — Kế toán/CUS nhập kỳ mới (T2 backend).
  - `GET /api/config/fuel-prices` — liệt kê lịch sử.
  - Validation `unit_price > 0` + `effective_from` không trùng kỳ đang hiệu lực.
- Admin UI (T3 frontend): form nhập giá dầu + bảng lịch sử theo pattern **suppliers
  golden** (tabular-below-680px, colored-text status).

**RBAC kỳ giá dầu (T2):** cho phép `ACCOUNTANT` + `CLERK` (CUS) write; các role khác
chỉ read. Cấu hình RBAC theo matrix `flows/07-rbac-phan-quyen.md` — chưa có ma trận
cước riêng, sẽ bổ sung khi T2 land.

**Testplan anchor:** `TC-CUOC-020` (Kế toán nhập kỳ mới 200 OK + row created),
`TC-CUOC-021` (CUS nhập kỳ mới 200 OK), `TC-CUOC-022` (DRIVER/LAIXE gọi POST ⇒ 403),
`TC-CUOC-023` (effective_from trùng kỳ hiệu lực ⇒ 409).

---

## 3. Edge cases (kế thừa từ CuocPhiThietKeDB.md §1 + PM spec)

| # | Edge case | Testplan anchor | Trạng thái |
|---|---|---|---|
| 1 | Dầu dưới mốc ⇒ surcharge = 0 (không âm) trên chứng từ | `TC-CUOC-002`, `TC-CUOC-003` | Spec §2.1 ✅; UT sẵn sàng |
| 2 | Đổi transport date ⇒ supersede snapshot (không mutate) | `TC-CUOC-010` | Pending T1 |
| 3 | Thiếu 15T base price ⇒ MANUAL, tạo lô vẫn proceed | `TC-CUOC-015` | Spec §2.3 ✅; IT pending T1 |
| 4 | Threshold dưới ngưỡng ⇒ ratchet về kỳ trước; không có kỳ trước ⇒ giữ kỳ mới nhất | `TC-CUOC-011`, `TC-CUOC-014` | Pending T1 |
| 5 | Threshold pct XOR abs (cả 2 set ⇒ 422) | `TC-CUOC-013` | Pending T2 |
| 6 | Ad-hoc (lệnh chạy ngoài) **bypass** engine hoàn toàn | `MasterDataNhaMay.md` §4.5 (ad-hoc đã có), testplan flows/01 CUS-SHIP-10..16 | COVERED (từ wave trước) |
| 7 | Duplicate config keys (cust×route×date) ⇒ 409/422 | `TC-CUOC-024` (config CRUD dup) | Pending T2 |
| 8 | Lag làm target date < kỳ giá dầu đầu tiên ⇒ hiện throw 404 trong engine; **T1 phải soften thành MANUAL fallback** (không block tạo lô) | `TC-CUOC-025` (engine 404 → MANUAL) | **T1 AC bắt buộc** |
| 9 | Ops-role write attempt trên cước đã chốt ⇒ 403 / read-only | `TC-CUOC-019`, `TC-CUOC-022` | Pending T1+T2 |

---

## 4. Open items (chờ KH / User) — DEMO values active on dev/staging; prod awaits real customer values

> **Tracker chính:** ticket `e3873fbc` trên board. Mỗi open item dưới đây cần reply
> từ KH Long Minh (Câu 5) hoặc user (data gaps) trước khi áp dụng production. Trên
> dev/staging, các **DEMO values** sau đang active để team chạy end-to-end:
>
> | Item | DEMO value (dev/staging) | Lý do / ràng buộc |
> |---|---|---|
> | Lag ASKEY / SUNRISE+SJ | **`fuel_lag_days = 0`** | Theo docx §2A example N=0 ("khách áp dụng ngay"); user edit khi KH cung cấp số thật |
> | Threshold X / Z | **`surcharge_threshold_pct = 5%` / `surcharge_threshold_abs = 1500đ` / `NULL`** | DEMO ladder: 5% pct cho NEWEB, 1500đ abs cho ASKEY, NULL (always-adjust) cho SUNRISE+SJ. Prod awaiting real customer values |
> | 15T base price ×3 | **3.500.000đ (NEWEB) / 3.400.000đ (ASKEY/SUNRISE+SJ)** | DEMO ladder seeded for dev/staging; MANUAL fallback仍works if missing (TC-CUOC-015). Prod awaiting real customer values |
> | Câu 5 (other customers) | **assumed (A) only Long Minh** | Schema + engine đáp ứng Long Minh duy nhất; khách khác tiếp tục nhập tay. Nếu KH = (B), reopen thêm cột `pricing_model` + UI |
>
> Các mục dưới vẫn được track open (KH có thể reply bất cứ lúc nào) nhưng **không
> chặn code wave** — DEMO values hợp lệ vận hành trên dev/staging.

### 4.1. Câu 5 — Khách hàng khác ngoài Long Minh có dùng mô hình này không?

- **DEMO value (active on dev/staging): assumed (A) — chỉ Long Minh dùng mô hình này.** Schema
  + engine hiện đáp ứng Long Minh duy nhất; khách khác tiếp tục nhập tay. Prod awaits real customer values.
- Ảnh hưởng nếu KH đổi ý: cần cột `pricing_model` / `formula_variant` trên
  `freight_rate_terms`.
- Nguồn: [`CauHoiKhachHang_CuocPhi_2026-09-08.md`](CauHoiKhachHang_CuocPhi_2026-09-08.md) §Câu 5
- Chờ: KH xác nhận (track ticket `e3873fbc`). KH có thể reply bất cứ lúc nào;
  nếu đổi từ (A) → (B), reopen thêm cột + UI chọn formula variant trong T2.

### 4.2. Lag ASKEY / SUNRISE+SJ (phụ lục 2a)

- **DEMO value (active on dev/staging): `fuel_lag_days = 0` cho cả ASKEY và SUNRISE+SJ** —
  theo docx §2A example N=0 ("khách áp dụng ngay"). Khi KH cung cấp số thật, edit per-row
  qua T2 admin UI không cần code change. Prod awaits real customer values.
- Hiện tại (sau D3): NEWEB = 1 (đã chốt), ASKEY = **0 (DEMO)**, SUNRISE+SJ = **0
  (DEMO)**. Prod awaits real customer values.
- Ảnh hưởng nếu KH sửa: kỳ giá dầu mới sẽ áp lên 2 tuyến này sai ngày cho đến khi có số.
- Chờ: KH xác nhận (track ticket `e3873fbc`).

### 4.3. Giá gốc 15T × 3 tuyến

- **DEMO value (active on dev/staging): `pricing_tables.base_price = 3.500.000đ` (NEWEB) /
  `3.400.000đ` (ASKEY/SUNRISE+SJ)** — DEMO ladder seeded for dev/staging. MANUAL fallback
 仍works when base price is missing (TC-CUOC-015 PASS, Kế toán nhập tay trên chứng từ).
  Prod awaits real customer values.
- Ảnh hưởng nếu KH cung cấp: update 3 dòng `pricing_tables` qua T2; snapshot cũ giữ
  nguyên (no-retro theo Câu 2 = A).
- Chờ: KH bổ sung (track ticket `e3873fbc`) — nhưng **không block wave** vì MANUAL đã hoạt
  động.

### 4.4. Threshold values X / Z cho từng khách

- **DEMO value (active on dev/staging): `surcharge_threshold_pct = 5%` / `surcharge_threshold_abs = 1500đ` /
  `NULL`** cho 3 tuyến Long Minh — DEMO ladder: 5% pct cho NEWEB, 1500đ abs cho ASKEY,
  NULL (always-adjust) cho SUNRISE+SJ. Prod awaits real customer values.
- Ảnh hưởng nếu KH cung cấp: KH chọn **1 trong 2** dạng (XOR validation ở T2 — `TC-CUOC-013`
  ⇒ 422 khi cả 2 set). Edit row qua T3 admin UI không cần code change.
- Chờ: KH bổ sung (track ticket `e3873fbc`) — **không block wave** vì NULL hoạt động hợp lệ.

### 4.5. Item 2a (đã đóng một phần 09/09) — ấn định lại

- 2a "lag của ASKEY/SUNRISE+SJ" đã tách thành §4.2 ở trên (vẫn open).
- Câu hỏi kỳ 30/7 (giá dầu cũ suy ngược ≈ 25.760) đã **rút khỏi danh sách hỏi KH**
  (xem CauHoiKhachHang §Câu 3) — đây là việc nội bộ, không còn open.

---

## 5. Acceptance criteria (cho wave này)

Wave auto-pricing coi là **DONE** khi tất cả dưới đây đúng:

1. **Tài liệu:** PRD này tồn tại, được link từ `docs/prd/README.md`, các mục §2.1–§2.5
   đều có code mapping + testplan anchor.
2. **CuocPhiThietKeDB.md:** status block đổi từ "ĐỀ XUẤT" → "APPROVED DIRECTION" (xem
   §1.2), cập nhật §6.2 để chỉ ra open items đã chốt (1, 2, 4) và còn mở (5 + 2a + 2b).
3. **Testplan:** `testplan/flows/12-cuocphi-phuphi-dau.md` có `TC-CUOC-009..025` với
   trạng thái **BLOCKED — pending T1** và gắn nhãn **Phase-2 evidence**.
4. **Matrix:** `testplan/matrix/2026-09-09-docx-trilogy.md` có §5 mới "PhuongAnTinhCuocTuDong"
   với ≥ 14 rows (1 row/mục docx + edge case trọng yếu).
5. **Không code:** file này không chứa diff code nào ngoài doc + testplan. Mọi thay đổi
   engine/schema/routes/UI đều thuộc ticket T1–T6.
6. **Open items:** §4 liệt kê đầy đủ, mỗi mục cite ticket `e3873fbc` làm tracker và
   đường dẫn câu hỏi nguồn trong `CauHoiKhachHang_*.md`.

---

## 6. Tham chiếu nhanh

- Công thức + 4 quy tắc chốt: [`CuocPhiPhuPhiDau.md`](CuocPhiPhuPhiDau.md)
- Schema + engine + snapshot: [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md)
- Lịch sử câu hỏi KH: [`CauHoiKhachHang_CuocPhi_2026-09-08.md`](CauHoiKhachHang_CuocPhi_2026-09-08.md)
- Testplan cước: [`testplan/flows/12-cuocphi-phuphi-dau.md`](../../testplan/flows/12-cuocphi-phuphi-dau.md)
- Matrix coverage: [`testplan/matrix/2026-09-09-docx-trilogy.md`](../../testplan/matrix/2026-09-09-docx-trilogy.md)
- Open items tracker: ticket `e3873fbc` (board)
- Wave kanban: tickets T1 (`cf5f4e29`), T2 (`a7f6740f`), T3 (`06b1a41f`),
  T4 (`28002a59`), T5 (`d4ae7d0d` = tài liệu này), T6 (`2b5b9b5d`)
- Merge point của engine + schema: commit `c959e7bb` "feat(pricing): freight pricing
  engine, supplier-carrier link, buffered datetime fields", migration `0064_cynical_eddie_brock.sql`
