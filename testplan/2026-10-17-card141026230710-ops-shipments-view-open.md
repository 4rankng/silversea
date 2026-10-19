# Case 141026230710 (P1, mở lại 17/10/2026) — Ops bị chặn khỏi luồng khai chi phí: 2 chặn phải gỡ

Chỉ thị người dùng 2026-10-17 (ticket 141026230710, P1): **mọi Ops được khai
chi phí MỌI lô** (spec T3 — không chia theo cá nhân/xe). Gỡ 2 chặn:
route `/shipments` + dialog "Lô này không thuộc xe bạn phụ trách.".

Lưu ý lịch sử: bản recheck 16/10
(`2026-10-16-card141026230710-ops-khai-chi-phi-recheck.md`) coi `/shipments`
403 cho OPS là "FB-033 status quo, by design". Chỉ thị 17/10 MỞ quyền view
này — recheck note bị chỉ thị mới supersede cho riêng chặn 1. FB-033 gốc (chỉ
định dialog "Khai chi phí" là OPS-only + nhãn nút) vẫn giữ nguyên.

## Repro gốc (14/10 staging, hoangnh/OPS)

1. Mở `/shipments` → redirect + toast "Bạn không có quyền truy cập trang này."
2. Mở kế hoạch công hàng của 1 lô → "Khai chi phí" → dialog "Lô này không
   thuộc xe bạn phụ trách.", nút Lưu disabled (2 lô đã thử).

## Root cause (truy vết nguồn 17/10/2026, worktree fix-141026230710-ops-expense-access)

- **Chặn 1 — `/shipments`** (2 tầng, cùng một quyết định):
  - FE `frontend/src/lib/role-access.ts` `canReadShipmentRoutes()` không có
    `Role.OPS` → `DeniedRedirect` + toast (`App.tsx:303`).
  - BE `backend/src/casbin/policy.csv` không có `p, OPS, shipments, read` →
    mount `casbinAuthz('shipments')` (`index.ts:233`) trả 403 cho
    `GET /api/shipments` (list/detail không có `requireRoles` riêng).
- **Chặn 2 — dialog "Lô này không thuộc xe bạn phụ trách."**: đã bị gỡ từ
  trước trong base này (batch "plan step 5" / 20261005 open-scope, qua
  `2a64156f`; recheck 16/10 xác nhận FIXED trên staging 8610a42b). Grant
  per-person cũ (`assertOpsExpenseAssignment`: user↔lot link / active truck
  assignment / prior expense) và endpoint `GET /api/ops/expenses/write-scope`
  KHÔNG còn trong nguồn. `assertExpenseOwnerWriteScope`
  (`backend/src/services/expense-owner-scope.service.ts`) nay chỉ scope DRIVER
  (predicate `trips.driverId ↔ drivers.userId`); OPS không bị filter theo
  driver/xe — đúng spec T3. `POST /api/ops/expenses` (`createOpsExpense`) chỉ
  còn check khóa kế toán + lô tồn tại + container-thuộc-lô + cảnh báo trùng.

## Expected sau sửa

1. Ops mở `/shipments` thấy trang (không redirect, không toast); API
   `GET /api/shipments` trả 200 cho OPS (casbin `shipments, read`; write/delete
   vẫn bị từ chối).
2. Ops khai chi phí được trên MỌI lô (không cần gán xe/user-link/chi phí cũ);
   predicate giữ nguyên cho DRIVER (trip vẫn phải gán cho chính lái xe đó).

## Regression pin

- BE test đi qua cả 2 chặn: `backend/src/tests/ops-expense-access.test.ts`
  (casbin thật + router thật trả 200/404 thay vì 403; `createOpsExpense` trên
  lô mới tinh không grant → thành công).
- Pins đổi theo quyết định mới (mirror của policy):
  `backend/src/tests/unit/shipment-rbac.test.ts` (OPS shipments read false→true),
  `frontend/src/lib/role-access.test.ts`, `frontend/src/App.shipment-operations-route.test.tsx`.
- Pin chặn 2 đã có sẵn từ trước: FIX17-S01
  (`backend/src/tests/expense-source-remediation.test.ts`) +
  `frontend/src/features/ops/OpsExpenseFormModal.containers.test.tsx`.

## Scope

- Sửa: chặn 1 (policy.csv + role-access.ts + comments liên quan) + test/pins.
- Không sửa (xác minh là đã đúng): chặn 2 (đã mở trong base), nav sidebar OPS
  (không thêm entry `/shipments` — không nằm trong chỉ thị), các quyền khác của
  `/shipments/*` (write/delete/dispatch/finance) giữ nguyên.
