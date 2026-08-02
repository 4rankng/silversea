# O2C — Quy trình Vận hành & Quyết toán (Order-to-Cash)

> **Phân hệ xuyên suốt.** Nguồn PRD: `docs/prd/O2C Flow.md` và `docs/prd/O2C dev-rev1.md`
> (quyết định ngày 01/08/2026). Bộ ca này kiểm thử **luồng end-to-end** từ Thiết lập nền tảng →
> Khởi tạo lô → Điều xe → Vận hành & chi phí hiện trường → Đối chiếu, quyết toán & Hoàn thành, và
> **bàn giao dữ liệu** sang công nợ AR/AP.
>
> **Quan trọng — thay đổi trạng thái (01/08/2026).** Quy trình O2C mới định nghĩa lại máy trạng thái
> lô hàng. Đọc kèm [`01-module-01-overview-dispatch.md`](./01-module-01-overview-dispatch.md) §1.3:
> trạng thái `Đã chốt` / `Đã khóa (Locked/Billed)` **đã bị loại bỏ**. Trạng thái kết thúc là
> `Hoàn thành` và chi phí **vẫn được phép chỉnh sửa sau khi hoàn thành**. Các ca trong tệp này ghi nhận
> quy tắc mới; nếu ca M01 cũ mâu thuẫn, **quy tắc O2C trong tệp này là chân lý mới** (xem §8).
>
> **Tiêu chí nghiệm thu toàn phân hệ:** `O2C-HT-01` … `O2C-HT-10` (xem `00-cross-cutting.md`).
>
> **Màn hình chính:** `/shipments`, `/shipments/new`, `/shipments/:id`, `/dispatch`, `/trips`,
> `/trips/:id`, `/expenses`, `/debt`, `/payables`, `/finance`. Vai trò thử chính: `admin`, `ketoan`,
> `giamdoc`, `giaonhan` (Ops), `laixe` (Lái xe), vai trò `CLERK` (Nhân viên chứng từ).

---

## Bối cảnh nghiệp vụ

Quy trình O2C là xương sống của sản phẩm: mỗi lô hàng đi qua 5 trạng thái do 5 nhóm vai trò phụ trách,
tại mỗi bước có **điểm kiểm soát hệ thống** (system rails) — bảo mật, phân quyền thao tác, quy tắc xóa,
tự động hóa, ranh giới nghiệp vụ (POD, tạm ứng, chu kỳ chốt, đồng bộ). Sai một điểm kiểm soát sẽ làm
hỏng sổ sách, công nợ hoặc P&L.

| Bước | Bộ phận phụ trách | Đầu ra trạng thái | Điểm kiểm soát chính |
| ---- | ----------------- | ----------------- | -------------------- |
| 0 — Thiết lập nền tảng | Admin / Giám đốc / Kế toán / CUS | (master data sẵn sàng) | Bảo mật dữ liệu nhạy cảm, Create-only, quy tắc xóa, push MVP |
| 1 — Khởi tạo & kiểm duyệt lô | CUS (Nhân viên chứng từ) | `Mới tạo` | Tự áp giá cước + phụ phí xăng dầu, cross-check |
| 2 — Phân bổ & điều xe 2 cấp | Điều vận | `Đã điều xe` | Phát lệnh tự động sang App Lái xe, tối ưu phí đường kẹp hàng |
| 3 — Vận hành & chi phí hiện trường | Ops + Lái xe | `Đang chạy` → `Chờ duyệt phí` | Tự áp giá nâng/hạ, chống gian lận nhiên liệu, SLA log, gom chi phí |
| 4 — Đối chiếu, quyết toán & hoàn thành | Kế toán / CUS | `Hoàn thành` | Cổng POD, cấn trừ tạm ứng, snapshot AR/AP, tách P&L Xe nhà/Xe ngoài |

---

## 1. Bước 0 — Thiết lập nền tảng & ma trận phân quyền

**Quy tắc (PRD Bước 0):** Khai báo danh mục chuẩn (Khách hàng, NCC, Bảng giá cước, Định mức nhiên liệu,
Nhà máy, Xe với tag `Xe nhà` / `Xe ngoài`). Dữ liệu nhạy cảm (lợi nhuận, giá vốn, lương tài xế, định mức)
chỉ Giám đốc/Kế toán/Admin được xem. Create-only chỉ thêm mới; sửa/xóa dành cho Admin/Giám đốc. Quy tắc
xóa: Create-only xóa được trong phiên hiện tại; xóa dữ liệu phiên cũ phải được Admin/Giám đốc phê duyệt;
chi phí/chứng từ đã được Kế toán duyệt thì cấm xóa. Push notification MVP chỉ cho Lái xe và Điều vận.

### TC-O2C-00-01 — Dữ liệu nhạy cảm bị ẩn với Điều vận / Ops

- **Mã PRD:** O2C Bước 0 (Kiểm soát bảo mật)
- **Vai trò thử:** `giaonhan` (Ops), vai trò Điều vận; đối chiếu với `ketoan`, `giamdoc`
- **Tiền điều kiện:** có một chuyến đã hoàn thành có lợi nhuận, giá vốn, lương lái xe.
- **Các bước:**
  1. `giamdoc` mở chi tiết chuyến → ghi chú các trường lợi nhuận, giá vốn, lương lái xe.
  2. `ketoan` mở cùng chuyến → xác nhận thấy các trường trên.
  3. Đăng nhập `giaonhan` (Ops) mở cùng chi tiết chuyến → kiểm tra hiển thị.
  4. Đăng nhập vai trò Điều vận → mở cùng chi tiết chuyến.
- **Kết quả mong đợi (Pass):**
  - `giamdoc` / `ketoan`: thấy đủ lợi nhuận, giá vốn, lương tài xế, định mức.
  - `giaonhan` / Điều vận: **không thấy** các trường nhạy cảm (ẩn hoàn toàn, không phải chỉ mờ).
  - API cũng không trả trường nhạy cảm (DevTools Network 200 không chứa key đó).
- **Phụ thuộc:** không.
- **Bằng chứng:** ảnh chi tiết chuyến cho 4 vai trò + ảnh response API.

### TC-O2C-00-02 — Create-only không sửa/xóa master data

- **Mã PRD:** O2C Bước 0 (Kiểm soát thao tác)
- **Vai trò thử:** `giaonhan`, vai trò Điều vận (Create-only), `laixe`
- **Tiền điều kiện:** có sẵn bản ghi Khách hàng, Bảng giá, Nhà cung cấp.
- **Các bước:**
  1. Đăng nhập `giaonhan`. Mở `/customers`, `/config/pricing-tables`, `/suppliers`.
  2. Thử bấm "Sửa" / "Xóa" trên một bản ghi.
  3. Truy cập trực tiếp URL edit (ví dụ `/customers/:id/edit`).
  4. Lặp lại với vai trò Điều vận.
