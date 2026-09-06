# Luồng 3: Nhận lệnh & Kích hoạt chuyến — Lái xe (Driver)

> **Vai trò sở hữu:** Lái xe (DRIVER)
> **Tài khoản demo:** `laixe` (password: `Abc123`); dự phòng: `thu`, `pho`, `quyet`
> **Route chính:** `/my-trips`, `/my-trips/:id`, `/my-earnings`, `/my-payslips`, `/my-penalties`
> **Thiết bị mặc định:** Mobile (iPhone SE 375×667) — ứng dụng lái xe trên điện thoại
> **PRD nguồn:** Module 08 (`docs/prd/Module8.docx`), O2C Bước 3, TC-MO2C-05
>
> **Tổng quan luồng:** Lái xe nhận lệnh điều động từ Điều vận qua ứng dụng mobile, xem chi tiết
> lệnh (thời gian, tuyến, container, chứng từ), xác nhận nhận lệnh gốc để kích hoạt chuyến từ
> CREATED → IN_TRANSIT. Push notification cơ bản được cài cho Lái xe (MVP).

---

## 3.1 — Xem lệnh mới trên ứng dụng mobile

### TC-LX-NHANLENH-001 — Lái xe thấy lệnh mới và thông báo

- **Mã PRD:** M08-8.2, TC-MO2C-05
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile (375×667)
- **Tiền điều kiện:** Điều vận đã phát lệnh cho `laixe` (trip CREATED)
- **Các bước:**
  1. Đăng nhập `laixe` trên mobile. Mở `/my-trips`.
  2. Tìm lệnh mới. Bấm vào để xem chi tiết.
  3. Kiểm tra: chuyến, thời gian, tuyến, Booking/BL, container, xe, hướng dẫn, chứng từ đính kèm.
- **Kết quả mong đợi (Pass):**
  - Lệnh mới hiển thị trên `/my-trips` với trạng thái rõ ràng.
  - Có thông báo (in-app / push) khi lệnh mới được giao.
  - Chi tiết hiển thị đủ: thời gian, tuyến, điểm giao nhận, container, seal, hướng dẫn đóng/trả hàng.
  - Chứng từ đính kèm xem được trên mobile (PDF viewer thu nhỏ vừa màn).
  - Nhãn tiếng Việt, nút chạm ≥ 44px.
- **Kỳ vọng sai (Fail nếu):**
  - Lái xe không thấy lệnh.
  - Không có thông báo.
  - Thiếu thông tin container/thời gian/tuyến.
  - Chứng từ không xem được trên mobile.
- **Bằng chứng:** ảnh `/my-trips` + ảnh chi tiết lệnh + ảnh thông báo + ảnh PDF viewer

---

### TC-LX-NHANLENH-002 — Lái xe không có lệnh nào (empty state)

- **Mã PRD:** M08-8.1
- **Vai trò:** `laixe` (mới, chưa được điều động)
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Đăng nhập `laixe` mới (chưa có chuyến).
  2. Mở `/my-trips`.
- **Kết quả mong đợi (Pass):**
  - Hiển thị "Chưa có lệnh điều động" rõ ràng.
  - Không lỗi kỹ thuật (không stack-trace, không 500).
  - Empty state căn giữa, có icon, không vỡ bố cục.
- **Bằng chứng:** ảnh empty state

---

## 3.2 — Kích hoạt chuyến (ORDER_RECEIVED)

### TC-LX-NHANLENH-003 — Lái xe tự kích hoạt chuyến: CREATED → IN_TRANSIT

- **Mã PRD:** TC-MO2C-05, O2C Bước 3
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip ở trạng thái CREATED, đã gán cho `laixe`
- **Các bước:**
  1. Mở `/my-trips/:id` (trip CREATED).
  2. Bấm "Đã nhận lệnh gốc" (ORDER_RECEIVED).
  3. Ghi timestamp/version.
- **Kết quả mong đợi (Pass):**
  - **Chính lái xe** thực hiện kích hoạt — không cần Manager/Admin.
  - Trip chuyển từ CREATED → IN_TRANSIT.
  - Trạng thái lô (shipment) cũng chuyển sang "Đang chạy" (IN_TRANSIT).
  - Timestamp và audit được ghi nhận: người thực hiện, thời điểm.
  - Nút "Đã nhận lệnh gốc" chỉ bấm được 1 lần (disabled sau khi nhận).
