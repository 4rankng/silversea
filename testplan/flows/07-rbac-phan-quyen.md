# Luồng 7: RBAC & Phân quyền — Tất cả Vai trò

> **Vai trò:** Tất cả 8 vai trò: ADMIN, MANAGER, ACCOUNTANT, CUS, DISPATCHER, DRIVER, FORWARDER, CUSTOMER
> **PRD nguồn:** HT-02, Q15–Q17, TC-MO2C-17, Module 01–12
>
> **Tổng quan:** Kiểm tra phân quyền toàn diện: mỗi vai trò chỉ thấy/thao tác đúng dữ liệu và
> chức năng được giao. URL trực tiếp không vượt quyền. Dữ liệu nhạy cảm (lợi nhuận, giá vốn,
> lương, định mức) chỉ cho MANAGER/ACCOUNTANT/ADMIN. Create-only chỉ xóa trong phiên hiện tại.

---

## 7.1 — Ma trận Role × Route

### TC-RBAC-001 — Mỗi vai trò vào đúng màn nhà (Smoke)

- **Mức độ:** Smoke
- **Các bước:**
  1. Đăng nhập lần lượt 8 vai trò. Ghi route đầu tiên sau login.
- **Kết quả mong đợi (Pass):**

| Vai trò | Route đầu tiên mong đợi |
|---------|------------------------|
| ADMIN | `/dashboard` |
| MANAGER | `/dashboard` |
| ACCOUNTANT | `/accounting` |
| CUS (CLERK) | `/shipments` |
| DISPATCHER | `/dispatch` |
| DRIVER | `/my-trips` |
| FORWARDER | `/my-forwarder-trips` |
| CUSTOMER | `/portal/shipments` |

- **Bằng chứng:** ảnh route đầu tiên cho từng vai trò

---

### TC-RBAC-002 — URL trực tiếp vượt quyền → redirect hoặc 403

- **Mã PRD:** HT-02, TC-MO2C-17
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Các bước:**
  1. Đăng nhập `laixe`. Truy cập trực tiếp: `/finance`, `/trips`, `/debt`, `/customers`, `/dispatch`, `/portal/debit-notes`.
  2. Đăng nhập `customer`. Truy cập: `/finance`, `/trips`, `/dispatch`, `/my-trips`.
  3. Đăng nhập `ketoan`. Truy cập: `/my-trips`, `/my-forwarder-trips`, `/dispatch`.
  4. Đăng nhập `giaonhan`. Truy cập: `/finance`, `/salary`, `/penalties`, `/debt`.
  5. Đăng nhập `cus`. Truy cập: `/finance`, `/dispatch`, `/my-trips`.
  6. Đăng nhập `dieuvan`. Truy cập: `/finance`, `/debt`, `/salary`.
- **Kết quả mong đợi (Pass):**
  - Mỗi URL không thuộc vai trò: redirect về màn nhà hoặc "Không có quyền".
  - **Không lộ dữ liệu** trong response body (kể cả loading state).
  - API trả 403 (DevTools Network tab).
- **Bằng chứng:** ảnh redirect / "Không có quyền" cho từng vai trò + Network 403

---

## 7.2 — Dữ liệu nhạy cảm chỉ cho Manager/Accountant/Admin

### TC-RBAC-003 — Dispatcher/Ops/Driver/CUS không thấy dữ liệu nhạy cảm

- **Mã PRD:** TC-MO2C-17, O2C Bước 0
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `dieuvan`. Kiểm tra: không thấy lợi nhuận, giá vốn, lương, hoa hồng, định mức.
  2. Đăng nhập `giaonhan`. Kiểm tra: không thấy lợi nhuận, giá vốn.
  3. Đăng nhập `laixe`. Kiểm tra: chỉ thấy thu nhập cá nhân, không thấy lương lái xe khác.
  4. Đăng nhập `cus`. Kiểm tra: không thấy lợi nhuận, giá vốn.
- **Kết quả mong đợi (Pass):**
  - Các vai trò vận hành không thấy dữ liệu nhạy cảm.
  - Menu ẩn các mục không có quyền.
  - URL trực tiếp cũng bị chặn.
  - API không trả về trường nhạy cảm trong response.
- **Bằng chứng:** ảnh menu + ảnh URL bị chặn + Network response body

---

### TC-RBAC-004 — Chỉ Manager/Accountant/Admin thấy lợi nhuận, giá vốn

- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `giamdoc` → mở `/dashboard`, `/finance` → phải thấy lợi nhuận.
  2. Đăng nhập `ketoan` → mở `/finance` → phải thấy lợi nhuận.
  3. Đăng nhập `admin` → mở `/dashboard` → phải thấy mọi thứ.
- **Kết quả mong đợi (Pass):**
  - 3 vai trò này thấy đầy đủ: doanh thu, chi phí, lợi nhuận, giá vốn.
- **Bằng chứng:** ảnh dashboard/finance với dữ liệu nhạy cảm

---

## 7.3 — Customer chỉ thấy dữ liệu của mình

### TC-RBAC-005 — Customer row-scope

- **Mã PRD:** Q16
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `customer`. Mở `/portal/shipments`.
  2. Kiểm tra: chỉ thấy lô của chính mình.
  3. Mở URL `/portal/shipments/<id-của-khách-khác>`.
  4. Mở `/portal/debit-notes` → chỉ thấy giấy báo nợ của mình.
- **Kết quả mong đợi (Pass):**
  - Customer chỉ thấy dữ liệu thuộc chính pháp nhân của mình.
  - URL lô/khách khác → 404/403.
  - Không lộ dữ liệu khách khác trong bất kỳ response nào.
- **Bằng chứng:** ảnh danh sách + ảnh URL bị chặn + Network 403

