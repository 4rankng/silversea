# Luồng 12: Cước phí & Phụ phí dầu (báo giá Long Minh)

> **Vai trò sở hữu:** Kế toán (ACCOUNTANT)
> **Vai trò tham gia:** Admin (cấu hình giá dầu / điều khoản cước), CUS (màn tạo lô xem cước)
> **Route dự kiến:** cấu hình `/config` (giá dầu kỳ, điều khoản cước); tính cước tại phát hành lô/chứng từ
> **PRD nguồn:** [`docs/prd/CuocPhiPhuPhiDau.md`](../../docs/prd/CuocPhiPhuPhiDau.md)
> (công thức + 4 quy tắc đã chốt), [`docs/prd/CuocPhiThietKeDB.md`](../../docs/prd/CuocPhiThietKeDB.md)
> (5 bảng + thuật toán `resolveFreightRate()`), câu-hỏi/đáp-chốt tại
> [`docs/prd/CauHoiKhachHang_CuocPhi_2026-09-08.md`](../../docs/prd/CauHoiKhachHang_CuocPhi_2026-09-08.md)
>
> ---
>
> ## ⚠️ Module CHƯA TRIỂN KHAI — đây là acceptance anchor, chưa phải case chạy được
>
> Các case dưới đây chốt trước theo đúng quy tắc nghiệp vụ đã có quyết định
> (testplan-first). Khi module cước (5 bảng + `resolveFreightRate()` +
> `freight_rate_snapshots`) được triển khai theo `CuocPhiThietKeDB.md` §6.1, bộ này
> là nghiệm thu bắt buộc. Trạng thái chạy: **BLOCKED — awaiting implementation**
> (đủ điều kiện tiền đề hạ tầng mới được tính BLOCKED, không SKIP).
>
> **Quy tắc đã chốt (2026-09-09) mà mọi case kế thừa:**
>
> | Quy tắc | Quyết định | Nguồn |
> |---|---|---|
> | Dầu dưới mốc 17.842,59 đ/l | `H = max(0, (G−F)×E)` = **0** — không giảm cước | Câu 1 = B |
> | Cước đã phát hành | **Snapshot, không hồi tố** khi kỳ giá mới mở | Câu 2 = A |
> | Km tính cước | **Luôn `km một chiều × 2`**, bất kể tận dụng xe | Câu 4 = A |
> | Áp giá mới | Sau **độ trễ theo tuyến** (`fuel_lag_days`; NEWEB = 1 ngày) | Câu 2 (kèm) |
> | Làm tròn | `H`, `J` làm tròn riêng đến đồng (HALF_UP) | chốt trước 09-09 |
>
> ⏳ Đầu vào còn thiếu (không chặn viết case, chỉ chặn chạy): giá gốc 15T (3 tuyến),
> lag days ASKEY/SUNRISE+SJ, mốc ngày chọn kỳ giá dầu (2b).

---

## 12.1 — Công thức & parity với file Excel

### TC-CUOC-001 — Parity 48/48: tái tạo toàn bộ cước sheet `11.7` + `18.7`

- **Vai trò:** ACCOUNTANT (kiểm tra qua chứng từ / API tính cước)
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Tiền điều kiện:** đã seed `freight_rate_terms` (3 tuyến), `pricing_tables`
  (27 dòng, `basePrice`), `fuel_consumption_norms` (9 loại xe),
  `fuel_price_periods` (21.740 @ 2026-07-11; 27.620 @ 2026-07-18)
- **Các bước:**
  1. Với từng tổ hợp (3 tuyến × 8 loại xe có giá gốc × 2 kỳ giá dầu), gọi
     `resolveFreightRate()` với `date` tương ứng mỗi kỳ.
  2. So `freight`, `surcharge`, `total` với cột `J`, `H`, `K` đọc trực tiếp từ file
     `18.7 - BG Long Minh T7.xlsx` (bảng thành phẩm tại `CuocPhiPhuPhiDau.md` §6).