- **Kỳ vọng sai (Fail nếu):**
  - Lái xe không thể tự kích hoạt (phải chờ Admin/Manager).
  - Trip không chuyển IN_TRANSIT.
  - Shipment không cập nhật trạng thái.
  - Không có timestamp/audit.
  - Nút vẫn bấm được sau khi đã nhận.
- **Bằng chứng:** ảnh trước/sau kích hoạt + timestamp + trạng thái trip/shipment

---

### TC-LX-NHANLENH-004 — Thử bấm nhận lệnh khi trip không ở trạng thái CREATED

- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Các bước:**
  1. Trip đã ở IN_TRANSIT (đã nhận lệnh rồi).
  2. Thử bấm lại "Đã nhận lệnh gốc" (nếu nút vẫn hiện).
- **Kết quả mong đợi (Pass):**
  - Nút disabled/ẩn hoặc thông báo "Lệnh đã được nhận".
  - Không thay đổi trạng thái.
- **Bằng chứng:** ảnh nút disabled + ảnh thông báo

---

## 3.3 — Xem chi tiết chuyến đang chạy

### TC-LX-NHANLENH-005 — Xem chi tiết chuyến IN_TRANSIT

- **Mã PRD:** M08-8.2
- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đã IN_TRANSIT
- **Các bước:**
  1. Mở `/my-trips/:id`.
  2. Kiểm tra hiển thị: trạng thái "Đang chạy", thông tin chuyến, container, thời gian, milestone tiếp theo.
- **Kết quả mong đợi (Pass):**
  - Trạng thái "Đang chạy" hiển thị rõ ràng.
  - Các milestone tiếp theo được hiển thị để lái xe biết cần làm gì.
  - Thông tin chuyến đầy đủ, cập nhật realtime.
- **Bằng chứng:** ảnh chi tiết chuyến đang chạy

---

## 3.4 — Phân quyền: Lái xe chỉ thấy lệnh của mình

### TC-LX-NHANLENH-006 — Lái xe A không xem được lệnh của Lái xe B

- **Mã PRD:** HT-02, M08-8.1
- **Vai trò:** `laixe` (A) vs `thu` (B)
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Các bước:**
  1. Đăng nhập `laixe` (A). Lấy ID chuyến của `thu` (B) từ DB hoặc URL.
  2. Mở trực tiếp `/my-trips/<id-của-thu>`.
- **Kết quả mong đợi (Pass):**
  - `laixe` A không xem được chi tiết chuyến của `thu`.
  - Redirect về `/my-trips` hoặc "Không có quyền".
  - API trả 403. Response body không lộ dữ liệu.
- **Bằng chứng:** ảnh redirect + Network 403

---

### TC-LX-NHANLENH-007 — Vai trò khác không vào được cổng lái xe

