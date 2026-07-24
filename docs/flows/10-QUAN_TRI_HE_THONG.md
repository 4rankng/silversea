# 10. Quản trị hệ thống — Tài khoản & Nhật ký hoạt động

| Mục | Chi tiết |
|-----|----------|
| **Route** | `/users`, `/audit-logs` |
| **Roles** | ADMIN (đầy đủ), MANAGER/ACCOUNTANT (chỉ xem), DRIVER (không truy cập → redirect) |
| **API** | `/api/auth/users`, `/api/audit-logs` |

---

## 1. Tổng quan

Module Quản trị hệ thống bao gồm 2 trang:

1. **Tài khoản người dùng** (`/users`) — Quản lý CRUD tài khoản hệ thống: tạo, sửa vai trò/trạng thái, đặt lại mật khẩu, xoá.
2. **Nhật ký hoạt động** (`/audit-logs`) — Xem lịch sử mọi hành động trên hệ thống: tạo chuyến, thanh toán, đăng nhập, v.v.

### Phân quyền theo vai trò

| Vai trò | `/users` | `/audit-logs` |
|--------|----------|---------------|
| ADMIN (Quản trị) | Đầy đủ: xem, tạo, sửa, xoá | Xem đầy đủ |
| MANAGER (Quản lý) | Chỉ xem (không CRUD) | Xem đầy đủ |
| ACCOUNTANT (Kế toán) | Chỉ xem (không CRUD) | Xem đầy đủ |
| DRIVER (Lái xe) | Không truy cập → redirect | Không truy cập → redirect |

---

## 2. Hướng dẫn sử dụng

### 2.1. Trang Tài khoản người dùng (`/users`)

#### Header

- Tiêu đề: **"Tài khoản người dùng"**
- Phụ đề hiển thị tổng số tài khoản, số nhân sự văn phòng, số lái xe
- Nút **"Thêm tài khoản"** — chỉ hiển thị cho ADMIN

#### 4 KPI Cards

| # | KPI | Mô tả | Màu |
|---|-----|--------|-----|
| 1 | Tổng tài khoản | Tổng số user trong hệ thống | Mặc định |
| 2 | Nhân sự văn phòng | ADMIN + MANAGER + ACCOUNTANT | warn (vàng) |
| 3 | Lái xe | Số user có role DRIVER | success (xanh lá) |
| 4 | Bị khoá / Ngưng | Số user trạng thái INACTIVE | danger (đỏ) |

#### Bộ lọc (Filter Toolbar)

- **Role pills** (tab lọc theo vai trò):
  - Tất cả (tổng)
  - Quản trị (số ADMIN)
  - Quản lý (số MANAGER)
  - Kế toán (số ACCOUNTANT)
  - Lái xe (số DRIVER)
- **Ô tìm kiếm**: tìm theo username, email, hoặc SĐT

#### Form thêm tài khoản (ADMIN only)

Khi bấm **"Thêm tài khoản"**, hiện form inline gồm:

| Trường | Loại | Ghi chú |
|---------|------|----------|
| Username | Text input | Bắt buộc (cần ít nhất 1 trong 3: username/email/phone) |
| Email | Email input | Bắt buộc (cần ít nhất 1 trong 3) |
| SĐT | Tel input | Bắt buộc (cần ít nhất 1 trong 3) |
| Vai trò | Select | ADMIN / MANAGER / ACCOUNTANT / DRIVER |
| Mật khẩu* | Password input | Tối thiểu 6 ký tự; có nút show/hide (con mắt) |

**Validation:**

- Phải nhập ít nhất username HOẶC email HOẶC SĐT
- Mật khẩu bắt buộc, tối thiểu 6 ký tự
- Gọi API `POST /api/auth/users` để tạo

#### Bảng Desktop

| Cột | Nội dung |
|------|----------|
| Tài khoản | Avatar + Username + ID |
| Liên hệ | Email + SĐT |
| Vai trò | Role pill (xem bảng màu bên dưới) |
| Trạng thái | ACTIVE (xanh) / INACTIVE (đỏ) |
| Ngày tạo | dd/MM/yyyy |
| Actions | Nút Edit / Delete (ADMIN only) |