- **Kết quả mong đợi (Pass):**
  - Nút Sửa/Xóa **không hiển thị** hoặc bị disable với Create-only.
  - URL edit trực tiếp → redirect / 403.
  - API PUT/DELETE trả 403 (DevTools Network).
  - Chỉ `admin`/`giamdoc` mới thấy nút và thực hiện được.
- **Bằng chứng:** ảnh UI (không có nút) + ảnh DevTools 403 + ảnh admin thấy nút.

### TC-O2C-00-03 — Quy tắc xóa cho Create-only (xóa trong phiên hiện tại được)

- **Mã PRD:** O2C Bước 0 (Quy tắc xóa 01/08/2026)
- **Vai trò:** vai trò `CLERK` (Create-only, ví dụ nhân viên chứng từ)
- **Tiền điều kiện:** `CLERK` đăng nhập, phiên làm việc đang mở.
- **Các bước:**
  1. `CLERK` tạo một lô hàng mới (Bước 1) ngay trong phiên hiện tại.
  2. Phát hiện nhập sai → bấm "Xóa" lô vừa tạo.
  3. Xác nhận lô biến mất khỏi danh sách.
- **Kết quả mong đợi (Pass):**
  - Lô do `CLERK` tạo trong phiên hiện tại **được phép xóa**.
  - Nhật ký `/audit-logs` ghi thao tác xóa: người thực hiện, thời điểm, id lô, lý do nếu bắt buộc.
  - Lô biến khỏi `/shipments`.
- **Bằng chứng:** ảnh trước/sau + ảnh audit log.

### TC-O2C-00-04 — Quy tắc xóa: dữ liệu phiên cũ cần phê duyệt

- **Mã PRD:** O2C Bước 0 (Quy tắc xóa 01/08/2026)
- **Vai trò:** vai trò `CLERK` (Create-only), `admin`
- **Tiền điều kiện:** có lô do `CLERK` tạo ở **phiên đăng nhập trước** (đã logout & login lại).
- **Các bước:**
  1. `CLERK` đăng nhập phiên mới, mở lô tạo ở phiên cũ.
  2. Thử bấm "Xóa".
  3. Nếu có luồng "gửi yêu cầu xóa", gửi yêu cầu → `admin` phê duyệt → xóa.
- **Kết quả mong đợi (Pass):**
  - `CLERK` **không xóa trực tiếp** được lô của phiên cũ (nút Xóa ẩn / vô hiệu, hoặc mở form yêu cầu).
  - Phải có yêu cầu → được `admin`/`giamdoc` phê duyệt → mới xóa được.
  - Mọi bước lưu trong `/audit-logs`.
- **Bằng chứng:** ảnh nút không khả dụng + ảnh luồng phê duyệt + audit log.

### TC-O2C-00-05 — Quy tắc xóa: cấm xóa chi phí/chứng từ đã được Kế toán duyệt

- **Mã PRD:** O2C Bước 0 (Ngoại lệ cấm xóa)
- **Vai trò:** `ketoan`, `admin`, `giamdoc`
- **Tiền điều kiện:** có một khoản chi hộ đã được `ketoan` duyệt ở Bước 4.
- **Các bước:**
  1. `ketoan` mở khoản chi đã duyệt → thử bấm Xóa.
  2. `admin` (người tạo khoản chi) mở khoản chi đã duyệt → thử bấm Xóa.
  3. `giamdoc` mở khoản chi đã duyệt → thử bấm Xóa.
- **Kết quả mong đợi (Pass):**
  - **Không ai** (kể cả người tạo, kể cả admin thường) xóa được chi phí/chứng từ đã được Kế toán duyệt.
  - Nút Xóa bị khóa/vô hiệu kèm tooltip giải thích, hoặc chuyển sang "Yêu cầu xử lý đặc biệt".
  - Chỉ xử lý được qua luồng điều chỉnh/hoàn tác có phê duyệt (xem TC-O2C-04-06).
- **Bằng chứng:** ảnh nút bị khóa cho 3 vai trò + ảnh tooltip.

### TC-O2C-00-06 — Push notification MVP chỉ cho Lái xe & Điều vận

- **Mã PRD:** O2C Bước 0 (Push Notification MVP 01/08/2026)
- **Vai trò thử:** `laixe`, vai trò Điều vận, `ketoan`, `giamdoc`, `customer`
- **Tiền điều kiện:** đã cấu hình kênh push (dev: mock/in-app notification).
- **Các bước:**
  1. `admin` điều xe cho một lô (Bước 2) → phát lệnh sang App Lái xe.
  2. `laixe` kiểm tra thông báo nhận lệnh.
  3. Vai trò Điều vận kiểm tra thông báo liên quan điều vận.
  4. `ketoan`, `giamdoc`, `customer` kiểm tra hộp thông báo sau cùng sự kiện.
- **Kết quả mong đợi (Pass):**
  - `laixe` **nhận** push khi có lệnh mới (App hoặc in-app).
  - Điều vận **nhận** push liên quan điều vận.
  - `ketoan`, `giamdoc`, `customer` **không nhận** push (MVP) — mail/nhắc nợ chưa build, không báo lỗi.
  - Không có crash/log lỗi do kênh chưa build cho các role này.
- **Phụ thuộc:** kênh push đã triển khai tối thiểu in-app cho Lái xe & Điều vận.
- **Bằng chứng:** ảnh thông báo `laixe` + ảnh hộp trống `ketoan`.

---

## 2. Bước 1 — Khởi tạo & kiểm duyệt lô hàng (CUS)

**Quy tắc (PRD Bước 1):** Nhân viên CUS tiếp nhận Booking, nhập lô hàng, khai báo đặc tính (FCL: số Cont/KG/CBM;
LCL: kho lấy hàng, loại bao bì, số lượng, KG, CBM, ghi chú). Cross-check 100% với chứng từ gốc. Hệ thống
tự áp mã tính cước từ biểu giá đã ký (không gõ giá thủ công) và **tự tính phụ phí xăng dầu**:
`Phụ phí = (Giá dầu hiện tại − Giá dầu gốc cấu hình) × Số lít định mức × Tỷ lệ % chia sẻ của Khách hàng`.
Trạng thái chuyển sang `Mới tạo`.

### TC-O2C-01-01 — Tạo lô FCL với tự áp giá cước

- **Mã PRD:** O2C Bước 1 + Dev Note Trigger Báo giá Cước
- **Vai trò:** vai trò `CLERK` (Nhân viên chứng từ)
- **Tiền điều kiện:** Bảng giá đã ký cho Khách hàng × Tuyến đường tồn tại trong master data.
- **Các bước:**
  1. `CLERK` mở `/clerk/shipments/new` (hoặc `/shipments/new`).
  2. Nhập Số Bill/Booking, chọn Khách hàng, Tuyến đường, Nhà máy.
  3. Phân loại FCL: nhập số Cont (ví dụ `2 × 40HC`), KG, CBM.
  4. Lưu.
