# Regression Test Plan — Audit tài liệu các chi phí.pdf (2026-09-22)

**Ngày lập:** 2026-09-22  
**Mục tiêu:** Kiểm thử thực tế các yêu cầu trong tài liệu `/Users/dev/Downloads/các chi phí.pdf` trên môi trường local dev (`http://localhost:7175`, API `:3002`, DB `:5441`).  
**Tài khoản sử dụng:** `ketoan` (Kế toán), `giaonhan` (OPS Giao nhận), `laixe` (Lái xe) — Mật khẩu: `Abc123` (theo `testplan/testaccounts.txt`).  
**Thư mục bằng chứng:** `qa/2026-09-22_cac-chi-phi-audit/`  
**Kanban Tickets tương ứng:** `20260922_51`, `20260922_52`, `20260922_53`, `20260922_54` trên Google Drive `Kanban-PROD/TODO/`.

---

## 1. Danh sách các Case hồi quy (Regression Test Cases)

| Case ID | Card Kanban | Màn hình | Mức độ | Hiện tượng phát hiện (FAIL) | Kỳ vọng khi PASS |
|---|---|---|---|---|---|
| `TC-CCP-01` | `20260922_51` | `/accounting/phoi-phieu` | **P0 (Blocker)** | Bấm "Xem chi tiết" ở cột Chi hộ hoặc Tiền đường: Không có modal nào xuất hiện trong viewport. Modal bị render ở `top: 21,588px` (tận đáy trang sau 100+ dòng) do thiếu `ops-modal-backdrop` và thiếu `ops-modal.css`. | Modal xuất hiện ngay chính giữa màn hình (viewport center), có nền mờ fixed che phủ, nhấn Esc hoặc nút [✕] để đóng. |
| `TC-CCP-02` | `20260922_52` | `/accounting/invoice-tracking` | **P1 (High)** | Bảng 14 cột dùng `table-layout: fixed` chia đều 80.6px kết hợp `.ivt-stack > span { white-space: nowrap }` không ẩn overflow, khiến tên khách hàng (`CÔNG TY TNHH LONG MINH`) và hóa đơn (`HD-C18-01`) tràn ngang 35–60px đè thẳng lên cột container và số tiền bên cạnh. | Bảng có min-width hợp lý (≥ 1350px) kèm cuộn ngang mượt mà, phân bổ tỷ lệ cột chuẩn, chữ không tràn đè lên nhau. |
| `TC-CCP-03` | `20260922_53` | `/accounting/deposit-tracker` | **P1 (High)** | Cột Thao tác cuối bảng bị xén mất viền và chữ: nút "Đã hoàn cược" bị cụt thành "Đã hoàn"; các token ngày ("21/09/26") và mã bill ("DUE1") bị bẻ đôi thành 2 dòng. | Nút thao tác hiển thị nguyên vẹn 100%, có scroll ngang an toàn, ngày tháng giữ nguyên trên 1 dòng `white-space: nowrap`. |
| `TC-CCP-04` | `20260922_54` | `/accounting/phoi-phieu` | **P2 (Medium)** | Header cột "Thông số container" bị bẻ gãy từ: dòng 2 hiện `CONTAINE`, dòng 3 rơi trơ trọi chữ cái `R`. | Header cột giữ nguyên từ ngữ (`word-break: keep-all`), không ngắt cụt 1 ký tự rơi dòng. |

---

## 2. Chi tiết từng ca kiểm thử và các bước tái hiện (Reproduction Steps)

### TC-CCP-01: Hộp thoại "Xem chi tiết" Phơi phiếu vẽ ngoài màn hình (P0)
- **Tài khoản:** `ketoan` / `Abc123`
- **Màn hình:** `http://localhost:7175/accounting/phoi-phieu`
- **Các bước thực hiện:**
  1. Đăng nhập vai trò Kế toán, truy cập `/accounting/phoi-phieu`.
  2. Bấm nút **"Xem chi tiết"** tại cột "Chi hộ (Phải thu / Phải trả)" ở dòng đầu tiên.
  3. Quan sát màn hình trước mắt: **FAIL** — Không có hộp thoại nào xuất hiện; người dùng tưởng nhầm nút bị hỏng.
  4. Mở Console / DevTools hoặc cuộn chuột liên tục xuống đáy trang (toạ độ `y = 21,500px`): Hộp thoại chi tiết Chi hộ nằm trơ trọi ở đáy trang, không có backdrop che phủ, không căn giữa.
