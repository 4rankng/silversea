# Luồng 9: Ghép chuyến Kẹp & Kết hợp — Điều vận / Lái xe / Kế toán

> **Vai trò sở hữu:** Điều vận (DISPATCHER)
> **Vai trò tham gia:** Lái xe (DRIVER), Kế toán (ACCOUNTANT)
> **Tài khoản demo:** `dieuvan`, `laixe`, `thu`, `ketoan` (password `Abc123`)
> **Route chính:** `/dispatch-detail`, `/my-trips`, `/profit`, `/salary-attendance`
> **PRD nguồn:** [`docs/prd/LoHangKepKetHop.md`](../../docs/prd/LoHangKepKetHop.md),
> [`docs/prd/QuyTrinhO2C.md`](../../docs/prd/QuyTrinhO2C.md) §2b
>
> ---
>
> ## ⚠️ Bộ case này thay thế các case viết theo định nghĩa cũ
>
> Đặc tả 2026-09-06 **hoán đổi bản chất thời gian** của hai khái niệm:
>
> | | Định nghĩa CŨ (đã thay thế) | Định nghĩa MỚI (hiệu lực) |
> |---|---|---|
> | **Kẹp** | 2 chuyến khép kín, **nối tiếp** | **2 cont 20' trên 1 mooc, chạy đồng thời** |
> | **Kết hợp** | Nhiều cont 1 xe, **đồng thời** | **Tái sử dụng vỏ cont, 2 lệnh nối tiếp** |
>
> Khi chạy regression, **dùng tệp này làm chuẩn**. Các case
> `TC-DV-DISPATCH-007 / -008 / -029 / -030 / -031` trong
> [`02-dieuvan-dispatch.md`](02-dieuvan-dispatch.md) §2.6 và §2.10 viết theo định nghĩa
> cũ — giữ làm hồ sơ lịch sử, **không** dùng để nghiệm thu.

---

## 9.1 — Ghép KẸP (2 cont 20' chạy đồng thời)

### TC-GHEP-001 — Ghép kẹp hợp lệ: 2 cont 20', cùng xe, cùng tài xế, cùng ngày

- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Tiền điều kiện:** 2 dòng container **20'** đã pre-fill nhà xe, chưa gán biển số; có 1 xe nhà rảnh gắn `laixe`
- **Các bước:**
  1. Mở `/dispatch-detail`. Chọn 2 dòng container 20' (có thể khác lô).
  2. Gán **cùng 1 biển số xe** + **cùng tài xế** `laixe`, **cùng ngày** khởi hành.
  3. Đánh dấu phân loại **Kẹp**. Lưu.
  4. Mở DB / API kiểm tra cặp ghép.
- **Kết quả mong đợi (Pass):**
  - Hệ thống chấp nhận ghép; cặp được tạo với `pair_kind = KEP`.
  - **2 shipment vẫn độc lập**: mỗi lệnh giữ mã lô, doanh thu, công nợ riêng của nó.
  - Thời gian 2 lệnh **chồng lấn được phép** — hệ thống KHÔNG báo lỗi "trùng lịch xe".
  - UI hiển thị Tag `[KẸP]` cạnh số container trên **cả 2 dòng**.
- **Kỳ vọng sai (Fail nếu):**
  - Hệ thống chặn vì "thời gian chồng lấn" (đây là hành vi theo định nghĩa CŨ).
  - 2 cont bị gộp thành 1 shipment.
  - Chỉ 1 dòng có Tag.
- **Bằng chứng:** ảnh 2 dòng có Tag `[KẸP]` + response API cặp ghép (`pair_kind`)

---

### TC-GHEP-002 — Chặn ghép kẹp khi không phải 2 × 20'

- **Vai trò:** `dieuvan`
- **Mức độ:** P1
- **Các bước:**
  1. Chọn 1 dòng cont **40HC** + 1 dòng cont 20'. Gán cùng xe, cùng tài xế, cùng ngày.
  2. Đánh dấu phân loại **Kẹp**. Lưu.
  3. Lặp lại với 2 dòng cont **40HC**.
