# Luồng 12: Cước phí & Phụ phí dầu (báo giá Long Minh)

> **Vai trò sở hữu:** Kế toán (ACCOUNTANT)
> **Vai trò tham gia:** Admin (cấu hình giá dầu / điều khoản cước), CUS (màn tạo lô xem cước)
> **Phạm vi hiện hành:** giá dầu, điều khoản cước, tính giá khi nhập Ngày vận chuyển và giá cuối trên chứng từ.
> **PRD nguồn:** [Quy tắc cước](../../docs/prd/CuocPhiPhuPhiDau.md),
> [Dữ liệu và lịch sử](../../docs/prd/CuocPhiThietKeDB.md),
> [Phương án tính cước](../../docs/prd/PhuongAnTinhCuocTuDong.md).
>
> **Đối chiếu lại ngày17/09/2026:** các mã TC được giữ nguyên. Những lần PASS bên dưới là
> lịch sử, không chứng minh mã hiện tại đã chạy. Không còn yêu cầu thiết kế5bảng hoặc
> tự áp lag/ngưỡng ví dụ. Mốc chọn giá là **Ngày vận chuyển**, không phải ngày phát hành.
> Lưu trực tiếp theo quyền, không có phê duyệt. Các đầu vào chưa được khách chốt vẫn
> thiếu; không đổi thành0, không lấy tiền phụ phí làm tổng cước15T.
>
> **Đã chốt:** km×2; H=max(0,(G−F)×E); làm tròn riêng J/H đến đồng; giữ snapshot cũ;
> NEWEB lag1ngày. **Còn mở:** giá gốc15T, lagASKEY/SUNRISE và điều khoản ngưỡng.
> Chỉ dùng dữ liệu giả có nhãn trong fixture kiểm thử; không ghi chúng thành hợp đồng thật.

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
  1. Nạp kỳ giá dầu bằng **giá mốc được lưu với đủ độ chính xác** (ví dụ17.842,5926đ/l ở scale4); không dùng số hiển thị rút gọn17.842,59 để đòi delta=0.
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
  - Lô có Ngày vận chuyển sau thời điểm áp mới (đã tính lag) dùng giá27.620, không phụ thuộc ngày tạo/phát hành.
- **Kỳ vọng sai (Fail nếu):** bất kỳ job/report nào viết lại cước đã chốt; snapshot
  bị update thay vì insert mới.
- **Bằng chứng:** DB snapshot trước/sau + ảnh chứng từ 2 mốc thời gian + report diff.

### TC-CUOC-005 — Độ trễ theo tuyến (lag): giá mới áp sau `fuel_lag_days`

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P1
- **Tiền điều kiện:** tuyến NEWEB `fuel_lag_days = 1`; có 2 kỳ giá liên tiếp
  (vd 21.740 đến 8/7, 27.620 effective 9/7).
- **Các bước:**
  1. Tạo hai lô cùng ngày nhưng Ngày vận chuyển khác nhau: A9/7, B10/7.
  2. So kỳ giá dầu mà mỗi lô dùng (xem `fuelPricePeriodId` trong snapshot).
- **Kết quả mong đợi (Pass):**
  - Lô A (9/7) dùng giá **cũ** (effective_from ≤ 9/7 − 1 = 8/7).
  - Lô B (10/7) dùng giá **mới** 27.620.
  - Tuyến fixture có **thỏa thuận lag=0 rõ ràng** áp ngay từ effective_from. ASKEY/SUNRISE chưa có lag thì báo thiếu điều khoản; không tự dùng0.
- **Kỳ vọng sai (Fail nếu):** cả 2 lô cùng một kỳ — lag bị bỏ qua, hoặc lag áp
  sai chiều (lùi ngày thay vì tiến).
- **Bằng chứng:** 2 dòng snapshot với `fuelPricePeriodId` khác nhau.
- **Ghi chú:** Ngày vận chuyển đã chốt. Không dùng ngày tạo hoặc ngày phát hành để chọn kỳ. Kiểm tra thêm ngày tạo hôm nay/ngày vận chuyển tương lai và lag làm ngày tra giá trước kỳ đầu tiên.

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

