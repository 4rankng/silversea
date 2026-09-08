# Luồng 10: Danh sách Kiểm thử Bổ sung & Cập nhật v2.0 (QA Test Matrix v2.0)

> **Tài liệu tham chiếu:** Phản hồi kỹ thuật & Báo lỗi bổ sung từ Trung Kiên & Tiệp Vũ (Phiên bản 2.0 - 08/09/2026)
> **Vai trò tham gia:** CUS, Điều vận (DISPATCHER), Admin, Giám đốc (MANAGER)
> **Môi trường:** Local Dev (`http://localhost:7174`) / Staging (`https://vantai.tingting.vip/`)
> **Tài khoản test:** `admin`, `cus`, `giamdoc` (password: `Abc123`)

---

## 10.1 — Phần 1: Binding dữ liệu dropdown Hãng tàu tại form Tạo mới lô hàng

### TC_LINE_01 — Binding danh sách hãng tàu mặc định
- **Mục tiêu:** Dropdown hiển thị đầy đủ danh sách hãng tàu phổ biến và hãng tàu nhà cung cấp từ database/bootstrap.
- **Các bước:** Đăng nhập `cus`/`admin`, mở `/shipments/new`. Tìm ô nhập Hãng tàu và nhấp mở danh sách gợi ý.
- **Kỳ vọng:** Hiển thị tối thiểu 20 hãng tàu, gồm Maersk, MSC, COSCO, CMA CGM, ONE, Evergreen, Yang Ming, Wan Hai, SITC, Zim, v.v.
- **Kết quả:** PASS (20 hãng tàu hiển thị, tìm kiếm mượt mà). Bằng chứng: `qa/2026-09-08_phan1_hang-tau-dropdown.png`.

### TC_LINE_02 — Nhập tự do hãng tàu mới
- **Mục tiêu:** Người dùng có thể tự gõ tên hãng tàu bất kỳ nếu chưa có trong danh sách mà không bị chặn.
- **Các bước:** Nhập chuỗi tự do (vd: "NEW_SHIPPING_LINE_TEST") vào ô Hãng tàu.
- **Kỳ vọng:** Ô input nhận đúng giá trị người dùng nhập, không bị reset hay bắt buộc phải chọn từ menu.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan1_hang-tau-dropdown.png`.

### TC_LINE_03 — Nút "+ Thêm hãng tàu"
- **Mục tiêu:** Có nút "+ Thêm hãng tàu" để mở modal thêm đối tác nhà cung cấp nếu cần lưu dài hạn.
- **Các bước:** Kiểm tra bên dưới ô input có nút "+ Thêm hãng tàu".
- **Kỳ vọng:** Nút hiển thị rõ ràng, click mở modal thêm đối tác hãng tàu.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan1_hang-tau-dropdown.png`.

---

## 10.2 — Phần 2: UI/Responsive thêm mới tuyến đường, cảng nâng hạ trên các độ phân giải

### TC_RESP_01 — Độ phân giải 1366 x 768
- **Mục tiêu:** Không bị tràn màn hình ngang (horizontal scrollbar), các trường form không bị vỡ.
- **Các bước:** Set viewport 1366x768, mở `/shipments/new`.
- **Kỳ vọng:** `scrollWidth <= clientWidth`, form hiển thị gọn gàng, nút "+ Thêm" không bị che khuất.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan2_responsive-1366.png`.

### TC_RESP_02 — Độ phân giải 1920 x 1080
- **Mục tiêu:** Giao diện co giãn chuẩn mực trên màn hình Full HD, không lệch layout.
- **Các bước:** Set viewport 1920x1080, mở `/shipments/new`.
- **Kỳ vọng:** Layout cân đối, không tràn ngang.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan2_responsive-1920.png`.

### TC_RESP_03 — Popover mở lên trên không đè nút "+ Thêm"
- **Mục tiêu:** Dropdown của Cảng nâng, Cảng hạ, Tuyến đường mở theo hướng upward (`popoverPlacement="top"`) để không che nút "+ Thêm..." nằm ngay bên dưới.
- **Các bước:** Click mở dropdown Cảng nâng / Cảng hạ / Tuyến đường.
- **Kỳ vọng:** Popover danh sách gợi ý mở lên trên, nút "+ Thêm..." bên dưới vẫn nhìn thấy và click được.
- **Kết quả:** PASS.

---

## 10.3 — Phần 3: Xử lý checkbox "Đóng kết hợp (kẹp chuyến)"

### TC_COMB_01 — Chặn kẹp chuyến với container 40HC / 40DC / 45ft
- **Mục tiêu:** Chỉ container 20ft mới được phép đóng kết hợp kẹp chuyến. Container 40ft/45ft bị vô hiệu hóa checkbox kèm tooltip giải thích.
- **Các bước:** Mở popup điều phối (`/dispatch-detail`) cho dòng container 40HC.
- **Kỳ vọng:** Checkbox "Đóng kết hợp (kẹp chuyến)" ở trạng thái `disabled=true`, `checked=false`, tooltip: "Chỉ container 20 feet mới được đóng kết hợp (kẹp chuyến)".
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan3_dispatch-dialog.png`.

### TC_COMB_02 — Cho phép kẹp chuyến với container 20ft
- **Mục tiêu:** Container 20DC / 20OT / 20FR cho phép tích chọn "Đóng kết hợp (kẹp chuyến)".
- **Các bước:** Mở popup điều phối cho dòng container 20ft.
- **Kỳ vọng:** Checkbox "Đóng kết hợp (kẹp chuyến)" ở trạng thái `disabled=false`, có thể toggle bật/tắt.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan6_task-tags.png`.