- **Kết quả mong đợi (Pass):**
  - **48/48 mức cước khớp tuyệt đối, sai số 0 đ** — kể cả dòng CONT20 NEWEB 83,2 L
    (nhạy sai số `base_fuel_price` scale 4, xem TC-CUOC-008).
  - `liters` giữ thập phân (33,8 / 83,2 / 91,0); `fuelDelta` giữ 4 số lẻ
    (9.777,4074).
- **Kỳ vọng sai (Fail nếu):** bất kỳ dòng nào lệch ≥ 1 đ; hoặc tham số bị làm tròn
  về đồng trước khi nhân.
- **Bằng chứng:** bảng so 48 dòng (script/UT log) + snapshot file Excel đối chiếu.

### TC-CUOC-002 — Kẹp về 0 khi giá dầu dưới mốc (Câu 1 = B)

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Tiền điều kiện:** đã có kỳ giá dầu **16.000 đ/l** (dưới mốc 17.842,59) hiệu lực
  tại ngày thử; dữ liệu NEWEB CONT40 (91 lít, `J` = 4.182.000 đ).
- **Các bước:**
  1. Tính cước / phát hành chứng từ cho lô NEWEB CONT40 trong kỳ giá 16.000 đ/l.
  2. Xem cước chi tiết trên chứng từ.
- **Kết quả mong đợi (Pass):**
  - Dòng phụ phí dầu = **0 đ** (không âm, không −167.676 đ).
  - Cước cuối = **4.182.000 đ** = đúng `J`; `total = freight`.
  - Nếu UI/đơn in thể hiện phụ phí: hiển thị 0, không hiển thị số âm.
- **Kỳ vọng sai (Fail nếu):** phụ phí âm được ghi nhận / cước thấp hơn `J`.
- **Bằng chứng:** ảnh chứng từ + response API (surcharge = 0) + dòng
  `freight_rate_snapshots` tương ứng.

### TC-CUOC-003 — Biên: giá dầu kỳ đúng bằng mốc F

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P1
- **Các bước:**
  1. Nạp kỳ giá dầu = **17.842,59** đ/l (delta = 0).
  2. Tính cước lô bất kỳ (vd NEWEB CONT40).
- **Kết quả mong đợi (Pass):** `H = 0`, cước = `J`. Không lỗi làm tròn dấu chấm
  động (delta phải là 0 chính xác, không −0,0001 do scale thiếu).
- **Kỳ vọng sai (Fail nếu):** `H` ra ±1 đ quanh 0 do epsilon.
- **Bằng chứng:** UT case boundary + response API.

## 12.2 — Không hồi tố & độ trễ

### TC-CUOC-004 — Snapshot: cước đã phát hành không đổi khi mở kỳ giá mới (Câu 2 = A)

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Tiền điều kiện:** lô đã phát hành trong kỳ 21.740 đ/l (vd 12/7) với phụ phí
  đã chốt; sau đó mở kỳ mới 27.620 đ/l.
- **Các bước:**
  1. Phát hành lô ngày 12/7 (kỳ 21.740) — ghi nhận phụ phí ban đầu.
  2. Nhập kỳ giá dầu mới 27.620 (effective_from 18/7).
  3. Mở lại chứng từ lô 12/7; chạy lại mọi báo cáo doanh thu/công nợ có liên quan.
- **Kết quả mong đợi (Pass):**
  - Chứng từ lô 12/7 giữ nguyên phụ phí cũ; **không** tự nhảy theo 27.620.
  - `freight_rate_snapshots` của lô 12/7 giữ 4 id tham số của kỳ cũ; `computedAt`
    không đổi.
  - Lô mới tạo sau thời điểm áp mới dùng giá 27.620.
- **Kỳ vọng sai (Fail nếu):** bất kỳ job/report nào viết lại cước đã chốt; snapshot
  bị update thay vì insert mới.
