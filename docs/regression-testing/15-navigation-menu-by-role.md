# Điều hướng & Menu theo vai trò (Navigation by Role)

> **Phân hệ xuyên suốt.** Nguồn PRD: `docs/prd/sidebar-organization-by-role.txt` (cập nhật 06/08/2026).
> Bộ ca này kiểm thử **sự sắp xếp menu, đường dẫn, trang bắt đầu và quyền truy cập** cho từng vai trò,
> trên cả máy tính và điện thoại.
>
> **Mục đích nghiệp vụ.** Menu được sắp xếp theo công việc chính của người sử dụng để tìm đúng chức năng
> nhanh và tránh hiển thị trang không có quyền. Mọi vai trò phải có trải nghiệm menu nhất quán giữa
> desktop và mobile.
>
> **Tiêu chí nghiệm thu toàn phân hệ:** `NAV-HT-01` … `NAV-HT-10` (xem `00-cross-cutting.md`).
>
> **8 vai trò:** Quản trị viên (ADMIN), Quản lý (MANAGER), Kế toán (ACCOUNTANT), Điều vận (DISPATCHER),
> Nhân viên chứng từ/CUS (CLERK), Nhân viên hiện trường/Ops (FORWARDER), Lái xe (DRIVER), Khách hàng (CUSTOMER).

---

## 1. Nguyên tắc chung (áp dụng cho mọi vai trò)

Các nguyên tắc sau đây là **điểm kiểm soát** PRD yêu cầu — mỗi nguyên tắc có ít nhất 1 ca kiểm thử.

| Mã    | Nguyên tắc                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------ |
| NP-01 | Tên trang, thứ tự và quyền truy cập **giống nhau** trên máy tính và điện thoại                          |
| NP-02 | Trang đang mở được **đánh dấu rõ** trên menu                                                           |
| NP-03 | Mỗi nút bấm có **vùng thao tác đủ lớn** (thuận tiện điện thoại, nút chạm ≥ 44px)                        |
| NP-04 | Khi mở trang bắt đầu, nhóm công việc **quan trọng nhất** của vai trò được mở sẵn; nhóm còn lại thu gọn |
| NP-05 | Nếu màn hình thấp, phần menu có thể **cuộn riêng**                                                        |
| NP-06 | Kế toán chỉ có **một trang bắt đầu** là "Tổng Quan" (`/accounting`)                                     |
| NP-07 | Kế toán **không nhìn thấy** "Tổng quan" Ban điều hành (`/dashboard`) và "Phân xe" (`/dispatch`)         |
| NP-08 | Khách hàng dùng **menu riêng** của Cổng khách hàng                                                       |

### TC-NAV-G-01 — Trang đang mở được đánh dấu (NP-02)

- **Mã PRD:** Nguyên tắc chung NP-02
- **Vai trò:** `admin` (rồi lặp lại mỗi vai trò)
- **Các bước:**
  1. Đăng nhập `admin`, mở `/trips`.
  2. Quan sát sidebar/menu.
  3. Mở lần lượt `/debt`, `/salary`, `/customers`, kiểm tra highlight mỗi lần.
- **Kết quả mong đợi (Pass):**
  - Mục menu tương ứng trang đang mở được **đánh dấu rõ** (màu nền/icon/border) khác biệt với các mục khác.
  - Đánh dấu đúng ngay cả khi vào URL trực tiếp (không qua click).
- **Bằng chứng:** ảnh sidebar với 3 trang khác nhau, highlight đúng.

### TC-NAV-G-02 — Vùng thao tác nút ≥ 44px trên mobile (NP-03)

- **Mã PRD:** Nguyên tắc chung NP-03
- **Vai trò:** `laixe` (bottom nav)
- **Các bước:**
  1. DevTools Device Toolbar → iPhone SE (375×667).
  2. Đăng nhập `laixe`, đo kích thước từng mục thanh menu dưới.
  3. Lặp lại với `admin` sidebar (nút menu).
- **Kết quả mong đợi (Pass):**
  - Mọi mục menu/nút điều hướng vùng chạm ≥ 44×44px (DevTools đo element).
  - Không có mục chạm quá nhỏ gây bấm trượt.
- **Bằng chứng:** ảnh DevTools đo element + ảnh thanh menu mobile.

### TC-NAV-G-03 — Trang bắt đầu mở sẵn nhóm quan trọng nhất (NP-04)

- **Mã PRD:** Nguyên tắc chung NP-04
- **Vai trò:** `admin`, `ketoan`
- **Các bước:**
  1. Đăng nhập `admin` → quan sát nhóm nào mở sẵn tại `/dashboard`.
  2. Đăng nhập `ketoan` → quan sát `/accounting`.