**Chế độ Edit (inline row):**

- Chuyển dòng thành form chỉnh sửa
- Vai trò: dropdown select (4 vai trò)
- Trạng thái: dropdown select (ACTIVE / INACTIVE)
- Đặt lại mật khẩu: input tuỳ chọn (để trống = không đổi)
- Nút Lưu / Huỷ

**Xoá tài khoản:**

- Hiện dialog xác nhận
- Không thể xoá chính mình (nút bị disable hoặc báo lỗi)

#### Mobile — Card View

Mỗi tài khoản hiển thị dạng card với đầy đủ thông tin: avatar, username, email, SĐT, vai trò pill, trạng thái pill, ngày tạo, nút Edit/Delete (ADMIN only).

#### Role Pills — Bảng màu

| Role | Label | Màu pill |
|------|-------|----------|
| ADMIN | Quản trị | danger (đỏ) |
| MANAGER | Quản lý | warn (vàng) |
| ACCOUNTANT | Kế toán | neutral (xám) |
| DRIVER | Lái xe | success (xanh lá) |

---

### 2.2. Trang Nhật ký hoạt động (`/audit-logs`)

#### Header

- Tiêu đề: **"Nhật ký người dùng"**

#### 4 KPI Cards

| # | KPI | Mô tả |
|---|-----|--------|
| 1 | Hành động hôm nay | Số event trong ngày |
| 2 | Người dùng hoạt động | Số unique user hoạt động trong 24h |
| 3 | Phổ biến nhất | Danh mục có nhiều event nhất |
| 4 | Hoạt động gần nhất | Thời gian tương đối (vd: "5 phút trước") |

#### Bộ lọc (Filter Bar)

- **Category pills:**
  - Tất cả
  - Chuyến đi (icon truck) — category: `trip`
  - Cấu hình (icon settings) — category: `config`
  - Tài chính (icon $) — category: `finance`
  - Xác thực (icon login) — category: `auth`
  - Kỷ luật (icon activity) — category: `penalty`
- **Ô tìm kiếm**: tìm theo nội dung, email, hoặc hành động

#### Bảng dữ liệu

| Cột | Nội dung |
|------|----------|
| # | Số thứ tự dòng |
| Thời gian | Relative time (vd: "5 phút trước") + exact timestamp khi hover |
| Người dùng | Avatar + Tên + Email |
| Hành động | Category dot (màu) + Icon + Label tiếng Việt |
| Nội dung | Message text, bị truncate nếu quá dài |

#### Phân trang

- Server-side pagination: 10 bản ghi / trang
- Hiển thị số trang, nút Previous / Next

#### API

- `GET /api/audit-logs?page=&pageSize=&category=&search=`

---

## 3. Luồng nghiệp vụ

### 3.1. Quản lý tài khoản

```
ADMIN đăng nhập
  |
  +-- Xem danh sách tài khoản (tất cả roles)
  |     +-- Lọc theo vai trò / Tìm kiếm
  |
  +-- Thêm tài khoản mới
  |     +-- Nhập username/email/SĐT + mật khẩu
  |     +-- Chọn vai trò
  |     +-- POST /api/auth/users
  |     +-- Tài khoản mới xuất hiện trong bảng
  |
  +-- Sửa tài khoản
  |     +-- Click Edit trên dòng
  |     +-- Đổi vai trò / trạng thái / mật khẩu
  |     +-- PATCH /api/auth/users/:id
  |     +-- Dòng cập nhật ngay lập tức
  |
  +-- Xoá tài khoản
        +-- Click Delete -> Dialog xác nhận
        +-- Không thể xoá chính mình
        +-- DELETE /api/auth/users/:id
        +-- Tài khoản biến mất khỏi danh sách
```

### 3.2. Xem nhật ký hoạt động

