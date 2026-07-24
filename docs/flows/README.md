# TingTing — Tài liệu QA Testing & Hướng dẫn Sử dụng

> Phiên bản: 2026-05 · Stack: Express v5 + PostgreSQL + Drizzle ORM + React 18 + TypeScript

---

## Tổng quan

Bộ tài liệu này phục vụ hai mục đích:
1. **QA Agent**: Test plan chi tiết cho mọi tính năng — happy path, validation, phân quyền, edge case, concurrency, responsive
2. **User Manual**: Hướng dẫn sử dụng từng chức năng cho người dùng cuối (Giám đốc, Kế toán, Lái xe)

Mọi tài liệu được viết bằng **tiếng Việt**.

---

## Danh sách tài liệu

| # | Tài liệu | Nội dung | Route |
|---|----------|----------|-------|
| 00 | [Tổng quan & Phân quyền](./00-OVERVIEW_VA_PHAN_QUYEN.md) | Đăng nhập/đăng xuất, vai trò, ma trận phân quyền, điều hướng sidebar | `/login`, tất cả redirect |
| 01 | [Vòng đời Chuyến xe](./01-TRIP_LIFECYCLE.md) | Tạo → Điều vận → Sửa → Hoàn thành → Chốt → Hủy + Phân xe lại + Điều chỉnh + Ảnh | `/trips/new`, `/trips/:id`, `/trips/:id/edit` |
| 02 | [Danh sách & Tìm kiếm Chuyến](./02-TRIP_LIST_VA_TIM_KIEM.md) | Bộ lọc (trạng thái/ngày/xe/khách hàng), tìm kiếm, phân trang, xuất CSV | `/trips` |
| 03 | [Dashboard & Báo cáo Tài chính](./03-DASHBOARD_VA_BAO_CAO.md) | KPI, biểu đồ 12 tháng, chi phí; P&L theo tháng, so sánh YoY, chi tiết theo xe | `/dashboard`, `/finance` |
| 04 | [Công nợ & Thanh toán](./04-CONG_NO_VA_THANH_TOAN.md) | Aging buckets, sao kê khách hàng, ghi nhận thanh toán FIFO, điều chỉnh nợ | `/debt`, `/debt/:id` |
| 05 | [Phân bổ Lợi nhuận](./05-PHAN_BO_LOI_NHUAN.md) | Bảng chia cổ phần, phân bổ lợi nhuận theo quý | `/profit` |
| 06 | [Kỷ luật & Phạt](./06-KY_LUAT_VA_PHAT.md) | Bảng xếp hạng an toàn, tạo phạt, nhật ký vi phạm, lý do phạt | `/penalties` |
| 07 | [Đội xe & Điều vận](./07-DOI_XE_VA_FLEET.md) | Điều vận chuyến, quản lý xe đầu kéo, rơ moóc, lái xe (CRUD) | `/dispatch`, `/fleet` |
| 08 | [Khách hàng](./08-KHACH_HANG.md) | CRUD khách hàng, chỉ số rủi ro, hạn mức tín dụng | `/customers` |
| 09 | [Cấu hình Hệ thống](./09-CAU_HINH_HE_THONG.md) | 12 trang cấu hình: nhiên liệu, phụ phí đường, tuyến đường, loại hàng, bảng giá, lý do phạt, phí quản lý, cap table | `/config`, `/config/*` |
| 10 | [Quản trị Hệ thống](./10-QUAN_TRI_HE_THONG.md) | Quản lý tài khoản người dùng, nhật ký hoạt động | `/users`, `/audit-logs` |
| 11 | [Cổng thông tin Lái xe](./11-LAI_XE_MOBILE.md) | Lệnh vận chuyển, chi tiết chuyến, thu nhập, phạt (mobile-first) | `/my-trips`, `/my-trips/:id`, `/my-earnings`, `/my-penalties` |
| 12 | [Chi phí, NCC & Công nợ phải trả](./12-CHI_PHI_NCC_VA_CONG_NO_PHAI_TRA.md) | Danh mục Nhà cung cấp, hạng mục chi phí (một lần/định kỳ), nhập phiếu chi phí, công nợ phải trả, nhắc gia hạn | `/suppliers`, `/expenses`, `/payables`, `/payables/:id` |
| 13 | [Nhân viên giao nhận & Tạm ứng](./13-GIAO_NHAN_VA_TAM_UNG.md) | Xem chuyến, nhập container/seal, ghi chi phí phát sinh, tạm ứng, duyệt hoàn ứng | `/my-forwarder-trips`, `/my-forwarder-trips/:id` |
| 14 | [Lương & Chấm công](./14-LUONG_VA_CHAM_CONG.md) | Lịch chấm công tháng, tính lương thực nhận, lương bổ sung, khấu trừ nghỉ việc riêng, xác nhận kỳ lương | `/salary` |
| 15 | [Quản lý Lốp xe](./15-QUAN_LY_LOP_XE.md) | CRUD lốp, grid theo xe, cảnh báo bảo hành | `/config/tires` |

---

## Độ phủ

### Routes (43/43)

<details>
<summary>✅ Đã phủ toàn bộ 43 routes</summary>