- **Kết quả mong đợi (Pass):**
  - Nhóm công việc quan trọng nhất (vd Vận hành với admin, Công nợ với ketoan) mở sẵn.
  - Các nhóm khác thu gọn, có thể mở rộng.
- **Bằng chứng:** ảnh trang bắt đầu mỗi vai trò với trạng thái mở/thu gọn.

### TC-NAV-G-04 — Menu cuộn riêng khi màn hình thấp (NP-05)

- **Mã PRD:** Nguyên tắc chung NP-05
- **Vai trò:** `admin` (menu dài nhất)
- **Các bước:**
  1. Đặt viewport cao thấp (vd 600px).
  2. Mở sidebar `admin`, cuộn phần menu.
- **Kết quả mong đợi (Pass):**
  - Phần menu cuộn độc lập, không đẩy/nhảy nội dung trang.
  - Có thanh cuộn hoặc scroll indicator.
- **Bằng chứng:** ảnh menu đang cuộn riêng ở viewport thấp.

### TC-NAV-G-05 — Desktop và mobile đồng nhất (NP-01)

- **Mã PRD:** Nguyên tắc chung NP-01
- **Vai trò:** `admin`, `laixe`
- **Các bước:**
  1. Desktop 1440×900: ghi chú tên trang, thứ tự nhóm, quyền truy cập menu `admin`.
  2. Mobile 375×667: so sánh cùng `admin`.
  3. Lặp lại với `laixe` (desktop nhóm "Công việc của tôi" vs mobile bottom nav).
- **Kết quả mong đợi (Pass):**
  - Tên trang, thứ tự, quyền truy cập **giống nhau** giữa desktop và mobile.
  - Khác biệt duy nhất là cách trình bày (sidebar vs bottom nav cho Lái xe), **không** khác nội dung.
- **Bằng chứng:** ảnh song song desktop/mobile cho 2 vai trò.

---

## 2. ADMIN (Quản trị viên)

**Trang bắt đầu:** `/dashboard`

| Nhóm                | Mục                                | Đường dẫn                  |
| ------------------- | ---------------------------------- | -------------------------- |
| Trang bắt đầu       | Tổng quan Quản trị                 | `/dashboard`               |
| Vận hành            | Lô hàng                            | `/shipments`               |
|                     | Phân bổ Phương tiện (Điều vận)     | `/dispatch`                |
|                     | Sổ chuyến đi                       | `/trips`                   |
|                     | Quản lý Đội xe (Fleet)             | `/fleet`                   |
| Báo cáo & Phê duyệt | Báo cáo Lãi lỗ                     | `/finance`                 |
|                     | Báo cáo Lợi nhuận                  | `/profit`                  |
|                     | Duyệt vượt hạn mức                 | `/credit-overrides`        |
|                     | Trung tâm phê duyệt (Approve Hub)  | `/governance-actions`      |
| Công nợ & Dòng tiền | Sổ quỹ / Ngân hàng                 | `/finance/treasury` *(cq)* |
|                     | Công nợ phải thu (AR)              | `/debt`                    |
|                     | Công nợ phải trả (AP)              | `/payables`                |
|                     | Chi phí phát sinh                  | `/expenses`                |
|                     | Tạm ứng & Hoàn ứng                 | `/advances`                |
| Nhân sự             | Lương & Chấm công                  | `/salary`                  |
|                     | Kỷ luật                            | `/penalties`               |
| Danh mục            | Khách hàng                         | `/customers`               |
|                     | Nhà cung cấp / Nhà xe              | `/suppliers`               |
|                     | Tuyến đường                        | `/config/routes`           |
|                     | Nhà máy                            | `/config/factories`        |
|                     | Cảng / Bãi & Biểu phí             | `/config/ports`            |
|                     | Bảng giá cước                      | `/config/pricing-tables`   |
| Hệ thống            | Quản lý Người dùng                 | `/users`                   |
|                     | Nhật ký hệ thống (Audit Logs)      | `/audit-logs`              |
|                     | Cấu hình chung                     | `/config`                  |
|                     | Cài đặt ứng dụng                   | `/config/app-settings`     |

> *(cq)* = chỉ hiển thị khi tài khoản được cấp quyền xem sổ quỹ.

### TC-NAV-ADMIN-01 — Trang bắt đầu và thứ tự nhóm

- **Mã PRD:** ADMIN — Trang bắt đầu + thứ tự nhóm
- **Vai trò:** `admin`
- **Các bước:**
  1. Đăng nhập `admin`.
  2. Kiểm tra trang bắt đầu = `/dashboard`.
  3. Kiểm tra thứ tự 6 nhóm: Vận hành → Công nợ → Báo cáo → Nhân sự → Danh mục → Quản trị.
- **Kết quả mong đợi (Pass):**
  - Bắt đầu tại `/dashboard`, không bị đẩy đi trang khác.
  - Thứ tự nhóm đúng như bảng trên.