- **Kết quả mong đợi (Pass):**
  - Trường "Đơn giá cước dự kiến" **tự điền** từ Bảng giá theo Khách × Tuyến — **không cho gõ tay**.
  - Lô tạo ở trạng thái `Mới tạo`.
  - Tổng cước dự kiến = đơn giá × số Cont (hoặc quy tắc bảng giá).
- **Bằng chứng:** ảnh form với giá tự điền + ảnh detail lô sau lưu.

### TC-O2C-01-02 — Tạo lô LCL với các trường chuyên biệt

- **Mã PRD:** O2C Bước 1 (Phân loại hàng LCL)
- **Vai trò:** vai trò `CLERK`
- **Các bước:**
  1. Mở form tạo lô, chọn loại hàng **LCL (Hàng lẻ)**.
  2. Nhập: Kho lấy hàng, Loại bao bì (Pallet/Roll/Carton), Số lượng, KG, CBM, Ghi chú lưu ý.
  3. Lưu.
- **Kết quả mong đợi (Pass):**
  - Form hiển thị đúng bộ trường chuyên biệt cho LCL (khác FCL).
  - Lưu thành công, dữ liệu hiển thị lại đúng ở detail.
- **Bằng chứng:** ảnh form LCL + ảnh detail.

### TC-O2C-01-03 — Phụ phí xăng dầu tự tính theo công thức

- **Mã PRD:** O2C Bước 1 + Dev Note Trigger Phụ phí Xăng dầu
- **Vai trò:** `ketoan` (nhập tham số), `CLERK`
- **Tiền điều kiện:** `Giá dầu gốc` đã cấu hình; định mức lít theo tuyến/xe tồn tại; tỷ lệ % chia sẻ KH cấu hình.
- **Các bước:**
  1. `ketoan` nhập tham số `Giá dầu hiện tại` (ví dụ 19.500 ₫/L; gốc 18.000 ₫/L).
  2. `CLERK` tạo lô với định mức 36 L, tỷ lệ chia sẻ KH = 80%.
  3. Xem chi tiết lô → kiểm tra trường Phụ phí xăng dầu.
- **Kết quả mong đợi (Pass):**
  - Phụ phí = `(19.500 − 18.000) × 36 × 80%` = `43.200 ₫` (theo công thức).
  - Phụ phí tự tính lại khi tham số giá dầu đổi (xem TC-O2C-01-05 đối chiếu nguồn).
  - Số tiền nguyên đồng VNĐ, định dạng đúng.
- **Bằng chứng:** ảnh detail lô với phụ phí + ảnh tay tính.

### TC-O2C-01-04 — CUS đối chiếu chéo (cross-check) trước khi chuyển Điều vận

- **Mã PRD:** O2C Bước 1 (Cross-check 100%) + CUS Phần 1
- **Vai trò:** `CLERK`
- **Tiền điều kiện:** lô đã tạo, có chứng từ gốc (Bill/Booking) để so sánh.
- **Các bước:**
  1. `CLERK` mở danh sách chi tiết lô (CUS Phần 1).
  2. Đối chiếu từng trường: số Bill, khách, tuyến, nhà máy, số Cont/KG/CBM với chứng từ gốc.
  3. Nếu đúng → chuyển sang Điều vận (Bước 2).
- **Kết quả mong đợi (Pass):**
  - Danh sách hiển thị đủ trường để đối chiếu; dữ liệu khớp chứng từ gốc.
  - Có dấu xác nhận "đã cross-check" hoặc workflow cho phép chuyển Điều vận.
- **Bằng chứng:** ảnh danh sách CUS Phần 1 + ảnh chứng từ gốc.

### TC-O2C-01-05 — Đối chiếu nguồn: đổi giá dầu/Bảng giá → lộ tái tính phụ phí/cước

- **Mã PRD:** O2C Bước 1 + Q22 (source-of-truth, recompute pre-lock)
- **Vai trò:** `ketoan`, `CLERK`
- **Tiền điều kiện:** lô ở trạng thái `Mới tạo` (chưa chốt).
- **Các bước:**
  1. Ghi chú cước + phụ phí lô hiện tại.
  2. `ketoan` đổi `Giá dầu hiện tại` hoặc `CLERK`/admin đổi Bảng giá.
  3. Mở lại lô → kiểm tra cước/phụ phí.
- **Kết quả mong đợi (Pass):**
  - Trước khi chốt, đổi nguồn → hệ thống **tự tính lại** cước/phụ phí (Q22).
  - Cảnh báo/xuất hiện nhãn "đã thay đổi do nguồn đổi".
- **Bằng chứng:** ảnh trước/sau + ảnh cảnh báo.

---

## 3. Bước 2 — Phân bổ & điều xe 2 cấp độ (Điều vận)

**Quy tắc (PRD Bước 2):** Điều vận làm 2 cấp: (1) Phần 1 — dữ liệu gộp (`5x40HC`) để gán nháp xe; (2) Phần 2 —
rã chi tiết từng dòng với gợi ý xe "gán nháp" để chốt. Hỗ trợ ghép (LCL) và kẹp (chạy 2 chiều). Khi chọn
"kẹp hàng", thuật toán chỉ gợi ý **1 lần định mức phí đường bộ (VETC) khép kín**, tránh nhân đôi chi phí ảo.
Tag `Xe nhà`/`Xe ngoài` đi theo lô để tách P&L. Phát lệnh tự động sang App Lái xe (push). Trạng thái → `Đã điều xe`.

### TC-O2C-02-01 — Điều xe Phần 1 (gộp) rồi Phần 2 (rã dòng)

- **Mã PRD:** O2C Bước 2 (Điều vận Phần 1 & 2)
- **Vai trò:** vai trò Điều vận
- **Tiền điều kiện:** có lô gộp `5x40HC` ở trạng thái `Mới tạo`.
- **Các bước:**
  1. Mở `/dispatch`, xem dữ liệu gộp ngày hôm đó.
  2. Phần 1: gán nháp xe cho từng nhóm cont.
  3. Phần 2: hệ thống rã thành 5 dòng chi tiết, hiển thị gợi ý xe đã gán nháp.
  4. Chốt xe từng dòng.
- **Kết quả mong đợi (Pass):**
  - Phần 1 cho cái nhìn tổng, gán nháp không chốt ngay.
  - Phần 2 rã đúng số dòng, gợi ý xe từ Phần 1 đi theo.
  - Chốt xe → lô chuyển `Đã điều xe`.
- **Bằng chứng:** ảnh Phần 1 (gộp) + ảnh Phần 2 (rã dòng).

### TC-O2C-02-02 — Kẹp hàng: chỉ tính 1 lần phí đường bộ (VETC)