| Route | Trang | Tài liệu |
|-------|-------|----------|
| `/login` | LoginPage | 00 |
| `/dashboard` | DashboardPage | 03 |
| `/dispatch` | DispatchPage | 07 |
| `/fleet` | FleetPage | 07 |
| `/trips` | TripListPage | 02 |
| `/trips/new` | TripCreatePage | 01 |
| `/trips/:id` | TripDetailPage | 01 |
| `/trips/:id/edit` | TripEditPage | 01 |
| `/finance` | FinancePage | 03 |
| `/profit` | ProfitPage | 05 |
| `/debt` | DebtListPage | 04 |
| `/debt/:id` | DebtDetailPage | 04 |
| `/penalties` | PenaltyPage | 06 |
| `/customers` | CustomersPage | 08 |
| `/config` | ConfigPage | 09 |
| `/config/trucks` | TrucksConfigPage | 09 |
| `/config/trailers` | TrailersConfigPage | 09 |
| `/config/routes` | RoutesConfigPage | 09 |
| `/config/cargo-types` | CargoTypesConfigPage | 09 |
| `/config/pricing-tables` | PricingTablesConfigPage | 09 |
| `/config/road-allowances` | RoadAllowancesConfigPage | 09 |
| `/config/penalty-reasons` | PenaltyReasonsConfigPage | 09 |
| `/config/drivers` | DriversConfigPage | 09 |
| `/config/fuel` | FuelConfigPage | 09 |
| `/config/cap-table` | CapTableConfigPage | 09 |
| `/config/customers` | CustomersConfigPage | 09 |
| `/config/management-fees` | ManagementFeesConfigPage | 09 |
| `/config/expense-categories` | ExpenseCategoriesConfigPage | 12 |
| `/suppliers` | SupplierListPage | 12 |
| `/expenses` | ExpenseListPage | 12 |
| `/expenses/new` | ExpenseEntryPage (create) | 12 |
| `/expenses/:id/edit` | ExpenseEntryPage (edit) | 12 |
| `/payables` | PayableListPage | 12 |
| `/payables/:id` | PayableDetailPage | 12 |
| `/users` | UsersPage | 10 |
| `/audit-logs` | AuditLogPage | 10 |
| `/my-trips` | DriverTripsPage | 11 |
| `/my-trips/:id` | DriverTripDetailPage | 11 |
| `/my-earnings` | DriverEarningsPage | 11 |
| `/my-penalties` | DriverPenaltyPage | 11 |
| `/my-forwarder-trips` | ForwarderTripsPage | 13 |
| `/my-forwarder-trips/:id` | ForwarderTripDetailPage | 13 |
| `/salary` | SalaryAttendancePage | 14 |

</details>

### API Endpoints (109/109)

Mỗi tài liệu liệt kê đầy đủ các API endpoint liên quan kèm method, path, request body, response, auth requirements, và error codes.

### Vai trò (5/5)

| Vai trò | Tài liệu chính | Tài liệu tham khảo |
|---------|---------------|-------------------|
| ADMIN | 00, 10 | Tất cả |
| MANAGER | 00, 01-09 | 10 |
| ACCOUNTANT | 00, 01-09 | 10 (chỉ xem user list) |
| DRIVER | 00, 11 | — |
| FORWARDER | 00, 13 | — |

---

## Quy ước viết

### Format chung

```markdown
# [Tiêu đề]

> Tài liệu QA testing & Hướng dẫn sử dụng — [Tên tính năng]

## 1. Tổng quan
## 2. Hướng dẫn sử dụng (User Manual)
## 3. Luồng nghiệp vụ (Business Flow)
## 4. Bảng tra cứu (Reference Tables)
## 5. QA Test Checklist
## 6. Ghi chú & Lưu ý quan trọng
```

### QA Test Checklist structure

Mỗi tài liệu có phần QA Test Checklist được chia thành:
- **5.1 Happy Path Tests** — Luồng chính thành công
- **5.2 Validation Tests** — Kiểm tra validation của form fields
- **5.3 Permission Tests** — Kiểm tra phân quyền theo vai trò
- **5.4 Edge Cases & Error Handling** — Trường hợp đặc biệt và xử lý lỗi
- **5.5 Concurrency Tests** — Xung đột đồng thời (nếu có)
- **5.6 Responsive/Mobile Tests** — Giao diện responsive

### Ký hiệu test case

| Cột | Mô tả |
|-----|-------|
| **TC-ID** | Mã test case (VD: `TC-0101`) |
| **Tiêu đề** | Tên test case |
| **Tiền điều kiện** | Điều kiện cần có trước khi test |
| **Các bước** | Hành động thực hiện |
| **Kết quả mong đợi** | Kết quả kỳ vọng |
| **Ưu tiên** | High / Medium / Low |

---

## Tài khoản Demo

| Vai trò | Username | Password | Trang chủ |
|---------|----------|----------|-----------|
| Quản trị (ADMIN) | `admin` | `admin123` | `/dashboard` |
| Giám đốc (MANAGER) | `giamdoc` | `admin123` | `/dashboard` |
| Kế toán (ACCOUNTANT) | `ketoan` | `admin123` | `/dashboard` |
| Lái xe (DRIVER) | `laixe` | `admin123` | `/my-trips` |
| Nhân viên giao nhận (FORWARDER) | `giaonhan` | `admin123` | `/my-forwarder-trips` |
