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

## Đăng ký nghiệm thu

| Ngày thử | Mã TC | Vai trò | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|---------|-----------|---------|---------|------------|
| — | TC-CUOC-001…008 | — | — | **BLOCKED** | module chưa triển khai | — |
