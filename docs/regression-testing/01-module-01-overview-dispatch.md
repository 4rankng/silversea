# M01 — Tổng quan & Điều vận chuyến xe

> **Phân hệ 1** — 8 nhóm chức năng (1.1–1.8). Nguồn PRD: `docs/prd/Module1.docx`.
> **Tiêu chí nghiệm thu toàn phân hệ:** `M01-HT-01` … `M01-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:** `/dashboard`, `/dispatch`, `/trips` (+ `/trips/new`, `/trips/:id`, `/trips/:id/edit`),
> `/fleet`. Vai trò thử chính: `admin`, `giamdoc`, `ketoan`.

---

## 1.1 — Bảng điều hành doanh thu, chi phí, lợi nhuận và số chuyến

**Quy tắc nghiệp vụ (PRD M01-1.1):** Chỉ cộng số liệu của chuyến thuộc kỳ và phạm vi được chọn; định
nghĩa rõ số liệu tạm tính và số liệu đã chốt.

### TC-M01-01-01 — Hiển thị dữ liệu thông thường

- **Mã PRD:** M01-01-01
- **Vai trò:** `admin`, `giamdoc`
- **Tiền điều kiện:** có ít nhất 3 chuyến đã chốt trong tháng hiện tại, ở 2 đơn vị vận hành khác nhau.
- **Các bước:**
  1. Mở `/dashboard`.
  2. Chọn kỳ: tháng hiện tại. Chọn đơn vị vận hành: "Tất cả". Trạng thái chuyến: "Đã chốt".
  3. Ghi chú 4 chỉ số chính: doanh thu, chi phí, lợi nhuận, số chuyến.
  4. Bấm vào link "Xem chi tiết" dưới mỗi chỉ số.
- **Kết quả mong đợi (Pass):**
  - 4 chỉ số chính hiển thị, có so sánh kỳ trước (delta %).
  - Số liệu tạm tính (chuyến chưa chốt) hiển thị riêng, có nhãn "Tạm tính".
  - Click vào dẫn tới danh sách chi tiết với đúng scope.
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh dashboard + ảnh click-through.

### TC-M01-01-02 — Không có dữ liệu

- **Mã PRD:** M01-01-02
- **Vai trò:** `admin`
- **Các bước:**
  1. Mở `/dashboard`.
  2. Chọn kỳ tương lai (chưa có dữ liệu). Đơn vị: "Tất cả".
- **Kết quả mong đợi (Pass):**
  - 4 chỉ số đều = 0, không báo lỗi kỹ thuật.
  - Hiển thị "Không có dữ liệu trong kỳ này".

### TC-M01-01-03 — Trường hợp biên (kỳ ngày/tuần/tháng/quý; dữ liệu đang chạy & đã chốt)

- **Mã PRD:** M01-01-03
- **Vai trò:** `admin`
- **Các bước:**
  1. Lần lượt đổi chế độ kỳ: Ngày → Tuần → Tháng → Quý.
  2. Với mỗi chế độ: ghi chú tổng số chuyến + doanh thu.
  3. Đổi trạng thái chuyến: "Đang chạy" only → kiểm tra tổng khác "Đã chốt" only.
- **Kết quả mong đợi (Pass):**
  - Mỗi chế độ kỳ tính đúng khoảng thời gian.
  - Tổng khi gộp "Đang chạy" + "Đã chốt" = tổng khi chọn "Tất cả".

### TC-M01-01-04 — Kiểm soát quyền xem

- **Mã PRD:** M01-01-04
- **Vai trò thử:** `laixe`, `giaonhan`, `customer`
- **Các bước:**
  1. `laixe` mở trực tiếp `/dashboard`.
  2. `giaonhan` mở trực tiếp `/dashboard`.
  3. `customer` mở trực tiếp `/dashboard`.
- **Kết quả mong đợi (Pass):**
  - Cả 3 đều bị redirect về màn nhà (cổng nhân viên/khách).
  - Không để lộ số liệu tài chính trong response body.

### TC-M01-01-05 — Đối chiếu dữ liệu nguồn

- **Mã PRD:** M01-01-05
- **Vai trò:** `admin`
- **Các bước:**
  1. Ghi chú tổng doanh thu tháng trên `/dashboard`.
  2. Mở `/trips`, lọc đã chốt trong tháng, xuất Excel.
  3. Tính tổng doanh thu bằng tay trong Excel.
  4. So sánh 3 số: dashboard, danh sách chuyến, Excel.
- **Kết quả mong đợi (Pass):** cả 3 số bằng nhau, chính xác đến đồng.

---

## 1.2 — Biểu đồ xu hướng và xếp hạng xe hoặc tuyến

**Quy tắc (PRD M01-1.2):** Xếp hạng theo chỉ tiêu đã chọn; trường hợp bằng nhau dùng doanh thu rồi số
chuyến làm tiêu chí phụ.

### TC-M01-02-01 — Hiển thị dữ liệu thông thường

- **Mã PRD:** M01-02-01
- **Vai trò:** `giamdoc`
- **Các bước:**
  1. Mở `/dashboard` (hoặc trang xếp hạng nếu có). Chọn tiêu chí: "Lợi nhuận".
  2. Khoảng ngày: 01/08 – 31/08.
  3. Xem biểu đồ xu hướng + bảng xếp hạng xe.
- **Kết quả mong đợi (Pass):**
  - Bảng xếp hạng có thứ tự rõ ràng, đơn vị tính (VNĐ) thể hiện dưới cột.
  - Hover vào cột biểu đồ → tooltip với số liệu.

### TC-M01-02-02 — Không có dữ liệu

- **Mã PRD:** M01-02-02 — như TC-M01-01-02, áp dụng cho biểu đồ.

### TC-M01-02-03 — Trường hợp biên (khoảng ngày giao nhau 2 tháng; nhiều xe bằng điểm; tuyến không có chuyến)

- **Mã PRD:** M01-02-03
- **Các bước:**
  1. Chọn khoảng ngày 15/07 – 15/08 (giao 2 tháng).
  2. Tạo tình huống 2 xe cùng lợi nhuận → kiểm tra tiebreak: doanh thu rồi số chuyến.
  3. Có 1 tuyến không có chuyến trong kỳ → kiểm tra hiển thị.

### TC-M01-02-04 — Kiểm soát quyền xem

- **Mã PRD:** M01-02-04 — như TC-M01-01-04.

### TC-M01-02-05 — Đối chiếu dữ liệu nguồn

- **Mã PRD:** M01-02-05 — so sánh tổng của bảng xếp hạng với tổng trên `/trips` cùng khoảng ngày.

---

## 1.3 — Tạo, điều vận và theo dõi trạng thái chuyến xe

**Quy tắc (PRD M01-1.3):** Trạng thái đi theo thứ tự **Mới tạo → Đang chạy → Hoàn thành → Đã chốt**.
Cho phép hủy với lý do. Mỗi chuyến chỉ có một lái xe.

### TC-M01-03-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M01-03-01
- **Vai trò:** `admin` (điều vận)
- **Tiền điều kiện:** đã có khách hàng, tuyến, xe, rơ-moóc, lái xe, loại hàng trong danh mục.
- **Các bước:**
  1. Mở `/trips/new`.
  2. Nhập: khách hàng, tuyến, xe, rơ-moóc, lái xe, thời gian, loại hàng.
  3. Lưu.
  4. Mở `/trips/:id`. Chuyển trạng thái lần lượt: Mới tạo → Đang chạy → Hoàn thành.
- **Kết quả mong đợi (Pass):**
  - Mỗi chuyển trạng thái ghi lịch sử (ai, khi nào).
  - Lái xe được phân công nhận thông báo.
  - Trang chi tiết hiển thị đúng người phụ trách.

### TC-M01-03-02 — Thiếu hoặc sai dữ liệu

- **Mã PRD:** M01-03-02
- **Các bước:**
  1. Mở `/trips/new`. Bỏ trống trường bắt buộc (ví dụ: lái xe).
  2. Bấm "Lưu".
- **Kết quả mong đợi (Pass):**
  - Cảnh báo tiếng Việt, chỉ rõ trường "Lái xe là bắt buộc".
  - Không tạo chuyến mới.

### TC-M01-03-03 — Trường hợp ngoại lệ (trùng thời gian xe/lái; thiếu dữ liệu chỉ lưu nháp)

- **Mã PRD:** M01-03-03
- **Các bước:**
  1. Tạo chuyến cho lái xe L1 lúc 08:00–12:00 ngày 04/08.
  2. Tạo chuyến khác cho cùng L1 lúc 10:00–11:00 cùng ngày.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo "Lái xe L1 đã có chuyến trùng giờ".
  - Không cho lưu (hoặc chỉ cho lưu nháp).

### TC-M01-03-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M01-03-04
- **Vai trò thử:** `ketoan`, `laixe`
- **Các bước:**
  1. `ketoan` mở `/trips/new` → có thể tạo (nếu được phép) hoặc bị từ chối.
  2. `laixe` mở `/trips/new` → bị từ chối (chỉ xem qua `/my-trips`).
- **Kết quả mong đợi (Pass):** Nhật ký ghi nhận lần thử thất bại.

### TC-M01-03-05 — Gửi lại hoặc thao tác đồng thời

- **Mã PRD:** M01-03-05
- **Các bước:**
  1. Network throttling = Slow 3G. Bấm "Lưu chuyến" 2 lần liên tiếp.
  2. Mở 2 tab cùng sửa chuyến C-001, 2 người bấm lưu gần như cùng lúc.
- **Kết quả mong đợi (Pass):** Xem TC-HT-04 và TC-HT-23.

### TC-M01-03-06 — Biên: chuyến qua ngày; đổi xe trước giờ chạy; hủy sau khi phát sinh dữ liệu

- **Các bước:**
  1. Tạo chuyến bắt đầu 23:00 hôm nay, kết thúc 02:00 ngày mai. Kiểm tra hiển thị ngày.
  2. Đổi xe của chuyến ở trạng thái "Mới tạo" trước giờ chạy → được.
  3. Hủy chuyến đã có công tác phí → yêu cầu lý do + kiểm tra bút toán hoàn tác.

---

## 1.4 — Phân tích lợi nhuận từng chuyến

**Quy tắc (PRD M01-1.4):** Lợi nhuận = doanh thu − (nhiên liệu + tiền đi đường + lương chuyến + chi phí
liên quan). Không tính trùng khoản chi đã nằm trong tiền đi đường.

### TC-M01-04-01 — Tính toán thông thường

- **Mã PRD:** M01-04-01
- **Các bước:**
  1. Mở chuyến đã chốt C-001 tại `/trips/C-001`.
  2. Xem mục "Phân tích lợi nhuận".
- **Kết quả mong đợi (Pass):**
  - Hiển thị từng thành phần: doanh thu, nhiên liệu, tiền đi đường, lương chuyến, chi phí khác.
  - Tổng chi phí = tổng các thành phần.
  - Lợi nhuận = doanh thu − tổng chi phí; tỷ suất lợi nhuận = LN/DT.
  - Mỗi thành phần có link tới nguồn số liệu.

### TC-M01-04-02 — Thiếu hoặc sai dữ liệu — như TC-M01-03-02 pattern.

### TC-M01-04-03 — Giá trị biên (giá trị = 0, điều chỉnh âm, chi phí bổ sung sau khi hoàn thành)

- **Các bước:**
  1. Tạo chuyến có doanh thu = 0 → lợi nhuận = -tổng chi phí. Kiểm tra hiển thị dấu.
  2. Tạo khoản điều chỉnh âm -500.000đ → tổng giảm, kiểm tra nhãn "Điều chỉnh".
  3. Thêm chi phí sau khi "Hoàn thành" nhưng trước "Đã chốt" → được cập nhật vào LN.

### TC-M01-04-04 — Thay đổi hoặc ngoại lệ (chưa đủ chi phí → "Tạm tính"; hủy không tính LN)

- **Các bước:**
  1. Chuyến "Hoàn thành" thiếu chi phí nhiên liệu → nhãn "Tạm tính" trên LN.
  2. Chuyến bị hủy → không xuất hiện trong `/finance` kỳ đó, không tính LN.

### TC-M01-04-05 — Tính nhất quán (tính lại cùng dữ liệu không đổi; tải lại sau lưu khớp báo cáo)

- **Các bước:**
  1. Refresh trang chuyến → LN không đổi.
  2. So sánh LN chuyến với tổng trong `/finance` kỳ → khớp.

---

## 1.5 — Ghi nhận chi phí phát sinh tại cảng hoặc kho

**Quy tắc (PRD M01-1.5):** Mỗi khoản chi chỉ thuộc một phạm vi rõ ràng; khoản có hóa đơn phải đủ thông
tin hóa đơn trước khi chốt.

### TC-M01-05-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M01-05-01
- **Vai trò:** `ketoan` (hoặc `giaonhan` tùy cấu hình)
- **Các bước:**
  1. Mở `/expenses/new`.
  2. Nhập: chuyến, container, hạng mục, số tiền, đơn vị cung cấp, ngày phát sinh, chứng từ.
  3. Lưu.
- **Kết quả mong đợi (Pass):** Chi phí xuất hiện đúng chuyến, đúng nhóm, được tính 1 lần vào báo cáo.

### TC-M01-05-02 — Thiếu hoặc sai dữ liệu — bỏ trống chuyến → cảnh báo.

### TC-M01-05-03 — Trường hợp ngoại lệ (không hóa đơn → nêu căn cứ; chứng từ trùng → cảnh báo)

- **Các bước:**
  1. Tạo khoản chi hộ không hóa đơn → yêu cầu "căn cứ thay thế" (ảnh, xác nhận).
  2. Tạo 2 khoản dùng cùng số hóa đơn → cảnh báo "chứng từ trùng".

### TC-M01-05-04 — Kiểm soát quyền thao tác — `laixe` không vào được `/expenses/new`.

### TC-M01-05-05 — Gửi lại/đồng thời + biên: 1 chứng từ nhiều dòng; chi phí chung không gắn container; sửa khoản đang chờ.

- **Các bước:**
  1. 1 hóa đơn 3 dòng cho 3 container khác → nhập 3 khoản riêng, mỗi cái link tới 1 hóa đơn.
  2. Sửa khoản đang chờ → được (vì chưa duyệt).

---

## 1.6 — Quản lý xe đầu kéo, xe tải và rơ-moóc

**Quy tắc (PRD M01-1.6):** Không cho điều xe đang bảo dưỡng, hết đăng kiểm hoặc ngừng hoạt động. Biển số
lưu nguyên định dạng.

### TC-M01-06-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M01-06-01
- **Vai trò:** `admin`
- **Các bước:**
  1. Mở `/fleet`.
  2. Kiểm tra hồ sơ 1 xe: tình trạng, lịch sử bảo dưỡng, các chuyến đã chạy.
- **Kết quả mong đợi (Pass):** Hồ sơ đầy đủ, hiển thị cảnh báo nếu sắp hết đăng kiểm (< 30 ngày).

### TC-M01-06-02 — Thiếu hoặc sai dữ liệu — bỏ trống biển số → cảnh báo.

### TC-M01-06-03 — Trường hợp ngoại lệ (không xóa xe có lịch sử; chuyển "Ngừng hoạt động")

- **Các bước:**
  1. Thử xóa xe có chuyến đã chạy → bị từ chối, gợi ý "Chuyển Ngừng hoạt động".
  2. Chuyển "Ngừng hoạt động" → xe không còn trong dropdown khi tạo chuyến.

### TC-M01-06-04 — Kiểm soát quyền thao tác — `laixe` không vào được `/fleet`.

### TC-M01-06-05 — Gửi lại/đồng thời + biên: đổi rơ-moóc giữa chuyến; 2 xe biển gần giống; bảo dưỡng trùng lịch điều vận.

- **Các bước:**
  1. Tạo chuyến cho xe đang bảo dưỡng → bị từ chối.
  2. Tạo chuyến cho xe hết đăng kiểm → bị từ chối.

---

## 1.7 — Điều động hàng hai chiều cho cùng xe và lái xe

**Quy tắc (PRD M01-1.7):** Chỉ ghép khi thời gian và vị trí nối tiếp hợp lý; hai lệnh vẫn giữ doanh thu,
chi phí và trạng thái riêng.

### TC-M01-07-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M01-07-01
- **Vai trò:** `admin` (điều vận)
- **Các bước:**
  1. Tạo 2 lệnh: lệnh 1 (Hải Phòng → Hà Nội, 08:00–12:00), lệnh 2 (Hà Nội → Hải Phòng, 14:00–18:00).
  2. Ghép 2 lệnh cho cùng xe + lái xe.
- **Kết quả mong đợi (Pass):**
  - Màn hình hiển thị thứ tự 2 lệnh, quãng rỗng giữa lệnh.
  - Hiệu quả hàng hai chiều: doanh thu gộp / tổng chi phí hiển thị.
  - Hai lệnh vẫn có doanh thu/chi phí/trạng thái riêng.

### TC-M01-07-02 — Thiếu hoặc sai dữ liệu — bỏ trống xe ghép → cảnh báo.

### TC-M01-07-03 — Trường hợp ngoại lệ (trùng giờ, vượt tải, điểm đầu lệnh sau không phù hợp)

- **Các bước:**
  1. Lệnh 1 kết thúc 13:00 ở Hà Nội, lệnh 2 bắt đầu 12:30 ở Hải Phòng → cảnh báo "Địa điểm nối tiếp không hợp lý".
  2. Lệnh 2 vượt tải trọng xe → cảnh báo "Vượt tải trọng".

### TC-M01-07-04 — Kiểm soát quyền thao tác — `giaonhan` không vào được dispatch two-orders.

### TC-M01-07-05 — Gửi lại/đồng thời + biên: 1 lệnh bị hủy; lệnh đầu giao trễ; 2 lệnh qua ngày.

- **Các bước:**
  1. Ghép 2 lệnh → hủy lệnh 1 → lệnh 2 vẫn giữ dữ liệu, cảnh báo cho điều vận.

---

## 1.8 — Chốt chuyến và lưu nhật ký thao tác

**Quy tắc (PRD M01-1.8):** Chỉ chốt khi đủ dữ liệu; chốt tạo đúng bút toán liên quan và khóa chỉnh sửa
trực tiếp.

### TC-M01-08-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M01-08-01
- **Vai trò:** `ketoan` hoặc `admin`
- **Tiền điều kiện:** chuyến "Hoàn thành" có đủ doanh thu + chi phí + ảnh bắt buộc.
- **Các bước:**
  1. Mở chuyến "Hoàn thành" C-001.
  2. Bấm "Chốt chuyến".
  3. Xác nhận.
- **Kết quả mong đợi (Pass):**
  - Trạng thái → "Đã chốt".
  - Báo cáo kỳ cập nhật (doanh thu, chi phí, LN của chuyến được cộng).
  - Nhật ký ghi: người chốt, thời điểm, snapshot số liệu.
  - Các trường tiền/cọc bị khóa (read-only).

### TC-M01-08-02 — Thiếu hoặc sai dữ liệu

- **Các bước:** mở chuyến thiếu ảnh bắt buộc → bấm "Chốt".
- **Kết quả mong đợi (Pass):** cảnh báo "Cần ảnh hoàn thành trước khi chốt", không cho chốt.

### TC-M01-08-03 — Trường hợp ngoại lệ (sửa sau chốt qua điều chỉnh/mở khóa có kiểm soát)

- **Các bước:**
  1. Mở chuyến đã chốt → thử sửa tiền cước → chỉ có nút "Tạo điều chỉnh".
  2. Tạo điều chỉnh → tạo dòng mới link chuyến gốc, lưu người + lý do.

### TC-M01-08-04 — Kiểm soát quyền thao tác

- **Vai trò thử:** `laixe`, `customer`
- **Kết quả mong đợi (Pass):** không thấy nút "Chốt chuyến".

### TC-M01-08-05 — Gửi lại/đồng thời + biên: bấm chốt 2 lần; 2 người chốt đồng thời; mất kết nối ngay sau chốt.

- **Các bước:**
  1. Bấm "Chốt" 2 lần liên tiếp → chỉ 1 bút toán (TC-HT-04).
  2. 2 tab cùng bấm chốt → 1 thắng, 1 nhận "đã chốt bởi người khác".

---

## Bảng nghiệm thu M01

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M01-01-01 |           |         |         |            |
| …        | …            |           |         |         |            |

### Tiêu chí toàn phân hệ M01-HT-01 … M01-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` áp dụng trên màn hình của M01.

| Mã HT      | Kết quả | Bằng chứng |
| ---------- | ------- | ---------- |
| M01-HT-01  |         |            |
| M01-HT-02  |         |            |
| M01-HT-03  |         |            |
| M01-HT-04  |         |            |
| M01-HT-05  |         |            |
| M01-HT-06  |         |            |
| M01-HT-07  |         |            |
| M01-HT-08  |         |            |
| M01-HT-09  |         |            |
| M01-HT-10  |         |            |