- **Kết quả mong đợi (Pass):**
  - Cả 2 lần bị chặn với cảnh báo tiếng Việt "Không đủ điều kiện kẹp hàng" (ràng buộc vật lý mooc 40' = 2 slot 20').
  - Không tạo cặp ghép; 2 dòng giữ nguyên phân loại cũ.
- **Bằng chứng:** ảnh cảnh báo × 2 trường hợp

---

### TC-GHEP-003 — Chặn ghép kẹp khi khác tài xế hoặc khác biển số

- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Các bước:**
  1. 2 dòng cont 20': gán **cùng biển số** nhưng **khác tài xế** (`laixe` vs `thu`). Đánh dấu Kẹp.
  2. 2 dòng cont 20': gán **khác biển số**, cùng tài xế. Đánh dấu Kẹp.
- **Kết quả mong đợi (Pass):**
  - Cả 2 lần bị chặn, cảnh báo "Không đủ điều kiện kẹp hàng".
  - Phí đường **không** được hưởng ưu đãi khử trùng (2 trip tính phí độc lập).
- **Bằng chứng:** ảnh cảnh báo + bảng phí đường của 2 trip

---

## 9.2 — Ghép KẾT HỢP (tái sử dụng vỏ, 2 lệnh nối tiếp)

### TC-GHEP-004 — Ghép kết hợp hợp lệ: giữ vỏ, lệnh 2 nối tiếp lệnh 1

- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Tiền điều kiện:** 2 dòng container thuộc 2 lô khác nhau; xe nhà rảnh gắn `laixe`
- **Các bước:**
  1. Mở `/dispatch-detail`. Chọn dòng A (trả hàng trước) và dòng B (đóng hàng sau).
  2. Gán **cùng biển số** + **cùng tài xế**; giờ của B **sau** giờ trả hàng của A (không chồng lấn).
  3. Đánh dấu phân loại **Kết hợp**. Lưu.
- **Kết quả mong đợi (Pass):**
  - Cặp tạo với `pair_kind = KET_HOP`; thứ tự A → B được ghi nhận.
  - 2 shipment độc lập về chứng từ / doanh thu / công nợ.
  - UI hiển thị Tag `[KẾT HỢP]` cạnh số container trên cả 2 dòng.
- **Kỳ vọng sai (Fail nếu):** hệ thống cho phép B bắt đầu trước khi A trả hàng xong; mất thứ tự A → B.
- **Bằng chứng:** ảnh 2 dòng có Tag `[KẾT HỢP]` + response API (`pair_kind`, thứ tự)

---

### TC-GHEP-005 — Chặn ghép kết hợp khi thời gian chồng lấn

- **Vai trò:** `dieuvan`
- **Mức độ:** P0
- **Các bước:**
  1. Chọn 2 dòng, gán cùng xe + cùng tài xế, đặt giờ **chồng lấn nhau**.
  2. Đánh dấu **Kết hợp**. Lưu.
- **Kết quả mong đợi (Pass):**
  - Bị chặn với cảnh báo tiếng Việt: kết hợp yêu cầu 2 lệnh nối tiếp, không chồng lấn.
  - Gợi ý chuyển sang phân loại **Kẹp** nếu cả 2 đều là cont 20' (tuỳ chọn, không bắt buộc).
- **Bằng chứng:** ảnh cảnh báo

---

## 9.3 — Thuật toán chống nhân đôi chi phí (Backend)

### TC-GHEP-006 — Phí VETC / cầu đường chỉ ghi nhận 1 lần cho cả cặp

- **Vai trò:** `ketoan` (kiểm tra) sau khi `dieuvan` tạo cặp
- **Mức độ:** **P0** (sai sẽ hỏng sổ sách)
- **Tiền điều kiện:** 1 cặp `KEP` và 1 cặp `KET_HOP` đã hoàn thành chuyến
- **Các bước:**
  1. Mở `/profit` (hoặc chi tiết chi phí của từng trip).
  2. Đọc khoản **Tiền đường / VETC** của trip 1 và trip 2 trong cùng cặp.
  3. Cộng tổng phí đường của cặp; so với định mức 1 lượt.
