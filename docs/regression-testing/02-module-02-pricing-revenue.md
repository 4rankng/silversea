# M02 — Báo giá cước và doanh thu phi vận tải

> **Phân hệ 2** — 5 nhóm (2.1–2.5). Nguồn PRD: `docs/prd/Module2.docx`.
> **Tiêu chí toàn phân hệ:** `M02-HT-01` … `M02-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:** `/config/pricing-tables` (bảng giá cố định), `/config/weight-pricing-tiers` (bảng
> giá theo trọng lượng), `/config/lift-pricing` (gợi ý nâng hạ), `/config/ancillary-revenue` (doanh thu
> phi VT). Vai trò thử: `ketoan` (cấu hình), `admin`, `giaonhan` (sử dụng).

---

## 2.1 — Bảng giá cố định theo khách hàng và tuyến

**Quy tắc (PRD M02-2.1):** Chọn đúng mức giá có hiệu lực tại ngày chuyến; không cho 2 mức giá cùng điều
kiện chồng thời gian.

### TC-M02-01-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M02-01-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** có khách A, tuyến T, loại xe X trong danh mục.
- **Các bước:**
  1. Mở `/config/pricing-tables`. Tạo mức giá: khách A, tuyến T, xe X, đơn giá 5.000.000đ, VAT 8%, hiệu lực 01/08/2026.
  2. Tạo chuyến cho A–T–X vào 05/08.
  3. Mở chi tiết chuyến → kiểm tra "Đơn giá áp dụng".
- **Kết quả mong đợi (Pass):**
  - Hệ thống gợi ý đúng 5.000.000đ (đã lấy mức có hiệu lực tại 05/08).
  - Chuyến lưu mức giá đã áp dụng (để đối soát sau).

### TC-M02-01-02 — Thiếu hoặc sai dữ liệu

- **Các bước:** bỏ trống "ngày hiệu lực" → cảnh báo tiếng Việt.

### TC-M02-01-03 — Trường hợp ngoại lệ (sửa giá gợi ý trước chốt, phải nêu lý do + giữ giá ban đầu)

- **Các bước:**
  1. Tạo chuyến → đơn giá gợi ý 5.000.000đ.
  2. Sửa thành 5.500.000đ. Hệ thống yêu cầu "Lý do sửa giá".
  3. Nhập lý do → lưu.
- **Kết quả mong đợi (Pass):** chuyến lưu giá 5.500.000 + giá gốc 5.000.000 + lý do.

### TC-M02-01-04 — Kiểm soát quyền thao tác

- **Vai trò thử:** `laixe`, `customer`
- **Kết quả mong đợi (Pass):** không vào được `/config/pricing-tables`.

### TC-M02-01-05 — Gửi lại/đồng thời + biên: thay giá giữa tháng; chuyến hồi tố; khách chưa có bảng giá.

- **Các bước:**
  1. Tạo 2 mức giá chồng thời gian (cùng khách/tuyến/xe, cùng khoảng) → cảnh báo "chồng thời gian".
  2. Tạo chuyến hồi tố ngày 15/07 trước khi bảng giá có hiệu lực → kiểm tra chọn mức gần nhất hoặc yêu cầu nhập tay.
  3. Tạo chuyến cho khách chưa có bảng giá → cảnh báo, yêu cầu nhập tay.

---

## 2.2 — Bảng giá theo tuyến và trọng lượng cho xe tải hàng rời

**Quy tắc (PRD M02-2.2):** Khoảng trọng lượng không chồng lấn hoặc bỏ khoảng ngoài chủ ý; quy tắc làm
tròn phải chốt.

### TC-M02-02-01 — Tính toán thông thường

- **Vai trò:** `ketoan`
- **Các bước:**
  1. Mở `/config/weight-pricing-tiers`. Tạo các khoảng: 0–5 tấn, 5–10 tấn, 10+ tấn với đơn giá khác nhau.
  2. Tạo chuyến xe tải rời trọng lượng 7 tấn.
- **Kết quả mong đợi (Pass):** Hệ thống chọn bậc 5–10 tấn + giải thích bậc đã dùng.

### TC-M02-02-02 — Thiếu hoặc sai dữ liệu.

### TC-M02-02-03 — Giá trị biên (trọng lượng đúng ranh giới; số lẻ; đơn vị khác tấn)

- **Các bước:**
  1. Trọng lượng đúng 5 tấn → chọn bậc 5–10 (không phải 0–5).
  2. Trọng lượng 5,5 tấn → bậc 5–10.
  3. Nhập 5500 kg → quy đổi đúng sang 5,5 tấn.

### TC-M02-02-04 — Thay đổi hoặc ngoại lệ (trọng lượng ngoài bảng → cảnh báo + chọn giá thủ công có lý do).

### TC-M02-02-05 — Tính nhất quán (tính lại cùng dữ liệu không đổi; khớp báo cáo chi tiết).

---

## 2.3 — Tự động tính doanh thu từ trọng lượng lô hàng

**Quy tắc (PRD M02-2.3):** Doanh thu tính từ trọng lượng hợp lệ và bảng giá tại ngày chuyến; tính lại khi
dữ liệu nguồn đổi trước khi chốt.

### TC-M02-03-01 — Tính toán thông thường

- **Các bước:** tạo chuyến với trọng lượng 8 tấn, bậc giá 5–10 tấn = 700.000đ/tấn, phụ phí 200.000đ, VAT 8%.
- **Kết quả mong đợi (Pass):**
  - Hiển thị công thức: `(8 × 700.000) + 200.000 = 5.800.000đ` trước thuế.
  - VAT = 464.000đ. Tổng = 6.264.000đ.

### TC-M02-03-02 — Thiếu hoặc sai dữ liệu.

### TC-M02-03-03 — Giá trị biên (trọng lượng = 0; vượt tải; thay đổi sau cân lần 2)

- **Các bước:**
  1. Trọng lượng = 0 → cảnh báo "Trọng lượng không hợp lệ".
  2. Cập nhật trọng lượng sau cân lần 2 (trước chốt) → doanh thu tự tính lại.

### TC-M02-03-04 — Thay đổi hoặc ngoại lệ (sau chốt → điều chỉnh, không tự đổi).

### TC-M02-03-05 — Tính nhất quán.

---

## 2.4 — Gợi ý đơn giá nâng hạ theo cảng

**Quy tắc (PRD M02-2.4):** Gợi ý theo đúng cảng và ngày hiệu lực; cho phép sửa có lý do và hiển thị chênh
lệch.

### TC-M02-04-01 — Tính toán thông thường

- **Vai trò:** `ketoan` cấu hình, `giaonhan` sử dụng
- **Các bước:**
  1. Cấu hình `/config/lift-pricing`: cảng Hải Phòng, cont 20", nâng, đơn giá 1.200.000đ, hiệu lực 01/08.
  2. `giaonhan` tạo khoản chi nâng cont 20" ở cảng Hải Phòng ngày 05/08.
- **Kết quả mong đợi (Pass):**
  - Hệ thống gợi ý 1.200.000đ.
  - Nếu nhập 1.000.000đ → hiển thị chênh lệch -200.000đ.

### TC-M02-04-02 — Thiếu hoặc sai dữ liệu.

### TC-M02-04-03 — Giá trị biên (cảng đổi giá giữa ngày; cont khác nhau; cùng lô có cả nâng và hạ)

- **Các bước:**
  1. Cấu hình 2 mức giá cùng cảng khác ngày hiệu lực trong cùng ngày → chọn mức sau.
  2. Cùng lô có 2 dòng: nâng + hạ → mỗi dòng 1 gợi ý riêng.

### TC-M02-04-04 — Thay đổi hoặc ngoại lệ (không có giá phù hợp → không tự điền giá cũ; yêu cầu nhập + ghi chú).

### TC-M02-04-05 — Tính nhất quán.

---

## 2.5 — Theo dõi doanh thu phi vận tải

**Quy tắc (PRD M02-2.5):** Tách riêng hàng lẻ, ghép xe, chênh lệch dịch vụ và khoản khác; mỗi khoản chỉ
ghi nhận một lần.

### TC-M02-05-01 — Luồng nghiệp vụ thông thường

- **Vai trò:** `ketoan`
- **Các bước:**
  1. Mở `/config/ancillary-revenue` (hoặc form nhập doanh thu phi VT).
  2. Tạo khoản: khách A, loại "Hàng lẻ", 2.000.000đ, VAT 8%, ngày 05/08, chứng từ.
- **Kết quả mong đợi (Pass):**
  - Báo cáo theo loại: "Hàng lẻ" tăng 2.000.000đ.
  - Báo cáo theo khách: A tăng 2.000.000đ.

### TC-M02-05-02 — Thiếu hoặc sai dữ liệu.

### TC-M02-05-03 — Trường hợp ngoại lệ (khoản hoàn/giảm trừ dùng số âm có lý do; không sửa khoản đã chốt)

- **Các bước:**
  1. Tạo khoản -500.000đ (hoàn) → yêu cầu lý do.
  2. Sửa khoản đã chốt → chỉ cho tạo điều chỉnh.

### TC-M02-05-04 — Kiểm soát quyền thao tác.

### TC-M02-05-05 — Gửi lại/đồng thời + biên: khoản không gắn chuyến; 1 chứng từ nhiều lô; doanh thu phát sinh kỳ sau.

---

## Bảng nghiệm thu M02

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M02-01-01 |           |         |         |            |

### Tiêu chí toàn phân hệ M02-HT-01 … M02-HT-10

Chạy TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` trên màn hình của M02.

| Mã HT      | Kết quả | Bằng chứng |
| ---------- | ------- | ---------- |
| M02-HT-01  |         |            |
| …          |         |            |
| M02-HT-10  |         |            |