- **Bằng chứng:** ảnh sidebar đầy đủ + URL thanh địa chỉ.

### TC-NAV-ADMIN-02 — Sổ quỹ chỉ hiện khi được cấp quyền (cq)

- **Mã PRD:** ADMIN — `/finance/treasury` (Chỉ hiển thị khi được cấp quyền)
- **Vai trò:** `admin`
- **Tiền điều kiện:** 2 tài khoản ADMIN — 1 có quyền sổ quỹ, 1 không.
- **Các bước:**
  1. Đăng nhập admin **có** quyền sổ quỹ → kiểm tra menu.
  2. Đăng nhập admin **không** có quyền sổ quỹ → kiểm tra menu.
  3. Thử truy cập trực tiếp `/finance/treasury` với admin không có quyền.
- **Kết quả mong đợi (Pass):**
  - Có quyền: mục "Sổ quỹ / ngân hàng" hiển thị.
  - Không quyền: mục **ẩn**; URL trực tiếp → redirect/403.
- **Bằng chứng:** ảnh menu 2 trường hợp + ảnh redirect.

### TC-NAV-ADMIN-03 — Tất cả mục ADMIN truy cập được

- **Mã PRD:** ADMIN toàn bộ
- **Vai trò:** `admin`
- **Các bước:**
  1. Bấm lần lượt từng mục trong bảng ADMIN.
  2. Kiểm tra mỗi trang load không lỗi 500/403.
- **Kết quả mong đợi (Pass):**
  - Mỗi đường dẫn load thành công (200), không redirect do thiếu quyền.
  - Breadcrumb/tiêu đề trang khớp tên menu.
- **Bằng chứng:** bảng liệt kê từng URL + mã HTTP.

---

## 3. MANAGER (Quản lý)

**Trang bắt đầu:** `/dashboard`

Cấu trúc giống ADMIN nhưng:
- **Không có** nhóm Quản trị đầy đủ; chỉ có nhóm **Hệ thống**: Người dùng (`/users`), Nhật ký người dùng (`/audit-logs`), Cấu hình (`/config`).
- **Không có** "Cài đặt ứng dụng" (`/config/app-settings`) và "Giám sát Chatbot" (`/chatbot-monitoring`).

| Nhóm Hệ thống (MANAGER) | Mục                | Đường dẫn      |
| ----------------------- | ------------------ | -------------- |
|                         | Người dùng         | `/users`       |
|                         | Nhật ký người dùng | `/audit-logs`  |
|                         | Cấu hình           | `/config`      |

### TC-NAV-MGR-01 — Thứ tự nhóm + trang bắt đầu

- **Mã PRD:** MANAGER — Trang bắt đầu + nhóm
- **Vai trò:** `giamdoc`
- **Các bước:**
  1. Đăng nhập `giamdoc`.
  2. Kiểm tra trang bắt đầu = `/dashboard`.
  3. Kiểm tra nhóm: Vận hành → Báo cáo & Phê duyệt → Công nợ → Nhân sự → Danh mục → Hệ thống.
- **Kết quả mong đợi (Pass):**
  - Bắt đầu `/dashboard`.
  - Thứ tự nhóm đúng; nhóm cuối là "Hệ thống" (3 mục), **không** có "Quản trị".
- **Bằng chứng:** ảnh sidebar đầy đủ `giamdoc`.

### TC-NAV-MGR-02 — Không thấy "Cài đặt ứng dụng" và "Giám sát Chatbot"

- **Mã PRD:** MANAGER — không có `/config/app-settings`, `/chatbot-monitoring`
- **Vai trò:** `giamdoc`
- **Các bước:**
  1. `giamdoc` kiểm tra menu — không có "Cài đặt ứng dụng", "Giám sát Chatbot".
  2. Truy cập trực tiếp `/config/app-settings`, `/chatbot-monitoring`.
- **Kết quả mong đợi (Pass):**
  - 2 mục ẩn trên menu.
  - URL trực tiếp → redirect/403 (DevTools 403).
- **Bằng chứng:** ảnh menu (không có 2 mục) + ảnh DevTools 403.

---

## 4. DISPATCHER (Điều vận)

**Trang bắt đầu:** `/dispatch`

| Nhóm                  | Mục                           | Đường dẫn                    |
| --------------------- | ----------------------------- | ---------------------------- |
| Điều độ Phương tiện   | Kế hoạch Tổng quát (Gán Nhà xe) | `/dispatch`     |
|                       | Kế hoạch Chi tiết (Gán BKS)   | `/dispatch-detail`   |
|                       | Theo dõi Lộ trình              | `/dispatch/live-tracking`    |
| Quản lý Tài nguyên   | Danh mục Xe nội bộ            | `/fleet/vehicles`            |
|                       | Danh mục Tài xế                | `/fleet/drivers`             |
|                       | Nhà thầu phụ (Subcontractors)  | `/suppliers`                 |