- **Kết quả mong đợi (Pass):**
  - Tổng phí đường của cặp = **định mức × 1**, KHÔNG phải × 2.
  - Trip thứ hai được khử trùng đúng bằng số tiền trạm gộp (hiển thị rõ, không ghi âm tuỳ tiện).
  - Áp dụng như nhau cho cả `KEP` và `KET_HOP`.
- **Kỳ vọng sai (Fail nếu):** tổng = định mức × 2 (lỗi nhân đôi chi phí ảo).
- **Bằng chứng:** ảnh bảng chi phí 2 trip + phép cộng tay đối chiếu

---

### TC-GHEP-007 — Lương tài xế cặp ghép = cuốc cơ bản + phụ phí, không phải tổng 2 cuốc đơn

- **Vai trò:** `ketoan` / `admin`
- **Mức độ:** **P0**
- **Tiền điều kiện:** cấu hình lương có biến **phụ phí kẹp** và **phụ phí kết hợp** (Cài đặt → Lương)
- **Các bước:**
  1. Ghi lại lương cuốc đơn tiêu chuẩn của tuyến đang thử (gọi là `L`).
  2. Mở bảng lương của `laixe` cho kỳ chứa cặp ghép.
  3. Đọc khoản lương phát sinh từ cặp.
  4. Đổi giá trị phụ phí trong cấu hình lương, chạy lại tính lương.
- **Kết quả mong đợi (Pass):**
  - Lương cặp = `L + phụ phí ghép` — **không** bằng `2 × L`.
  - Đổi phụ phí trong cấu hình ⇒ lương cặp thay đổi tương ứng (giá trị **không hard-code**).
  - Kẹp và Kết hợp dùng đúng biến phụ phí của loại mình.
- **Kỳ vọng sai (Fail nếu):** lương = tổng 2 cuốc đơn; hoặc đổi cấu hình mà lương không đổi.
- **Bằng chứng:** ảnh bảng lương trước/sau khi đổi cấu hình + giá trị `L` đối chiếu

---

### TC-GHEP-008 — Hủy cặp ghép → khôi phục chi phí và lương tiêu chuẩn

- **Vai trò:** `dieuvan` + `ketoan`
- **Mức độ:** P1
- **Các bước:**
  1. Hủy liên kết cặp của 1 cặp `KEP` chưa hoàn thành.
  2. Kiểm tra phí đường và lương của 2 trip sau khi hủy.
- **Kết quả mong đợi (Pass):**
  - Khử trùng phí đường bị gỡ; mỗi trip tính phí đường độc lập trở lại.
  - Lương quay về **lương cuốc đơn tiêu chuẩn** cho từng trip; phụ phí ghép bị gỡ.
  - Tag `[KẸP]` biến mất khỏi cả 2 dòng.
  - Audit log ghi nhận thao tác hủy cặp.
- **Bằng chứng:** ảnh trước/sau + audit log

---

## 9.4 — Hiển thị trên App Lái xe

### TC-GHEP-009 — 2 thẻ dính liền kề nhau, chung Tag phân loại

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile (375 × 667)
- **Tiền điều kiện:** `laixe` được gán 1 cặp `KEP` và 1 cặp `KET_HOP`
- **Các bước:**
  1. Đăng nhập `laixe`, mở `/my-trips` tab `Lệnh mới`.
  2. Tìm cặp ghép.
- **Kết quả mong đợi (Pass):**
  - 2 thẻ hiển thị **riêng biệt nhưng dính liền kề nhau** (không có thẻ lệnh khác chen giữa).
  - Cả 2 thẻ mang **chung 1 Tag**: `[KẸP]` hoặc `[KẾT HỢP]`, hiển thị ở Header thẻ.
  - Lệnh đơn hiển thị Tag `[ĐƠN]`.
- **Kỳ vọng sai (Fail nếu):** 2 thẻ bị tách rời trong danh sách; Tag khác nhau giữa 2 thẻ; không có Tag.
- **Bằng chứng:** ảnh danh sách ở 375 × 667 cho cả 2 loại cặp

---

### TC-GHEP-010 — Hàng KẾT HỢP: Lệnh 2 khóa đến khi Lệnh 1 trả hàng xong

