# Luồng 8: Cổng Khách hàng (Customer Portal)

> **Vai trò sở hữu:** Khách hàng (CUSTOMER)
> **Tài khoản demo:** `customer` (password: `Abc123`); E2E: `e2e-customer-28348`, `e2e-customer-90852`
> **Route chính:** `/portal/shipments`, `/portal/debit-notes`, `/portal/statement`
> **PRD nguồn:** Module 03, Module 05, Q16, HT-11, HT-12
>
> **Tổng quan:** Khách hàng truy cập cổng riêng để theo dõi lô hàng, xem giấy báo nợ (Debit Note),
> xác nhận thanh toán. 1 tài khoản CUSTOMER chỉ xem 1 pháp nhân khách hàng (admin liên kết thêm
> nếu cần nhiều). Không hiển thị mã nội bộ `SHP-*`, chỉ dùng Bill/Booking.

---

## 8.1 — Theo dõi lô hàng

### TC-CUST-PORTAL-001 — Customer xem danh sách lô của mình

- **Mã PRD:** M03, Q16
- **Vai trò:** `customer`
- **Mức độ:** P0
- **Thiết bị:** Desktop + Mobile
- **Các bước:**
  1. Đăng nhập `customer`. Mở `/portal/shipments`.
  2. Kiểm tra: danh sách chỉ chứa lô của chính mình.
  3. Nhấn vào 1 lô để xem chi tiết.
- **Kết quả mong đợi (Pass):**
  - Danh sách hiển thị đúng lô của pháp nhân khách hàng đó.
  - Dùng Bill/Booking làm định danh (không hiện mã nội bộ `SHP-*`).
  - Chi tiết lô: trạng thái, container, thời gian, tuyến.
  - Không lộ dữ liệu khách khác.
- **Bằng chứng:** ảnh danh sách + ảnh chi tiết lô

---

### TC-CUST-PORTAL-002 — Customer không xem được lô khách khác

- **Mã PRD:** Q16, HT-02
- **Vai trò:** `customer`
- **Mức độ:** P0
- **Các bước:**
  1. Lấy ID lô của khách khác (từ DB hoặc admin).
  2. Mở trực tiếp `/portal/shipments/<id-của-khách-khác>`.
- **Kết quả mong đợi (Pass):**
  - 404 hoặc 403. Không lộ dữ liệu.
  - API cũng trả 403.
- **Bằng chứng:** ảnh 404/403 + Network tab

---

### TC-CUST-PORTAL-003 — Empty state khi chưa có lô

- **Vai trò:** `customer` (mới)
- **Mức độ:** P2
- **Các bước:**
  1. Đăng nhập customer chưa có lô. Mở `/portal/shipments`.
- **Kết quả mong đợi (Pass):**
  - "Chưa có lô hàng" rõ ràng, không lỗi.
- **Bằng chứng:** ảnh empty state

---

## 8.2 — Giấy báo nợ (Debit Notes)

### TC-CUST-PORTAL-004 — Customer xem giấy báo nợ của mình