## 12.4 — Tính giá, giữ lịch sử và giá cuối

> **Mục đích:** neo [`PhuongAnTinhCuocTuDong.md`](../../docs/prd/PhuongAnTinhCuocTuDong.md)
> §3–7 (ngày áp giá, giá cuối, lịch sử và lỗi) vào tiêu chí nghiệm thu.
> Kết quả chạy 2026-09-10: **PASS** (a–e) + **PARTIAL** (f — CUS workboard row-level
> screenshot gap; data layer + bundle verified). Chi tiết claim ladder:
> `testplan/qa/evidence/2026-09-10_flows12-pricing-regression/RUN-SUMMARY.md`.
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
  `fuel_price_periods` (chọn kỳ mới nhất có ngày hiệu lực **≤** `transport_date − lag`).
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

### TC-CUOC-014 — Nhiều kỳ dưới ngưỡng: không tự chọn quy tắc chưa được chốt

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P0
- **Tiền điều kiện:** hợp đồng chưa chốt mốc so sánh qua nhiều kỳ hoặc xử lý đúng tại ngưỡng.
- **Các bước:** xem giá cho3kỳ liên tiếp20.000→20.500→21.000, ngưỡng ví dụ5%; kiểm tra cả đúng ngưỡng.
- **Kết quả mong đợi:** không suy ra quy tắc single-step/recursive từ ví dụ. Chỉ rõ thiếu điều khoản và cho nhập giá có căn cứ theo quyền; không trình bày giá đoán là AUTO đủ điều kiện.
- **Trạng thái:** quyết định nghiệp vụ còn mở theo PRD§3.2; test thuật toán hiện có không chứng minh khách đã chốt. Không sửa thuật toán hoặc hợp đồng thật chỉ để giữ PASS cũ.

### TC-CUOC-015 — MANUAL fallback khi thiếu base price (15T)

- **Vai trò:** CLERK (tạo lô) + ACCOUNTANT
- **Mức độ:** P0
- **Tiền điều kiện:** Chưa có giá gốc hợp lệ cho15T ở tuyến NEWEB (không có bản giá, hoặc dữ liệu cũ có giá0); các tham số khác hợp lệ. Không nhập giá0 giả vào hợp đồng chỉ để tạo fixture.
- **Các bước:** Tạo lô NEWEB15T, xem trạng thái cước và thử bổ sung giá có căn cứ bằng tài khoản có quyền.
- **Kết quả mong đợi (Pass):**
  - Tạo/lưu thông tin lô không phụ thuộc giá **không bị chặn**.
  - Chỉ rõ thiếu giá gốc và cần nhập giá có căn cứ; không trình bày số0 hoặc riêng phụ phí dầu như tổng cước đã xác định.
  - Giữ nguồn, lý do thiếu giá và lịch sử khi bổ sung. Nếu phiên bản API dùng snapshot MANUAL có số0 kỹ thuật, UI vẫn phải phân biệt với cước0 đã thỏa thuận. Không bắt tạo một snapshot0 giả chỉ vì chưa đủ đầu vào để tính.
  - Người có quyền bổ sung giá; chưa đủ giá thì không coi là sẵn sàng phát hành số tiền cho khách.
- **Kỳ vọng sai (Fail nếu):** Chặn lưu toàn bộ thông tin lô chỉ vì thiếu giá; báo AUTO/tổng phụ phí là tổng cước hợp lệ; hoặc bổ sung giá làm mất nguồn/lịch sử.
- **Bằng chứng:** Response API, trạng thái hiển thị và lịch sử nguồn trước/sau bổ sung; không suy ra mất truy vết chỉ vì không có snapshot khi chưa đủ căn cứ.

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

### TC-CUOC-017 — Giá cuối: PUT snapshot override và giữ lịch sử

