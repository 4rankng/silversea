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
| ADMIN | `/config` (xem `frontend/src/lib/routes.ts:172` `homeForRole`) |
| MANAGER | `/dashboard` |
| ACCOUNTANT | `/accounting` |
| CUS (CLERK) | `/shipments` |
| DISPATCHER | `/dispatch` |
| DRIVER | `/my-trips` |
| OPS / FORWARDER | `/my-orders` (`/my-forwarder-trips` vẫn là alias cũ mount cùng page; xem `routes.ts:151`) |
| CUSTOMER | `/portal/shipments` |

- **Bằng chứng:** ảnh route đầu tiên cho từng vai trò

---

### TC-RBAC-002 — URL trực tiếp vượt quyền → redirect hoặc 403

- **Mã PRD:** HT-02, TC-MO2C-17
- **Mức độ:** P0
- **Thiết bị:** Desktop
- **Các bước:**
  1. Đăng nhập `DRIVER`. Truy cập trực tiếp: `/finance`, `/trips`, `/debt`, `/customers`, `/dispatch`, `/portal/debit-notes`.
  2. Đăng nhập `CUSTOMER`. Truy cập: `/finance`, `/trips`, `/dispatch`, `/my-trips`.
  3. Đăng nhập `ACCOUNTANT`. Truy cập: `/my-trips`, `/my-forwarder-trips`, `/dispatch`.
  4. Đăng nhập `OPS`. Truy cập: `/finance`, `/salary`, `/penalties`, `/debt`.
  5. Đăng nhập `CUS`. Truy cập: `/finance`, `/dispatch`, `/my-trips`.
  6. Đăng nhập `DISPATCHER`. Truy cập: `/finance`, `/debt`, `/salary`.
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
  1. Đăng nhập `DISPATCHER`. Kiểm tra: không thấy lợi nhuận, giá vốn, lương, hoa hồng, định mức.
  2. Đăng nhập `OPS`. Kiểm tra: không thấy lợi nhuận, giá vốn.
  3. Đăng nhập `DRIVER`. Kiểm tra: chỉ thấy thu nhập cá nhân, không thấy lương lái xe khác.
  4. Đăng nhập `CUS`. Kiểm tra: không thấy lợi nhuận, giá vốn.
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
  1. Đăng nhập `MANAGER` → mở `/dashboard`, `/finance` → phải thấy lợi nhuận.
  2. Đăng nhập `ACCOUNTANT` → mở `/finance` → phải thấy lợi nhuận.
  3. Đăng nhập `ADMIN` → mở `/dashboard` → phải thấy mọi thứ.
- **Kết quả mong đợi (Pass):**
  - 3 vai trò này thấy đầy đủ: doanh thu, chi phí, lợi nhuận, giá vốn.
- **Bằng chứng:** ảnh dashboard/finance với dữ liệu nhạy cảm

---

## 7.3 — Phạm vi dữ liệu theo vai trò

### TC-RBAC-005 — Customer chỉ thấy dữ liệu của mình (portal row-scope)

- **Mã PRD:** Q16
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `CUSTOMER`. Mở `/portal/shipments`.
  2. Kiểm tra: chỉ thấy lô của chính mình.
  3. Mở URL `/portal/shipments/<id-của-khách-khác>`.
  4. Mở `/portal/debit-notes` → chỉ thấy giấy báo nợ của mình.
- **Kết quả mong đợi (Pass):**
  - Customer chỉ thấy dữ liệu thuộc chính pháp nhân của mình.
  - URL lô/khách khác → 404/403.
  - Không lộ dữ liệu khách khác trong bất kỳ response nào.
- **Bằng chứng:** ảnh danh sách + ảnh URL bị chặn + Network 403

---

### TC-RBAC-013 — Nhân viên vận hành thấy toàn bộ khách hàng và lô hàng (không giới hạn theo người dùng)

- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `CUS`. Mở `/shipments/new` → mở dropdown Khách hàng → thấy **tất cả** khách hàng active.
  2. Tạo mới một khách hàng (inline hoặc từ danh mục). Đăng nhập một vai trò khác (`DISPATCHER`, `MANAGER`, hoặc một tài khoản CUS khác) → mở dropdown Khách hàng → KH vừa tạo phải xuất hiện.
  3. Mở `/shipments` bằng hai tài khoản CUS khác nhau → cả hai thấy **cùng một** danh sách lô hàng đầy đủ.
  4. Với tư cách `CUS`, mở trực tiếp URL `/shipments/:id` của lô bất kỳ do người khác tạo → mở bình thường.