- **Mã PRD:** O2C Bước 2 (Thuật toán Tối ưu Tiền đường / kẹp hàng)
- **Vai trò:** vai trò Điều vận
- **Tiền điều kiện:** 2 lệnh cùng lộ trình (2 chiều) trong ngày cho 1 xe.
- **Các bước:**
  1. Tích chọn "Kẹp hàng" ghép 2 lệnh cho 1 xe.
  2. Kiểm tra chi phí dự kiến / định mức phí đường bộ (VETC).
- **Kết quả mong đợi (Pass):**
  - Hệ thống chỉ ghi nhận **1 lần** phí cầu đường khép kín (VETC), không nhân đôi.
  - Mỗi lệnh vẫn giữ doanh thu/chi phí độc lập (xem TC-O2C-02-06 + Q/O01).
  - Nhật ký ghi rõ ghép kẹp.
- **Phụ thuộc:** O01 (two-way dispatch) đã accepted.
- **Bằng chứng:** ảnh chi phí 1 lần VETC + ảnh 2 lệnh độc lập.

### TC-O2C-02-03 — Tag Xe nhà / Xe ngoài đi theo lô

- **Mã PRD:** O2C Bước 2 (Kế thừa Data) + Dev Note Tách P&L
- **Vai trò:** vai trò Điều vận
- **Tiền điều kiện:** master data Xe có tag `Xe nhà` và `Xe ngoài`.
- **Các bước:**
  1. Gán xe có tag `Xe nhà` cho lô A; gán xe `Xe ngoài` cho lô B.
  2. Chốt điều xe.
  3. Kiểm tra detail từng lô hiển thị tag.
- **Kết quả mong đợi (Pass):**
  - Tag xe đi theo lô sau khi gán, hiển thị ở detail.
  - Tag dùng để tách P&L ở Bước 4 (xem TC-O2C-04-08).
- **Bằng chứng:** ảnh detail 2 lô với tag khác nhau.

### TC-O2C-02-04 — Phát lệnh tự động sang App Lái xe (push)

- **Mã PRD:** O2C Bước 2 (Phát lệnh + Push)
- **Vai trò:** vai trò Điều vận, `laixe`
- **Các bước:**
  1. Điều vận chốt xe cho lô.
  2. `laixe` mở App (`/my-trips`) kiểm tra.
- **Kết quả mong đợi (Pass):**
  - Lệnh xuất hiện ngay trên App Lái xe.
  - `laixe` nhận push notification (TC-O2C-00-06).
  - Lệnh chứa đủ: giờ cut-off, giờ đóng/trả, thông tin xuất hóa đơn.
- **Bằng chứng:** ảnh `/dispatch` sau chốt + ảnh `/my-trips` có lệnh mới.

### TC-O2C-02-05 — Phân quyền: Ops/Lái xe không được điều xe

- **Mã PRD:** O2C Bước 0 + Bước 2 (RBAC)
- **Vai trò thử:** `giaonhan`, `laixe`
- **Các bước:**
  1. `giaonhan` mở trực tiếp `/dispatch`.
  2. `laixe` mở trực tiếp `/dispatch`.
- **Kết quả mong đợi (Pass):**
  - Cả hai bị redirect/403; API dispatch trả 403.
  - Không thấy nút điều xe.
- **Bằng chứng:** ảnh redirect + DevTools 403.

### TC-O2C-02-06 — Kẹp hàng: mỗi lệnh giữ trạng thái & doanh thu độc lập

- **Mã PRD:** O2C Bước 2 + O01 (two-way dispatch)
- **Vai trò:** vai trò Điều vận, `laixe`
- **Các bước:**
  1. Kẹp 2 lệnh (TC-O2C-02-02).
  2. Hủy hoặc hoàn thành 1 trong 2 lệnh.
- **Kết quả mong đợi (Pass):**
  - Mỗi lệnh có trạng thái riêng (hủy 1 không ép hủy kia).
  - Doanh thu/chi phí tính độc lập theo từng lệnh.
- **Phụ thuộc:** O01.
- **Bằng chứng:** ảnh 2 lệnh với trạng thái khác nhau.

---

## 4. Bước 3 — Vận hành & ghi nhận chi phí thực tế (Ops & Lái xe)

**Quy tắc (PRD Bước 3):** Ops chi trả hộ (nâng hạ, hải quan, lưu bãi), chọn đúng mã lô + Tên Cảng/Loại Cont
để hệ thống **tự áp giá nâng/hạ** (không gõ tay), đính kèm ảnh hóa đơn/biên lai. Bàn giao lệnh cho Lái xe.
Lái xe nhận lệnh, bấm "Xác nhận Lệnh" (log timestamp SLA), cập nhật chi phí đường + nâng hạ từng cont,
chụp ảnh cột bơm/hóa đơn dầu, chụp ảnh số Cont/Seal, bấm "Hoàn thành". **Chống gian lận nhiên liệu:**
bóc tách dữ liệu từ ảnh hóa đơn dầu + đối chiếu tọa độ EXIF. **Gom chi phí tự động:** mọi chi phí cùng lô
về trạng thái `Treo (Pending)`. Trạng thái lô: `Đang chạy` → `Chờ duyệt phí`.

### TC-O2C-03-01 — Ops chi hộ: tự áp giá nâng/hạ theo Cảng + Loại Cont

- **Mã PRD:** O2C Bước 3 (Tự động áp giá Nâng/Hạ)
- **Vai trò:** `giaonhan` (Ops)
- **Tiền điều kiện:** Ma trận phí Nâng/Hạ theo `Tên Cảng + 20'/40' + Hàng/Rỗng` đã cấu hình.
- **Các bước:**
  1. `giaonhan` mở App tạo chi hộ, chọn mã lô, chọn `Tên Cảng` + `Loại Cont` (vd `40HC / Hàng`).
  2. Kiểm tra trường số tiền nâng/hạ.
  3. Đính kèm ảnh biên lai. Lưu.
- **Kết quả mong đợi (Pass):**
  - Số tiền nâng/hạ **tự điền** từ ma trận — Ops **không gõ tay**.
  - Chi phí lưu về đúng lô, trạng thái `Treo (Pending)` chờ Kế toán duyệt.
- **Bằng chứng:** ảnh form chi hộ (tiền tự điền) + ảnh detail lô có khoản chi pending.

### TC-O2C-03-02 — Lái xe xác nhận lệnh (SLA timestamp)

- **Mã PRD:** O2C Bước 3 (Log thời gian SLA)
- **Vai trò:** `laixe`
- **Tiền điều kiện:** lệnh đã điều xe hiển thị trên `/my-trips`.
- **Các bước:**
  1. `laixe` mở `/my-trips/:id`, xem giờ cut-off/đóng-trả.
  2. Bấm "Xác nhận Lệnh" (nhận lệnh gốc từ Ops).
  3. Mở nhật ký/audit kiểm tra timestamp.