- **Tiêu chí nghiệm thu (Acceptance Criteria):**
  - Bọc component bằng `OpsModalBackdrop` (hoặc `.ops-modal-backdrop` có `position: fixed; inset: 0; z-index: var(--z-modal)`).
  - Import đầy đủ `ops-modal.css` trong cả `PhoiPhieuChiHoDialog.tsx` và `PhoiPhieuTienDuongDialog.tsx`.
  - Hộp thoại hiện ngay giữa màn hình khi bấm nút.

---

### TC-CCP-02: Bảng theo dõi hóa đơn kết hợp bị chồng chữ chéo giữa các cột (P1)
- **Tài khoản:** `ketoan` / `Abc123`
- **Màn hình:** `http://localhost:7175/accounting/invoice-tracking`
- **Các bước thực hiện:**
  1. Đăng nhập vai trò Kế toán, truy cập `/accounting/invoice-tracking`.
  2. Đặt kích thước cửa sổ 1440×900.
  3. Quan sát dòng 1 và dòng 2 của bảng:
     - Ô Cột 3 (Mã lô & Tên khách hàng): Dòng chữ `CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH` tràn ngang 34.4px đè trực tiếp lên số container `QATU1234569` ở Cột 4.
     - Ô Cột 7 (Số hóa đơn & Số tiền): Khối chữ `Số hóa đơn: HD-C18-01 / Số tiền: 12.000.000 đ` tràn ngang 59.4px đè trực tiếp lên cột tiền `8.000.000 đ` ở Cột 8.
- **Tiêu chí nghiệm thu (Acceptance Criteria):**
  - Thiết lập `min-width: 1350px` cho bảng trong khung cuộn ngang `.table-scroll`.
  - Thiết lập chiều rộng thích hợp cho các cột chứa văn bản dài (Mã lô / Khách hàng ≥ 160px).
  - Không để chữ của cột trước tràn đè lên nội dung cột sau.

---

### TC-CCP-03: Bảng hoàn cược container bị xén nút thao tác và bẻ gãy token ngày (P1)
- **Tài khoản:** `ketoan` / `Abc123`
- **Màn hình:** `http://localhost:7175/accounting/deposit-tracker`
- **Các bước thực hiện:**
  1. Đăng nhập vai trò Kế toán, truy cập `/accounting/deposit-tracker`.
  2. Quan sát mép phải của bảng:
     - Nút "Đã hoàn cược" bị mép màn hình xén cụt, chỉ còn hiện chữ "Đã hoàn" và mất viền phải.
     - Cột Ngày: Chuỗi "21/09/26" bị ngắt làm 2 dòng ("21/09" ở trên và "/26" ở dưới).
     - Cột Bill: Chuỗi "DUE1" bị ngắt làm 2 dòng ("DUE" ở trên và "1" ở dưới).
- **Tiêu chí nghiệm thu (Acceptance Criteria):**
  - Đảm bảo toàn bộ nút "Đã hoàn cược" hiển thị đầy đủ, không bị cắt mép viền.
  - Cột ngày tháng và mã định danh phải có `white-space: nowrap`.
  - Cung cấp cơ chế cuộn ngang rõ ràng khi bảng rộng hơn vùng chứa.

---

### TC-CCP-04: Header "Thông số container" bị bẻ chữ CONTAINE / R (P2)
- **Tài khoản:** `ketoan` / `Abc123`
- **Màn hình:** `http://localhost:7175/accounting/phoi-phieu`
- **Các bước thực hiện:**
  1. Truy cập `/accounting/phoi-phieu`.
  2. Nhìn vào thead, cột thứ 4: Thấy chữ `THÔNG SỐ` ở dòng 1, `CONTAINE` ở dòng 2, và chữ cái đơn lẻ `R` ở dòng 3.
- **Tiêu chí nghiệm thu (Acceptance Criteria):**
  - Tiêu đề cột áp dụng `word-break: keep-all` hoặc tăng độ rộng cột tối thiểu để từ "CONTAINER" không bị bẻ đôi.