- **Kết quả mong đợi (Pass):**
  - Không còn giới hạn "mỗi CUS thấy một tập khách hàng/lô riêng" — dropdown và danh sách như nhau với mọi nhân viên vận hành.
  - KH mới tạo xuất hiện trong dropdown của mọi vai trò có dropdown KH.
  - GET danh sách khách hàng trả về toàn bộ (không lọc theo người dùng).
- **Bằng chứng:** ảnh dropdown KH ở 2 tài khoản + ảnh 2 danh sách lô giống nhau + Network GET /api/customers


### TC-RBAC-014 — CUS/Dispatcher allowance danh mục KH + điểm vận hành (route-scoped, POST-only)

- **Mức độ:** P0
- **Nguồn:** báo cáo khách hàng 2026-09-06 (nghi "CUS không tự tạo mới được khách hàng") — đã xác
  minh trên local: quyền hoạt động đúng. Case này pin allowance để không bị gỡ/mất khớp path.
- **Các bước:**
  1. Đăng nhập `CUS`. GET `/api/customers?page=1` → 200 (đầy đủ danh mục).
  2. POST `/api/customers` (name + taxCode + contactInfo) → 201; response **không có** creditLimit /
     paymentTermDays / debitNoteMode (intake strip).
  3. POST `/api/customers` kèm `paymentTermDays` → 201 nhưng trường bị strip khỏi kết quả lưu.
  4. GET `/api/shipments/operational-sites?customerId=<id>` → 200.
  5. POST `/api/shipments/operational-sites` (customerId, code, name, shortName, siteType, routeId
     active, address) → 201.
  6. PUT + DELETE `/api/customers/:id` → 403 (create-only).
- **Kết quả mong đợi (Pass):** đúng như trên. Allowance route-scoped nằm trong
  `backend/src/middleware/casbin.ts` (`hasRouteScopedRoleAllowance`) và khớp path thật `/api/customers`
  vì config router mount tại `/api` (path tương đối `/customers`).
- **Kỳ vọng sai (Fail nếu):** 403 khi CUS GET/POST customers; KH intake lọt credit fields;
  POST site bị chặn với CUS.
- **Bằng chứng:** Network từng bước + backend `customer-intake-create.test.ts` và
  `dispatcher-catalog-create-authz.test.ts` (15/15 pass 2026-09-06, local)

---

### TC-RBAC-015 — CUS & Dispatcher edit/delete tuyến đường và khách hàng (route-scoped, 1-day age gate)

- **Mức độ:** P0
- **Nguồn:** yêu cầu mở quyền edit/delete cho CUS và DISPATCHER trên `/config/routes` và
  `/config/customers`. Trước đó DISPATCHER bị giới hạn POST-only; nay đã mở PUT/DELETE.
- **Các bước:**
  1. Đăng nhập `CUS`. Mở `/config/routes`. Nhấn vào một tuyến → modal chỉnh sửa mở ra.
     Sửa tên tuyến → Lưu → 200. Nhấn Xoá (tuyến tạo < 1 ngày) → 200.
  2. Đăng nhập `CUS`. Mở `/config/customers`. Nhấn vào một khách hàng → modal chỉnh sửa mở ra.
     Sửa tên KH → Lưu → 200. Nhấn Xoá (KH tạo < 1 ngày) → 200.
  3. Đăng nhập `DISPATCHER`. Mở `/config/routes`. Nhấn vào một tuyến → modal chỉnh sửa mở ra.
     Sửa tên tuyến → Lưu → 200. Nhấn Xoá (tuyến tạo < 1 ngày) → 200.
  4. Đăng nhập `DISPATCHER`. Mở `/config/customers`. Nhấn vào một khách hàng → modal chỉnh sửa mở ra.
     Sửa tên KH → Lưu → 200. Nhấn Xoá (KH tạo < 1 ngày) → 200.
  5. CUS/Dispatcher sửa field tài chính (creditLimit, paymentTermDays) → trường bị strip bởi
     intake restriction service, không lưu vào DB.
  6. CUS/Dispatcher xoá tuyến/KH tạo > 1 ngày → 403 "Chỉ được xóa trong vòng 1 ngày sau khi tạo."
- **Kết quả mong đợi (Pass):**
  - Cả CUS và DISPATCHER thấy nút Sửa/Xoá trên `/config/routes` và `/config/customers`.
  - Edit identity fields (name, shortName, taxCode, contactPerson) → thành công.
  - Financial fields bị strip khỏi payload.
  - Delete chỉ khả dụng cho entities tạo < 1 ngày (age gate).
  - Các config catalog khác (pricing-tables, expense-categories…) vẫn bị chặn cho CUS/DISPATCHER.
- **Kỳ vọng sai (Fail nếu):** DISPATCHER看不到 Sửa/Xoá nút; PUT/DELETE trả 403;
  financial fields lọt vào DB; xoá entity > 1 ngày thành công.