- **Kết quả mong đợi (Pass):**
  - Bấm xác nhận → kích hoạt lộ trình, timestamp được ghi chính xác (giờ VN).
  - Audit log ghi thời điểm Ops "có lệnh" và Lái xe "nhận lệnh" để giải tranh chấp.
- **Bằng chứng:** ảnh `/my-trips/:id` + ảnh audit log timestamp.

### TC-O2C-03-03 — Lái xe thực thi 2 chiều (kẹp hàng) — chi phí riêng từng cont

- **Mã PRD:** O2C Bước 3 (Thực thi 2 chiều)
- **Vai trò:** `laixe`
- **Tiền điều kiện:** lô kẹp hàng (TC-O2C-02-02) đang `Đang chạy`.
- **Các bước:**
  1. `laixe` mở `/my-trips/two-orders` (hoặc giao diện 2 lệnh song song).
  2. Ghi nhận tiền đường, tiền nâng hạ **riêng** cho từng container.
  3. Chụp ảnh số Cont/Seal.
- **Kết quả mong đợi (Pass):**
  - Hiển thị song song 2 lệnh.
  - Chi phí ghi riêng theo từng cont, không trộn lẫn.
  - Trạng thái chuyển đúng `Đang chạy` → `Chờ duyệt phí` khi đủ.
- **Bằng chứng:** ảnh 2 lệnh song song + ảnh chi phí từng cont.

### TC-O2C-03-04 — Chụp ảnh nhiên liệu: bóc tách + đối chiếu EXIF (chống gian lận)

- **Mã PRD:** O2C Bước 3 (Kiểm soát gian lận nhiên liệu) + Dev Note Điểm neo Giá vốn
- **Vai trò:** `laixe`
- **Tiền điều kiện:** lô `Đang chạy`; quy trình bóc tách ảnh dầu triển khai (hoặc mock AI).
- **Các bước:**
  1. `laixe` tải lên ảnh hóa đơn/cột bơm dầu khi đổ nhiên liệu.
  2. Hệ thống bóc tách số lít + đơn giá từ ảnh.
  3. Đối chiếu tọa độ EXIF ảnh với lộ trình định vị.
- **Kết quả mong đợi (Pass):**
  - Số lít/đơn giá được bóc tách từ ảnh và hiển thị để Lái xe xác nhận.
  - Dữ liệu nhiên liệu đẩy vào Lợi nhuận gộp chuyến tức thời (Dashboard).
  - **Lưu ý phạm vi O2C:** chỉ tính lợi nhuận gộp tức thời — **không** đối chiếu hóa đơn tổng NCC dầu cuối tháng (việc đó thuộc M06).
- **Bằng chứng:** ảnh upload + ảnh dữ liệu bóc tách + ảnh Dashboard lợi nhuận gộp.

### TC-O2C-03-05 — Gom chi phí tự động về 1 mã lô (trạng thái Treo)

- **Mã PRD:** O2C Bước 3 (Tự động gom chi phí)
- **Vai trò:** `giaonhan`, `laixe`, `ketoan`
- **Tiền điều kiện:** lô `Đang chạy`.
- **Các bước:**
  1. `giaonhan` tạo 2 khoản chi hộ cho lô.
  2. `laixe` thêm 1 chi phí đường + 1 nâng hạ cho cùng lô.
  3. `ketoan` mở detail lô → xem nhóm chi phí chờ duyệt.
- **Kết quả mong đợi (Pass):**
  - Tất cả khoản chi (Ops + Lái xe) gom về cùng mã lô.
  - Trạng thái `Treo (Pending)` chờ Kế toán duyệt.
- **Bằng chứng:** ảnh detail lô với danh sách chi phí pending từ nhiều nguồn.

### TC-O2C-03-06 — Phạm vi giá vốn nhiên liệu: không đối chiếu hóa đơn tổng NCC

- **Mã PRD:** O2C Bước 3 (Điểm neo Giá vốn Vận hành)
- **Vai trò:** `ketoan` (kiểm tra ranh giới)
- **Các bước:**
  1. Sau TC-O2C-03-04, `ketoan` kiểm tra module công nợ NCC dầu (`/payables`).
  2. Xác nhận ranh giới O2C.
- **Kết quả mong đợi (Pass):**
  - O2C **chỉ** ghi nhận tiêu hao nhiên liệu để tính lợi nhuận gộp tức thời.
  - Đối chiếu hóa đơn tổng NCC dầu cuối tháng **không thuộc** luồng O2C (thuộc M06 AP — Q06).
  - Không có bản ghi hóa đơn NCC tự sinh từ O2C ngoài snapshot (xem TC-O2C-04-04).
- **Bằng chứng:** ảnh `/payables` (chưa có hóa đơn đối chiếu tổng) + ghi chú ranh giới.

---

## 5. Bước 4 — Đối chiếu, quyết toán & hoàn thành (Kế toán / CUS)

**Quy tắc (PRD Bước 4):** Kế toán/CUS rà soát phí pending, phân loại chi hộ **CÓ hóa đơn** (nâng hạ, lưu kho)
vs **KHÔNG hóa đơn** (phí giám sát, chi ngoài). Lọc theo chu kỳ chốt (T1/T2/T3), áp VAT chuẩn (0/5/8/10%).
Bấm "Hoàn thành". **Cổng POD:** không cho chuyển sang `Hoàn thành` nếu chưa tích "Đã thu hồi chứng từ gốc (POD)".
**Cấn trừ tạm ứng:** khi duyệt phí pending → tự sinh bút toán cấn trừ dư nợ tạm ứng Ops/Lái xe. **Bàn giao:**
"Hoàn thành" tính tổng sau VAT và đẩy **snapshot** sang AR + AP, đánh dấu changed nếu chi phí sửa tiếp.
**Tách P&L** theo `Xe nhà`/`Xe ngoài`. **KHÔNG đóng băng:** chi phí vẫn sửa được sau `Hoàn thành`.

### TC-O2C-04-01 — Cổng POD chặn chuyển Hoàn thành khi chưa thu hồi chứng từ

- **Mã PRD:** O2C Bước 4 (Ranh giới POD / State Transition Gate)
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** lô ở `Chờ duyệt phí`, **chưa** tích "Đã thu hồi chứng từ gốc".
- **Các bước:**
  1. `ketoan` mở lô, phân loại chi hộ, áp VAT.
  2. Bấm "Hoàn thành" **mà chưa** tích POD.
  3. Tích POD → bấm "Hoàn thành" lại.
- **Kết quả mong đợi (Pass):**
  - Lần 1: hệ thống **chặn**, báo "Phải xác nhận đã thu hồi chứng từ gốc (POD)".
  - Trạng thái vẫn `Chờ duyệt phí`.
  - Lần 2 (sau tích POD): chuyển sang `Hoàn thành`.
- **Bằng chứng:** ảnh lần 1 (bị chặn) + ảnh lần 2 (thành công).