- **Mã PRD:** M05, HT-12
- **Vai trò:** `customer`
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/portal/debit-notes`.
  2. Kiểm tra: chỉ thấy giấy báo nợ của mình.
  3. Mở 1 giấy báo nợ → xem chi tiết (Booking, BL, số tiền, VAT, tổng).
  4. Tải file PDF/XLSX (nếu có).
- **Kết quả mong đợi (Pass):**
  - Danh sách đúng theo pháp nhân khách hàng.
  - Chi tiết: Booking/BL, số tiền, VAT, tổng, trạng thái thanh toán.
  - File tải được, mở được.
  - Không lộ giấy báo nợ khách khác.
- **Bằng chứng:** ảnh danh sách + ảnh chi tiết + file PDF/XLSX

---

### TC-CUST-PORTAL-005 — Giấy báo nợ PDF yêu cầu auth

- **Mã PRD:** HT-11
- **Vai trò:** `customer` rồi logout
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `customer`. Mở `/portal/debit-notes`. Lấy URL file PDF.
  2. **Logout**. Mở lại URL PDF trực tiếp.
  3. Đăng nhập `admin`. Lấy URL PDF của customer khác. Đăng nhập `customer` → thử mở.
- **Kết quả mong đợi (Pass):**
  - URL yêu cầu auth: 403/401 khi chưa đăng nhập.
  - Customer không mở được PDF của khách khác.
  - Token hết hạn sau thời gian quy định (~8h).
- **Bằng chứng:** ảnh 403/401 + redirect login

---

## 8.3 — Đối chiếu cuối kỳ

### TC-CUST-PORTAL-006 — Đối chiếu tổng giấy báo nợ, đã thu, còn phải thu

- **Mã PRD:** HT-12
- **Vai trò:** `customer` + `admin` (đối chiếu)
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `customer`. Mở `/portal/debit-notes` + `/portal/statement`.
  2. Ghi: tổng giấy báo nợ, tổng đã thu, tổng còn phải thu, tổng chi hộ.
  3. Đăng nhập `admin`. Mở `/debt/:id` cho cùng khách.
  4. So sánh 2 bộ số.
- **Kết quả mong đợi (Pass):**
  - Tổng trên cổng customer = tổng trên trang admin.
  - Chênh lệch (nếu có) → truy ngược tới dòng giấy báo nợ hoặc khoản thu cụ thể.
- **Bằng chứng:** ảnh 2 màn + click-through

---

## 8.4 — Xác nhận thanh toán

### TC-CUST-PORTAL-007 — Customer xác nhận thanh toán

- **Mã PRD:** M05, Q03
- **Vai trò:** `customer`
- **Mức độ:** P1
- **Các bước:**
  1. Mở giấy báo nợ chưa thanh toán.
  2. Bấm "Xác nhận thanh toán" (nếu có).
  3. Kiểm tra: trạng thái giấy báo nợ cập nhật.
- **Kết quả mong đợi (Pass:**
  - Xác nhận thành công, trạng thái cập nhật.
  - Kế toán thấy xác nhận thanh toán từ customer.
- **Bằng chứng:** ảnh xác nhận + ảnh trạng thái

---

## 8.5 — Phân quyền Customer

### TC-CUST-PORTAL-008 — Vai trò khác không vào được cổng khách hàng

- **Mã PRD:** HT-02
- **Vai trò thử:** `cus`, `dieuvan`, `laixe`, `ketoan`, `giaonhan`
- **Mức độ:** P0
- **Các bước:**
  1. Các vai trò mở `/portal/shipments`, `/portal/debit-notes`.
- **Kết quả mong đợi (Pass):**
  - Tất cả bị redirect hoặc "Không có quyền".
- **Bằng chứng:** ảnh redirect cho từng vai trò

---

### TC-CUST-PORTAL-009 — Admin liên kết customer với pháp nhân thứ 2

- **Mã PRD:** Q16
- **Vai trò:** `admin` + `customer`
- **Mức độ:** P2
- **Các bước:**
  1. `admin` liên kết tài khoản `customer` với pháp nhân thứ 2.
  2. Đăng nhập `customer` → mở `/portal/shipments`.
- **Kết quả mong đợi (Pass):**
  - Customer thấy lô của cả 2 pháp nhân.
  - Giấy báo nợ cũng gộp cả 2.
- **Bằng chứng:** ảnh danh sách gộp 2 pháp nhân

---

## 8.6 — Responsive Customer Portal

### TC-CUST-PORTAL-010 — Responsive trên mobile

- **Mã PRD:** HT-07
- **Vai trò:** `customer`
- **Mức độ:** P1
- **Thiết bị:** Mobile (390×844)
- **Các bước:**
  1. Mở `/portal/shipments` trên mobile.
  2. Mở `/portal/debit-notes` trên mobile.
  3. Kiểm tra: không tràn ngang, nút bấm được, bảng có scroll hợp lý.
- **Kết quả mong đợi (Pass):**
  - Mọi chức năng portal dùng được trên mobile.
  - Không mất dữ liệu, không vỡ bố cục.
- **Bằng chứng:** ảnh mobile cho 2 màn

---

## Bảng nghiệm thu — Cổng Khách hàng

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-CUST-PORTAL-001 | | | Danh sách lô | |
| __/__/__ | TC-CUST-PORTAL-002 | | | Không xem lô khách khác | |
| __/__/__ | TC-CUST-PORTAL-003 | | | Empty state | |
| __/__/__ | TC-CUST-PORTAL-004 | | | Giấy báo nợ | |
| __/__/__ | TC-CUST-PORTAL-005 | | | PDF auth | |
| __/__/__ | TC-CUST-PORTAL-006 | | | Đối chiếu cuối kỳ | |
| __/__/__ | TC-CUST-PORTAL-007 | | | Xác nhận thanh toán | |
| __/__/__ | TC-CUST-PORTAL-008 | | | RBAC portal | |
| __/__/__ | TC-CUST-PORTAL-009 | | | Multi-pháp nhân | |
| __/__/__ | TC-CUST-PORTAL-010 | | | Responsive | |
