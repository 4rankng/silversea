# M12 — Nhiên liệu & Số hóa chứng từ dầu

> **Phân hệ 12** — 3 nhóm chức năng (12.1–12.3). Nguồn PRD: `docs/prd/Module12.docx`.
> **Tiêu chí nghiệm thu toàn phân hệ:** `M12-HT-01` … `M12-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:**
>
> - `/config/fuel-norms` — cấu hình định mức nhiên liệu theo loại xe × tuyến (mới).
> - `/config/fuel` — cấu hình định mức dầu (cũ, vẫn dùng cho một số trường).
> - `/trips/:id` — chi tiết chuyến: nơi nhập/hiển thị nhiên liệu + ảnh cột bơm.
> - `/payables` — hóa đơn dầu của nhà cung cấp (đối chiếu cuối kỳ).
>
> **Vai trò thử:** `ketoan` (cấu hình, đối chiếu), `admin`, `laixe` (chụp ảnh cột bơm), `giamdoc` (xem
> báo cáo).

---

## 12.1 — Cấu hình định mức nhiên liệu và khoảng cách tuyến

**Quy tắc nghiệp vụ (PRD M12-01):** Chọn đúng định mức có hiệu lực tại ngày chạy chuyến; tuyến đồi núi
dùng mức khoán (flat rate) nếu đã cấu hình; lưu lịch sử thay đổi để truy vết. Thành phần định mức: loại
xe, tuyến, quãng đường, định mức hàng (loaded) hoặc vỏ (empty), mức khoán, ngày hiệu lực. Chuyến hiển
thị định mức đã áp dụng, số lit gợi ý, công thức. Người có quyền nhập giá trị thực khác nhưng phải ghi
lý do; chuyến đã chốt không tự đổi khi cấu hình đổi sau đó.

### TC-M12-01-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M12-01-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** có loại xe X (xe đầu kéo), tuyến T (Hải Phòng – Hà Nội), quãng đường 120 km.
- **Các bước:**
  1. Mở `/config/fuel-norms`. Tạo định mức: xe X, tuyến T, quãng đường 120 km, định mức hàng (loaded)
     30 l/100 km, mức khoán 40 l, ngày hiệu lực 01/08/2026.
  2. Tạo chuyến cho X–T–hàng đầy, ngày chạy 05/08/2026.
  3. Mở `/trips/:id`, xem mục "Nhiên liệu".
- **Kết quả mong đợi (Pass):**
  - Chuyến hiển thị định mức đã áp dụng (mức có hiệu lực tại 05/08), số lit gợi ý và công thức:
    `120 km × 30 l/100 km = 36 l`.
  - Chuyến lưu id định mức đã áp dụng để đối soát sau.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh `/config/fuel-norms` + ảnh mục Nhiên liệu trên `/trips/:id` (có công thức).

### TC-M12-01-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M12-01-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** như TC-M12-01-01.
- **Các bước:**
  1. Mở `/config/fuel-norms` → bấm "Tạo định mức" mà không nhập ngày hiệu lực.
  2. Nhập quãng đường = 0 hoặc số âm.
  3. Nhập định mức loaded = 0 hoặc để trống.
  4. Lần lượt bấm Lưu cho từng trường hợp.
- **Kết quả mong đợi (Pass):**
  - Mỗi trường hợp hiển thị thông báo lỗi tiếng Việt ngay cạnh trường (ví dụ "Ngày hiệu lực là bắt
    buộc", "Quãng đường phải lớn hơn 0").
  - Không tạo bản ghi định mức trong DB.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh 3 thông báo lỗi tiếng Việt.

### TC-M12-01-03 — Giá trị biên (tuyến nhiều chặng; chuyến có cả loaded & empty; định mức đổi giữa tháng)

- **Mã PRD:** M12-01-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** định mức cho X–T đã có hiệu lực 01/08 (loaded 30 l/100 km, empty 25 l/100 km).
- **Các bước:**
  1. Tạo tuyến nhiều chặng: chặng 1 (loaded, 80 km) + chặng 2 (empty/chạy không, 40 km). Gán cho
     chuyến ngày 05/08.
  2. Tạo định mức mới cho X–T hiệu lực 15/08/2026 (loaded 32 l/100 km). Tạo chuyến cho X–T ngày
     20/08.
- **Kết quả mong đợi (Pass):**
  - Chuyến 05/08 dùng định mức cũ; số lit gợi ý = `(80 × 30/100) + (40 × 25/100) = 24 + 10 = 34 l`.
  - Chuyến 20/08 dùng định mức mới: `80 × 32/100 = 25,6 l` (chỉ tính chặng loaded nếu đi một chiều
    hàng).
  - Cả hai mức cùng tồn tại trong `/config/fuel-norms`, không ghi đè lẫn nhau.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh 2 chuyến với công thức khác nhau + ảnh danh sách 2 định mức.

### TC-M12-01-04 — Thay đổi hoặc ngoại lệ (sửa số lit thực tế phải có lý do; tuyến đồi núi dùng khoán)

- **Mã PRD:** M12-01-04
- **Vai trò:** `admin`, `ketoan`
- **Tiền điều kiện:** chuyến C-100 đã có số lit gợi ý 36 l; có định mức "mức khoán 40 l" cho tuyến đồi.
- **Các bước:**
  1. Mở `/trips/C-100`, sửa "Nhiên liệu thực tế" từ 36 → 42 l.
  2. Hệ thống yêu cầu "Lý do chênh lệch". Nhập "Tắc đường đổ dốc" → lưu.
  3. Tạo chuyến C-101 cho tuyến đồi đã cấu hình mức khoán.
- **Kết quả mong đợi (Pass):**
  - C-100 lưu 42 l + lý do + người sửa + giá trị gợi ý gốc 36 l (xem nhật ký `/audit-logs`).
  - C-101 áp dụng mức khoán 40 l thay vì công thức l/100 km, có ghi chú "áp dụng mức khoán đồi núi".
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh form sửa có trường lý do + ảnh nhật ký thay đổi + ảnh C-101 dùng khoán.

### TC-M12-01-05 — Tính nhất quán (chuyến đã chốt không tự đổi khi đổi cấu hình; tái tính không đổi)

- **Mã PRD:** M12-01-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** chuyến C-100 đã chốt, định mức X–T loaded = 30 l/100 km.
- **Các bước:**
  1. Ghi chú số lit gợi ý của C-100 trước khi đổi cấu hình.
  2. Sửa định mức X–T loaded thành 35 l/100 km, hiệu lực 01/08/2026 (cùng ngày).
  3. Mở lại `/trips/C-100`, kiểm tra mục Nhiên liệu.
  4. Mở lịch sử thay đổi định mức trong `/config/fuel-norms`.
- **Kết quả mong đợi (Pass):**
  - C-100 (đã chốt) **không tự tính lại**; số lit áp dụng vẫn theo định mức tại thời điểm chốt.
  - Chuyến tạo mới sau lần đổi cấu hình mới dùng định mức mới.
  - Có dòng lịch sử: định mức 30 → 35, người sửa, thời điểm.
- **Phụ thuộc:** Q22 (nguồn chân lý — sau chốt không ghi đè).
- **Bằng chứng:** ảnh C-100 trước/sau + ảnh lịch sử định mức.

---

## 12.2 — Đối chiếu nhiên liệu cuối tháng với hóa đơn nhà cung cấp

**Quy tắc nghiệp vụ (PRD M12-02):** Tổng cộng theo cùng đơn vị (lit + VNĐ); tách chênh lệch thành 3
khoảng: lit, đơn giá, thành tiền; không tính trùng hóa đơn. Báo cáo tổng hợp theo xe, nhà cung cấp, kỳ +
danh sách chênh lệch cần xử lý. Hóa đơn muộn hoặc nhiều xe → phân bổ theo căn cứ thực tế. Trường hợp biên:
lit âm (hoàn/trả), hóa đơn điều chỉnh, chuyến qua hai kỳ. **Phụ thuộc nặng vào Q06** (hóa đơn nhiều xe,
phân bổ theo lit thực tế, không chia đều, không duyệt khi thiếu căn cứ).

### TC-M12-02-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M12-02-01
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** tháng 07/2026 có 3 chuyến đổ dầu cùng NCC Petrolimex, tổng 300 l, đơn giá
  22.000 đ/l → tổng 6.600.000 đ. Có 1 hóa đơn Petrolimex 6.600.000 đ cùng kỳ.
- **Các bước:**
  1. Mở `/payables`, tạo hóa đơn NCC Petrolimex: 300 l × 22.000 đ/l = 6.600.000 đ, kỳ 07/2026.
  2. Gán 3 chuyến vào hóa đơn (link theo chuyến đã đổ dầu).
  3. Chạy "Đối chiếu nhiên liệu" kỳ 07.
- **Kết quả mong đợi (Pass):**
  - Tổng lit hệ thống = tổng lit hóa đơn = 300 l (cùng đơn vị).
  - Tổng tiền hệ thống = tổng tiền hóa đơn = 6.600.000 đ.
  - Báo cáo theo xe + theo NCC hiển thị đúng; chênh lệch = 0.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh `/payables` + ảnh báo cáo đối chiếu (3 dòng xe + tổng).

### TC-M12-02-02 — Thiếu hoặc sai dữ liệu (hóa đơn nhiều xe thiếu căn cứ — không cho duyệt)

- **Mã PRD:** M12-02-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** có 2 xe A, B cùng đổ dầu Petrolimex trong kỳ.
- **Các bước:**
  1. Mở `/payables`, tạo hóa đơn Petrolimex: 100 l, 2.200.000 đ cho 2 xe (A, B).
  2. Chỉ nhập lit cho xe A = 60 l, để trống xe B.
  3. Bấm "Duyệt"/"Chốt phân bổ".
  4. Thử bấm "Chia đều cho 2 xe" (nếu có nút).
- **Kết quả mong đợi (Pass):**
  - Hệ thống cảnh báo tiếng Việt "Chưa phân bổ đủ — còn thiếu 40 l" và **không cho duyệt**.
  - Không có nút "chia đều" tự động; nếu cố chia đều → bị từ chối với lý do "phải theo lit thực tế".
  - Chênh lệch 40 l hiển thị ở danh sách "cần xử lý".
- **Phụ thuộc:** Q06 (phân bổ theo lit thực tế, không chia đều, không duyệt khi thiếu căn cứ).
- **Bằng chứng:** ảnh cảnh báo + ảnh danh sách "cần xử lý".

### TC-M12-02-03 — Trường hợp ngoại lệ (hóa đơn nhiều xe có căn cứ; phân bổ theo lit thực tế)

- **Mã PRD:** M12-02-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** hóa đơn 100 l × 22.000 đ/l = 2.200.000 đ cho xe A (60 l) và xe B (40 l).
- **Các bước:**
  1. Mở hóa đơn ở `/payables`, nhập căn cứ: xe A 60 l, xe B 40 l (tổng = 100).
  2. Hệ thống tự tính thành tiền theo đơn giá.
  3. Duyệt phân bổ.
- **Kết quả mong đợi (Pass):**
  - Xe A = 60 × 22.000 = 1.320.000 đ; xe B = 40 × 22.000 = 880.000 đ.
  - Tổng 2 dòng = 2.200.000 đ = tổng hóa đơn.
  - Hai dòng chi phí nhiên liệu được ghi nhận vào 2 chuyến tương ứng.
- **Phụ thuộc:** Q06.
- **Bằng chứng:** ảnh 2 dòng phân bổ + ảnh tổng trùng hóa đơn.

### TC-M12-02-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M12-02-04
- **Vai trò thử:** `laixe`, `giamdoc`
- **Tiền điều kiện:** có hóa đơn dầu ở trạng thái "Chờ duyệt" trong `/payables`.
- **Các bước:**
  1. `laixe` mở trực tiếp `/payables` và `/payables/:id`.
  2. `giamdoc` mở `/payables` (chỉ xem) và thử sửa một dòng phân bổ.
  3. `laixe` thử mở `/config/fuel-norms`.
- **Kết quả mong đợi (Pass):**
  - `laixe` bị redirect về màn nhà (cổng lái xe) cho cả 2 URL; API trả 403.
  - `giamdoc` xem được báo cáo/nhật ký nhưng không có nút "Sửa"/"Duyệt" (read-only).
  - `laixe` không vào được `/config/fuel-norms`.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh redirect + ảnh DevTools Network 403 + ảnh view read-only của `giamdoc`.

### TC-M12-02-05 — Gửi lại/đồng thời + biên (lit âm hoàn/trả; hóa đơn điều chỉnh; chuyến qua hai kỳ)

- **Mã PRD:** M12-02-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** kỳ 07/2026 đã có hóa đơn Petrolimex đã duyệt.
- **Các bước:**
  1. Tạo hóa đơn điều chỉnh cho Petrolimex số lit âm -10 l (trả lại dầu thừa) → kiểm tra xử lý.
  2. Tạo chuyến bắt đầu 31/07, hoàn thành 01/08, đổ dầu 31/07 → kiểm tra nhiên liệu rơi kỳ nào.
  3. Mở 2 tab, cùng bấm "Duyệt" một hóa đơn ở `/payables`.
- **Kết quả mong đợi (Pass):**
  - Lit âm chỉ được nhập với lý do (ví dụ "trả dầu thừa"), hiển thị dạng số âm, giảm tổng kỳ.
  - Nhiên liệu đổ 31/07 rơi vào kỳ 07 (theo ngày phát sinh), không vào kỳ 08 dù chuyến hoàn thành
    01/08.
  - 2 lần duyệt đồng thời: chỉ lần đầu thắng, lần sau nhận thông báo "đã được duyệt"; chỉ tạo 1 bản
    ghi; có dấu vết trong `/audit-logs`.
- **Phụ thuộc:** Q20 (chuyến qua hai kỳ — nhiên liệu theo ngày phát sinh), Q23 (double-submit,
  first-approve-wins).
- **Bằng chứng:** ảnh hóa đơn số âm có lý do + ảnh nhiên liệu kỳ 07 + ảnh nhật ký 2 lần thử duyệt.

---

## 12.3 — Tự động đọc ảnh cột bơm và thông tin ảnh

**Quy tắc nghiệp vụ (PRD M12-03):** Kết quả OCR chỉ là **gợi ý**; kiểm tra chéo phép nhân (lit × đơn giá
= thành tiền) trong sai số cho phép; người dùng xác nhận trước khi cập nhật nhiên liệu. Lưu: ảnh gốc, dữ
liệu OCR, mức độ tin cậy (confidence), giá trị đã xác nhận, người sửa. Thiếu vị trí, ảnh mờ, hoặc phép
toán không khớp → cảnh báo + kiểm tra thủ công. Trường hợp biên: chụp lại; nhiều màn hình trong ảnh; tắt
location; mất mạng. OCR qua `/api/ocr` (và `/api/ocr/pump` cho ảnh cột bơm); geotag qua `/api/geotag`.

### TC-M12-03-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M12-03-01
- **Vai trò:** `laixe` (chụp), `ketoan` (xác nhận)
- **Tiền điều kiện:** chuyến C-200 đã tạo; `laixe` là lái xe của chuyến.
- **Các bước:**
  1. `laixe` mở `/trips/C-200`, bấm "Chụp ảnh cột bơm", chụp ảnh màn hình số: 50,00 l × 22.000 đ/l =
     1.100.000 đ.
  2. Hệ thống gọi `/api/ocr/pump` → trả về litres, unit_price, total + mức độ tin cậy.
  3. `laixe` bấm "Gửi/Xác nhận".
  4. `ketoan` vào `/trips/C-200`, xem ảnh + dữ liệu OCR, xác nhận giá trị.
- **Kết quả mong đợi (Pass):**
  - OCR trả litres = 50, unit_price = 22.000, total = 1.100.000, mức tin cậy cao.
  - Phép kiểm chéo `50 × 22.000 = 1.100.000` khớp (không có cờ mismatch).
  - Sau xác nhận: nhiên liệu chuyến cập nhật; lưu ảnh gốc, dữ liệu OCR, giá trị xác nhận, người sửa.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh ảnh cột bơm + ảnh dữ liệu OCR trả về + ảnh mục nhiên liệu sau xác nhận.

### TC-M12-03-02 — Thiếu hoặc sai dữ liệu (ảnh mờ; OCR không đọc được)

- **Mã PRD:** M12-03-02
- **Vai trò:** `laixe`
- **Tiền điều kiện:** chuyến C-201 đã tạo.
- **Các bước:**
  1. `laixe` mở `/trips/C-201`, chụp ảnh cột bơm bị mờ/loá sáng.
  2. Gửi ảnh → kiểm tra phản hồi.
  3. Thử chụp ảnh không phải cột bơm (ảnh phong cảnh).
- **Kết quả mong đợi (Pass):**
  - Hệ thống trả "Không đọc được — kiểm tra thủ công" + mức tin cậy thấp/không xác định.
  - Có cảnh báo tiếng Việt đề nghị chụp lại rõ hơn.
  - Không tự cập nhật nhiên liệu chuyến; bắt buộc nhập tay hoặc chụp lại.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh mờ gửi đi + ảnh cảnh báo tiếng Việt.

### TC-M12-03-03 — Giá trị biên (phép toán lệch ngoài dung sai; nhiều màn hình trong ảnh)

- **Mã PRD:** M12-03-03
- **Vai trò:** `laixe`
- **Tiền điều kiện:** chuyến C-202 đã tạo.
- **Các bước:**
  1. Chụp ảnh cột bơm hiển thị litres = 50, unit_price = 22.000 nhưng total = 1.300.000 (sai lệch >
     dung sai).
  2. Chụp ảnh có 2 màn hình (tổng + đơn giá riêng) trong cùng khung.
  3. Gửi cả 2 ảnh lần lượt.
- **Kết quả mong đợi (Pass):**
  - Ảnh lệch phép toán: hệ thống đánh dấu `mismatch` (lit × đơn giá ≠ total, chênh >5%) + hiển thị
    tổng tính được 1.100.000 vs total ảnh 1.300.000 → cảnh báo kiểm tra thủ công, không tự ghi nhận.
  - Ảnh nhiều màn hình: cảnh báo "phát hiện nhiều màn hình — chọn đúng số" hoặc yêu cầu chụp lại từng
    màn hình.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh cảnh báo mismatch (có 2 số total) + ảnh cảnh báo nhiều màn hình.

### TC-M12-03-04 — Thay đổi hoặc ngoại lệ (chụp lại ảnh; tắt location; mất mạng)

- **Mã PRD:** M12-03-04
- **Vai trò:** `laixe`
- **Tiền điều kiện:** chuyến C-203 đã tạo.
- **Các bước:**
  1. Chụp ảnh cột bơm cho C-203 rồi gửi → có kết quả OCR.
  2. Chụp lại ảnh khác (số khác) cho cùng chuyến → kiểm tra xử lý ảnh cũ/ảnh mới.
  3. Tắt GPS thiết bị, chụp ảnh → gửi → kiểm tra cảnh báo thiếu vị trí.
  4. Bật DevTools Network = Offline, bấm "Gửi ảnh".
- **Kết quả mong đợi (Pass):**
  - Chụp lại: ảnh mới thay thế (hoặc đính kèm version mới), không tạo bản ghi trùng; có dấu vết.
  - Tắt GPS: cảnh báo tiếng Việt "Ảnh không có vị trí (geotag) — kiểm tra thủ công", lưu ảnh nhưng
    đánh dấu thiếu location.
  - Mất mạng: toast đỏ "Mất kết nối"; ảnh和数据 chờ trong hàng đợi, gửi lại thành công khi online.
- **Phụ thuộc:** Q23 (double-submit — không tạo bản ghi trùng).
- **Bằng chứng:** ảnh version ảnh mới + ảnh cảnh báo thiếu geotag + ảnh toast offline + ảnh gửi lại.

### TC-M12-03-05 — Phân quyền (chỉ lái của chuyến được chụp; `ketoan` xác nhận)

- **Mã PRD:** M12-03-05
- **Vai trò thử:** `laixe` (không phải lái của C-204), `ketoan`, `giamdoc`
- **Tiền điều kiện:** chuyến C-204 có lái xe là LX-A; tài khoản `laixe2` không phải lái của C-204.
- **Các bước:**
  1. `laixe2` mở `/trips/C-204`, thử nút "Chụp ảnh cột bơm".
  2. `ketoan` mở `/trips/C-204`, thử nút "Xác nhận nhiên liệu".
  3. `giamdoc` mở `/trips/C-204`, xem ảnh + dữ liệu OCR nhưng thử sửa.
- **Kết quả mong đợi (Pass):**
  - `laixe2` không thấy nút chụp hoặc nhận lỗi 403 (chỉ lái của chuyến mới chụp được).
  - `ketoan` xác nhận được giá trị OCR; mọi lần xác nhận lưu người xác nhận + thời điểm.
  - `giamdoc` chỉ xem, không có nút sửa/xác nhận.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh `laixe2` không có nút/403 + ảnh `ketoan` xác nhận thành công + ảnh view-only của
  `giamdoc`.

---

## Bảng nghiệm thu M12

| Ngày thử | Mã TC        | Người thử | Kết quả (Pass/Fail/Blocked) | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | --------------------------- | ------- | ---------- |
| __/__/__ | TC-M12-01-01 |           |                             |         |            |
| __/__/__ | TC-M12-01-02 |           |                             |         |            |
| __/__/__ | TC-M12-01-03 |           |                             |         |            |
| __/__/__ | TC-M12-01-04 |           |                             |         |            |
| __/__/__ | TC-M12-01-05 |           |                             |         |            |
| __/__/__ | TC-M12-02-01 |           |                             |         |            |
| __/__/__ | TC-M12-02-02 |           |                             |         |            |
| __/__/__ | TC-M12-02-03 |           |                             |         |            |
| __/__/__ | TC-M12-02-04 |           |                             |         |            |
| __/__/__ | TC-M12-02-05 |           |                             |         |            |
| __/__/__ | TC-M12-03-01 |           |                             |         |            |
| __/__/__ | TC-M12-03-02 |           |                             |         |            |
| __/__/__ | TC-M12-03-03 |           |                             |         |            |
| __/__/__ | TC-M12-03-04 |           |                             |         |            |
| __/__/__ | TC-M12-03-05 |           |                             |         |            |

### Tiêu chí nghiệm thu toàn phân hệ M12-HT-01 … M12-HT-10

Chạy TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` trên màn hình của M12 (`/config/fuel-norms`,
`/config/fuel`, `/trips/:id`, `/payables`). Gợi ý thử HT trên M12:

- **M12-HT-03 (nhật ký):** sửa định mức + sửa số lit thực tế có lý do → kiểm tra `/audit-logs`.
- **M12-HT-04 (double-submit):** bấm "Xác nhận nhiên liệu" 2 lần liên tiếp trên `/trips/:id`.
- **M12-HT-08 (khôi phục lỗi):** tắt mạng khi gửi ảnh cột bơm (TC-M12-03-04 bước 4).
- **M12-HT-10 (đối chiếu liên phân hệ):** tổng nhiên liệu theo chuyến ↔ tổng hóa đơn dầu trong
  `/payables` ↔ chi phí nhiên liệu trong báo cáo tài chính kỳ.

| Mã HT      | Kết quả | Bằng chứng |
| ---------- | ------- | ---------- |
| M12-HT-01  |         |            |
| M12-HT-02  |         |            |
| M12-HT-03  |         |            |
| M12-HT-04  |         |            |
| M12-HT-05  |         |            |
| M12-HT-06  |         |            |
| M12-HT-07  |         |            |
| M12-HT-08  |         |            |
| M12-HT-09  |         |            |
| M12-HT-10  |         |            |