- **Mã PRD:** HT-02
- **Vai trò thử:** `ketoan`, `customer`, `cus`, `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `ketoan`. Mở `/my-trips`.
  2. Đăng nhập `customer`. Mở `/my-trips`.
  3. Đăng nhập `cus`. Mở `/my-trips`.
  4. Đăng nhập `giaonhan`. Mở `/my-trips`.
- **Kết quả mong đợi (Pass):**
  - Tất cả đều bị redirect về màn nhà của vai trò hoặc "Không có quyền".
  - Không lộ dữ liệu chuyến/lương/chứng từ.
- **Bằng chứng:** ảnh redirect cho từng vai trò

---

## 3.5 — Dữ liệu nguồn & Đồng bộ

### TC-LX-NHANLENH-008 — Điều vận đổi giờ chạy → Lái xe thấy cập nhật

- **Mã PRD:** M08-8.1, Q22
- **Vai trò:** `admin` (điều vận) + `laixe`
- **Mức độ:** P1
- **Các bước:**
  1. `admin` sửa giờ chạy chuyến từ 08:00 → 09:00 trên `/trips/:id`.
  2. `laixe` tải lại `/my-trips` và mở `/my-trips/:id`.
  3. So sánh giờ hiển thị.
- **Kết quả mong đợi (Pass):**
  - Giờ trên cổng lái xe cập nhật thành 09:00, khớp nguồn admin.
  - Có audit/time log cho thay đổi.
- **Bằng chứng:** ảnh admin + ảnh lái xe (cùng giờ)

---

## 3.6 — Trường hợp biên: Mạng & Responsive

### TC-LX-NHANLENH-009 — Mất mạng khi đang xem lệnh

- **Mã PRD:** HT-08
- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Đang xem `/my-trips/:id`. DevTools → Network → Offline.
  2. Bấm "Đã nhận lệnh gốc".
  3. Bật lại mạng. Bấm lại.
- **Kết quả mong đợi (Pass):**
  - Offline: thông báo lỗi tiếng Việt dễ hiểu, không crash.
  - Online lại: thao tác thành công.
  - Dữ liệu đã nhập không mất.
- **Bằng chứng:** ảnh toast offline + ảnh thành công online lại

---

### TC-LX-NHANLENH-010 — Responsive: xoay ngang, cỡ chữ lớn

- **Mã PRD:** HT-07, M08-8.1
- **Vai trò:** `laixe`
- **Mức độ:** P2
- **Thiết bị:** Mobile (375×667 + xoay ngang 667×375)
- **Các bước:**
  1. Mở `/my-trips/:id` ở dọc. Xoay ngang.
  2. Bật cỡ chữ lớn nhất hệ điều hành.
- **Kết quả mong đợi (Pass):**
  - Xoay ngang: nội dung không che, nút vẫn bấm được.
  - Cỡ chữ lớn: text không cắt, không tràn, không đè nhau.
- **Bằng chứng:** ảnh xoay ngang + ảnh cỡ chữ lớn

---

## 3.x — Cặp ghép KẸP / KẾT HỢP trên App Lái xe (đặc tả 2026-09-06)

> **Nguồn:** đặc tả khách hàng 2026-09-06 (PHẦN 2) + PRD `QuyTrinhO2C.md` Bước 3. Hai lệnh cont
> chung mã ghép chuyến hiển thị **2 thẻ dính liền kề nhau** + nhãn [KẸP]/[KẾT HỢP]; hàng kết hợp
> khóa tiến độ lệnh 2 đến khi lệnh 1 hoàn thành trả hàng.

### TC-LX-NHANLENH-011 — Cặp KẸP: 2 thẻ dính liền, chạy cùng nhau

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile (375×667)
- **Tiền điều kiện:** tài xế có cặp KẸP (2 lệnh 2×20', cùng xe) đã phát lệnh
- **Các bước:**
  1. Mở app → tab Lệnh mới / Đã nhận.
  2. Tìm 2 lệnh thuộc cặp KẸP.
- **Kết quả mong đợi (Pass):**
  - 2 thẻ hiển thị **dính liền kề nhau** (một khối combo), không tách rời trong danh sách.
  - Mỗi thẻ có nhãn **[KẸP]** cạnh số container; cùng biển số xe.
  - 2 thẻ độc lập thao tác (nhận lệnh từng thẻ) nhưng nhìn thấy là 1 combo.
- **Kỳ vọng sai (Fail nếu):** 2 thẻ rời rạc ở 2 vị trí; thiếu nhãn.
- **Bằng chứng:** ảnh danh sách + ảnh cụm 2 thẻ

### TC-LX-NHANLENH-012 — Cặp KẾT HỢP: lệnh 2 khóa đến khi lệnh 1 xong

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** tài xế có cặp KẾT HỢP; lệnh 1 chưa hoàn thành
- **Các bước:**
  1. Mở thẻ lệnh 2, thử bấm mốc "Lấy vỏ/hàng" (bắt đầu).
  2. Hoàn thành lệnh 1 (nộp e-POD + hoàn thành chuyến).
  3. Quay lại thẻ lệnh 2, bấm mốc bắt đầu.
- **Kết quả mong đợi (Pass):**
  - Lần 1: bị chặn, thông báo tiếng Việt kiểu "Cần hoàn thành trả hàng lệnh 1 trước khi bắt đầu lệnh 2".
  - Lần 2 (sau khi lệnh 1 hoàn thành): mở mốc bình thường.
  - 2 thẻ dính liền + nhãn [KẾT HỢP] như TC-011.
- **Kỳ vọng sai (Fail nếu):** lệnh 2 chạy được trước lệnh 1; sau lệnh 1 xong vẫn khóa.
- **Bằng chứng:** ảnh lỗi + ảnh mở khóa sau khi lệnh 1 xong

### TC-LX-NHANLENH-013 — Sau khi tách cặp (điều vận hủy), thẻ lùi về trạng thái thường

- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Các bước:**
  1. Điều vận hủy cặp (TC-DV-DISPATCH-039). Làm mới app.
- **Kết quả mong đợi (Pass):** 2 thẻ tách rời bình thường, hết nhãn [KẸP]/[KẾT HỢP], lệnh 2 (nếu có) không còn bị khóa theo lệnh 1.
- **Bằng chứng:** ảnh danh sách sau tách cặp

---

## 3.7 — Cấu trúc thẻ 2 lớp & điều hướng (đặc tả app lái xe 2026-08-27)

> **Nguồn:** `2026.8.27_Man_hinh_lai_xe.docx` · PRD
> [`docs/prd/ManHinhLaiXe.md`](../../docs/prd/ManHinhLaiXe.md) §1–§3.
>
> Bộ case này nghiệm thu **cấu trúc UI** mà đặc tả quy định chi tiết (Lớp 1 thẻ tổng
> quát, Lớp 2 thẻ chi tiết 7 khối, nút sticky, tab điều hướng) — phần chưa được phủ bởi
> các case luồng ở §3.1–§3.6.

### TC-LX-NHANLENH-014 — Điều hướng: 4 tab đáy + 3 tab con của "Hành trình"

- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Thiết bị:** Mobile (375 × 667)
- **Các bước:**
  1. Đăng nhập `laixe`. Quan sát thanh điều hướng đáy.
  2. Mở màn `Hành trình` (`/my-trips`). Quan sát các tab con.
  3. Bấm lần lượt từng tab con.
- **Kết quả mong đợi (Pass):**
  - Thanh đáy giữ đúng **4 tab** như thiết kế hiện tại (không thêm/bớt tab trong phase này).
  - Màn `Hành trình` có đúng **3 tab con** theo thứ tự: `Lệnh mới` | `Đã nhận` | `Lịch sử`.
  - Mỗi tab lọc đúng tập lệnh tương ứng; tab đang chọn có trạng thái active rõ ràng.
  - Thanh đáy tôn trọng `env(safe-area-inset-bottom)` — không bị notch/gesture bar che.
- **Kỳ vọng sai (Fail nếu):** sai số lượng/thứ tự tab; lệnh xuất hiện sai tab.
- **Bằng chứng:** ảnh thanh đáy + ảnh 3 tab con

---

### TC-LX-NHANLENH-015 — Lớp 1: thẻ tổng quát đủ 5 vùng, đúng căn lề

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile (375 × 667)
- **Tiền điều kiện:** tài xế có ≥ 1 lệnh đơn ở tab `Lệnh mới`
- **Các bước:**
  1. Mở tab `Lệnh mới`, đọc kỹ 1 thẻ.
  2. Đối chiếu từng vùng với PRD §2.1.
- **Kết quả mong đợi (Pass):** thẻ hiển thị đủ và đúng bố cục:
  | Vùng | Nội dung |
  |------|----------|
  | Header | `[Tag: ĐƠN]` + `Giờ đóng / trả: HH:MM - DD/MM` |
  | Dòng 1 | `Nhà máy` **căn lề trái** · `Cảng nâng` **căn lề phải** |
  | Dòng 2 | `Tuyến đường` **căn lề trái** · `Cảng hạ` **căn lề phải** |
  | Dòng 3 | `Cont: [Số Cont] - [Loại cont]` (ví dụ `40'HC`) |
  | Footer | `Xem chi tiết & Nhận lệnh` |
  - Mỗi **container** là **một thẻ** riêng (không gộp nhiều cont vào 1 thẻ).
  - Không cuộn ngang; cỡ chữ đọc được ngoài nắng.
