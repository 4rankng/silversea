# M11 — Tài chính, Báo cáo lãi lỗ & Trợ lý giám đốc

> **Phân hệ 11** — 6 nhóm (11.1–11.6). Nguồn PRD: `docs/prd/Module11.docx`.
> **Tiêu chí toàn phân hệ:** `M11-HT-01` … `M11-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:**
> - `/finance` — Báo cáo lãi lỗ P&L (P&L tổng thể & chi tiết đầu xe, tạm ứng/hoàn ứng, kỳ hạn khách hàng)
> - `/profit` — Phân chia lợi nhuận
> - `/dashboard` — Bảng điều hành giám đốc (KPI dòng tiền, hàng hai chiều, hiệu quả xe)
> - `/advances` — Tạm ứng & hoàn ứng, dùng `view=requests|settlements` để chuyển giữa yêu cầu và phiếu hoàn ứng
> - `/admin/advance-settlements` — URL tương thích cũ; chuyển hướng sang `/advances?view=settlements`
> - `/api/agent` — Trợ lý AI cho giám đốc (chat UI trên `/dashboard`, thử ở TC-M11-06-*)
>
> **Vai trò thử:** `giamdoc` (xem chính, hỏi trợ lý), `ketoan` (đối soát số liệu), `admin` (duyệt hoàn ứng, cấu hình kỳ).

---

## 11.1 — Báo cáo lãi lỗ tổng thể theo kỳ

**Quy tắc (PRD M11-01):** Phân biệt số tạm tính và số chốt; công thức tổng khớp sổ chi tiết. Báo cáo hiển thị
doanh thu, từng nhóm chi phí, lợi nhuận gộp, lợi nhuận ròng, biên %. Kỳ chưa khóa → cảnh báo; chuyến hủy và
bút toán đảo không bị tính nhầm.

### TC-M11-01-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M11-01-01
- **Vai trò:** `giamdoc`, `ketoan`
- **Tiền điều kiện:** kỳ Tháng 07/2026 đã có ≥ 5 chuyến hoàn thành đã chốt doanh thu + chi phí; kỳ chưa khóa.
- **Các bước:**
  1. Đăng nhập `giamdoc` → mở `/finance`.
  2. Chọn kỳ "Tháng 07/2026" → bấm "Xem báo cáo".
  3. Đối chiếu từng dòng với sổ chi tiết (`/finance` → "Sổ cái kỳ").
- **Kết quả mong đợi (Pass):**
  - Hiển thị đầy đủ: Doanh thu, Chi phí xe (nhiên liệu, cầu đường), Chi phí nhân sự, Chi phí khác, Lợi nhuận gộp, Lợi nhuận ròng, Biên %.
  - Tổng doanh thu = Σ doanh thu từng chuyến trong kỳ (theo sổ cái).
  - Lợi nhuận ròng = Doanh thu − Σ chi phí; Biên % = Lợi nhuận ròng / Doanh thu × 100.
  - Nhãn hiển thị rõ "Tạm tính" vì kỳ chưa khóa.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh chụp `/finance` kỳ 07/2026 + sổ cái kỳ.

### TC-M11-01-02 — Thiếu hoặc sai dữ liệu (kỳ chưa khóa → cảnh báo; thiếu chi phí chuyến)

- **Mã PRD:** M11-01-02
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** kỳ 07/2026 chưa khóa; có 1 chuyến đã chốt doanh thu nhưng chưa nhập chi phí nhiên liệu.
- **Các bước:**
  1. Mở `/finance` kỳ 07/2026.
  2. Đọc banner/đầu báo cáo.
  3. Bấm vào biểu tượng cảnh báo bên cạnh dòng "Chi phí xe".
- **Kết quả mong đợi (Pass):**
  - Banner tiếng Việt: "Kỳ chưa khóa — số liệu mang tính tạm tính".
  - Cảnh báo liệt kê chuyến thiếu chi phí; không cộng khuyết vào tổng mà ghi "chưa đủ dữ liệu".
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh banner cảnh báo + tooltip.

### TC-M11-01-03 — Trường hợp ngoại lệ (điều chỉnh hồi tố sau khi mở kỳ)

- **Mã PRD:** M11-01-03
- **Vai trò:** `ketoan`, `admin`
- **Tiền điều kiện:** kỳ 06/2026 đã khóa; `admin` mở lại kỳ (mở khóa).
- **Các bước:**
  1. `admin` mở lại kỳ 06/2026 với lý do.
  2. `ketoan` tạo bút toán điều chỉnh tăng chi phí 2.000.000đ cho 1 chuyến.
  3. `giamdoc` mở lại `/finance` kỳ 06/2026.
- **Kết quả mong đợi (Pass):**
  - Lợi nhuận ròng kỳ 06/2026 giảm đúng 2.000.000đ.
  - Hiển thị nhãn "Đã điều chỉnh hồi tố" + thời điểm + người chỉnh (đối chiếu HT-03 nhật ký).
  - Bút toán đảo (nếu có) không bị cộng kép vào chi phí.
- **Phụ thuộc:** Q03 (nhật ký thao tác)
- **Bằng chứng:** ảnh báo cáo trước/sau + nhật ký điều chỉnh.

### TC-M11-01-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M11-01-04
- **Vai trò:** `laixe`, `giaonhan`, `customer`
- **Các bước:**
  1. Đăng nhập `laixe`, `giaonhan`, `customer` lần lượt.
  2. Truy cập trực tiếp URL `/finance`.
- **Kết quả mong đợi (Pass):**
  - Cả 3 vai trò không vào được `/finance` (chuyển về trang không đủ quyền hoặc 403).
  - Chỉ `giamdoc`, `ketoan`, `admin` xem được báo cáo P&L.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh màn hình từ chối cho từng vai trò.

### TC-M11-01-05 — Gửi lại/đồng thời + biên: cắt kỳ giữa tháng; giá trị 0/âm; chuyến hủy

- **Mã PRD:** M11-01-05
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** kỳ tùy chỉnh 15/07–14/08/2026; có 1 chuyến hủy trong kỳ (đã có bút toán đảo); 1 khoản hoàn doanh thu âm.
- **Các bước:**
  1. Mở `/finance` chọn kỳ tùy chỉnh 15/07–14/08/2026.
  2. Xác nhận kỳ cắt giữa tháng vẫn tính đúng.
  3. Kiểm tra khoản doanh thu âm (−1.000.000đ) và chuyến hủy.
- **Kết quả mong đợi (Pass):**
  - Báo cáo tính đúng cho kỳ cắt giữa tháng (chỉ lấy chứng từ trong khoảng ngày).
  - Chuyến hủy không góp phần vào doanh thu/chi phí (chỉ bút toán đảo còn hiệu lực mới tính).
  - Khoản âm hiển thị trong ngoặc `(1.000.000)`, không làm vỡ định dạng VNĐ.
  - Mở 2 tab cùng bấm "Xuất Excel" (HT-04) không tạo 2 tệp chồng dop.
- **Phụ thuộc:** Q04 (double-submit)
- **Bằng chứng:** ảnh báo cáo kỳ tùy chỉnh + tệp Excel xuất.

---

## 11.2 — Báo cáo lãi lỗ chi tiết từng đầu xe

**Quy tắc (PRD M11-02):** Chỉ phân bổ chi phí đúng đầu xe; chi phí moóc/chung không gán tùy tiện. Báo cáo
khớp tổng từng chuyến; liệt kê rõ khoản chưa phân bổ. Đầu xe không có chuyến nhưng có chi phí vẫn xuất hiện;
dữ liệu thiếu được đánh dấu.

### TC-M11-02-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M11-02-01
- **Vai trò:** `giamdoc`, `ketoan`
- **Tiền điều kiện:** kỳ 07/2026 có 3 đầu xe (51C-123, 51C-124, 51C-125) chạy ít nhất 2 chuyến mỗi xe; chi phí đã phân bổ đúng đầu xe.
- **Các bước:**
  1. Mở `/finance` → chuyển tab "Theo đầu xe".
  2. Chọn kỳ 07/2026.
  3. Bấm vào đầu xe 51C-123 để xem chi tiết.
- **Kết quả mong đợi (Pass):**
  - Bảng liệt kê 3 đầu xe kèm Doanh thu, Chi phí, Lợi nhuận, Biên %.
  - Tổng 3 đầu xe khớp với P&L tổng thể kỳ (TC-M11-01-01).
  - Chi tiết 51C-123 liệt kê từng chuyến + chi phí gắn riêng.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh báo cáo theo đầu xe + chi tiết 51C-123.

### TC-M11-02-02 — Thiếu hoặc sai dữ liệu (chi phí moóc/chung chưa phân bổ)

- **Mã PRD:** M11-02-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** kỳ 07/2026 có chi phí bảo dưỡng moóc 3.000.000đ chưa gán đầu xe.
- **Các bước:**
  1. Mở `/finance` tab "Theo đầu xe" kỳ 07/2026.
  2. Kiểm tra mục "Chưa phân bổ".
- **Kết quả mong đợi (Pass):**
  - Chi phí moóc 3.000.000đ nằm riêng ở dòng "Chưa phân bổ", không tặc gán vào 1 đầu xe.
  - Cảnh báo tiếng Việt nhắc phân bổ; tổng báo cáo vẫn khớp (kể cả phần chưa phân bổ).
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh mục "Chưa phân bổ".

### TC-M11-02-03 — Trường hợp ngoại lệ (đổi đầu xe giữa chuyến)

- **Mã PRD:** M11-02-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** 1 chuyến đổi đầu kéo giữa đường từ 51C-123 sang 51C-124.
- **Các bước:**
  1. Mở chi tiết chuyến đổi đầu xe.
  2. Quay lại `/finance` tab "Theo đầu xe".
- **Kết quả mong đợi (Pass):**
  - Doanh thu/chi phí chuyến chia đúng theo tỷ lệ hoặc đoạn đường cho từng đầu xe (theo quy tắc cấu hình).
  - Cả 51C-123 và 51C-124 đều có phần của chuyến này; không bị trùng hoặc mất.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh chi tiết phân bổ chuyến đổi đầu xe.

### TC-M11-02-04 — Đầu xe không có chuyến nhưng có chi phí / đầu xe ngừng hoạt động

- **Mã PRD:** M11-02-04
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** đầu xe 51C-126 bảo dưỡng toàn kỳ 07/2026 (0 chuyến) nhưng có phí gara 5.000.000đ; đầu xe 51C-127 đánh dấu "Ngừng hoạt động" từ 01/07.
- **Các bước:**
  1. Mở `/finance` tab "Theo đầu xe" kỳ 07/2026.
  2. Kiểm tra 51C-126 và 51C-127.
- **Kết quả mong đợi (Pass):**
  - 51C-126 vẫn xuất hiện với 0 doanh thu, chi phí 5.000.000đ, lợi nhuận −5.000.000đ.
  - 51C-127 không nằm trong kỳ (hoặc có nhãn riêng "ngừng HĐ") tùy cấu hình, không gây hiểu nhầm.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh dòng 51C-126 và 51C-127.

### TC-M11-02-05 — Chi phí bảo dưỡng xuyên kỳ

- **Mã PRD:** M11-02-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** chi phí bảo dưỡng 12.000.000đ từ 25/06 đến 05/07 (xuyên 2 kỳ).
- **Các bước:**
  1. Mở `/finance` tab "Theo đầu xe" kỳ 06/2026 và kỳ 07/2026.
  2. Cộng phần phí bảo dưỡng của đầu xe đó 2 kỳ.
- **Kết quả mong đợi (Pass):**
  - Phí được phân bổ theo ngày: kỳ 06 nhận 6/11 ngày, kỳ 07 nhận 5/11 ngày (hoặc quy tắc cấu hình).
  - Tổng 2 kỳ = 12.000.000đ, không trùng/lệch.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh 2 kỳ + công thức phân bổ.

---

## 11.3 — Báo cáo tạm ứng và hoàn ứng theo nhân sự

**Quy tắc (PRD M11-03):** Số dư cuối kỳ = đầu kỳ + tạm ứng − chi phí đã duyệt − hoàn ứng (theo dấu cố định
đã khóa). Hiển thị từng phiếu, chuyến liên quan, trạng thái, tổng theo người. Khoản bị từ chối không tính là
chi phí; phiếu xuyên kỳ phải chuyển số dư đúng.

### TC-M11-03-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M11-03-01
- **Vai trò:** `giamdoc`, `ketoan`
- **Tiền điều kiện:** nhân viên Nguyễn Văn A có số dư đầu kỳ 07/2026 = 1.000.000đ; tạm ứng thêm 5.000.000đ; chi phí đã duyệt 3.000.000đ; hoàn ứng 1.000.000đ.
- **Các bước:**
  1. Mở `/advances?view=requests` chọn kỳ 07/2026.
  2. Xem báo cáo theo nhân sự cho A.
- **Kết quả mong đợi (Pass):**
  - Liệt kê từng phiếu: số phiếu, ngày, số tiền, chuyến liên quan, trạng thái (Tạm ứng/Đã duyệt/Hoàn ứng).
  - Số dư cuối kỳ = 1.000.000 + 5.000.000 − 3.000.000 − 1.000.000 = 2.000.000đ.
  - Dấu cộng/trừ nhất quán theo cấu hình khóa.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh báo cáo `/advances?view=requests` của A.

### TC-M11-03-02 — Thiếu hoặc sai dữ liệu (khoản bị từ chối)

- **Mã PRD:** M11-03-02
- **Vai trò:** `admin`
- **Tiền điều kiện:** A nộp 1 phiếu chi phí 500.000đ bị từ chối (không hợp lệ).
- **Các bước:**
  1. Mở `/advances?view=settlements` (hoặc `/admin/advance-settlements` để kiểm tra chuyển hướng).
  2. Từ chối phiếu 500.000đ với lý do.
  3. Quay lại `/advances?view=requests` kỳ 07/2026.
- **Kết quả mong đợi (Pass):**
  - Phiếu 500.000đ có trạng thái "Từ chối" + lý do, không được trừ vào số dư A.
  - Số dư cuối kỳ A không đổi do khoản bị từ chối.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh phiếu bị từ chối + báo cáo số dư.

### TC-M11-03-03 — Trường hợp ngoại lệ (phiếu xuyên kỳ)

- **Mã PRD:** M11-03-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** phiếu tạm ứng 10.000.000đ tạo 28/06, chi phí gắn phiếu phát sinh 03/07.
- **Các bước:**
  1. Mở `/advances?view=requests` kỳ 06/2026 và 07/2026.
  2. Kiểm tra số dư chuyển kỳ.
- **Kết quả mong đợi (Pass):**
  - Số dư cuối kỳ 06 của A cộng 10.000.000đ.
  - Số dư đầu kỳ 07 của A = số dư cuối kỳ 06 (kế thừa).
  - Chi phí 03/07 trừ đúng ở kỳ 07, không trừ nhầm kỳ 06.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh 2 kỳ + dòng kế thừa số dư.

### TC-M11-03-04 — Một người nhiều phiếu + hoàn ứng một phần

- **Mã PRD:** M11-03-04
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** A có 8 phiếu tạm ứng trong kỳ; 1 phiếu hoàn ứng một phần (2.000.000/5.000.000).
- **Các bước:**
  1. Mở `/advances?view=requests` kỳ 07/2026 lọc theo A.
  2. Kiểm tra phiếu hoàn ứng một phần.
- **Kết quả mong đợi (Pass):**
  - 8 phiếu hiển thị đầy đủ, sắp xếp theo ngày.
  - Phiếu hoàn ứng một phần ghi rõ: đã hoàn 2.000.000, còn 3.000.000 trong số dư.
  - Tổng số dư cuối kỳ khớp công thức.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh danh sách phiếu của A.

### TC-M11-03-05 — Nhân viên đã nghỉ việc còn số dư

- **Mã PRD:** M11-03-05
- **Vai trò:** `giamdoc`, `admin`
- **Tiền điều kiện:** nhân viên B đã nghỉ 15/07/2026, còn số dư tạm ứng 4.000.000đ chưa tất toán.
- **Các bước:**
  1. Mở `/advances?view=requests` kỳ 07/2026.
  2. Kiểm tra dòng của B.
- **Kết quả mong đợi (Pass):**
  - B vẫn xuất hiện với trạng thái nhân sự "Đã nghỉ việc" + số dư 4.000.000đ.
  - Cảnh báo nổi tiếng Việt: "Còn số dư chưa tất toán" để `admin` xử lý.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh dòng B + cảnh báo.

---

## 11.4 — Ghi nhận ngày thanh toán để đánh giá kỳ hạn khách hàng

**Quy tắc (PRD M11-04):** Tính số ngày tới hạn trên phần đã thanh toán; phần chưa thanh toán tính tới
ngày báo cáo. Báo cáo hiển thị kỳ hạn thực tế, trung bình, xu hướng theo khách. Thanh toán một phần → tính
từng phần; trả trước không tạo số ngày âm gây hiểu nhầm.

### TC-M11-04-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M11-04-01
- **Vai trò:** `giamdoc`, `ketoan`
- **Tiền điều kiện:** khách A có 1 hóa đơn 10.000.000đ ngày 01/07, thanh toán đủ ngày 10/07 (ngày ghi nhận = 10/07).
- **Các bước:**
  1. Mở `/finance` → tab "Kỳ hạn khách hàng".
  2. Chọn kỳ 07/2026, lọc khách A.
- **Kết quả mong đợi (Pass):**
  - Kỳ hạn thực tế = 10 − 1 = 9 ngày.
  - Báo cáo hiển thị kỳ hạn trung bình = 9 ngày (1 hóa đơn).
  - Cột "Trạng thái" = Đã thanh toán đủ.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh báo cáo kỳ hạn của A.

### TC-M11-04-02 — Thiếu hoặc sai dữ liệu (chưa thanh toán)

- **Mã PRD:** M11-04-02
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** khách C có hóa đơn 01/07, đến ngày báo cáo 26/07 vẫn chưa thanh toán.
- **Các bước:**
  1. Mở `/finance` tab "Kỳ hạn khách hàng" kỳ 07/2026.
  2. Lọc khách C.
- **Kết quả mong đợi (Pass):**
  - Số ngày quá hạn tính tới ngày báo cáo = 26 − 01 = 25 ngày (hoặc = 25 − hạn thanh toán cấu hình).
  - Trạng thái "Chưa thanh toán" + cảnh báo quá hạn.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh dòng C + cảnh báo quá hạn.

### TC-M11-04-03 — Thanh toán một phần + trả trước

- **Mã PRD:** M11-04-03
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** hóa đơn 10.000.000đ ngày 01/07. Thanh toán lần 1 ngày 05/07: 6.000.000đ. Lần 2 ngày 20/07: 4.000.000đ. Khách D trả trước hóa đơn kỳ sau 3.000.000đ ngày 28/06.
- **Các bước:**
  1. Mở `/finance` tab "Kỳ hạn khách hàng" kỳ 07/2026.
  2. Kiểm tra từng phần thanh toán.
- **Kết quả mong đợi (Pass):**
  - Phần 6.000.000: kỳ hạn = 5 − 1 = 4 ngày.
  - Phần 4.000.000: kỳ hạn = 20 − 1 = 19 ngày.
  - Kỳ hạn trung bình gia quyền đúng theo từng phần.
  - Khoản trả trước của D không tạo kỳ hạn âm; hiển thị "Trả trước" riêng, không làm sai trung bình.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh chi tiết thanh toán từng phần.

### TC-M11-04-04 — Nhiều lần thanh toán + điều chỉnh ngày thanh toán

- **Mã PRD:** M11-04-04
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** hóa đơn có 3 lần thanh toán (03/07, 10/07, 15/07); sau đó `ketoan` điều chỉnh ngày lần 2 từ 10/07 → 12/07 với lý do.
- **Các bước:**
  1. Mở `/finance` tab "Kỳ hạn khách hàng".
  2. `ketoan` sửa ngày thanh toán lần 2.
  3. Xem lại báo cáo.
- **Kết quả mong đợi (Pass):**
  - Kỳ hạn của phần thanh toán lần 2 cập nhật theo ngày mới 12/07.
  - Nhật ký ghi nhận người + thời điểm sửa + lý do (HT-03).
  - Trung bình kỳ hạn tính lại đúng.
- **Phụ thuộc:** Q03 (nhật ký thao tác)
- **Bằng chứng:** ảnh nhật ký sửa ngày + báo cáo cập nhật.

### TC-M11-04-05 — Thanh toán cuối tuần/ngày lễ

- **Mã PRD:** M11-04-05
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** hóa đơn đến hạn thứ 7; khách thanh toán Chủ nhật (ngày ngân hàng không làm việc).
- **Các bước:**
  1. Mở `/finance` tab "Kỳ hạn khách hàng" kỳ có chứa cuối tuần.
  2. Kiểm tra ngày ghi nhận thanh toán.
- **Kết quả mong đợi (Pass):**
  - Ngày thanh toán lấy theo ngày thực (Chủ nhật) hoặc ngày giá trị theo cấu hình (thứ 2 kế tiếp) — đúng quy tắc cấu hình.
  - Cột ghi chú hiển thị "ngày lễ/cuối tuần" để giám đốc không hiểu nhầm.
  - Kỳ hạn tính nhất quán với quy tắc đã chọn.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh dòng thanh toán cuối tuần.

---

## 11.5 — Bảng điều hành giám đốc về dòng tiền, hàng hai chiều và hiệu quả xe

**Quy tắc (PRD M11-05):** Mỗi KPI có định nghĩa, thời điểm cập nhật, link nguồn dữ liệu. Cảnh báo nổi bật,
so sánh liên kỳ, danh sách đầu xe cần chú ý. Dữ liệu thiếu/cũ → ghi rõ chứ không trình bày như số chính thức.

### TC-M11-05-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M11-05-01
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** kỳ hiện tại có đầy đủ dữ liệu chuyến, thu/chi, tạm ứng.
- **Các bước:**
  1. Đăng nhập `giamdoc` → mở `/dashboard`.
  2. Xem 3 nhóm KPI: dòng tiền, hàng hai chiều (xuất/nhập), hiệu quả xe.
  3. Bấm vào 1 KPI để xem link nguồn.
- **Kết quả mong đợi (Pass):**
  - Mỗi KPI có tooltip định nghĩa + thời điểm cập nhật (HH:MM DD/MM/YYYY).
  - Có cột/ảnh so sánh với kỳ trước (▲▼ kèm %).
  - Link dẫn đúng trang nguồn (`/finance`, danh sách chuyến...).
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh `/dashboard` + tooltip KPI.

### TC-M11-05-02 — Thiếu hoặc sai dữ liệu (dữ liệu cũ/chưa đồng bộ)

- **Mã PRD:** M11-05-02
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** 1 nguồn dữ liệu (ví dụ chi phí nhiên liệu) chưa đồng bộ > 24h.
- **Các bước:**
  1. Mở `/dashboard`.
  2. Tìm KPI có nguồn cũ.
- **Kết quả mong đợi (Pass):**
  - KPI hiển thị nhãn "Dữ liệu cũ — cập nhật lần cuối DD/MM HH:MM" tiếng Việt.
  - Không hiển thị giá trị đó như số chính thức; khuyên kiểm tra nguồn.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh nhãn "dữ liệu cũ".

### TC-M11-05-03 — Trường hợp ngoại lệ (giao dịch bất thường lớn)

- **Mã PRD:** M11-05-03
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** kỳ có 1 khoản chi 200.000.000đ (lớn bất thường) so với trung bình.
- **Các bước:**
  1. Mở `/dashboard`.
  2. Kiểm tra cảnh báo dòng tiền.
- **Kết quả mong đợi (Pass):**
  - Cảnh báo nổi bật về giao dịch bất thường + link tới chứng từ.
  - Dòng tiền kỳ giảm đúng số tiền lớn; không bị che giấu.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh cảnh báo + link chứng từ.

### TC-M11-05-04 — Kiểm soát quyền thao tác

- **Mã PRD:** M11-05-04
- **Vai trò:** `ketoan`, `laixe`, `customer`
- **Các bước:**
  1. Đăng nhập `ketoan`, `laixe`, `customer`.
  2. Truy cập `/dashboard`.
- **Kết quả mong đợi (Pass):**
  - `ketoan` có thể xem (nhưng ẩn nút thao tác-only-of-giamdoc nếu có).
  - `laixe`, `customer` không truy cập được `/dashboard` (403/redirect).
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh màn hình từng vai trò.

### TC-M11-05-05 — Biên: không có chuyến trong kỳ; đầu xe mới; dữ liệu đang đồng bộ

- **Mã PRD:** M11-05-05
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** kỳ tùy chỉnh 1 ngày không có chuyến; 1 đầu xe mới nhập kho hôm qua; 1 nguồn đang đồng bộ.
- **Các bước:**
  1. Mở `/dashboard` chọn ngày không chuyến.
  2. Kiểm tra danh sách đầu xe (đầu xe mới).
  3. Kiểm tra KPI đang đồng bộ.
- **Kết quả mong đợi (Pass):**
  - Ngày không chuyến: KPI hiển thị 0/suy giảm đúng, không báo lỗi hệ thống.
  - Đầu xe mới: hiển thị "mới" + không có dữ liệu hiệu quả (không suy ra sai).
  - KPI đang đồng bộ: nhãn "Đang đồng bộ" thay vì số.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh 3 trạng thái biên.

---

## 11.6 — Trợ lý truy vấn số liệu cho giám đốc (AI chatbot `/api/agent`)

**Quy tắc (PRD M11-06):** Trả lời dựa trên dữ liệu được phép truy cập, nêu rõ kỳ và nguồn; không đoán khi câu
hỏi mơ hồ. Trả lời ngắn gọn kèm số, phạm vi, link xác minh. Mơ hồ → hỏi lại; không có dữ liệu → nói rõ; nội
dung nhạy cảm không vượt quyền. **Lưu ý (AGENTS.md "no fake completion"):** metadata phản hồi phải kèm kỳ +
nguồn, không bịa.

### TC-M11-06-01 — Luồng nghiệp vụ thông thường

- **Mã PRD:** M11-06-01
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** kỳ 07/2026 có dữ liệu P&L đầy đủ.
- **Các bước:**
  1. Mở `/dashboard` → khung chat trợ lý (gọi `/api/agent`).
  2. Hỏi: "Lợi nhuận ròng tháng 7 bao nhiêu?".
- **Kết quả mong đợi (Pass):**
  - Trả lời ngắn gọn kèm số đúng (= giá trị P&L kỳ 07 — khớp TC-M11-01-01).
  - Metadata ghi rõ kỳ "Tháng 07/2026" + nguồn (`/finance`).
  - Có link "Xem chi tiết" dẫn tới `/finance`.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh chụp chat + metadata kỳ/nguồn.

### TC-M11-06-02 — Thiếu hoặc sai dữ liệu (câu hỏi mơ hồ → hỏi lại)

- **Mã PRD:** M11-06-02
- **Vai trò:** `giamdoc`
- **Các bước:**
  1. Trong khung chat hỏi: "Lãi tháng trước thế nào?" (không rõ "lãi" = gộp/ròng, "tháng trước" theo ngày nào).
- **Kết quả mong đợi (Pass):**
  - Trợ lý không đoán mà hỏi lại: "Bạn muốn xem lợi nhuận gộp hay ròng? Tháng trước tính đến 30/06 hay kỳ đang mở?".
  - Không đưa số khi chưa rõ phạm vi.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh câu hỏi lại của trợ lý.

### TC-M11-06-03 — Trường hợp ngoại lệ (không có dữ liệu)

- **Mã PRD:** M11-06-03
- **Vai trò:** `giamdoc`
- **Tiền điều kiện:** kỳ 01/2026 không có dữ liệu (trước khi dùng hệ thống).
- **Các bước:**
  1. Hỏi: "Doanh thu tháng 1/2026?".
- **Kết quả mong đợi (Pass):**
  - Trợ lý trả lời rõ: "Không có dữ liệu kỳ Tháng 01/2026 trong hệ thống".
  - Không bịa số; đề xuất kỳ có dữ liệu gần nhất.
- **Phụ thuộc:** không
- **Bằng chứng:** ảnh trả lời "không có dữ liệu".

### TC-M11-06-04 — Kiểm soát quyền / nội dung nhạy cảm

- **Mã PRD:** M11-06-04
- **Vai trò:** `ketoan` (nếu trợ lý mở cho `ketoan`), `laixe`
- **Các bước:**
  1. Đăng nhập `laixe` → cố gắng gọi `/api/agent` (qua UI hoặc POST trực tiếp).
  2. Với `giamdoc`, hỏi thông tin vượt phạm vi (ví dụ: chi tiết lương nhân viên).
- **Kết quả mong đợi (Pass):**
  - `laixe` không gọi được `/api/agent` (403).
  - Với câu hỏi vượt quyền, trợ lý từ chối cung cấp nội dung vượt permission, giải thích giới hạn.
- **Phụ thuộc:** Q02 (phân quyền)
- **Bằng chứng:** ảnh 403 + ảnh từ chối nội dung vượt quyền.

### TC-M11-06-05 — Biên: hỏi bằng giọng nói; nhiều KPI; "hôm qua" múi giờ; ngoài phạm vi

- **Mã PRD:** M11-06-05
- **Vai trò:** `giamdoc`
- **Các bước:**
  1. Bấm mic trên `/dashboard`, hỏi bằng giọng nói: "Hôm qua chạy bao nhiêu chuyến?".
  2. Hỏi câu ghép nhiều KPI: "Cho tôi doanh thu, chi phí và biên hôm nay".
  3. Hỏi ngoài phạm vi: "Thời tiết hôm nay thế nào?".
- **Kết quả mong đợi (Pass):**
  - Câu giọng nói được chuyển текст đúng; "hôm qua" quy đổi theo giờ VN (HT-06).
  - Câu nhiều KPI trả lời đủ 3 chỉ số, mỗi chỉ số kèm kỳ + nguồn.
  - Câu ngoài phạm vi: trợ lý nói rõ "ngoài phạm vi tài chính/vận tải", không bịa.
- **Phụ thuộc:** Q06 (ngày giờ VN)
- **Bằng chứng:** ảnh chat 3 kịch bản.

---

## Bảng nghiệm thu M11

| Ngày thử | Mã TC        | Người thử | Kết quả | Ghi chú | Bằng chứng |
| -------- | ------------ | --------- | ------- | ------- | ---------- |
| __/__/__ | TC-M11-01-01 |           |         |         |            |
| __/__/__ | TC-M11-01-02 |           |         |         |            |
| __/__/__ | TC-M11-01-03 |           |         |         |            |
| __/__/__ | TC-M11-01-04 |           |         |         |            |
| __/__/__ | TC-M11-01-05 |           |         |         |            |
| __/__/__ | TC-M11-02-01 |           |         |         |            |
| __/__/__ | TC-M11-02-02 |           |         |         |            |
| __/__/__ | TC-M11-02-03 |           |         |         |            |
| __/__/__ | TC-M11-02-04 |           |         |         |            |
| __/__/__ | TC-M11-02-05 |           |         |         |            |
| __/__/__ | TC-M11-03-01 |           |         |         |            |
| __/__/__ | TC-M11-03-02 |           |         |         |            |
| __/__/__ | TC-M11-03-03 |           |         |         |            |
| __/__/__ | TC-M11-03-04 |           |         |         |            |
| __/__/__ | TC-M11-03-05 |           |         |         |            |
| __/__/__ | TC-M11-04-01 |           |         |         |            |
| __/__/__ | TC-M11-04-02 |           |         |         |            |
| __/__/__ | TC-M11-04-03 |           |         |         |            |
| __/__/__ | TC-M11-04-04 |           |         |         |            |
| __/__/__ | TC-M11-04-05 |           |         |         |            |
| __/__/__ | TC-M11-05-01 |           |         |         |            |
| __/__/__ | TC-M11-05-02 |           |         |         |            |
| __/__/__ | TC-M11-05-03 |           |         |         |            |
| __/__/__ | TC-M11-05-04 |           |         |         |            |
| __/__/__ | TC-M11-05-05 |           |         |         |            |
| __/__/__ | TC-M11-06-01 |           |         |         |            |
| __/__/__ | TC-M11-06-02 |           |         |         |            |
| __/__/__ | TC-M11-06-03 |           |         |         |            |
| __/__/__ | TC-M11-06-04 |           |         |         |            |
| __/__/__ | TC-M11-06-05 |           |         |         |            |

### Tiêu chí toàn phân hệ M11-HT-01 … M11-HT-10

Chạy TC-HT-01 … TC-HT-10 từ `00-cross-cutting.md` trên các màn hình của M11 (`/finance`,
`/advances?view=requests`, `/advances?view=settlements`, `/dashboard`, khung chat `/api/agent`).

| Mã HT     | Kết quả | Bằng chứng |
| --------- | ------- | ---------- |
| M11-HT-01 |         |            |
| M11-HT-02 |         |            |
| M11-HT-03 |         |            |
| M11-HT-04 |         |            |
| M11-HT-05 |         |            |
| M11-HT-06 |         |            |
| M11-HT-07 |         |            |
| M11-HT-08 |         |            |
| M11-HT-09 |         |            |
| M11-HT-10 |         |            |