```
ADMIN/MANAGER/ACCOUNTANT vào /audit-logs
  |
  +-- Xem 4 KPI cards
  |
  +-- Lọc theo danh mục
  |     +-- Chuyến đi -> category=trip
  |     +-- Cấu hình -> category=config
  |     +-- Tài chính -> category=finance
  |     +-- Xác thực -> category=auth
  |     +-- Kỷ luật -> category=penalty
  |
  +-- Tìm kiếm theo nội dung / email / hành động
  |
  +-- Phân trang (10/trang, server-side)
```

### 3.3. Luồng phân quyền truy cập

```
User truy cập /users hoặc /audit-logs
  |
  +-- DRIVER -> Redirect về trang chủ (không quyền)
  |
  +-- MANAGER/ACCOUNTANT
  |     +-- /users -> Xem danh sách (không hiện nút Thêm/Sửa/Xoá)
  |     +-- /audit-logs -> Xem đầy đủ
  |
  +-- ADMIN -> Đầy đủ chức năng
```

---

## 4. Bảng tra cứu

### 4.1. API Endpoints — Tài khoản người dùng

| Method | Endpoint | Mô tả | Quyền |
|--------|----------|--------|--------|
| GET | `/api/auth/users` | Danh sách tài khoản (JWT required) | ADMIN, MANAGER, ACCOUNTANT |
| POST | `/api/auth/users` | Tạo tài khoản mới | ADMIN only |
| PATCH | `/api/auth/users/:id` | Cập nhật vai trò/trạng thái/mật khẩu | ADMIN only |
| DELETE | `/api/auth/users/:id` | Xoá tài khoản (không xoá được chính mình) | ADMIN only |

### 4.2. API Endpoints — Nhật ký hoạt động

| Method | Endpoint | Parameters | Mô tả |
|--------|----------|------------|--------|
| GET | `/api/audit-logs` | `page`, `pageSize`, `category`, `search` | Danh sách audit log (server-side pagination) |

### 4.3. Mapping Hành động → Tiếng Việt