- **Kỳ vọng sai (Fail nếu):** thiếu vùng bất kỳ; sai căn lề trái/phải; thiếu tag hoặc giờ đóng/trả; gộp cont.
- **Bằng chứng:** ảnh thẻ có chú thích từng vùng

---

### TC-LX-NHANLENH-016 — Lớp 2: thẻ chi tiết đủ 7 khối

- **Vai trò:** `laixe`
- **Mức độ:** **P0**
- **Thiết bị:** Mobile
- **Tiền điều kiện:** lệnh có nhà máy đã cấu hình hoá đơn nâng/hạ, hoá đơn vệ sinh,
  `note dành cho lái xe`, và người phụ trách kho bãi kèm số điện thoại
- **Các bước:**
  1. Bấm vào thẻ ở tab `Lệnh mới` → mở **toàn màn hình**.
  2. Cuộn hết màn, đối chiếu 7 khối với PRD §2.2.
- **Kết quả mong đợi (Pass):** đủ 7 khối, đúng nội dung:
  | Khối | Phải có |
  |------|---------|
  | 1 — Lộ trình | `Tuyến đường`, `Nhà máy`, `Cảng nâng`, `Cảng hạ` |
  | 2 — Hàng hoá | `Loại Cont`, `Số Cont`, `Số Chì` + nút `📷 Chụp ảnh Cont/Chì` |
  | 3 — Liên hệ | Tên người phụ trách kho bãi + **số điện thoại bấm gọi được** |
  | 4 — Hoá đơn | Thông tin xuất HĐ nâng / hạ + HĐ vệ sinh |
  | 5 — Quy định điểm làm hàng | Nội dung lấy từ `note dành cho lái xe` của nhà máy |
  | 6 — Thông tin xe | `Biển số Đầu kéo` + `Biển số Mooc` |
  | 7 — Thao tác | Nút `Nhận lệnh vận chuyển` |
  - Khối 4 lấy từ master data nhà máy (`liftFeeInvoice*`, `dropFeeInvoice*`, `cleaningInvoice*`); Khối 5 lấy từ `strictRules`.
  - Trường không có dữ liệu hiển thị `—`, **không** hiện `null` / `undefined` / ô trống không nhãn.