### TC-NAV-DISPATCHER-01 — Trang bắt đầu + nhóm Điều độ Phương tiện

- **Mã PRD:** DISPATCHER — Trang bắt đầu + nhóm
- **Vai trò:** `dieuvan`
- **Các bước:**
  1. Đăng nhập `dieuvan`.
  2. Kiểm tra URL bắt đầu = `/dispatch`.
  3. Kiểm tra nhóm "Điều độ Phương tiện": 3 mục đúng.
  4. Kiểm tra nhóm "Quản lý Tài nguyên": 3 mục đúng.
- **Kết quả mong đợi (Pass):**
  - Bắt đầu `/dispatch`.
  - 6 mục đúng tên và đường dẫn.
- **Bằng chứng:** ảnh trang bắt đầu + menu đầy đủ.

### TC-NAV-DISPATCHER-02 — DISPATCHER không truy cập trang khác

- **Mã PRD:** DISPATCHER — RBAC
- **Vai trò:** `dieuvan`
- **Các bước:** thử `/dashboard`, `/debt`, `/accounting`, `/salary`, `/config`.
- **Kết quả mong đợi (Pass):** redirect về `/dispatch` hoặc 403.
- **Bằng chứng:** ảnh redirect.

---

## 5. ACCOUNTANT (Kế toán)

**Trang bắt đầu:** `/accounting` (Tổng Quan kế toán — **không phải** `/dashboard`)

**Đặc biệt quan trọng (NP-06, NP-07):**
- Trang bắt đầu **duy nhất** là `/accounting`, **không phải** `/dashboard`.
- **Không nhìn thấy** "Tổng quan" Ban điều hành (`/dashboard`).
- **Không nhìn thấy** "Phân xe" (`/dispatch`).
- **Không nhìn thấy** "Cài đặt ứng dụng" (`/config/app-settings`), "Giám sát Chatbot" (`/chatbot-monitoring`).
- Nhóm "Vận hành liên quan" **không có** "Phân xe" (chỉ Đội xe, Sổ chuyến đi, Lô hàng).

| Nhóm                    | Mục                | Đường dẫn            | Ghi chú                |
| ----------------------- | ------------------ | -------------------- | ---------------------- |
| Trang bắt đầu           | Tổng Quan          | `/accounting`        | duy nhất, không /dashboard |
| Công nợ & Dòng tiền     | (như ADMIN)        | `/debt` … `/advances` | Sổ quỹ cq              |
| Báo cáo & Phê duyệt     | (như ADMIN)        | `/profit` … `/governance-actions` |            |
| Vận hành liên quan      | Đội xe             | `/fleet`             |                        |
|                         | Sổ chuyến đi       | `/trips`             |                        |
|                         | Lô hàng            | `/shipments`         |                        |
| Nhân sự                 | Lương & Chấm công  | `/salary`            |                        |
|                         | Kỷ luật            | `/penalties`         |                        |
| Danh mục                | Khách hàng         | `/customers`         |                        |
|                         | Nhà cung cấp       | `/suppliers`         |                        |
|                         | Tuyến đường        | `/config/routes`     |                        |
| Hệ thống                | Người dùng         | `/users`             |                        |
|                         | Nhật ký người dùng | `/audit-logs`        |                        |
|                         | Cấu hình           | `/config`            |                        |

### TC-NAV-ACC-01 — Trang bắt đầu là `/accounting`, không phải `/dashboard` (NP-06)

- **Mã PRD:** ACCOUNTANT — Trang bắt đầu /accounting
- **Vai trò:** `ketoan`
- **Các bước:**
  1. Đăng nhập `ketoan`.
  2. Kiểm tra URL đích sau đăng nhập.
- **Kết quả mong đợi (Pass):**
  - Đích đến = `/accounting` (Tổng Quan kế toán), **không** `/dashboard`.
  - Trang "Tổng Quan" kế toán khác nội dung với dashboard Ban điều hành.
- **Bằng chứng:** ảnh trang bắt đầu + URL.

### TC-NAV-ACC-02 — Kế toán không thấy "Tổng quan" Ban điều hành (NP-07)

- **Mã PRD:** ACCOUNTANT — Không nhìn thấy /dashboard
- **Vai trò:** `ketoan`
- **Các bước:**
  1. `ketoan` kiểm tra menu — không có "Tổng quan" Ban điều hành.
  2. Truy cập trực tiếp `/dashboard`.
- **Kết quả mong đợi (Pass):**
  - Không có mục "Tổng quan" (`/dashboard`) trên menu.
  - URL trực tiếp `/dashboard` → redirect về `/accounting` hoặc trang "Không có quyền".
  - Không rò rỉ số liệu dashboard qua response.