- **Bằng chứng:** DB snapshot trước/sau + ảnh chứng từ 2 mốc thời gian + report diff.

### TC-CUOC-005 — Độ trễ theo tuyến (lag): giá mới áp sau `fuel_lag_days`

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P1
- **Tiền điều kiện:** tuyến NEWEB `fuel_lag_days = 1`; có 2 kỳ giá liên tiếp
  (vd 21.740 đến 8/7, 27.620 effective 9/7).
- **Các bước:**
  1. Phát hành 2 lô NEWEB: lô A ngày 9/7, lô B ngày 10/7.
  2. So kỳ giá dầu mà mỗi lô dùng (xem `fuelPricePeriodId` trong snapshot).
- **Kết quả mong đợi (Pass):**
  - Lô A (9/7) dùng giá **cũ** (effective_from ≤ 9/7 − 1 = 8/7).
  - Lô B (10/7) dùng giá **mới** 27.620.
  - Tuyến lag = 0 (ASKEY/SUNRISE tạm) dùng giá mới ngay từ effective_from.
- **Kỳ vọng sai (Fail nếu):** cả 2 lô cùng một kỳ — lag bị bỏ qua, hoặc lag áp
  sai chiều (lùi ngày thay vì tiến).
- **Bằng chứng:** 2 dòng snapshot với `fuelPricePeriodId` khác nhau.
- **Ghi chú:** khi khách trả lời lag ASKEY/SUNRISE (phụ lục 2a), bổ sung assert cho
  từng tuyến; mốc ngày chọn kỳ (2b) hiện **chưa chốt** — case dùng "ngày phát hành"
  theo giả định `CuocPhiThietKeDB.md` §4.1, sẽ siết lại khi có đáp án.

## 12.3 — Km khứ hồi & làm tròn

### TC-CUOC-006 — Luôn km × 2, kể cả chuyến 1 chiều / ghép (Câu 4 = A)

- **Vai trò:** DISPATCHER (tạo ghép) + ACCOUNTANT (kiểm cước)
- **Mức độ:** P0
- **Các bước:**
  1. Phát hành lô NEWEB cho xe chỉ chạy chiều đi (không có chiều về) — hoặc lô thuộc
     cặp ghép/Kết hợp mà xe tận dụng chiều về chở lô khác.
  2. Xem cước chi tiết (`billedKm` trong snapshot).
- **Kết quả mong đợi (Pass):**
  - `billedKm` = 260 (= 130 × 2) ở **mọi** kịch bản; không có trường "số chiều" ảnh
    hưởng cước; 2 lệnh trong cặp ghép mỗi lệnh tính đủ km khứ hồi riêng.
- **Kỳ vọng sai (Fail nếu):** có nhánh nào cho `billedKm` = 130.
- **Bằng chứng:** snapshot `billedKm` của lô thường + lô ghép.

### TC-CUOC-007 — Làm tròn đến đồng: `H`, `J` tròn riêng; thiếu giá gốc ⇒ nhánh MANUAL

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P1
- **Các bước:**
  1. Tính cước dòng có số lít "xấu" (vd SUNRISE+SJ 10T = 57,6 L, kỳ 18/7 ⇒
     `H` = 563.178,624 → 563.179).
  2. Tính cước loại xe **15T** (chưa có giá gốc).