- **Kỳ vọng sai (Fail nếu):** thiếu khối bất kỳ; khối 4/5 lấy sai nguồn; hiện `null`.
- **Bằng chứng:** ảnh cuộn full màn chi tiết (nối ảnh) có đánh số 7 khối

---

### TC-LX-NHANLENH-017 — Khối 7: nút "Nhận lệnh vận chuyển" sticky đáy màn

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile (375 × 667 — màn ngắn để ép cuộn)
- **Các bước:**
  1. Mở thẻ chi tiết. Ghi vị trí nút `Nhận lệnh vận chuyển`.
  2. Cuộn xuống đáy, rồi cuộn ngược lên đầu.
- **Kết quả mong đợi (Pass):**
  - Nút **ghim cố định ở đáy màn hình**, **luôn nhìn thấy** ở mọi vị trí cuộn.
  - Nút không bị nội dung đè lên; chiều cao chạm ≥ 48 px.
  - Tôn trọng `env(safe-area-inset-bottom)`.
  - Nội dung cuối trang không bị nút che khuất (có padding đáy bù).
- **Kỳ vọng sai (Fail nếu):** phải cuộn xuống đáy mới thấy nút; nút che mất nội dung cuối.
- **Bằng chứng:** ảnh ở 3 vị trí cuộn (đầu / giữa / cuối)

---

### TC-LX-NHANLENH-018 — Khối 2: chụp ảnh Cont/Chì có timestamp

- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile (camera thật hoặc giả lập)
- **Các bước:**
  1. Ở thẻ chi tiết, bấm `📷 Chụp ảnh Cont/Chì`, chụp 1 ảnh.
  2. Xem lại ảnh vừa tải trong lệnh.
  3. Đối chiếu thời điểm chụp với đồng hồ thiết bị.
- **Kết quả mong đợi (Pass):**
  - Mở được camera trực tiếp (không chỉ chọn từ thư viện).
  - Ảnh lưu kèm **timestamp thực tế lúc chụp**, hiển thị được khi xem lại.
  - Timestamp khớp giờ thiết bị theo `Asia/Ho_Chi_Minh` (lệch ≤ 1 phút).
- **Kỳ vọng sai (Fail nếu):** ảnh không có timestamp; timestamp là giờ upload thay vì giờ chụp; sai múi giờ.
- **Bằng chứng:** ảnh đã tải kèm timestamp + ảnh đồng hồ thiết bị

---

### TC-LX-NHANLENH-019 — Module chi phí ẩn sau feature flag (phase này)

- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Các bước:**
  1. Rà toàn bộ app lái xe (4 tab + thẻ chi tiết + luồng hoàn thành chuyến).
  2. Tìm form `Nhập chi phí lô hàng` và form `Báo cáo đổ dầu`.
  3. Kiểm tra schema DB bảng `trips`.