- **Bằng chứng:** ảnh menu + ảnh redirect + DevTools.

### TC-NAV-ACC-03 — Kế toán không thấy "Phân xe" (NP-07)

- **Mã PRD:** ACCOUNTANT — Không nhìn thấy /dispatch
- **Vai trò:** `ketoan`
- **Các bước:**
  1. `ketoan` kiểm tra nhóm "Vận hành liên quan" — chỉ có Đội xe, Sổ chuyến đi, Lô hàng.
  2. Truy cập trực tiếp `/dispatch`.
- **Kết quả mong đợi (Pass):**
  - **Không có** "Phân xe" trên menu.
  - `/dispatch` trực tiếp → redirect/403.
- **Bằng chứng:** ảnh menu nhóm vận hành + ảnh redirect.

### TC-NAV-ACC-04 — Kế toán không thấy Cài đặt ứng dụng & Giám sát Chatbot

- **Mã PRD:** ACCOUNTANT — ẩn `/config/app-settings`, `/chatbot-monitoring`
- **Vai trò:** `ketoan`
- **Các bước:**
  1. `ketoan` kiểm tra menu — không có 2 mục này.
  2. Truy cập trực tiếp cả 2 URL.
- **Kết quả mong đợi (Pass):**
  - 2 mục ẩn; URL trực tiếp → redirect/403.
- **Bằng chứng:** ảnh menu + DevTools 403.

### TC-NAV-ACC-05 — Nhóm "Vận hành liên quan" đúng 3 mục

- **Mã PRD:** ACCOUNTANT — Vận hành liên quan
- **Vai trò:** `ketoan`
- **Các bước:** kiểm tra nhóm "Vận hành liên quan" có đúng Đội xe / Sổ chuyến đi / Lô hàng.
- **Kết quả mong đợi (Pass):** đúng 3 mục, không có "Phân xe", thứ tự đúng.
- **Bằng chứng:** ảnh nhóm.

---

## 5. DRIVER (Lái xe)

**Trang bắt đầu:** `/my-trips`

PRD quy định: trên máy tính các chức năng nằm trong nhóm "Công việc của tôi"; trên điện thoại các chức
năng chính nằm ở **thanh menu phía dưới** (bottom navigation).

| Mục         | Đường dẫn         |
| ----------- | ----------------- |
| Hành trình  | `/my-trips`       |
| Thu nhập    | `/my-earnings`    |
| Kỷ luật     | `/my-penalties`   |
| Tài khoản   | (mở bảng thông tin tài khoản, **không chuyển trang**) |

### TC-NAV-DRV-01 — Trang bắt đầu `/my-trips` + 3 mục

- **Mã PRD:** DRIVER — Trang bắt đầu + menu
- **Vai trò:** `laixe`
- **Các bước:**
  1. Đăng nhập `laixe`.
  2. Kiểm tra URL bắt đầu = `/my-trips`.
  3. Kiểm tra 3 mục: Hành trình, Thu nhập, Kỷ luật.
- **Kết quả mong đợi (Pass):**
  - Bắt đầu `/my-trips`.
  - 3 mục đúng tên và đường dẫn.
- **Bằng chứng:** ảnh trang bắt đầu + menu.

### TC-NAV-DRV-02 — "Tài khoản" mở bảng thông tin, không chuyển trang

- **Mã PRD:** DRIVER — Tài khoản (modal/drawer)
- **Vai trò:** `laixe`
- **Các bước:**
  1. `laixe` bấm "Tài khoản".
  2. Kiểm tra URL không đổi.
- **Kết quả mong đợi (Pass):**
  - Mở modal/drawer/bảng thông tin tài khoản.
  - URL **không thay đổi** (không navigate).
- **Bằng chứng:** ảnh modal tài khoản + thanh URL không đổi.

### TC-NAV-DRV-03 — Mobile dùng bottom navigation

- **Mã PRD:** DRIVER — Điện thoại thanh menu dưới
- **Vai trò:** `laixe`
- **Các bước:**
  1. iPhone SE (375×667), đăng nhập `laixe`.
  2. Kiểm tra thanh menu **dưới** màn hình.
- **Kết quả mong đợi (Pass):**
  - Mobile: 3 chức năng chính ở **thanh menu dưới** (bottom nav).
  - Mục "Tài khoản" cũng ở dưới hoặc có nút riêng.
- **Bằng chứng:** ảnh mobile bottom nav.

### TC-NAV-DRV-04 — Lái xe không truy cập được trang nội bộ

- **Mã PRD:** DRIVER — RBAC
- **Vai trò:** `laixe`
- **Các bước:** thử `/dashboard`, `/debt`, `/payables`, `/dispatch`, `/salary`.
- **Kết quả mong đợi (Pass):** đều redirect về `/my-trips` hoặc trang "Không có quyền"; API 403.
- **Bằng chứng:** ảnh redirect + DevTools.

