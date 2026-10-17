# fix-141026230710 — Ops bị chặn khỏi luồng khai chi phí (P1) — DONE (pending final gates sign-off)

Controller: this session (Paseo agent), worktree branch
`fix-141026230710-ops-expense-access` (base `773c73b1` off origin/main).
Updated: 2026-10-17.

## Goal & status

Ticket 141026230710 (P1, chỉ thị 2026-10-17, spec T3 — mọi Ops khai chi phí
mọi lô, không chia theo cá nhân/xe): gỡ 2 chặn của luồng khai chi phí.

- Chặn 1 `/shipments`: **ĐÃ GỠ** — thêm `p, OPS, shipments, read`
  (backend/src/casbin/policy.csv) + `Role.OPS` vào `canReadShipmentRoutes`
  (frontend/src/lib/role-access.ts).
- Chặn 2 dialog "Lô này không thuộc xe bạn phụ trách.": **đã mở từ trước trong
  base** (batch open-scope "plan step 5"/20261005, qua `2a64156f`); grant
  per-person + endpoint `write-scope` không còn trong nguồn. Xác minh + pin
  bằng test mới; không code change.

## Scope & non-goals

- Sửa: policy rule + FE guard + comments (policy.csv, enforcer.ts,
  routes/shipments/index.ts, authz-grants.ts reason) + pins đổi theo quyết
  định mới (shipment-rbac, shipment-routes, role-access, App.shipment-operations-route).
- KHÔNG sửa: nav sidebar OPS (không thêm entry /shipments — ngoài chỉ thị),
  write/delete quyền shipments (vẫn đóng), FB-033 dialog-OPS-only + nhãn nút
  (giữ), tickets khác.

## Decisions & sources

- Chỉ thị người dùng 2026-10-17 (ticket) > FB-033 note trong recheck 16/10
  ("/shipments 403 là status quo") — note đó bị supersede cho riêng chặn 1.
- Quyết định mới ghi tại:
  `testplan/2026-10-17-card141026230710-ops-shipments-view-open.md`.
- Casbin rule cite: `p, OPS, shipments, read` (policy.csv, Wave 0 block).
- Trip predicate cite: `assertExpenseOwnerWriteScope`
  (backend/src/services/expense-owner-scope.service.ts) — chỉ scope DRIVER
  qua `trips.driverId ↔ drivers.userId`; OPS exempt.

## Files owned by this task

- backend/src/casbin/policy.csv, backend/src/casbin/enforcer.ts (comment)
- backend/src/routes/shipments/index.ts (comment),
  backend/src/middleware/authz-grants.ts (reason prose)
- frontend/src/lib/role-access.ts
- backend/src/tests/ops-expense-access.test.ts (NEW — 1 test qua cả 2 chặn)
- pins: backend/src/tests/unit/shipment-rbac.test.ts,
  backend/src/tests/shipment-routes.test.ts, frontend/src/lib/role-access.test.ts,
  frontend/src/App.shipment-operations-route.test.tsx
- testplan/2026-10-17-card141026230710-ops-shipments-view-open.md, CHANGELOG.md

## Unrelated / concurrent changes preserved

- Pre-existing failure NOT touched (out of scope — ticket khác):
  `QA-AUDIT-PHOI-11 ×3` in `backend/src/tests/expense-source-remediation.test.ts`
  — commit `ad2b8777` đổi `sourceId` của tiền-đường row sang
  `expense_accounting_sources.id` nhưng test vẫn expect cost-table ids
  (actual [3528, 14166] vs expected [3528, 3529]). Reproduce standalone
  (không dính rows của test mới). Bằng chứng:
  `qa/2026-10-17_141026230710_remediation-standalone.log`.
- Handoff cũ (task QA1016, completed) archive tại
  `plans/qa-full-guide-closed-loop-1016/handoff-archived-2026-10-17.md`.

## QA artifacts

- `qa/2026-10-17_141026230710_backend-tsc.log` — exit 0
- `qa/2026-10-17_141026230710_backend-tests.log` — 5 files; new test + pins
  green; chỉ QA-AUDIT-PHOI-11 ×3 fail (pre-existing, cite ở trên)
