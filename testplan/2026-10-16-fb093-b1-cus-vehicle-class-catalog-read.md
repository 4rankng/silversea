# FB-093 / QA B-1 — CUS không đọc được danh mục loại xe khi "Ghép cước thu khách"

Ngày: 2026-10-16 · nguồn: QA staging report-only build 104dfd75 (`qa/2026-10-16_fb092-095-staging-qa.md`, finding B-1, commit c214a590) · mức BLOCKER

## Vấn đề đã báo

CUS mở `/shipments-debit`, chọn ≥2 lô lẻ cùng khách, bấm **[Ghép cước thu khách]**:
dropdown "Loại xe tính cước thu khách" luôn rỗng vì `GET /api/vehicle-size-classes?limit=100&page=1`
trả **403** `{"error":"Không có quyền truy cập"}` → dialog không bao giờ submit được.
Cùng thao tác với ACCOUNTANT chạy đầy đủ. Route merge vốn cho CUS
(`requireRoles(..., Role.CUS, ...)`), chỉ catalog loại xe nằm trên mount `config` mà CUS
không có policy row.

## Nguyên nhân gốc

`backend/src/casbin/policy.csv` không có dòng nào cho CUS × config; model casbin
(`p = sub, obj, act`) không có chiều path nên không thể viết policy line scoped theo
endpoint. Cơ chế hẹp nhất của repo cho nhu cầu này là registry route-scoped grant
`backend/src/middleware/authz-grants.ts` (cùng hình với `/quotations/fees/active` —
card 20261002_220, cũng từng bị 403 cùng lớp).

## Cách sửa

Thêm MỘT row bypass: `resource: 'config'`, `methods: ['GET']`,
`pathPattern: /^\/vehicle-size-classes\/?$/`, `roles: [Role.CUS]` — chỉ đúng GET list
catalog loại xe, không thêm `p, CUS, config, read` tổng quát. Đồng bộ oracle + row-count
trong `authz-grant-registry.test.ts` theo luật same-commit của file đó.

## Case ID

- **B1-01**: CUS `GET /api/vehicle-size-classes?limit=100&page=1` → **200** (body `items[]`);
  red-first: không có grant thì 403 (`vehicle-size-classes-cus-read.test.ts`).
- **B1-02 (scoped)**: CUS `GET /api/pricing-tables`, `/api/expense-categories`,
  `/api/fuel-consumption-norms` (cùng mount config) → vẫn **403**.
- **B1-03 (GET-only + near-miss)**: CUS `POST /api/vehicle-size-classes` → 403;
  CUS `GET /api/vehicle-size-classes/1` (chi tiết một row) → 403 — chỉ đường list được cấp.
- **B1-04 (registry)**: oracle/matrix `authz-grant-registry.test.ts` đồng ý với row mới
  cho mọi role × method × path cell của corpus `/vehicle-size-classes*`.

## Phạm vi hồi quy trước khi sửa

| # | Khu vực | Rủi ro | Kiểm bằng |
|---|---|---|---|
| R1 | Ma trận authz-grant registry (card 20260930_228) | Row mới lệch oracle/làm trôi cell khác | `authz-grant-registry.test.ts` xanh sau khi cập nhật cả hai bên same-commit |
| R2 | Các grant CUS hiện có trên config (customers/routes/fuel-price/quotations) | Row mới nuốt nhầm path khác | corpus CONFIG_PATHS + wiring cells giữ nguyên |
| R3 | Catalog CRUD vehicle-size-classes (code immutable, 409 unique) | Grant làm hỏng path admin | `freight-pricing-config-routes.test.ts` xanh nguyên vẹn |