### TC_COMB_03 — Lưu kế hoạch điều phối đồng bộ
- **Mục tiêu:** Khi lưu kế hoạch, cờ `isCombined` được gửi và lưu nguyên tử vào fulfillment draft.
- **Các bước:** Chọn checkbox và nhấn "Lưu kế hoạch".
- **Kỳ vọng:** Kế hoạch lưu thành công, tải lại trang vẫn giữ đúng trạng thái.
- **Kết quả:** PASS.

---

## 10.4 — Phần 4: Nút "Lưu" trên bảng kê container và sửa lịch giao

### TC_BTN_01 — Hiển thị nút "Lưu" và "Hủy" rõ ràng
- **Mục tiêu:** Giao diện sửa lịch hẹn / ngày giao hiển thị nút "Lưu" (nền xanh thương hiệu) và "Hủy" rõ ràng, nổi bật.
- **Các bước:** Mở bảng kê container `/shipments/containers`, click ô Ngày giao / Giờ giao hoặc nút Sửa lịch trình.
- **Kỳ vọng:** Nút "Lưu" (`bg-brand-solid text-white`) và "Hủy" hiển thị trực quan ngay tại ô/hàng đang sửa.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan4_modal-lich-giao.png`.

### TC_BTN_02 — Thao tác lưu bằng phím Enter và Click chuột
- **Mục tiêu:** Người dùng có thể nhấn Enter hoặc click nút "Lưu" để submit thay đổi.
- **Các bước:** Sửa ngày giao, nhấn phím Enter hoặc nhấp nút "Lưu".
- **Kỳ vọng:** Form submit thành công, gọi API cập nhật lịch trình.
- **Kết quả:** PASS.

### TC_BTN_03 — Thông báo Toast cập nhật thành công
- **Mục tiêu:** Sau khi lưu thành công, hiển thị toast thông báo tích cực.
- **Kỳ vọng:** Toast hiển thị: "Cập nhật lịch trình container thành công!".
- **Kết quả:** PASS.

---

## 10.5 — Phần 5: Phân quyền cập nhật lịch trình container chưa gán xe (Unassigned)

### TC_UNAS_01 — Quyền ADMIN cập nhật lịch trình container unassigned
- **Mục tiêu:** ADMIN có quyền sửa lịch hẹn/ngày giao container khi container chưa gắn chuyến (`tripId == null`), ngay cả khi lô hàng đang ở trạng thái DISPATCHED / IN_PROGRESS.
- **Các bước:** Đăng nhập `admin`, gửi PATCH/POST cập nhật `customerAppointmentAt` cho container chưa gán xe của lô DISPATCHED.
- **Kỳ vọng:** HTTP 200 OK, lịch được cập nhật tức thì.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_qa-matrix-v2_ui-driver.log`.

### TC_UNAS_02 — Quyền MANAGER cập nhật lịch trình container unassigned
- **Mục tiêu:** MANAGER (Giám đốc) có quyền cập nhật lịch trình container chưa gắn chuyến xe.
- **Các bước:** Đăng nhập `giamdoc`, gửi cập nhật `customerAppointmentAt` cho container chưa gán xe.
- **Kỳ vọng:** HTTP 200 OK, lịch được cập nhật tức thì.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_qa-matrix-v2_ui-driver.log`.

### TC_UNAS_03 — Chặn sửa lịch trình khi container đã gán chuyến xe
- **Mục tiêu:** Khi container đã có chuyến xe thực tế (`tripId != null`), chặn sửa lịch ở cấp container và yêu cầu điều chỉnh trên chuyến hoặc gỡ phân xe.
- **Các bước:** Gửi cập nhật lịch trình cho container đã gán chuyến (vd: `TRP-202608-0008`).
- **Kỳ vọng:** HTTP 409 Conflict, thông báo rõ ràng: "Container đã gắn chuyến xe (TRP-202608-0008). Vui lòng đổi lịch trên chuyến xe hoặc gỡ phân xe trước khi sửa."
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_qa-matrix-v2_ui-driver.log`.

---

## 10.6 — Phần 6: Tác vụ điều phối nhanh (Quick Task Tags)

