# Card 385 — Hồi quy: Danh sách nhân sự + tách nhóm Văn phòng/Lái xe trên Lương & Chấm công

Ngày: 2026-10-05 · REQ-5.10-14 · impl-385

## Phạm vi hồi quy (Regression profile — trước khi làm)

| # | Khu vực | Rủi ro hồi quy | Trường hợp kiểm |
|---|---|---|---|
| R1 | GET /users consumers | Endpoint cộng thêm người tiêu thụ mới (/hr/roster, tab Văn phòng /salary) | `/users` giữ nguyên shape `UsersResponse`; không đổi gate; `/users` trang phân quyền hoạt động như cũ |
| R2 | `/salary` nhóm Lái xe (mặc định) | Bề mặt lái xe bị đổi hành vi khi thêm bộ chuyển nhóm | Mặc định mở nhóm "Lái xe": hero, FilterBar tìm lái xe, lưới lái xe, lịch công, sidebar kỳ lương nguyên vẹn; office fetch không chạy (enabled khi mở nhóm) |
| R3 | `/salary` chuyển nhóm | Nhóm "Văn phòng" phải trung thực: người thật, ô chấm công/lương rỗng | Tab "Văn phòng": bảng nhân sự văn phòng thật (loại DRIVER/CUSTOMER), ô Chấm công/Lương hiển thị "—", EmptyState "Chưa có dữ liệu chấm công/lương văn phòng — Chờ chốt trường dữ liệu với khách hàng" |
| R4 | /hr/roster mới | Trang mới không kích hoạt nhầm dữ liệu/gate khác | Chỉ đọc; bộ lọc tìm kiếm + bộ phận; loại tài khoản CUSTOMER; Bộ phận suy ra từ business units như /users |
| R5 | Điều hướng | Catalog + route mới không phá tiêu đề/tiêu đề topbar cũ | `titleForPath('/hr/roster')` → "Danh sách nhân sự"; các titleRule cũ không đổi |

## Kiểm thử hiện có (đã chạy)

- `frontend/src/pages/HrRosterPage.test.tsx` — render + loại CUSTOMER + tìm kiếm + lọc bộ phận + empty state (3 case).
- `frontend/src/pages/SalaryAttendancePage.test.tsx` — thêm 3 case nhóm: mặc định Lái xe nguyên vẹn + office fetch hoãn; Văn phòng trung thực (— cells + EmptyState); quay lại Lái xe phục hồi nguyên bề mặt.

## Cần chốt với khách hàng (cần-chốt còn mở — giữ nguyên trạng thái mở)

1. Chấm công văn phòng cần những trường gì (ngày công, phép, nghỉ không lương…)?
2. Lương văn phòng có công thức tính hay nhập tay theo kỳ?
3. Danh sách nhân sự có cần trường nào ngoài Mã NV/Họ tên/Bộ phận (chức vụ, ngày vào, hợp đồng…)?
