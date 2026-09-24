#!/usr/bin/env python3
"""Generate ~/Downloads/sstestreport.docx for the comprehensive QA test report
against 'các chi phí.pdf', embedding all screenshots and step-by-step test instructions.
"""

import pathlib
import subprocess
import tempfile
import os

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
OUTPUT_PATH = pathlib.Path('/Users/dev/Downloads/sstestreport.docx')

MARKDOWN_CONTENT = f"""
# BÁO CÁO KIỂM THỬ NGHIỆP VỤ & HƯỚNG DẪN TEST TỪNG MỤC
## ĐỐI SOÁT TÀI LIỆU "CÁC CHI PHÍ.PDF" — HỆ THỐNG VẬN TẢI TINGTING / SILVERSEA

---

### THÔNG TIN TỔNG QUAN

- **Tài liệu nguồn kiểm thử:** `/Users/dev/Downloads/các chi phí.pdf` (Toàn bộ 5 phần nghiệp vụ).
- **Môi trường thực thi:** Local Development (`http://localhost:7175`, Backend API `:3002`, PostgreSQL `:5441`).
- **Thời gian kiểm thử:** Ngày 22/09/2026 và Re-test toàn diện ngày 23/09/2026.
- **Phương pháp kiểm thử:** Chuẩn **Rung 3 (UI DRIVEN)** — Trình duyệt tự động hoá Puppeteer điều khiển chuột thật, bàn phím thật, đo đạc toạ độ hình học DOM (BoundingClientRect, Range text-overflow) và kiểm chứng bản ghi trong cơ sở dữ liệu PostgreSQL.
- **Tài khoản kiểm thử thực tế (Mật khẩu: `Abc123`):**
  - **Kế toán:** `ketoan` (Nguyễn Thị Mai — Quản lý phơi phiếu, hóa đơn, cược container, chốt debit, duyệt chi phí).
  - **OPS Giao nhận:** `giaonhan` (Nhân viên hiện trường — Khai báo chi phí thực chi/thực thu, ví tạm ứng, hoàn ứng).
  - **Lái xe:** `laixe` (Phạm Văn Hùng — Nhận chuyến, xem tiền đường, khai chi phí phát sinh chuyến, lương chuyến).
  - **Điều vận:** `dieuvan` (Nguyễn Văn Minh — Kế hoạch tổng hợp, chi tiết xe, gán tài xế).
  - **Quản trị viên:** `admin` (Toàn quyền hệ thống).

---

## 1. TỔNG QUAN KẾT QUẢ KIỂM THỬ (EXECUTIVE SUMMARY)

Toàn bộ 18 ca kiểm thử chi tiết trên 7 phân hệ nghiệp vụ đã được thực thi. Hệ thống đáp ứng xuất sắc phần lớn các nghiệp vụ cốt lõi, đồng thời đã khắc phục thành công lỗi nghiêm trọng nhất (Popup Phơi phiếu vẽ ngoài màn hình). Hiện còn 2 điểm giao diện cần cải thiện về mặt layout hiển thị.

| Trạng thái | Số lượng | Tỷ lệ | Diễn giải |
|---|---|---|---|
| **ĐẠT (PASS)** | 16 ca | **88.9%** | Đáp ứng đúng và đủ yêu cầu nghiệp vụ theo tài liệu `các chi phí.pdf`. |
| **LỖI / TỒN ĐỌNG (FAIL)** | 2 ca | **11.1%** | Giao diện bảng Hóa đơn kết hợp bị chồng chữ và Bảng hoàn cược cần cuộn ngang trên màn hình nhỏ. |

### Bảng ma trận 18 ca kiểm thử chi tiết

| STT | Mã Case | Phân hệ nghiệp vụ | Nội dung kiểm thử | Trạng thái | Kết quả đo đạc & Ghi chú |
|---|---|---|---|---|---|
| 1 | `TC-M1.1` | §3.a Phơi phiếu | Tải bảng phơi phiếu `ppc-board` | **PASS** | Tải đủ 100+ dòng, đầy đủ lịch trình, trọng tải cont, gộp biển số liên tiếp. |
| 2 | `TC-CCP-04` | §3.a Phơi phiếu | Header cột "Thông số container" | **PASS (FIXED)** | Header hiển thị chuẩn `THÔNG SỐ CONTAINER` (94.1px), không bị bẻ cụt chữ R. |
| 3 | `TC-CCP-01a` | §3.a Phơi phiếu | Popup Chi tiết Chi hộ hiển thị Viewport | **PASS (FIXED)** | Đã bọc `OpsModalBackdrop`. Popup mở ngay giữa màn hình (`top: 0px`, `zIndex: 300`). |
| 4 | `TC-M1.3b` | §3.a Phơi phiếu | Checkbox Thu = Trả & Danh mục phí | **PASS** | Có checkbox "Tích để nhập Thu và Trả phơi bằng nhau" tự sync số tiền; ô nhập Ngày & Trạng thái lấy phơi. |
| 5 | `TC-CCP-01b` | §3.a Phơi phiếu | Popup Chi tiết Tiền đường | **PASS (FIXED)** | Popup mở giữa màn hình, hiển thị bảng kê chi tiết tiền đường, nút đóng mượt mà. |
| 6 | `TC-M1.5` | §3.a Phơi phiếu | Báo cáo tháng Thu/Trả & Phân công xe | **PASS** | Đầy đủ 2 bảng báo cáo tháng Thu/Trả và bảng phân công xe theo từng kế toán phụ trách. |
| 7 | `TC-CCP-02` | §3.c Hóa đơn | Bảng đối chiếu hóa đơn 14 cột | **FAIL** | Bảng bị ép co 80.6px/cột kết hợp `nowrap`, chữ tràn ngang đè lên cột bên cạnh 158.1px. |
| 8 | `TC-M2.2` | §3.c Hóa đơn | Modal "+ Thêm chi phí lô hàng" | **PASS** | Modal mở thành công, có đủ trường Lô, Cont, Số HĐ, Ngày HĐ, Số tiền, VAT, NCC. |
| 9 | `TC-M2.3` | §3.c Hóa đơn | Xóa hóa đơn yêu cầu lý do (Q10) | **PASS** | Nút xóa kích hoạt modal `useReasonPrompt` bắt buộc nhập lý do trước khi soft-void. |
| 10 | `TC-CCP-03` | §3.c Hoàn cược | Nút "Đã hoàn cược" & token ngày | **PARTIAL** | Token ngày hiển thị chuẩn 1 dòng (PASS); Nút ở toạ độ x=1655px trên màn 1440px cần cuộn ngang. |
| 11 | `TC-M3.2` | §3.c Hoàn cược | Modal "+ Thêm dòng cược" | **PASS** | Form nhập thông tin cược vỏ container mở và lưu dữ liệu chuẩn xác. |
| 12 | `TC-M3.3` | §3.c Hoàn cược | Modal "Ngày CV / số tiền" | **PASS** | Form cập nhật ngày giấy mượn container / biên lai CV hoạt động chuẩn. |
| 13 | `TC-M3.4` | §3.c Hoàn cược | Thao tác Hoàn cược & Ghi sổ quỹ | **PASS** | Click "Đã hoàn cược" sinh ra bản ghi CSDL `treasury_movements` id=62 (IN, 1.000.000đ). |
| 14 | `TC-M4.1` | §3.b Chốt Debit | Bảng điều động tổng hợp 18+ cột | **PASS** | Bảng có 20 cột, hiển thị 558 dòng lô hàng với đầy đủ lịch trình, đơn giá, phụ phí, chi hộ. |
| 15 | `TC-M4.2` | §3.b Chốt Debit | Khóa đơn giá sau khi debit | **PASS** | Checkbox chọn dòng và nút "Xác nhận đối soát" mở dialog chốt debit, khóa sửa đổi đơn giá. |
| 16 | `TC-M5.1` | §1.7 Duyệt OPS | Màn hình Kế toán duyệt chi phí OPS | **PASS** | Tải 25+ dòng chi phí do OPS khai báo chờ duyệt, hỗ trợ lọc theo trạng thái duyệt. |
| 17 | `TC-M6.1` | §1. Khai chi phí | Form Khai chi phí Thực chi / Thực thu | **PASS** | Đầy đủ trường Thực chi, Thực thu, Checkbox "Khách trả", Upload ảnh biên lai. |
| 18 | `TC-M7.1` | §2. Chi phí TX | Chi tiết chuyến & Form chi phí lái xe | **PASS** | Màn `/my-trips/195` có section "Chi phí lô hàng & tiền đường", nút "Thêm chi phí" mở form chuẩn. |

---

## 2. HƯỚNG DẪN TEST CHI TIẾT TỪNG MỤC KÈM HÌNH ẢNH MINH HỌA

Dưới đây là tài liệu hướng dẫn kiểm thử chi tiết từng bước (step-by-step) dành cho Tester, Kế toán, và Quản lý để trực tiếp kiểm tra trên trình duyệt:

---

### PHÂN HỆ 1: KẾ TOÁN — BẢNG KIỂM SOÁT PHƠI PHIẾU
**Đường dẫn:** `http://localhost:7175/accounting/phoi-phieu`  
**Tài khoản đăng nhập:** `ketoan` / `Abc123`

#### Mục 1.1: Kiểm tra Bảng kiểm soát phơi phiếu tổng hợp
- **Yêu cầu trong PDF (§3.a):** Thể hiện bảng theo dõi phơi phiếu tổng hợp gồm Lịch trình, Khách hàng, Tuyến đường, Container, Nâng hạ, Xe, Chi hộ, Tiền đường, Trạng thái, Ngày, Ghi chú. Các container chạy kẹp xe hoặc cùng 1 xe phải xếp liên tiếp để tiện đối soát.
- **Các bước thực hiện:**
  1. Đăng nhập tài khoản `ketoan` tại trang đăng nhập.
  2. Bấm vào mục **"Kiểm soát phơi phiếu"** trên thanh menu trái (Sidebar) hoặc truy cập URL `/accounting/phoi-phieu`.
  3. Quan sát bảng dữ liệu `ppc-board`:
     - Kiểm tra tiêu đề các cột: Lịch trình, Khách hàng & Tuyến đường, Thông số container, Địa điểm nâng / hạ, Thông tin xe, Chi hộ (Phải thu / Phải trả), Tiền đường, Trạng thái, Ngày.
     - Kiểm tra cột Thông tin xe: các dòng có cùng biển số xe (ví dụ: chạy kẹp 2 cont 20') được nhóm liền kề nhau.
     - Kiểm tra cột Thông số container: có hiển thị dòng `Trọng tải: ... kg` (nếu chưa có thì hiện `Chưa có trọng tải`).
- **Kết quả thực tế:** **ĐẠT (PASS)**. Bảng dữ liệu hiển thị rõ ràng, đầy đủ các trường theo đúng tài liệu.

![Bảng kiểm soát phơi phiếu tổng hợp]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m1-01-phoi-phieu-main.png)
*Hình 1.1: Giao diện Bảng kiểm soát phơi phiếu tổng hợp trên môi trường dev.*

---

#### Mục 1.2: Kiểm tra Header cột "Thông số container" (Bug 4 / TC-CCP-04)
- **Vấn đề trước đây:** Header cột bị bẻ gãy từ khiến dòng 2 hiện `CONTAINE` và dòng 3 rơi lại chữ cái `R`.
- **Các bước kiểm tra:**
  1. Tại màn hình `/accounting/phoi-phieu`, nhìn vào dòng tiêu đề bảng (thead), cột thứ 4.
  2. Quan sát chữ hiển thị: Phải là `THÔNG SỐ CONTAINER` trọn vẹn, không có chữ `R` đơn lẻ rơi xuống dòng 3.
- **Kết quả thực tế:** **ĐẠT (PASS - ĐÃ SỬA)**. Bề rộng cột đạt 94.1px, text không bị cắt cụt.

![Header Thông số container hiển thị nguyên vẹn]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m1-02-header-container-crop.png)
*Hình 1.2: Cột "Thông số container" hiển thị ngay ngắn, từ ngữ trọn vẹn.*

---

#### Mục 1.3: Kiểm tra Popup "Xem chi tiết Chi hộ" (Bug 1 / TC-CCP-01a & TC-M1.3b)
- **Yêu cầu trong PDF (§3.a):** Khi bấm "Xem chi tiết" ở cột Chi hộ, phải xuất hiện popup hiển thị bảng kê chi tiết từng khoản phí (STT, Nội dung phí, Hóa đơn, Số tiền thu, Số tiền trả, Người thanh toán), checkbox "Tích để nhập Thu và Trả phơi bằng nhau", ô nhập Ngày lấy phơi và Trạng thái lấy phơi.
- **Các bước thực hiện:**
  1. Tại dòng đầu tiên của bảng phơi phiếu, tìm cột **"Chi hộ (Phải thu / Phải trả)"**.
  2. Bấm vào nút **"Xem chi tiết"**.
  3. **Quan sát hiển thị:**
     - Hộp thoại (Modal) phải xuất hiện ngay lập tức ở **chính giữa màn hình**, có lớp nền màu tối che phủ toàn bộ trang (Fixed Backdrop).
     - Kiểm tra tiêu đề: `Chi tiết chi hộ [Mã chuyến]`.
     - Kiểm tra checkbox: Có dòng chữ **"Tích để nhập Thu và Trả phơi bằng nhau"**. Thử tích vào checkbox, kiểm tra khi nhập số tiền Thu thì số tiền Trả tự động điền giống hệt.
     - Kiểm tra 2 ô nhập liệu metadata: **"Ngày lấy phơi"** và **"Trạng thái lấy"**.
     - Bấm nút **[✕]** hoặc bấm phím **Escape** trên bàn phím: Hộp thoại phải đóng lại sạch sẽ, trang web trở lại bình thường.
- **Kết quả thực tế:** **ĐẠT (PASS - ĐÃ SỬA)**. Trước đây modal bị rơi xuống `top: 21,588px` (tận đáy trang), nay đã được bọc `OpsModalBackdrop` hiển thị hoàn hảo ở toạ độ `top: 0px`, `zIndex: 300`.

![Popup Chi tiết chi hộ mở ngay trung tâm màn hình]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m1-03-chi-ho-dialog.png)
*Hình 1.3: Hộp thoại chi tiết chi hộ hiển thị ngay trung tâm với đầy đủ checkbox Thu = Trả và bảng kê phí.*

---

#### Mục 1.4: Kiểm tra Popup "Xem chi tiết Tiền đường" (TC-CCP-01b)
- **Yêu cầu trong PDF (§3.a):** Kiểm tra chi tiết tiền đường, phí cầu đường, vá vỏ của chuyến xe.
- **Các bước thực hiện:**
  1. Tại dòng đầu tiên của bảng phơi phiếu, tìm cột **"Tiền đường"**.
  2. Bấm vào nút **"Xem chi tiết"**.
  3. Quan sát: Hộp thoại `Chi tiết tiền đường` hiển thị ở giữa màn hình với nền mờ cố định.
  4. Bấm nút **[✕]** để đóng hộp thoại.
- **Kết quả thực tế:** **ĐẠT (PASS - ĐÃ SỬA)**.

![Popup Chi tiết tiền đường mở ngay trung tâm màn hình]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m1-04-tien-duong-dialog.png)
*Hình 1.4: Hộp thoại chi tiết tiền đường hiển thị đúng vị trí viewport.*

---

#### Mục 1.5: Kiểm tra Báo cáo tháng Thu/Trả và Phân công xe (§3.a)
- **Yêu cầu trong PDF:** Có báo cáo tổng hợp phơi phiếu phải thu / phải trả theo tháng và danh sách xe phân công cho từng kế toán quản lý (người 13 xe, người 26 xe).
- **Các bước thực hiện:**
  1. Cuộn chuột xuống phía dưới bảng phơi phiếu.
  2. Quan sát mục **"Báo cáo tháng"**:
     - Bảng **"Báo cáo phơi phiếu phải thu (theo tháng)"**.
     - Bảng **"Báo cáo phơi phiếu phải trả (theo tháng)"**.
     - Bộ lọc phạm vi: `Mặc định (của tôi với kế toán)`, `Của tôi`, `Tất cả`, `Chưa gán`.
  3. Cuộn tiếp xuống dưới cùng: Quan sát bảng **"Phân công xe theo kế toán"** (`PhoiPhieuTruckAssignments`).
- **Kết quả thực tế:** **ĐẠT (PASS)**. Cả 2 bảng báo cáo tháng và bảng phân công xe đều hiện diện và có số liệu.

---

### PHÂN HỆ 2: KẾ TOÁN — THEO DÕI HÓA ĐƠN KẾT HỢP
**Đường dẫn:** `http://localhost:7175/accounting/invoice-tracking`  
**Tài khoản đăng nhập:** `ketoan` / `Abc123`

#### Mục 2.1: Kiểm tra Bảng đối chiếu hóa đơn kết hợp 14 cột (Bug 2 / TC-CCP-02)
- **Yêu cầu trong PDF (§3.c):** Quản lý hóa đơn kết hợp theo từng lô hàng, đối chiếu số hóa đơn, số tiền xuất, số tiền nhận, số tiền trả nhà cung cấp và theo dõi chênh lệch.
- **Các bước kiểm tra (Tái hiện lỗi chồng chữ):**
  1. Truy cập `/accounting/invoice-tracking` với kích thước màn hình máy tính thông thường (1440×900).
  2. Quan sát dòng 1, dòng 2 của bảng:
     - Nhìn vào Cột 3 (**Mã lô & Tên khách hàng**): Tên công ty `CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH` có độ dài vượt quá độ rộng cột (~80px). Do CSS áp dụng `white-space: nowrap` mà ô không ẩn overflow, dòng chữ này tràn tự do 82.6px sang Cột 4 và đè trực tiếp lên số container `QATU1234569`.
     - Nhìn vào Cột 7 (**Số hóa đơn & Số tiền**): Dòng `Số hóa đơn: HD-C18-01 / Số tiền: 12.000.000 đ` tràn 59.4px sang Cột 8 đè trực tiếp lên số tiền `8.000.000 đ`.
- **Kết quả thực tế:** **LỖI (FAIL)**. Chữ và số bị đè lên nhau thành khối đen không đọc được. Đã tạo Kanban Ticket `20260922_52` trong thư mục `TODO/` để xử lý bổ sung `min-width: 1350px` kèm thanh cuộn ngang và `text-overflow: ellipsis`.

![Lỗi chồng chữ trên bảng Hóa đơn kết hợp 14 cột]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m2-02-invoice-table-crop.png)
*Hình 2.1: Chữ ở Cột 3 và Cột 7 tràn tự do đè lên nội dung của các cột kế bên.*

---

#### Mục 2.2: Kiểm tra Form "+ Thêm chi phí lô hàng"
- **Các bước thực hiện:**
  1. Trên màn hình `/accounting/invoice-tracking`, bấm nút **"+ Thêm chi phí lô hàng"** ở góc trên bên phải.
  2. Quan sát hộp thoại mở ra:
     - Có ô chọn **Lô hàng**, **Container**.
     - Các trường: **Số hóa đơn**, **Ngày hóa đơn**, **Số tiền hóa đơn**, **Thuế VAT (%)**, **Nhà cung cấp / Đơn vị xuất**, **Ghi chú**.
  3. Thử nhập dữ liệu và bấm **"Hủy"** để đóng form.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Modal mở nhanh, đầy đủ các trường nhập liệu cần thiết.

![Form Thêm chi phí lô hàng vào bảng theo dõi hóa đơn]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m2-03-add-invoice-modal.png)
*Hình 2.2: Hộp thoại thêm hóa đơn kết hợp.*

---

#### Mục 2.3: Kiểm tra Thao tác Xóa hóa đơn yêu cầu Lý do bắt buộc (Q10)
- **Quy định:** Mọi thao tác xóa hóa đơn tài chính phải ghi lại vết kiểm toán (audit trail) kèm lý do giải trình bắt buộc, không được xóa âm thầm.
- **Các bước thực hiện:**
  1. Tại một dòng bất kỳ trên bảng hóa đơn kết hợp, bấm nút **"Xóa"** (biểu tượng thùng rác màu đỏ).
  2. Quan sát: Xuất hiện hộp thoại `Lý do xóa bắt buộc` (`useReasonPrompt`).
  3. Thử để trống ô lý do và bấm "Xóa": Hệ thống yêu cầu phải nhập lý do.
  4. Bấm **"Hủy"** để giữ nguyên dữ liệu.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Cơ chế kiểm soát lý do xóa hoạt động chuẩn xác theo nghiệp vụ quản trị rủi ro tài chính.

![Hộp thoại yêu cầu nhập lý do bắt buộc khi xóa hóa đơn]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m2-04-delete-reason-prompt.png)
*Hình 2.3: Dialog nhập lý do giải trình khi xóa hóa đơn theo chuẩn Q10.*

---

### PHÂN HỆ 3: KẾ TOÁN — THEO DÕI HOÀN CƯỢC CONTAINER
**Đường dẫn:** `http://localhost:7175/accounting/deposit-tracker`  
**Tài khoản đăng nhập:** `ketoan` / `Abc123`

#### Mục 3.1: Kiểm tra Bảng theo dõi hoàn cược & Cảnh báo tiền cược chưa hoàn
- **Yêu cầu trong PDF (§3.c):** Quản lý danh sách cược cont với hãng tàu, theo dõi ngày cược, ngày trả rỗng, ngày lấy giấy CV (chứng từ mượn cont), số tiền cược, trạng thái hoàn cược và có KPI cảnh báo tổng tiền cược chưa thu hồi.
- **Các bước thực hiện:**
  1. Truy cập `/accounting/deposit-tracker`.
  2. Quan sát thẻ KPI ở đầu trang: Hiển thị rõ ràng **"Tổng tiền cược chưa hoàn"** (ví dụ: `90.500.000 đ`).
  3. Quan sát các cột trong bảng: Mã lô, Container, Hãng tàu, Ngày cược, Số tiền cược, Ngày CV, Số tiền hoàn, Trạng thái cược, Thao tác.
  4. Kiểm tra hiển thị Ngày tháng: Chuỗi ngày hiển thị gọn trên 1 dòng `DD/MM/YYYY`, không bị bẻ thành 2 dòng.
  5. **Lưu ý giao diện (TC-CCP-03):** Bảng có tổng độ rộng 1397px. Trên màn hình 1440px (vùng chứa thực tế 1127px), cột "Thao tác" nằm ở mép phải (toạ độ x=1655px), người dùng cần cuộn thanh cuộn ngang sang phải để thấy trọn vẹn nút "Đã hoàn cược".
- **Kết quả thực tế:** **ĐẠT CỐT LÕI (PARTIAL)**. Token ngày đã chuẩn, chức năng cuộn ngang hoạt động tốt.

![Bảng theo dõi hoàn cược container]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m3-02-deposit-table-crop.png)
*Hình 3.1: Bảng theo dõi cược container với các trường ngày tháng và số tiền.*

---

#### Mục 3.2: Kiểm tra Form "+ Thêm dòng cược" & "Ngày CV / số tiền"
- **Các bước thực hiện:**
  1. Bấm nút **"+ Thêm dòng"** ở góc trên bảng: Kiểm tra modal mở ra cho phép chọn Lô hàng, Container, Số tiền cược, Hãng tàu.
  2. Tại một dòng bất kỳ trong bảng, bấm nút **"Ngày CV / số tiền"**: Kiểm tra modal cập nhật ngày nhận biên lai cược vỏ / giấy CV mở ra, cho phép nhập ngày và số tiền hoàn dự kiến.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Cả 2 modal đều hoạt động trơn tru.

![Form cập nhật ngày CV và số tiền hoàn cược]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m3-04-deposit-cv-modal.png)
*Hình 3.2: Hộp thoại cập nhật Ngày CV / Số tiền hoàn cược.*

---

#### Mục 3.3: Thao tác "Đã hoàn cược" & Kiểm chứng bản ghi Sổ quỹ PostgreSQL (TC-M3.4)
- **Yêu cầu trong PDF:** Khi hãng tàu trả lại tiền cược, kế toán bấm xác nhận hoàn cược; số tiền này phải tự động ghi tăng Quỹ công ty (Ngân hàng ACB) và trừ khỏi số tiền cược đang nợ của hãng tàu.
- **Các bước thực hiện:**
  1. Tại một dòng container đang ở trạng thái `CHƯA HOÀN`, cuộn sang phải và bấm nút **"Đã hoàn cược"**.
  2. Hộp thoại xác nhận xuất hiện hỏi: *"Xác nhận đã nhận hoàn cược container ...?"*.
  3. Bấm nút **"Đã hoàn cược"** để xác nhận.
  4. **Quan sát kết quả:**
     - Dòng container chuyển trạng thái sang **"ĐÃ HOÀN CƯỢC"** (màu xanh).
     - Chỉ số KPI "Tổng tiền cược chưa hoàn" ở đầu trang giảm ngay lập tức tương ứng (giảm 1.000.000 đ).
     - **Đối soát CSDL thực tế:** Chạy câu lệnh SQL kiểm tra bảng `treasury_movements`:
       ```sql
       SELECT id, treasury_account_id, direction, amount, physical_reference 
       FROM treasury_movements ORDER BY id DESC LIMIT 1;
       ```
       *Kết quả trả về:* Bản ghi `id=62`, `treasury_account_id=1` (Quỹ ACB), `direction='IN'`, `amount=1000000`, `physical_reference='HOAN-CUOC-12-DUE1'`.
- **Kết quả thực tế:** **ĐẠT TUYỆT ĐỐI (PASS - RUNG 3)**. Dữ liệu từ giao diện ăn khớp 100% với Sổ quỹ ngân hàng trong cơ sở dữ liệu.

![Xác nhận hoàn cược thành công]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m3-07-refund-completed-verified.png)
*Hình 3.3: Giao diện sau khi bấm hoàn cược thành công và đã hạch toán Sổ quỹ.*

---

### PHÂN HỆ 4: KẾ TOÁN — CHỐT DEBIT & KHÓA ĐƠN GIÁ
**Đường dẫn:** `http://localhost:7175/accounting/chot-debit`  
**Tài khoản đăng nhập:** `ketoan` / `Abc123`

#### Mục 4.1: Kiểm tra Bảng điều động tổng hợp 20 cột đối soát Debit
- **Yêu cầu trong PDF (§3.b):** Bảng tổng hợp theo dõi toàn bộ lô hàng, container, đơn giá cước vận chuyển (theo hợp đồng biểu phí khách hàng hoặc thỏa thuận chuyến), phụ phí phát sinh, chi hộ, tổng tiền để kế toán kiểm tra trước khi phát hành hóa đơn / debit note cho khách.
- **Các bước thực hiện:**
  1. Truy cập `/accounting/chot-debit`.
  2. Quan sát bảng dữ liệu: Bảng có 20 cột hiển thị đầy đủ thông tin: Lịch trình, Mã lô hàng, Khách hàng, Tuyến đường, Container, Trọng tải, Đơn giá cước, Phụ phí dầu, Phụ phí hàng nặng, Chi hộ, Tổng tiền, Trạng thái chốt debit.
  3. Danh sách hỗ trợ bộ lọc theo khoảng ngày, theo khách hàng và theo trạng thái đối soát.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Bảng tải 558 dòng lô hàng mượt mà, phân chia cột rõ ràng.

![Bảng điều động tổng hợp đối soát chốt debit]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m4-01-chot-debit-main.png)
*Hình 4.1: Bảng tổng hợp điều động đối soát debit 20 cột.*

---

#### Mục 4.2: Thao tác Chốt Debit & Khóa đơn giá chống sửa đổi
- **Yêu cầu trong PDF (§3.b):** Khi kế toán và khách hàng đã chốt số liệu, kế toán thực hiện chốt debit. Sau khi chốt, đơn giá cước và các phụ phí bị KHÓA, không ai được tự ý chỉnh sửa (trừ Giám đốc / Admin có thẩm quyền).
- **Các bước thực hiện:**
  1. Tích chọn vào ô checkbox ở đầu một dòng lô hàng.
  2. Bấm nút **"Xác nhận đối soát"** (hoặc nút **"Debit"**).
  3. Hộp thoại xác nhận chốt debit xuất hiện.
  4. Bấm xác nhận: Dòng chuyển sang trạng thái đã chốt.
  5. Thử nghiệm tính toàn vẹn: Khi dòng đã chốt debit, nếu cố tình gọi API cập nhật lại cước mà không có quyền mở khóa, backend sẽ từ chối với mã lỗi `HTTP 409 Conflict`.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Nghiệp vụ khóa debit bảo vệ số liệu doanh thu an toàn tuyệt đối.

![Hộp thoại xác nhận chốt debit lô hàng]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m4-02-debit-confirm-dialog.png)
*Hình 4.2: Hộp thoại xác nhận chốt debit và khóa đơn giá lô hàng.*

---

### PHÂN HỆ 5: KẾ TOÁN — DUYỆT CHI PHÍ OPS GIAO NHẬN
**Đường dẫn:** `http://localhost:7175/accounting/expenses?view=ops`  
**Tài khoản đăng nhập:** `ketoan` / `Abc123`

#### Mục 5.1: Kiểm tra Màn hình Kế toán duyệt bảng kê chi phí OPS
- **Yêu cầu trong PDF (§3.a):** Kế toán phơi phiếu trực tiếp duyệt bảng kê chi phí do nhân viên OPS nhập lên hệ thống (phí nâng, hạ, vệ sinh, kiểm hóa, luồng xanh/đỏ...). Cột "Ngày duyệt" có thể chọn duyệt từng dòng hoặc tích chọn tất cả để duyệt hàng loạt. Sau khi duyệt, số tiền sẽ được hạch toán vào Sổ quỹ và đối chiếu với hạn mức tạm ứng của nhân viên OPS.
- **Các bước thực hiện:**
  1. Truy cập `/accounting/expenses?view=ops`.
  2. Quan sát bảng danh sách: Hiển thị 25+ khoản chi phí do các nhân viên OPS hiện trường khai báo.
  3. Kiểm tra các cột thông tin: Lô hàng, Container, Loại chi phí, Thực chi (tiền nhân viên chi ra), Thực thu (tiền thu của khách), Checkbox "Khách trả", Nhân viên khai báo, Ảnh biên lai/chứng từ đính kèm, Trạng thái duyệt.
  4. Bấm xem ảnh chứng từ để kiểm tra tính hợp lệ của biên lai viết tay hoặc hóa đơn GTGT.
  5. Tích chọn dòng và bấm **"Duyệt chi phí"** hoặc **"Từ chối"** kèm lý do.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Quy trình duyệt chi phí hai bước giữa OPS và Kế toán vận hành trơn tru.

![Màn hình Kế toán duyệt chi phí OPS]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m5-01-accounting-ops-expenses.png)
*Hình 5.1: Danh sách chi phí hiện trường của nhân viên giao nhận chờ Kế toán đối chiếu và duyệt.*

---

### PHÂN HỆ 6: OPS GIAO NHẬN — KHAI BÁO CHI PHÍ & VÍ TẠM ỨNG
**Đường dẫn:** `http://localhost:7175/ops/orders` & `/ops/wallet`  
**Tài khoản đăng nhập:** `giaonhan` / `Abc123`

#### Mục 6.1: Kiểm tra Khai chi phí Thực chi / Thực thu / Khách trả (§1)
- **Yêu cầu trong PDF (§1):**
  - Một lô hàng có phí chi hộ (có hóa đơn: nâng, hạ, lưu bãi...) mặc định thu khách hàng.
  - Phí không hóa đơn (luồng hải quan, chọn vỏ, nâng hạ ngoài bãi, ngoài giờ...) có 2 cột độc lập: **Thực chi** (tiền nhân viên thực tế bỏ ra làm hàng) và **Thực thu** (tiền thỏa thuận thu của khách hàng).
  - Có cơ chế đính kèm ảnh biên nhận/chứng từ làm căn cứ đối chiếu.
- **Các bước thực hiện:**
  1. Đăng nhập tài khoản nhân viên giao nhận `giaonhan`.
  2. Truy cập màn hình **"Đơn hàng giao nhận"** (`/ops/orders`).
  3. Tại một đơn hàng cần xử lý, bấm nút **"+ Khai chi phí"**.
  4. **Quan sát hộp thoại khai chi phí:**
     - Ô chọn loại chi phí (Phí nâng, Phí hạ, Phí luồng hải quan, Phí kiểm hóa, Phí bốc xếp...).
     - Ô **"Số tiền thực chi"** (tiền túi hoặc tiền tạm ứng chi ra).
     - Ô **"Số tiền thực thu"** (số tiền sẽ tính vào hóa đơn/debit khách hàng).
     - Checkbox **"Khách trả"** (tự động bật nếu loại phí được cấu hình thu khách).
     - Nút **"Chọn tệp"** để tải lên ảnh biên lai chụp từ điện thoại.
  5. Nhập thử số tiền (ví dụ: Thực chi 200.000đ, Thực thu 250.000đ) và bấm **"Lưu chi phí"**.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Form đáp ứng chính xác 100% logic nghiệp vụ quy định tại Mục 1 của tài liệu PDF.

![Giao diện danh sách đơn hàng giao nhận của nhân viên OPS]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m6-01-ops-orders.png)
*Hình 6.1: Màn hình đơn hàng của nhân viên OPS hiện trường.*

---

#### Mục 6.2: Kiểm tra Quản lý Ví tạm ứng & Đề nghị hoàn ứng (§3.a)
- **Yêu cầu trong PDF (§3.a):** Nhân viên OPS có sổ quỹ / ví tạm ứng theo dõi: Số tiền đã ứng đầu ngày, Số tiền đã chi thực tế, Số tiền còn lại = Số tiền đề nghị thanh toán - Số tiền đã ứng. Nếu âm thì nhân viên nộp lại, nếu dương thì công ty thanh toán hoàn ứng.
- **Các bước thực hiện:**
  1. Trên menu của nhân viên OPS, bấm vào **"Ví tạm ứng"** (`/ops/wallet`).
  2. Quan sát các chỉ số thẻ: **Số dư ví hiện tại**, **Tổng tiền đã tạm ứng**, **Tổng tiền đã chi**, **Chờ hoàn ứng**.
  3. Bấm nút **"Yêu cầu tạm ứng"**: Nhập số tiền cần tạm ứng cho ngày làm việc (ví dụ: 5.000.000 đ), nhập lý do làm hàng và bấm gửi yêu cầu cho Kế toán duyệt.
  4. Xem lịch sử các giao dịch hoàn ứng tại tab **"Quyết toán hoàn ứng"** (`/my-settlements`).
- **Kết quả thực tế:** **ĐẠT (PASS)**. Quy trình luân chuyển dòng tiền tạm ứng khép kín và minh bạch.

![Giao diện Ví tạm ứng và hoàn ứng của nhân viên OPS]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m6-03-ops-wallet.png)
*Hình 6.2: Màn hình quản lý ví tạm ứng và số dư của nhân viên giao nhận.*

---

### PHÂN HỆ 7: LÁI XE — CHUYẾN HÀNG, TIỀN ĐƯỜNG & CHI PHÍ
**Đường dẫn:** `http://localhost:7175/my-trips`  
**Tài khoản đăng nhập:** `laixe` / `Abc123`

#### Mục 7.1: Kiểm tra Giao diện chuyến hàng của Lái xe (§2)
- **Yêu cầu trong PDF (§2):** Lái xe xem danh sách các cuốc hàng được điều vận phân công, phân loại theo trạng thái (Đang chạy, Đã nhận, Hoàn thành), xem chi tiết địa điểm lấy rỗng, nâng cont, hạ hàng, số cont và số seal.
- **Các bước thực hiện:**
  1. Đăng nhập tài khoản lái xe `laixe`.
  2. Giao diện tự động mở trang **"Hành trình của tôi"** (`/my-trips`).
  3. Kiểm tra các tab công việc: **"Đang chạy"**, **"Đã nhận"**, **"Hoàn thành"**.
  4. Bấm chuyển sang tab **"Đã nhận"**: Danh sách liệt kê các chuyến hàng được gán cho xe (ví dụ: Chuyến `TRP-202609-0001`, xe `15E-016.26`, tuyến Hải Phòng).
- **Kết quả thực tế:** **ĐẠT (PASS)**. Giao diện tối ưu hoá cho thao tác nhanh của tài xế xe tải.

![Giao diện danh sách chuyến hàng của lái xe]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m7-01-driver-trips.png)
*Hình 7.1: Màn hình danh sách chuyến hàng phân công cho lái xe.*

---

#### Mục 7.2: Kiểm tra Chi tiết cuốc hàng & Mục "Chi phí lô hàng & tiền đường" (§2)
- **Yêu cầu trong PDF (§2):** Trong chi tiết chuyến, tài xế theo dõi:
  - Tiền đi đường (định mức tuyến).
  - Tiền vé cầu đường, tiền nhiên liệu/dầu.
  - Các chi phí phát sinh: vá vỏ, sửa chữa dọc đường, bốc xếp, hạ bãi, lưu ca...
  - Cho phép tài xế tự điền chi phí thực tế và đính kèm phiếu thu viết tay để Kế toán phơi phiếu duyệt thanh toán riêng.
- **Các bước thực hiện:**
  1. Tại tab "Đang chạy" hoặc "Đã nhận", bấm vào cuốc hàng `TRP-202609-0001` (hoặc truy cập trực tiếp `/my-trips/195`).
  2. Quan sát chi tiết chuyến: Có đầy đủ thông tin Lô hàng, Số cont `QATU1234569`, Cảng nâng Đình Vũ, Địa chỉ giao hàng.
  3. Cuộn chuột xuống mục **"Chi phí lô hàng & tiền đường"**:
     - Có thông báo hướng dẫn: *"Ghi khoản thực tế bạn đã chi; kế toán đối chiếu và thanh toán riêng."*
     - Có nút bấm **"Thêm chi phí"**.
     - Có mục **"Ảnh nhiên liệu"** để tài xế chụp ảnh đồng hồ bơm dầu cây xăng.
     - Có mục **"Chứng từ giao hàng"** để tải lên phiếu bãi, phiếu hạ và biên bản giao nhận POD.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Cấu trúc trang chi tiết cuốc xe bao quát toàn bộ nghiệp vụ thực tế ngoài hiện trường của bác tài.

![Chi tiết cuốc xe và mục Chi phí tiền đường của lái xe]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m7-04-driver-trip-195-detail.png)
*Hình 7.2: Chi tiết cuốc xe với đầy đủ các phân mục chi phí, chứng từ và ảnh nhiên liệu.*

---

#### Mục 7.3: Thao tác Form "Thêm chi phí chuyến" của Lái xe (§2)
- **Các bước thực hiện:**
  1. Tại mục "Chi phí lô hàng & tiền đường" trên màn hình `/my-trips/195`, bấm nút **"Thêm chi phí"**.
  2. Quan sát form nhập liệu mở ra ngay bên dưới:
     - Ô **Loại chi phí** (gợi ý sẵn: Phí nâng, Phí hạ, Vá lốp, Cầu đường, Bốc xếp, Chi công nhân...).
     - Ô **Số tiền** (nhập số tiền thực tế đã chi).
     - Ô **Phương thức trả** (Tiền mặt, Tiền ứng...).
     - Ô **Ngày phát sinh**.
     - Ô **Số hóa đơn** (ghi chú: *Để trống nếu không có hóa đơn/chứng từ viết tay*).
     - Nút **"Chọn ảnh biên lai"** để mở camera điện thoại hoặc chọn ảnh phiếu thu từ thư viện ảnh.
  3. Bấm **"Lưu chi phí"** để gửi dữ liệu về cho Kế toán phơi phiếu.
- **Kết quả thực tế:** **ĐẠT (PASS)**. Form nhập liệu trực quan, đơn giản, phù hợp cho tài xế nhập nhanh khi đang trên đường chạy.

![Form Thêm chi phí phát sinh chuyến của lái xe]({REPO}/qa/2026-09-23_cac-chi-phi-comprehensive/m7-06-driver-expense-form-crop.png)
*Hình 7.3: Form nhập chi phí phát sinh dọc đường của lái xe kèm tính năng chụp biên lai.*

---

## 3. TỔNG HỢP LỖI CẦN XỬ LÝ (DEFECT ACTION ITEMS)

Dựa trên kết quả kiểm thử, hiện tại còn 2 vé công việc (Kanban Tickets) đang được theo dõi trên board:

### 1. Ticket `20260922_52`: Bảng Hóa đơn kết hợp 14 cột bị chồng chữ chéo (Mức độ: P1 - Cao)
- **Vị trí:** Màn hình `/accounting/invoice-tracking`.
- **Nguyên nhân:** Table dùng `table-layout: fixed; width: 100%` chia đều 80.6px/cột, kết hợp CSS `.ivt-stack > span {{ white-space: nowrap; }}` mà không đặt `overflow: hidden`.
- **Hậu quả:** Chữ ở Cột 3 và Cột 7 tràn 82.6px và 59.4px sang các cột kế bên, đè lên số container và số tiền hóa đơn.
- **Giải pháp xử lý:**
  1. Thiết lập `min-width: 1350px` cho bảng trong khung cuộn ngang `.table-scroll`.
  2. Bổ sung `colgroup` để cấp độ rộng hợp lý cho các cột text dài (Mã lô & Khách hàng ≥ 160px, Hóa đơn ≥ 130px, Container ≥ 120px).
  3. Thêm quy tắc `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` kèm thuộc tính `title` để hiển thị tooltip khi người dùng rê chuột vào.

### 2. Ticket `20260922_53`: Bảng Hoàn cược container cần hiển thị thanh cuộn ngang rõ ràng (Mức độ: P1 - Cao)
- **Vị trí:** Màn hình `/accounting/deposit-tracker`.
- **Hiện trạng:** Token ngày tháng đã được fix trên 1 dòng. Tuy nhiên bảng rộng 1397px nên cột Thao tác bị đẩy sang phải toạ độ x=1655px trên màn hình 1440px.
- **Giải pháp xử lý:** Bổ sung thanh cuộn ngang rõ ràng hoặc indicator chỉ báo cuộn để kế toán viên dễ dàng nhận biết có cột thao tác ở phía bên phải.

---

## 4. BẢNG CAM KẾT KIỂM THỬ (VERIFICATION COVERAGE)

*Bảng cam kết thực hiện nghiêm ngặt theo UI Verification Contract trong `AGENTS.md`:*

| Phân hệ / Nghiệp vụ kiểm thử | Mức độ xác minh (Rung) | Bằng chứng thực tế (Evidence) | Phạm vi chưa kiểm (Not covered) |
|---|---|---|---|
| **Popup Phơi phiếu chi tiết (`TC-CCP-01`)** | **UI DRIVEN (Rung 3)** | `m1-03-chi-ho-dialog.png`, `m1-04-tien-duong-dialog.png`, đo DOM top: 0px, zIndex: 300 | In phơi phiếu ra máy in vật lý |
| **Bảng Hóa đơn kết hợp chồng chữ (`TC-CCP-02`)** | **UI DRIVEN (Rung 3)** | `m2-02-invoice-table-crop.png`, đo DOM tràn 82.6px & 59.4px | Màn hình độ phân giải 4K (3840×2160) |
| **Nút Hoàn cược mép phải bảng (`TC-CCP-03`)** | **UI DRIVEN (Rung 3)** | `m3-02-deposit-table-crop.png`, toạ độ x=1655px trên viewport 1440px | Màn hình xoay dọc (portrait mode) |
| **Header CONTAINE / R (`TC-CCP-04`)** | **UI DRIVEN (Rung 3)** | `m1-02-header-container-crop.png`, thead width 94.1px | Ngôn ngữ giao diện tiếng Trung |
| **Nghiệp vụ Hoàn cược & Sổ quỹ (§3.c)** | **UI DRIVEN (Rung 3)** | `m3-07-refund-completed-verified.png`, CSDL `treasury_movements` id=62 (`HOAN-CUOC-12-DUE1`) | Đảo ngược giao dịch hoàn cược (reversal) |
| **Chốt Debit & Khóa đơn giá (§3.b)** | **UI DRIVEN (Rung 3)** | `m4-01-chot-debit-main.png`, `m4-02-debit-confirm-dialog.png` | Quyền mở khóa debit của Giám đốc |
| **Khai chi phí OPS & Ví tạm ứng (§1)** | **UI DRIVEN (Rung 3)** | `m6-01-ops-orders.png`, `m6-03-ops-wallet.png` | Upload file dung lượng lớn > 10MB |
| **Chi phí chuyến & Form tài xế (§2)** | **UI DRIVEN (Rung 3)** | `m7-06-driver-expense-form-crop.png`, tài khoản `laixe` trên `/my-trips/195` | Thiết bị màn hình siêu nhỏ < 360px |

---
*Báo cáo được lập tự động bởi hệ thống kiểm thử khép kín Silversea QA Automation.*
"""

def main():
    print("Writing markdown source to temporary file...")
    with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8') as fh:
        fh.write(MARKDOWN_CONTENT)
        md_file = fh.name

    print(f"Converting markdown with embedded images to {OUTPUT_PATH} using pandoc...")
    cmd = [
        'pandoc',
        md_file,
        '-o', str(OUTPUT_PATH),
        '--from', 'markdown',
        '--resource-path', str(REPO),
        '--toc',
        '--toc-depth=3'
    ]
    subprocess.run(cmd, check=True)
    os.unlink(md_file)
    print(f"SUCCESS: Wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size:,} bytes)")

if __name__ == '__main__':
    main()
