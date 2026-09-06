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

## Bảng nghiệm thu — Luồng Ghép chuyến Kẹp / Kết hợp

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-GHEP-001 | | | Kẹp hợp lệ (đồng thời) | |
| __/__/__ | TC-GHEP-002 | | | Chặn kẹp khi không phải 2×20' | |
| __/__/__ | TC-GHEP-003 | | | Chặn kẹp khác tài xế / khác xe | |
| __/__/__ | TC-GHEP-004 | | | Kết hợp hợp lệ (nối tiếp) | |
| __/__/__ | TC-GHEP-005 | | | Chặn kết hợp khi chồng lấn | |
| __/__/__ | TC-GHEP-006 | | | Phí VETC 1 lần cho cả cặp | |
| __/__/__ | TC-GHEP-007 | | | Lương cặp = cơ bản + phụ phí | |
| __/__/__ | TC-GHEP-008 | | | Hủy cặp → khôi phục | |
| __/__/__ | TC-GHEP-009 | | | 2 thẻ dính liền, chung Tag | |
| __/__/__ | TC-GHEP-010 | | | Kết hợp: Lệnh 2 khóa | |
| __/__/__ | TC-GHEP-011 | | | Kẹp: 2 thẻ song song | |