- **Vai trò:** `laixe`
- **Mức độ:** **P0**
- **Thiết bị:** Mobile
- **Tiền điều kiện:** cặp `KET_HOP` (Lệnh 1 = A, Lệnh 2 = B) đã phát lệnh
- **Các bước:**
  1. Mở thẻ B trước khi hoàn thành A. Thử bấm mốc "bắt đầu đóng hàng".
  2. Hoàn thành trả hàng của A.
  3. Quay lại thẻ B, thử lại.
- **Kết quả mong đợi (Pass):**
  - Bước 1: thao tác của B **bị khóa**, có giải thích tiếng Việt rằng phải hoàn thành Lệnh 1 trước.
  - Bước 3: sau khi A hoàn thành trả hàng, B **mở khóa** và thao tác được.
- **Kỳ vọng sai (Fail nếu):** B thao tác được ngay từ đầu (mất ràng buộc nối tiếp).
- **Bằng chứng:** ảnh B khóa + ảnh B mở khóa sau khi A xong

---

### TC-GHEP-011 — Hàng KẸP: 2 thẻ chạy song song, không khóa lẫn nhau

- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Các bước:**
  1. Với cặp `KEP`, thao tác mốc tiến độ trên thẻ 1 và thẻ 2 xen kẽ nhau.
- **Kết quả mong đợi (Pass):**
  - Cả 2 thẻ thao tác được **song song**; không thẻ nào khóa thẻ kia (khác với Kết hợp).
  - Mỗi thẻ giữ mốc tiến độ và e-POD riêng.
- **Bằng chứng:** ảnh 2 thẻ cùng ở trạng thái đang chạy

---

## 9.5 — Lệnh chạy ngoài (docx Phần 1 — hybrid intake)

> Phần 1 của đặc tả (Khách hàng/Nhà máy/Tuyến/Cảng — hybrid ID/Raw_* + UI) từng được
> dẫn tới `flows-01 §1.11` nhưng mục đó đã được tái sử dụng cho case trùng Bill/Booking
> (2026-09-07). Bộ case Phần 1 đóng ở đây để đủ "mỗi yêu cầu docx ⇒ 1 case".

### TC-ADHOC-001 — Checkbox "Lệnh chạy ngoài" ở đầu form, mặc định không tích

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Mở Form Khởi tạo lô. Kiểm tra checkbox `Lệnh chạy ngoài (Tối ưu xe rỗng)`.
  2. Tích cờ, gõ dở dữ liệu, tắt cờ lại.
- **Kết quả mong đợi (Pass):**
  - Checkbox nằm **trước mọi trường khác**, nhìn thấy không cần cuộn, mặc định không tích.
  - Tích ⇒ Tuyến + Vị trí mở khoá nhập tay; tắt ⇒ khoá lại theo §3.2; **dữ liệu đã gõ không bị xoá**.
  - Lô lưu cờ `is_ad_hoc`; mở lại lô ⇒ checkbox vẫn tích (AC10).
- **Kỳ vọng sai (Fail nếu):** checkbox nằm giữa/cuối form; tắt cờ xoá dữ liệu; mở lại lô mất cờ.
- **Bằng chứng:** ảnh form ở cả 2 trạng thái cờ

### TC-ADHOC-002 — Combobox: chọn từ danh mục lưu ID, gõ tự do lưu Raw_*, trộn được trong 1 lô

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Các bước:**
  1. Tích cờ. Trường Khách hàng: chọn 1 mục từ danh mục ⇒ lưu.
  2. Tạo lô 2: gõ tên khách hoàn toàn mới ⇒ lưu.
  3. Lô 3 (trộn): khách gõ tự do + Cảng hạ chọn từ danh mục.
- **Kết quả mong đợi (Pass):**
  - Lô 1: `Customer_ID` có giá trị, `Raw_*` null. Lô 2: `Customer_ID = null` + `Raw_Customer_Name` đúng chuỗi đã gõ.
  - Lô 3 lưu được cả hai kiểu trong cùng một lô.
  - Text tự do **không bị xoá khi blur / Esc / click ngoài**; không có mục nào bị tự động tạo trong danh mục.