| Action Code | Label tiếng Việt | Category | Màu category dot |
|-------------|------------------|----------|------------------|
| `TRIP_CREATED` | Tạo chuyến | trip | Tím (#7c3aed) |
| `TRIP_DISPATCHED` | Xuất phát | trip | Tím (#7c3aed) |
| `TRIP_COMPLETED` | Hoàn thành | trip | Tím (#7c3aed) |
| `TRIP_LOCKED` | Khóa chuyến | trip | Tím (#7c3aed) |
| `TRIP_CANCELED` | Hủy chuyến | trip | Tím (#7c3aed) |
| `TRIP_REASSIGNED` | Đổi xe / lái xe | trip | Tím (#7c3aed) |
| `PAYMENT_RECEIVED` | Thanh toán | finance | Vàng (warning) |
| `ADJUSTMENT_CREATED` | Điều chỉnh | finance | Vàng (warning) |
| `PROFIT_DISTRIBUTED` | Chia lợi nhuận | finance | Vàng (warning) |
| `PENALTY_CREATED` | Kỷ luật | penalty | Đỏ (danger) |
| `USER_LOGIN` | Đăng nhập | auth | Xám (ink-3) |
| `USER_LOGOUT` | Đăng xuất | auth | Xám (ink-3) |
| `STATUS_CHANGED` | Đổi trạng thái | config | Xanh dương (info) |

### 4.4. Category → Màu sắc & Icon

| Category | Label | Icon | Màu |
|----------|-------|------|-----|
| `trip` | Chuyến đi | truck | Tím (#7c3aed) |
| `config` | Cấu hình | settings | Xanh dương (info) |
| `finance` | Tài chính | $ | Vàng (warning) |
| `auth` | Xác thực | login | Xám (ink-3) |
| `penalty` | Kỷ luật | activity | Đỏ (danger) |

### 4.5. Trạng thái tài khoản

| Status | Label | Màu pill |
|--------|-------|----------|
| `ACTIVE` | Hoạt động | success (xanh lá) |
| `INACTIVE` | Ngưng / Bị khoá | danger (đỏ) |

---

## 5. QA Test Checklist

### TC-QT-001: Hiển thị trang Tài khoản người dùng

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Truy cập `/users`

**Expected:**

- Header hiển thị "Tài khoản người dùng" + phụ đề (tổng số, nhân sự, lái xe)
- 4 KPI cards hiển thị đúng số liệu
- Bảng danh sách user hiển thị đầy đủ cột
- Nút "Thêm tài khoản" hiển thị

---

### TC-QT-002: Hiển thị KPI cards chính xác

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Đếm số user trong DB theo từng vai trò và trạng thái
2. So sánh với 4 KPI cards trên `/users`

**Expected:**

- Card "Tổng tài khoản" = tổng số user
- Card "Nhân sự văn phòng" = số ADMIN + MANAGER + ACCOUNTANT, màu warn (vàng)
- Card "Lái xe" = số DRIVER, màu success (xanh lá)
- Card "Bị khoá / Ngưng" = số user INACTIVE, màu danger (đỏ)

---

### TC-QT-003: Lọc theo vai trò (Role pills)

**Precondition:** Đăng nhập ADMIN, có dữ liệu user ở nhiều vai trò

**Steps:**

1. Click pill "Quản trị"
2. Click pill "Quản lý"
3. Click pill "Kế toán"
4. Click pill "Lái xe"
5. Click pill "Tất cả"

**Expected:**

- Mỗi pill hiển thị số đếm đúng
- Bảng chỉ hiển thị user tương ứng vai trò đã chọn
- Pill "Tất cả" trả về toàn bộ danh sách

---

### TC-QT-004: Tìm kiếm user

**Precondition:** Có user với username "nguyenvan", email "nguyenvan@mail.com", SĐT "0901234567"

**Steps:**

1. Gõ "nguyenvan" vào ô tìm kiếm
2. Xoá, gõ "0901234567"
3. Xoá, gõ "nguyenvan@mail"
4. Gõ chuỗi không tồn tại "xyz999"

**Expected:**

- Tìm được user theo username
- Tìm được user theo SĐT
- Tìm được user theo email (partial match)
- Không có kết quả khi tìm chuỗi không tồn tại

---

### TC-QT-005: Tạo tài khoản mới — thành công

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click "Thêm tài khoản"
2. Nhập Username: "testuser"
3. Nhập Email: "testuser@mail.com"
4. Nhập SĐT: "0909888777"
5. Chọn Vai trò: "Kế toán"
6. Nhập Mật khẩu: "password123"
7. Click Lưu / Submit

**Expected:**

- API `POST /api/auth/users` được gọi
- User mới xuất hiện trong danh sách
- Role pill hiển thị "Kế toán" màu neutral

---

### TC-QT-006: Tạo tài khoản — thiếu mật khẩu

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click "Thêm tài khoản"
2. Nhập Username: "nopass"
3. Để trống mật khẩu
4. Click Lưu

**Expected:**

- Hiển thị lỗi validation: mật khẩu bắt buộc
- API không được gọi

---

### TC-QT-007: Tạo tài khoản — mật khẩu quá ngắn

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click "Thêm tài khoản"
2. Nhập đầy đủ thông tin
3. Nhập mật khẩu: "12345" (5 ký tự)
4. Click Lưu

**Expected:**

- Hiển thị lỗi: mật khẩu tối thiểu 6 ký tự
- API không được gọi

---

### TC-QT-008: Tạo tài khoản — thiếu toàn bộ liên hệ

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click "Thêm tài khoản"
2. Không nhập username, email, SĐT
3. Nhập mật khẩu hợp lệ
4. Click Lưu

**Expected:**

- Hiển thị lỗi: phải nhập ít nhất username HOẶC email HOẶC SĐT
- API không được gọi

---

### TC-QT-009: Toggle hiện/ẩn mật khẩu

**Precondition:** Đăng nhập ADMIN, form thêm tài khoản đang mở

**Steps:**

1. Nhập mật khẩu vào ô
2. Click icon con mắt (show/hide toggle)
3. Click lại lần nữa

**Expected:**

- Lần 1: mật khẩu hiện rõ (text)
- Lần 2: mật khẩu ẩn (dots)
- Toggle hoạt động cả 2 chiều

---

### TC-QT-010: Sửa tài khoản — đổi vai trò

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click nút Edit trên một user
2. Dòng chuyển sang chế độ inline edit
3. Đổi vai trò từ "Lái xe" sang "Quản lý"
4. Click Lưu

**Expected:**

- API `PATCH /api/auth/users/:id` được gọi với role mới
- Role pill cập nhật thành "Quản lý" màu warn
- Inline edit đóng lại

---

### TC-QT-011: Sửa tài khoản — đổi trạng thái

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click Edit trên user đang ACTIVE
2. Đổi trạng thái sang INACTIVE
3. Click Lưu

**Expected:**

- Trạng thái pill chuyển thành "Ngưng" màu danger
- API PATCH được gọi với status mới

---

### TC-QT-012: Sửa tài khoản — đặt lại mật khẩu

**Precondition:** Đăng nhập ADMIN, user cần reset mật khẩu

**Steps:**

1. Click Edit trên user
2. Nhập mật khẩu mới vào ô "Đặt lại mật khẩu"
3. Click Lưu

**Expected:**

- API PATCH được gọi với password mới
- Mật khẩu mới có hiệu lực ngay

---

### TC-QT-013: Sửa tài khoản — không đổi mật khẩu (để trống)

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click Edit trên user
2. Chỉ đổi vai trò, để trống ô mật khẩu
3. Click Lưu

**Expected:**

- API PATCH chỉ cập nhật vai trò
- Mật khẩu giữ nguyên

---

### TC-QT-014: Xoá tài khoản — thành công

**Precondition:** Đăng nhập ADMIN (user A)

**Steps:**

1. Click Delete trên user B (khác user đang đăng nhập)
2. Dialog xác nhận hiện ra
3. Click Xác nhận

**Expected:**

- API `DELETE /api/auth/users/:id` được gọi
- User B biến mất khỏi danh sách
- KPI cards cập nhật số liệu

---

### TC-QT-015: Xoá tài khoản — không xoá được chính mình

**Precondition:** Đăng nhập ADMIN (user A)

**Steps:**

1. Tìm dòng của chính user A (đang đăng nhập)
2. Click Delete

**Expected:**

- Nút Delete bị disable, HOẶC hiện thông báo lỗi "Không thể xoá chính mình"
- API DELETE không được gọi

---

### TC-QT-016: Huỷ chỉnh sửa (Edit mode)

**Precondition:** Đăng nhập ADMIN, đang ở chế độ edit inline

**Steps:**

1. Click Edit trên user
2. Thay đổi vai trò
3. Click Huỷ

**Expected:**

- Dòng trở về trạng thái hiển thị (không edit)
- Không có API call nào
- Giá trị gốc được khôi phục

---

### TC-QT-017: Role pill hiển thị đúng màu

**Precondition:** Có user ở cả 4 vai trò

**Steps:**

1. Xem cột "Vai trò" trong bảng

**Expected:**

- ADMIN → pill đỏ (danger), label "Quản trị"
- MANAGER → pill vàng (warn), label "Quản lý"
- ACCOUNTANT → pill xám (neutral), label "Kế toán"
- DRIVER → pill xanh lá (success), label "Lái xe"

---

### TC-QT-018: Trạng thái pill hiển thị đúng

**Precondition:** Có user ACTIVE và INACTIVE

**Steps:**

1. Xem cột "Trạng thái" trong bảng

**Expected:**

- ACTIVE → pill xanh lá (success), label "Hoạt động"
- INACTIVE → pill đỏ (danger), label "Ngưng"

---

### TC-QT-019: MANAGER xem trang Users (chỉ xem)

**Precondition:** Đăng nhập MANAGER

**Steps:**

1. Truy cập `/users`

**Expected:**

- Hiển thị danh sách user (đọc)
- KHÔNG hiển thị nút "Thêm tài khoản"
- KHÔNG hiển thị nút Edit / Delete trên từng dòng

---

### TC-QT-020: ACCOUNTANT xem trang Users (chỉ xem)

**Precondition:** Đăng nhập ACCOUNTANT

**Steps:**

1. Truy cập `/users`

**Expected:**

- Giống TC-QT-019: chỉ xem, không CRUD

---

### TC-QT-021: DRIVER không truy cập được

**Precondition:** Đăng nhập DRIVER

**Steps:**

1. Cố truy cập `/users`
2. Cố truy cập `/audit-logs`

**Expected:**

- Bị redirect về trang chủ (/)
- Không thấy menu link đến 2 trang này

---

### TC-QT-022: Mobile — Card view (Users)

**Precondition:** Mở trên mobile (< 768px), đăng nhập ADMIN

**Steps:**

1. Truy cập `/users` trên mobile

**Expected:**

- Danh sách hiển thị dạng card thay vì bảng
- Mỗi card hiển thị: avatar, username, email, SĐT, role pill, status pill
- Nút Edit/Delete hiển thị trên card (ADMIN)

---

### TC-QT-023: Hiển thị trang Nhật ký hoạt động

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Truy cập `/audit-logs`

**Expected:**

- Header hiển thị "Nhật ký người dùng"
- 4 KPI cards hiển thị đúng
- Bảng audit log hiển thị đầy đủ cột: #, Thời gian, Người dùng, Hành động, Nội dung
- Bộ lọc category và ô tìm kiếm hiển thị

---

### TC-QT-024: KPI cards — Nhật ký hoạt động

**Precondition:** Có dữ liệu audit log

**Steps:**

1. Xem 4 KPI cards trên `/audit-logs`

**Expected:**

- "Hành động hôm nay" = số event trong ngày hiện tại
- "Người dùng hoạt động" = số unique user trong 24h gần nhất
- "Phổ biến nhất" = category có nhiều event nhất
- "Hoạt động gần nhất" = thời gian relative (vd: "5 phút trước")

---

### TC-QT-025: Lọc audit log theo category

**Precondition:** Có audit log ở nhiều category

**Steps:**

1. Click pill "Chuyến đi"
2. Click pill "Tài chính"
3. Click pill "Xác thực"
4. Click pill "Kỷ luật"
5. Click pill "Cấu hình"
6. Click pill "Tất cả"

**Expected:**

- Mỗi pill lọc đúng category tương ứng
- API gọi với `?category=trip|finance|auth|penalty|config`
- Pill "Tất cả" không gửi param category
- Bảng cập nhật theo kết quả lọc

---

### TC-QT-026: Tìm kiếm audit log

**Precondition:** Có audit log với nội dung đa dạng

**Steps:**

1. Gõ từ khoá trong ô tìm kiếm
2. Gõ email của user
3. Gõ tên hành động (vd: "Tạo chuyến")

**Expected:**

- Kết quả lọc theo nội dung message, email, hoặc action label
- API gọi với `?search=...`

---

### TC-QT-027: Phân trang audit log

**Precondition:** Có > 10 audit log entries

**Steps:**

1. Xem trang 1 (mặc định)
2. Click trang 2
3. Click nút Next
4. Click nút Previous

**Expected:**

- Mỗi trang hiển thị tối đa 10 bản ghi
- Chuyển trang gọi API `?page=2&pageSize=10`
- Số thứ tự (#) cập nhật đúng theo trang
- Nút Previous disabled ở trang 1
- Nút Next disabled ở trang cuối

---

### TC-QT-028: Action labels tiếng Việt hiển thị đúng

**Precondition:** Có audit log với nhiều loại action

**Steps:**

1. Xem cột "Hành động" trong bảng

**Expected:** Mỗi action hiển thị đúng label và màu dot:

- TRIP_CREATED → "Tạo chuyến" (chấm tím)
- TRIP_DISPATCHED → "Xuất phát" (chấm tím)
- TRIP_COMPLETED → "Hoàn thành" (chấm tím)
- TRIP_LOCKED → "Khóa chuyến" (chấm tím)
- TRIP_CANCELED → "Hủy chuyến" (chấm tím)
- TRIP_REASSIGNED → "Đổi xe / lái xe" (chấm tím)
- PAYMENT_RECEIVED → "Thanh toán" (chấm vàng)
- ADJUSTMENT_CREATED → "Điều chỉnh" (chấm vàng)
- PROFIT_DISTRIBUTED → "Chia lợi nhuận" (chấm vàng)
- PENALTY_CREATED → "Kỷ luật" (chấm đỏ)
- USER_LOGIN → "Đăng nhập" (chấm xám)
- USER_LOGOUT → "Đăng xuất" (chấm xám)
- STATUS_CHANGED → "Đổi trạng thái" (chấm xanh dương)

---

### TC-QT-029: Thời gian relative + exact timestamp

**Precondition:** Có audit log gần đây và cũ

**Steps:**

1. Xem cột "Thời gian"
2. Hover lên thời gian

**Expected:**

- Hiển thị relative time (vd: "5 phút trước", "2 giờ trước", "Hôm qua")
- Hover hiện exact timestamp (vd: "31/05/2026 14:30")

---

### TC-QT-030: Nội dung bị truncate

**Precondition:** Có audit log với nội dung dài

**Steps:**

1. Xem cột "Nội dung" trong bảng

**Expected:**

- Nội dung dài bị truncate với "..."
- Hover hoặc click có thể xem đầy đủ

---

### TC-QT-031: MANAGER/ACCOUNTANT xem audit log

**Precondition:** Đăng nhập MANAGER hoặc ACCOUNTANT

**Steps:**

1. Truy cập `/audit-logs`

**Expected:**

- Hiển thị đầy đủ KPI cards, bảng, bộ lọc
- Xem được toàn bộ audit log

---

### TC-QT-032: Thứ tự audit log — mới nhất trước

**Precondition:** Có audit log ở nhiều thời điểm

**Steps:**

1. Xem danh sách audit log

**Expected:**

- Bản ghi mới nhất ở đầu trang 1
- Thứ tự giảm dần theo thời gian

---

### TC-QT-033: API error handling — tạo user trùng

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Tạo user với username đã tồn tại
2. Tạo user với email đã tồn tại

**Expected:**

- Hiển thị thông báo lỗi từ API
- Form vẫn mở để sửa lại

---

### TC-QT-034: API error handling — xoá user lỗi

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Thử xoá user khi API trả lỗi
2. Kiểm tra danh sách

**Expected:**

- Nếu API trả lỗi → hiển thị toast error
- Danh sách không thay đổi

---

### TC-QT-035: Người dùng cột hiển thị avatar + tên + email

**Precondition:** Có audit log

**Steps:**

1. Xem cột "Người dùng" trên `/audit-logs`

**Expected:**

- Hiển thị avatar (hình tròn)
- Tên user + email bên dưới
- Nếu user đã bị xoá → hiển thị thông tin dự phòng

---

### TC-QT-036: Empty state — không có user

**Precondition:** DB không có user (trừ admin)

**Steps:**

1. Truy cập `/users`

**Expected:**

- Bảng hiển thị empty state phù hợp
- KPI cards hiển thị số 0 hoặc 1 (admin)

---

### TC-QT-037: Empty state — không có audit log

**Precondition:** DB không có audit log

**Steps:**

1. Truy cập `/audit-logs`

**Expected:**

- Bảng hiển thị empty state phù hợp
- KPI cards hiển thị số 0

---

### TC-QT-038: Form thêm tài khoản — huỷ

**Precondition:** Đăng nhập ADMIN

**Steps:**

1. Click "Thêm tài khoản"
2. Nhập một số thông tin
3. Click Huỷ

**Expected:**

- Form đóng lại
- Không có API call
- Bảng trở về trạng thái bình thường