### TC-O2C-04-02 — Phân loại chi hộ CÓ hóa đơn vs KHÔNG hóa đơn

- **Mã PRD:** O2C Bước 4 (Phân loại chi hộ)
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** lô có nhiều khoản chi hộ pending (xem TC-O2C-03-05).
- **Các bước:**
  1. `ketoan` mở lô, xem danh sách chi hộ.
  2. Phân loại: CÓ hóa đơn (nâng hạ, lưu kho) / KHÔNG hóa đơn (phí giám sát, chi ngoài).
  3. Áp mức VAT (0/5/8/10%) đúng nhóm.
- **Kết quả mong đợi (Pass):**
  - Hai nhóm tách bạch hiển thị.
  - Nhóm không hóa đơn áp đúng quy tắc Q12/Q13/Q14 (bằng chứng thay thế, ngưỡng, phê duyệt).
- **Phụ thuộc:** Q12, Q13, Q14 đã accepted.
- **Bằng chứng:** ảnh 2 nhóm chi hộ + ảnh VAT từng nhóm.

### TC-O2C-04-03 — Cấn trừ tạm ứng tự sinh khi duyệt phí pending

- **Mã PRD:** O2C Bước 4 (Ranh giới Tạm ứng / Cash Flow Boundary)
- **Vai trò:** `ketoan`, `giaonhan`, `laixe`
- **Tiền điều kiện:** `giaonhan`/`laixe` có dư nợ tạm ứng; lô có phí pending.
- **Các bước:**
  1. Ghi chú dư nợ tạm ứng hiện tại của Ops/Lái xe (`/advances`).
  2. `ketoan` duyệt phí chi hộ pending cho người đó.
  3. Kiểm tra lại dư nợ tạm ứng.
- **Kết quả mong đợi (Pass):**
  - Khi duyệt phí → hệ thống **tự sinh** bút toán cấn trừ vào dư nợ tạm ứng.
  - Dư nợ tạm ứng giảm đúng số tiền phí đã duyệt.
  - Bút toán có trong sổ, đối truy được.
- **Bằng chứng:** ảnh `/advances` trước/sau + ảnh bút toán cấn trừ.

### TC-O2C-04-04 — Bàn giao snapshot AR + AP + VAT; flag thay đổi nếu sửa tiếp

- **Mã PRD:** O2C Bước 4 (Điểm neo Chu kỳ chốt / Data Hand-off + Lưu ý Đồng bộ)
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** lô ở `Chờ duyệt phí`, đủ POD.
- **Các bước:**
  1. `ketoan` bấm "Hoàn thành" (lô `Xe nhà` + lô `Xe ngoài`).
  2. Kiểm tra `/debt` (AR khách hàng) và `/payables` (AP NCC/chủ xe ngoài).
  3. Sửa một chi phí sau khi Hoàn thành → kiểm tra flag.
- **Kết quả mong đợi (Pass):**
  - Hệ thống tính tổng sau VAT và đẩy **snapshot** song song sang AR + AP.
  - Lô `Xe ngoài` sinh thêm AP cho NCC/chủ xe.
  - Sửa chi phí sau Hoàn thành → bản ghi AR/AP **đánh dấu (flag) đã thay đổi** để Kế toán đối soát lại (không ghi đè số cũ mât).
  - Mọi thay đổi lưu audit.
- **Bằng chứng:** ảnh `/debt` + `/payables` có bản ghi mới + ảnh flag "đã thay đổi".

### TC-O2C-04-05 — Tách P&L Xe nhà vs Xe ngoài lên Dashboard

- **Mã PRD:** O2C Bước 4 (Tách P&L) + TC-O2C-02-03
- **Vai trò:** `giamdoc`, `ketoan`
- **Tiền điều kiện:** có lô `Hoàn thành` cả `Xe nhà` và `Xe ngoài` trong kỳ.
- **Các bước:**
  1. `giamdoc` mở Dashboard/`/profit`.
  2. Kiểm tra bóc tách doanh thu & giá vốn theo nhóm xe.
- **Kết quả mong đợi (Pass):**
  - Doanh thu và kết chuyển giá vốn tách riêng `Xe nhà` / `Xe ngoài`.
  - Tổng 2 nhóm = tổng kỳ (đối chiếu với `/trips` đã chốt kỳ — TC-O2C-06-01).
- **Bằng chứng:** ảnh Dashboard tách P&L + ảnh đối chiếu tổng.

### TC-O2C-04-06 — KHÔNG đóng băng: sửa chi phí sau Hoàn thành được phép

- **Mã PRD:** O2C Bước 4 (Trạng thái kết thúc — KHÔNG đóng băng) + Q18
- **Vai trò:** `ketoan`
- **Tiền điều kiện:** lô đã `Hoàn thành`.
- **Các bước:**
  1. `ketoan` mở lô `Hoàn thành`, sửa một chi phí, lưu.
  2. Kiểm tra flag AR/AP (TC-O2C-04-04) + audit log.
- **Kết quả mong đợi (Pass):**
  - Chi phí **vẫn sửa được** sau Hoàn thành (không read-only).
  - Sửa theo quy tắc Q18: bản điều chỉnh/hoàn tác, ghi lý do, lưu trước-sau, không ghi đè mất lịch sử.
  - Snapshot AR/AP bị flag "đã thay đổi".
- **Phụ thuộc:** Q18 đã accepted.
- **Bằng chứng:** ảnh form sửa (enabled) + ảnh audit log điều chỉnh.

### TC-O2C-04-07 — Lọc chu kỳ chốt (T1/T2/T3) trước khi xuất Debit Note

- **Mã PRD:** O2C Bước 4 (Lựa chọn kỳ chốt T1/T2/T3)
- **Vai trò:** `ketoan`
- **Các bước:**
  1. `ketoan` mở danh sách lô chờ chốt, chọn chu kỳ đối soát (vd T1 = tuần 1).
  2. Lọc và kiểm tra danh sách.
  3. Chuẩn bị xuất Debit Note.
- **Kết quả mong đợi (Pass):**
  - Bộ lọc theo chu kỳ hoạt động, danh sách đúng kỳ.
  - Chu kỳ áp dụng đúng quy tắc Q21 (giấy báo nợ theo chu kỳ thanh toán KH, mặc định tháng).
- **Phụ thuộc:** Q21 đã accepted.
- **Bằng chứng:** ảnh danh sách lọc theo T1 + ảnh Debit Note.

### TC-O2C-04-08 — Sửa dữ liệu đã duyệt: bản điều chỉnh, không sửa tại chỗ

- **Mã PRD:** O2C Bước 4 + Q18 (editing approved/locked data)
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Với chi phí đã duyệt, thử sửa trực tiếp.
  2. Tạo bản điều chỉnh với lý do.