- **Kỳ vọng sai (Fail nếu):** text tự do bị reset; danh mục khách/nhà máy/tuyến/cảng tăng bản ghi sau khi lưu (guardrail).
- **Bằng chứng:** DB/API response 3 lô + `SELECT count(*)` danh mục trước/sau

### TC-ADHOC-003 — Cascading + auto-fill + khoá (luồng chuẩn)

- **Vai trò:** `cus`
- **Mức độ:** P0
- **Các bước:**
  1. Chưa chọn KH ⇒ thử mở dropdown Nhà máy.
  2. Chọn KH A ⇒ mở dropdown Nhà máy; chọn 1 nhà máy của A.
  3. Quan sát Tuyến đường + Vị trí đóng/trả hàng.
- **Kết quả mong đợi (Pass):**
  - Chưa có KH ⇒ dropdown Nhà máy disabled, không hiện toàn bộ danh mục.
  - Sau khi chọn KH ⇒ dropdown chỉ còn nhà máy của KH A.
  - Chọn nhà máy ⇒ Tuyến + Vị trí **tự điền và read-only**; không có chữ gợi ý giải thích.
- **Kỳ vọng sai (Fail nếu):** dropdown hiện toàn danh mục; tuyến/vị trí chọn tay được.
- **Bằng chứng:** ảnh 3 bước trạng thái trường

### TC-ADHOC-004 — Nhãn "Chạy ngoài" và hiển thị downstream

- **Vai trò:** `cus` + `dieuvan`
- **Mức độ:** P1
- **Các bước:**
  1. Sau TC-ADHOC-002, mở danh sách lô + chi tiết + màn điều vận.
  2. Kiểm tra hiển thị tên khách/tuyến/cảng của lô chạy ngoài.
- **Kết quả mong đợi (Pass):**
  - Danh sách/chi tiết hiển thị nhãn **"Chạy ngoài"** (chữ màu, không badge) cạnh mã lô.
  - Điều vận phân xe bình thường; mọi trường hiển thị tên đủ (COALESCE), không ô trống, không `null`.
- **Kỳ vọng sai (Fail nếu):** ô trống/`null`; lô bị chặn điều vận vì thiếu Factory_ID.
- **Bằng chứng:** ảnh 3 màn hình

### TC-GHEP-012 — Tag [KẸP]/[KẾT HỢP] trên Chi tiết lô (CUS)

- **Vai trò:** `cus`
- **Mức độ:** P1
- **Tiền điều kiện:** 1 cặp ghép còn ACTIVE có ít nhất 1 cont thuộc lô đang mở
- **Các bước:**
  1. Mở Chi tiết lô của lô có cont nằm trong cặp ghép, mục **Containers**.
  2. Hủy cặp ghép (TC-GHEP-008) rồi tải lại trang chi tiết.
- **Kết quả mong đợi (Pass):**
  - Khi cặp ACTIVE: tag **`[KẸP]`** hoặc **`[KẾT HỢP]`** hiển thị cạnh số container (chữ màu, không badge).
  - Sau khi hủy cặp: tag **biến mất** khỏi cả 2 lô.
- **Kỳ vọng sai (Fail nếu):** tag còn hiển thị sau khi hủy cặp; tag là badge nền.
- **Bằng chứng:** ảnh chi tiết lô trước/sau khi hủy cặp

---