---

## 6. FORWARDER (Nhân viên hiện trường / Giao nhận - Ops)

**Trang bắt đầu:** `/my-orders`

Nhóm "Công việc của tôi":

| Mục                   | Đường dẫn        |
| --------------------- | ---------------- |
| Lệnh giao nhận (Đổi lệnh) | `/my-orders`   |
| Yêu cầu Tạm ứng      | `/my-advances`   |
| Phiếu thanh toán / Hoàn ứng | `/my-settlements` |

### TC-NAV-FWD-01 — Trang bắt đầu + 3 mục

- **Mã PRD:** FORWARDER — Trang bắt đầu + nhóm
- **Vai trò:** `ops` hoặc `giaonhan`
- **Các bước:**
  1. Đăng nhập `ops`.
  2. Kiểm tra URL bắt đầu = `/my-orders`.
  3. Kiểm tra 3 mục: Lệnh giao nhận, Yêu cầu Tạm ứng, Phiếu thanh toán.
- **Kết quả mong đợi (Pass):**
  - Bắt đầu `/my-orders`.
  - 3 mục đúng tên và đường dẫn.
- **Bằng chứng:** ảnh trang bắt đầu + menu.

### TC-NAV-FWD-02 — FORWARDER không truy cập trang nội bộ

- **Mã PRD:** FORWARDER — RBAC
- **Vai trò:** `ops`
- **Các bước:** thử `/dashboard`, `/debt`, `/dispatch`, `/salary`, `/payables`.
- **Kết quả mong đợi (Pass):** redirect về `/my-orders` hoặc 403.
- **Bằng chứng:** ảnh redirect.

---

## 7. CLERK (Nhân viên chứng từ)

**Trang bắt đầu:** `/shipments`

| Nhóm        | Mục                    | Đường dẫn                  | Ghi chú        |
| ----------- | ---------------------- | -------------------------- | -------------- |
| Chứng từ    | Lô hàng được giao      | `/shipments`               |                |
|             | Tạo lô hàng            | `/shipments/new`           |                |
| Đối soát    | Chi phí cần kiểm tra   | `/recoverable-costs`       | *(cq)* chỉ khi được cấp quyền |

> *(cq)* chỉ hiển thị khi tài khoản được cấp quyền xem chi phí cần kiểm tra.

### TC-NAV-CLERK-01 — Trang bắt đầu + nhóm Chứng từ

- **Mã PRD:** CLERK — Trang bắt đầu + nhóm
- **Vai trò:** vai trò `CLERK`
- **Tiền điều kiện:** có tài khoản CLERK provision đúng phạm vi lô (xem `13-...md` §1.4).
- **Các bước:**
  1. Đăng nhập `CLERK`.
  2. Kiểm tra URL bắt đầu = `/shipments`.
  3. Kiểm tra nhóm "Chứng từ": Lô hàng được giao, Tạo lô hàng.
- **Kết quả mong đợi (Pass):**
  - Bắt đầu `/shipments`.
  - 2 mục nhóm Chứng từ đúng.
- **Bằng chứng:** ảnh trang bắt đầu + menu.

### TC-NAV-CLERK-02 — "Chi phí cần kiểm tra" chỉ hiện khi được cấp quyền (cq)

- **Mã PRD:** CLERK — `/recoverable-costs` (cq)
- **Vai trò:** `CLERK` (2 tài khoản: có/không quyền)
- **Các bước:**
  1. CLERK **có** quyền → menu hiện "Chi phí cần kiểm tra".
  2. CLERK **không** quyền → menu không hiện.
  3. CLERK không quyền truy cập trực tiếp `/recoverable-costs`.
- **Kết quả mong đợi (Pass):**
  - Có quyền: hiện + truy cập được.
  - Không quyền: ẩn; URL trực tiếp → redirect/403.
- **Bằng chứng:** ảnh menu 2 trường hợp + DevTools.

### TC-NAV-CLERK-03 — CLERK không truy cập trang tài chính/nhân sự

- **Mã PRD:** CLERK — RBAC
- **Vai trò:** `CLERK`
- **Các bước:** thử `/finance`, `/debt`, `/payables`, `/salary`, `/profit`.
- **Kết quả mong đợi (Pass):** redirect/403; không thấy dữ liệu.
- **Bằng chứng:** ảnh redirect + DevTools.

---

## 8. CUSTOMER (Khách hàng)

**Trang bắt đầu:** `/portal/shipments`

Khách hàng dùng **menu riêng** của Cổng khách hàng (NP-08):

| Mục               | Đường dẫn            |
| ----------------- | -------------------- |
| Lô hàng của tôi   | `/portal/shipments`  |
| Giấy báo nợ       | `/portal/debit-notes`|
| Sao kê công nợ    | `/portal/statement`  |

