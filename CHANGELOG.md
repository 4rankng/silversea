# Changelog

## 2026-10-08 (chiều) — wave: 20261008_1–_5 sweep batch

Prod `7b1d0433` → `b90beff2` (staging-verified at `dc599a82`).

- **Ops wallet — Lịch sử chi phí có số full-set** (_2): 4 tab lọc ('Tất cả 15 / Cần bổ sung 0 / Đã ghi nhận 12 / Đã hủy 3') theo census mới native + legacy trip rows; bucket rỗng hiện 0 thấy được.
- **Mọi nút disabled tự giải thích** (_1): /shipments-debit, popover phân bổ, /dispatch-detail — DisabledActionTip (aria-disabled + lý do reachable hover/focus); sweep xong 2 surface live + 21 pin test.
- **Chip lọc điều phối có số đúng nghĩa union** (_3): 'Chưa gán xe 23 / Đã gán xe 19' — số hàng mỗi chip thực sự hiển thị trong view đang lọc (tap chứng minh 1-1).
- **Toast phân quyền nêu tên thao tác** (_4): không echo body lỗi trần; request abort không đẻ toast phân quyền (live-verified); 403 naming pin bằng test.
- **Tabs đọc số có khoảng trắng** (_5, lead-claimed theo chỉ đạo hoàn thành mọi thẻ): aria-label 'Tất cả 147' thay vì 'Tất cả147'; thị giác giữ nguyên. Cross-lane collision với ZAI trên cùng file được reconcile về một bản labelText-based.

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