- **Vai trò:** ACCOUNTANT (lập Bảng kê / Debit Note)
- **Mức độ:** P0
- **Các bước:**
  1. Lô có snapshot cước hợp đồng4.536.664đ (NEWEB CONT40, kỳ21.740: J4.182.000đ + H354.664đ).
  2. Xem giá cuối của snapshot dùng cho bảng kê trong phạm vi được cấp.
  3. Gọi `PUT /api/pricing/snapshots/:id/override` với `finalDebitFreight: 4500000`, `overrideReason: "Thương thảo giảm36.664đ do đối tác thanh toán sớm"` và khóa idempotency theo hợp đồng API hiện hành.
- **Kết quả mong đợi (Pass):**
  - Override gắn đúng `snapshotId` (cột nguồn `snapshot_id`), giữ `systemCalculatedFreight = 4536664`, lưu `finalDebitFreight = 4500000` và lý do đầy đủ. Tạo mới khi chưa có; sửa hợp lệ không tạo bản trùng cho cùng snapshot.
  - Lịch sử ghi người, thời điểm, giá trước/sau và lý do; không ghi đè snapshot cước hợp đồng.
  - Bảng kê/chứng từ sử dụng đúng giá cuối trong phạm vi được phép điều chỉnh; khóa kỳ/chứng từ vẫn được bảo vệ, không tự mở lại hồ sơ đã phát hành.
- **Kỳ vọng sai (Fail nếu):** Mất cước hợp đồng, lý do hoặc lịch sử; sửa sai snapshot/phạm vi; retry sinh tác động trùng; bảng kê hiển thị nhầm số.
- **Bằng chứng:** Response API, nguồn override/snapshot và lịch sử, ảnh bảng kê. Không tạo bảng/khóa `debit_note_id` chỉ vì ví dụ API cũ từng nhắc tới.

### TC-CUOC-018 — Lý do bắt buộc khi giá cuối khác giá hợp đồng

- **Vai trò:** ACCOUNTANT
- **Mức độ:** P0
- **Các bước:** Dùng cùng `PUT /api/pricing/snapshots/:id/override`, gửi giá cuối khác giá hợp đồng và `overrideReason` rỗng hoặc chỉ có khoảng trắng.
- **Kết quả mong đợi (Pass):** API hiện hành trả400 với lỗi lý do bắt buộc; không tạo/sửa override hoặc snapshot. UI giữ giá đang nhập để sửa lý do.
- **Kỳ vọng sai (Fail nếu):**200 và đã ghi giá khác mà không có lý do, hoặc lỗi làm mất lịch sử đã lưu.
- **Bằng chứng:** Response API, nguồn trước/sau, lỗi và draft trong UI. Không yêu cầu422 nếu hợp đồng validation hiện hành là400.

### TC-CUOC-019 — Vai trò không có quyền không được sửa giá cuối

- **Vai trò:** OPS/FORWARDER, DRIVER; ACCOUNTANT có quyền theo phạm vi không nằm trong nhóm bị cấm này.
- **Mức độ:** P0
- **Các bước:** Với token hợp lệ của từng vai trò không có quyền, gọi `PUT /api/pricing/snapshots/:id/override` để sửa `finalDebitFreight` của một snapshot thật.
- **Kết quả mong đợi (Pass):**403 Forbidden; override, cước hợp đồng và chứng từ không thay đổi. Biết URL/snapshotId không mở rộng quyền.
- **Kỳ vọng sai (Fail nếu):**200 và ghi tiền, hoặc401 che mất kết quả phân quyền dù phiên đăng nhập còn hợp lệ.
- **Bằng chứng:** API theo từng vai trò và đối chiếu nguồn trước/sau.

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

### TC-CUOC-025 — Ngày tra trước kỳ giá đầu tiên: báo thiếu kỳ dầu, không chặn lưu thông tin lô

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

## Đối chiếu hiện hành17/09/2026