- `qa/2026-10-17_141026230710_remediation-standalone.log` — standalone repro
- `qa/2026-10-17_141026230710_write-pins.log` — o01-trip-pairs +
  shipment-quick-create (POST-denial pins) exit 0 vs policy mới
- `qa/2026-10-17_141026230710_frontend-tsc.log` — exit 0
- `qa/2026-10-17_141026230710_frontend-tests.log` — full FE suite
  4975/4977; 2 fail chỉ vì `dist/` chưa build (chính message của test:
  "dist/assets missing — run build first")
- `qa/2026-10-17_141026230710_build.log` — `make build` exit 0 (repair)
- `qa/2026-10-17_141026230710_frontend-tests-rerun.log` — rerun file fail:
  6/6 pass sau build
- `qa/2026-10-17_141026230710_root-lint.log` — red TẠI BASE cho
  `testplan/qa/2026-10-16_w1-*` (12 unused-vars, commit `2e6acf92`, không
  nằm trong diff này); scoped eslint trên các file của fix: exit 0
- `qa/2026-10-17_141026230710_context-check.log` — manifest valid

## Next step

## FB-100 (141026230770) tái xác minh + sửa fixture red-at-head — 17/10/2026 (worktree fix-141026230770-advance-refund-buttons @ 773c73b1)

- Card 141026230770 (Tạm ứng & hoàn ứng: nút "Phê duyệt tạm ứng" / tick "Xác
  nhận hoàn ứng" Option B / số âm + "Đề nghị thu tiền ứng") đã DEV_COMPLETED
  từ wave W1 và nằm trên origin/main (`4ee08710`, `171fb358`, `055105dc`).
  Worktree = origin/main → không có delta mã cho 3 mục (a)(b)(c); tái xác minh
  bằng gates tại HEAD: BE/FE tsc 0, BE 20/20 (advance-approval,
  advance-settlement-deadlock-order, transport-expense-direct-lifecycle,
  card169-reconciliation-report, reconciliation-refund-settle), FE 43/43
  (AdminAdvancesPage, ForwarderSettlementCreatePage, SettlementPrintPage,
  OpsReconciliationReportPage). Artefact `qa/2026-10-17_fb100_*`.
- Sửa red-at-head (va chạm 2 card đã land, không thuộc FB-100): fixture
  `card169-reconciliation-report.test.ts` tạo 2 chi phí cùng loại + cùng lô →
  guard card 141026230720 (`OPS_EXPENSE_DUPLICATE`) 409 lần lưu thứ hai.
  Fixture thêm `duplicateConfirmed: true` đúng case split-payment guard cho
  phép; guard + 4 pin của nó còn nguyên (`ops-expense-duplicate-warning.test.ts`
  4/4). Chi tiết: `testplan/2026-10-16-card141026230770-tam-ung-hoan-ung.md`.

## B.2 (141026230710) — Mở /shipments cho Ops + pin khai chi phí mọi lô — 17/10/2026 (worktree fix-141026230710-ops-expense-access @ df08bd7c)

- Ticket 141026230710 (P1, spec T3: mọi Ops khai chi phí mọi lô, không chia
  theo cá nhân/xe). Gỡ 2 chặn: Casbin rule `p, OPS, shipments, read` +
  `canReadShipmentRoutes(Role.OPS)` guard. Trip predicate
  `assertExpenseOwnerWriteScope` chỉ scope DRIVER qua `trips.driverId`.
- Regression test: `backend/src/tests/ops-expense-access.test.ts` (casbin
  thật + router thật trả 200/404, `createOpsExpense` trên lô fresh có trip
  gán lái xe khác).
- Policy-mirror pins: `shipment-rbac.test.ts`, `shipment-routes.test.ts`,
  `role-access.test.ts`, `App.shipment-operations-route.test.tsx`.
- Regression plan: `testplan/2026-10-17-card141026230710-ops-shipments-view-open.md`.
