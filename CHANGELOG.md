# Changelog

## 2026-10-08 — wave: blocker decisions, ops overview, dispatch export, tab counts

Prod `1e688539` → `8897e3f2` (staging-verified at `a1dc8b1f` + QA rungs).

### Shipped

- **/ops — trang Tổng quan Ops** (card 081026095500): 3 chỉ số (lô chờ xử lý trong ngày giao dự kiến, xe đang chạy, số dư quỹ + yêu cầu chờ duyệt) tổng hợp từ endpoint có sẵn, 3 quick link tới /ops/orders, /ops/fleet-tracking, /ops/wallet. Guard opsOnly giữ nguyên; role khác về home của role đó.
- **/dispatch — Xuất file Excel** (card 081026093510): export data-driven — enabled khi có dữ liệu trong phạm vi lọc hiện tại; disabled kèm lý do thấy được (DisabledActionTip). Tệp `ke-hoach-tong-quat-<ngày>.xlsx` đúng dữ liệu lọc.
- **/shipments — tab trạng thái có số full-set** (card 081026093520): mọi tab (Tất cả / Chưa chốt lịch / Chờ điều xe / Chờ đối soát) hiển thị tổng theo filter từ `statusCounts` của API, không bao giờ lấy số dòng trang đang tải; bucket rỗng hiện 0, không để trống.
- **Năng suất — ô phần trăm một dòng by construction** (card 071026141600): token số+đơn vị là một text node nowrap (`NumericUnit`), header mang đủ nhãn. Hardening — lỗi gốc không tái hiện kể cả trước fix.
- **e-POD — nhãn "N tệp" một text node** (card 071026212510): badge đếm file là một span nowrap; sweep 18 vị trí số+đơn vị dính khả năng vỡ node trên toàn app.

### Rulings & closes (owner ủy quyền lead quyết 08/10)

- **Phát lệnh cần nhà xe** (card 397): chưa gán nhà xe thì KHÔNG có nút Phát lệnh — đúng workflow #359; không phải lỗi. Verified 2 chiều trên fixture tự dựng (assigned có fieldset, unassigned không có).
- Non-repro closes: toast 403 admin trên /customers (212000), search không lọc (205300, lần 2, role admin battery), nav race (093500 — chỉ cửa sổ <300ms nội tại, cold-context hiện skeleton ngay).