- **Kết quả mong đợi (Pass):**
  - **Frontend không render** cả 2 form ở bất kỳ đâu trong phase này.
  - Không có nút/menu dẫn tới chúng; không có route lộ ra khi gõ URL trực tiếp.
  - **Backend/DB đã có sẵn** cột/bảng quan hệ để lưu: `Tiền nâng`, `Tiền hạ`, `Chi phí phát sinh`, `Tiền đường`, `Xăng dầu`, `Hình ảnh biên lai`.
- **Kỳ vọng sai (Fail nếu):** form chi phí/đổ dầu hiện ra; hoặc DB thiếu cột đã cam kết cho phase sau.
- **Bằng chứng:** ảnh 4 tab + kết quả `\d trips` (hoặc schema dump)

---

### TC-LX-NHANLENH-020 — Bypass Ops: nhận lệnh ngay khi Điều vận gán xe

- **Vai trò:** `dieuvan` → `laixe`
- **Mức độ:** **P0** (quy tắc phase này)
- **Các bước:**
  1. `dieuvan` gán biển số xe cho một lệnh của `laixe`.
  2. `laixe` mở app **không** thao tác gì thêm.
  3. Bấm `Nhận lệnh vận chuyển` ngay.
- **Kết quả mong đợi (Pass):**
  - App bắn **Push Notification** ngay khi điều vận gán xe xong.
  - Thẻ xuất hiện ở tab `Lệnh mới`.
  - **Không** có bước xác nhận nào của Ops chắn giữa — lái xe nhận lệnh được ngay.
  - Bấm nhận ⇒ ghi **Timestamp bắt đầu chạy** ⇒ thẻ chuyển sang tab `Đã nhận`.
- **Kỳ vọng sai (Fail nếu):** thẻ kẹt chờ Ops xác nhận; không có push; không ghi timestamp bắt đầu.
- **Bằng chứng:** ảnh push + ảnh thẻ 2 tab trước/sau + giá trị timestamp trong DB

---

## Bảng nghiệm thu — Luồng Nhận lệnh (Lái xe)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-LX-NHANLENH-001 | | | Xem lệnh mới | |
| __/__/__ | TC-LX-NHANLENH-002 | | | Empty state | |
| __/__/__ | TC-LX-NHANLENH-003 | | | Kích hoạt ORDER_RECEIVED | |
| __/__/__ | TC-LX-NHANLENH-004 | | | Nhận lại lệnh đã nhận | |
| __/__/__ | TC-LX-NHANLENH-005 | | | Chi tiết IN_TRANSIT | |
| __/__/__ | TC-LX-NHANLENH-006 | | | RBAC lái xe vs lái xe | |
| __/__/__ | TC-LX-NHANLENH-007 | | | RBAC vai trò khác | |
| __/__/__ | TC-LX-NHANLENH-008 | | | Đồng bộ dữ liệu | |
| __/__/__ | TC-LX-NHANLENH-009 | | | Offline | |
| __/__/__ | TC-LX-NHANLENH-010 | | | Responsive | |
| __/__/__ | TC-LX-NHANLENH-011 | | | Cặp KẸP 2 thẻ dính liền | |
| __/__/__ | TC-LX-NHANLENH-012 | | | KẾT HỢP khóa nối tiếp | |
| __/__/__ | TC-LX-NHANLENH-013 | | | Tách cặp → thẻ thường | |
| __/__/__ | TC-LX-NHANLENH-014 | | | 4 tab đáy + 3 tab con | |
| __/__/__ | TC-LX-NHANLENH-015 | | | Lớp 1: thẻ tổng quát 5 vùng | |
| __/__/__ | TC-LX-NHANLENH-016 | | | Lớp 2: thẻ chi tiết 7 khối (P0) | |
| __/__/__ | TC-LX-NHANLENH-017 | | | Nút sticky đáy màn | |
| __/__/__ | TC-LX-NHANLENH-018 | | | Ảnh Cont/Chì có timestamp | |
| __/__/__ | TC-LX-NHANLENH-019 | | | Module chi phí ẩn, DB sẵn cột | |
| __/__/__ | TC-LX-NHANLENH-020 | | | Bypass Ops, nhận lệnh ngay (P0) | |
