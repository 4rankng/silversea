# M05 — Công nợ phải thu (AR)

> **Phân hệ 5** — 8 nhóm chức năng (5.1–5.8). Nguồn PRD: `docs/prd/Module5.docx`.
> **Tiêu chí nghiệm thu toàn phân hệ:** `M05-HT-01` … `M05-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:** `/debt` (danh sách công nợ phải thu AR), `/debt/:id` (chi tiết công nợ của 1
> khách hàng AR), `/debt/:id/billing/new` (lập giấy báo nợ cho khách), `/customers/:id/billing/new`
> (lập giấy báo nợ từ trang khách hàng), `/portal/debit-notes` (cổng khách hàng — xem giấy báo nợ
> đã phát hành). Vai trò thử chính: `ketoan` (quản lý / lập), `giamdoc` (xem, duyệt ngoại lệ),
> `customer` (xem cổng khách hàng).
>
> **Lưu ý phân quyền (frontend `adminOnly`):** tất cả route `/debt*` đều chặn `customer`/portal user
> ở guard UI; quyền tạo/sửa/duyệt chi tiết tiếp tục bị khoá ở API. Khi thử các TC có vai trò không
> được phép, phải thử cả trên UI **và** kiểm DevTools Network để chắc API trả 403.

---

## 5.1 — Theo dõi công nợ khách hàng theo giấy báo nợ hoặc hóa đơn

**Quy tắc (PRD M05-5.1):** Số dư hiện tại tính từ các giao dịch hợp lệ và khoản thanh toán; **không
bao giờ sửa trực tiếp số dư**. Hiển thị chi tiết theo từng giấy báo nợ: đã thu, còn nợ, số ngày quá
hạn, lịch sử thanh toán. Giấy báo nợ bị huỷ/điều chỉnh phải có dòng bù trừ rõ ràng, **không biến
mất** khỏi lịch sử.

### TC-M05-01-01 — Hiển thị & tính toán thông thường

- **Mã PRD:** M05-01-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** có khách A với 2 giấy báo nợ (GN-1 = 10.000.000đ đã thu đủ, GN-2 = 12.000.000đ
  chưa thu) và 1 lần thanh toán 10.000.000đ ghi cho GN-1.
- **Các bước:**
  1. Mở `/debt`. Tìm khách A. Mở `/debt/:id`.
  2. Kiểm tra phần "Số dư hiện tại" và bảng "Chi tiết theo giấy báo nợ".
  3. Bấm vào GN-1 → xem mục "Lịch sử thanh toán".
  4. Bấm vào GN-2 → xem cột "Còn nợ", "Số ngày quá hạn".
- **Kết quả mong đợi (Pass):**
  - Số dư hiện tại = 12.000.000đ (= tổng GN-2 còn nợ; GN-1 đã xong).
  - GN-1 hiển thị "Đã thu 10.000.000 / 10.000.000 — Đã hoàn tất".
  - GN-2 hiển thị "Đã thu 0 / 12.000.000 — Còn nợ 12.000.000", số ngày quá hạn tính đúng từ ngày đến
    hạn (xem HT-06).
  - Lịch sử thanh toán của GN-1 liệt kê khoản 10.000.000đ với ngày thu, người ghi nhận, chứng từ.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh `/debt/:id` + ảnh click-through GN-1 và GN-2.

### TC-M05-01-02 — Không có dữ liệu / thiếu dữ liệu

- **Mã PRD:** M05-01-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** có khách B chưa từng phát sinh giao dịch (không có giấy báo nợ, không có thu).
- **Các bước:**
  1. Mở `/debt`. Lọc theo khách B.
  2. Mở `/debt/:id` của B.
- **Kết quả mong đợi (Pass):**
  - Bảng chi tiết rỗng, có dòng "Chưa có giấy báo nợ".
  - Số dư hiện tại = 0, không báo lỗi kỹ thuật, không hiển thị NaN.
  - Cột "Số ngày quá hạn" và "Còn nợ" không xuất hiện (vì không có dòng).

### TC-M05-01-03 — Giá trị biên (khoản thanh toán đúng bằng nợ; huỷ GN ngay trước và sau khi thu)

- **Mã PRD:** M05-01-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Tạo GN-X 5.000.000đ, đến hạn hôm nay. Nhập khoản thu đúng 5.000.000đ cho GN-X.
  2. Kiểm tra trạng thái GN-X và số dư khách.
  3. Tạo GN-Y 3.000.000đ, chưa thu. Huỷ GN-Y → kiểm tra lịch sử có dòng bù trừ.
  4. Tạo GN-Z 2.000.000đ, đã thu đủ rồi mới huỷ → kiểm tra xử lý bù trừ.
- **Kết quả mong đợi (Pass):**
  - GN-X chuyển "Đã hoàn tất"; số dư giảm đúng 5.000.000đ (không âm).
  - Huỷ GN-Y trước thu: dòng bù trừ xuất hiện, số dư về 0 từ GN-Y, lịch sử vẫn thấy GN-Y (đã huỷ).
  - Huỷ GN-Z sau khi thu: cảnh báo "Đã có khoản thu liên quan", yêu cầu lý do + tạo dòng điều chỉnh
    hoàn ngược; dấu vết huỷ không biến mất.

### TC-M05-01-04 — Thay đổi / ngoại lệ / phân quyền (không sửa trực tiếp số dư)

- **Mã PRD:** M05-01-04
- **Vai trò thử:** `ketoan`, `giamdoc`, `customer`
- **Các bước:**
  1. `ketoan` mở `/debt/:id` → tìm trường "Số dư hiện tại" và thử bấm vào để sửa.
  2. `giamdoc` mở `/debt/:id` → kiểm tra chỉ có nút xem/xuất, không có nút "Sửa số dư".
  3. `customer` mở trực tiếp URL `/debt/:id` của khách khác.
- **Kết quả mong đợi (Pass):**
  - Trường số dư là **read-only**; không có control nào để chỉnh số dư trực tiếp. Muốn đổi số dư
    phải tạo điều chỉnh GN hoặc ghi khoản thu.
  - `giamdoc` thấy nút "Xuất", "Tạo điều chỉnh" mờ hoặc ẩn; không có nút sửa số dư.
  - `customer` bị redirect về `/portal/debit-notes` (xem TC-HT-02) và API trả 403 (Network tab).

### TC-M05-01-05 — Gửi lại / đồng thời / tính nhất quán (đối chiếu nhiều màn)

- **Mã PRD:** M05-01-05
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Ghi chú "Số dư hiện tại" của khách A trên `/debt/:id`.
  2. So sánh với tổng "Còn nợ" của tất cả GN đang mở trong bảng chi tiết.
  3. So sánh với tổng AR của khách A trên `/finance` cùng thời điểm.
  4. Network throttling Slow 3G: bấm "Tạo điều chỉnh" 2 lần liên tiếp.
- **Kết quả mong đợi (Pass):**
  - Số dư hiện tại = Σ(Còn nợ các GN đang mở) — chính xác đến đồng.
  - Tổng AR trên `/finance` khớp với số dư hiện tại (xem TC-HT-10).
  - Double-submit chỉ tạo 1 dòng điều chỉnh (xem TC-HT-04).

---

## 5.2 — Phân loại tuổi nợ

**Quy tắc (PRD M05-5.2):** Chia nhóm <30, 31–60, 61–90, >90 ngày theo quy tắc **ngày khoá (locked
date)**. Tổng các nhóm = tổng AR chưa thu **tại cùng thời điểm**. Khoản tranh chấp / chưa đến hạn phải
có nhãn riêng khi khách yêu cầu.

### TC-M05-02-01 — Hiển thị & tính toán thông thường

- **Mã PRD:** M05-02-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách A có 4 GN quá hạn lần lượt 20, 45, 75, 120 ngày.
- **Các bước:**
  1. Mở `/debt/:id` của A. Chọn "Ngày khoá" = hôm nay.
  2. Xem bảng "Phân loại tuổi nợ".
  3. Cộng 4 nhóm và so với "Tổng AR chưa thu".
- **Kết quả mong đợi (Pass):**
  - 4 GN rơi đúng 4 nhóm: <30 / 31–60 / 61–90 / >90.
  - Tổng 4 nhóm = Tổng AR chưa thu (chính xác đến đồng).
  - Mỗi dòng có link tới GN gốc và số ngày quá hạn cụ thể.

### TC-M05-02-02 — Không có dữ liệu

- **Mã PRD:** M05-02-02
- **Vai trò:** `ketoan`
- **Các bước:** mở `/debt/:id` của khách B chưa có nợ quá hạn, chọn ngày khoá = hôm nay.
- **Kết quả mong đợi (Pass):** bảng tuổi nợ rỗng, 4 nhóm đều = 0, có nhãn "Không có khoản quá hạn".

### TC-M05-02-03 — Giá trị biên (ranh giới ngày và multi-group)

- **Mã PRD:** M05-02-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Tạo GN quá hạn đúng 30 ngày → kiểm tra nhóm.
  2. Tạo GN quá hạn đúng 31 ngày → kiểm tra nhóm.
  3. Tạo GN quá hạn đúng 90 ngày và đúng 91 ngày → kiểm tra nhóm.
  4. Chuyển "Ngày khoá" lùi/tới 1 ngày → kiểm tra GN có thể nhảy nhóm.
- **Kết quả mong đợi (Pass):**
  - 30 ngày → nhóm <30; 31 ngày → nhóm 31–60; 90 ngày → nhóm 61–90; 91 ngày → nhóm >90.
  - Khi đổi ngày khoá, GN nhảy nhóm đúng theo số ngày tính tại ngày khoá mới.

### TC-M05-02-04 — Thay đổi / ngoại lệ / phân quyền (khoản tranh chấp, chưa đến hạn)

- **Mã PRD:** M05-02-04
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Đánh dấu GN-2 là "Tranh chấp" (cần lý do).
  2. Tạo GN-3 chưa đến hạn (hạn ở tương lai).
  3. Xem lại bảng tuổi nợ.
- **Kết quả mong đợi (Pass):**
  - GN-2 có nhãn "Tranh chấp", tách riêng khỏi 4 nhóm tuổi nợ (không cộng vào >90 v.v.).
  - GN-3 có nhãn "Chưa đến hạn", tách riêng.
  - Công thức: 4 nhóm tuổi nợ + (Tranh chấp) + (Chưa đến hạn) = Tổng AR chưa thu.

### TC-M05-02-05 — Gửi lại / đồng thời / tính nhất quán (đổi ngày khoá)

- **Mã PRD:** M05-02-05
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Đặt "Ngày khoá" = 31/07/2026 → ghi chú 4 nhóm.
  2. Đặt lại = 31/08/2026 → ghi chú lại.
  3. So sánh tổng AR chưa thu ở 2 thời điểm.
  4. Mở 2 tab cùng đổi ngày khoá cho khách A → kiểm tra xung đột.
- **Kết quả mong đợi (Pass):**
  - Tuổi nợ được tính lại dựa trên ngày khoá, không cache lệch.
  - Nếu giữa 2 ngày có khoản thu mới → tổng AR tháng 8 < tháng 7 đúng bằng khoản thu đó.
  - Xung đột concurrent edit: tab thứ 2 nhận 409 "phiên bản cũ" (TC-HT-23 / Q23).

---

## 5.3 — Hạn mức công nợ và cảnh báo vượt ngưỡng

**Quy tắc (PRD M05-5.3):** Cảnh báo khi **gần** đạt và khi **vượt** hạn mức; ngưỡng cảnh báo sớm cấu
hình được. Hiển thị: hạn mức, dư nợ hiện tại, còn lại, các lô/chuyến gây vượt. Chỉ cho tiếp tục khi
được duyệt + có lý do.
**Phụ thuộc nặng:** Q01 (ngưỡng 80% + cấu hình per-customer) và Q02 (phê duyệt phân cấp: Trưởng
phòng ≤10%, Giám đốc phần lớn hơn).

### TC-M05-03-01 — Hiển thị & tính toán thông thường (cảnh báo gần & vượt)

- **Mã PRD:** M05-03-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách A hạn mức 100.000.000đ, ngưỡng cảnh báo sớm = 80% (mặc định).
- **Các bước:**
  1. Tạo phát sinh cho A lên 79.000.000đ → quan sát `/debt/:id`.
  2. Tạo thêm tới 80.000.000đ.
  3. Tạo thêm tới 100.000.000đ.
- **Kết quả mong đợi (Pass):**
  - 79tr: không cảnh báo. Hiển thị: Hạn mức 100tr / Dư nợ 79tr / Còn lại 21tr.
  - 80tr: cảnh báo vàng "Gần đạt hạn mức (80%)".
  - 100tr: cảnh báo đỏ "Vượt hạn mức (100%)" + liệt kê các lô/chuyến gây vượt.
- **Phụ thuộc:** Q01.
- **Bằng chứng:** ảnh 3 trạng thái cảnh báo.

### TC-M05-03-02 — Không có / thiếu dữ liệu (khách chưa cấu hình hạn mức)

- **Mã PRD:** M05-03-02
- **Vai trò:** `ketoan`
- **Các bước:** mở `/debt/:id` của khách C chưa cấu hình hạn mức.
- **Kết quả mong đợi (Pass):**
  - Hiển thị "Chưa cấu hình hạn mức", không ép số 0, không crash.
  - Không hiện cảnh báo gần/vượt. Có gợi ý/link "Cấu hình hạn mức".

### TC-M05-03-03 — Giá trị biên (đúng 80% và đúng 100%)

- **Mã PRD:** M05-03-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Hạn mức 100.000.000đ. Tạo phát sinh đúng 80.000.000đ.
  2. Tạo thêm đúng 20.000.000đ để đạt 100.000.000đ.
  3. Đổi ngưỡng riêng cho A = 70% → tạo phát sinh tới 70.000.000đ.
- **Kết quả mong đợi (Pass):**
  - Đúng 80% → cảnh báo gần (không phải 79%).
  - Đúng 100% → cảnh báo vượt.
  - Ngưỡng per-customer 70% ghi đè default; cảnh báo sớm chuyển sang 70% (Q01).
- **Phụ thuộc:** Q01.

### TC-M05-03-04 — Thay đổi / ngoại lệ / phân quyền (phê duyệt vượt hạn mức)

- **Mã PRD:** M05-03-04
- **Vai trò thử:** `ketoan`, `giamdoc`
- **Các bước:**
  1. Khách A đang ở 100% hạn mức. Tạo lô mới khiến vượt 8%.
  2. `ketoan` duyệt ngoại lệ 8% + lý do → kiểm tra kết quả.
  3. `ketoan` thử duyệt 15% → kiểm tra bị từ chối.
  4. `giamdoc` duyệt 15% + lý do → kiểm tra kết quả.
  5. Kiểm tra phê duyệt chỉ áp dụng cho lô đó (lô khác vẫn bị chặn).
- **Kết quả mong đợi (Pass):**
  - Phân cấp phê duyệt đúng (Q02): Trưởng phòng ≤10%, Giám đốc phần lớn hơn.
  - Lý do bắt buộc; phê duyệt giới hạn phạm vi 1 lô/chuyến.
  - Lô không được duyệt vẫn ở trạng thái "Chờ duyệt ngoại lệ".
- **Phụ thuộc:** Q02.

### TC-M05-03-05 — Gửi lại / đồng thời / tính nhất quán (2 người cùng duyệt ngoại lệ)

- **Mã PRD:** M05-03-05
- **Vai trò:** `ketoan`, `giamdoc`
- **Các bước:**
  1. Lô vượt 15%. 2 người cùng bấm "Duyệt ngoại lệ" gần như cùng lúc.
  2. Refresh `/debt/:id` và kiểm tra nhật ký.
- **Kết quả mong đợi (Pass):**
  - First-approve-wins: 1 người thắng, người thứ 2 nhận "Đã được duyệt bởi người khác" (Q23).
  - Nhật ký ghi cả 2 lần thử + người duyệt cuối cùng.
  - Dư nợ và cảnh báo cập nhật đúng sau duyệt.

---

## 5.4 — Tách cước vận chuyển và khoản chi hộ trong công nợ

**Quy tắc (PRD M05-5.4):** Mỗi giao dịch giữ đúng nhóm (cước / chi hộ / khác); tổng hai nhóm + khác =
tổng AR. Chi tiết & báo cáo tách riêng cước, chi hộ, thuế, tổng. Khoản thanh toán không chỉ định nhóm
phải có quy tắc phân bổ rõ, không làm hỏng báo cáo thuế.

### TC-M05-04-01 — Hiển thị & tính toán thông thường

- **Mã PRD:** M05-04-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách A có cước 10.000.000đ (VAT 8%), chi hộ 2.000.000đ, khoản khác 500.000đ.
- **Các bước:**
  1. Mở `/debt/:id` của A. Xem mục "Cơ cấu công nợ".
  2. Mở báo cáo chi tiết và xem các cột Cước / Chi hộ / Thuế / Tổng.
- **Kết quả mong đợi (Pass):**
  - Cước 10.000.000đ, VAT 800.000đ, Chi hộ 2.000.000đ, Khác 500.000đ.
  - Tổng = 10.000.000 + 800.000 + 2.000.000 + 500.000 = 13.300.000đ.
  - Báo cáo hiển thị đủ 4 cột; tổng dòng = tổng cột.
- **Phụ thuộc:** không.

### TC-M05-04-02 — Không có dữ liệu / thiếu nhóm

- **Mã PRD:** M05-04-02
- **Vai trò:** `ketoan`
- **Các bước:** mở `/debt/:id` của khách chỉ có cước, không có chi hộ.
- **Kết quả mong đợi (Pass):**
  - Cột "Chi hộ" = 0 hoặc "—", không bị ẩn causing total sai.
  - Tổng = cước + VAT, chính xác.

### TC-M05-04-03 — Giá trị biên (giao dịch chỉ có VAT; chi hộ không VAT; cước 0)

- **Mã PRD:** M05-04-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Tạo chi hộ 1.000.000đ không VAT → kiểm tra nhóm và tổng.
  2. Tạo cước 0đ (chuyến miễn phí đã duyệt) → kiểm tra hiển thị.
  3. Tạo khoản điều chỉnh âm -200.000đ vào nhóm cước → kiểm tra nhãn.
- **Kết quả mong đợi (Pass):**
  - Chi hộ không VAT không cộng vào cột thuế.
  - Cước 0đ hiển thị đúng nhóm, không bị làm tròn thành trống.
  - Điều chỉnh âm có nhãn "Điều chỉnh", trừ vào đúng nhóm (cước), không nhảy nhóm.

### TC-M05-04-04 — Thay đổi / ngoại lệ / phân quyền (thanh toán không chỉ định nhóm)

- **Mã PRD:** M05-04-04
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Khách A có cước 10tr + chi hộ 2tr (tổng 12tr). Nhận thanh toán 5.000.000đ không ghi nhóm.
  2. Quan sát quy tắc phân bổ hệ thống gợi ý.
  3. Xác nhận và kiểm tra báo cáo thuế kỳ sau.
- **Kết quả mong đợi (Pass):**
  - Có quy tắc phân bổ rõ (ví dụ theo tỷ lệ hoặc theo hướng dẫn cấu hình); không rơi vào "khác".
  - Phân bổ hiển thị trước khi lưu; người dùng có thể chỉnh.
  - Báo cáo thuế không bị lệch (cước giảm đúng phần VAT tương ứng).
- **Phụ thuộc:** liên quan Q03 (nếu quy tắc dùng oldest-first).

### TC-M05-04-05 — Gửi lại / đồng thời / tính nhất quán (đối chiếu tổng)

- **Mã PRD:** M05-04-05
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Ghi chú Cước + Chi hộ + Khác trên `/debt/:id`.
  2. So sánh với tổng AR của A trên `/finance`.
  3. Mở báo cáo chi tiết kỳ và cộng tổng theo nhóm.
- **Kết quả mong đợi (Pass):**
  - Σ Cước + Σ Chi hộ + Σ Khác + Σ VAT = Tổng AR, khớp trên 3 màn `/debt/:id`, `/finance`, báo cáo
    chi tiết (TC-HT-10).

---

## 5.5 — Báo cáo tổng công nợ bao gồm cước và chi hộ

**Quy tắc (PRD M05-5.5):** Báo cáo tổng đối soát được với chi tiết khách và số dư sổ cái AR tại cùng
thời điểm. Hiển thị: số dư đầu kỳ, phát sinh, đã thu, điều chỉnh, số dư cuối kỳ theo từng khách.
Khách không có giao dịch nhưng còn số dư vẫn phải xuất hiện.

### TC-M05-05-01 — Hiển thị & tính toán thông thường

- **Mã PRD:** M05-05-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** kỳ 08/2026 có 3 khách với phát sinh + thu + điều chỉnh.
- **Các bước:**
  1. Mở báo cáo tổng công nợ AR kỳ 08/2026.
  2. Kiểm tra các cột: Đầu kỳ, Phát sinh, Đã thu, Điều chỉnh, Cuối kỳ theo khách.
  3. Cộng cột Cuối kỳ và so với sổ cái AR tổng.
- **Kết quả mong đợi (Pass):**
  - Mỗi dòng khách có đủ 5 cột; số cuối kỳ = đầu kỳ + phát sinh − đã thu ± điều chỉnh.
  - Tổng cột Cuối kỳ = số dư AR tổng trên `/finance` (TC-HT-10).

### TC-M05-05-02 — Không có dữ liệu

- **Mã PRD:** M05-05-02
- **Vai trò:** `ketoan`
- **Các bước:** mở báo cáo kỳ tương lai chưa có giao dịch.
- **Kết quả mong đợi (Pass):** bảng rỗng, có nhãn "Không có dữ liệu kỳ này", tổng các cột = 0.

### TC-M05-05-03 — Giá trị biên (khách có số dư nhưng 0 giao dịch trong kỳ)

- **Mã PRD:** M05-05-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Đảm bảo khách D còn nợ mang từ kỳ trước (đầu kỳ > 0).
  2. Trong kỳ 08/2026 D không có phát sinh/thu/điều chỉnh.
  3. Mở báo cáo kỳ 08.
- **Kết quả mong đợi (Pass):**
  - D vẫn xuất hiện trong báo cáo với Đầu kỳ = số dư cũ, Phát sinh/Thu/Điều chỉnh = 0, Cuối kỳ =
    Đầu kỳ. **Không bị loại khỏi báo cáo**.

### TC-M05-05-04 — Thay đổi / ngoại lệ / phân quyền (xuất báo cáo & đối soát)

- **Mã PRD:** M05-05-04
- **Vai trò thử:** `ketoan`, `giamdoc`, `customer`
- **Các bước:**
  1. `ketoan` xuất Excel báo cáo tổng kỳ 08.
  2. `giamdoc` mở báo cáo (chỉ xem) và thử xuất.
  3. `customer` thử mở URL báo cáo tổng trực tiếp.
- **Kết quả mong đợi (Pass):**
  - Excel mở được, đủ cột, tổng = tổng màn hình, layout không vỡ (TC-HT-09).
  - `giamdoc` xem và xuất được (nếu trong thẩm quyền) hoặc không thấy nút xuất.
  - `customer` bị redirect về cổng + API 403 (TC-HT-02).

### TC-M05-05-05 — Gửi lại / đồng thời / tính nhất quán (3-way reconciliation)

- **Mã PRD:** M05-05-05
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Cùng thời điểm T, lấy: (a) báo cáo tổng kỳ, (b) chi tiết `/debt/:id` từng khách, (c) sổ cái AR.
  2. So sánh 3 số.
  3. Bấm xuất Excel 2 lần liên tiếp (Slow 3G).
- **Kết quả mong đợi (Pass):**
  - 3 số khớp nhau đến đồng. Nếu lệch, click-through được tới chứng từ (TC-HT-10).
  - Double-submit không tạo 2 tệp trùng hoặc 2 bản ghi xuất (TC-HT-04).

---

## 5.6 — Phân bổ thanh toán theo chuyến hoặc lô hàng

**Quy tắc (PRD M05-5.6):** Cho phép thanh toán một phần + phân bổ theo chỉ dẫn khách; nếu không có
chỉ dẫn, gợi ý theo khoản cũ nhất. Mỗi phân bổ link tới giấy báo nợ và cập nhật còn nợ. Không phân bổ
quá số đã thu hoặc quá số còn nợ trừ khi xác nhận tiền thừa.
**Phụ thuộc:** Q03 (oldest-first mặc định, tiền thừa giữ chưa phân bổ).

### TC-M05-06-01 — Hiển thị & tính toán thông thường (phân bổ theo chỉ dẫn)

- **Mã PRD:** M05-06-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách A có GN-1 (còn nợ 5tr), GN-2 (còn nợ 7tr).
- **Các bước:**
  1. Mở `/debt/:id` của A. Bấm "Ghi thanh toán" 6.000.000đ.
  2. Theo chỉ dẫn khách: phân bổ 4tr GN-1 + 2tr GN-2.
  3. Lưu và xem chi tiết 2 GN.
- **Kết quả mong đợi (Pass):**
  - GN-1 còn nợ 1tr; GN-2 còn nợ 5tr.
  - Mỗi dòng phân bổ link tới giấy báo nợ + chứng từ thu.
  - Tổng phân bổ 6tr = số tiền thu 6tr.
- **Phụ thuộc:** không.

### TC-M05-06-02 — Không có dữ liệu / thiếu (không có chỉ dẫn → gợi ý oldest-first)

- **Mã PRD:** M05-06-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách A có GN-1 (hạn 01/08), GN-2 (hạn 10/08), GN-3 (hạn 05/08).
- **Các bước:**
  1. Ghi thanh toán 5.000.000đ không chỉ dẫn.
  2. Xem gợi ý phân bổ của hệ thống.
  3. Xác nhận.
- **Kết quả mong đợi (Pass):**
  - Hệ thống gợi ý phân bổ theo **khoản đến hạn cũ nhất**: GN-1 trước (Q03).
  - Sau xác nhận: GN-1 giảm 5tr, GN-2/GN-3 không đổi.
- **Phụ thuộc:** Q03.

### TC-M05-06-03 — Giá trị biên (thanh toán đúng bằng nợ; tiền thừa)

- **Mã PRD:** M05-06-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Khách A tổng còn nợ 12.000.000đ. Ghi thu đúng 12.000.000đ → xác nhận.
  2. Ghi thu 15.000.000đ (vượt 12tr) cho khách khác có nợ 12tr.
- **Kết quả mong đợi (Pass):**
  - Trường hợp 1: tất cả GN hoàn tất, số dư = 0 (không âm).
  - Trường hợp 2: 3.000.000đ giữ ở trạng thái "Chưa phân bổ" (Q03), cảnh báo tiền thừa.

### TC-M05-06-04 — Thay đổi / ngoại lệ / phân quyền (phân bổ quá mức bị chặn)

- **Mã PRD:** M05-06-04
- **Vai trò:** `ketoan`
- **Các bước:**
  1. GN-1 còn nợ 5tr. Thử phân bổ 6tr vào GN-1 (vượt nợ) mà không có tiền thừa xác nhận.
  2. Thử phân bổ tổng 8tr khi chỉ thu 6tr (vượt thu).
- **Kết quả mong đợi (Pass):**
  - Cả 2 trường hợp bị cảnh báo "Phân bổ vượt (nợ/thu)", không cho lưu trừ khi xác nhận tiền thừa.
  - Có nút "Xác nhận tiền thừa" chỉ kích hoạt khi số thu > số nợ.

### TC-M05-06-05 — Gửi lại / đồng thời / tính nhất quán (re-allocate & đối soát)

- **Mã PRD:** M05-06-05
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Đã phân bổ 6tr cho A. Tạo điều chỉnh đảo phân bổ (3tr sang GN khác).
  2. Kiểm tra dấu vết điều chỉnh và số dư 2 GN.
  3. Slow 3G bấm "Lưu phân bổ" 2 lần.
- **Kết quả mong đợi (Pass):**
  - Điều chỉnh tạo dòng mới, không ghi đè phân bổ cũ; cả 2 phiên bản thấy được (Q22).
  - Số dư các GN cập nhật đúng sau điều chỉnh.
  - Double-submit không tạo 2 lần phân bổ (TC-HT-04).

---

## 5.7 — Nhắc nợ tự động khi đến hạn hoặc quá hạn

**Quy tắc (PRD M05-5.7):** Không gửi cho khách đã thanh toán/tranh chấp/tạm dừng; tránh trùng trong
cùng chu kỳ. Lưu nội dung, kênh, người nhận, thời điểm, kết quả gửi. Kênh lỗi retry theo chính sách
và thông báo người phụ trách.
**Phụ thuộc nặng:** Q04 (lịch: trước hạn 3 ngày, đúng hạn, sau hạn 3 ngày, sau đó mỗi 7 ngày;
08:00–17:30 ngày làm việc; cuối tuần/lễ → 09:00 ngày làm việc tiếp theo; tối đa 1/ngày/khách) và Q05
(email chính, in-app dự phòng, retry 3 lần: 15ph/2h/24h).

### TC-M05-07-01 — Hiển thị & tính toán thông thường (lịch gửi đúng quy tắc)

- **Mã PRD:** M05-07-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** có job scheduler nhắc nợ; khách A có GN đến hạn 04/08/2026 (thứ 3).
- **Các bước:**
  1. Mở trang cấu hình/log nhắc nợ. Xem lịch dự kiến của GN cho khách A.
  2. Kiểm tra các mốc: trước hạn 3 ngày (01/08), đúng hạn (04/08), sau hạn 3 ngày (07/08), sau đó mỗi
     7 ngày.
  3. Kiểm tra giờ gửi dự kiến trong 08:00–17:30 ngày làm việc.
- **Kết quả mong đợi (Pass):**
  - Lịch gửi đúng 4 mốc + mỗi 7 ngày sau đó (Q04).
  - Mỗi dòng log có: người nhận, kênh, thời điểm, nội dung, kết quả.
  - Giờ gửi trong khung 08:00–17:30.
- **Phụ thuộc:** Q04.

### TC-M05-07-02 — Không có dữ liệu (không có GN đến hạn trong kỳ)

- **Mã PRD:** M05-07-02
- **Vai trò:** `ketoan`
- **Các bước:** chạy job reminder trong khoảng thời gian không có GN đến hạn.
- **Kết quả mong đợi (Pass):** log rỗng, không gửi nhắc, không lỗi.

### TC-M05-07-03 — Giá trị biên (cuối tuần/lễ; 2 GN cùng hạn cùng khách)

- **Mã PRD:** M05-07-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Tạo GN đến hạn thứ 7 → kiểm tra lịch chuyển sang thứ 2 09:00.
  2. Tạo 2 GN cùng khách, cùng hạn → kiểm tra số thông báo.
  3. Kiểm tra giới hạn 1 thông báo/khách/ngày.
- **Kết quả mong đợi (Pass):**
  - Hạn thứ 7 → gửi thứ 2 09:00 (Q04).
  - 2 GN cùng hạn cùng khách → chỉ 1 thông báo gộp (Q04).
  - Không bao giờ quá 1 thông báo/khách/ngày.
- **Phụ thuộc:** Q04.

### TC-M05-07-04 — Thay đổi / ngoại lệ / phân quyền (bỏ qua khách đã thu/tranh chấp/tạm dừng)

- **Mã PRD:** M05-07-04
- **Vai trò:** `ketoan`
- **Các bước:**
  1. GN-1 đến hạn nhưng khách đã thanh toán đủ → chạy job.
  2. GN-2 đến hạn, khách đánh dấu "Tranh chấp" → chạy job.
  3. GN-3 đến hạn, khách "Tạm dừng nhắc" → chạy job.
- **Kết quả mong đợi (Pass):**
  - Không gửi nhắc cho GN-1 (đã thu), GN-2 (tranh chấp), GN-3 (tạm dừng).
  - Log ghi rõ lý do bỏ qua: "Đã thanh toán đủ" / "Đang tranh chấp" / "Tạm dừng nhắc".

### TC-M05-07-05 — Gửi lại / đồng thời / tính nhất quán (retry kênh lỗi)

- **Mã PRD:** M05-07-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** `admin` đã cấu hình Resend API key trong `/config/app-settings`; muốn kiểm tra
  nhánh FAILED/retry thì phải có điều kiện buộc provider trả lỗi. Để trống key chỉ kiểm tra console
  fallback và sẽ không sinh retry thất bại.
- **Các bước:**
  1. Kích hoạt nhắc → quan sát log retry.
  2. Kiểm tra thời điểm retry: T, T+15ph, T+2h, T+24h.
  3. Sau lần retry thứ 3 thất bại → kiểm tra trạng thái & thông báo người phụ trách.
- **Kết quả mong đợi (Pass):**
  - Retry đúng 3 lần ở 15ph/2h/24h (Q05).
  - Sau 3 lần lỗi → trạng thái "Thất bại" + thông báo CUS/người phụ trách nội bộ (in-app).
  - Không duplicate thông báo trong cùng chu kỳ.
- **Phụ thuộc:** Q05.

---

## 5.8 — Xuất sao kê và giấy báo nợ gửi khách hàng

**Quy tắc (PRD M05-5.8):** Tệp xuất khớp màn hình, có số, ngày, phạm vi; lưu phiên bản đã gửi. Excel
và PDF rõ ràng, không vỡ dòng, truy được từng giao dịch. Dữ liệu đổi sau khi gửi → tạo phiên bản mới
hoặc điều chỉnh, **không ghi đè** bản cũ.

### TC-M05-08-01 — Hiển thị & tính toán thông thường (xuất giấy báo nợ)

- **Mã PRD:** M05-08-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách A có GN-2 (12.000.000đ) đã phát hành.
- **Các bước:**
  1. Mở `/debt/:id`. Bấm "Xuất giấy báo nợ" cho GN-2 dạng PDF.
  2. Mở file PDF và so với màn hình.
  3. Kiểm tra: số giấy báo nợ, ngày, phạm vi (từ ngày–đến ngày), danh sách giao dịch, tổng.
- **Kết quả mong đợi (Pass):**
  - PDF có đủ: số GN, ngày phát hành, tên khách, danh sách giao dịch, tổng khớp màn hình (TC-HT-09).
  - Mỗi dòng có mã giao dịch để truy ngược.
  - File được lưu là "phiên bản đã gửi" (xem mục "Lịch sử xuất" của GN).
- **Phụ thuộc:** không.

### TC-M05-08-02 — Không có dữ liệu / thiếu (GN chưa có giao dịch)

- **Mã PRD:** M05-08-02
- **Vai trò:** `ketoan`
- **Các bước:** mở GN-0 (mới tạo, chưa có dòng giao dịch) → bấm "Xuất".
- **Kết quả mong đợi (Pass):**
  - Cảnh báo "Giấy báo nợ chưa có giao dịch, vẫn xuất?" hoặc chặn xuất. Tổng = 0, không vỡ layout.

### TC-M05-08-03 — Giá trị biên (số liệu lớn, nhiều trang, ký tự tiếng Việt)

- **Mã PRD:** M05-08-03
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Tạo GN có > 1 tỷ VNĐ và > 50 dòng giao dịch.
  2. Xuất PDF và Excel.
  3. Mở kiểm tra định dạng số (dấu chấm hàng nghìn), dấu trang, ký tự tiếng Việt có dấu.
- **Kết quả mong đợi (Pass):**
  - Số lớn hiển thị đúng `1.234.567.890 ₫` (TC-HT-05).
  - PDF/Excel không vỡ dòng, có phân trang, tổng ở cuối mỗi trang + tổng cộng.
  - Tiếng Việt có dấu không lỗi font.

### TC-M05-08-04 — Thay đổi / ngoại lệ / phân quyền (đổi sau gửi → tạo phiên bản mới)

- **Mã PRD:** M05-08-04
- **Vai trò:** `ketoan`, `customer`
- **Các bước:**
  1. GN-2 đã xuất & gửi. Sửa giao dịch (thêm dòng điều chỉnh).
  2. Bấm "Xuất lại" → kiểm tra version.
  3. `customer` mở `/portal/debit-notes` → xem GN-2.
- **Kết quả mong đợi (Pass):**
  - Hệ thống tạo **phiên bản mới** (v2), không ghi đè v1 (Q22).
  - Cả 2 phiên bản còn truy cập được; có nhãn "Bản gốc" / "Bản điều chỉnh".
  - Customer chỉ thấy phiên bản đã phát hành mới nhất; không thấy bản nháp.
  - Phân quyền: `customer` chỉ thấy GN của chính mình, không tải được PDF của khách khác (TC-HT-11).

### TC-M05-08-05 — Gửi lại / đồng thời / tính nhất quán (đối soát xuất ↔ màn hình ↔ cổng)

- **Mã PRD:** M05-08-05
- **Vai trò:** `ketoan`, `customer`
- **Các bước:**
  1. `ketoan` xuất GN-2 PDF. `customer` mở GN-2 trên cổng.
  2. So sánh 3 nguồn: màn `/debt/:id`, PDF xuất, cổng `/portal/debit-notes`.
  3. Slow 3G: bấm "Xuất PDF" 2 lần liên tiếp.
- **Kết quả mong đợi (Pass):**
  - 3 nguồn khớp nhau đến đồng; mỗi giao dịch truy được tới chứng từ (TC-HT-10, TC-HT-12).
  - Double-submit không tạo 2 tệp trùng (TC-HT-04).

---

## Bảng nghiệm thu M05

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M05-01-01 |           |         |         |            |
| __/__/__ | TC-M05-01-02 |           |         |         |            |
| __/__/__ | TC-M05-01-03 |           |         |         |            |
| __/__/__ | TC-M05-01-04 |           |         |         |            |
| __/__/__ | TC-M05-01-05 |           |         |         |            |
| __/__/__ | TC-M05-02-01 |           |         |         |            |
| __/__/__ | TC-M05-02-02 |           |         |         |            |
| __/__/__ | TC-M05-02-03 |           |         |         |            |
| __/__/__ | TC-M05-02-04 |           |         |         |            |
| __/__/__ | TC-M05-02-05 |           |         |         |            |
| __/__/__ | TC-M05-03-01 |           |         |         |            |
| __/__/__ | TC-M05-03-02 |           |         |         |            |
| __/__/__ | TC-M05-03-03 |           |         |         |            |
| __/__/__ | TC-M05-03-04 |           |         |         |            |
| __/__/__ | TC-M05-03-05 |           |         |         |            |
| __/__/__ | TC-M05-04-01 |           |         |         |            |
| __/__/__ | TC-M05-04-02 |           |         |         |            |
| __/__/__ | TC-M05-04-03 |           |         |         |            |
| __/__/__ | TC-M05-04-04 |           |         |         |            |
| __/__/__ | TC-M05-04-05 |           |         |         |            |
| __/__/__ | TC-M05-05-01 |           |         |         |            |
| __/__/__ | TC-M05-05-02 |           |         |         |            |
| __/__/__ | TC-M05-05-03 |           |         |         |            |
| __/__/__ | TC-M05-05-04 |           |         |         |            |
| __/__/__ | TC-M05-05-05 |           |         |         |            |
| __/__/__ | TC-M05-06-01 |           |         |         |            |
| __/__/__ | TC-M05-06-02 |           |         |         |            |
| __/__/__ | TC-M05-06-03 |           |         |         |            |
| __/__/__ | TC-M05-06-04 |           |         |         |            |
| __/__/__ | TC-M05-06-05 |           |         |         |            |
| __/__/__ | TC-M05-07-01 |           |         |         |            |
| __/__/__ | TC-M05-07-02 |           |         |         |            |
| __/__/__ | TC-M05-07-03 |           |         |         |            |
| __/__/__ | TC-M05-07-04 |           |         |         |            |
| __/__/__ | TC-M05-07-05 |           |         |         |            |
| __/__/__ | TC-M05-08-01 |           |         |         |            |
| __/__/__ | TC-M05-08-02 |           |         |         |            |
| __/__/__ | TC-M05-08-03 |           |         |         |            |
| __/__/__ | TC-M05-08-04 |           |         |         |            |
| __/__/__ | TC-M05-08-05 |           |         |         |            |

### Tiêu chí toàn phân hệ M05-HT-01 … M05-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` áp dụng trên màn hình của M05 (`/debt`,
`/debt/:id`, `/debt/:id/billing/new`, `/portal/debit-notes`). Đặc biệt chú ý:

- **M05-HT-05 (Tiền tệ):** số AR thường rất lớn — thử với khách có dư nợ > 1 tỷ VNĐ.
- **M05-HT-09 (Tìm kiếm & xuất):** tệp xuất giấy báo nợ phải khớp màn hình và đủ cột Cước/Chi hộ/Thuế.
- **M05-HT-10 (Đối chiếu liên phân hệ):** đối soát `/debt` ↔ `/finance` ↔ báo cáo tổng AR (TC-M05-01-05,
  TC-M05-04-05, TC-M05-05-05).
- **M05-HT-11 (Bảo mật) nếu áp dụng:** tệp PDF giấy báo nợ không truy cập được ngoài hệ thống (TC-M05-08-04).

| Mã HT      | Kết quả | Bằng chứng |
| ---------- | ------- | ---------- |
| M05-HT-01  |         |            |
| M05-HT-02  |         |            |
| M05-HT-03  |         |            |
| M05-HT-04  |         |            |
| M05-HT-05  |         |            |
| M05-HT-06  |         |            |
| M05-HT-07  |         |            |
| M05-HT-08  |         |            |
| M05-HT-09  |         |            |
| M05-HT-10  |         |            |