### TC-NAV-CUS-01 — Trang bắt đầu + 3 mục cổng khách hàng

- **Mã PRD:** CUSTOMER — Trang bắt đầu + menu cổng
- **Vai trò:** `customer`
- **Các bước:**
  1. Đăng nhập `customer`.
  2. Kiểm tra URL bắt đầu = `/portal/shipments`.
  3. Kiểm tra 3 mục: Lô hàng của tôi, Giấy báo nợ, Sao kê công nợ.
- **Kết quả mong đợi (Pass):**
  - Bắt đầu `/portal/shipments`.
  - 3 mục đúng, dùng layout cổng khách hàng (không sidebar nội bộ).
- **Bằng chứng:** ảnh cổng khách hàng + menu.

### TC-NAV-CUS-02 — "Sao kê công nợ" hoạt động

- **Mã PRD:** CUSTOMER — `/portal/statement`
- **Vai trò:** `customer`
- **Các bước:**
  1. `customer` bấm "Sao kê công nợ".
  2. Kiểm tra nội dung.
- **Kết quả mong đợi (Pass):**
  - Trang `/portal/statement` load, hiển thị sao kê công nợ **chỉ của khách hàng đó** (row-scope Q16).
  - Không thấy dữ liệu khách khác.
- **Phụ thuộc:** Q16 đã accepted.
- **Bằng chứng:** ảnh sao kê + đối chiếu với admin `/debt/:id`.

### TC-NAV-CUS-03 — CUSTOMER không truy cập trang nội bộ

- **Mã PRD:** CUSTOMER — RBAC + NP-08
- **Vai trò:** `customer`
- **Các bước:** thử `/dashboard`, `/trips`, `/debt`, `/shipments` (nội bộ, không phải portal).
- **Kết quả mong đợi (Pass):**
  - Tất cả redirect về `/portal/shipments` hoặc 403.
  - `/shipments` nội bộ không truy cập được (phải dùng `/portal/shipments`).
- **Bằng chứng:** ảnh redirect.

---

## 9. Trường hợp biên & nhất quán đa vai trò

### TC-NAV-X-01 — Bảng tổng hợp trang bắt đầu từng vai trò

- **Mã PRD:** PRD — Trang bắt đầu của từng vai trò
- **Vai trò:** tất cả 8 vai trò
- **Các bước:**
  1. Đăng nhập lần lượt 8 vai trò: admin, manager, accountant, dispatcher, clerk, ops, driver, customer.
  2. Ghi nhận URL bắt đầu của mỗi vai trò.
- **Kết quả mong đợi (Pass):**

  | Vai trò                  | URL bắt đầu               |
  | ------------------------ | ------------------------- |
  | Quản trị viên (ADMIN)    | `/dashboard`              |
  | Quản lý (MANAGER)        | `/dashboard`              |
  | Kế toán (ACCOUNTANT)     | `/accounting`             |
  | Điều vận (DISPATCHER)    | `/dispatch`   |
  | Nhân viên chứng từ (CLERK) | `/shipments`             |
  | Nhân viên hiện trường (FORWARDER/Ops) | `/my-orders` |
  | Lái xe (DRIVER)          | `/my-trips`               |
  | Khách hàng (CUSTOMER)    | `/portal/shipments`       |

- **Bằng chứng:** bảng ảnh 8 trang bắt đầu.

### TC-NAV-X-02 — Phân quyền URL trực tiếp (negative path) tổng hợp

- **Mã PRD:** Nguyên tắc chung + RBAC từng vai trò
- **Vai trò:** tất cả
- **Các bước:** mỗi vai trò thử truy cập trực tiếp các URL **không thuộc** menu mình (xem các ca TC-NAV-*-04/03 cụ thể).
- **Kết quả mong đợi (Pass):**
  - Mọi URL không thuộc quyền → redirect về trang nhà của vai trò hoặc trang "Không có quyền".
  - API trả 403; không rò rỉ dữ liệu trong response body.
- **Bằng chứng:** ma trận vai trò × URL với kết quả redirect/403.

### TC-NAV-X-03 — Nhất quán tên trang desktop vs mobile (NP-01) — tất cả vai trò

- **Mã PRD:** NP-01
- **Vai trò:** tất cả 7
- **Các bước:** với mỗi vai trò, so sánh menu desktop (1440) vs mobile (375).
- **Kết quả mong đợi (Pass):** tên trang, thứ tự, quyền truy cập đồng nhất (chỉ khác cách trình bày).
- **Bằng chứng:** bảng ảnh so sánh cho mỗi vai trò.

---

## 10. Bảng nghiệm thu