- **Kết quả mong đợi (Pass):**
  - `H` = 563.179 (HALF_UP, không banker's); `total = ROUND(J) + ROUND(H)` đúng bảng
    §6.1.
  - 15T: rơi nhánh **MANUAL** — không tính tự động, không xuất cước = 0/âm;
    hiển thị thiếu giá để nhập tay.
- **Kỳ vọng sai (Fail nếu):** `H` = 563.178; hoặc 15T ra cước = phụ phí.
- **Bằng chứng:** UT làm tròn + ảnh/ response nhánh MANUAL.

### TC-CUOC-008 — `base_fuel_price` scale 4: không lệch 1 đồng ở CONT20 NEWEB

- **Vai trò:** ACCOUNTANT (dev verify)
- **Mức độ:** P2
- **Các bước:**
  1. Seed `base_fuel_price` với scale 4 (17.842,5926).
  2. Tính CONT20 NEWEB cả 2 kỳ (83,2 L — số lít lớn nhất, nhạy sai số nhất).
- **Kết quả mong đợi (Pass):** khớp Excel 0 đ ở cả 2 kỳ (đã kiểm chứng 48/48 khi
  thiết kế — case này chặn hồi quy nếu ai đổi scale về 2).
- **Kỳ vọng sai (Fail nếu):** lệch đúng 1 đồng ở CONT20 (dấu hiệu scale bị hạ).
- **Bằng chứng:** UT parity (là điều kiện biên của TC-CUOC-001).

---

## 12.4 — Auto-pricing engine (sau khi engine wired & snapshot persist) — `BLOCKED — pending T1`

> **Mục đích:** neo [`PhuongAnTinhCuocTuDong.md`](../../docs/prd/PhuongAnTinhCuocTuDong.md)
> §2.3 (3-step engine) + §2.4 (override) + §2.5 (config CRUD) vào acceptance anchor.
> Tất cả TC dưới đây **BLOCKED — pending T1** (wiring engine) / **pending T2**
> (config CRUD); gắn nhãn **Phase-2 evidence** — chỉ chạy sau khi các ticket liên
> quan đã land + regression local qua `flows/12` baseline green.
>
> **Quy tắc snapshot (kế thừa `CuocPhiThietKeDB.md` §5):** mỗi lần `transport_date`
> được set hoặc đổi, hệ thống **insert** row mới vào `freight_rate_snapshots` với
> `supersedes_id` trỏ về row cũ. Row cũ **không bao giờ** bị UPDATE — chỉ đọc.

### TC-CUOC-009 — Lock-at-create: tạo lô CUS có `transport_date` ⇒ snapshot được ghi ngay

- **Vai trò:** CLERK (CUS, tạo lô) + ACCOUNTANT (verify snapshot)
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Tiền điều kiện:** đã seed `freight_rate_terms` (NEWEB `fuel_lag_days=1`),
  `pricing_tables` (CONT20 có `base_price > 0`), `fuel_consumption_norms`,
  `fuel_price_periods` (kỳ giá mới nhất đang hiệu lực ≥ `transport_date − lag`).
- **Các bước:**
  1. CUS tạo lô NEWEB CONT20 với `transport_date = today`.
  2. Backend gọi `resolveFreightRate()` → snapshot → `persistFreightRateSnapshot()`
     (T1 wiring đảm bảo cả 2 chạy).
- **Kết quả mong đợi (Pass):**
  - 1 row mới trong `freight_rate_snapshots` với `source = 'AUTO'`, `supersedes_id = null`,
    `computed_at` ≈ thời điểm tạo.
  - Snapshot lưu đủ 4 id tham số (`rate_terms_id`, `pricing_table_id`, `fuel_norm_id`,
    `fuel_price_period_id`) + `billed_km`, `liters`, `fuel_delta`, `share_pct`.
  - `shipment_freight.total_amount` hiển thị cùng số với `snapshot.total_amount`.
- **Kỳ vọng sai (Fail nếu):** không có row; row UPDATE thay vì INSERT; thiếu 1 trong 4 id.
- **Bằng chứng:** DB row + response API + ảnh chi tiết lô.
- **Ghi chú:** TC này chứng minh **persistence call đã được wire** (PM test hint #2).

### TC-CUOC-010 — Supersede-on-date-change: đổi `transport_date` ⇒ row cũ immutable, row mới có `supersedes_id`

- **Vai trò:** CLERK + ACCOUNTANT
- **Mức độ:** P0
- **Các bước:**
  1. Lấy lô vừa tạo ở TC-CUOC-009 (`snapshot_v1`).
  2. Đổi `transport_date` từ `today` sang `today + 1`.
  3. Backend gọi lại `resolveFreightRate()` → snapshot mới.
- **Kết quả mong đợi (Pass):**
  - `snapshot_v1`: `computed_at` không đổi, `total_amount` không đổi, **không có UPDATE nào**.
  - `snapshot_v2`: row mới, `supersedes_id = snapshot_v1.id`, `computed_at` mới,
    `total_amount` có thể khác (vì `target_date = today + 1 − lag = today`; nếu đổi
    sang `today − 1` thì target lùi về kỳ cũ hơn ⇒ total khác rõ rệt).
- **Kỳ vọng sai (Fail nếu):** `snapshot_v1` bị UPDATE; `snapshot_v2` không có
  `supersedes_id`; chỉ có 1 row duy nhất.
- **Bằng chứng:** 2 dòng DB trước/sau + audit log + ảnh chi tiết lô (cước mới).

### TC-CUOC-011 — Threshold `%` dưới ngưỡng ⇒ ratchet về kỳ trước

- **Vai trò:** ADMIN (config) + ACCOUNTANT (verify)
- **Mức độ:** P1
- **Tiền điều kiện:** tuyến NEWEB có `surcharge_threshold_pct = 5`; có 2 kỳ giá dầu
  liên tiếp (kỳ trước = 21.740, kỳ sau = 22.500 ⇒ delta +3.5% < 5%).
- **Các bước:**
  1. Tạo lô NEWEB có `transport_date` thuộc kỳ sau (sau khi áp lag).
  2. Quan sát `fuel_price_period_id` trong snapshot.
- **Kết quả mong đợi (Pass):** `fuel_price_period_id` = kỳ **trước** (21.740), không
  phải kỳ sau (22.500). `fuel_delta` = `21.740 − 17.842,59`.
- **Kỳ vọng sai (Fail nếu):** dùng kỳ sau 22.500 (không ratchet), hoặc throw 404.
- **Bằng chứng:** DB row + log engine step 4 (`fuel_price_periods` lookup).

### TC-CUOC-012 — Threshold tuyệt đối (`abs`) dưới ngưỡng ⇒ ratchet tương tự

- **Vai trò:** ADMIN + ACCOUNTANT
- **Mức độ:** P1
- **Tiền điều kiện:** tuyến SUNRISE+SJ có `surcharge_threshold_abs = 1500` đ/lít;
  kỳ trước 21.740, kỳ sau 22.500 ⇒ delta 760 đ/l < 1.500 đ/l.
- **Các bước:** tương tự TC-CUOC-011 nhưng dùng tuyến SUNRISE+SJ + `abs`.
- **Kết quả mong đợi (Pass):** snapshot dùng kỳ trước (21.740).
- **Kỳ vọng sai (Fail nếu):** dùng kỳ sau 22.500.

### TC-CUOC-013 — Validation XOR: `threshold_pct` và `threshold_abs` đồng thời set ⇒ 422

- **Vai trò:** ADMIN (POST config)
- **Mức độ:** P0
- **Các bước:**
  1. `POST /api/config/freight-rate-terms` với `surcharge_threshold_pct = 5` VÀ
     `surcharge_threshold_abs = 1500` (cùng dòng).
- **Kết quả mong đợi (Pass):** `422 Unprocessable Entity` với message rõ ràng
  ("chỉ chọn 1 dạng ngưỡng: % hoặc tuyệt đối"). Không có row được tạo.
- **Kỳ vọng sai (Fail nếu):** 200 OK + row có cả 2 cột set; 500 error thiếu validation.
- **Bằng chứng:** response API + DB không có row mới.

### TC-CUOC-014 — Ratchet single-step: chỉ so với 1 kỳ liền trước (không recursive)

- **Vai trò:** ACCOUNTANT (dev verify)
- **Mức độ:** P2
- **Tiền điều kiện:** 3 kỳ giá dầu liên tiếp: 20.000 (kỳ −2) → 21.000 (kỳ −1) →
  22.500 (kỳ hiện tại); mỗi kỳ cách nhau đều < `threshold_pct = 5%` (delta ~4.8–7%).
  Tuyến NEWEB `fuel_lag_days = 0` để đơn giản.
- **Các bước:** tạo lô với `transport_date` thuộc kỳ hiện tại.
- **Kết quả mong đợi (Pass):** engine so 22.500 với 21.000; nếu < 5% thì ratchet về
  21.000 (không lùi tiếp về 20.000 ngay cả khi 22.500 vs 20.000 cũng < 5%).
  Snapshot `fuel_price_period_id` = kỳ −1.
- **Kỳ vọng sai (Fail nếu):** ratchet về kỳ −2 (recursive — không implement).
- **Bằng chứng:** UT + DB row + design note trong T1/T6 tests về khả năng KH yêu cầu
  recursive.

### TC-CUOC-015 — MANUAL fallback khi thiếu base price (15T)

- **Vai trò:** CLERK (tạo lô) + ACCOUNTANT
- **Mức độ:** P0
- **Tiền điều kiện:** `pricing_tables.base_price = 0` cho `15T` ở tuyến NEWEB (xem
  open item §6.2 mục 8 của `CuocPhiThietKeDB.md`); các tham số khác hợp lệ.
- **Các bước:** tạo lô NEWEB 15T.
- **Kết quả mong đợi (Pass):**
  - Tạo lô **không bị chặn** (200/201).
  - `resolveFreightRate()` trả `source = 'MANUAL'`, `total = 0`, `formula` chứa text
    "Thiếu giá gốc cho 15T — cần nhập tay".
  - Snapshot row vẫn được tạo với `source = 'MANUAL'` (để truy vết + override sau).
  - Chi tiết lô hiển thị badge/hint "MANUAL — nhập tay" + ô cho Kế toán nhập cước.
- **Kỳ vọng sai (Fail nếu):** lô bị chặn tạo; `total = phụ phí` (nhầm nhánh); không có
  snapshot ⇒ mất truy vết.
- **Bằng chứng:** DB row + response API + ảnh UI chi tiết lô MANUAL.

### TC-CUOC-016 — Snapshot immutability: row cũ giữ nguyên qua mọi thay đổi sau

- **Vai trò:** ACCOUNTANT (verify)
- **Mức độ:** P0
- **Các bước:**
  1. Lấy 1 snapshot row bất kỳ (`snapshot_v1.id`).
  2. (a) đổi `pricing_tables.base_price`; (b) đổi `freight_rate_terms.share_pct`;
     (c) đổi `fuel_consumption_norms.liters_per_km`; (d) đổi `fuel_price_periods.unit_price`;
     (e) xoá row config (soft delete).
  3. Re-read `snapshot_v1`.
- **Kết quả mong đợi (Pass):** `snapshot_v1.total_amount`, `freight_amount`, `surcharge_amount`,
  `billed_km`, `liters`, `fuel_delta`, `share_pct` — **không thay đổi** sau bất kỳ thao tác
  nào ở trên. Snapshot là bản chốt độc lập với config sau đó.
- **Kỳ vọng sai (Fail nếu):** snapshot `total_amount` update theo config mới (mất audit trail).
- **Bằng chứng:** DB row trước/sau mỗi thay đổi + so sánh từng cột.
- **Ghi chú:** TC này là rào chắn cho **Câu 2 = A — không hồi tố** ở cấp hệ thống, bổ sung
  cho TC-CUOC-004 (chỉ test ở mức "kỳ mới mở").

### TC-CUOC-017 — Debit-note override: PATCH ghi `final_debit_freight` + audit log

- **Vai trò:** ACCOUNTANT (lập Bảng kê / Debit Note)
- **Mức độ:** P0
- **Các bước:**
  1. Lô có snapshot `system_calculated_freight = 4.182.000 đ` (NEWEB CONT40, kỳ 21.740).
  2. Debit Note được tạo cuối tháng gộp các lô.
  3. Kế toán `PATCH /api/debit-notes/:id/freight` với `final_debit_freight = 4.500.000 đ`
     + `override_reason = "Thương thảo giảm 318k do đối tác thanh toán sớm"`.
- **Kết quả mong đợi (Pass):**
  - Row mới trong `debit_note_overrides` với 4 cột: `debit_note_id`, `system_calculated_freight`
    (= 4.182.000), `final_debit_freight` (= 4.500.000), `override_reason` (text đầy đủ).
  - Audit log ghi: actor=ACCOUNTANT, before/after, timestamp.
  - Bảng kê gửi khách hiển thị `final_debit_freight` (không phải `system_calculated_freight`).
- **Kỳ vọng sai (Fail nếu):** override ghi đè `system_calculated_freight` (mất truy vết); thiếu
  audit log; Bảng kê hiển thị nhầm cột.
- **Bằng chứng:** DB row + audit log + ảnh Bảng kê.

### TC-CUOC-018 — Lý do bắt buộc khi `final ≠ system` (thiếu lý do ⇒ 422)

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P0
- **Các bước:** PATCH giống TC-CUOC-017 nhưng `override_reason = ""` (rỗng) hoặc chỉ
  whitespace.
- **Kết quả mong đợi (Pass):** `422 Unprocessable Entity` — lý do bắt buộc khi
  `final_debit_freight ≠ system_calculated_freight`. DB không có row mới.
- **Kỳ vọng sai (Fail nếu):** 200 OK + row với lý do rỗng; hoặc PATCH thành công nhưng
  Bảng kê thiếu lý do (incomplete audit).
- **Bằng chứng:** response API + DB không có row + log validation.

### TC-CUOC-019 — Ops-role write attempt trên cước đã chốt ⇒ 403 read-only

- **Vai trò:** OPS (FORWARDER, ACCOUNTANT, …) — vai trò không thuộc RBAC config cước
- **Mức độ:** P0
- **Các bước:** với cookie/token của OPS, gọi `PATCH /api/debit-notes/:id/freight` để
  sửa `final_debit_freight` của Bảng kê đã chốt.
- **Kết quả mong đợi (Pass):** `403 Forbidden` — OPS không có quyền ghi cước (cờ từ
  `CuocPhiPhuPhiDau.md` §8: "đóng băng, đối với khâu vận hành").
- **Kỳ vọng sai (Fail nếu):** 200 OK + DB write; 401 nhầm thay vì 403.
- **Bằng chứng:** response API + DB không đổi.

### TC-CUOC-020 — Kế toán nhập kỳ giá dầu mới (`POST /api/config/fuel-prices`) ⇒ 201

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P0
- **Các bước:** POST với `effective_from = 2026-09-15`, `unit_price = 28.000`.
- **Kết quả mong đợi (Pass):** `201 Created`; 1 row trong `fuel_price_periods`;
  `created_by = ACCOUNTANT.id`.
- **Kỳ vọng sai (Fail nếu):** 422 thiếu validation; 403 sai RBAC.

### TC-CUOC-021 — CUS nhập kỳ giá dầu mới ⇒ 201 (cùng RBAC)

- **Vai trò:** CLERK
- **Mức độ:** P1
- **Các bước:** POST tương tự TC-CUOC-020.
- **Kết quả mong đợi (Pass):** `201 Created`. CUS có quyền nhập giá dầu (theo docx §5).

### TC-CUOC-022 — DRIVER / LAIXE gọi `POST /api/config/fuel-prices` ⇒ 403

- **Vai trò:** DRIVER
- **Mức độ:** P0
- **Kết quả mong đợi (Pass):** `403 Forbidden`. DB không có row.
- **Kỳ vọng sai (Fail nếu):** 200/201.

### TC-CUOC-023 — `effective_from` trùng kỳ hiệu lực ⇒ 409

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P1
- **Các bước:** sau khi tạo kỳ `effective_from = 2026-09-15`, POST tiếp với cùng
  `effective_from` (cùng `unit_price` hoặc khác đều bị reject).
- **Kết quả mong đợi (Pass):** `409 Conflict` — đã có kỳ cho ngày này.
- **Kỳ vọng sai (Fail nếu):** 2 row cùng `effective_from` (mâu thuẫn unique constraint).

### TC-CUOC-024 — Duplicate config key (cust×route×date) ⇒ 409/422

- **Vai trò:** ADMIN
- **Mức độ:** P1
- **Các bước:** POST `freight_rate_terms` với (customer_id, route_id, effective_date)
  trùng 1 row đang hiệu lực.
- **Kết quả mong đợi (Pass):** `409 Conflict` (hoặc `422` tuỳ convention) — không có 2 dòng
  cùng khoá trong cùng thời điểm.
- **Kỳ vọng sai (Fail nếu):** 2 row trùng khoá.

### TC-CUOC-025 — Lag làm target date < kỳ giá dầu đầu tiên ⇒ engine 404 ⇒ MANUAL fallback

- **Vai trò:** ACCOUNTANT (dev verify) + CLERK (tạo lô)
- **Mức độ:** P0
- **Các bước:**
  1. Setup `fuel_lag_days = 30` cho 1 tuyến test (có thể dùng NEWEB tạm).
  2. `fuel_price_periods` chỉ có 1 kỳ `effective_from = 2026-08-01`.
  3. Tạo lô với `transport_date = 2026-08-15` ⇒ `target_date = 2026-07-16` < kỳ đầu tiên.
- **Kết quả mong đợi (Pass):**
  - Engine **không throw 404** (T1 phải soften — bắt buộc theo AC T1).
  - Trả `source = 'MANUAL'`, `formula = "Chưa có giá dầu trước <date> — nhập tay"`.
  - Tạo lô vẫn proceed; Kế toán nhập tay trên chứng từ.
- **Kỳ vọng sai (Fail nếu):** engine throw 404 làm CUS tạo lô thất bại; hoặc fallback
  im lặng dùng kỳ mới nhất (sai — sẽ áp giá tương lai cho ngày quá khứ).
- **Bằng chứng:** DB row MANUAL + response API + log engine.
- **Ghi chú:** đây là **AC bắt buộc của T1** — nếu backend không soften 404, T6 sẽ
  red ngay ở đây.

---

## Đăng ký nghiệm thu

| Ngày thử | Mã TC | Vai trò | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|---------|-----------|---------|---------|------------|
| — | TC-CUOC-001…008 | — | — | **BLOCKED** | module chưa triển khai (UT test-first ở T6) | — |
| — | TC-CUOC-009…010 | — | — | **BLOCKED — pending T1** | engine wiring + snapshot persist + supersede (Phase-2 evidence) | — |
| — | TC-CUOC-011…014 | — | — | **BLOCKED — pending T1** | threshold pct/abs + ratchet single-step (PM test hint #1) | — |
| — | TC-CUOC-015 | — | — | **BLOCKED — pending T1** | MANUAL fallback 15T (UT/IT) | — |
| — | TC-CUOC-016 | — | — | **BLOCKED — pending T1** | snapshot immutability — rào chắn Câu 2 = A | — |
| — | TC-CUOC-017…019 | — | — | **BLOCKED — pending T1** | debit-note override + reason rule + RBAC 403 | — |
| — | TC-CUOC-020…024 | — | — | **BLOCKED — pending T2** | fuel-price entry CRUD + RBAC + dup validation | — |
| — | TC-CUOC-025 | — | — | **BLOCKED — pending T1 (AC bắt buộc)** | engine 404 → MANUAL fallback khi target date < first fuel period | — |