- **Kết quả mong đợi (Pass):**
  - Không cho sửa tại chỗ; phải tạo bản điều chỉnh/hoàn tác.
  - Bắt buộc lý do, lưu giá trị trước/sau, người thực hiện + duyệt (3 tài khoản khác nhau theo Q11/Q15).
- **Phụ thuộc:** Q15, Q18.
- **Bằng chứng:** ảnh form điều chỉnh + ảnh audit.

---

## 6. Đối chiếu liên phân hệ (End-to-End)

Các ca này xác nhận dữ liệu chảy đúng qua toàn bộ chuỗi O2C. Chạy khi bất kỳ bước O2C nào đổi.

### TC-O2C-06-01 — Đối chiếu: lô → chuyến → chi phí → giấy báo nợ → AR

- **Mã PRD:** O2C toàn luồng + Q22 (source-of-truth)
- **Vai trò:** `ketoan`, `admin`
- **Các bước:**
  1. Chọn 1 lô đã `Hoàn thành` qua đủ 5 bước.
  2. Thu thập: chi tiết lô (`/shipments/:id`), chuyến (`/trips/:id`), chi phí (`/expenses`), giấy báo nợ (`/debt/:id` hoặc debit note), AR sau snapshot.
  3. So sánh tổng doanh thu + tổng chi phí + lợi nhuận.
- **Kết quả mong đợi (Pass):**
  - Tổng khớp qua 5 điểm (lô → chuyến → chi phí → debit note → AR).
  - Truy ngược được từ AR → chứng từ gốc (Q22).
- **Bằng chứng:** bảng so sánh 5 cột + ảnh từng màn.

### TC-O2C-06-02 — Đối chiếu: chi hộ → AP NCC + cấn trừ tạm ứng

- **Mã PRD:** O2C Bước 4 + Q08 + M06
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Lô `Hoàn thành` với chi hộ CÓ hóa đơn.
  2. Kiểm tra AP NCC (`/payables`) + cấn trừ tạm ứng (`/advances`).
- **Kết quả mong đợi (Pass):**
  - Chi hộ CÓ hóa đơn sinh AP đúng NCC.
  - Cấn trừ tạm ứng đúng số (TC-O2C-04-03).
  - Đối trừ AR↔AP chỉ theo Q08 (cùng pháp nhân, cùng tiền, có biên bản + duyệt, không tự động).
- **Phụ thuộc:** Q08.
- **Bằng chứng:** ảnh `/payables` + `/advances` + đối chiếu.

### TC-O2C-06-03 — Đối chiếu: tạm tính vs đã chốt trên Dashboard

- **Mã PRD:** O2C + M01-1.1 + Q22
- **Vai trò:** `admin`
- **Các bước:**
  1. Có 2 lô: 1 đang chạy (tạm tính), 1 đã Hoàn thành.
  2. Mở `/dashboard`, so sánh nhóm tạm tính vs đã chốt.
- **Kết quả mong đợi (Pass):**
  - Lô đang chạy → nhóm "Tạm tính"; lô Hoàn thành → nhóm đã chốt.
  - Đổi trạng thái → số tự chuyển nhóm đúng.
- **Bằng chứng:** ảnh dashboard 2 nhóm.

---

## 7. Trường hợp biên & ngoại lệ O2C

### TC-O2C-07-01 — Chuyến kẹp hàng: hủy 1 chiều giữa chừng

- **Mã PRD:** O2C Bước 2-3 + O01
- **Vai trò:** vai trò Điều vận, `laixe`
- **Các bước:**
  1. Kẹp 2 lệnh, 1 đang chạy.
  2. Hủy 1 lệnh (khách hủy).
- **Kết quả mong đợi (Pass):**
  - Lệnh còn lại tiếp tục, trạng thái & chi phí độc lập.
  - Chi phí đường (VETC) không bị nhân đôi/khấu hao sai.
- **Phụ thuộc:** O01.

### TC-O2C-07-02 — Mất kết nối khi Ops/Lái xe đẩy chi phí

- **Mã PRD:** O2C Bước 3 + HT-08
- **Vai trò:** `giaonhan`, `laixe`
- **Các bước:**
  1. Mở App ở nền, DevTools Offline.
  2. Tạo khoản chi hộ/chụp ảnh, bấm gửi.
  3. Bật Online lại.
- **Kết quả mong đợi (Pass):**
  - Thông báo mất kết nối tiếng Việt; dữ liệu đã nhập không mất.
  - Online lại → gửi thành công, không trùng (HT-04).
- **Bằng chứng:** ảnh toast offline + ảnh gửi lại thành công.

### TC-O2C-07-03 — Double-submit khi Kế toán bấm "Hoàn thành"

- **Mã PRD:** O2C Bước 4 + HT-04 + Q23
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Network Slow 3G.
  2. Bấm "Hoàn thành" 2 lần liên tiếp.
- **Kết quả mong đợi (Pass):**
  - Chỉ 1 lần chuyển trạng thái + 1 snapshot AR/AP.
  - Lần 2 trả kết quả đã có hoặc báo "đã hoàn thành".
- **Phụ thuộc:** Q23.
- **Bằng chứng:** ảnh Network 2 request + ảnh 1 bản ghi.

### TC-O2C-07-04 — Trạng thái cuối kỳ: chuyến chưa hoàn thành không tính số chính thức

- **Mã PRD:** O2C + Q20 (trip spanning periods)
- **Vai trò:** `admin`
- **Các bước:**
  1. Cuối kỳ có chuyến `Đang chạy`.
  2. Mở báo cáo kỳ.
- **Kết quả mong đợi (Pass):**
  - Chuyến chưa hoàn thành đánh dấu "Đang thực hiện", **không** tính vào số chính thức kỳ.
  - Doanh thu/lương/lợi nhuận ghi vào kỳ ngày hoàn thành (Q20).
- **Phụ thuộc:** Q20.

---

## 8. Ghi chú supersession (thay thế) so với tài liệu cũ

Quy trình O2C (01/08/2026) thay đổi một số quy tắc mà các tệp phân hệ cũ (viết trước 01/08) chưa phản
ánh. Khi chạy regression, **quy tắc O2C trong tệp này là chân lý mới** cho các điểm mâu thuẫn:

| Điểm | Tài liệu cũ | O2C mới (01/08/2026) | Hành động |
| ---- | ----------- | -------------------- | --------- |
| Trạng thái kết thúc | `… → Hoàn thành → Đã chốt / Đã khóa` (M01 §1.3) | Kết thúc ở `Hoàn thành`; **bỏ `Đã khóa`**; chi phí vẫn sửa được | Chạy TC-O2C-04-06; đánh dấu ca M01 cũ về `Đã khóa` là `@deprecated-superseeded-by-O2C` |
| Khóa cứng (Read-only) | Có ở M01/M11 | **Hoãn lại**, chỉ build khi khách yêu cầu | Không test tính năng khóa cứng |
| Push notification | Không giới hạn MVP | MVP chỉ Lái xe + Điều vận | Chạy TC-O2C-00-06 |
| Xóa Create-only | Không rõ phiên | Xóa được trong phiên hiện tại; phiên cũ cần duyệt; cấm xóa chi phí đã duyệt | Chạy TC-O2C-00-03/04/05 |