| Ngày thử | Mã TC           | Người thử | Kết quả | Lỗi ghi chú | Bằng chứng |
| -------- | --------------- | --------- | ------- | ----------- | ---------- |
| __/__/__ | TC-NAV-G-01     |           |         |             |            |
| __/__/__ | TC-NAV-G-02     |           |         |             |            |
| __/__/__ | TC-NAV-G-03     |           |         |             |            |
| __/__/__ | TC-NAV-G-04     |           |         |             |            |
| __/__/__ | TC-NAV-G-05     |           |         |             |            |
| __/__/__ | TC-NAV-ADMIN-01 |           |         |             |            |
| __/__/__ | TC-NAV-ADMIN-02 |           |         |             |            |
| __/__/__ | TC-NAV-ADMIN-03 |           |         |             |            |
| __/__/__ | TC-NAV-MGR-01   |           |         |             |            |
| __/__/__ | TC-NAV-MGR-02   |           |         |             |            |
| __/__/__ | TC-NAV-ACC-01   |           |         |             |            |
| __/__/__ | TC-NAV-ACC-02   |           |         |             |            |
| __/__/__ | TC-NAV-ACC-03   |           |         |             |            |
| __/__/__ | TC-NAV-ACC-04   |           |         |             |            |
| __/__/__ | TC-NAV-ACC-05   |           |         |             |            |
| __/__/__ | TC-NAV-DRV-01   |           |         |             |            |
| __/__/__ | TC-NAV-DRV-02   |           |         |             |            |
| __/__/__ | TC-NAV-DRV-03   |           |         |             |            |
| __/__/__ | TC-NAV-DRV-04   |           |         |             |            |
| __/__/__ | TC-NAV-FWD-01   |           |         |             |            |
| __/__/__ | TC-NAV-FWD-02   |           |         |             |            |
| __/__/__ | TC-NAV-CLERK-01 |           |         |             |            |
| __/__/__ | TC-NAV-CLERK-02 |           |         |             |            |
| __/__/__ | TC-NAV-CLERK-03 |           |         |             |            |
| __/__/__ | TC-NAV-CUS-01   |           |         |             |            |
| __/__/__ | TC-NAV-CUS-02   |           |         |             |            |
| __/__/__ | TC-NAV-CUS-03   |           |         |             |            |
| __/__/__ | TC-NAV-X-01     |           |         |             |            |
| __/__/__ | TC-NAV-X-02     |           |         |             |            |
| __/__/__ | TC-NAV-X-03     |           |         |             |            |

---

## 11. Tiêu chí nghiệm thu toàn phân hệ NAV-HT-01 … NAV-HT-10

Chạy các TC-HT-01 … TC-HT-10 từ [`00-cross-cutting.md`](./00-cross-cutting.md) áp dụng trên menu/điều hướng.

| Mã HT      | Nhóm kiểm tra   | Cách thử trên điều hướng                                                                       | Kết quả | Bằng chứng |
| ---------- | --------------- | --------------------------------------------------------------------------------------------- | ------- | ---------- |
| NAV-HT-01  | Ngôn ngữ        | Tên trang, nhóm menu bằng tiếng Việt; không thuật ngữ Anh không duyệt.                        |         |            |
| NAV-HT-02  | Phân quyền      | TC-NAV-*-04/03, TC-NAV-X-02 — URL trực tiếp không vượt quyền.                                 |         |            |
| NAV-HT-03  | Nhật ký         | Bấm qua menu đổi trang → audit log (nếu có) ghi.                                              |         |            |
| NAV-HT-04  | Tính toàn vẹn   | Mở cùng lúc 2 tab, chuyển trang → không lock/hỏng state.                                      |         |            |
| NAV-HT-05  | Tiền tệ         | N/A (menu không hiển thị tiền) — áp dụng cho trang đích.                                      |         |            |
| NAV-HT-06  | Ngày giờ        | N/A.                                                                                          |         |            |
| NAV-HT-07  | Thiết bị        | TC-NAV-G-02, TC-NAV-G-04, TC-NAV-X-03 — responsive + cuộn riêng + nút ≥44px.                 |         |            |
| NAV-HT-08  | Khôi phục lỗi   | Mất mạng khi chuyển trang → menu vẫn dùng được sau online lại.                                |         |            |
| NAV-HT-09  | Tìm & xuất      | N/A.                                                                                          |         |            |
| NAV-HT-10  | Đối chiếu liên  | Trang bắt đầu + menu khớp với quyền thực tế (cosync với backend RBAC).                       |         |            |

> **Liên phân hệ cần chạy kèm khi điều hướng đổi:**
>
> - **M01–M12:** mọi thay đổi route mới phải được thêm vào đúng nhóm vai trò và có ca ở đây.
> - Khi thêm route mới, cập nhật bảng vai trò (§2–§8) và thêm ca `TC-NAV-<ROLE>-<NN>`.