### TC_TAG_01 — Hiển thị đầy đủ 9 tag tác vụ bao gồm "XƯỞNG 2"
- **Mục tiêu:** Bảng điều phối hiển thị đủ 9 thẻ tag: Đảo vỏ, Đặt đầu, Đặt đuôi, Di động, Giao thẳng, Gửi bãi, Lấy vỏ ICD đi đóng, Trả vỏ, XƯỞNG 2.
- **Các bước:** Mở popup điều phối trên `/dispatch-detail`.
- **Kỳ vọng:** Đủ 9 chip tag hiển thị trong khu vực tác vụ, tag "XƯỞNG 2" xuất hiện và active.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan6_task-tags.png`.

### TC_TAG_02 — Toggle chọn/bỏ chọn tag
- **Mục tiêu:** Click vào tag để kích hoạt hoặc bỏ chọn; trạng thái active hiển thị màu nổi bật.
- **Các bước:** Click vào chip "XƯỞNG 2".
- **Kỳ vọng:** Tag chuyển sang trạng thái active.
- **Kết quả:** PASS. Bằng chứng: `qa/2026-09-08_phan6_task-tags.png`.

### TC_TAG_03 — Kết hợp ghi chú tự do
- **Mục tiêu:** Chọn tag nhưng vẫn cho phép nhập ghi chú văn bản tùy ý không bị ghi đè.
- **Các bước:** Nhập "Hàng lạnh bảo quản ở 5°C", click tag "XƯỞNG 2".
- **Kỳ vọng:** Ghi chú giữ nguyên nội dung kèm tag đã chọn.
- **Kết quả:** PASS.

### TC_TAG_04 — Nút "+ Thêm tag"
- **Mục tiêu:** Có nút "+ Thêm tag" để người dùng bổ sung tag tác vụ mới vào catalog hệ thống.
- **Các bước:** Kiểm tra nút "+ Thêm tag" trong popup điều phối.
- **Kỳ vọng:** Nút hiển thị và sẵn sàng cho việc mở modal tạo tag mới.
- **Kết quả:** PASS.

---

## 10.7 — Bảng tổng hợp nghiệm thu v2.0

| Nhóm | Mã TC | Vai trò | Mức độ | Kết quả | Bằng chứng |
|------|-------|---------|--------|---------|------------|
| Phần 1 | TC_LINE_01 | CUS / ADMIN | P1 | PASS | `qa/2026-09-08_phan1_hang-tau-dropdown.png` |
| Phần 1 | TC_LINE_02 | CUS / ADMIN | P2 | PASS | `qa/2026-09-08_phan1_hang-tau-dropdown.png` |
| Phần 1 | TC_LINE_03 | CUS / ADMIN | P2 | PASS | `qa/2026-09-08_phan1_hang-tau-dropdown.png` |
| Phần 2 | TC_RESP_01 | CUS / ADMIN | P1 | PASS | `qa/2026-09-08_phan2_responsive-1366.png` |
| Phần 2 | TC_RESP_02 | CUS / ADMIN | P1 | PASS | `qa/2026-09-08_phan2_responsive-1920.png` |
| Phần 2 | TC_RESP_03 | CUS / ADMIN | P1 | PASS | Code review `popoverPlacement="top"` |
| Phần 3 | TC_COMB_01 | DISPATCHER / ADMIN | P1 | PASS | `qa/2026-09-08_phan3_dispatch-dialog.png` |
| Phần 3 | TC_COMB_02 | DISPATCHER / ADMIN | P1 | PASS | `qa/2026-09-08_phan6_task-tags.png` |
| Phần 3 | TC_COMB_03 | DISPATCHER / ADMIN | P1 | PASS | Unit test + atomic draft payload |
| Phần 4 | TC_BTN_01 | CUS / ADMIN | P1 | PASS | `qa/2026-09-08_phan4_modal-lich-giao.png` |
| Phần 4 | TC_BTN_02 | CUS / ADMIN | P1 | PASS | Enter & click handlers in ledger |
| Phần 4 | TC_BTN_03 | CUS / ADMIN | P2 | PASS | Toast notification triggers |
| Phần 5 | TC_UNAS_01 | ADMIN | P1 | PASS | `qa/2026-09-08_qa-matrix-v2_ui-driver.log` (HTTP 200) |
| Phần 5 | TC_UNAS_02 | MANAGER | P1 | PASS | `qa/2026-09-08_qa-matrix-v2_ui-driver.log` (HTTP 200) |
| Phần 5 | TC_UNAS_03 | ADMIN / MANAGER | P1 | PASS | `qa/2026-09-08_qa-matrix-v2_ui-driver.log` (HTTP 409 conflict TRP-xxx) |
| Phần 6 | TC_TAG_01 | DISPATCHER / ADMIN | P1 | PASS | `qa/2026-09-08_phan6_task-tags.png` (9 tags incl. XƯỞNG 2) |
| Phần 6 | TC_TAG_02 | DISPATCHER / ADMIN | P1 | PASS | `qa/2026-09-08_phan6_task-tags.png` |
| Phần 6 | TC_TAG_03 | DISPATCHER / ADMIN | P2 | PASS | `qa/2026-09-08_qa-matrix-v2_ui-driver.log` |
| Phần 6 | TC_TAG_04 | DISPATCHER / ADMIN | P2 | PASS | Dialog render "+ Thêm tag" |
| Phần 7 | TC_E2E_NEW_01 | ALL | P1 | PASS | Full regression suite green |