- **Bằng chứng:** Network từng bước + `dispatcher-catalog-create-authz.test.ts` +
  UI screenshots `/config/routes` và `/config/customers` cho cả CUS và DISPATCHER.

---

## 7.4 — Create-only: xóa trong phiên hiện tại

### TC-RBAC-006 — Create-only xóa sai sót trong phiên hiện tại

- **Mã PRD:** TC-MO2C-17, O2C Bước 0
- **Mức độ:** P0
- **Các bước:**
  1. Đăng nhập `CUS` (create-only). Tạo 1 lô nháp.
  2. Trong **cùng phiên** (chưa logout): thử xóa lô vừa tạo.
- **Kết quả mong đợi (Pass):**
  - Cho phép xóa trong phiên hiện tại (phát hiện sai sót).
  - Lô bị xóa/soft-delete.
- **Bằng chứng:** ảnh xóa thành công + ảnh danh sách không còn lô

---

### TC-RBAC-007 — Quyền xóa không chuyển thành yêu cầu phê duyệt

- **Mã PRD:** TC-MO2C-17, O2C Bước 0; **Mức độ:** P0.
- **Các bước:** CUS tạo lô, đăng xuất/đăng nhập lại; thử xóa với vai trò chỉ có
  quyền tạo, rồi thử với vai trò có quyền xóa hiện hành trên một lô đủ điều kiện.
- **Pass:** quyền xóa, phạm vi và tình trạng lô quyết định kết quả; sai quyền bị
  từ chối, đúng quyền xóa trực tiếp có lịch sử. Không có hàng đợi xin duyệt hoặc
  nút yêu cầu người khác duyệt. Phiên đăng nhập không cấp thêm quyền tài chính.
- **Bằng chứng:** API đúng/sai quyền, dữ liệu và lịch sử trước/sau.

---

### TC-RBAC-008 — Bảo vệ chi phí đã ghi sổ/thanh toán/chốt kỳ

- **Mã PRD:** TC-MO2C-17, O2C Bước 0; **Mức độ:** P0.
- **Các bước:** thử sửa đè/xóa thường khoản đã ghi sổ, đã trả hoặc khóa kỳ; dùng
  hành động điều chỉnh/đảo được phép với lý do, phiên bản và kỳ hợp lệ.
- **Pass:** không mất giao dịch gốc, phân bổ hay lịch sử. Bảo vệ tài chính vẫn
  áp dụng kể cả ADMIN; hành động điều chỉnh hợp lệ thực hiện trực tiếp. Không
  yêu cầu duyệt, không hiểu mã `APPROVED` lịch sử là quyền sửa/xóa hiện tại.
- **Bằng chứng:** lỗi dữ liệu/khóa kỳ; giao dịch điều chỉnh và liên kết nguồn.

---



## 7.5 — Hủy chuyến / Ngoại lệ

### TC-RBAC-009 — Hủy chuyến phải qua quyền/lý do/audit

- **Mã PRD:** TC-MO2C-16
- **Vai trò:** `ADMIN`
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

### TC-RBAC-011 — Hai thao tác đối chiếu cùng phiên bản không ghi trùng

- **Mã PRD:** Q23; **Mức độ:** P0.
- **Các bước:** hai người có quyền đồng thời ghi nhận/đối chiếu cùng khoản chi
  với cùng phiên bản; thử lại cùng khóa idempotency của yêu cầu thành công.
- **Pass:** chỉ một thay đổi và một kết quả tài chính được ghi. Yêu cầu cạnh
  tranh nhận xung đột rõ; thử lại cùng yêu cầu trả kết quả đã có. Không sinh
  approval state, hai khoản tiền hoặc sửa đè thay đổi người trước.
- **Bằng chứng:** kết quả API, phiên bản, lịch sử và nguồn chi phí trước/sau.

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
| __/__/__ | TC-RBAC-008 | | | Bảo vệ chi phí đã ghi sổ/thanh toán/chốt kỳ | |
| __/__/__ | TC-RBAC-009 | | | Hủy chuyến | |
| __/__/__ | TC-RBAC-010 | | | Conflict 409 | |
| __/__/__ | TC-RBAC-011 | | | Đối chiếu đồng thời không ghi trùng | |
| __/__/__ | TC-RBAC-012 | | | Sidebar theo vai trò | |
| __/__/__ | TC-RBAC-013 | | | Staff thấy toàn bộ KH/lô | |
| __/__/__ | TC-RBAC-014 | | | CUS allowance KH + site (POST-only) | |
| __/__/__ | TC-RBAC-015 | | | CUS & Dispatcher edit/delete routes + customers | |