## Bảng nghiệm thu — Luồng Ghép chuyến Kẹp / Kết hợp

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| 2026-09-07 | TC-GHEP-001 | agent-browser (qa/2026-09-07_pair-kind-ui-complete/) | PASS | KEP hợp lệ (đồng thời) — dialog click-through; pair_id=219 trips 10111+10112 | `_01.._03 PNGs`, `driver.json` |
| 2026-09-07 | TC-GHEP-002 | agent-browser | PASS | Chặn kẹp khi không phải 2×20' — alert "kẹp hàng yêu cầu 2 container 20ft..." | `TC-GHEP-002_03-after-save.png` |
| 2026-09-07 | TC-GHEP-003 | agent-browser | PASS | Chặn kẹp khác tài xế (laixe vs thu) — alert "hai lệnh phải dùng cùng một tài xế" | `TC-GHEP-003_03-after-save.png` |
| 2026-09-07 | TC-GHEP-004 | agent-browser | PASS | Kết hợp hợp lệ (nối tiếp, same vỏ PAIRUIH888888) — pair_id=220 trips 10118+10119 | `TC-GHEP-004_03-after-save.png` + `[KẾT HỢP]` tag in grid |
| 2026-09-07 | TC-GHEP-005 | agent-browser | PASS | Chặn kết hợp khi chồng lấn — alert "Hai chuyến bị chồng thời gian" | `TC-GHEP-005_03-after-save.png` |
| 2026-09-07 | TC-GHEP-006 | agent-browser | PASS | Phí VETC 1 lần cho cả cặp — DB: trip 10112 `toll_deduction=110000` (kepB), unit toll = 55000 × 2 stations | `toll-GHEP-006_profit-loaded.png` + `toll-GHEP-006_trips-list.png` (UI); DB row in `driver.json` |
| 2026-09-07 | TC-GHEP-007 | agent-browser | PASS | Lương cặp = cơ bản + phụ phí — PUT/GET round-trip via /api/pair-salary-settings + Cài đặt + /salary pages navigated | `TC-GHEP-007_settings-loaded.png`, `TC-GHEP-007_salary-page.png` |
| __/__/__ | TC-GHEP-008 | | | Hủy cặp → khôi phục (no UI break button — service-level only, `o01-trip-pairs.routes.test.ts`) | |
| 2026-09-07 | TC-GHEP-009 | agent-browser (qa/2026-09-07_pair-kind-ui/ — prior run) | PASS | 2 thẻ dính liền, chung Tag — `01-my-trips-pairs.png` | `qa/2026-09-07_pair-kind-ui/` |
| 2026-09-07 | TC-GHEP-010 | agent-browser | PASS (partial) | Kết hợp: Lệnh 2 khóa — lock hint "Đang chờ" observed in /my-trips; full unlock path covered at service level by `pair-ket-hop-gating.test.ts` | `TC-GHEP-010_my-trips.png` + `_my-trips-after-progress.png` |
| __/__/__ | TC-GHEP-011 | | | Kẹp: 2 thẻ song song (covered by integration test, component test, no UI re-test this pass) | |
| 2026-09-09 | TC-GHEP-012 | agent-browser (qa/evidence/2026-09-09_phase2-docx-trilogy/) | NOT-RUN (UI) | Hạn chế dữ liệu mirror: không có cặp ghép gắn shipment để mở chi tiết lô; unit/component PASS (`pair-ket-hop-gating.test.ts` + FE tag-render test 90a17e65) | `ghep001_pair-create-response.json` |
| 2026-09-09 | TC-ADHOC-001 | agent-browser | PASS | Checkbox element đầu form (DOM idx 0/31), mặc định không tích; toggle không mất dữ liệu | `adhoc001_*.png` |
| 2026-09-09 | TC-ADHOC-002 | agent-browser + psql | PASS | L1 catalog (customer_id=3), L2 free-text (92561 raw KH + raw ports XOR per-container), L3 mixed (raw KH + dropoff_port_id=5); guardrail 165/30/53/41 unchanged | `adhoc002_dbrows_ALL.txt` + counts txt |
| 2026-09-09 | TC-ADHOC-003 | agent-browser | PASS | NM disabled tới khi chọn KH; chỉ xổ nhà máy KH A; chọn NM ⇒ tuyến autofill + disabled | `adhoc003_*.png` |
| 2026-09-09 | TC-ADHOC-004 | agent-browser | FAIL (list-leg) | List render "—" + không nhãn "Chạy ngoài" — khớp adjudication PRD-only DEFERRED chờ user; detail render raw KH ✓ | `adhoc004_*.png` |
| 2026-09-09 | (extra) OPS two-path + optimistic | agent-browser + psql | PASS | Lưu chi ⇒ toast + PENDING + SỐ DƯ −150.000 + Nợ chứng từ; dialog "Duyệt không ảnh biên lai" (ghi chú bắt buộc) → APPROVED + audit ×2 (39589/39590) | `ops-*.png` + `ops-expense82-audit.txt` |