- Backend2362/2362 bao gồm engine, snapshot lifecycle, cấu hình và kiểm tra quyền; đây là bằng chứng tự động, không thay cho UI hoặc đồng ý nghiệp vụ ngưỡng.
- TC001/008 cần fileExcel gốc để xác nhận độc lập48dòng; workbook hiện không có trong đầu vào chạyE2E, không công nhận PASS mới từ bảng số chép lại.
- TC011/012 chỉ là fixture có giả định rõ để kiểm tra thuật toán; áp hợp đồng thực cần quyết định đầy đủ ởPRD§3.2. TC014 vẫn cần thông tin nghiệp vụ.
- UI và API tạo điều khoản phải phân biệt chưa nhập lag với số0 được nhập rõ; xemUI-AUD-S24. Không thay đổi lịch sử của hợp đồng đã lưu khi thêm validation.
- Những API/DB name bên trên là gợi ý kiểm tra phiên bản đang dùng; kết quả sản phẩm, quyền, số tiền và lịch sử là căn cứ. Không tạo thêm bảng vì testplan cũ nhắc tên bảng.

## Lịch sử nghiệm thu — không phải kết quả của bản17/09

Các dòng giữ nguyên dưới đây phục vụ truy vết. Đặc biệt PASS15T với giá mẫu và các lượt ADMIN không chứng minh giá hợp đồng thật hoặc quyền CUS/Kế toán hiện hành.

| Ngày thử | Mã TC | Vai trò | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|---------|-----------|---------|---------|------------|
| — | TC-CUOC-001…008 | — | QA (unit) | **PASS (UT)** | engine math + boundary (fuelSurcharge.test 19/19, `fafe5e37`) | `qa/2026-09-09_pricing-engine_t6-phase1.log` |
| 2026-09-10 | TC-CUOC-009…010 | admin (API) | frontend lane | **PASS (live)** | snapshot persist + INSERT-only supersede: 270→271 trên lô 132085, đủ 4 trace ids + billed_km/liters | evidence 2026-09-10_flows12-pricing-regression/checks.md §d |
| — | TC-CUOC-011…014 | — | QA (unit) | **PASS (UT) / live run pending** | threshold pct/abs + ratchet single-step: unit TC-CUOC-007/008 xanh; live hai-ky-scenario chưa chạy | unit log + RUN-SUMMARY gaps |
| 2026-09-10 | TC-CUOC-015 | admin (API) | frontend lane | **PASS (live)** | 15T: AUTO 3.570.000/3.536.000/3.587.500 ×3 tuyến (D4 seed); MANUAL hint khi thiếu điều khoản | evidence checks.md §b–c |
| 2026-09-10 | TC-CUOC-016 | admin (API) | frontend lane | **PASS (live)** | snapshot INSERT-only (không UPDATE), max(id) = live row | evidence checks.md §d |
| 2026-09-10 | TC-CUOC-017…018 | admin (API + UI) | frontend lane | **PASS (live)** | override 404-as-null + reason-iff-diff (400) + PUT 200 row 34; UI section "Giá cước — điều chỉnh báo nợ" | evidence checks.md §d |
| — | TC-CUOC-019 | — | QA (IT) | **PASS (IT)** | RBAC 403 — backend config/RBAC suites (`4abd513b` config 6/6, phase-2) | qa/ phase-2 evidence dir |
| 2026-09-10 | TC-CUOC-020…024 | admin (UI) | frontend lane | **PASS (UI-DRIVEN)** | fuel CRUD 201/409/PUT/DELETE; terms create/XOR radio/explicit-null clearing persisted/dup 409 | evidence RUN-SUMMARY "Re-verified anchors" |
| — | (MDN F5 follow-up) | admin (UI) | frontend lane | **PARTIAL** | CUS workboard row label: data layer + bundle verified, row-level UI screenshot gap (workboard default window); 3 surfaces khác UI-verified | RUN-SUMMARY ladder (f) |
| — | TC-CUOC-025 | — | — | **PASS (UT)** | engine 404→MANUAL fallback: covered by engine integration tests (MANUAL for lag-before-first-period + unconfigured) | backend engine suite |
