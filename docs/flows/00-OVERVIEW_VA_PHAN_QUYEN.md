# Tổng quan Hệ thống & Phân quyền

> Tài liệu QA testing & Hướng dẫn sử dụng — Đăng nhập, vai trò, phân quyền, điều hướng

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Hướng dẫn sử dụng](#2-hướng-dẫn-sử-dụng)
3. [Luồng nghiệp vụ](#3-luồng-nghiệp-vụ)
4. [Bảng tra cứu](#4-bảng-tra-cứu)
5. [QA Test Checklist](#5-qa-test-checklist)
6. [Ghi chú & Lưu ý quan trọng](#6-ghi-chú--lưu-ý-quan-trọng)

---

## 1. Tổng quan

### 1.1 Giới thiệu hệ thống

**TingTing** là hệ thống quản lý vận tải thay thế 7+ file Excel cho Công ty TNHH NEPO. Hệ thống quản lý 4+ xe đầu kéo, 38+ tuyến đường, và 44+ khách hàng.

**Stack công nghệ:**

| Layer | Công nghệ |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Express v5 + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Auth | JWT + Casbin RBAC |
| Testing | Vitest |

**URL truy cập:**
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3090`

### 1.2 Vai trò người dùng

| Vai trò | Mã (Role) | Tài khoản demo | Trang chủ | Mô tả |
|---------|----------|---------------|-----------|-------|
| **Quản trị** | `ADMIN` | `admin` / `admin123` | `/dashboard` | Toàn quyền hệ thống, quản lý người dùng, nhật ký |
| **Giám đốc** | `MANAGER` | `giamdoc` / `admin123` | `/dashboard` | Quản lý vận hành, tài chính, điều vận, phân bổ lợi nhuận |
| **Kế toán** | `ACCOUNTANT` | `ketoan` / `admin123` | `/dashboard` | Tạo/sửa chuyến, ghi nhận thanh toán, công nợ |
| **Lái xe** | `DRIVER` | `laixe` / `admin123` | `/my-trips` | Xem lịch trình, thu nhập, phạt (chỉ đọc) |
| **Nhân viên giao nhận** | `FORWARDER` | `giaonhan` / `admin123` | `/my-forwarder-trips` | Xem chuyến, nhập container/seal, ghi chi phí phát sinh |

### 1.3 API Endpoints liên quan

#### Đăng nhập

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `POST` | `/api/auth/login` | Không | Xác thực người dùng, trả về JWT token |
| `GET` | `/api/auth/me` | JWT | Lấy thông tin người dùng hiện tại |

#### Đăng ký / Quản lý người dùng

| Method | Path | Auth | RBAC | Mô tả |
|--------|------|------|------|-------|
| `GET` | `/api/auth/users` | JWT | `users:read` (MANAGER, ADMIN) | Danh sách người dùng |
| `POST` | `/api/auth/users` | JWT | `users:read` (MANAGER, ADMIN) | Tạo người dùng mới |
| `PATCH` | `/api/auth/users/:id` | JWT | `users:read` (MANAGER, ADMIN) | Cập nhật người dùng |
| `DELETE` | `/api/auth/users/:id` | JWT | `users:read` (MANAGER, ADMIN) | Xóa mềm người dùng |

#### Health check

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/health` | Không | Kiểm tra sức khỏe hệ thống |

---

## 2. Hướng dẫn sử dụng

### 2.1 Đăng nhập

![Đăng nhập](./screenshots/login.png)

1. Mở trình duyệt và truy cập `http://localhost:5173`
2. Trang đăng nhập hiển thị với logo TingTing
3. Nhập **Tên đăng nhập, email, hoặc số điện thoại** vào trường `identifier`
4. Nhập **Mật khẩu** vào trường `password`
5. Click nút **Đăng nhập** hoặc nhấn `Enter`
6. Nếu thành công, hệ thống chuyển hướng đến trang chủ theo vai trò:
   - ADMIN/MANAGER/ACCOUNTANT → `/dashboard`
   - DRIVER → `/my-trips`
   - FORWARDER → `/my-forwarder-trips`

**Mẹo nhanh:** Click chip tài khoản demo trên trang đăng nhập để tự động điền thông tin.

#### Chi tiết API — Đăng nhập

**Request:**
```json
POST /api/auth/login
Content-Type: application/json

{
  "identifier": "giamdoc",     // username, email, hoặc phone
  "password": "admin123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 2,
    "username": "giamdoc",
    "email": "giamdoc@nepo.vn",
    "phone": "0901234567",
    "role": "MANAGER",
    "status": "ACTIVE",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Lỗi:**

| Status | Mã lỗi | Nguyên nhân |
|--------|--------|-------------|
| 400 | ZodError | Thiếu trường bắt buộc hoặc format sai |
| 401 | Unauthorized | Sai thông tin đăng nhập hoặc tài khoản bị khóa/xóa |
| 500 | Internal | Lỗi server |

### 2.2 Khôi phục phiên (Auto-restore)

Khi người dùng mở lại trang web:
1. Hệ thống kiểm tra `localStorage` cho JWT token
2. Nếu token tồn tại, gọi `GET /api/auth/me` để khôi phục phiên
3. Nếu token hợp lệ → đăng nhập tự động
4. Nếu token hết hạn hoặc không hợp lệ → hiển thị trang đăng nhập

**API:**
```
GET /api/auth/me
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "id": 2,
  "username": "giamdoc",
  "email": "giamdoc@nepo.vn",
  "phone": "0901234567",
  "role": "MANAGER",
  "status": "ACTIVE",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "driver": null   // Chỉ có giá trị nếu role = DRIVER
}
```

### 2.3 Đăng xuất

1. Click vào **avatar người dùng** hoặc **nút đăng xuất** ở cuối sidebar
2. Hệ thống xóa JWT token khỏi `localStorage`
3. Chuyển hướng về trang đăng nhập

### 2.4 Điều hướng Sidebar

#### Sidebar Quản lý (ADMIN/MANAGER/ACCOUNTANT)

![Sidebar quản lý](./screenshots/sidebar-admin.png)

**Phần "Vận hành" (Operations):**

| Menu | Route | Icon | Badge | Mô tả |
|------|-------|------|-------|-------|
| Tổng quan | `/dashboard` | LayoutDashboard | — | Dashboard KPI |
| Phân xe | `/dispatch` | Compass | Số chuyến CREATED | Điều vận chuyến |
| Đội xe | `/fleet` | Layers | — | Quản lý xe & lái xe |
| Sổ chuyến đi | `/trips` | Truck | — | Danh sách chuyến |
| Kỷ luật | `/penalties` | AlertTriangle | Số phạt tháng này | Quản lý phạt |

**Phần "Tài chính" (Financials):**

| Menu | Route | Icon | Mô tả |
|------|-------|------|-------|
| Báo cáo lãi lỗ | `/finance` | Wallet | P&L theo tháng |
| Phân chia lợi nhuận | `/profit` | DollarSign | Phân bổ lợi nhuận |
| Công nợ phải thu | `/debt` | Receipt | Công nợ khách hàng |

**Phần "Danh mục" (Admin):**

| Menu | Route | Icon | Vai trò | Mô tả |
|------|-------|------|---------|-------|
| Khách hàng | `/customers` | Users | Tất cả quản lý | CRUD khách hàng |
| Tuyến đường | `/config/routes` | Route | Tất cả quản lý | Cấu hình tuyến |
| Cấu hình | `/config` | Settings | Tất cả quản lý | Hub cấu hình |
| Người dùng | `/users` | Users | ADMIN, MANAGER | Quản lý tài khoản |
| Nhật ký hoạt động | `/audit-logs` | ScrollText | ADMIN, MANAGER | Audit log |

> **Lưu ý:** ACCOUNTANT thấy menu "Người dùng" và "Nhật ký hoạt động" nhưng bị chặn bởi Casbin (ACCOUNTANT không có quyền `users:read`). FRONTEND có thể vẫn hiển thị menu item nhưng API sẽ trả về 403.

#### Sidebar Lái xe (DRIVER)

![Sidebar lái xe](./screenshots/sidebar-driver.png)

| Menu | Route | Icon | Mô tả |
|------|-------|------|-------|
| Lệnh của tôi | `/my-trips` | Route | Danh sách chuyến được phân công |
| Thu nhập | `/my-earnings` | DollarSign | Chi tiết thu nhập |
| Phạt | `/my-penalties` | AlertTriangle | Nhật ký vi phạm |

#### Sidebar Nhân viên giao nhận (FORWARDER)

| Menu | Route | Icon | Mô tả |
|------|-------|------|-------|
| Chuyến đi | `/my-forwarder-trips` | Package | Danh sách chuyến, nhập container/seal, chi phí phát sinh |

### 2.5 Topbar

| Thành phần | Mô tả |
|------------|-------|
| Hamburger toggle | Ẩn/hiện sidebar (phím tắt: `Cmd+B` / `Ctrl+B`) |
| Breadcrumb | `NEPO > [Tên trang]` |
| Thanh tìm kiếm | Tìm chuyến, khách hàng, xe... (phím tắt: `Cmd+K`) |
| Chip ngày | Tháng + ngày hiện tại |
| Nút trợ giúp | Mở **Hướng dẫn sử dụng** cho ADMIN, MANAGER và ACCOUNTANT; thư viện vẫn có sau khi ẩn hoặc hoàn tất checklist khởi đầu |
| Chuông thông báo | Badge "5" (tĩnh) |

### 2.6 Hướng dẫn sử dụng và checklist khởi đầu

Khi tính năng hướng dẫn đang được bật, ADMIN, MANAGER và ACCOUNTANT có thể mở **Hướng dẫn sử dụng** từ topbar. Thư viện chỉ hiển thị các luồng phù hợp với vai trò hiện tại; DRIVER và FORWARDER không thấy checklist hoặc thư viện này.

- Mỗi mục trong checklist khởi đầu có nút **Hướng dẫn** dẫn đến một luồng cụ thể. Có thể mở lại bất cứ lúc nào từ thư viện.
- Xem hoặc mở hướng dẫn không tự hoàn thành công việc. Những mục thao tác (ví dụ tạo chuyến, điều vận, lưu số liệu, ghi nhận thanh toán hoặc lưu định mức) chỉ hoàn thành khi thao tác thực tế thành công trong hệ thống.
- Những mục làm quen/tham khảo chỉ được đánh dấu hoàn thành khi người dùng kết thúc đúng hướng dẫn tương ứng.
- Sau khi chọn **Để sau** hoặc hoàn thành toàn bộ checklist, thẻ checklist có thể ẩn nhưng thư viện trong topbar vẫn còn để xem lại.
- Tiến độ hướng dẫn được lưu trên hệ thống và có bản nhớ cục bộ theo phiên bản của từng hướng dẫn. Nếu nội dung hướng dẫn thay đổi phiên bản, hệ thống không tiếp tục từ bước cũ.

---

## 3. Luồng nghiệp vụ

### 3.1 Luồng đăng nhập

```
Người dùng mở trang web
        │
        ▼
  Có JWT trong localStorage?
     ├── CÓ → Gọi GET /api/auth/me
     │         │
     │         ├── Token hợp lệ → Đăng nhập tự động → Chuyển đến trang chủ
     │         └── Token không hợp lệ → Xóa token → Hiện trang đăng nhập
     │
     └── KHÔNG → Hiện trang đăng nhập
                    │
                    ▼
              Nhập identifier + password
                    │
                    ▼
              POST /api/auth/login
                    │
                    ├── 200 → Lưu JWT vào localStorage → Trang chủ
                    ├── 400 → Lỗi validation → Thông báo lỗi
                    ├── 401 → Sai thông tin → Thông báo "Sai tài khoản hoặc mật khẩu"
                    └── 500 → Lỗi server → Thông báo lỗi hệ thống
```

### 3.2 Luồng phân quyền (Route Guards)

```
Người dùng truy cập URL
        │
        ▼
  Đã xác thực?
     ├── KHÔNG → Chuyển đến /login
     │
     └── CÓ → Kiểm tra vai trò
               │
                ├── DRIVER truy cập route admin (VD: /finance, /debt, /users)
                │   → Redirect về /my-trips
                │
                ├── FORWARDER truy cập route admin (VD: /finance, /debt, /users)
                │   → Redirect về /my-forwarder-trips
                │
                ├── ADMIN/MANAGER/ACCOUNTANT truy cập route portal (VD: /my-trips, /my-forwarder-trips)
                │   → Redirect về /dashboard
                │
                ├── DRIVER truy cập route FORWARDER (VD: /my-forwarder-trips)
                │   → Redirect về /my-trips
                │
                ├── FORWARDER truy cập route DRIVER (VD: /my-trips)
                │   → Redirect về /my-forwarder-trips
                │
                └── Vai trò phù hợp → Render trang
```

### 3.3 Luồng phân quyền Backend (Casbin)

```
Request đến API endpoint
        │
        ▼
  authMiddleware: Kiểm tra JWT token
        │
        ├── Không có token hoặc token hết hạn → 401 Unauthorized
        │
        └── Token hợp lệ → Lấy role từ JWT payload
                            │
                            ▼
                     casbinAuthz(resource): Kiểm tra policy
                            │
                            ├── Method → Action mapping:
                            │   GET → "read"
                            │   POST/PUT/PATCH → "write"
                            │   DELETE → "delete"
                            │
                            ├── Role + Resource + Action khớp policy → Cho phép
                            └── Không khớp → 403 Forbidden
```

### 3.4 Luồng middleware đầy đủ

```
Request → cors() → express.json() → express.static()
        → requestLogger → auditLogMiddleware
        → authMiddleware (per-route)
        → casbinAuthz(resource) (per-route)
        → Route Handler
        → globalErrorHandler
        → Response
```

---

## 4. Bảng tra cứu

### 4.1 Ma trận phân quyền đầy đủ (Casbin Policy)

#### ADMIN — Toàn quyền

| Resource | Read | Write | Delete |
|----------|------|-------|--------|
| `*` (tất cả) | ✅ | ✅ | ✅ |
| `audit_logs` | ✅ | — | — |

#### MANAGER (Giám đốc) — Toàn quyền vận hành

| Resource | Read | Write | Delete | Mô tả |
|----------|------|-------|--------|-------|
| `trips` | ✅ | ✅ | ✅ | Chuyến xe |
| `config` | ✅ | ✅ | ✅ | Cấu hình danh mục |
| `financial` | ✅ | ✅ | ✅ | Tài chính, P&L |
| `users` | ✅ | — | — | Chỉ đọc danh sách người dùng |
| `audit_logs` | ✅ | — | — | Nhật ký hoạt động |
| `maps` | ✅ | — | — | Google Maps API |
| `upload` | — | ✅ | — | Upload ảnh |
| `photos` | ✅ | — | — | Xem ảnh |

#### ACCOUNTANT (Kế toán) — Chức năng tài chính

| Resource | Read | Write | Delete | Mô tả |
|----------|------|-------|--------|-------|
| `trips` | ✅ | ✅ | ✅ | Chuyến xe |
| `config` | ✅ | ✅ | ✅ | Cấu hình danh mục |
| `financial` | ✅ | ✅ | ✅ | Tài chính, P&L |
| `audit_logs` | ✅ | — | — | Nhật ký hoạt động |
| `maps` | ✅ | — | — | Google Maps API |
| `upload` | — | ✅ | — | Upload ảnh |
| `photos` | ✅ | — | — | Xem ảnh |

> **Khác biệt MANAGER vs ACCOUNTANT:**
> - ACCOUNTANT **không** có quyền `users:read` → không thể xem/quản lý người dùng
> - ACCOUNTANT **không** thể hủy chuyến (chỉ ADMIN/MANAGER)
> - ACCOUNTANT **không** thể phân bổ lợi nhuận (chỉ ADMIN/MANAGER)

#### DRIVER (Lái xe) — Chỉ đọc portal cá nhân

| Resource | Read | Write | Delete | Mô tả |
|----------|------|-------|--------|-------|
| `driver_portal` | ✅ | — | — | Xem chuyến, thu nhập, phạt của mình |
| `maps` | ✅ | — | — | Google Maps API |
| `photos` | ✅ | — | — | Xem ảnh (chỉ chuyến được phân) |

#### FORWARDER (Nhân viên giao nhận) — Portal đọc + ghi

| Resource | Read | Write | Delete | Mô tả |
|----------|------|-------|--------|-------|
| `forwarder_portal` | ✅ | ✅ | — | Xem chuyến, nhập container/seal/chi phí |
| `maps` | ✅ | — | — | Google Maps API |
| `photos` | ✅ | — | — | Xem ảnh |

### 4.2 HTTP Method → Casbin Action Mapping

| HTTP Method | Casbin Action | Mô tả |
|-------------|---------------|-------|
| `GET` | `read` | Đọc dữ liệu |
| `POST` | `write` | Tạo mới |
| `PUT` | `write` | Cập nhật |
| `PATCH` | `write` | Cập nhật một phần |
| `DELETE` | `delete` | Xóa |

### 4.3 Route Guards (Frontend)

| Route | Guard | Hành vi nếu không hợp lệ |
|-------|-------|--------------------------|
| Tất cả (chưa đăng nhập) | Auth check | → `/login` |
| `/dashboard`, `/dispatch`, `/fleet`, `/trips/*`, `/finance`, `/profit`, `/debt/*`, `/penalties`, `/customers`, `/config/*`, `/users`, `/audit-logs` | `adminOnly()` | DRIVER → `/my-trips` |
| `/my-trips`, `/my-trips/:id`, `/my-earnings`, `/my-penalties` | `driverOnly()` | Non-DRIVER → `/dashboard` |
| `/my-forwarder-trips`, `/my-forwarder-trips/:id` | `forwarderOnly()` | Non-FORWARDER → trang chủ tương ứng |
| `/` | Role-based redirect | DRIVER → `/my-trips`, khác → `/dashboard` |
| `/routes` | Legacy redirect | → `/config/routes` |
| `/trucks`, `/drivers`, `/trailers` | Legacy redirect | → `/fleet` |
| `*` (404) | Role-based redirect | DRIVER → `/my-trips`, khác → `/dashboard` |

### 4.4 JWT Token Structure

```json
{
  "userId": 2,
  "username": "giamdoc",
  "email": "giamdoc@nepo.vn",
  "role": "MANAGER",
  "iat": 1748640000,
  "exp": 1749244800
}
```

**Cấu hình:** Token hết hạn sau `7 ngày` (config: `JWT_EXPIRES_IN`)

### 4.5 Validation Rules — Đăng nhập

| Trường | Kiểu | Bắt buộc | Ràng buộc |
|---------|------|-----------|-----------|
| `identifier` | string | ✅ | Username, email, hoặc số điện thoại |
| `password` | string | ✅ | Tối thiểu 6 ký tự |

### 4.6 Validation Rules — Tạo người dùng

| Trường | Kiểu | Bắt buộc | Ràng buộc |
|---------|------|-----------|-----------|
| `username` | string | ⚠️ | Tối thiểu 2 ký tự (cần ít nhất 1 trong 3: username/email/phone) |
| `email` | string | ⚠️ | Email hợp lệ |
| `phone` | string | ⚠️ | Tối thiểu 6 ký tự |
| `password` | string | ✅ | Tối thiểu 6 ký tự |
| `role` | enum | ✅ | `ADMIN` \| `MANAGER` \| `ACCOUNTANT` \| `DRIVER` \| `FORWARDER` |
| `status` | enum | — | `ACTIVE` \| `INACTIVE`, mặc định `ACTIVE` |

### 4.7 Error Response Format

```json
// ZodError (400)
{
  "error": "Validation failed",
  "details": [{ "field": "password", "message": "String must contain at least 6 character(s)" }]
}

// Auth Error (401)
{
  "error": "Thông tin đăng nhập không hợp lệ"
}

// Forbidden (403)
{
  "error": "Forbidden"
}

// Not Found (404)
{
  "error": "Not found"
}

// Conflict (409) — unique constraint
{
  "error": "Tên đăng nhập đã tồn tại"
}

// Server Error (500)
{
  "error": "Internal server error"
}
```

---

## 5. QA Test Checklist

### 5.1 Happy Path Tests

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-0001 | Đăng nhập bằng username | Trang đăng nhập | 1. Nhập `giamdoc` vào identifier<br>2. Nhập `admin123` vào password<br>3. Click "Đăng nhập" | Đăng nhập thành công, chuyển đến `/dashboard`, JWT token lưu vào localStorage | High |
| TC-0002 | Đăng nhập bằng email | Trang đăng nhập | 1. Nhập `giamdoc@nepo.vn` vào identifier<br>2. Nhập `admin123`<br>3. Click "Đăng nhập" | Đăng nhập thành công, chuyển đến `/dashboard` | High |
| TC-0003 | Đăng nhập bằng số điện thoại | Trang đăng nhập | 1. Nhập số điện thoại vào identifier<br>2. Nhập mật khẩu<br>3. Click "Đăng nhập" | Đăng nhập thành công | Medium |
| TC-0004 | Đăng nhập tài khoản DRIVER | Trang đăng nhập | 1. Nhập `laixe` / `admin123`<br>2. Click "Đăng nhập" | Chuyển đến `/my-trips` (không phải `/dashboard`) | High |
| TC-0005 | Khôi phục phiên tự động | Đã đăng nhập trước đó, đóng tab | 1. Mở lại URL trang web | Tự động đăng nhập, hiển thị trang chủ phù hợp | High |
| TC-0006 | Đăng xuất | Đã đăng nhập | 1. Click nút đăng xuất trong sidebar | Token bị xóa, chuyển về trang đăng nhập | High |
| TC-0007 | Chip demo tự động điền | Trang đăng nhập | 1. Click chip "Giám đốc" | Các trường identifier và password tự động điền `giamdoc` / `admin123` | Medium |
| TC-0008 | Toggle hiện/ẩn mật khẩu | Trang đăng nhập | 1. Nhập mật khẩu<br>2. Click icon hiện/ẩn mật khẩu | Mật khẩu chuyển giữa hiện và ẩn | Low |

### 5.2 Validation Tests

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-0009 | Đăng nhập thiếu identifier | Trang đăng nhập | 1. Để trống identifier<br>2. Nhập password<br>3. Click "Đăng nhập" | Hiển thị lỗi validation, không gọi API | High |
| TC-0010 | Đăng nhập thiếu password | Trang đăng nhập | 1. Nhập identifier<br>2. Để trống password<br>3. Click "Đăng nhập" | Hiển thị lỗi validation | High |
| TC-0011 | Đăng nhập sai mật khẩu | Trang đăng nhập | 1. Nhập `giamdoc` / `saimatkhau`<br>2. Click "Đăng nhập" | Hiển thị thông báo lỗi 401 "Thông tin đăng nhập không hợp lệ" | High |
| TC-0012 | Đăng nhập tài khoản bị xóa | Tài khoản đã bị soft-delete | 1. Thử đăng nhập bằng tài khoản đã xóa | Hiển thị lỗi 401 | Medium |
| TC-0013 | Đăng nhập tài khoản INACTIVE | Tài khoản status=INACTIVE | 1. Thử đăng nhập | Hiển thị lỗi 401 | Medium |

### 5.3 Permission Tests

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-0014 | DRIVER truy cập /dashboard | Đăng nhập bằng `laixe` | 1. Truy cập `/dashboard` trực tiếp qua URL | Tự động redirect về `/my-trips` | High |
| TC-0015 | DRIVER truy cập /finance | Đăng nhập bằng `laixe` | 1. Truy cập `/finance` trực tiếp | Redirect về `/my-trips` | High |
| TC-0016 | DRIVER truy cập /debt | Đăng nhập bằng `laixe` | 1. Truy cập `/debt` trực tiếp | Redirect về `/my-trips` | High |
| TC-0017 | DRIVER truy cập /users | Đăng nhập bằng `laixe` | 1. Truy cập `/users` trực tiếp | Redirect về `/my-trips` | High |
| TC-0018 | DRIVER truy cập API admin | Đăng nhập bằng `laixe` | 1. Gọi `GET /api/trips` | 403 Forbidden | High |
| TC-0019 | ACCOUNTANT truy cập /users | Đăng nhập bằng `ketoan` | 1. Truy cập `/users`<br>2. Gọi `GET /api/auth/users` | API trả về 403 (ACCOUNTANT không có `users:read`) | High |
| TC-0020 | ADMIN truy cập route DRIVER | Đăng nhập bằng `admin` | 1. Truy cập `/my-trips` | Redirect về `/dashboard` | Medium |
| TC-0021 | Token hết hạn | Token đã hết hạn trong localStorage | 1. Mở trang web | Gọi `/api/auth/me` trả về 401, hiển thị trang đăng nhập | High |
| TC-0022 | Route 404 catch-all | Đã đăng nhập ADMIN | 1. Truy cập `/page-khong-ton-tai` | Redirect về `/dashboard` | Medium |
| TC-0023 | Legacy URL redirect | Đã đăng nhập | 1. Truy cập `/trucks` | Redirect về `/fleet` | Low |
| TC-0024 | Legacy URL /routes | Đã đăng nhập | 1. Truy cập `/routes` | Redirect về `/config/routes` | Low |
| TC-0034 | FORWARDER truy cập /my-forwarder-trips | Đăng nhập bằng `giaonhan` | 1. Truy cập /my-forwarder-trips | Hiển thị danh sách chuyến | High |
| TC-0035 | FORWARDER truy cập /dashboard | Đăng nhập bằng `giaonhan` | 1. Truy cập /dashboard trực tiếp | Redirect về /my-forwarder-trips | High |
| TC-0036 | FORWARDER truy cập /finance | Đăng nhập bằng `giaonhan` | 1. Truy cập /finance trực tiếp | Redirect về /my-forwarder-trips | High |
| TC-0037 | FORWARDER truy cập /my-trips (driver) | Đăng nhập bằng `giaonhan` | 1. Truy cập /my-trips | Redirect về /my-forwarder-trips | High |
| TC-0038 | ADMIN truy cập /my-forwarder-trips | Đăng nhập bằng `admin` | 1. Truy cập /my-forwarder-trips | Redirect về /dashboard | High |
| TC-0039 | DRIVER truy cập /my-forwarder-trips | Đăng nhập bằng `laixe` | 1. Truy cập /my-forwarder-trips | Redirect về /my-trips | High |
| TC-0040 | FORWARDER gọi API admin | Đăng nhập bằng `giaonhan` | 1. Gọi GET /api/trips | 403 Forbidden | High |
| TC-0041 | FORWARDER sidebar đúng | Đăng nhập bằng `giaonhan` | 1. Xem sidebar | Chỉ hiện 1 menu "Chuyến đi" | High |
| TC-0042 | Route 404 catch-all FORWARDER | Đăng nhập bằng `giaonhan` | 1. Truy cập /page-khong-ton-tai | Redirect về /my-forwarder-trips | Medium |

### 5.4 Edge Cases & Error Handling

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-0025 | Nhập sai nhiều lần liên tiếp | Trang đăng nhập | 1. Nhập sai mật khẩu 5 lần liên tiếp | Mỗi lần đều hiển thị lỗi 401, không bị lockout (hệ thống không có rate limiting) | Medium |
| TC-0026 | Token JWT bị chỉnh sửa | Có token trong localStorage | 1. Chỉnh sửa token trong localStorage<br>2. Reload trang | `/api/auth/me` trả về 401, chuyển về trang đăng nhập | Medium |
| TC-0027 | Xóa token trong localStorage | Đã đăng nhập | 1. Xóa token trong DevTools<br>2. Reload trang | Hiển thị trang đăng nhập | Medium |
| TC-0028 | Hai tab cùng đăng nhập khác role | Đã đăng nhập ADMIN ở tab 1 | 1. Mở tab 2, đăng nhập DRIVER | Tab 2 là DRIVER, tab 1 vẫn là ADMIN cho đến khi reload | Low |
| TC-0029 | Server không phản hồi | Backend không chạy | 1. Thử đăng nhập | Hiển thị lỗi kết nối (fetch failed) | Medium |

### 5.5 Concurrency Tests

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-0030 | Đăng xuất ở tab 1, thao tác ở tab 2 | Mở 2 tab, đã đăng nhập | 1. Tab 1: click đăng xuất<br>2. Tab 2: thử gọi API | Tab 2 nhận 401, chuyển về trang đăng nhập | Medium |

### 5.6 Responsive/Mobile Tests

| TC-ID | Tiêu đề | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên |
|-------|---------|----------------|----------|-------------------|---------|
| TC-0031 | Trang đăng nhập mobile | Mở trên mobile (375px) | 1. Xem trang đăng nhập | Layout responsive, form sử dụng đúng | Medium |
| TC-0032 | Sidebar mobile toggle | Đã đăng nhập, mobile | 1. Click hamburger menu | Sidebar slide in/out | Medium |
| TC-0033 | DRIVER portal mobile | Đăng nhập DRIVER trên mobile | 1. Xem sidebar driver | Sidebar driver hiển thị đúng 3 menu items | High |
| TC-0043 | FORWARDER portal mobile | Đăng nhập FORWARDER trên mobile | 1. Xem sidebar forwarder | Sidebar forwarder hiển thị đúng 1 menu item | High |

---

## 6. Ghi chú & Lưu ý quan trọng

### Bảo mật

- **JWT Secret**: Mặc định `dev-secret-change-in-production` — **PHẢI** thay đổi khi triển khai production
- **Token hết hạn**: 7 ngày (`JWT_EXPIRES_IN: 7d`)
- **Password hashing**: bcrypt với salt rounds = 10
- **EXIF metadata**: Được strip tự động khi upload ảnh (xem doc 01)
- **CORS**: Cho phép `http://localhost:7173` trong dev, chặn tất cả trong production

### Hạn chế hiện tại

- Không có **rate limiting** cho đăng nhập → có thể brute force
- Không có **refresh token** → đăng xuất toàn bộ khi token hết hạn
- Không có **lockout** sau nhiều lần đăng nhập sai
- Sidebar hiển thị cho ACCOUNTANT menu items mà họ không có quyền truy cập (nhưng API sẽ trả về 403)
- Notification bell badge "5" là hardcoded (chưa kết nối backend)

### Chức năng keyboard

| Phím tắt | Hành động |
|----------|-----------|
| `Cmd+B` / `Ctrl+B` | Toggle sidebar |
| `Cmd+K` | Focus thanh tìm kiếm |
| `Enter` | Submit form đăng nhập |
| `Escape` | Đóng modal/drawer |