> Khi cập nhật [`01-module-01-overview-dispatch.md`](./01-module-01-overview-dispatch.md), bổ sung ghi
> chú `@superseded-by` cho các ca liên quan `Đã khóa`/`Đã chốt` và dẫn tới tệp này.

---

## 9. Bảng nghiệm thu

| Ngày thử | Mã TC        | Người thử | Kết quả (Pass/Fail/Blocked) | Lỗi ghi chú | Bằng chứng |
| -------- | ------------ | --------- | --------------------------- | ----------- | ---------- |
| __/__/__ | TC-O2C-00-01 |           |                             |             |            |
| __/__/__ | TC-O2C-00-02 |           |                             |             |            |
| __/__/__ | TC-O2C-00-03 |           |                             |             |            |
| __/__/__ | TC-O2C-00-04 |           |                             |             |            |
| __/__/__ | TC-O2C-00-05 |           |                             |             |            |
| __/__/__ | TC-O2C-00-06 |           |                             |             |            |
| __/__/__ | TC-O2C-01-01 |           |                             |             |            |
| __/__/__ | TC-O2C-01-02 |           |                             |             |            |
| __/__/__ | TC-O2C-01-03 |           |                             |             |            |
| __/__/__ | TC-O2C-01-04 |           |                             |             |            |
| __/__/__ | TC-O2C-01-05 |           |                             |             |            |
| __/__/__ | TC-O2C-02-01 |           |                             |             |            |
| __/__/__ | TC-O2C-02-02 |           |                             |             |            |
| __/__/__ | TC-O2C-02-03 |           |                             |             |            |
| __/__/__ | TC-O2C-02-04 |           |                             |             |            |
| __/__/__ | TC-O2C-02-05 |           |                             |             |            |
| __/__/__ | TC-O2C-02-06 |           |                             |             |            |
| __/__/__ | TC-O2C-03-01 |           |                             |             |            |
| __/__/__ | TC-O2C-03-02 |           |                             |             |            |
| __/__/__ | TC-O2C-03-03 |           |                             |             |            |
| __/__/__ | TC-O2C-03-04 |           |                             |             |            |
| __/__/__ | TC-O2C-03-05 |           |                             |             |            |
| __/__/__ | TC-O2C-03-06 |           |                             |             |            |
| __/__/__ | TC-O2C-04-01 |           |                             |             |            |
| __/__/__ | TC-O2C-04-02 |           |                             |             |            |
| __/__/__ | TC-O2C-04-03 |           |                             |             |            |
| __/__/__ | TC-O2C-04-04 |           |                             |             |            |
| __/__/__ | TC-O2C-04-05 |           |                             |             |            |
| __/__/__ | TC-O2C-04-06 |           |                             |             |            |
| __/__/__ | TC-O2C-04-07 |           |                             |             |            |
| __/__/__ | TC-O2C-04-08 |           |                             |             |            |
| __/__/__ | TC-O2C-06-01 |           |                             |             |            |
| __/__/__ | TC-O2C-06-02 |           |                             |             |            |
| __/__/__ | TC-O2C-06-03 |           |                             |             |            |
| __/__/__ | TC-O2C-07-01 |           |                             |             |            |
| __/__/__ | TC-O2C-07-02 |           |                             |             |            |
| __/__/__ | TC-O2C-07-03 |           |                             |             |            |
| __/__/__ | TC-O2C-07-04 |           |                             |             |            |

---

## 10. Tiêu chí nghiệm thu toàn phân hệ O2C-HT-01 … O2C-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ [`00-cross-cutting.md`](./00-cross-cutting.md) áp dụng trên màn hình của
O2C (`/shipments`, `/dispatch`, `/trips`, `/expenses`, `/debt`, `/payables`).

| Mã HT       | Nhóm kiểm tra    | Cách thử trên luồng O2C                                                                   | Kết quả | Bằng chứng |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------- | ------- | ---------- |
| O2C-HT-01   | Ngôn ngữ         | Duyệt `/shipments/new`, `/dispatch`, `/expenses/new`; thử lỗi (thiếu booking, sai VAT).   |         |            |
| O2C-HT-02   | Phân quyền       | `giaonhan`/`laixe` truy cập `/debt`, `/payables`; `CLERK` truy cập `/finance`.           |         |            |
| O2C-HT-03   | Nhật ký          | Tạo lô, điều xe, duyệt chi hộ, hoàn thành → xem `/audit-logs` đủ người/thời điểm/lý do.  |         |            |
| O2C-HT-04   | Tính toàn vẹn    | Double-submit: tạo lô, duyệt chi hộ, bấm Hoàn thành (Slow 3G).                           |         |            |
| O2C-HT-05   | Tiền tệ          | Tổng sau VAT trên lô khớp AR snapshot; phép cộng dòng = tổng.                             |         |            |
| O2C-HT-06   | Ngày giờ         | SLA timestamp Ops "có lệnh" vs Lái xe "nhận lệnh" đúng thứ tự giờ VN.                    |         |            |
| O2C-HT-07   | Thiết bị         | `/my-trips/:id`, `/my-forwarder-trips` trên iPhone SE (375×667).                          |         |            |
| O2C-HT-08   | Khôi phục lỗi    | Offline khi Ops/Lái xe đẩy chi phí; dữ liệu không mất (TC-O2C-07-02).                    |         |            |
| O2C-HT-09   | Tìm & xuất       | Lọc chu kỳ T1/T2/T3; xuất Debit Note đủ cột, đúng tổng.                                   |         |            |
| O2C-HT-10   | Đối chiếu liên   | TC-O2C-06-01/02/03 — lô↔chuyến↔chi phí↔debit note↔AR/AP khớp, truy ngược được.           |         |            |

> **Liên phân hệ cần chạy kèm khi O2C đổi:**
>
> - **M01 (Dashboard):** P&L tách Xe nhà/Xe ngoài phải khớp `/profit`.
> - **M03 (CUS):** cross-check lô và giấy báo nợ phải khớp AR snapshot.
> - **M04 (Chi hộ):** chi hộ pending và phân loại CÓ/KHÔNG hóa đơn.
> - **M05 (AR):** snapshot AR và phân bổ thanh toán.
> - **M06 (AP):** snapshot AP NCC + đối chiếu hóa đơn dầu cuối tháng (Q06).
> - **M07 (Lương):** cấn trừ tạm ứng Ops/Lái xe phải khớp `/advances`.
> - **M08/M09 (App):** nhận lệnh, push, chi phí hiện trường.
> - **M12 (Nhiên liệu):** bóc tách ảnh dầu → lợi nhuận gộp tức thời.
