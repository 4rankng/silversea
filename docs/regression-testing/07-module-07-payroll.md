# M07 — Quản lý lương, chấm công và nhân sự lái xe

> **Phân hệ 7** — 4 nhóm chức năng (7.1–7.4). Nguồn PRD: `docs/prd/Module7.docx`.
> **Tiêu chí nghiệm thu toàn phân hệ:** `M07-HT-01` … `M07-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:** `/salary` (lương & chấm công), `/config/salary-periods` (kỳ lương), `/penalties`
> (kỷ luật & khấu trừ), `/my-penalties` (cổng lái xe). Vai trò thử chính: `ketoan` (lập/tính),
> `giamdoc` (chốt kỳ, duyệt ngoại lệ), `laixe` (xem), `admin`.
>
> **Lưu ý cấu hình:** hằng số `TRIP_SALARY_WORK_DAYS=26` — số ngày công chuẩn dùng để phân bổ lương cơ
> bản theo tháng. Phụ thuộc mạnh vào **Q09** (chốt per-company-period, không per-driver), **Q10** (chặn
> chốt toàn kỳ khi còn lỗi; chốt từng phần cần phê duyệt + lý do), **Q11** (sau chốt ưu tiên điều chỉnh
> kỳ đang mở; mở lại chỉ trước phát hành và chỉ Giám đốc).

---

## 7.1 — Tự động tính lương theo chuyến, lương cơ bản và ngày chờ việc

**Quy tắc (PRD M07-7.1):** Chỉ tính chuyến thuộc kỳ và đúng lái xe; mỗi chuyến được tính một lần; công
thức và ngày hiệu lực phải rõ. Phiếu lương tách từng thành phần và liên kết tới chuyến hoặc ngày công
nguồn. Chuyến mở khóa hoặc điều chỉnh sau chốt kỳ phải đi qua kỳ điều chỉnh, không sửa âm thầm.

### TC-M07-01-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M07-01-01
- **Vai trò:** `ketoan` (tính), `laixe` (xem)
- **Tiền điều kiện:** kỳ lương tháng 08/2026 đã mở; lái xe LX-A có 20 chuyến đã chốt trong kỳ; đơn giá
  lương chuyến 250.000đ/chuyến; lương cơ bản 8.000.000đ/tháng; 6 ngày chờ việc × 200.000đ; phụ cấp
  1.000.000đ; không khấu trừ.
- **Các bước:**
  1. `ketoan` mở `/salary`, chọn kỳ 08/2026, chọn LX-A.
  2. Bấm "Tính lương" (hoặc để hệ thống tự tính khi mở phiếu).
  3. Kiểm tra các thành phần hiển thị.
  4. `laixe` đăng nhập, mở phiếu lương của mình kỳ 08.
- **Kết quả mong đợi (Pass):**
  - Lương chuyến = 20 × 250.000 = 5.000.000đ; mỗi dòng link tới chuyến nguồn.
  - Lương cơ bản phân bổ theo `TRIP_SALARY_WORK_DAYS=26`: 8.000.000 × (số ngày làm việc thực tế / 26).
  - Ngày chờ việc = 6 × 200.000 = 1.200.000đ; phụ cấp 1.000.000đ.
  - Tổng thực lĩnh cộng đúng các thành phần.
  - `laixe` thấy cùng số liệu, mỗi dòng có link "Xem chuyến".
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh phiếu lương `ketoan` + ảnh cổng `laixe` + ảnh click-through tới 1 chuyến.

### TC-M07-01-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M07-01-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** LX-B có 1 chuyến chưa chốt trong kỳ; đơn giá lương của loại xe mới chưa cấu hình.
- **Các bước:**
  1. Mở phiếu lương LX-B kỳ 08 → bấm "Tính lương".
  2. Để trống "đơn giá lương chuyến" cho loại xe mới → lưu.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt: "Chuyến C-XXX chưa chốt — không tính vào kỳ này" và "Thiếu đơn giá lương cho loại xe Y".
  - Chỉ rõ dữ liệu cần sửa; không ghi nhận kết quả sai; phiếu ở trạng thái "Nháp / Chờ dữ liệu".
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh cảnh báo tiếng Việt.

### TC-M07-01-03 — Giá trị biên (lái xe đổi xe; chuyến qua hai kỳ; nghỉ việc giữa tháng)

- **Mã PRD:** M07-01-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:**
  - LX-C đổi xe giữa tháng (loại xe khác đơn giá).
  - Chuyến C-SPAN bắt đầu 31/07, hoàn thành 01/08.
  - LX-D nghỉ việc 15/08.
- **Các bước:**
  1. Tính lương LX-C kỳ 08 → kiểm tra: mỗi đoạn dùng đúng đơn giá theo loại xe tại thời điểm chuyến.
  2. Tính lương kỳ 07 và kỳ 08 cho LX-C → kiểm tra C-SPAN chỉ xuất hiện 1 lần, ở kỳ có ngày hoàn thành.
  3. Tính lương LX-D kỳ 08 → kiểm tra lương cơ bản chia theo số ngày thực làm (15/26), không cả tháng.
- **Kết quả mong đợi (Pass):**
  - LX-C: 2 mức đơn giá áp dụng đúng theo ngày hiệu lực; mỗi chuyến chỉ tính 1 lần.
  - C-SPAN vào kỳ 08 (ngày hoàn thành), không vào kỳ 07 — khớp Q20.
  - LX-D: lương cơ bản = 8.000.000 × (15/26); phụ cấp chia theo quy định chính sách.
  - Hệ thống giải thích được cách tính ở tooltip/ghi chú.
- **Phụ thuộc:** Q20 (chuyến qua hai kỳ).
- **Bằng chứng:** ảnh 3 phiếu lương + ảnh giải thích cách tính.

### TC-M07-01-04 — Thay đổi hoặc ngoại lệ (mở khóa/điều chỉnh sau chốt kỳ)

- **Mã PRD:** M07-01-04
- **Vai trò:** `ketoan`, `giamdoc`
- **Tiền điều kiện:** kỳ 07/2026 đã chốt; phiếu lương LX-E đã lưu snapshot. Sau chốt, 1 chuyến của LX-E
  bị mở khóa sửa tiền cước (điều chỉnh doanh thu) → ảnh hưởng lương chuyến.
- **Các bước:**
  1. `ketoan` mở phiếu lương LX-E kỳ 07 → thử sửa trực tiếp → chỉ có nút "Tạo khoản điều chỉnh".
  2. `ketoan` tạo khoản điều chỉnh + lý do → kỳ 08.
  3. Kiểm tra snapshot kỳ 07 không đổi; kỳ 08 có dòng điều chỉnh link kỳ 07.
- **Kết quả mong đợi (Pass):**
  - Không cho sửa âm thầm; không ghi đè snapshot đã chốt.
  - Yêu cầu đúng quyền + lý do; lưu giá trị trước/sau, người thực hiện, người duyệt.
  - Dòng điều chỉnh ở kỳ đang mở (08) liên kết tới kỳ gốc (07) — khớp Q11/Q21.
- **Phụ thuộc:** Q11, Q21, Q22.
- **Bằng chứng:** ảnh nút "Tạo điều chỉnh" + ảnh dòng điều chỉnh kỳ 08 + ảnh snapshot kỳ 07 nguyên vẹn.

### TC-M07-01-05 — Tính nhất quán (tính lại, tải lại, khớp báo cáo)

- **Mã PRD:** M07-01-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** phiếu lương LX-A kỳ 08 đã tính.
- **Các bước:**
  1. Bấm "Tính lại" 2 lần liên tiếp → so sánh kết quả.
  2. Lưu, tải lại trang, mở lại phiếu → so sánh.
  3. Xuất báo cáo chi tiết lương kỳ 08 → so tổng với phiếu trên màn.
- **Kết quả mong đợi (Pass):**
  - Kết quả không đổi ngoài chủ ý; không phát sinh dòng trùng.
  - Tổng phiếu = tổng báo cáo chi tiết, chính xác đến đồng.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh 2 lần tính + ảnh báo cáo Excel/PDF.

---

## 7.2 — Lịch chấm công theo loại ngày

**Quy tắc (PRD M07-7.2):** Mỗi lái xe mỗi ngày có một trạng thái chính; ngày có chuyến được đối chiếu
tự động với dữ liệu chuyến. Loại ngày: **chuyến, chờ việc, sửa xe, nghỉ riêng** (+ ghi chú). Xung đột giữa
ngày chuyến và nghỉ phải cảnh báo; sửa sau chốt cần phê duyệt.

### TC-M07-02-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M07-02-01
- **Vai trò:** `ketoan` (nhập), `laixe` (xem)
- **Tiền điều kiện:** kỳ 08/2026 mở; LX-A có 20 ngày có chuyến (đã chốt), 6 ngày chờ việc, 1 ngày sửa xe,
  4 ngày nghỉ riêng; còn ngày chủ nhật.
- **Các bước:**
  1. `ketoan` mở `/salary` → tab "Chấm công" của LX-A tháng 08.
  2. Kiểm tra các ngày có chuyến được tự động đánh dấu "Chuyến".
  3. Nhập tay các ngày "Chờ việc", "Sửa xe", "Nghỉ riêng" + ghi chú.
  4. Kiểm tra tổng ngày theo loại.
- **Kết quả mong đợi (Pass):**
  - Lịch tháng hiển thị rõ từng loại ngày bằng mã màu/nhãn tiếng Việt.
  - Ngày có chuyến không cho sửa tay sang loại khác (chỉ qua điều chỉnh chuyến).
  - Tổng ngày theo loại + tổng ngày tính lương hiển thị, khớp quy định.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh lịch tháng + ảnh bảng tổng ngày theo loại.

### TC-M07-02-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M07-02-02
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Mở ngày chưa có dữ liệu (không chuyến, không nhập tay) → bấm "Lưu chấm công".
  2. Nhập ngày "Nghỉ riêng" nhưng bỏ trống ghi chú bắt buộc.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt: "Ngày DD/MM chưa phân loại" và "Loại 'Nghỉ riêng' bắt buộc có ghi chú".
  - Chỉ rõ dữ liệu cần sửa; không chuyển sang trạng thái "Hoàn tất" khi còn thiếu.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh cảnh báo.

### TC-M07-02-03 — Trường hợp ngoại lệ (xung đột ngày chuyến ↔ nghỉ; sửa sau chốt)

- **Mã PRD:** M07-02-03
- **Vai trò:** `ketoan`, `giamdoc`
- **Tiền điều kiện:** ngày 10/08 LX-A có chuyến đã chốt; có người cố tình nhập tay "Nghỉ riêng" cùng ngày.
- **Các bước:**
  1. `ketoan` nhập "Nghỉ riêng" ngày 10/08 cho LX-A → kiểm tra cảnh báo xung đột.
  2. `ketoan` thử sửa chấm công của kỳ đã chốt (07) → kiểm tra quyền.
  3. `giamdoc` phê duyệt ngoại lệ sửa sau chốt (nếu chính sách cho phép).
- **Kết quả mong đợi (Pass):**
  - Ngày 10/08 báo cảnh báo "Xung đột: ngày có chuyến C-XXX, không thể đánh dấu Nghỉ riêng".
  - Sửa sau chốt bị chặn; chỉ tạo điều chỉnh có phê duyệt + lý do.
  - Hệ thống xử lý theo quy tắc đã chốt, yêu cầu đúng quyền và lưu lý do.
- **Phụ thuộc:** Q18.
- **Bằng chứng:** ảnh cảnh báo xung đột + ảnh yêu cầu phê duyệt.

### TC-M07-02-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M07-02-04
- **Vai trò thử:** `laixe`, `giaonhan`
- **Các bước:**
  1. `laixe` mở `/salary` → tab chấm công của mình → thử sửa loại ngày.
  2. `laixe` mở trực tiếp `/salary` tab chấm công của lái xe khác.
  3. `giaonhan` mở trực tiếp `/salary`.
- **Kết quả mong đợi (Pass):**
  - `laixe` chỉ xem (read-only), không có nút sửa.
  - `laixe` không thấy dữ liệu lái xe khác (URL → 403/redirect).
  - `giaonhan` không vào được `/salary`.
  - Dữ liệu không thay đổi; nhật ký ghi rõ thao tác thất bại.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh read-only + ảnh 403/redirect + ảnh DevTools 403.

### TC-M07-02-05 — Gửi lại/đồng thời + biên (chuyến qua đêm; nửa ngày; nhiều chuyến trong ngày)

- **Mã PRD:** M07-02-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:**
  - LX-A có chuyến đêm bắt đầu 23:00 ngày 31/08, kết thúc 02:00 ngày 01/09.
  - LX-B có 2 chuyến trong cùng ngày 15/08.
- **Các bước:**
  1. Bấm "Lưu chấm công" 2 lần liên tiếp (Slow 3G) → kiểm tra không trùng.
  2. Mở 2 tab cùng sửa 2 ngày khác nhau của LX-A → cùng bấm lưu.
  3. Kiểm tra ngày 31/08 và 01/09 được phân loại đúng theo quy tắc qua đêm.
  4. Kiểm tra ngày 15/08 của LX-B chỉ tính 1 ngày công chuyến (dù 2 chuyến).
- **Kết quả mong đợi (Pass):**
  - Không tạo bản ghi/bút toán trùng; tab lưu sau nhận 409 "phiên bản cũ".
  - Chuyến qua đêm phân bổ đúng ngày theo quy tắc (khớp Q20).
  - Nhiều chuyến cùng ngày vẫn 1 trạng thái "Chuyến" / 1 ngày công.
  - Trạng thái cuối nhất quán và truy vết được.
- **Phụ thuộc:** Q20, Q23.
- **Bằng chứng:** ảnh Network 2 request + ảnh 409 + ảnh lịch qua đêm + ảnh nhiều chuyến.

---

## 7.3 — Chốt kỳ lương và hạch toán chi phí nhân công

**Quy tắc (PRD M07-7.3):** Chỉ chốt khi không còn dữ liệu thiếu hoặc xung đột; hạch toán một lần và khóa
kỳ. Lưu bảng lương tại thời điểm chốt, tổng chi phí nhân công và nhật ký người chốt. Nếu cần sửa → mở kỳ
có kiểm soát hoặc lập điều chỉnh; không tạo bút toán trùng. Phụ thuộc **Q09/Q10/Q11**.

### TC-M07-03-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M07-03-01
- **Vai trò:** `ketoan` (lập), `giamdoc` (chốt)
- **Tiền điều kiện:** kỳ 08/2026; 5 lái xe đều ở trạng thái "Sẵn sàng" (đủ dữ liệu, không xung đột).
  Tổng thu nhập cả kỳ = 120.000.000đ, khấu trừ = 10.000.000đ, thực lĩnh = 110.000.000đ.
- **Các bước:**
  1. `ketoan` mở `/salary` kỳ 08 → bấm "Lập bảng lương" → kiểm tra tất cả lái xe có mặt.
  2. `ketoan` "Gửi chốt" → trạng thái "Chờ duyệt".
  3. `giamdoc` mở → bấm "Chốt kỳ".
  4. Kiểm tra snapshot, nhật ký và bút toán chi phí nhân công.
- **Kết quả mong đợi (Pass):**
  - Toàn bộ lái xe active có mặt (không có "chốt từng lái xe" — Q09).
  - Lưu snapshot bảng lương tại thời điểm chốt (không đổi được).
  - Tổng chi phí nhân công = 120.000.000đ được hạch toán 1 lần; kỳ khóa.
  - Nhật ký: người lập (`ketoan`), người chốt (`giamdoc`), thời điểm, snapshot.
- **Phụ thuộc:** Q09.
- **Bằng chứng:** ảnh trạng thái "Chờ duyệt" + ảnh "Đã chốt" + ảnh nhật ký + ảnh bút toán.

### TC-M07-03-02 — Thiếu hoặc sai dữ liệu (chặn chốt toàn kỳ)

- **Mã PRD:** M07-03-02
- **Vai trò:** `ketoan`, `giamdoc`
- **Tiền điều kiện:** kỳ 08; LX-A thiếu dữ liệu chuyến (xung đột), 4 lái còn lại OK.
- **Các bước:**
  1. `ketoan` bấm "Gửi chốt" kỳ 08.
  2. Đọc thông báo lỗi.
  3. `giamdoc` phê duyệt loại LX-A khỏi kỳ (partial close) + lý do.
  4. Chốt lại phần còn lại.
- **Kết quả mong đợi (Pass):**
  - Bị chặn: cảnh báo tiếng Việt "Còn lỗi ở LX-A: <chi tiết>; không thể chốt".
  - Chỉ rõ dữ liệu cần sửa; không chuyển sang "Đã chốt".
  - Sau phê duyệt: LX-A → "Chờ bổ sung", 4 lái còn lại chốt thành công (Q10).
  - LX-A được đẩy sang kỳ bổ sung/điều chỉnh kế tiếp.
- **Phụ thuộc:** Q10.
- **Bằng chứng:** ảnh cảnh báo chặn + ảnh phê duyệt loại LX-A + ảnh kỳ chốt thành công cho 4 lái.

### TC-M07-03-03 — Trường hợp ngoại lệ (mở kỳ có kiểm soát / lập điều chỉnh)

- **Mã PRD:** M07-03-03
- **Vai trò:** `ketoan`, `giamdoc`
- **Tiền điều kiện:** kỳ 07/2026 đã chốt và đã phát hành phiếu lương cho 5 lái.
- **Các bước:**
  1. `ketoan` thử mở lại kỳ 07 → kiểm tra quyền.
  2. `giamdoc` thử mở lại kỳ 07 (đã phát hành) → kiểm tra.
  3. `giamdoc` mở lại kỳ 07 trước khi phát hành (kỳ khác chưa phát hành) → kiểm tra.
  4. `ketoan` tạo khoản điều chỉnh ở kỳ 08 liên kết kỳ 07 → kiểm tra.
- **Kết quả mong đợi (Pass):**
  - `ketoan` không mở lại được (chỉ Giám đốc).
  - `giamdoc` không mở lại được sau khi đã phát hành.
  - Trước phát hành: `giamdoc` mở lại được + lý do + nhật ký.
  - Điều chỉnh ở kỳ 08: kỳ 07 không đổi, kỳ 08 có dòng điều chỉnh liên kết kỳ 07, không tạo bút toán trùng.
- **Phụ thuộc:** Q11, Q18, Q21.
- **Bằng chứng:** ảnh từ chối `ketoan` + ảnh từ chối sau phát hành + ảnh điều chỉnh kỳ 08.

### TC-M07-03-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M07-03-04
- **Vai trò thử:** `laixe`, `giaonhan`, `ketoan`
- **Các bước:**
  1. `ketoan` thử "Chốt kỳ" (chỉ được Lập/Gửi chốt, không chốt) → kiểm tra.
  2. `laixe` mở `/config/salary-periods` → thử tạo/sửa kỳ.
  3. `laixe` mở trực tiếp URL chốt kỳ.
- **Kết quả mong đợi (Pass):**
  - `ketoan` không có nút "Chốt kỳ" (chỉ `giamdoc` có).
  - `laixe` không vào được `/config/salary-periods`.
  - Mọi thao tác thất bại được nhật ký ghi lại; dữ liệu không đổi.
- **Phụ thuộc:** Q15.
- **Bằng chứng:** ảnh thiếu nút Chốt của `ketoan` + ảnh 403 `laixe` + ảnh nhật ký.

### TC-M07-03-05 — Gửi lại/đồng thời + biên (2 người chốt cùng lúc; lái chưa có tài khoản; thực lĩnh âm)

- **Mã PRD:** M07-03-05
- **Vai trò:** `giamdoc` (2 phiên), `ketoan`
- **Tiền điều kiện:**
  - 2 phiên `giamdoc` cùng mở kỳ 08.
  - LX-Z chưa có tài khoản nhận lương.
  - LX-Y có khoản phạt lớn → thực lĩnh âm nếu không xử lý.
- **Các bước:**
  1. 2 phiên `giamdoc` cùng bấm "Chốt kỳ" → kiểm tra first-wins.
  2. Bấm "Chốt kỳ" 2 lần liên tiếp ở 1 phiên (Slow 3G) → kiểm tra double-submit.
  3. Kỳ có LX-Z chưa có tài khoản → kiểm tra hành vi (cảnh báo / chặn / đánh dấu chờ).
  4. Kỳ có LX-Y thực lĩnh âm → kiểm tra cảnh báo + không cho số âm hạch toán tự động.
- **Kết quả mong đợi (Pass):**
  - 2 phiên chốt: 1 thắng, 1 nhận "Kỳ đã chốt bởi người khác" (Q23).
  - Double-submit: chỉ 1 bút toán, không trùng.
  - LX-Z: cảnh báo rõ, không làm hỏng chốt phần còn lại (đánh dấu "Chờ tài khoản").
  - Thực lĩnh âm: cảnh báo tiếng Việt, yêu cầu phê duyệt ngoại lệ (không âm thầm hạch toán số âm).
  - Trạng thái cuối nhất quán, truy vết được.
- **Phụ thuộc:** Q23.
- **Bằng chứng:** ảnh 2 phiên chốt + ảnh Network double-submit + ảnh cảnh báo LX-Z + ảnh cảnh báo thực lĩnh âm.

---

## 7.4 — Quản lý kỷ luật và khấu trừ khoản phạt

**Quy tắc (PRD M07-7.4):** Khoản phạt được trừ vào lương nhưng theo dõi riêng, **không làm giảm chi phí
lương đã ghi nhận**. Phiếu lương hiển thị khoản phạt, lý do, ngày và số tiền; báo cáo có lịch sử xử lý.
Phạt trùng cùng sự việc phải cảnh báo; hủy phạt dùng bản ghi hoàn tác hoặc trạng thái hủy. Phê duyệt phân
cấp theo ngưỡng tiền.

### TC-M07-04-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M07-04-01
- **Vai trò:** `ketoan` (nhập), `giamdoc` (duyệt theo ngưỡng), `laixe` (xem ở `/my-penalties`)
- **Tiền điều kiện:** LX-A vi phạm 05/08, phạt 1.000.000đ, có chứng cứ (ảnh biên bản). Kỳ 08 chưa chốt.
- **Các bước:**
  1. `ketoan` mở `/penalties` → "Tạo khoản phạt": lái LX-A, ngày 05/08, lý do "Đi muộn", 1.000.000đ,
     đính kèm chứng cứ, trạng thái "Chờ duyệt".
  2. `giamdoc` duyệt (trong thẩm quyền ngưỡng).
  3. Mở phiếu lương LX-A kỳ 08 → kiểm tra hiển thị.
  4. `laixe` mở `/my-penalties`.
- **Kết quả mong đợi (Pass):**
  - Khoản phạt lưu đầy đủ: lái xe, ngày, lý do, số tiền, chứng cứ, người lập, trạng thái.
  - Phiếu lương LX-A: dòng riêng "Khấu trừ phạt 1.000.000đ — Đi muộn 05/08" + link chứng cứ.
  - **Chi phí lương đã ghi nhận không giảm** (chỉ giảm thực lĩnh của lái).
  - `laixe` thấy khoản phạt + lý do + phản hồi/khiếu nại được.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh form phạt + ảnh phiếu lương + ảnh `/my-penalties`.

### TC-M07-04-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M07-04-02
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Tạo khoản phạt bỏ trống "số tiền" → lưu.
  2. Tạo khoản phạt không đính kèm chứng cứ bắt buộc → lưu.
  3. Nhập số tiền âm hoặc không phải số.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt: "Số tiền phạt bắt buộc và phải ≥ 0", "Cần ít nhất 1 bằng chứng/chứng cứ".
  - Chỉ rõ dữ liệu cần sửa; không lưu ở trạng thái "Chờ duyệt".
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh các cảnh báo.

### TC-M07-04-03 — Trường hợp ngoại lệ (phạt trùng; hủy phạt; phạt > thực lĩnh; phạt sau chốt; khiếu nại)

- **Mã PRD:** M07-04-03
- **Vai trò:** `ketoan`, `giamdoc`, `laixe`
- **Tiền điều kiện:**
  - Đã có phạt 1.000.000đ cho LX-A ngày 05/08; tạo thêm 1 phạt cùng sự việc.
  - Kỳ 07 đã chốt; tạo phạt áp dụng kỳ 07.
  - LX-B thực lĩnh kỳ 08 chỉ 2.000.000đ; tạo phạt 3.000.000đ.
- **Các bước:**
  1. Tạo phạt thứ 2 cùng sự việc (cùng lái + ngày + lý do) → kiểm tra cảnh báo trùng.
  2. `ketoan` hủy phạt đã duyệt → kiểm tra cách hủy.
  3. Tạo phạt áp dụng kỳ 07 đã chốt → kiểm tra.
  4. Tạo phạt 3.000.000đ cho LX-B (vượt thực lĩnh) → kiểm tra.
  5. `laixe` gửi khiếu nại khoản phạt → kiểm tra luồng.
- **Kết quả mong đợi (Pass):**
  - Phạt trùng: cảnh báo "Đã có khoản phạt cùng sự việc — xác nhận trùng hoặc hủy bỏ".
  - Hủy phạt: tạo bản ghi hoàn toán/hoàn tác hoặc chuyển trạng thái "Đã hủy" + lý do + người hủy; dấu vết còn.
  - Phạt áp dụng kỳ đã chốt: không sửa kỳ cũ; tạo điều chỉnh ở kỳ đang mở hoặc đẩy sang kỳ bổ sung.
  - Phạt > thực lĩnh: cảnh báo, yêu cầu phê duyệt ngoại lệ; phần vượt xử lý theo chính sách (kỳ sau / gạch nợ).
  - Khiếu nại: trạng thái khoản phạt → "Đang khiếu nại"; chặn khấu trừ cho tới khi xử lý xong.
- **Phụ thuộc:** Q11, Q18.
- **Bằng chứng:** ảnh cảnh báo trùng + ảnh trạng thái "Đã hủy" + ảnh điều chỉnh kỳ sau + ảnh "Đang khiếu nại".

### TC-M07-04-04 — Kiểm soát quyền thao tác (phân cấp phê duyệt theo ngưỡng)

- **Mã PRD:** M07-04-04
- **Vai trò thử:** `laixe`, `giaonhan`, `ketoan`
- **Các bước:**
  1. `laixe` mở `/penalties` → thử tạo/sửa khoản phạt.
  2. `giaonhan` mở trực tiếp `/penalties`.
  3. `ketoan` tự duyệt khoản phạt do chính mình lập (maker-checker).
  4. `ketoan` duyệt khoản phạt vượt thẩm quyền ngưỡng (ví dụ > 5.000.000đ) → kiểm tra.
- **Kết quả mong đợi (Pass):**
  - `laixe` không vào `/penalties` (chỉ `/my-penalties`), không có nút tạo.
  - `giaonhan` không có quyền (`/penalties` → 403/redirect).
  - `ketoan` không tự duyệt khoản do mình lập (maker-checker).
  - Khoản vượt ngưỡng: `ketoan` bị từ chối, cần `giamdoc`.
  - Dữ liệu không đổi; nhật ký ghi rõ thao tác thất bại.
- **Phụ thuộc:** Q15.
- **Bằng chứng:** ảnh 403 `laixe`/`giaonhan` + ảnh từ chối maker-checker + ảnh từ chối vượt ngưỡng.

### TC-M07-04-05 — Gửi lại/đồng thời + biên + nhất quán

- **Mã PRD:** M07-04-05
- **Vai trò:** `ketoan` (2 phiên), `giamdoc`
- **Các bước:**
  1. Bấm "Tạo khoản phạt" 2 lần liên tiếp (Slow 3G) → kiểm tra double-submit.
  2. 2 phiên `giamdoc` cùng duyệt 1 khoản → kiểm tra first-wins.
  3. Xuất báo cáo lịch sử xử lý phạt kỳ 08 → so tổng với danh sách `/penalties`.
  4. Tính lại phiếu lương LX-A (có phạt) → kiểm tra khấu trừ không đổi.
- **Kết quả mong đợi (Pass):**
  - Double-submit: chỉ 1 khoản phạt được tạo.
  - 2 phiên duyệt: 1 thắng, 1 nhận "Đã được duyệt" (Q23).
  - Báo cáo lịch sử xử lý: đủ cột (lái, ngày, lý do, số tiền, trạng thái, người lập, người duyệt), tổng = danh sách.
  - Chi phí lương đã ghi nhận không đổi; chỉ thực lĩnh của lái giảm đúng số phạt.
- **Phụ thuộc:** Q23.
- **Bằng chứng:** ảnh Network double-submit + ảnh 409/đã duyệt + ảnh báo cáo Excel + ảnh phiếu lương tính lại.

---

## Bảng nghiệm thu M07

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M07-01-01 |           |         |         |            |
| __/__/__ | TC-M07-01-02 |           |         |         |            |
| __/__/__ | TC-M07-01-03 |           |         |         |            |
| __/__/__ | TC-M07-01-04 |           |         |         |            |
| __/__/__ | TC-M07-01-05 |           |         |         |            |
| __/__/__ | TC-M07-02-01 |           |         |         |            |
| __/__/__ | TC-M07-02-02 |           |         |         |            |
| __/__/__ | TC-M07-02-03 |           |         |         |            |
| __/__/__ | TC-M07-02-04 |           |         |         |            |
| __/__/__ | TC-M07-02-05 |           |         |         |            |
| __/__/__ | TC-M07-03-01 |           |         |         |            |
| __/__/__ | TC-M07-03-02 |           |         |         |            |
| __/__/__ | TC-M07-03-03 |           |         |         |            |
| __/__/__ | TC-M07-03-04 |           |         |         |            |
| __/__/__ | TC-M07-03-05 |           |         |         |            |
| __/__/__ | TC-M07-04-01 |           |         |         |            |
| __/__/__ | TC-M07-04-02 |           |         |         |            |
| __/__/__ | TC-M07-04-03 |           |         |         |            |
| __/__/__ | TC-M07-04-04 |           |         |         |            |
| __/__/__ | TC-M07-04-05 |           |         |         |            |

### Tiêu chí toàn phân hệ M07-HT-01 … M07-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` áp dụng trên màn hình của M07 (`/salary`,
`/config/salary-periods`, `/penalties`, `/my-penalties`).

| Mã HT     | Kết quả | Bằng chứng |
| --------- | ------- | ---------- |
| M07-HT-01 |         |            |
| M07-HT-02 |         |            |
| M07-HT-03 |         |            |
| M07-HT-04 |         |            |
| M07-HT-05 |         |            |
| M07-HT-06 |         |            |
| M07-HT-07 |         |            |
| M07-HT-08 |         |            |
| M07-HT-09 |         |            |
| M07-HT-10 |         |            |