---

## 7.4 — Create-only: xóa trong phiên hiện tại

### TC-RBAC-006 — Create-only xóa sai sót trong phiên hiện tại

- **Mã PRD:** TC-MO2C-17, O2C Bước 0
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `cus` (create-only). Tạo 1 lô nháp.
  2. Trong **cùng phiên** (chưa logout): thử xóa lô vừa tạo.
- **Kết quả mong đợi (Pass):**
  - Cho phép xóa trong phiên hiện tại (phát hiện sai sót).
  - Lô bị xóa/soft-delete.
- **Bằng chứng:** ảnh xóa thành công + ảnh danh sách không còn lô

---

### TC-RBAC-007 — Create-only: xóa dữ liệu phiên cũ → phải phê duyệt

- **Mã PRD:** TC-MO2C-17, O2C Bước 0
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `cus`. Tạo 1 lô. **Logout**.
  2. Đăng nhập lại `cus`. Thử xóa lô của phiên cũ.
- **Kết quả mong đợi (Pass:**
  - Không cho xóa trực tiếp.
  - Yêu cầu Admin/Giám đốc phê duyệt.
- **Bằng chứng:** ảnh "Cần phê duyệt" / nút xóa disabled

---

### TC-RBAC-008 — Chi phí/chứng từ đã duyệt → cấm xóa

- **Mã PRD:** TC-MO2C-17, O2C Bước 0
- **Mức độ:** P0
- **Các bước:**
  1. Chi phí đã được Kế toán duyệt.
  2. Bất kỳ ai (kể cả admin) thử xóa chi phí đã duyệt từ UI thường.
- **Kết quả mong đợi (Pass):**
  - Không cho xóa chi phí đã duyệt (bất kỳ ai, bất kỳ phiên nào).
  - Chỉ Admin/Giám đốc xử lý qua workflow đặc biệt.
- **Bằng chứng:** ảnh "Không thể xóa chi phí đã duyệt"

---

## 7.5 — Hủy chuyến / Ngoại lệ

### TC-RBAC-009 — Hủy chuyến phải qua quyền/lý do/audit

- **Mã PRD:** TC-MO2C-16
- **Vai trò:** `admin`
- **Mức độ:** P0
- **Các bước:**
  1. Thử hủy trực tiếp trip chưa hoàn thành.
  2. Kiểm tra: phải nhập lý do, có audit.
  3. Thử hủy trip COMPLETED.
- **Kết quả mong đợi (Pass):**
  - Hủy giữ audit và lý do.
  - Trip COMPLETED không bị hủy/ghi đè trực tiếp.
  - Fulfillment hủy phải được thay thế/miễn trừ rõ.
- **Bằng chứng:** ảnh form hủy + audit + ảnh chặn hủy COMPLETED

---

## 7.6 — Concurrent edit / Double-submit

### TC-RBAC-010 — 2 người cùng sửa → conflict version (409)

- **Mã PRD:** Q23, TC-MO2C-16
- **Mức độ:** P0
- **Các bước:**
  1. Mở 2 tab, cùng 1 chuyến, 2 người sửa khác trường.
  2. Cùng bấm lưu.
- **Kết quả mong đợi (Pass):**
  - Người thứ 2 nhận HTTP 409 "phiên bản cũ" / "cần tải lại".
  - Không ghi đè dữ liệu người thứ 1.
  - Audit log ghi cả 2 lần thử.
- **Bằng chứng:** ảnh 2 request (1 OK, 1 409) + audit log

---

### TC-RBAC-011 — 2 người cùng duyệt → first-approve-wins

- **Mã PRD:** Q23
- **Mức độ:** P0
- **Các bước:**
  1. 2 người cùng bấm "Duyệt" khoản chi.
- **Kết quả mong đợi (Pass):**
  - Duyệt đầu tiên thắng.
  - Người sau nhận "đã được duyệt".
  - Audit ghi cả 2 lần thử.
- **Bằng chứng:** ảnh 2 request (1 OK, 1 "đã được duyệt") + audit

---

## 7.7 — Menu ẩn theo vai trò

### TC-RBAC-012 — Sidebar chỉ hiện mục theo vai trò

- **Mã PRD:** `docs/prd/sidebar-organization-by-role.txt`
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập từng vai trò. Đếm số mục menu sidebar.
  2. So sánh với PRD sidebar spec.
- **Kết quả mong đợi (Pass):**
  - Mỗi vai trò chỉ thấy menu items thuộc quyền.
  - Không hiện menu dẫn đến trang không có quyền.
- **Bằng chứng:** ảnh sidebar cho từng vai trò

---

## Bảng nghiệm thu — RBAC & Phân quyền

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-RBAC-001 | | | Smoke: 8 vai trò | |
| __/__/__ | TC-RBAC-002 | | | URL vượt quyền | |
| __/__/__ | TC-RBAC-003 | | | Dữ liệu nhạy cảm ẩn | |
| __/__/__ | TC-RBAC-004 | | | Manager/KT thấy lợi nhuận | |
| __/__/__ | TC-RBAC-005 | | | Customer row-scope | |
| __/__/__ | TC-RBAC-006 | | | Xóa phiên hiện tại | |
| __/__/__ | TC-RBAC-007 | | | Xóa phiên cũ | |
| __/__/__ | TC-RBAC-008 | | | Cấm xóa đã duyệt | |
| __/__/__ | TC-RBAC-009 | | | Hủy chuyến | |
| __/__/__ | TC-RBAC-010 | | | Conflict 409 | |
| __/__/__ | TC-RBAC-011 | | | First-approve-wins | |
| __/__/__ | TC-RBAC-012 | | | Sidebar theo vai trò | |
